import * as acorn from 'acorn';
import { getOperationManifest, SUPPORT_STATUS } from './capabilities.mjs';
import { parseDsl } from './mock-runtime.mjs';

export const EXPERT_COMPILER_VERSION = 'expert-compiler-0.1.0';

const DEFAULT_LIMITS = Object.freeze({
  maxOperations: 2000,
  maxLoopIterations: 10000,
  maxStatements: 50000,
  maxOutputBytes: 5_000_000,
  timeoutMs: 1000
});

const DENIED_PROPERTIES = new Set(['__proto__', 'prototype', 'constructor']);
const OPERATION_BY_NAME = new Map(getOperationManifest().map((capability) => [capability.op, capability]));
const NATIVE = Symbol('ExpertNativeFunction');

export class ExpertCompileError extends Error {
  constructor(message, node) {
    const location = node?.loc?.start ? ` at ${node.loc.start.line}:${node.loc.start.column}` : '';
    super(`${message}${location}`);
    this.name = 'ExpertCompileError';
  }
}

export function compileExpertScript(source, options = {}) {
  if (typeof source !== 'string' || !source.trim()) {
    throw new ExpertCompileError('compile_expert requires a non-empty script string');
  }

  const limits = normalizeLimits(options);
  let program;
  try {
    program = acorn.parse(source, {
      ecmaVersion: 2024,
      sourceType: 'script',
      locations: true,
      allowReturnOutsideFunction: false
    });
  } catch (error) {
    throw new ExpertCompileError(`Expert script syntax error: ${error.message}`);
  }

  const interpreter = new ExpertInterpreter({ limits, seed: options.seed ?? 1 });
  const output = interpreter.run(program);
  const document = normalizeExpertOutput(output, limits);
  const code = `${JSON.stringify(document, null, 2)}\n`;
  validateExpertDocument(document, { maxOperations: limits.maxOperations, maxOutputBytes: limits.maxOutputBytes });

  return {
    code,
    document,
    expert: {
      compiler_version: EXPERT_COMPILER_VERSION,
      operations: document.operations.length,
      seed: interpreter.seed,
      limits,
      stats: interpreter.stats()
    }
  };
}

export function normalizeExpertOutput(output, limits = normalizeLimits()) {
  let document;
  if (Array.isArray(output)) {
    document = { version: 1, units: 'mm', operations: output };
  } else if (isPlainObject(output) && Array.isArray(output.operations)) {
    document = {
      version: output.version ?? 1,
      units: output.units ?? 'mm',
      ...output,
      operations: output.operations
    };
  } else {
    throw new ExpertCompileError('Expert script must end with an operations array or a DSL document object');
  }

  assertJsonCompatible(document, 'output');
  if (document.operations.length > limits.maxOperations) {
    throw new ExpertCompileError(`Expert output operation limit exceeded: max ${limits.maxOperations}`);
  }
  return document;
}

export function validateExpertDocument(document, { maxOperations = DEFAULT_LIMITS.maxOperations, maxOutputBytes = DEFAULT_LIMITS.maxOutputBytes } = {}) {
  const code = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(code, 'utf8') > maxOutputBytes) {
    throw new ExpertCompileError(`Expert output size limit exceeded: max ${maxOutputBytes} bytes`);
  }

  const parsed = parseDsl(code);
  if (parsed.operations.length > maxOperations) {
    throw new ExpertCompileError(`Expert output operation limit exceeded: max ${maxOperations}`);
  }
  for (const [index, operation] of parsed.operations.entries()) {
    validateOperationShape(operation, `operations[${index}]`, false);
  }
  return parsed;
}

