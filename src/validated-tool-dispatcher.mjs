import { callTool } from './bridge.mjs';
import { listToolDefinitions } from './tool-registry.mjs';
import { ToolInputValidator } from './tool-input-validator.mjs';

export class ValidatedToolDispatcher {
  constructor({ bridge, toolRegistry = listToolDefinitions(), invoke } = {}) {
    this.bridge = bridge;
    this.toolRegistry = toolRegistry;
    this.validator = new ToolInputValidator(toolRegistry);
    this.invoke = invoke || ((name, args) => callTool(name, args, this.bridge));
  }

  async dispatch(name, args = {}, context = {}) {
    const validated = this.validator.validate(name, args);
    return this.invoke(name, validated, context);
  }
}
