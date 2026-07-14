import { spawnSync } from 'node:child_process';
import { validateExpertDocument } from './expert-compiler.mjs';

const COMPILER_VERSION = 'python-sdk-facade-compiler-0.1.0';

const DEFAULT_LIMITS = Object.freeze({
  maxOperations: 2000,
  maxLoopIterations: 10000,
  maxFunctionDepth: 100,
  maxStatements: 20000,
  maxOutputBytes: 1000000,
  timeoutMs: 5000
});

const PYTHON_AST_EXPORTER = `
import ast
import json
import sys

source = sys.stdin.read()
tree = ast.parse(source, mode="exec")

def convert(value):
    if isinstance(value, ast.AST):
        result = {"_type": value.__class__.__name__}
        if hasattr(value, "lineno"):
            result["_lineno"] = value.lineno
        if hasattr(value, "col_offset"):
            result["_col_offset"] = value.col_offset
        for field in value._fields:
            result[field] = convert(getattr(value, field))
        return result
    if isinstance(value, list):
        return [convert(item) for item in value]
    if isinstance(value, tuple):
        return [convert(item) for item in value]
    return value

print(json.dumps(convert(tree), separators=(",", ":")))
`;

export class PythonSdkCompileError extends Error {
  constructor(message, node) {
    const location = node?._lineno ? ` at line ${node._lineno}` : '';
    super(`${message}${location}`);
    this.name = 'PythonSdkCompileError';
    this.node = node;
  }
}

export function compilePythonSdkScript(source, options = {}) {
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new PythonSdkCompileError('compile_python_sdk requires a non-empty Python script string');
  }
  const limits = normalizeLimits(options);
  const ast = parsePythonAst(source, {
    timeoutMs: limits.timeoutMs,
    pythonCommand: options.pythonCommand
  });
  const interpreter = new PythonSdkInterpreter({ limits });
  interpreter.executeModule(ast);
  const document = interpreter.model.toDocument();
  validateExpertDocument(document, {
    maxOperations: limits.maxOperations,
    maxOutputBytes: limits.maxOutputBytes
  });
  const hasResult = interpreter.scope.has('result');
  const result = hasResult
    ? toJsonCompatible(interpreter.scope.get('result'), 'result')
    : undefined;
  return {
    code: `${JSON.stringify(document, null, 2)}\n`,
    document,
    python_sdk: {
      compiler_version: COMPILER_VERSION,
      facade_version: 'official-api-parity-p0',
      input_language: 'restricted_python_ast',
      source_units: interpreter.model.units,
      dsl_units: 'mm',
      operations: document.operations.length,
      facade_objects: interpreter.facadeObjects,
      safety: {
        executed_python: false,
        parser: 'python_ast_only',
        blocked_runtime_access: true
      }
    },
    ...(hasResult ? { result } : {})
  };
}

function parsePythonAst(source, { timeoutMs, pythonCommand } = {}) {
  const preferred = pythonCommand || process.env.ALMA_SKETCHUP_PYTHON || 'python3';
  const attempts = preferred === 'python3' ? ['python3', 'python'] : [preferred];
  let lastError = null;
  for (const command of attempts) {
    const result = spawnSync(command, ['-c', PYTHON_AST_EXPORTER], {
      input: source,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024
    });
    if (result.error) {
      lastError = result.error;
      if (result.error.code === 'ENOENT') continue;
      throw new PythonSdkCompileError(`Python AST parser failed: ${result.error.message}`);
    }
    if (result.status !== 0) {
      const message = (result.stderr || result.stdout || '').trim() || `exit status ${result.status}`;
      throw new PythonSdkCompileError(`Python SDK facade syntax error: ${message}`);
    }
    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      throw new PythonSdkCompileError(`Python AST parser returned invalid JSON: ${error.message}`);
    }
  }
  throw new PythonSdkCompileError(`Python AST parser is not available: ${lastError?.message || attempts.join(', ')}`);
}

class PythonSdkInterpreter {
  constructor({ limits }) {
    this.limits = limits;
    this.statements = 0;
    this.loopIterations = 0;
    this.functionDepth = 0;
    this.scope = new PythonScope();
    this.facadeObjectSet = new Set();
    this.model = new SdkModel(this.facadeObjectSet);
    this.scope.set('model', this.model);
    for (const name of [
      'SUPoint2D',
      'SUPoint3D',
      'SUVector',
      'SUVector3D',
      'SUColor',
      'SUTransformation',
      'Material',
      'LoopInput',
      'GeometryInput',
      'Group',
      'Face',
      'Edge',
      'Loop',
      'ComponentDefinition',
      'ComponentInstance',
      'Camera',
      'Scene',
      'Style',
      'ShadowInfo',
      'RenderingOptions',
      'Layer',
      'Texture',
      'Image',
      'ImageRep',
      'PolygonMesh',
      'Curve',
      'ArcCurve',
      'Entities',
      'Materials',
      'Layers',
      'Pages',
      'Selection'
    ]) {
      this.scope.set(name, new SdkClassRef(name));
    }
  }

  get facadeObjects() {
    return [...this.facadeObjectSet].sort();
  }

  executeModule(node) {
    if (node?._type !== 'Module') throw new PythonSdkCompileError('Python SDK source must parse as a module', node);
    for (const statement of node.body || []) this.executeStatement(statement);
  }

  executeStatement(node) {
    this.countStatement(node);
    switch (node._type) {
      case 'Assign': {
        if ((node.targets || []).length !== 1) throw new PythonSdkCompileError('Multiple assignment targets are not supported', node);
        const value = this.evaluate(node.value);
        this.assign(node.targets[0], value);
        return;
      }
      case 'AnnAssign': {
        const value = node.value ? this.evaluate(node.value) : null;
        this.assign(node.target, value);
        return;
      }
      case 'AugAssign': {
        const current = this.evaluate(node.target);
        const value = this.applyBinaryOperator(node.op, current, this.evaluate(node.value), node);
        this.assign(node.target, value);
        return;
      }
      case 'Expr':
        this.evaluate(node.value);
        return;
      case 'For':
        this.executeFor(node);
        return;
      case 'If':
        this.executeBlock(this.truthy(this.evaluate(node.test)) ? node.body : node.orelse);
        return;
      case 'FunctionDef':
        this.defineFunction(node);
        return;
      case 'Return':
        if (this.functionDepth < 1) throw new PythonSdkCompileError('return is only supported inside restricted helper functions', node);
        throw new PythonReturnSignal(node.value ? this.evaluate(node.value) : null);
      case 'Pass':
        return;
      default:
        throw new PythonSdkCompileError(`Unsupported Python statement: ${node._type}`, node);
    }
  }

  defineFunction(node) {
    if (this.functionDepth > 0) {
      throw new PythonSdkCompileError('Nested helper functions are not supported in Python SDK facade', node);
    }
    if (node.decorator_list?.length) {
      throw new PythonSdkCompileError('Decorators are not supported in Python SDK facade helper functions', node);
    }
    this.scope.set(node.name, new SdkUserFunction(node.name, node, this.scope));
  }

  executeFor(node) {
    const iterable = normalizeIterable(this.evaluate(node.iter), node.iter);
    for (const item of iterable) {
      this.countLoopIteration(node);
      this.assign(node.target, item);
      this.executeBlock(node.body || []);
    }
    if (node.orelse?.length) this.executeBlock(node.orelse);
  }

  executeBlock(body = []) {
    for (const statement of body) this.executeStatement(statement);
  }

  assign(target, value) {
    switch (target?._type) {
      case 'Name':
        this.scope.set(target.id, value);
        return;
      case 'Attribute': {
        const object = this.evaluate(target.value);
        this.assignAttribute(object, target.attr, value, target);
        return;
      }
      case 'Subscript': {
        const object = this.evaluate(target.value);
        const key = this.evaluate(target.slice);
        assignSubscriptValue(object, key, value, target);
        return;
      }
      case 'List':
      case 'Tuple': {
        if (!Array.isArray(value)) throw new PythonSdkCompileError('Destructuring assignment expects a tuple/list value', target);
        if ((target.elts || []).length !== value.length) throw new PythonSdkCompileError('Destructuring assignment length mismatch', target);
        for (let index = 0; index < target.elts.length; index += 1) this.assign(target.elts[index], value[index]);
        return;
      }
      default:
        throw new PythonSdkCompileError('Unsupported assignment target', target);
    }
  }

  assignAttribute(object, property, value, node) {
    if (object instanceof SdkModel && property === 'units') {
      object.setUnits(value);
      return;
    }
    if (object instanceof SdkEntityRef || object instanceof SdkGroup || object instanceof SdkComponentInstance) {
      object.assign(property, value, node);
      return;
    }
    if (object instanceof SdkComponentDefinition && ['name', 'description'].includes(property)) {
      object[property] = value;
      return;
    }
    if (object instanceof SdkScene && ['name', 'camera', 'transition_time', 'transitionTime', 'use_camera', 'useCamera', 'style'].includes(property)) {
      if (property === 'transitionTime') object.transition_time = value;
      else if (property === 'useCamera') object.use_camera = Boolean(value);
      else if (property === 'use_camera') object.use_camera = Boolean(value);
      else if (property === 'style') object.style = value instanceof SdkStyle ? value : object.style;
      else object[property] = value;
      return;
    }
    if (object instanceof SdkMaterial && ['color', 'alpha', 'texture', 'workflow', 'pbr'].includes(property)) {
      object[property] = value;
      return;
    }
    if (object instanceof SdkLayer && ['name', 'color', 'visible'].includes(property)) {
      object[property] = property === 'visible' ? Boolean(value) : value;
      return;
    }
    if (isFacadeOptionsObject(object)) {
      object.options[property] = facadePlainValue(value);
      return;
    }
    if (object instanceof SdkFaceInput && ['material', 'back_material', 'backMaterial', 'reversed', 'metadata'].includes(property)) {
      if (property === 'backMaterial') object.back_material = materialName(value);
      else if (property === 'back_material') object.back_material = materialName(value);
      else if (property === 'material') object.material = materialName(value);
      else if (property === 'reversed') object.reversed = Boolean(value);
      else object.metadata = value && typeof value === 'object' ? structuredClone(value) : null;
      return;
    }
    throw new PythonSdkCompileError(`Unsupported attribute assignment: ${property}`, node);
  }

  evaluate(node) {
    this.countStatement(node);
    switch (node?._type) {
      case 'Constant':
        return node.value;
      case 'Name':
        return this.scope.get(node.id, node);
      case 'List':
      case 'Tuple':
        return (node.elts || []).map((item) => this.evaluate(item));
      case 'ListComp':
        return this.evaluateComprehension(node, 'list');
      case 'DictComp':
        return this.evaluateComprehension(node, 'dict');
      case 'Dict': {
        const object = {};
        for (let index = 0; index < (node.keys || []).length; index += 1) {
          if (!node.keys[index]) throw new PythonSdkCompileError('Dict unpacking is not supported in Python SDK facade', node);
          const key = this.evaluate(node.keys[index]);
          object[key] = this.evaluate(node.values[index]);
        }
        return object;
      }
      case 'UnaryOp':
        return this.applyUnaryOperator(node.op, this.evaluate(node.operand), node);
      case 'BinOp':
        return this.applyBinaryOperator(node.op, this.evaluate(node.left), this.evaluate(node.right), node);
      case 'BoolOp':
        return this.evaluateBoolean(node);
      case 'Compare':
        return this.evaluateCompare(node);
      case 'IfExp':
        return this.truthy(this.evaluate(node.test)) ? this.evaluate(node.body) : this.evaluate(node.orelse);
      case 'Subscript': {
        const object = this.evaluate(node.value);
        const key = this.evaluate(node.slice);
        return subscriptValue(object, key, node);
      }
      case 'Slice': {
        const lower = node.lower ? this.evaluate(node.lower) : undefined;
        const upper = node.upper ? this.evaluate(node.upper) : undefined;
        const step = node.step ? this.evaluate(node.step) : undefined;
        return { __slice: true, lower, upper, step };
      }
      case 'Attribute':
        return this.getAttribute(this.evaluate(node.value), node.attr, node);
      case 'Call':
        return this.evaluateCall(node);
      default:
        throw new PythonSdkCompileError(`Unsupported Python expression: ${node?._type}`, node);
    }
  }

  evaluateComprehension(node, kind) {
    const output = kind === 'dict' ? {} : [];
    const previousScope = this.scope;
    this.scope = new PythonScope(previousScope);
    try {
      this.evaluateComprehensionGenerator(node, 0, () => {
        if (kind === 'dict') {
          const key = this.evaluate(node.key);
          output[key] = this.evaluate(node.value);
        } else {
          output.push(this.evaluate(node.elt));
        }
      });
      return output;
    } finally {
      this.scope = previousScope;
    }
  }

  evaluateComprehensionGenerator(node, index, emit) {
    const generator = node.generators?.[index];
    if (!generator) {
      emit();
      return;
    }
    if (generator.is_async) throw new PythonSdkCompileError('Async comprehensions are not supported in Python SDK facade', generator);
    const iterable = normalizeIterable(this.evaluate(generator.iter), generator.iter);
    for (const item of iterable) {
      this.countLoopIteration(generator);
      this.assign(generator.target, item);
      if ((generator.ifs || []).every((condition) => this.truthy(this.evaluate(condition)))) {
        this.evaluateComprehensionGenerator(node, index + 1, emit);
      }
    }
  }

  evaluateCall(node) {
    const args = (node.args || []).map((arg) => this.evaluate(arg));
    const kwargs = {};
    for (const keyword of node.keywords || []) {
      if (!keyword.arg) throw new PythonSdkCompileError('**kwargs are not supported in Python SDK facade', keyword);
      kwargs[keyword.arg] = this.evaluate(keyword.value);
    }
    if (node.func?._type === 'Name') {
      return this.callName(node.func.id, args, kwargs, node);
    }
    if (node.func?._type === 'Attribute') {
      const object = this.evaluate(node.func.value);
      return this.callMethod(object, node.func.attr, args, kwargs, node);
    }
    throw new PythonSdkCompileError('Unsupported callable expression', node.func);
  }