function validateOperationShape(operation, path, insideComponent) {
  const capability = OPERATION_BY_NAME.get(operation.op);
  if (!capability) {
    throw new ExpertCompileError(`${path}.op is not in the operation registry: ${operation.op}`);
  }
  if (insideComponent && capability.component_scope.status !== SUPPORT_STATUS.supported) {
    throw new ExpertCompileError(`${path}.op is not supported inside component_definition: ${operation.op}`);
  }
  for (const field of capability.schema.required || []) {
    if (!hasFieldPath(operation, field)) {
      throw new ExpertCompileError(`${path} missing required field: ${field}`);
    }
  }
  if (operation.op === 'component_definition' && operation.operations !== undefined) {
    if (!Array.isArray(operation.operations)) {
      throw new ExpertCompileError(`${path}.operations must be an array`);
    }
    for (const [index, child] of operation.operations.entries()) {
      if (!isPlainObject(child)) {
        throw new ExpertCompileError(`${path}.operations[${index}] must be an object`);
      }
      validateOperationShape(child, `${path}.operations[${index}]`, true);
    }
  }
}

function hasFieldPath(object, fieldPath) {
  const parts = fieldPath.split('.');
  let cursor = object;
  for (const part of parts) {
    if (!isPlainObject(cursor) || cursor[part] === undefined) return false;
    cursor = cursor[part];
  }
  return true;
}

function normalizeLimits(options = {}) {
  return {
    maxOperations: positiveInteger(options.maxOperations, DEFAULT_LIMITS.maxOperations, 'maxOperations'),
    maxLoopIterations: positiveInteger(options.maxLoopIterations, DEFAULT_LIMITS.maxLoopIterations, 'maxLoopIterations'),
    maxStatements: positiveInteger(options.maxStatements, DEFAULT_LIMITS.maxStatements, 'maxStatements'),
    maxOutputBytes: positiveInteger(options.maxOutputBytes, DEFAULT_LIMITS.maxOutputBytes, 'maxOutputBytes'),
    timeoutMs: positiveInteger(options.timeoutMs, DEFAULT_LIMITS.timeoutMs, 'timeoutMs')
  };
}

function positiveInteger(value, fallback, field) {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ExpertCompileError(`${field} must be a positive integer`);
  }
  return parsed;
}

class ExpertInterpreter {
  constructor({ limits, seed }) {
    this.limits = limits;
    this.seed = normalizeSeed(seed);
    this.randomState = this.seed;
    this.loopIterations = 0;
    this.statementCount = 0;
    this.startedAt = Date.now();
    this.deadline = this.startedAt + limits.timeoutMs;
    this.globalScope = new ExpertScope();
    installBuiltins(this.globalScope, this);
  }

  run(program) {
    return this.executeProgram(program, this.globalScope);
  }

  stats() {
    return {
      statements: this.statementCount,
      loop_iterations: this.loopIterations
    };
  }

  executeProgram(program, scope) {
    let lastValue;
    for (const statement of program.body) {
      lastValue = this.executeStatement(statement, scope);
    }
    return lastValue;
  }

  executeStatement(node, scope) {
    this.checkLimits(node);
    switch (node.type) {
      case 'VariableDeclaration':
        return this.executeVariableDeclaration(node, scope);
      case 'FunctionDeclaration':
        return this.executeFunctionDeclaration(node, scope);
      case 'ExpressionStatement':
        return this.evaluateExpression(node.expression, scope);
      case 'BlockStatement':
        return this.executeBlock(node, new ExpertScope(scope));
      case 'IfStatement':
        return truthy(this.evaluateExpression(node.test, scope))
          ? this.executeStatement(node.consequent, scope)
          : node.alternate ? this.executeStatement(node.alternate, scope) : undefined;
      case 'ForStatement':
        return this.executeForStatement(node, scope);
      case 'ForOfStatement':
        return this.executeForOfStatement(node, scope);
      case 'ReturnStatement':
        throw new ReturnSignal(node.argument ? this.evaluateExpression(node.argument, scope) : undefined);
      case 'BreakStatement':
        throw new BreakSignal();
      case 'ContinueStatement':
        throw new ContinueSignal();
      case 'EmptyStatement':
        return undefined;
      default:
        throw new ExpertCompileError(`Unsupported statement syntax: ${node.type}`, node);
    }
  }

  executeBlock(node, scope) {
    let lastValue;
    for (const statement of node.body) {
      lastValue = this.executeStatement(statement, scope);
    }
    return lastValue;
  }

