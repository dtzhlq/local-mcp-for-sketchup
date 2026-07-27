import Ajv2020 from 'ajv/dist/2020.js';
import { AgentContractError } from './agent-contract.mjs';

export class ToolInputValidator {
  constructor(toolRegistry = []) {
    if (!Array.isArray(toolRegistry)) throw new TypeError('toolRegistry must be an array.');
    this.registry = new Map();
    const ajv = new Ajv2020({ allErrors: true, strict: false, coerceTypes: false, useDefaults: false });
    for (const definition of toolRegistry) {
      const name = String(definition?.name || '');
      if (!name) throw new TypeError('Every tool definition must have a name.');
      if (this.registry.has(name)) throw new TypeError(`Duplicate tool definition: ${name}`);
      const schema = failClosedTopLevelSchema(definition.inputSchema);
      this.registry.set(name, { definition, schema, validate: ajv.compile(schema) });
    }
  }

  has(name) {
    return this.registry.has(String(name || ''));
  }

  assertKnown(name) {
    const normalized = String(name || '');
    if (!this.registry.has(normalized)) {
      throw new AgentContractError('INVALID_ARGUMENT', 'The requested tool is not registered.', {
        details: { tool_name: normalized || null, issues: [{ path: '', keyword: 'registered_tool', message: 'must name a registered tool' }] }
      });
    }
    return this.registry.get(normalized).definition;
  }

  validate(name, input = {}) {
    const definition = this.assertKnown(name);
    const entry = this.registry.get(definition.name);
    if (!entry.validate(input)) {
      throw new AgentContractError('INVALID_ARGUMENT', 'The tool input does not match its registered schema.', {
        details: {
          tool_name: definition.name,
          issues: normalizeValidationErrors(entry.validate.errors)
        }
      });
    }
    return input;
  }

  schemaFor(name) {
    this.assertKnown(name);
    return structuredClone(this.registry.get(String(name)).schema);
  }
}

export function failClosedTopLevelSchema(inputSchema) {
  const schema = structuredClone(inputSchema || { type: 'object', properties: {} });
  if (!schema.type && schema.properties) schema.type = 'object';
  if (schema.type === 'object' && schema.additionalProperties === undefined) schema.additionalProperties = false;
  return schema;
}

function normalizeValidationErrors(errors = []) {
  return errors.map((error) => ({
    path: String(error.instancePath || ''),
    keyword: String(error.keyword || 'schema'),
    message: String(error.message || 'does not match the registered schema'),
    ...(error.keyword === 'additionalProperties' && error.params?.additionalProperty
      ? { field: String(error.params.additionalProperty) }
      : {})
  }));
}