  callName(name, args, kwargs, node) {
    if (this.scope.has(name)) {
      const value = this.scope.get(name, node);
      if (value instanceof SdkClassRef) return this.construct(name, args, kwargs, node);
      if (value instanceof SdkUserFunction) return value.invoke(this, args, kwargs, node);
    }
    switch (name) {
      case 'range':
        return makeRange(args, node);
      case 'enumerate':
        return makeEnumerate(args, node);
      case 'zip':
        return makeZip(args, node);
      case 'len':
        return collectionLength(args[0]);
      case 'list':
        return args.length ? [...normalizeIterable(args[0], node)] : [];
      case 'tuple':
        return args.length ? [...normalizeIterable(args[0], node)] : [];
      case 'dict':
        return makeDict(args, kwargs, node);
      case 'str':
        return String(args[0] ?? '');
      case 'int':
        return Math.trunc(Number(args[0] ?? 0));
      case 'float':
        return Number(args[0] ?? 0);
      case 'bool':
        return this.truthy(args[0]);
      case 'min':
        return Math.min(...args);
      case 'max':
        return Math.max(...args);
      case 'abs':
        return Math.abs(Number(args[0]));
      case 'round':
        return roundNumber(args[0], args[1] ?? 0);
      case 'sum':
        return normalizeIterable(args[0] ?? [], node).reduce((total, value) => total + Number(value), Number(args[1] ?? 0));
      case 'sorted':
        return [...normalizeIterable(args[0] ?? [], node)].sort(compareSortableValues);
      case 'reversed':
        return [...normalizeIterable(args[0] ?? [], node)].reverse();
      case 'all':
        return normalizeIterable(args[0] ?? [], node).every((item) => this.truthy(item));
      case 'any':
        return normalizeIterable(args[0] ?? [], node).some((item) => this.truthy(item));
      default:
        throw new PythonSdkCompileError(`Unsupported Python SDK function: ${name}`, node);
    }
  }

  invokeUserFunction(functionRef, localScope, node) {
    if (this.functionDepth >= this.limits.maxFunctionDepth) {
      throw new PythonSdkCompileError(`Python SDK helper function depth exceeded: max ${this.limits.maxFunctionDepth}`, node);
    }
    const previousScope = this.scope;
    this.scope = localScope;
    this.functionDepth += 1;
    try {
      this.executeBlock(functionRef.body);
      return null;
    } catch (error) {
      if (error instanceof PythonReturnSignal) return error.value;
      throw error;
    } finally {
      this.functionDepth -= 1;
      this.scope = previousScope;
    }
  }

  evaluateInScope(scope, node) {
    const previousScope = this.scope;
    this.scope = scope;
    try {
      return this.evaluate(node);
    } finally {
      this.scope = previousScope;
    }
  }

  construct(name, args, kwargs, node) {
    this.facadeObjectSet.add(name);
    switch (name) {
      case 'SUPoint2D':
        return new SdkPoint(args.length === 1 ? args[0] : args, 2, name, node);
      case 'SUPoint3D':
      case 'SUVector':
      case 'SUVector3D':
        return new SdkPoint(args.length === 1 ? args[0] : args, 3, name, node);
      case 'SUColor':
        return new SdkColor(args, kwargs, node);
      case 'SUTransformation':
        return new SdkTransformation(args, kwargs, node);
      case 'Material':
        return new SdkMaterial(args, kwargs, node);
      case 'LoopInput':
        return new SdkLoopInput(args, kwargs, node);
      case 'GeometryInput':
        return new SdkGeometryInput(args, kwargs, node, this.facadeObjectSet);
      case 'Group':
        return new SdkGroup(args, kwargs, node, this.model, this.facadeObjectSet);
      case 'ComponentDefinition':
        return new SdkComponentDefinition(args, kwargs, node, this.model, this.facadeObjectSet);
      case 'ComponentInstance':
        return new SdkComponentInstance(args, kwargs, node);
      case 'Camera':
        return new SdkCamera(args, kwargs, node);
      case 'Scene':
        return new SdkScene(args, kwargs, node);
      case 'Style':
        return new SdkStyle(args, kwargs);
      case 'ShadowInfo':
        return new SdkShadowInfo(args, kwargs);
      case 'RenderingOptions':
        return new SdkRenderingOptions(args, kwargs);
      case 'Layer':
        return new SdkLayer(args, kwargs, node);
      case 'Texture':
        return new SdkTexture(args, kwargs, node);
      case 'Image':
        return new SdkImageReference(args, kwargs, node, 'Image');
      case 'ImageRep':
        return new SdkImageReference(args, kwargs, node, 'ImageRep');
      case 'PolygonMesh':
        return new SdkPolygonMesh(args, kwargs, node);
      case 'Curve':
        return new SdkCurve(args, kwargs, node);
      case 'ArcCurve':
        return new SdkArcCurve(args, kwargs, node);
      case 'Face':
      case 'Edge':
      case 'Loop':
        throw new PythonSdkCompileError(`${name} facade objects are returned by GeometryInput; direct construction is not supported`, node);
      default:
        throw new PythonSdkCompileError(`Unsupported SDK class: ${name}`, node);
    }
  }

  callMethod(object, method, args, kwargs, node) {
    if (object instanceof SdkClassRef && object.name === 'SUTransformation') {
      this.facadeObjectSet.add('SUTransformation');
      return SdkTransformation.staticMethod(method, args, kwargs, node);
    }
    if (object instanceof SdkClassRef && ['RenderingOptions', 'ShadowInfo'].includes(object.name)) {
      this.facadeObjectSet.add(object.name);
      return facadeOptionsStaticMethod(object.name, method, node);
    }
    if (Array.isArray(object)) return callArrayMethod(object, method, args, node);
    if (object instanceof SdkCollectionProxy) return object.call(method, args, kwargs, node);
    if (object instanceof SdkEntitiesProxy) return object.call(method, args, kwargs, node);
    if (object instanceof SdkSelectionProxy) return object.call(method, args, kwargs, node);
    if (object instanceof SdkViewFacade) return object.call(method, args, kwargs, node);
    if (object instanceof SdkEntityRef) return object.call(method, args, kwargs, node);
    if (object instanceof SdkModel) return object.call(method, args, kwargs, node);
    if (object instanceof SdkGeometryInput) return object.call(method, args, kwargs, node);
    if (object instanceof SdkPolygonMesh) return object.call(method, args, kwargs, node);
    if (object instanceof SdkFaceInput) return object.call(method, args, kwargs, node);
    if (object instanceof SdkLoopRef) return object.call(method, args, kwargs, node);
    if (object instanceof SdkEdgeRef) return object.call(method, args, kwargs, node);
    if (object instanceof SdkComponentDefinition) return object.call(method, args, kwargs, node);
    if (object instanceof SdkComponentInstance) return object.call(method, args, kwargs, node);
    if (object instanceof SdkGroup) return object.call(method, args, kwargs, node);
    if (object instanceof SdkCamera) return object.call(method, args, kwargs, node);
    if (object instanceof SdkScene) return object.call(method, args, kwargs, node);
    if (object instanceof SdkTransformation) return object.call(method, args, kwargs, node);
    if (isFacadeOptionsObject(object)) return object.call(method, args, kwargs, node);
    if (isPlainObject(object)) return callDictMethod(object, method, args, node);
    throw new PythonSdkCompileError(`Unsupported method call: ${method}`, node);
  }

  getAttribute(object, property, node) {
    if (object instanceof SdkClassRef) return object;
    if (object instanceof SdkModel) return object.get(property, node);
    if (object instanceof SdkCollectionProxy || object instanceof SdkEntitiesProxy || object instanceof SdkSelectionProxy || object instanceof SdkViewFacade) {
      return object.get(property, node);
    }
    if (object instanceof SdkEntityRef) return object.get(property, node);
    if (object && typeof object === 'object' && property in object) return object[property];
    throw new PythonSdkCompileError(`Unsupported attribute access: ${property}`, node);
  }

  applyUnaryOperator(operator, value, node) {
    switch (operator?._type) {
      case 'USub':
        return -Number(value);
      case 'UAdd':
        return Number(value);
      case 'Not':
        return !this.truthy(value);
      default:
        throw new PythonSdkCompileError(`Unsupported unary operator: ${operator?._type}`, node);
    }
  }

  applyBinaryOperator(operator, left, right, node) {
    switch (operator?._type) {
      case 'Add':
        return typeof left === 'string' || typeof right === 'string' ? `${left}${right}` : Number(left) + Number(right);
      case 'Sub':
        return Number(left) - Number(right);
      case 'Mult':
        return Number(left) * Number(right);
      case 'Div':
        return Number(left) / Number(right);
      case 'FloorDiv':
        return Math.floor(Number(left) / Number(right));
      case 'Mod':
        return Number(left) % Number(right);
      case 'Pow':
        return Number(left) ** Number(right);
      default:
        throw new PythonSdkCompileError(`Unsupported binary operator: ${operator?._type}`, node);
    }
  }

  evaluateBoolean(node) {
    if (node.op?._type === 'And') {
      for (const valueNode of node.values || []) {
        const value = this.evaluate(valueNode);
        if (!this.truthy(value)) return value;
      }
      return this.evaluate(node.values[node.values.length - 1]);
    }
    if (node.op?._type === 'Or') {
      for (const valueNode of node.values || []) {
        const value = this.evaluate(valueNode);
        if (this.truthy(value)) return value;
      }
      return this.evaluate(node.values[node.values.length - 1]);
    }
    throw new PythonSdkCompileError(`Unsupported boolean operator: ${node.op?._type}`, node);
  }

  evaluateCompare(node) {
    let left = this.evaluate(node.left);
    for (let index = 0; index < (node.ops || []).length; index += 1) {
      const right = this.evaluate(node.comparators[index]);
      if (!compareValues(node.ops[index]?._type, left, right)) return false;
      left = right;
    }
    return true;
  }

  truthy(value) {
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value);
  }

  countStatement(node) {
    this.statements += 1;
    if (this.statements > this.limits.maxStatements) {
      throw new PythonSdkCompileError(`Python SDK statement limit exceeded: max ${this.limits.maxStatements}`, node);
    }
  }

  countLoopIteration(node) {
    this.loopIterations += 1;
    if (this.loopIterations > this.limits.maxLoopIterations) {
      throw new PythonSdkCompileError(`Python SDK loop limit exceeded: max ${this.limits.maxLoopIterations}`, node);
    }
  }
}

class PythonScope {
  constructor(parent = null) {
    this.parent = parent;
    this.bindings = new Map();
  }

  set(name, value) {
    this.bindings.set(name, value);
  }

  get(name, node) {
    if (this.bindings.has(name)) return this.bindings.get(name);
    if (this.parent) return this.parent.get(name, node);
    throw new PythonSdkCompileError(`Unknown Python SDK identifier: ${name}`, node);
  }

  has(name) {
    return this.bindings.has(name) || Boolean(this.parent?.has(name));
  }
}

class PythonReturnSignal extends Error {
  constructor(value) {
    super('Python SDK helper function returned');
    this.name = 'PythonReturnSignal';
    this.value = value;
  }
}

class SdkClassRef {
  constructor(name) {
    this.name = name;
  }
}

class SdkUserFunction {
  constructor(name, node, definitionScope) {
    this.name = name;
    this.node = node;
    this.body = node.body || [];
    this.definitionScope = definitionScope;
    this.parameters = [
      ...(node.args?.posonlyargs || []),
      ...(node.args?.args || [])
    ].map((parameter) => parameter.arg);
    this.defaults = node.args?.defaults || [];
    if (node.args?.vararg || node.args?.kwarg || node.args?.kwonlyargs?.length) {
      throw new PythonSdkCompileError('Helper functions support positional, keyword, and default parameters only', node);
    }
    if (new Set(this.parameters).size !== this.parameters.length) {
      throw new PythonSdkCompileError(`Duplicate helper function parameter in ${name}`, node);
    }
  }

  invoke(interpreter, args, kwargs, callNode) {
    if (args.length > this.parameters.length) {
      throw new PythonSdkCompileError(`${this.name} expected at most ${this.parameters.length} arguments`, callNode);
    }
    for (const key of Object.keys(kwargs)) {
      if (!this.parameters.includes(key)) {
        throw new PythonSdkCompileError(`${this.name} got unexpected keyword argument ${key}`, callNode);
      }
    }
    const remainingKwargs = { ...kwargs };
    const localScope = new PythonScope(this.definitionScope);
    const defaultOffset = this.parameters.length - this.defaults.length;
    for (let index = 0; index < this.parameters.length; index += 1) {
      const parameter = this.parameters[index];
      let value;
      if (index < args.length) {
        if (Object.prototype.hasOwnProperty.call(remainingKwargs, parameter)) {
          throw new PythonSdkCompileError(`${this.name} got multiple values for argument ${parameter}`, callNode);
        }
        value = args[index];
      } else if (Object.prototype.hasOwnProperty.call(remainingKwargs, parameter)) {
        value = remainingKwargs[parameter];
        delete remainingKwargs[parameter];
      } else if (index >= defaultOffset) {
        value = interpreter.evaluateInScope(this.definitionScope, this.defaults[index - defaultOffset]);
      } else {
        throw new PythonSdkCompileError(`${this.name} missing required argument ${parameter}`, callNode);
      }
      localScope.set(parameter, value);
    }
    const unknown = Object.keys(remainingKwargs);
    if (unknown.length) {
      throw new PythonSdkCompileError(`${this.name} got unexpected keyword argument ${unknown[0]}`, callNode);
    }
    return interpreter.invokeUserFunction(this, localScope, callNode);
  }
}

class SdkCollectionProxy {
  constructor(owner, name) {
    this.owner = owner;
    this.name = name;
    this.items = [];
  }

  remember(item) {
    if (!this.items.includes(item)) this.items.push(item);
    return item;
  }

  get length() {
    return this.items.length;
  }

  get(property, node) {
    if (['length', 'count', 'size'].includes(property)) return this.items.length;
    if (property === 'names' || property === 'keys') return this.items.map((item) => item.name);
    throw new PythonSdkCompileError(`Unsupported ${this.name} attribute: ${property}`, node);
  }

  getItem(key) {
    if (Number.isInteger(Number(key))) return this.items[normalizeIndex(key, this.items.length)];
    return this.items.find((item) => item.name === key) || null;
  }

  call(method, args, kwargs, node) {
    if (['count', 'length', 'size'].includes(method)) return this.items.length;
    if (method === 'each' || method === 'to_a' || method === 'values') return [...this.items];
    if (method === 'keys') return this.items.map((item) => item.name);
    if (method === 'unique_name') return this.uniqueName(args[0] ?? kwargs.base ?? kwargs.name ?? 'Item');
    if (this.name === 'materials' && method === 'add') return this.owner.addMaterial(args[0], kwargs, node);
    if (this.name === 'layers' && method === 'add') return this.owner.addLayer(args, kwargs, node);
    if (this.name === 'definitions' && method === 'add') {
      return this.owner.addComponentDefinition([new SdkComponentDefinition(args, kwargs, node, this.owner, this.owner.facadeObjectSet)], {}, node);
    }
    if (this.name === 'pages' && method === 'add') return this.owner.addScene(args, kwargs, node);
    throw new PythonSdkCompileError(`Unsupported model.${this.name}.${method} call`, node);
  }

  uniqueName(base) {
    const stem = String(base || 'Item');
    if (!this.items.some((item) => item.name === stem)) return stem;
    let index = 1;
    while (this.items.some((item) => item.name === `${stem}_${index}`)) index += 1;
    return `${stem}_${index}`;
  }
}