  executeVariableDeclaration(node, scope) {
    for (const declaration of node.declarations) {
      if (declaration.id.type !== 'Identifier') {
        throw new ExpertCompileError('Destructuring declarations are not supported in Expert Mode', declaration.id);
      }
      const value = declaration.init ? this.evaluateExpression(declaration.init, scope) : undefined;
      scope.define(declaration.id.name, value, node.kind);
    }
    return undefined;
  }

  executeFunctionDeclaration(node, scope) {
    if (!node.id?.name) {
      throw new ExpertCompileError('Function declarations must be named', node);
    }
    scope.define(node.id.name, new ExpertFunction(node, scope), 'const');
    return undefined;
  }

  executeForStatement(node, scope) {
    const loopScope = new ExpertScope(scope);
    if (node.init) {
      if (node.init.type === 'VariableDeclaration') this.executeVariableDeclaration(node.init, loopScope);
      else this.evaluateExpression(node.init, loopScope);
    }

    let lastValue;
    while (!node.test || truthy(this.evaluateExpression(node.test, loopScope))) {
      this.countLoop(node);
      try {
        lastValue = this.executeStatement(node.body, loopScope);
      } catch (signal) {
        if (signal instanceof BreakSignal) break;
        if (!(signal instanceof ContinueSignal)) throw signal;
      }
      if (node.update) this.evaluateExpression(node.update, loopScope);
    }
    return lastValue;
  }

  executeForOfStatement(node, scope) {
    if (node.await) throw new ExpertCompileError('await for-of is not supported in Expert Mode', node);
    const iterable = this.evaluateExpression(node.right, scope);
    if (!Array.isArray(iterable)) throw new ExpertCompileError('for-of only supports arrays in Expert Mode', node.right);

    const loopScope = new ExpertScope(scope);
    let bindingName;
    let bindingKind = 'let';
    if (node.left.type === 'VariableDeclaration') {
      if (node.left.declarations.length !== 1 || node.left.declarations[0].id.type !== 'Identifier') {
        throw new ExpertCompileError('for-of declarations must bind one identifier', node.left);
      }
      bindingName = node.left.declarations[0].id.name;
      bindingKind = node.left.kind;
      loopScope.define(bindingName, undefined, bindingKind);
    } else if (node.left.type === 'Identifier') {
      bindingName = node.left.name;
    } else {
      throw new ExpertCompileError('for-of left side must be an identifier', node.left);
    }

    let lastValue;
    for (const value of iterable) {
      this.countLoop(node);
      if (node.left.type === 'VariableDeclaration') loopScope.forceAssign(bindingName, value);
      else loopScope.assign(bindingName, value);
      try {
        lastValue = this.executeStatement(node.body, loopScope);
      } catch (signal) {
        if (signal instanceof BreakSignal) break;
        if (!(signal instanceof ContinueSignal)) throw signal;
      }
    }
    return lastValue;
  }

  evaluateExpression(node, scope) {
    this.checkLimits(node);
    switch (node.type) {
      case 'Literal':
        return node.value;
      case 'Identifier':
        return scope.get(node.name, node);
      case 'ArrayExpression':
        return node.elements.map((element) => {
          if (!element) throw new ExpertCompileError('Array holes are not supported in Expert Mode', node);
          if (element.type === 'SpreadElement') throw new ExpertCompileError('Spread elements are not supported in Expert Mode', element);
          return this.evaluateExpression(element, scope);
        });
      case 'ObjectExpression':
        return this.evaluateObjectExpression(node, scope);
      case 'TemplateLiteral':
        return this.evaluateTemplateLiteral(node, scope);
      case 'UnaryExpression':
        return this.evaluateUnaryExpression(node, scope);
      case 'BinaryExpression':
        return this.evaluateBinaryExpression(node, scope);
      case 'LogicalExpression':
        return this.evaluateLogicalExpression(node, scope);
      case 'ConditionalExpression':
        return truthy(this.evaluateExpression(node.test, scope))
          ? this.evaluateExpression(node.consequent, scope)
          : this.evaluateExpression(node.alternate, scope);
      case 'AssignmentExpression':
        return this.evaluateAssignmentExpression(node, scope);
      case 'UpdateExpression':
        return this.evaluateUpdateExpression(node, scope);
      case 'CallExpression':
        return this.evaluateCallExpression(node, scope);
      case 'MemberExpression':
        return this.evaluateMemberExpression(node, scope);
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
        return new ExpertFunction(node, scope);
      default:
        throw new ExpertCompileError(`Unsupported expression syntax: ${node.type}`, node);
    }
  }

  evaluateObjectExpression(node, scope) {
    const object = {};
    for (const property of node.properties) {
      if (property.type === 'SpreadElement') {
        throw new ExpertCompileError('Object spread is not supported in Expert Mode', property);
      }
      if (property.kind !== 'init' || property.method) {
        throw new ExpertCompileError('Object methods/getters/setters are not supported in Expert Mode', property);
      }
      const key = property.computed
        ? this.evaluateExpression(property.key, scope)
        : objectKey(property.key, property);
      assertSafeProperty(key, property.key);
      object[String(key)] = this.evaluateExpression(property.value, scope);
    }
    return object;
  }

  evaluateTemplateLiteral(node, scope) {
    let output = '';
    for (let index = 0; index < node.quasis.length; index += 1) {
      output += node.quasis[index].value.cooked;
      if (index < node.expressions.length) output += String(this.evaluateExpression(node.expressions[index], scope));
    }
    return output;
  }

  evaluateUnaryExpression(node, scope) {
    const argument = this.evaluateExpression(node.argument, scope);
    switch (node.operator) {
      case '+': return Number(argument);
      case '-': return -Number(argument);
      case '!': return !truthy(argument);
      default:
        throw new ExpertCompileError(`Unsupported unary operator: ${node.operator}`, node);
    }
  }

  evaluateBinaryExpression(node, scope) {
    const left = this.evaluateExpression(node.left, scope);
    const right = this.evaluateExpression(node.right, scope);
    switch (node.operator) {
      case '+': return left + right;
      case '-': return Number(left) - Number(right);
      case '*': return Number(left) * Number(right);
      case '/': return Number(left) / Number(right);
      case '%': return Number(left) % Number(right);
      case '**': return Number(left) ** Number(right);
      case '<': return left < right;
      case '<=': return left <= right;
      case '>': return left > right;
      case '>=': return left >= right;
      case '==':
      case '===': return left === right;
      case '!=':
      case '!==': return left !== right;
      default:
        throw new ExpertCompileError(`Unsupported binary operator: ${node.operator}`, node);
    }
  }

  evaluateLogicalExpression(node, scope) {
    const left = this.evaluateExpression(node.left, scope);
    if (node.operator === '&&') return truthy(left) ? this.evaluateExpression(node.right, scope) : left;
    if (node.operator === '||') return truthy(left) ? left : this.evaluateExpression(node.right, scope);
    if (node.operator === '??') return left ?? this.evaluateExpression(node.right, scope);
    throw new ExpertCompileError(`Unsupported logical operator: ${node.operator}`, node);
  }

  evaluateAssignmentExpression(node, scope) {
    const current = this.readAssignmentTarget(node.left, scope);
    const value = assignmentValue(node.operator, current, () => this.evaluateExpression(node.right, scope), node);
    this.writeAssignmentTarget(node.left, value, scope);
    return value;
  }

  evaluateUpdateExpression(node, scope) {
    const current = Number(this.readAssignmentTarget(node.argument, scope));
    const next = node.operator === '++' ? current + 1 : current - 1;
    this.writeAssignmentTarget(node.argument, next, scope);
    return node.prefix ? next : current;
  }

  readAssignmentTarget(node, scope) {
    if (node.type === 'Identifier') return scope.get(node.name, node);
    if (node.type === 'MemberExpression') return this.evaluateMemberExpression(node, scope);
    throw new ExpertCompileError('Assignment target must be an identifier or member expression', node);
  }