class SdkEntitiesProxy {
  constructor(owner, model, facadeObjectSet, label) {
    this.owner = owner;
    this.model = model;
    this.facadeObjectSet = facadeObjectSet;
    this.label = label;
    this.items = [];
    this.autoIndex = 0;
  }

  get(property, node) {
    if (['length', 'count', 'size'].includes(property)) return this.items.length;
    throw new PythonSdkCompileError(`Unsupported ${this.label} attribute: ${property}`, node);
  }

  call(method, args, kwargs, node) {
    switch (method) {
      case 'add_face':
        return this.addFace(args, kwargs, node);
      case 'add_edges':
        return this.addEdges(args, kwargs, node);
      case 'add_line':
        return this.addLine(args, kwargs, node);
      case 'add_curve':
        return this.addCurve(args, kwargs, node);
      case 'add_arc':
      case 'add_arc_curve':
        return this.addArc(args, kwargs, node);
      case 'add_circle':
        return this.addCircle(args, kwargs, node);
      case 'add_group':
        return this.addGroup(args, kwargs, node);
      case 'add_instance':
        return this.addInstance(args, kwargs, node);
      case 'add_3d_text':
        return this.add3dText(args, kwargs, node);
      case 'add_faces_from_mesh':
        return this.addFacesFromMesh(args, kwargs, node);
      case 'fill_from_mesh':
        return this.fillFromMesh(args, kwargs, node);
      case 'count':
      case 'length':
      case 'size':
        return this.items.length;
      case 'each':
      case 'to_a':
        return [...this.items];
      default:
        throw new PythonSdkCompileError(`Unsupported ${this.label}.${method} call`, node);
    }
  }

  addFace(args, kwargs, node) {
    this.facadeObjectSet.add('Entities');
    this.facadeObjectSet.add('Face');
    const geometry = this.targetGeometry(args, kwargs, node, 'Face');
    const face = geometry.addFace(args[0] ?? kwargs.outer ?? kwargs.points, kwargs, node);
    this.registerGeometry(geometry);
    return face;
  }

  addEdges(args, kwargs, node) {
    const points = args[0] ?? kwargs.points ?? kwargs.vertices;
    if (!Array.isArray(points) || points.length < 2) throw new PythonSdkCompileError('Entities.add_edges expects at least two points', node);
    const geometry = this.targetGeometry([], kwargs, node, 'Edges');
    const edges = [];
    for (let index = 0; index < points.length - 1; index += 1) edges.push(geometry.addEdge(points[index], points[index + 1], node));
    this.registerGeometry(geometry);
    return edges;
  }

  addLine(args, kwargs, node) {
    const geometry = this.targetGeometry([], kwargs, node, 'Line');
    const edge = geometry.addEdge(args[0] ?? kwargs.start, args[1] ?? kwargs.end, node);
    this.registerGeometry(geometry);
    return edge;
  }

  addCurve(args, kwargs, node) {
    const curve = args[0] instanceof SdkCurve
      ? args[0]
      : new SdkCurve([kwargs.name ?? this.autoName('Curve'), args[0] ?? kwargs.points ?? kwargs.vertices], kwargs, node);
    this.addOperation(curve);
    this.items.push(curve);
    return curve;
  }

  addArc(args, kwargs, node) {
    const arc = args[0] instanceof SdkArcCurve
      ? args[0]
      : new SdkArcCurve([
        kwargs.name ?? this.autoName('Arc'),
        args[0] ?? kwargs.center,
        kwargs.radius ?? args[3] ?? args[2] ?? args[1],
        args[4] ?? kwargs.start_angle ?? kwargs.startAngle ?? 0,
        args[5] ?? kwargs.end_angle ?? kwargs.endAngle ?? 360,
        args[6] ?? kwargs.segments ?? kwargs.num_segments ?? 16
      ], kwargs, node);
    this.addOperation(arc);
    this.items.push(arc);
    return arc;
  }

  addCircle(args, kwargs, node) {
    return this.addArc(args, { ...kwargs, start_angle: 0, end_angle: 360, name: kwargs.name ?? this.autoName('Circle') }, node);
  }

  addGroup(args, kwargs, node) {
    const group = args[0] instanceof SdkGroup
      ? args[0]
      : new SdkGroup([args[0] ?? kwargs.name ?? this.autoName('Group')], kwargs, node, this.model, this.facadeObjectSet);
    this.addOperation(group);
    this.items.push(group);
    return group;
  }

  addInstance(args, kwargs, node) {
    this.facadeObjectSet.add('ComponentInstance');
    const instance = new SdkComponentInstance([
      kwargs.name ?? args[2] ?? this.autoName('Instance'),
      args[0] ?? kwargs.definition,
      kwargs.origin ?? args[1]
    ], kwargs, node);
    this.addOperation(instance);
    this.items.push(instance);
    return instance;
  }

  add3dText(args, kwargs, node) {
    const text = requiredString(args[0] ?? kwargs.text, '3d text', node);
    const name = kwargs.name ?? this.autoName('Text3D');
    const operation = {
      op: 'text_3d',
      name,
      text,
      height: scaleNumber(kwargs.height ?? args[1] ?? 1, this.model.unitScale, `${name}.height`, node),
      ...(kwargs.extrusion !== undefined || kwargs.depth !== undefined ? { extrusion: scaleNumber(kwargs.extrusion ?? kwargs.depth, this.model.unitScale, `${name}.extrusion`, node) } : {}),
      ...(kwargs.font !== undefined ? { font: kwargs.font } : {}),
      ...(kwargs.align !== undefined ? { align: kwargs.align } : {}),
      ...(kwargs.bold !== undefined ? { bold: Boolean(kwargs.bold) } : {}),
      ...(kwargs.italic !== undefined ? { italic: Boolean(kwargs.italic) } : {}),
      ...(kwargs.filled !== undefined ? { filled: Boolean(kwargs.filled) } : {}),
      ...normalizeObjectOptions(kwargs, this.model)
    };
    this.addOperation(operation);
    const ref = new SdkEntityRef(this.model, operation);
    this.items.push(ref);
    return ref;
  }

  addFacesFromMesh(args, kwargs, node) {
    const mesh = meshOperationFromFacade(args[0] ?? kwargs.mesh ?? kwargs.polygon_mesh, kwargs, this.model, node, kwargs.name ?? this.autoName('Mesh'));
    this.addOperation(mesh);
    this.items.push(mesh);
    return mesh.faces.length;
  }

  fillFromMesh(args, kwargs, node) {
    const mesh = meshOperationFromFacade(args[0] ?? kwargs.mesh ?? kwargs.polygon_mesh, kwargs, this.model, node, kwargs.name ?? this.autoName('FilledMesh'));
    this.addOperation(mesh);
    this.items.push(mesh);
    return true;
  }

  targetGeometry(_args, kwargs, node, suffix) {
    if (this.owner instanceof SdkGroup) return this.owner.ensureGeometry(node);
    const name = kwargs.name ?? kwargs.group_name ?? kwargs.groupName ?? this.autoName(suffix);
    return new SdkGeometryInput([name], kwargs, node, this.facadeObjectSet);
  }

  registerGeometry(geometry) {
    if (this.owner instanceof SdkGroup) return geometry;
    this.addOperation(geometry);
    const ref = new SdkEntityRef(this.model, geometry);
    this.items.push(ref);
    return ref;
  }

  addOperation(operation) {
    if (this.owner instanceof SdkModel) this.owner.operations.push(operation);
    else if (this.owner instanceof SdkComponentDefinition) this.owner.addOperation(operation);
    else if (this.owner instanceof SdkGroup) this.owner.setGeometryOperation(operation);
  }

  autoName(suffix) {
    this.autoIndex += 1;
    return `SDK_${suffix}_${this.autoIndex}`;
  }
}

class SdkSelectionProxy {
  constructor(model) {
    this.model = model;
    this.targets = [];
  }

  get(property, node) {
    if (['length', 'count', 'size', 'nitems'].includes(property)) return this.targets.length;
    throw new PythonSdkCompileError(`Unsupported selection attribute: ${property}`, node);
  }

  call(method, args, _kwargs, node) {
    if (method === 'clear') {
      this.targets = [];
      this.model.operations.push({ op: 'selection', mode: 'clear' });
      return null;
    }
    if (method === 'add') {
      const targets = args.map((item) => objectReferenceForFacade(item));
      this.targets.push(...targets);
      this.model.operations.push({ op: 'selection', mode: 'add', targets });
      return this.targets.length;
    }
    if (method === 'remove') {
      const targets = args.map((item) => objectReferenceForFacade(item));
      const removals = new Set(targets.map((target) => JSON.stringify(target)));
      this.targets = this.targets.filter((target) => !removals.has(JSON.stringify(target)));
      this.model.operations.push({ op: 'selection', mode: 'remove', targets });
      return this.targets.length;
    }
    if (method === 'replace') {
      const targets = args.map((item) => objectReferenceForFacade(item));
      this.targets = [...targets];
      this.model.operations.push({ op: 'selection', mode: 'replace', targets });
      return this.targets.length;
    }
    if (method === 'to_a' || method === 'each') return [...this.targets];
    if (['count', 'length', 'size', 'nitems'].includes(method)) return this.targets.length;
    throw new PythonSdkCompileError(`Unsupported selection method: ${method}`, node);
  }
}

class SdkViewFacade {
  constructor(model) {
    this.model = model;
  }

  get(property, node) {
    if (property === 'camera') return this.model._activeCamera || null;
    throw new PythonSdkCompileError(`Unsupported active_view attribute: ${property}`, node);
  }

  call(method, args, kwargs, node) {
    if (method === 'zoom_extents' || method === 'refresh' || method === 'invalidate') return null;
    if (method === 'write_image') {
      this.model.operations.push({
        op: 'image_reference',
        name: kwargs.name ?? 'active_view_image',
        path: requiredString(args[0] ?? kwargs.path, 'active_view.write_image path', node),
        role: 'view_capture'
      });
      return true;
    }
    throw new PythonSdkCompileError(`Unsupported active_view method: ${method}`, node);
  }
}

class SdkModel {
  constructor(facadeObjectSet = new Set()) {
    this.units = 'mm';
    this.operations = [];
    this.facadeObjectSet = facadeObjectSet;
    this.entities = new SdkEntitiesProxy(this, this, facadeObjectSet, 'model.entities');
    this.materials = new SdkCollectionProxy(this, 'materials');
    this.layers = new SdkCollectionProxy(this, 'layers');
    this.definitions = new SdkCollectionProxy(this, 'definitions');
    this.pages = new SdkCollectionProxy(this, 'pages');
    this.selection = new SdkSelectionProxy(this);
    this.active_view = new SdkViewFacade(this);
    this.rendering_options = new SdkRenderingOptions([], {});
    this.shadow_info = new SdkShadowInfo([], {});
  }

  get unitScale() {
    if (['in', 'inch', 'inches'].includes(String(this.units).toLowerCase())) return 25.4;
    return 1;
  }

  setUnits(value) {
    const normalized = String(value || 'mm').toLowerCase();
    if (!['mm', 'millimeter', 'millimeters', 'in', 'inch', 'inches'].includes(normalized)) {
      throw new PythonSdkCompileError(`Unsupported model units: ${value}`);
    }
    this.units = normalized.startsWith('m') ? 'mm' : 'inches';
  }

  get(property, node) {
    if (property === 'units') return this.units;
    if (property === 'operations') return this.operations;
    if (property === 'entities' || property === 'active_entities') {
      this.facadeObjectSet.add('Entities');
      return this.entities;
    }
    if (property === 'materials') {
      this.facadeObjectSet.add('Materials');
      return this.materials;
    }
    if (property === 'layers' || property === 'tags') {
      this.facadeObjectSet.add('Layers');
      return this.layers;
    }
    if (property === 'definitions') {
      this.facadeObjectSet.add('ComponentDefinition');
      return this.definitions;
    }
    if (property === 'pages') {
      this.facadeObjectSet.add('Pages');
      return this.pages;
    }
    if (property === 'selection') {
      this.facadeObjectSet.add('Selection');
      return this.selection;
    }
    if (property === 'active_view') return this.active_view;
    if (property === 'rendering_options') return this.rendering_options;
    if (property === 'shadow_info') return this.shadow_info;
    throw new PythonSdkCompileError(`Unsupported model attribute: ${property}`, node);
  }

  call(method, args, kwargs, node) {
    switch (method) {
      case 'reset':
        this.operations.push({ op: 'reset' });
        return null;
      case 'set_units':
        this.setUnits(args[0] ?? kwargs.units);
        return null;
      case 'add_material':
        return this.addMaterial(args[0], kwargs, node);
      case 'add_layer':
        return this.addLayer(args, kwargs, node);
      case 'assign_layer':
        return this.assignLayer(args, kwargs, node);
      case 'add_image_reference':
        return this.addImageReference(args, kwargs, node);
      case 'add_geometry':
      case 'add_group':
        return this.addGeometry(args[0], kwargs, node);
      case 'add_curve':
        return this.addCurve(args, kwargs, node);
      case 'add_arc_curve':
        return this.addArcCurve(args, kwargs, node);
      case 'add_box':
        return this.addBox(args, kwargs, node);
      case 'set_camera':
        return this.setCamera(args, kwargs, node);
      case 'add_scene':
        return this.addScene(args, kwargs, node);
      case 'set_style':
        return this.setStyle(args, kwargs);
      case 'set_shadow':
        return this.setShadow(args, kwargs);
      case 'set_rendering_options':
        return this.setRenderingOptions(args, kwargs);
      case 'add_component_definition':
        return this.addComponentDefinition(args, kwargs, node);
      case 'add_component_instance':
        return this.addComponentInstance(args, kwargs, node);
      default:
        throw new PythonSdkCompileError(`Unsupported model method: ${method}`, node);
    }
  }

  addMaterial(material, kwargs, node) {
    const materialObject = material instanceof SdkMaterial ? material : new SdkMaterial([material], kwargs, node);
    const operation = materialObject.toOperation();
    this.operations.push(operation);
    this.materials.remember(materialObject);
    return materialObject;
  }

  addLayer(args, kwargs, node) {
    const layer = args[0] instanceof SdkLayer ? args[0] : new SdkLayer(args, kwargs, node);
    this.operations.push(layer.toOperation());
    this.layers.remember(layer);
    return layer;
  }

  assignLayer(args, kwargs, node) {
    const layer = args[1] ?? kwargs.layer ?? kwargs.tag;
    const tag = layer instanceof SdkLayer ? layer.name : requiredString(layer, 'layer name', node);
    const operation = {
      op: 'assign_tag',
      tag
    };
    if (kwargs.name !== undefined) operation.name = kwargs.name;
    else operation.target_id = args[0] ?? kwargs.target_id ?? kwargs.targetId ?? kwargs.target;
    this.operations.push(operation);
    return operation;
  }