  writeAssignmentTarget(node, value, scope) {
    if (node.type === 'Identifier') {
      scope.assign(node.name, value, node);
      return;
    }
    if (node.type === 'MemberExpression') {
      const object = this.evaluateExpression(node.object, scope);
      const property = memberProperty(node, scope, this);
      setMember(object, property, value, node);
      return;
    }
    throw new ExpertCompileError('Assignment target must be an identifier or member expression', node);
  }

  evaluateCallExpression(node, scope) {
    if (node.arguments.some((argument) => argument.type === 'SpreadElement')) {
      throw new ExpertCompileError('Call spread is not supported in Expert Mode', node);
    }
    const args = node.arguments.map((argument) => this.evaluateExpression(argument, scope));

    if (node.callee.type === 'MemberExpression') {
      const object = this.evaluateExpression(node.callee.object, scope);
      const property = memberProperty(node.callee, scope, this);
      return callMember(object, property, args, this, node);
    }

    const callee = this.evaluateExpression(node.callee, scope);
    return callFunction(callee, args, this, node);
  }

  evaluateMemberExpression(node, scope) {
    const object = this.evaluateExpression(node.object, scope);
    const property = memberProperty(node, scope, this);
    return getMember(object, property, node);
  }

  checkLimits(node) {
    this.statementCount += 1;
    if (this.statementCount > this.limits.maxStatements) {
      throw new ExpertCompileError(`Expert statement limit exceeded: max ${this.limits.maxStatements}`, node);
    }
    if (Date.now() > this.deadline) {
      throw new ExpertCompileError(`Expert compiler timeout exceeded: max ${this.limits.timeoutMs}ms`, node);
    }
  }

  countLoop(node) {
    this.loopIterations += 1;
    if (this.loopIterations > this.limits.maxLoopIterations) {
      throw new ExpertCompileError(`Expert loop limit exceeded: max ${this.limits.maxLoopIterations}`, node);
    }
  }

  nextRandom() {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0;
    return this.randomState / 0x100000000;
  }
}

class ExpertScope {
  constructor(parent = null) {
    this.parent = parent;
    this.bindings = new Map();
  }

  define(name, value, kind = 'let') {
    if (this.bindings.has(name)) {
      throw new ExpertCompileError(`Identifier already declared: ${name}`);
    }
    this.bindings.set(name, { value, mutable: kind !== 'const' });
  }

  get(name, node) {
    if (this.bindings.has(name)) return this.bindings.get(name).value;
    if (this.parent) return this.parent.get(name, node);
    throw new ExpertCompileError(`Unknown identifier: ${name}`, node);
  }

  assign(name, value, node) {
    if (this.bindings.has(name)) {
      const binding = this.bindings.get(name);
      if (!binding.mutable) throw new ExpertCompileError(`Cannot assign to const identifier: ${name}`, node);
      binding.value = value;
      return;
    }
    if (this.parent) {
      this.parent.assign(name, value, node);
      return;
    }
    throw new ExpertCompileError(`Unknown identifier: ${name}`, node);
  }

  forceAssign(name, value) {
    if (this.bindings.has(name)) {
      this.bindings.get(name).value = value;
      return;
    }
    if (this.parent) {
      this.parent.forceAssign(name, value);
      return;
    }
    throw new ExpertCompileError(`Unknown identifier: ${name}`);
  }
}

class ExpertFunction {
  constructor(node, closure) {
    this.node = node;
    this.closure = closure;
  }

  call(args, interpreter, callNode) {
    const functionScope = new ExpertScope(this.closure);
    bindFunctionParams(this.node.params, args, functionScope, interpreter, callNode);
    if (this.node.body.type !== 'BlockStatement') {
      return interpreter.evaluateExpression(this.node.body, functionScope);
    }
    try {
      return interpreter.executeBlock(this.node.body, functionScope);
    } catch (signal) {
      if (signal instanceof ReturnSignal) return signal.value;
      throw signal;
    }
  }
}

class ReturnSignal {
  constructor(value) {
    this.value = value;
  }
}

class BreakSignal {}
class ContinueSignal {}

function bindFunctionParams(params, args, scope, interpreter, callNode) {
  for (const [index, param] of params.entries()) {
    if (param.type === 'Identifier') {
      scope.define(param.name, args[index], 'let');
      continue;
    }
    if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') {
      scope.define(param.left.name, args[index] === undefined ? interpreter.evaluateExpression(param.right, scope) : args[index], 'let');
      continue;
    }
    throw new ExpertCompileError('Function parameters must be identifiers or simple defaults', callNode || param);
  }
}

function installBuiltins(scope, interpreter) {
  scope.define('undefined', undefined, 'const');
  scope.define('Math', {
    PI: Math.PI,
    E: Math.E,
    abs: native('Math.abs', (value) => Math.abs(Number(value))),
    ceil: native('Math.ceil', (value) => Math.ceil(Number(value))),
    floor: native('Math.floor', (value) => Math.floor(Number(value))),
    max: native('Math.max', (...values) => Math.max(...values.map(Number))),
    min: native('Math.min', (...values) => Math.min(...values.map(Number))),
    pow: native('Math.pow', (base, exponent) => Math.pow(Number(base), Number(exponent))),
    round: native('Math.round', (value) => Math.round(Number(value))),
    sin: native('Math.sin', (value) => Math.sin(Number(value))),
    cos: native('Math.cos', (value) => Math.cos(Number(value))),
    tan: native('Math.tan', (value) => Math.tan(Number(value))),
    sqrt: native('Math.sqrt', (value) => Math.sqrt(Number(value)))
  }, 'const');
  scope.define('range', native('range', (...args) => rangeValues(args)), 'const');
  scope.define('random', native('random', () => interpreter.nextRandom()), 'const');
  scope.define('rand', native('rand', (min = 0, max = 1) => Number(min) + interpreter.nextRandom() * (Number(max) - Number(min))), 'const');
  scope.define('vec', {
    add: native('vec.add', (a, b) => vectorBinary(a, b, (left, right) => left + right)),
    sub: native('vec.sub', (a, b) => vectorBinary(a, b, (left, right) => left - right)),
    scale: native('vec.scale', (a, scale) => vectorMap(a, (value) => value * Number(scale))),
    mid: native('vec.mid', (a, b) => vectorBinary(a, b, (left, right) => (left + right) / 2)),
    lerp: native('vec.lerp', (a, b, amount) => vectorBinary(a, b, (left, right) => left + (right - left) * Number(amount)))
  }, 'const');
  scope.define('dsl', native('dsl', (operations, options = {}) => ({ version: 1, units: 'mm', ...options, operations })), 'const');
}

function native(name, fn) {
  return { [NATIVE]: true, name, fn };
}

function callFunction(callee, args, interpreter, node) {
  if (callee instanceof ExpertFunction) return callee.call(args, interpreter, node);
  if (callee?.[NATIVE]) return callee.fn(...args);
  throw new ExpertCompileError('Only Expert functions and built-in helpers can be called', node);
}

function callMember(object, property, args, interpreter, node) {
  assertSafeProperty(property, node);
  if (Array.isArray(object)) {
    if (property === 'push') {
      object.push(...args);
      return object.length;
    }
    if (property === 'map') {
      if (args.length !== 1 || !(args[0] instanceof ExpertFunction)) {
        throw new ExpertCompileError('Array.map requires one Expert function callback', node);
      }
      return object.map((value, index) => args[0].call([value, index, object], interpreter, node));
    }
    throw new ExpertCompileError(`Unsupported array method: ${property}`, node);
  }

  const member = getMember(object, property, node);
  return callFunction(member, args, interpreter, node);
}