  addImageReference(args, kwargs, node) {
    const image = args[0] instanceof SdkImageReference
      ? args[0]
      : new SdkImageReference(args, kwargs, node, 'Image');
    this.operations.push(image.toOperation());
    return image;
  }

  addGeometry(value, kwargs, node) {
    const item = value instanceof SdkGroup || value instanceof SdkGeometryInput ? value : null;
    if (!item) throw new PythonSdkCompileError('model.add_geometry expects GeometryInput or Group', node);
    if (Object.keys(kwargs || {}).length) item.applyObjectOptions?.(kwargs, this);
    this.operations.push(item);
    return item instanceof SdkGeometryInput ? new SdkEntityRef(this, item) : item;
  }

  addCurve(args, kwargs, node) {
    if (args[0] instanceof SdkCurve) {
      this.operations.push(args[0]);
      return args[0];
    }
    const name = requiredString(args[0] ?? kwargs.name, 'curve name', node);
    const points = normalizePoints(args[1] ?? kwargs.points, this.unitScale, 'curve points', node);
    const operation = {
      op: 'curve',
      name,
      points,
      ...normalizeObjectOptions(kwargs, this)
    };
    this.operations.push(operation);
    return new SdkEntityRef(this, operation);
  }

  addArcCurve(args, kwargs, node) {
    if (args[0] instanceof SdkArcCurve) {
      this.operations.push(args[0]);
      return args[0];
    }
    const name = requiredString(args[0] ?? kwargs.name, 'arc curve name', node);
    const center = normalizePoint(args[1] ?? kwargs.center, this.unitScale, 'arc center', node);
    const radius = scaleNumber(args[2] ?? kwargs.radius, this.unitScale, 'arc radius', node);
    const operation = {
      op: 'arc_curve',
      name,
      center,
      radius,
      start_angle: Number(args[3] ?? kwargs.start_angle ?? kwargs.startAngle ?? 0),
      end_angle: Number(args[4] ?? kwargs.end_angle ?? kwargs.endAngle ?? 360),
      segments: Number(args[5] ?? kwargs.segments ?? 16),
      ...normalizeObjectOptions(kwargs, this)
    };
    this.operations.push(operation);
    return new SdkEntityRef(this, operation);
  }

  addBox(args, kwargs, node) {
    const name = requiredString(args[0] ?? kwargs.name, 'box name', node);
    const origin = normalizePoint(args[1] ?? kwargs.origin ?? [0, 0, 0], this.unitScale, 'box origin', node);
    const size = normalizeNumericArray(args[2] ?? kwargs.size, 3, this.unitScale, 'box size', node);
    const operation = {
      op: 'box',
      name,
      origin,
      size,
      ...normalizeObjectOptions(kwargs, this)
    };
    this.operations.push(operation);
    return new SdkEntityRef(this, operation);
  }

  setCamera(args, kwargs, node) {
    const camera = args[0] instanceof SdkCamera
      ? args[0]
      : new SdkCamera(args, kwargs, node);
    const operation = { op: 'camera', ...camera.toCamera(this, node) };
    this.operations.push(operation);
    return camera;
  }

  addScene(args, kwargs, node) {
    const scene = args[0] instanceof SdkScene
      ? args[0]
      : new SdkScene(args, kwargs, node);
    this.operations.push(scene);
    this.pages.remember(scene);
    return scene;
  }

  setStyle(args, kwargs) {
    const style = args[0] instanceof SdkStyle ? args[0] : new SdkStyle(args, kwargs);
    this.operations.push(style.toOperation());
    return style;
  }

  setShadow(args, kwargs) {
    const shadow = args[0] instanceof SdkShadowInfo ? args[0] : new SdkShadowInfo(args, kwargs);
    this.operations.push(shadow.toOperation());
    return shadow;
  }

  setRenderingOptions(args, kwargs) {
    const options = args[0] instanceof SdkRenderingOptions ? args[0] : new SdkRenderingOptions(args, kwargs);
    this.operations.push(options.toOperation());
    return options;
  }

  addComponentDefinition(args, kwargs, node) {
    const definition = args[0] instanceof SdkComponentDefinition
      ? args[0]
      : new SdkComponentDefinition(args, kwargs, node, this, this.facadeObjectSet);
    this.operations.push(definition);
    this.definitions.remember(definition);
    return definition;
  }

  addComponentInstance(args, kwargs, node) {
    const instance = args[0] instanceof SdkComponentInstance
      ? args[0]
      : new SdkComponentInstance(args, kwargs, node);
    this.operations.push(instance);
    return instance;
  }

  toDocument() {
    return {
      version: 1,
      units: 'mm',
      operations: this.operations.flatMap((operation) => normalizeModelOperation(operation, this))
    };
  }
}

class SdkPoint {
  constructor(value, dimensions, type, node) {
    const input = Array.isArray(value) ? value : [value];
    if (input.length !== dimensions || !input.every(isFiniteNumber)) {
      throw new PythonSdkCompileError(`${type} expects ${dimensions} finite numeric coordinates`, node);
    }
    this.type = type;
    this.value = input.map(Number);
  }
}

class SdkColor {
  constructor(args, kwargs, node) {
    if (args.length === 1 && typeof args[0] === 'string') {
      this.color = args[0];
      this.alpha = kwargs.alpha;
      return;
    }
    const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    if (values.length < 3 || !values.slice(0, 3).every(isFiniteNumber)) {
      throw new PythonSdkCompileError('SUColor expects a hex string or r,g,b numeric values', node);
    }
    this.color = `#${values.slice(0, 3).map((value) => clampByte(value).toString(16).padStart(2, '0')).join('')}`;
    this.alpha = kwargs.alpha ?? values[3];
  }
}

class SdkMaterial {
  constructor(args, kwargs, node) {
    const name = args[0] ?? kwargs.name;
    this.name = requiredString(name, 'material name', node);
    this.color = kwargs.color ?? args[1] ?? '#cccccc';
    this.alpha = kwargs.alpha;
    this.texture = kwargs.texture;
    this.workflow = kwargs.workflow;
    this.pbr = kwargs.pbr;
  }

  toOperation() {
    const color = normalizeColor(this.color);
    return {
      op: 'material',
      name: this.name,
      color: color.color,
      ...(this.alpha ?? color.alpha !== undefined ? { alpha: this.alpha ?? color.alpha } : {}),
      ...(this.texture !== undefined ? { texture: textureSpec(this.texture) } : {}),
      ...(this.workflow !== undefined ? { workflow: this.workflow } : {}),
      ...(this.pbr !== undefined ? { pbr: this.pbr } : {})
    };
  }
}

class SdkLayer {
  constructor(args, kwargs, node) {
    this.name = requiredString(args[0] ?? kwargs.name, 'layer name', node);
    this.color = kwargs.color;
    this.visible = kwargs.visible;
  }

  toOperation() {
    return {
      op: 'tag',
      name: this.name,
      ...(this.color !== undefined ? { color: colorSpec(this.color) } : {}),
      ...(this.visible !== undefined ? { visible: Boolean(this.visible) } : {})
    };
  }

  toJson() {
    return this.toOperation();
  }
}

class SdkTexture {
  constructor(args, kwargs, node) {
    this.path = requiredString(args[0] ?? kwargs.path ?? kwargs.file ?? kwargs.filename, 'texture path', node);
    this.width = args[1] ?? kwargs.width;
    this.height = args[2] ?? kwargs.height;
  }

  toSpec() {
    return {
      path: this.path,
      ...(this.width !== undefined ? { width: Number(this.width) } : {}),
      ...(this.height !== undefined ? { height: Number(this.height) } : {})
    };
  }

  toJson() {
    return this.toSpec();
  }
}

class SdkImageReference {
  constructor(args, kwargs, node, type) {
    this.type = type;
    this.name = requiredString(args[0] ?? kwargs.name, `${type} name`, node);
    this.path = requiredString(args[1] ?? kwargs.path ?? kwargs.file ?? kwargs.filename, `${type} path`, node);
    this.width = kwargs.width;
    this.height = kwargs.height;
    this.scale = kwargs.scale;
    this.role = kwargs.role;
    this.source = kwargs.source;
    this.metadata = kwargs.metadata;
  }

  toOperation() {
    return {
      op: 'image_reference',
      name: this.name,
      path: this.path,
      ...(this.width !== undefined ? { width: Number(this.width) } : {}),
      ...(this.height !== undefined ? { height: Number(this.height) } : {}),
      ...(this.scale !== undefined ? { scale: Number(this.scale) } : {}),
      ...(this.role !== undefined ? { role: this.role } : {}),
      ...(this.source !== undefined ? { source: this.source } : {}),
      ...(this.metadata !== undefined ? { metadata: this.metadata } : {})
    };
  }

  toJson() {
    return this.toOperation();
  }
}

class SdkCurve {
  constructor(args, kwargs, node) {
    this.name = requiredString(args[0] ?? kwargs.name, 'curve name', node);
    this.points = args[1] ?? kwargs.points ?? kwargs.vertices;
    this.closed = kwargs.closed;
    this.material = kwargs.material;
    this.smooth = kwargs.smooth;
    this.id = kwargs.id ?? kwargs.object_id ?? kwargs.objectId ?? kwargs.guid;
  }

  get point_count() {
    return Array.isArray(this.points) ? this.points.length : 0;
  }

  toOperation(model, node) {
    return {
      op: 'curve',
      name: this.name,
      points: normalizePoints(this.points, model.unitScale, `${this.name}.points`, node),
      ...(this.closed !== undefined ? { closed: Boolean(this.closed) } : {}),
      ...(this.material !== undefined ? { material: materialName(this.material) } : {}),
      ...(this.smooth !== undefined ? { smooth: this.smooth } : {}),
      ...(this.id ? { id: this.id } : {})
    };
  }

  toJson(model = new SdkModel()) {
    return this.toOperation(model);
  }
}

class SdkPolygonMesh {
  constructor(args, kwargs, node) {
    this.points = [];
    this.polygons = [];
    for (const point of kwargs.points ?? kwargs.vertices ?? []) this.addPoint(point, node);
    for (const polygon of kwargs.polygons ?? kwargs.faces ?? []) this.addPolygon([polygon], {}, node);
    for (const point of args[0]?.points ?? []) this.addPoint(point, node);
    for (const polygon of args[0]?.polygons ?? []) this.addPolygon([polygon], {}, node);
  }

  static fromFace(face) {
    const mesh = new SdkPolygonMesh([], {}, null);
    const unique = uniqueIndices([face.outer, ...face.holes]);
    const indexMap = new Map();
    for (const sourceIndex of unique) {
      indexMap.set(sourceIndex, mesh.addPoint(face.geometry.vertices[sourceIndex]));
    }
    mesh.addPolygon([face.outer.map((index) => indexMap.get(index))]);
    for (const hole of face.holes) mesh.addPolygon([hole.map((index) => indexMap.get(index))]);
    return mesh;
  }

  get count_points() {
    return this.points.length;
  }

  get count_polygons() {
    return this.polygons.length;
  }

  call(method, args, kwargs, node) {
    if (method === 'add_point') return this.addPoint(args[0] ?? kwargs.point, node);
    if (method === 'add_polygon') return this.addPolygon(args.length === 1 && Array.isArray(args[0]) ? [args[0]] : args, kwargs, node);
    if (method === 'points') return this.points.map((point) => new SdkPoint(point, 3, 'SUPoint3D'));
    if (method === 'polygons') return this.polygons.map((polygon) => [...polygon]);
    if (method === 'count_points') return this.count_points;
    if (method === 'count_polygons') return this.count_polygons;
    throw new PythonSdkCompileError(`Unsupported PolygonMesh method: ${method}`, node);
  }

  addPoint(point, node) {
    const normalized = point instanceof SdkPoint ? point.value : normalizeRawPoint(point, 'polygon mesh point', node);
    this.points.push(normalized);
    return this.points.length;
  }

  addPolygon(items, _kwargs = {}, node) {
    const raw = items.length === 1 && Array.isArray(items[0]) ? items[0] : items;
    if (!Array.isArray(raw) || raw.length < 3) throw new PythonSdkCompileError('PolygonMesh.add_polygon expects at least 3 points or point indices', node);
    const polygon = raw.map((item) => {
      if (Number.isInteger(item)) {
        const index = item > 0 ? item - 1 : item;
        if (index < 0 || index >= this.points.length) throw new PythonSdkCompileError('PolygonMesh polygon index out of range', node);
        return index;
      }
      return this.addPoint(item, node) - 1;
    });
    this.polygons.push(polygon);
    return this.polygons.length;
  }

  toMeshOperation(model, kwargs = {}, node, fallbackName = 'SDK_Mesh') {
    const name = requiredString(kwargs.name ?? fallbackName, 'mesh name', node);
    return new SdkMeshOperation(name, this.points, this.polygons, kwargs, model, node);
  }

  toJson() {
    return {
      points: this.points.map((point) => [...point]),
      polygons: this.polygons.map((polygon) => [...polygon])
    };
  }
}

class SdkMeshOperation {
  constructor(name, vertices, faces, kwargs = {}, model = new SdkModel(), node) {
    this.name = name;
    this.vertices = vertices;
    this.faces = faces;
    this.material = kwargs.material ?? kwargs.f_material ?? kwargs.front_material;
    this.back_material = kwargs.back_material ?? kwargs.b_material;
    this.smooth = kwargs.smooth;
    this.transform = kwargs.transform instanceof SdkTransformation ? kwargs.transform.toTransform(model) : kwargs.transform;
    this.id = kwargs.id ?? kwargs.object_id ?? kwargs.objectId ?? kwargs.guid;
    this.qa = kwargs.qa;
    if (!Array.isArray(vertices) || vertices.length < 3) throw new PythonSdkCompileError('mesh facade requires at least 3 points', node);
    if (!Array.isArray(faces) || faces.length < 1) throw new PythonSdkCompileError('mesh facade requires at least one polygon', node);
  }

  toOperation(model) {
    return {
      op: 'mesh',
      ...(this.id ? { id: this.id } : {}),
      name: this.name,
      vertices: this.vertices.map((point) => normalizePoint(point, model.unitScale, `${this.name}.vertices`)),
      faces: this.faces.map((face) => face.map(Number)),
      ...(this.material !== undefined ? { material: materialName(this.material) } : {}),
      ...(this.back_material !== undefined ? { back_material: materialName(this.back_material) } : {}),
      ...(this.smooth !== undefined ? { smooth: this.smooth } : {}),
      ...(this.transform !== undefined ? { transform: this.transform } : {}),
      ...(this.qa !== undefined ? { qa: this.qa } : {})
    };
  }

  toJson(model = new SdkModel()) {
    return this.toOperation(model);
  }
}

class SdkArcCurve {
  constructor(args, kwargs, node) {
    this.name = requiredString(args[0] ?? kwargs.name, 'arc curve name', node);
    this.center = args[1] ?? kwargs.center;
    this.radius = args[2] ?? kwargs.radius;
    this.start_angle = args[3] ?? kwargs.start_angle ?? kwargs.startAngle ?? 0;
    this.end_angle = args[4] ?? kwargs.end_angle ?? kwargs.endAngle ?? 360;
    this.segments = args[5] ?? kwargs.segments ?? 16;
    this.plane = kwargs.plane;
    this.material = kwargs.material;
    this.id = kwargs.id ?? kwargs.object_id ?? kwargs.objectId ?? kwargs.guid;
  }

  toOperation(model, node) {
    return {
      op: 'arc_curve',
      name: this.name,
      center: normalizePoint(this.center, model.unitScale, `${this.name}.center`, node),
      radius: scaleNumber(this.radius, model.unitScale, `${this.name}.radius`, node),
      start_angle: Number(this.start_angle),
      end_angle: Number(this.end_angle),
      segments: Number(this.segments),
      ...(this.plane !== undefined ? { plane: this.plane } : {}),
      ...(this.material !== undefined ? { material: materialName(this.material) } : {}),
      ...(this.id ? { id: this.id } : {})
    };
  }

  toJson(model = new SdkModel()) {
    return this.toOperation(model);
  }
}

class SdkLoopInput {
  constructor(args, kwargs, node) {
    this.items = args[0] ?? kwargs.points ?? kwargs.indices;
    if (!Array.isArray(this.items)) throw new PythonSdkCompileError('LoopInput expects a points or indices array', node);
  }
}

class SdkGeometryInput {
  constructor(args, kwargs, node, facadeObjectSet = new Set()) {
    this.facadeObjectSet = facadeObjectSet;
    this.name = requiredString(args[0] ?? kwargs.name, 'geometry name', node);
    this.id = kwargs.id ?? kwargs.object_id ?? kwargs.objectId;
    this.material = kwargs.material ?? args[1];
    this.vertices = [];
    this.faces = [];
    this.edges = [];
    this.smooth = kwargs.smooth;
    for (const point of kwargs.vertices || []) this.addVertex(point, node);
    for (const edge of kwargs.edges || []) this.addEdge(edge[0], edge[1], node);
    for (const face of kwargs.faces || []) this.addFace(face.outer ?? face, { holes: face.holes }, node);
  }

  applyObjectOptions(kwargs = {}, model) {
    if (kwargs.id !== undefined || kwargs.object_id !== undefined || kwargs.objectId !== undefined || kwargs.guid !== undefined) {
      this.id = kwargs.id ?? kwargs.object_id ?? kwargs.objectId ?? kwargs.guid;
    }
    if (kwargs.material !== undefined) this.material = kwargs.material;
    if (kwargs.smooth !== undefined) this.smooth = kwargs.smooth;
    if (kwargs.transform !== undefined) this.transform = kwargs.transform instanceof SdkTransformation ? kwargs.transform.toTransform(model) : kwargs.transform;
    if (kwargs.qa !== undefined) this.qa = kwargs.qa;
  }

  call(method, args, kwargs, node) {
    switch (method) {
      case 'add_vertex':
        return this.addVertex(args[0] ?? kwargs.point, node);
      case 'add_edge':
        return this.addEdge(args[0] ?? kwargs.start, args[1] ?? kwargs.end, node);
      case 'add_face':
        return this.addFace(args[0] ?? kwargs.outer, kwargs, node);
      default:
        throw new PythonSdkCompileError(`Unsupported GeometryInput method: ${method}`, node);
    }
  }

  addVertex(point, node) {
    const normalized = point instanceof SdkPoint ? point.value : normalizeRawPoint(point, 'geometry vertex', node);
    this.vertices.push(normalized);
    return this.vertices.length - 1;
  }

  addEdge(start, end, node) {
    this.facadeObjectSet.add('Edge');
    const edge = new SdkEdgeRef(this, this.vertexReference(start, node), this.vertexReference(end, node), this.edges.length);
    this.edges.push(edge);
    return edge;
  }

  addFace(outer, kwargs = {}, node) {
    this.facadeObjectSet.add('Face');
    const face = new SdkFaceInput(this, {
      id: kwargs.id ?? kwargs.face_id ?? kwargs.faceId,
      outer: this.loopToIndices(outer, node),
      holes: (kwargs.holes || []).map((hole) => this.loopToIndices(hole, node)),
      material: kwargs.material ?? this.material,
      backMaterial: kwargs.back_material ?? kwargs.backMaterial,
      metadata: kwargs.metadata
    });
    if (kwargs.reversed ?? kwargs.reverse) face.reversed = Boolean(kwargs.reversed ?? kwargs.reverse);
    if (kwargs.pushpull !== undefined) face.setPushPull(kwargs.pushpull);
    this.faces.push(face);
    return face;
  }

  loopToIndices(loop, node) {
    const items = loop instanceof SdkLoopInput ? loop.items : loop;
    if (!Array.isArray(items) || items.length < 3) throw new PythonSdkCompileError('Face loops require at least 3 points or indices', node);
    return items.map((item) => this.vertexReference(item, node));
  }

  vertexReference(value, node) {
    if (Number.isInteger(value)) return value;
    return this.addVertex(value, node);
  }

  toOperation(model) {
    return {
      op: 'geometry_input',
      ...(this.id ? { id: this.id } : {}),
      name: this.name,
      vertices: this.vertices.map((point) => normalizePoint(point, model.unitScale, 'geometry vertex')),
      faces: this.faces.map((face) => face.toFaceSpec(model)),
      ...(this.edges.length ? { edges: this.edges.map((edge) => edge.toEdgeSpec()) } : {}),
      ...(this.material ? { material: materialName(this.material) } : {}),
      ...(this.smooth ? { smooth: this.smooth } : {}),
      ...(this.transform ? { transform: this.transform } : {}),
      ...(this.qa ? { qa: this.qa } : {})
    };
  }
}

class SdkFaceInput {
  constructor(geometry, { id, outer, holes = [], material, backMaterial, metadata } = {}) {
    this.geometry = geometry;
    this.id = id;
    this.outer = outer;
    this.holes = holes;
    this.material = materialName(material);
    this.back_material = materialName(backMaterial);
    this.reversed = false;
    this.pushpull = null;
    this.followme = null;
    this.position_material = null;
    this.metadata = metadata && typeof metadata === 'object' ? structuredClone(metadata) : null;
  }

  get vertices() {
    return uniqueIndices([this.outer, ...this.holes]).map((index) => new SdkPoint(this.geometry.vertices[index], 3, 'SUPoint3D'));
  }

  get edges() {
    return this.loopEdgeRefs(this.outer, 'outer');
  }

  get loops() {
    this.geometry.facadeObjectSet.add('Loop');
    return [
      new SdkLoopRef(this, this.outer, true, 0),
      ...this.holes.map((loop, index) => new SdkLoopRef(this, loop, false, index + 1))
    ];
  }

  get outer_loop() {
    return this.loops[0];
  }

  get normal() {
    const normal = faceNormal(this.outer.map((index) => this.geometry.vertices[index]));
    return this.reversed ? normal.map((value) => roundNumber(-value, 6)) : normal;
  }

  get plane() {
    return facePlane(this.outer.map((index) => this.geometry.vertices[index]), this.normal);
  }

  get area() {
    const outerArea = polygonArea3d(this.outer.map((index) => this.geometry.vertices[index]));
    const holeArea = this.holes.reduce((sum, hole) => sum + polygonArea3d(hole.map((index) => this.geometry.vertices[index])), 0);
    return Math.max(0, roundNumber(outerArea - holeArea, 6));
  }

  call(method, args, kwargs, node) {
    if (method === 'reverse' || method === 'reverse_bang') {
      this.reversed = !this.reversed;
      return this;
    }
    if (method === 'pushpull') {
      const distance = args[0] ?? kwargs.distance;
      if (!isFiniteNumber(distance)) throw new PythonSdkCompileError('Face.pushpull expects a finite distance', node);
      this.setPushPull({ distance, copy: args[1] ?? kwargs.copy, metadata_only: kwargs.metadata_only ?? kwargs.metadataOnly });
      return null;
    }
    if (method === 'followme') {
      this.followme = normalizeFollowmeSpec(args[0] ?? kwargs.edges ?? kwargs.path, kwargs, this.geometry, node);
      return true;
    }
    if (method === 'position_material') {
      this.position_material = normalizePositionMaterialSpec(args, kwargs, node);
      this.material = this.position_material.material ?? this.material;
      return this;
    }
    if (method === 'clear_texture_position') {
      this.position_material = null;
      return null;
    }
    if (method === 'texture_positioned') return Boolean(this.position_material);
    if (method === 'mesh') return SdkPolygonMesh.fromFace(this);
    throw new PythonSdkCompileError(`Unsupported Face method: ${method}`, node);
  }

  setPushPull(value) {
    const spec = typeof value === 'object' && value !== null ? value : { distance: value };
    this.pushpull = {
      distance: Number(spec.distance),
      copy: Boolean(spec.copy),
      metadata_only: spec.metadata_only === undefined && spec.metadataOnly === undefined ? false : Boolean(spec.metadata_only ?? spec.metadataOnly)
    };
  }

  loopEdgeRefs(loop, role) {
    this.geometry.facadeObjectSet.add('Edge');
    const edges = [];
    for (let index = 0; index < loop.length; index += 1) {
      edges.push(new SdkEdgeRef(this.geometry, loop[index], loop[(index + 1) % loop.length], index, { face: this, role }));
    }
    return edges;
  }

  toFaceSpec(model) {
    const scale = model.unitScale;
    const plane = this.plane;
    return {
      ...(this.id ? { id: this.id } : {}),
      outer: this.outer,
      holes: this.holes,
      ...(this.material ? { material: this.material } : {}),
      ...(this.back_material ? { back_material: this.back_material } : {}),
      ...(this.reversed ? { reversed: true } : {}),
      normal: this.normal,
      plane: [plane[0], plane[1], plane[2], roundNumber(plane[3] * scale, 6)],
      area: roundNumber(this.area * scale * scale, 6),
      ...(this.pushpull ? { pushpull: { ...this.pushpull, distance: roundNumber(this.pushpull.distance * scale, 6) } } : {}),
      ...(this.followme ? { followme: { ...this.followme, path: this.followme.path.map((point) => normalizePoint(point, scale, 'followme path')) } } : {}),
      ...(this.position_material ? { position_material: scalePositionMaterial(this.position_material, scale) } : {}),
      ...(this.metadata ? { metadata: this.metadata } : {})
    };
  }

  toJson() {
    return {
      id: this.id || null,
      outer: this.outer,
      holes: this.holes,
      material: this.material || null,
      back_material: this.back_material || null,
      reversed: this.reversed,
      normal: this.normal,
      plane: this.plane,
      area: this.area,
      pushpull: this.pushpull,
      followme: this.followme,
      position_material: this.position_material
    };
  }
}

class SdkLoopRef {
  constructor(face, indices, outer, index) {
    this.face = face;
    this.indices = indices;
    this.outer = outer;
    this.index = index;
  }

  get vertices() {
    return this.indices.map((vertexIndex) => new SdkPoint(this.face.geometry.vertices[vertexIndex], 3, 'SUPoint3D'));
  }

  get edges() {
    return this.face.loopEdgeRefs(this.indices, this.outer ? 'outer' : 'hole');
  }

  call(method, _args, _kwargs, node) {
    if (method === 'is_outer') return this.outer;
    if (method === 'to_indices') return [...this.indices];
    throw new PythonSdkCompileError(`Unsupported Loop method: ${method}`, node);
  }

  toJson() {
    return {
      outer: this.outer,
      index: this.index,
      indices: this.indices
    };
  }
}

class SdkEdgeRef {
  constructor(geometry, startIndex, endIndex, index, options = {}) {
    this.geometry = geometry;
    this.start_index = startIndex;
    this.end_index = endIndex;
    this.index = index;
    this.face = options.face || null;
    this.role = options.role || null;
  }

  get start() {
    return new SdkPoint(this.geometry.vertices[this.start_index], 3, 'SUPoint3D');
  }

  get end() {
    return new SdkPoint(this.geometry.vertices[this.end_index], 3, 'SUPoint3D');
  }

  get vertices() {
    return [this.start, this.end];
  }

  get length() {
    return roundNumber(distance3d(this.start.value, this.end.value), 6);
  }

  call(method, _args, _kwargs, node) {
    if (method === 'to_indices') return [this.start_index, this.end_index];
    throw new PythonSdkCompileError(`Unsupported Edge method: ${method}`, node);
  }

  toEdgeSpec() {
    return [this.start_index, this.end_index];
  }

  toJson() {
    return {
      start: this.start.value,
      end: this.end.value,
      start_index: this.start_index,
      end_index: this.end_index,
      length: this.length
    };
  }
}

class SdkEntityRef {
  constructor(model, source) {
    this.model = model;
    this.source = source;
  }

  get name() {
    return this.source.name;
  }

  set name(value) {
    this.source.name = value;
  }

  get id() {
    return this.source.id ?? this.source.object_id ?? this.source.objectId ?? this.source.guid ?? this.source.name;
  }

  get(property, node) {
    if (property === 'name') return this.name;
    if (['id', 'object_id', 'objectId', 'guid'].includes(property)) return this.id;
    if (property === 'material') return this.source.material ?? null;
    if (property === 'layer' || property === 'tag') return this.source.tag ?? this.source.layer ?? null;
    if (property === 'visible') return this.source.visible ?? true;
    throw new PythonSdkCompileError(`Unsupported entity attribute: ${property}`, node);
  }

  assign(property, value, node) {
    if (property === 'name') {
      this.source.name = requiredString(value, 'entity name', node);
      return;
    }
    if (property === 'material') {
      this.pushTargetOperation({ op: 'set_material', material: materialName(value) });
      this.source.material = materialName(value);
      return;
    }
    if (property === 'layer' || property === 'tag') {
      const tag = value instanceof SdkLayer ? value.name : requiredString(value, 'entity layer', node);
      this.pushTargetOperation({ op: 'assign_tag', tag });
      this.source.tag = tag;
      return;
    }
    if (property === 'visible') {
      this.pushTargetOperation({ op: 'set_visibility', visible: Boolean(value) });
      return;
    }
    if (property === 'hidden') {
      this.pushTargetOperation({ op: 'set_visibility', visible: !Boolean(value) });
      return;
    }
    if (property === 'locked') {
      this.pushTargetOperation({ op: 'attribute', dictionary: 'AlmaSketchupMCP', key: 'locked', value: Boolean(value) });
      return;
    }
    throw new PythonSdkCompileError(`Unsupported entity assignment: ${property}`, node);
  }