function getMember(object, property, node) {
  assertSafeProperty(property, node);
  if (Array.isArray(object)) {
    if (property === 'length') return object.length;
    if (Number.isInteger(Number(property))) return object[Number(property)];
    if (property === 'push' || property === 'map') return native(`Array.${property}`, () => {
      throw new ExpertCompileError(`Array.${property} must be called as a method`, node);
    });
    throw new ExpertCompileError(`Unsupported array property: ${property}`, node);
  }
  if (typeof object === 'string') {
    if (property === 'length') return object.length;
    if (Number.isInteger(Number(property))) return object[Number(property)];
    throw new ExpertCompileError(`Unsupported string property: ${property}`, node);
  }
  if (!isPlainObject(object)) {
    throw new ExpertCompileError(`Member access is only supported on arrays, strings, and plain objects`, node);
  }
  return object[property];
}

function setMember(object, property, value, node) {
  assertSafeProperty(property, node);
  if (Array.isArray(object)) {
    const index = Number(property);
    if (!Number.isInteger(index) || index < 0) throw new ExpertCompileError('Array assignment requires a non-negative integer index', node);
    object[index] = value;
    return;
  }
  if (!isPlainObject(object)) {
    throw new ExpertCompileError('Member assignment is only supported on arrays and plain objects', node);
  }
  object[String(property)] = value;
}

function memberProperty(node, scope, interpreter) {
  const property = node.computed
    ? interpreter.evaluateExpression(node.property, scope)
    : node.property.name;
  assertSafeProperty(property, node.property);
  return String(property);
}

function assignmentValue(operator, current, evaluateRight, node) {
  if (operator === '=') return evaluateRight();
  const right = evaluateRight();
  switch (operator) {
    case '+=': return current + right;
    case '-=': return Number(current) - Number(right);
    case '*=': return Number(current) * Number(right);
    case '/=': return Number(current) / Number(right);
    case '%=': return Number(current) % Number(right);
    default:
      throw new ExpertCompileError(`Unsupported assignment operator: ${operator}`, node);
  }
}

function objectKey(node, property) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal') return node.value;
  throw new ExpertCompileError('Unsupported object key syntax', property);
}

function assertSafeProperty(property, node) {
  if (typeof property !== 'string' && typeof property !== 'number') {
    throw new ExpertCompileError('Property names must be strings or numbers', node);
  }
  if (DENIED_PROPERTIES.has(String(property))) {
    throw new ExpertCompileError(`Unsafe property is not allowed: ${property}`, node);
  }
}

function assertJsonCompatible(value, path) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw new ExpertCompileError(`${path} is not JSON-compatible`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new ExpertCompileError(`${path} must be a finite number`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonCompatible(entry, `${path}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      assertJsonCompatible(entry, `${path}.${key}`);
    }
    return;
  }
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
    throw new ExpertCompileError(`${path} is not JSON-compatible`);
  }
}

function rangeValues(args) {
  let start = 0;
  let end;
  let step = 1;
  if (args.length === 1) {
    end = Number(args[0]);
  } else if (args.length === 2) {
    start = Number(args[0]);
    end = Number(args[1]);
  } else if (args.length === 3) {
    start = Number(args[0]);
    end = Number(args[1]);
    step = Number(args[2]);
  } else {
    throw new ExpertCompileError('range expects 1 to 3 numeric arguments');
  }
  if (![start, end, step].every(Number.isFinite) || step === 0) {
    throw new ExpertCompileError('range arguments must be finite and step must not be 0');
  }
  const values = [];
  if (step > 0) {
    for (let value = start; value < end; value += step) values.push(value);
  } else {
    for (let value = start; value > end; value += step) values.push(value);
  }
  return values;
}

function vectorBinary(a, b, fn) {
  const left = assertVector(a);
  const right = assertVector(b);
  return left.map((value, index) => fn(value, right[index]));
}

function vectorMap(vector, fn) {
  return assertVector(vector).map(fn);
}

function assertVector(value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((entry) => Number.isFinite(Number(entry)))) {
    throw new ExpertCompileError('Vector helpers require [x, y, z] numeric arrays');
  }
  return value.map(Number);
}

function normalizeSeed(seed) {
  const parsed = Number(seed);
  if (!Number.isFinite(parsed)) return 1;
  return (Math.abs(Math.trunc(parsed)) || 1) >>> 0;
}

function truthy(value) {
  return Boolean(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