  call(method, args, kwargs, node) {
    if (method === 'set_attribute') {
      const dictionary = requiredString(args[0] ?? kwargs.dictionary ?? kwargs.namespace, 'attribute dictionary', node);
      const key = requiredString(args[1] ?? kwargs.key, 'attribute key', node);
      const value = args[2] ?? kwargs.value;
      this.pushTargetOperation({ op: 'attribute', dictionary, key, value: facadePlainValue(value) });
      return value;
    }
    if (method === 'get_attribute') return kwargs.default ?? args[2] ?? null;
    if (method === 'delete_attribute') {
      const dictionary = requiredString(args[0] ?? kwargs.dictionary ?? kwargs.namespace, 'attribute dictionary', node);
      const key = requiredString(args[1] ?? kwargs.key, 'attribute key', node);
      this.pushTargetOperation({ op: 'attribute', dictionary, key, value: null });
      return true;
    }
    if (['erase', 'erase_bang', 'delete'].includes(method)) {
      this.pushTargetOperation({ op: 'delete' });
      return null;
    }
    if (method === 'transform_by' || method === 'transform' || method === 'transform_bang' || method === 'move_bang') {
      const transform = args[0] instanceof SdkTransformation ? args[0].toTransform(this.model) : args[0] ?? kwargs.transform;
      this.pushTargetOperation({ op: 'transform_object', transform });
      return this;
    }
    if (method === 'move_to') {
      const origin = normalizePoint(args[0] ?? kwargs.origin, this.model.unitScale, 'entity move_to origin', node);
      this.pushTargetOperation({ op: 'transform_object', translate: origin });
      return this;
    }
    throw new PythonSdkCompileError(`Unsupported entity method: ${method}`, node);
  }

  pushTargetOperation(operation) {
    const target = objectReferenceForFacade(this);
    this.model.operations.push({ ...operation, ...target });
  }

  toJson() {
    return objectReferenceForFacade(this);
  }
}

class SdkGroup {
  constructor(args, kwargs, node, model = new SdkModel(), facadeObjectSet = new Set()) {
    this.model = model;
    this.facadeObjectSet = facadeObjectSet;
    this.name = requiredString(args[0] ?? kwargs.name, 'group name', node);
    this.geometry = args[1] ?? kwargs.geometry;
    this.material = kwargs.material;
    this.id = kwargs.id ?? kwargs.object_id ?? kwargs.objectId ?? kwargs.guid;
    this.entities = new SdkEntitiesProxy(this, model, facadeObjectSet, `${this.name}.entities`);
  }

  ensureGeometry(node) {
    if (!this.geometry) this.geometry = new SdkGeometryInput([this.name, this.material], { id: this.id, material: this.material }, node, this.facadeObjectSet);
    if (!(this.geometry instanceof SdkGeometryInput)) throw new PythonSdkCompileError('Group entities currently require GeometryInput-backed groups', node);
    return this.geometry;
  }

  setGeometryOperation(operation) {
    if (this.geometry && this.geometry !== operation) {
      throw new PythonSdkCompileError('Group facade currently supports one geometry payload');
    }
    this.geometry = operation;
    return operation;
  }

  get definition_name() {
    return this.name;
  }

  assign(property, value, node) {
    if (property === 'name') this.name = requiredString(value, 'group name', node);
    else if (property === 'material') this.material = materialName(value);
    else if (property === 'layer' || property === 'tag') this.tag = value instanceof SdkLayer ? value.name : requiredString(value, 'group layer', node);
    else if (property === 'visible') this.visible = Boolean(value);
    else throw new PythonSdkCompileError(`Unsupported Group assignment: ${property}`, node);
  }

  call(method, args, kwargs, node) {
    if (method === 'set_attribute') {
      this.attributes ||= {};
      const dictionary = requiredString(args[0] ?? kwargs.dictionary ?? kwargs.namespace, 'attribute dictionary', node);
      const key = requiredString(args[1] ?? kwargs.key, 'attribute key', node);
      this.attributes[dictionary] ||= {};
      this.attributes[dictionary][key] = facadePlainValue(args[2] ?? kwargs.value);
      return args[2] ?? kwargs.value;
    }
    if (method === 'to_component' || method === 'make_unique') return this;
    if (method === 'explode') return [this];
    if (method === 'transform_by') {
      this.transform = args[0] instanceof SdkTransformation ? args[0].toTransform(this.model) : args[0] ?? kwargs.transform;
      return this;
    }
    throw new PythonSdkCompileError(`Unsupported Group method: ${method}`, node);
  }

  toOperation(model) {
    if (!this.geometry) this.ensureGeometry();
    if (this.geometry instanceof SdkGeometryInput || this.geometry instanceof SdkMeshOperation) {
      return {
        ...this.geometry.toOperation(model),
        name: this.name,
        ...(this.id ? { id: this.id } : {}),
        ...(this.material ? { material: materialName(this.material) } : {}),
        ...(this.tag ? { tag: this.tag } : {}),
        ...(this.visible === false ? { visible: false } : {}),
        ...(this.transform ? { transform: this.transform } : {}),
        ...(this.attributes ? { attributes: this.attributes } : {})
      };
    }
    throw new PythonSdkCompileError('Group currently wraps a GeometryInput or mesh facade object');
  }
}

class SdkComponentDefinition {
  constructor(args, kwargs, node, model = new SdkModel(), facadeObjectSet = new Set()) {
    this.model = model;
    this.facadeObjectSet = facadeObjectSet;
    this.name = requiredString(args[0] ?? kwargs.name, 'component definition name', node);
    this.operations = [];
    this.size = kwargs.size;
    this.material = kwargs.material;
    this.description = kwargs.description;
    this.entities = new SdkEntitiesProxy(this, model, facadeObjectSet, `${this.name}.entities`);
    for (const operation of args[1] ?? kwargs.operations ?? []) this.addOperation(operation, node);
  }

  get operation_count() {
    return this.operations.length;
  }

  call(method, args, kwargs, node) {
    if (method === 'add_operation' || method === 'add_geometry') {
      return this.addOperation(args[0] ?? kwargs.operation ?? kwargs.geometry, node);
    }
    if (method === 'create_instance' || method === 'add_instance') {
      return new SdkComponentInstance([
        args[0] ?? kwargs.name,
        this,
        args[1] ?? kwargs.origin
      ], kwargs, node);
    }
    if (method === 'save_as' || method === 'save_copy') return kwargs.path ?? args[0] ?? null;
    throw new PythonSdkCompileError(`Unsupported ComponentDefinition method: ${method}`, node);
  }

  addOperation(operation, node) {
    if (!operation) throw new PythonSdkCompileError('ComponentDefinition.add_operation expects a geometry operation', node);
    this.operations.push(operation);
    return operation;
  }

  toOperation(model, node) {
    const operation = {
      op: 'component_definition',
      name: this.name
    };
    if (this.operations.length || this.size === undefined) {
      operation.operations = normalizeNestedOperations(this.operations, model, node);
    } else {
      operation.size = normalizeNumericArray(this.size, 3, model.unitScale, `${this.name}.size`, node);
    }
    if (this.material !== undefined) operation.material = materialName(this.material);
    if (this.description !== undefined) operation.description = this.description;
    return operation;
  }

  toJson(model = new SdkModel()) {
    return this.toOperation(model);
  }
}

class SdkComponentInstance {
  constructor(args, kwargs, node) {
    this.name = requiredString(args[0] ?? kwargs.name, 'component instance name', node);
    this.definition = args[1] ?? kwargs.definition;
    this.origin = args[2] ?? kwargs.origin ?? [0, 0, 0];
    this.material = kwargs.material;
    this.transform = kwargs.transform;
    this.id = kwargs.id ?? kwargs.object_id ?? kwargs.objectId ?? kwargs.guid;
    this.qa = kwargs.qa;
    this.tag = kwargs.layer instanceof SdkLayer ? kwargs.layer.name : kwargs.tag;
    this.visible = kwargs.visible;
    this.attributes = null;
  }

  get definition_name() {
    return componentDefinitionName(this.definition);
  }

  call(method, args, kwargs, node) {
    if (method === 'move_to') {
      this.origin = args[0] ?? kwargs.origin;
      return this;
    }
    if (method === 'transform_by') {
      this.transform = args[0] ?? kwargs.transform;
      return this;
    }
    if (method === 'set_attribute') {
      const dictionary = requiredString(args[0] ?? kwargs.dictionary ?? kwargs.namespace, 'attribute dictionary', node);
      const key = requiredString(args[1] ?? kwargs.key, 'attribute key', node);
      this.attributes ||= {};
      this.attributes[dictionary] ||= {};
      this.attributes[dictionary][key] = facadePlainValue(args[2] ?? kwargs.value);
      return args[2] ?? kwargs.value;
    }
    if (method === 'get_attribute') return kwargs.default ?? args[2] ?? null;
    if (method === 'make_unique') return this;
    if (method === 'explode') return [this];
    throw new PythonSdkCompileError(`Unsupported ComponentInstance method: ${method}`, node);
  }

  assign(property, value, node) {
    if (property === 'name') this.name = requiredString(value, 'component instance name', node);
    else if (property === 'material') this.material = materialName(value);
    else if (property === 'layer' || property === 'tag') this.tag = value instanceof SdkLayer ? value.name : requiredString(value, 'component instance layer', node);
    else if (property === 'visible') this.visible = Boolean(value);
    else if (property === 'definition') this.definition = value;
    else throw new PythonSdkCompileError(`Unsupported ComponentInstance assignment: ${property}`, node);
  }

  toOperation(model, node) {
    const kwargs = {
      ...(this.id ? { id: this.id } : {}),
      ...(this.material !== undefined ? { material: this.material } : {}),
      ...(this.transform !== undefined ? { transform: this.transform } : {}),
      ...(this.tag !== undefined ? { tag: this.tag } : {}),
      ...(this.visible === false ? { visible: false } : {}),
      ...(this.attributes !== null ? { attributes: this.attributes } : {}),
      ...(this.qa !== undefined ? { qa: this.qa } : {})
    };
    return {
      op: 'component_instance',
      name: this.name,
      definition: componentDefinitionName(this.definition, node),
      origin: normalizePoint(this.origin, model.unitScale, `${this.name}.origin`, node),
      ...normalizeObjectOptions(kwargs, model)
    };
  }

  toJson(model = new SdkModel()) {
    return this.toOperation(model);
  }
}

class SdkCamera {
  constructor(args, kwargs, node) {
    this.eye = args[0] ?? kwargs.eye;
    this.target = args[1] ?? kwargs.target;
    this.up = args[2] ?? kwargs.up ?? [0, 0, 1];
    this.fov = args[3] ?? kwargs.fov ?? 35;
    if (this.eye === undefined || this.target === undefined) {
      throw new PythonSdkCompileError('Camera expects eye and target points', node);
    }
  }

  call(method, args, kwargs, node) {
    if (method === 'look_at') {
      this.target = args[0] ?? kwargs.target;
      return this;
    }
    if (method === 'set_eye') {
      this.eye = args[0] ?? kwargs.eye;
      return this;
    }
    throw new PythonSdkCompileError(`Unsupported Camera method: ${method}`, node);
  }

  toCamera(model, node) {
    return {
      eye: normalizePoint(this.eye, model.unitScale, 'camera eye', node),
      target: normalizePoint(this.target, model.unitScale, 'camera target', node),
      up: normalizePoint(this.up, 1, 'camera up', node),
      fov: Number(this.fov)
    };
  }

  toJson(model = new SdkModel()) {
    return this.toCamera(model);
  }
}

class SdkScene {
  constructor(args, kwargs, node) {
    this.name = requiredString(args[0] ?? kwargs.name, 'scene name', node);
    this.camera = args[1] ?? kwargs.camera;
    this.transition_time = kwargs.transition_time ?? kwargs.transitionTime;
    this.use_camera = kwargs.use_camera ?? kwargs.useCamera;
    this.layer_visibility = [];
    this.drawingelement_visibility = [];
    this.rendering_options = new SdkRenderingOptions([], {});
    this.shadow_info = new SdkShadowInfo([], {});
    this.style = kwargs.style instanceof SdkStyle ? kwargs.style : null;
  }

  toOperation(model, node) {
    return {
      op: 'scene',
      name: this.name,
      ...(this.camera ? { camera: normalizeCamera(this.camera, model, node) } : {}),
      ...(this.transition_time !== undefined ? { transition_time: Number(this.transition_time) } : {}),
      ...(this.use_camera !== undefined ? { use_camera: Boolean(this.use_camera) } : {}),
      ...(this.layer_visibility.length ? { layer_visibility: this.layer_visibility.map((entry) => ({ ...entry })) } : {}),
      ...(this.drawingelement_visibility.length ? { drawingelement_visibility: this.drawingelement_visibility.map((entry) => ({ ...entry })) } : {}),
      ...(Object.keys(this.rendering_options.options).length ? { rendering_options: { ...this.rendering_options.options } } : {}),
      ...(Object.keys(this.shadow_info.options).length ? { shadow: { ...this.shadow_info.options } } : {}),
      ...(this.style ? { style: { ...this.style.options } } : {})
    };
  }

  call(method, args, kwargs, _node) {
    if (method === 'update') return this;
    if (method === 'use_camera') {
      this.camera = args[0] ?? kwargs.camera ?? this.camera;
      return this;
    }
    if (method === 'set_visibility') {
      const layer = args[0] ?? kwargs.layer ?? kwargs.tag;
      const visible = args[1] ?? kwargs.visible;
      this.layer_visibility.push({
        layer: layer instanceof SdkLayer ? layer.name : requiredString(layer, 'scene layer visibility layer', _node),
        visible: Boolean(visible)
      });
      return this;
    }
    if (method === 'set_drawingelement_visibility') {
      this.drawingelement_visibility.push({
        ...objectReferenceForFacade(args[0] ?? kwargs.entity ?? kwargs.target),
        visible: Boolean(args[1] ?? kwargs.visible)
      });
      return true;
    }
    throw new PythonSdkCompileError(`Unsupported Scene method: ${method}`, _node);
  }

  toJson(model = new SdkModel()) {
    return this.toOperation(model);
  }
}

class SdkStyle {
  constructor(args, kwargs) {
    this.options = normalizeFacadeOptions({
      ...kwargs,
      ...(args[0] !== undefined ? { name: args[0] } : {})
    }, STYLE_OPTION_KEYS);
  }

  toOperation() {
    return { op: 'style', ...this.options };
  }

  call(method, _args, _kwargs, node) {
    if (method === 'duplicate' || method === 'update') return this;
    if (method === 'keys') return Object.keys(this.options);
    throw new PythonSdkCompileError(`Unsupported Style method: ${method}`, node);
  }

  toJson() {
    return this.toOperation();
  }
}

class SdkShadowInfo {
  constructor(_args, kwargs) {
    this.options = normalizeFacadeOptions(kwargs, SHADOW_OPTION_KEYS);
  }

  toOperation() {
    return { op: 'shadow', ...this.options };
  }

  call(method, _args, _kwargs, node) {
    if (method === 'keys' || method === 'each_key') return SHADOW_OPTION_KEYS.map((keys) => keys[0]);
    if (method === 'each_pair') return Object.entries(this.options);
    throw new PythonSdkCompileError(`Unsupported ShadowInfo method: ${method}`, node);
  }

  toJson() {
    return this.toOperation();
  }
}

class SdkRenderingOptions {
  constructor(_args, kwargs) {
    this.options = normalizeFacadeOptions(kwargs, RENDERING_OPTION_KEYS);
  }

  toOperation() {
    return { op: 'rendering_options', ...this.options };
  }

  call(method, _args, _kwargs, node) {
    if (method === 'keys' || method === 'each_key') return RENDERING_OPTION_KEYS.map((keys) => keys[0]);
    if (method === 'each_pair') return Object.entries(this.options);
    throw new PythonSdkCompileError(`Unsupported RenderingOptions method: ${method}`, node);
  }

  toJson() {
    return this.toOperation();
  }
}

class SdkTransformation {
  constructor(args, kwargs, node) {
    if (args.length === 1 && Array.isArray(args[0]) && args[0].length === 16) this.matrix = args[0].map(Number);
    this.translate = kwargs.translate ?? kwargs.translation;
    this.rotateX = kwargs.rotateX ?? kwargs.rotate_x;
    this.rotateY = kwargs.rotateY ?? kwargs.rotate_y;
    this.rotateZ = kwargs.rotateZ ?? kwargs.rotate_z;
    this.axis = kwargs.axis;
    this.angle = kwargs.angle;
    this.scale = kwargs.scale;
  }

  static staticMethod(method, args, kwargs, node) {
    if (method === 'translation') return new SdkTransformation([], { translate: args[0] ?? kwargs.vector }, node);
    if (method === 'rotation_z') return new SdkTransformation([], { rotateZ: args[0] ?? kwargs.degrees }, node);
    if (method === 'rotation') {
      return new SdkTransformation([], {
        axis: args[1] ?? kwargs.axis ?? kwargs.vector,
        angle: radiansToDegrees(args[2] ?? kwargs.angle ?? kwargs.radians ?? kwargs.degrees, kwargs.degrees !== undefined)
      }, node);
    }
    if (method === 'scaling') return new SdkTransformation([], { scale: args[0] ?? kwargs.scale ?? 1 }, node);
    if (method === 'axes') return new SdkTransformation([], { translate: args[0] ?? kwargs.origin ?? [0, 0, 0] }, node);
    throw new PythonSdkCompileError(`Unsupported SUTransformation static method: ${method}`, node);
  }

  call(method, args, kwargs, node) {
    if (method === 'translate') {
      this.translate = args[0] ?? kwargs.vector;
      return this;
    }
    if (method === 'rotate_z') {
      this.rotateZ = args[0] ?? kwargs.degrees;
      return this;
    }
    if (method === 'scale') {
      this.scale = args[0] ?? kwargs.scale;
      return this;
    }
    if (method === 'to_a') return this.matrix ?? this.toMatrixArray();
    if (method === 'inverse') return new SdkTransformation(this.matrix ? [this.matrix] : [], {}, node);
    throw new PythonSdkCompileError(`Unsupported SUTransformation method: ${method}`, node);
  }

  toTransform(model) {
    return {
      ...(this.matrix ? { matrix: this.matrix } : {}),
      ...(this.translate ? { translate: normalizePoint(this.translate, model.unitScale, 'transform translate') } : {}),
      ...(this.rotateX !== undefined ? { rotateX: Number(this.rotateX) } : {}),
      ...(this.rotateY !== undefined ? { rotateY: Number(this.rotateY) } : {}),
      ...(this.rotateZ !== undefined ? { rotateZ: Number(this.rotateZ) } : {}),
      ...(this.axis !== undefined ? { axis: normalizePoint(this.axis, 1, 'transform axis'), angle: Number(this.angle ?? 0) } : {}),
      ...(this.scale !== undefined ? { scale: Array.isArray(this.scale) ? this.scale : Number(this.scale) } : {})
    };
  }

  toMatrixArray() {
    if (this.matrix) return [...this.matrix];
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }
}

function normalizeObjectOptions(kwargs = {}, model) {
  const output = {};
  for (const key of ['id', 'object_id', 'objectId', 'guid']) {
    if (kwargs[key] !== undefined) output[key] = kwargs[key];
  }
  if (kwargs.material !== undefined) output.material = materialName(kwargs.material);
  if (kwargs.transform instanceof SdkTransformation) output.transform = kwargs.transform.toTransform(model);
  else if (kwargs.transform) output.transform = kwargs.transform;
  if (kwargs.qa !== undefined) output.qa = kwargs.qa;
  return output;
}

const STYLE_OPTION_KEYS = [
  ['name'],
  ['display_edges', 'displayEdges'],
  ['profiles'],
  ['profile_width', 'profileWidth'],
  ['display_watermarks', 'displayWatermarks'],
  ['draw_ground', 'drawGround'],
  ['draw_sky', 'drawSky'],
  ['face_style', 'faceStyle'],
  ['background_color', 'backgroundColor'],
  ['sky_color', 'skyColor'],
  ['ground_color', 'groundColor']
];

const SHADOW_OPTION_KEYS = [
  ['display'],
  ['time'],
  ['light'],
  ['dark'],
  ['use_sun_for_shading', 'useSunForShading']
];

const RENDERING_OPTION_KEYS = [
  ['draw_hidden_geometry', 'drawHiddenGeometry'],
  ['display_color_by_layer', 'displayColorByLayer'],
  ['transparency'],
  ['draw_back_edges', 'drawBackEdges'],
  ['draw_hidden', 'drawHidden'],
  ['draw_ground', 'drawGround'],
  ['draw_horizon', 'drawHorizon'],
  ['edge_display_mode', 'edgeDisplayMode'],
  ['render_mode', 'renderMode'],
  ['face_color_mode', 'faceColorMode'],
  ['model_transparency', 'modelTransparency'],
  ['material_transparency', 'materialTransparency'],
  ['background_color', 'backgroundColor'],
  ['sky_color', 'skyColor'],
  ['ground_color', 'groundColor']
];

function normalizeFacadeOptions(source, keyGroups) {
  const output = {};
  for (const keys of keyGroups) {
    const canonical = keys[0];
    const key = keys.find((candidate) => source[candidate] !== undefined);
    if (key !== undefined) output[canonical] = facadePlainValue(source[key]);
  }
  return output;
}

function facadePlainValue(value) {
  if (value instanceof SdkColor) return value.color;
  if (value instanceof SdkPoint) return value.value;
  if (Array.isArray(value)) return value.map((item) => facadePlainValue(item));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, child] of Object.entries(value)) output[key] = facadePlainValue(child);
    return output;
  }
  return value;
}

function isFacadeOptionsObject(value) {
  return value instanceof SdkStyle || value instanceof SdkShadowInfo || value instanceof SdkRenderingOptions;
}

function facadeOptionsStaticMethod(name, method, node) {
  if (method !== 'keys' && method !== 'each_key') {
    throw new PythonSdkCompileError(`Unsupported ${name} static method: ${method}`, node);
  }
  return (name === 'RenderingOptions' ? RENDERING_OPTION_KEYS : SHADOW_OPTION_KEYS).map((keys) => keys[0]);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && value.constructor === Object;
}

function objectReferenceForFacade(value) {
  if (value instanceof SdkEntityRef) return objectReferenceForFacade(value.source);
  if (value instanceof SdkGroup || value instanceof SdkGeometryInput || value instanceof SdkComponentInstance || value instanceof SdkCurve || value instanceof SdkArcCurve) {
    const id = value.id ?? value.object_id ?? value.objectId ?? value.guid;
    return id ? { target_id: id } : { name: value.name };
  }
  if (value && typeof value === 'object') {
    const id = value.id ?? value.object_id ?? value.objectId ?? value.guid;
    if (id !== undefined) return { target_id: id };
    if (value.name !== undefined) return { name: value.name };
  }
  return { target_id: value };
}

function meshOperationFromFacade(value, kwargs, model, node, fallbackName) {
  if (value instanceof SdkPolygonMesh) return value.toMeshOperation(model, kwargs, node, fallbackName);
  if (value instanceof SdkMeshOperation) return value;
  if (value && typeof value === 'object' && Array.isArray(value.vertices) && Array.isArray(value.faces)) {
    return new SdkMeshOperation(kwargs.name ?? value.name ?? fallbackName, value.vertices, value.faces, { ...value, ...kwargs }, model, node);
  }
  if (value && typeof value === 'object' && Array.isArray(value.points) && Array.isArray(value.polygons)) {
    return new SdkMeshOperation(kwargs.name ?? value.name ?? fallbackName, value.points, value.polygons, { ...value, ...kwargs }, model, node);
  }
  throw new PythonSdkCompileError('Entities.add_faces_from_mesh/fill_from_mesh expects a PolygonMesh-like facade object', node);
}

function normalizeFollowmeSpec(value, kwargs, geometry, node) {
  const path = followmePathPoints(value, node);
  if (!Array.isArray(path) || path.length < 2) throw new PythonSdkCompileError('Face.followme expects an edge, edge list, curve, or at least two path points', node);
  return {
    path,
    ...(kwargs.name !== undefined ? { name: kwargs.name } : {}),
    ...(kwargs.material !== undefined ? { material: materialName(kwargs.material) } : {}),
    ...(kwargs.smooth !== undefined ? { smooth: kwargs.smooth } : {}),
    profile_vertices: geometry ? geometry.vertices.length : undefined
  };
}

function followmePathPoints(value, node) {
  if (value instanceof SdkEdgeRef) return [value.start.value, value.end.value];
  if (value instanceof SdkCurve) return value.points.map((point) => point instanceof SdkPoint ? point.value : normalizeRawPoint(point, 'followme curve point', node));
  if (Array.isArray(value)) {
    if (value.every((item) => item instanceof SdkEdgeRef)) {
      const points = [value[0].start.value];
      for (const edge of value) points.push(edge.end.value);
      return points;
    }
    return value.map((point) => point instanceof SdkPoint ? point.value : normalizeRawPoint(point, 'followme path point', node));
  }
  throw new PythonSdkCompileError('Face.followme expects an edge, edge list, curve, or path point list', node);
}

function normalizePositionMaterialSpec(args, kwargs, node) {
  const material = materialName(args[0] ?? kwargs.material);
  if (!material) throw new PythonSdkCompileError('Face.position_material expects a material', node);
  const rawMapping = args[1] ?? kwargs.mapping ?? kwargs.points;
  const mapping = normalizePositionMaterialMapping(rawMapping, node);
  const front = args[2] ?? kwargs.front ?? kwargs.frontside ?? true;
  return {
    material,
    front: Boolean(front),
    mapping,
    uv: mapping.map((entry) => entry.uv),
    ...(kwargs.projection !== undefined ? { projection: kwargs.projection } : {}),
    ...(kwargs.direction !== undefined ? { direction: normalizeRawPoint(kwargs.direction, 'position material direction', node) } : {})
  };
}

function normalizePositionMaterialMapping(value, node) {
  if (!Array.isArray(value) || value.length < 2) throw new PythonSdkCompileError('Face.position_material mapping expects at least two point/uv pairs', node);
  if (value.every((entry) => Array.isArray(entry) && entry.length === 2 && (entry[0] instanceof SdkPoint || Array.isArray(entry[0])) && (entry[1] instanceof SdkPoint || Array.isArray(entry[1])))) {
    return value.map(([point, uv]) => ({ point: normalizeRawPoint(point, 'position material point', node), uv: normalizeUvPair(uv, node) }));
  }
  if (value.length % 2 !== 0) throw new PythonSdkCompileError('Face.position_material flat mapping must contain model/uv point pairs', node);
  const mapping = [];
  for (let index = 0; index < value.length; index += 2) {
    mapping.push({
      point: normalizeRawPoint(value[index], 'position material point', node),
      uv: normalizeUvPair(value[index + 1], node)
    });
  }
  return mapping;
}

function normalizeUvPair(value, node) {
  const raw = value instanceof SdkPoint ? value.value : value;
  if (!Array.isArray(raw) || raw.length < 2 || !raw.slice(0, 2).every(isFiniteNumber)) {
    throw new PythonSdkCompileError('position material UV point must contain at least u/v numbers', node);
  }
  return [Number(raw[0]), Number(raw[1])];
}

function scalePositionMaterial(spec, scale) {
  return {
    ...spec,
    mapping: spec.mapping.map((entry) => ({
      point: entry.point.map((coordinate) => roundNumber(coordinate * scale, 6)),
      uv: [...entry.uv]
    })),
    uv: spec.uv.map((point) => [...point]),
    ...(spec.direction ? { direction: [...spec.direction] } : {})
  };
}

function radiansToDegrees(value, alreadyDegrees = false) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 0;
  return alreadyDegrees ? number : (number * 180) / Math.PI;
}

function normalizeNestedOperations(value, model, node) {
  if (!Array.isArray(value)) throw new PythonSdkCompileError('component definition operations must be an array', node);
  return value.flatMap((item) => {
    if (item instanceof SdkGeometryInput || item instanceof SdkMeshOperation || item instanceof SdkGroup || item instanceof SdkCurve || item instanceof SdkArcCurve || item instanceof SdkComponentInstance) {
      return normalizeModelOperation(item, model, node);
    }
    if (item && typeof item === 'object') return [toJsonCompatible(item, 'component operation')];
    throw new PythonSdkCompileError('Unsupported component operation value', node);
  });
}

function normalizeModelOperation(item, model, node) {
  if (item === null || item === undefined) return [];
  if (item instanceof SdkGeometryInput) return [item.toOperation(model)];
  if (item instanceof SdkMeshOperation) return [item.toOperation(model, node)];
  if (item instanceof SdkGroup) return objectWithPostOperations(item.toOperation(model), item, model);
  if (item instanceof SdkCurve || item instanceof SdkArcCurve) return [item.toOperation(model, node)];
  if (item instanceof SdkComponentDefinition) return [item.toOperation(model, node)];
  if (item instanceof SdkComponentInstance) return objectWithPostOperations(item.toOperation(model, node), item, model);
  if (item instanceof SdkScene) return [item.toOperation(model, node)];
  if (item instanceof SdkStyle || item instanceof SdkShadowInfo || item instanceof SdkRenderingOptions) return [item.toOperation()];
  if (item instanceof SdkEntityRef) return [];
  if (item && typeof item === 'object') return [stripUnsupportedObjectState(toJsonCompatible(item, 'operation'))];
  throw new PythonSdkCompileError('Unsupported operation value', node);
}

function objectWithPostOperations(baseOperation, source, model) {
  const stripped = stripUnsupportedObjectState(baseOperation);
  const target = {};
  if (stripped.id !== undefined) target.target_id = stripped.id;
  else if (stripped.name !== undefined) target.name = stripped.name;
  const post = [];
  if (source.tag) post.push({ op: 'assign_tag', tag: source.tag, ...target });
  if (source.visible === false) post.push({ op: 'set_visibility', visible: false, ...target });
  if (source.attributes) {
    for (const [dictionary, values] of Object.entries(source.attributes)) {
      post.push({ op: 'attribute', dictionary, attributes: facadePlainValue(values), ...target });
    }
  }
  if (source.transform && source instanceof SdkGroup) {
    post.push({ op: 'transform_object', transform: source.transform instanceof SdkTransformation ? source.transform.toTransform(model) : source.transform, ...target });
  }
  return [stripped, ...post];
}

function stripUnsupportedObjectState(operation) {
  const output = { ...operation };
  if (output.op !== 'assign_tag') delete output.tag;
  if (output.op !== 'set_visibility') delete output.visible;
  if (output.op !== 'attribute') delete output.attributes;
  return output;
}

function normalizeCamera(value, model, node) {
  if (value instanceof SdkCamera) return value.toCamera(model, node);
  return {
    eye: normalizePoint(value.eye, model.unitScale, 'scene camera eye', node),
    target: normalizePoint(value.target, model.unitScale, 'scene camera target', node),
    up: normalizePoint(value.up ?? [0, 0, 1], 1, 'scene camera up', node),
    fov: Number(value.fov ?? 35)
  };
}

function callArrayMethod(array, method, args, node) {
  if (method === 'append') {
    array.push(args[0]);
    return null;
  }
  if (method === 'extend') {
    if (!Array.isArray(args[0])) throw new PythonSdkCompileError('list.extend expects an array', node);
    array.push(...args[0]);
    return null;
  }
  if (method === 'insert') {
    array.splice(Number(args[0]), 0, args[1]);
    return null;
  }
  throw new PythonSdkCompileError(`Unsupported list method: ${method}`, node);
}

function callDictMethod(object, method, args, node) {
  switch (method) {
    case 'keys':
      return Object.keys(object);
    case 'values':
      return Object.values(object);
    case 'items':
      return Object.entries(object);
    case 'get': {
      const key = args[0];
      return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : (args.length > 1 ? args[1] : null);
    }
    case 'update': {
      const source = args[0] ?? {};
      if (!isPlainObject(source)) throw new PythonSdkCompileError('dict.update expects a plain object', node);
      Object.assign(object, source);
      return null;
    }
    default:
      throw new PythonSdkCompileError(`Unsupported dict method: ${method}`, node);
  }
}

function normalizeIterable(value, node) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [...value];
  if (value instanceof SdkCollectionProxy || value instanceof SdkEntitiesProxy) return value.items;
  if (value instanceof SdkSelectionProxy) return value.targets;
  if (isPlainObject(value)) return Object.keys(value);
  throw new PythonSdkCompileError('Expected a list, tuple, dict, or string iterable', node);
}

function collectionLength(value) {
  if (Array.isArray(value) || typeof value === 'string') return value.length;
  if (value instanceof SdkCollectionProxy || value instanceof SdkEntitiesProxy) return value.items.length;
  if (value instanceof SdkSelectionProxy) return value.targets.length;
  if (isPlainObject(value)) return Object.keys(value).length;
  return 0;
}

function subscriptValue(object, key, node) {
  if (key?.__slice) return applySlice(object, key, node);
  if (object instanceof SdkCollectionProxy) return object.getItem(key);
  if (isFacadeOptionsObject(object)) return object.options[key] ?? null;
  if (Array.isArray(object) || typeof object === 'string') {
    const index = normalizeIndex(key, object.length, node);
    return object[index];
  }
  if (isPlainObject(object)) return object[key];
  return object?.[key];
}

function assignSubscriptValue(object, key, value, node) {
  if (key?.__slice) throw new PythonSdkCompileError('Slice assignment is not supported in Python SDK facade', node);
  if (isFacadeOptionsObject(object)) {
    object.options[key] = facadePlainValue(value);
    return;
  }
  if (Array.isArray(object)) {
    object[normalizeIndex(key, object.length, node)] = value;
    return;
  }
  if (!object || typeof object !== 'object') throw new PythonSdkCompileError('Subscript assignment expects a mutable list or dict', node);
  object[key] = value;
}

function applySlice(object, slice, node) {
  if (!Array.isArray(object) && typeof object !== 'string') {
    throw new PythonSdkCompileError('Slices are only supported on lists, tuples, and strings', node);
  }
  const length = object.length;
  const step = slice.step === undefined ? 1 : Number(slice.step);
  if (!Number.isInteger(step) || step === 0) throw new PythonSdkCompileError('Slice step must be a non-zero integer', node);
  const lower = slice.lower === undefined ? (step > 0 ? 0 : length - 1) : normalizeSliceIndex(slice.lower, length);
  const upper = slice.upper === undefined ? (step > 0 ? length : -1) : normalizeSliceIndex(slice.upper, length);
  const output = [];
  if (step > 0) {
    for (let index = lower; index < upper; index += step) output.push(object[index]);
  } else {
    for (let index = lower; index > upper; index += step) output.push(object[index]);
  }
  return typeof object === 'string' ? output.join('') : output;
}

function normalizeIndex(index, length, node) {
  const number = Number(index);
  if (!Number.isInteger(number)) throw new PythonSdkCompileError('List index must be an integer', node);
  return number < 0 ? length + number : number;
}

function normalizeSliceIndex(index, length) {
  const number = Number(index);
  if (!Number.isInteger(number)) return 0;
  if (number < 0) return Math.max(-1, length + number);
  return Math.min(length, number);
}

function makeRange(args, node) {
  const [start, stop, step] = args.length === 1 ? [0, args[0], 1] : [args[0], args[1], args[2] ?? 1];
  if (![start, stop, step].every(isFiniteNumber) || Number(step) === 0) {
    throw new PythonSdkCompileError('range expects finite numeric arguments and a non-zero step', node);
  }
  const values = [];
  if (step > 0) {
    for (let value = Number(start); value < Number(stop); value += Number(step)) values.push(value);
  } else {
    for (let value = Number(start); value > Number(stop); value += Number(step)) values.push(value);
  }
  return values;
}

function makeEnumerate(args, node) {
  const values = normalizeIterable(args[0], node);
  const start = Number(args[1] ?? 0);
  if (!Number.isInteger(start)) throw new PythonSdkCompileError('enumerate start must be an integer', node);
  return values.map((value, index) => [start + index, value]);
}

function makeZip(args, node) {
  const iterables = args.map((arg) => normalizeIterable(arg, node));
  if (!iterables.length) return [];
  const length = Math.min(...iterables.map((iterable) => iterable.length));
  const output = [];
  for (let index = 0; index < length; index += 1) output.push(iterables.map((iterable) => iterable[index]));
  return output;
}

function makeDict(args, kwargs, node) {
  const output = {};
  if (args.length > 1) throw new PythonSdkCompileError('dict expects at most one positional argument', node);
  if (args.length === 1) {
    const source = args[0];
    if (isPlainObject(source)) Object.assign(output, source);
    else {
      for (const pair of normalizeIterable(source, node)) {
        if (!Array.isArray(pair) || pair.length !== 2) throw new PythonSdkCompileError('dict iterable entries must be key/value pairs', node);
        output[pair[0]] = pair[1];
      }
    }
  }
  Object.assign(output, kwargs);
  return output;
}

function compareSortableValues(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

function compareValues(operator, left, right) {
  switch (operator) {
    case 'Eq':
      return left === right;
    case 'NotEq':
      return left !== right;
    case 'Lt':
      return left < right;
    case 'LtE':
      return left <= right;
    case 'Gt':
      return left > right;
    case 'GtE':
      return left >= right;
    case 'In':
      return Array.isArray(right) ? right.includes(left) : left in right;
    case 'NotIn':
      return Array.isArray(right) ? !right.includes(left) : !(left in right);
    default:
      throw new PythonSdkCompileError(`Unsupported comparison operator: ${operator}`);
  }
}

function normalizeColor(value) {
  if (value instanceof SdkColor) return { color: value.color, alpha: value.alpha };
  if (typeof value === 'string') return { color: value };
  if (Array.isArray(value) && value.length >= 3) {
    return {
      color: `#${value.slice(0, 3).map((item) => clampByte(item).toString(16).padStart(2, '0')).join('')}`,
      alpha: value[3]
    };
  }
  return { color: '#cccccc' };
}

function materialName(value) {
  if (value instanceof SdkMaterial) return value.name;
  return value;
}

function colorSpec(value) {
  if (value instanceof SdkColor) return value.color;
  return value;
}

function textureSpec(value) {
  if (value instanceof SdkTexture) return value.toSpec();
  if (value instanceof SdkImageReference) return { path: value.path, ...(value.width !== undefined ? { width: Number(value.width) } : {}), ...(value.height !== undefined ? { height: Number(value.height) } : {}) };
  return value;
}

function componentDefinitionName(value, node) {
  if (value instanceof SdkComponentDefinition) return value.name;
  return requiredString(value, 'component definition', node);
}

function normalizePoints(value, scale, label, node) {
  if (!Array.isArray(value)) throw new PythonSdkCompileError(`${label} must be an array`, node);
  return value.map((point) => normalizePoint(point, scale, label, node));
}

function normalizePoint(value, scale, label, node) {
  if (value instanceof SdkPoint) value = value.value;
  return normalizeRawPoint(value, label, node).map((coordinate) => roundNumber(Number(coordinate) * scale, 6));
}

function normalizeRawPoint(value, label, node) {
  if (value instanceof SdkPoint) value = value.value;
  if (!Array.isArray(value) || value.length < 2 || value.length > 3 || !value.every(isFiniteNumber)) {
    throw new PythonSdkCompileError(`${label} must be a 2D or 3D numeric point`, node);
  }
  return value.length === 2 ? [Number(value[0]), Number(value[1]), 0] : value.map(Number);
}

function normalizeNumericArray(value, length, scale, label, node) {
  if (!Array.isArray(value) || value.length !== length || !value.every(isFiniteNumber)) {
    throw new PythonSdkCompileError(`${label} must be a ${length}-number array`, node);
  }
  return value.map((item) => roundNumber(Number(item) * scale, 6));
}

function scaleNumber(value, scale, label, node) {
  if (!isFiniteNumber(value)) throw new PythonSdkCompileError(`${label} must be a finite number`, node);
  return roundNumber(Number(value) * scale, 6);
}

function uniqueIndices(loops) {
  const seen = new Set();
  const result = [];
  for (const loop of loops) {
    for (const index of loop) {
      if (seen.has(index)) continue;
      seen.add(index);
      result.push(index);
    }
  }
  return result;
}

function faceNormal(points) {
  if (points.length < 3) return [0, 0, 1];
  const [a, b, c] = points;
  return normalizeVector3(cross3(subtract3(b, a), subtract3(c, a)));
}

function facePlane(points, normal = faceNormal(points)) {
  const point = points[0] || [0, 0, 0];
  return [
    roundNumber(normal[0], 6),
    roundNumber(normal[1], 6),
    roundNumber(normal[2], 6),
    roundNumber(-dot3(normal, point), 6)
  ];
}

function polygonArea3d(points) {
  if (points.length < 3) return 0;
  let sum = [0, 0, 0];
  for (let index = 0; index < points.length; index += 1) {
    sum = add3(sum, cross3(points[index], points[(index + 1) % points.length]));
  }
  return vectorLength(sum) / 2;
}

function distance3d(a, b) {
  return vectorLength(subtract3(a, b));
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vectorLength(value) {
  return Math.sqrt(dot3(value, value));
}

function normalizeVector3(value) {
  const length = vectorLength(value);
  if (length <= 1e-12) return [0, 0, 1];
  return value.map((item) => roundNumber(item / length, 6));
}

function requiredString(value, label, node) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PythonSdkCompileError(`${label} must be a non-empty string`, node);
  }
  return value;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value))));
}

function roundNumber(value, digits = 6) {
  const factor = 10 ** Number(digits || 0);
  const rounded = Math.round(Number(value) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function toJsonCompatible(value, path) {
  if (value === undefined) return undefined;
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (value instanceof SdkPoint) return value.value;
  if (value instanceof SdkColor) return value.alpha === undefined ? value.color : { color: value.color, alpha: value.alpha };
  if (value instanceof SdkMaterial) return value.toOperation();
  if (value instanceof SdkGeometryInput) return value.toOperation(new SdkModel());
  if (value instanceof SdkFaceInput || value instanceof SdkLoopRef || value instanceof SdkEdgeRef) return value.toJson();
  if (value instanceof SdkEntityRef) return value.toJson();
  if (value instanceof SdkComponentDefinition || value instanceof SdkComponentInstance) return value.toJson();
  if (value instanceof SdkCamera || value instanceof SdkScene || value instanceof SdkStyle || value instanceof SdkShadowInfo || value instanceof SdkRenderingOptions) return value.toJson();
  if (value instanceof SdkLayer || value instanceof SdkTexture || value instanceof SdkImageReference) return value.toJson();
  if (value instanceof SdkCurve || value instanceof SdkArcCurve) return value.toJson();
  if (Array.isArray(value)) return value.map((item, index) => toJsonCompatible(item, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    if (value instanceof SdkClassRef || value instanceof SdkCollectionProxy || value instanceof SdkModel) {
      throw new PythonSdkCompileError(`${path} is not JSON-compatible`);
    }
    const output = {};
    for (const [key, child] of Object.entries(value)) output[key] = toJsonCompatible(child, `${path}.${key}`);
    return output;
  }
  throw new PythonSdkCompileError(`${path} is not JSON-compatible`);
}

function normalizeLimits(options = {}) {
  return {
    maxOperations: positiveInteger(options.maxOperations, DEFAULT_LIMITS.maxOperations, 'maxOperations'),
    maxLoopIterations: positiveInteger(options.maxLoopIterations, DEFAULT_LIMITS.maxLoopIterations, 'maxLoopIterations'),
    maxFunctionDepth: positiveInteger(options.maxFunctionDepth, DEFAULT_LIMITS.maxFunctionDepth, 'maxFunctionDepth'),
    maxStatements: positiveInteger(options.maxStatements, DEFAULT_LIMITS.maxStatements, 'maxStatements'),
    maxOutputBytes: positiveInteger(options.maxOutputBytes, DEFAULT_LIMITS.maxOutputBytes, 'maxOutputBytes'),
    timeoutMs: positiveInteger(options.timeoutMs ?? options.pythonTimeoutMs, DEFAULT_LIMITS.timeoutMs, 'timeoutMs')
  };
}

function positiveInteger(value, fallback, field) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new PythonSdkCompileError(`${field} must be a positive integer`);
  return number;
}
