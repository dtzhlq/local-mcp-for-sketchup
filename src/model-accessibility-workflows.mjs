import { AgentContractError } from './agent-contract.mjs';
import { getModelAccessibilityTaskCatalog } from './model-accessibility-tasks.mjs';

export const MODEL_ACCESSIBILITY_WORKFLOWS_VERSION = 'model-accessibility-workflows.v1';

// Entries are usable inspection/input-collection calls, never mutation examples
// with invented target paths, approval material, asset paths, or design values.
const inspect = instruction => ({ tool: 'start_agent_task', arguments: {
  intent: 'understand_model', instruction, inputs: { runtime: 'queue', include_entities: false }
} });
const designInput = instruction => ({ tool: 'start_agent_task', arguments: {
  intent: 'modify_design_parameters', instruction, inputs: { runtime: 'queue', save_model: false }
} });
const capabilityProbe = { tool: 'start_agent_task', arguments: { intent: 'discover', instruction: 'Read native runtime capabilities and current document identity.', inputs: { topic: 'connect', runtime: 'queue' } } };
const operation = (op, fields) => ({ op, fields });
const toolContract = (tool, fields) => ({ tool, fields });

const WORKFLOWS = [
  {
    task: 'asset_query', task_number: 5, title: '查询本地资产', support: 'expert_read_only',
    semantics: '查询来源、许可、轴向、层级、材料及本地可用性。默认目录含项目参数配方，配方源码路径不能当作 SKP 导入。',
    required_design_inputs: ['搜索词；使用外部本地目录时需给 catalog_path。'],
    entry_kind: 'catalog_query', entry: { tool: 'query_assets', arguments: { query: 'window', limit: 3 } },
    execution_route: { tools: [toolContract('query_assets', ['catalog_path', 'query', 'kind', 'limit'])], operations: [] },
    verification: ['读取实际文件类型及可用性；尺寸缺失时需导入后测量。'],
    limits: ['许可未知、catalog 声明或哈希匹配均不等于可用授权或原生几何验收。', '不自动购买或下载资产。']
  },
  {
    task: 'asset_import', task_number: 6, title: '保留根组件导入与放置', support: 'gateway_reviewed_native_asset',
    semantics: '通过 reviewed_existing_model_edit 的 asset_edit 将服务端目录内 SKP 加载为完整根组件；加载、保持原尺寸、世界 Z 旋转和根原点放置在一个受审原子事务内执行。',
    required_design_inputs: ['从 discover assets 取得服务端目录中的精确 asset ID。', 'placement.origin_mm 三个世界坐标；placement.rotation_z_deg 绕世界 +Z 的角度。'],
    entry_kind: 'inspect', entry: inspect('Inspect the active model before importing a complete asset root; do not modify it.'),
    execution_route: { tools: [toolContract('start_agent_task', ['intent', 'instruction', 'inputs', 'idempotency_key'])],
      gateway_intent: 'reviewed_existing_model_edit', gateway_inputs: ['asset_edit', 'runtime', 'save_model', 'connection_task_id'],
      asset_edit_contract: { version: 1, mode: 'place', asset: { required: ['id'], catalog: 'server-configured native catalog; caller paths rejected' }, placement: { required: ['origin_mm', 'rotation_z_deg'], units: 'mm and degrees', scale: 'original source size; no scale field' } },
      operations: [operation('place_component_asset', ['source_path', 'source_sha256', 'source', 'license', 'id', 'name', 'origin', 'rotateZ', 'confirmed'])] },
    verification: ['用返回的原生根实例身份重新读取层级、真实尺寸和材料；比对已有对象。'],
    limits: ['服务端必须配置真实 SKP 目录；配方源码或缺失的 stool 不能冒充原生资产。源 SHA 不匹配、来源或许可缺失会阻止操作。', '须取得现有 reviewed 批准与新鲜连接；confirmed 不替代主机批准。新 ID 由服务器生成，不爆炸、不写源文件。', '事务完成仍需独立近景、测量、编辑边界和 SKP 交付证据；不能借用 create_model 的质量通过。']
  },
  {
    task: 'array_align', task_number: 7, title: '排列与对齐构件', support: 'expert_preparation_then_reviewed',
    semantics: '先定义坐标轴、锚点与间距，再计算每个位置。新实例复用同一 definition；移动已有对象必须限定实际实例目标。',
    required_design_inputs: ['目标实例或共享定义、数量。', '世界或局部坐标、排列轴、起点、中心距或净距。', '对齐对象及 min/center/max 锚点；明确保留项。'],
    entry_kind: 'inspect', entry: inspect('Inspect component identities, bounds and shared definitions before arranging or aligning them.'),
    execution_route: { tools: [toolContract('start_agent_task', ['intent', 'instruction', 'inputs'])], operations: [
      operation('component_instance', ['id', 'name', 'definition', 'origin', 'transform']),
      operation('duplicate_entity', ['entity_path', 'new_id', 'new_name', 'translate']),
      operation('transform_object', ['entity_path', 'translate', 'pivot'])] },
    verification: ['实测间距、锚点、朝向、共享定义和交叠；确认未选中对象保持。'],
    limits: ['没有通用 align/array Gateway intent。先计算明确变换，再进入 reviewed_existing_model_edit。', '相同名称不能证明共享定义；净距须从变换后的实际几何计算。']
  },
  {
    task: 'resize_single', task_number: 8, title: '修改单个实例尺寸', support: 'guided_parameter_review',
    semantics: '参数重编译只替换明确选中的实例定义，保持同伴实例。改变板件尺寸不能仅用整体缩放冒充参数修改。',
    required_design_inputs: ['parameter_edit.creation_task_id 为服务器可信创建来源，scope:single。', 'parameter_edit.changes 为已声明参数，targets 只含一个真实 target_id 或 entity_path；新鲜 connection_task_id。'],
    entry_kind: 'request_missing_design_inputs', entry: designInput('Prepare a parameter change for exactly one instance; retain all unselected linked instances.'),
    execution_route: { tools: [toolContract('start_agent_task', ['intent', 'instruction', 'inputs'])],
      gateway_intent: 'modify_design_parameters', gateway_inputs: ['parameter_edit', 'runtime', 'connection_task_id', 'saved_delivery_task_id'],
      operations: [operation('replace_component_definition', ['entity_path', 'definition', 'confirmed'])] },
    verification: ['实测目标尺寸、同伴尺寸、宿主洞口、细节规格和无关对象指纹。'],
    limits: ['entry 只创建缺输入任务；完整参数模板可从 discover workflows task_name=edit_single 内联取得。', '缺失或发生人工/外部修改的基线必须阻止，不通过当前几何重建来源。', '需要主机审查；磁盘重开后显式提供 saved_delivery_task_id。修改后用 creation_task_id+parameter_task_id 冻结复核，不能复用旧质量通过。']
  },
  {
    task: 'resize_linked', task_number: 9, title: '修改全部明确关联实例', support: 'guided_parameter_review',
    semantics: '全部指同一真实共享定义的完整实例集合，必须明确其全局数量。不同名称或相似外观不建立关联。',
    required_design_inputs: ['parameter_edit.creation_task_id、scope:all、changes 和新鲜 connection_task_id。', 'parameter_edit.targets 必须包含真实共享定义的全部显式实例；局部数量须与全局数量一致。'],
    entry_kind: 'request_missing_design_inputs', entry: designInput('Prepare a parameter change for every explicitly bound instance of one shared definition; require complete coverage.'),
    execution_route: { tools: [toolContract('start_agent_task', ['intent', 'instruction', 'inputs'])],
      gateway_intent: 'modify_design_parameters', gateway_inputs: ['parameter_edit', 'runtime', 'connection_task_id', 'saved_delivery_task_id'],
      operations: [operation('replace_component_definition', ['entity_path', 'definition', 'confirmed'])] },
    verification: ['逐实例核对新尺寸和保留关系，未关联定义与人工修改保持。'],
    limits: ['entry 只请求缺失输入；完整参数模板可从 discover workflows task_name=edit_linked 内联取得。', '缺失或嵌套实例、陈旧/人工修改基线均使该装配路线受阻；不把名称或外观相同当作关联。', '主机审查、保存后来源恢复和新的冻结质量复核仍需实际执行。']
  },
  {
    task: 'replace_asset', task_number: 10, title: '替换一个资产实例', support: 'gateway_reviewed_native_asset',
    semantics: '同一个受审事务从服务端目录加载新 SKP 完整定义，并只改变唯一根 ComponentInstance 的 definition 绑定。保留实例身份、精确变换、人工属性及同伴定义；不删除重建。',
    required_design_inputs: ['服务端资产目录的精确 asset ID；target.entity_path 为单个根 pid 路径，或 target.target_id 为唯一根 ID。', 'placement.origin_mm 与 rotation_z_deg 必须符合目标现有刚体变换；不推测缩放或重新定位。'],
    entry_kind: 'inspect', entry: inspect('Inspect the exact asset instance, shared definition and placement before preparing a single-instance replacement.'),
    execution_route: { tools: [toolContract('start_agent_task', ['intent', 'instruction', 'inputs'])],
      gateway_intent: 'reviewed_existing_model_edit', gateway_inputs: ['asset_edit', 'runtime', 'save_model', 'connection_task_id'],
      asset_edit_contract: { version: 1, mode: 'replace', asset: { required: ['id'], catalog: 'server-configured native catalog; caller paths rejected' }, target: { exactly_one: ['entity_path', 'target_id'], entity_path: 'pid:<positive root persistent ID>; no nested path' }, placement: { required: ['origin_mm', 'rotation_z_deg'], units: 'mm and degrees', meaning: 'assert existing rigid placement; no transform modification' } },
      operations: [operation('replace_component_asset', ['entity_path', 'source_path', 'source_sha256', 'source', 'license', 'origin', 'rotateZ', 'confirmed'])] },
    verification: ['目标 persistent identity、变换和预定锚点保持；同伴根对象、材料和层级未变。'],
    limits: ['新资产通过目录 ID 选择；不接收模型任意文件路径，不接受嵌套、锁定、粘接或缩放目标。', 'confirmed 不替代主机批准；源 SHA、既有对象/材料指纹或目标变换不符时原子回滚。', '不同资产局部原点可能影响实物对齐；根原点保持不自动证明桌面中心关系，仍需独立测量和质量验收。']
  },
  {
    task: 'mirror_layout', task_number: 11, title: '镜像小型布局', support: 'expert_preparation_then_reviewed',
    semantics: '明确镜像轴及平面原点。新组件放置顺序为局部镜像负比例→Z 旋转→origin 加平移；既有对象使用显式 transform_object。',
    required_design_inputs: ['全部待镜像实例路径、镜像轴与平面原点。', '移动原对象或创建副本，以及门扇开启与保留要求。'],
    entry_kind: 'inspect', entry: inspect('Inspect the layout target instances, axes and bounds before preparing a mirror operation.'),
    execution_route: { tools: [toolContract('start_agent_task', ['intent', 'instruction', 'inputs'])], operations: [
      operation('component_instance', ['id', 'name', 'definition', 'origin', 'transform']),
      operation('transform_object', ['entity_path', 'mirror', 'pivot', 'translate', 'rotateZ'])],
      mirror_values: ['x', 'y', 'z'], existing_transform_coordinates: 'model' },
    verification: ['核对门窗开启、正反面、部件朝向、通道及真实交叠，保留无关对象。'],
    limits: ['transform.mirror 用于 component_instance；不要添加到任意 primitive。', '已有对象的 pivot 必须明确；局部矩阵与世界镜像不能混用。']
  },
  {
    task: 'native_pbr', task_number: 12, title: '原生 PBR 与真实纹理尺度', support: 'guided_native_appearance_review',
    semantics: 'apply_native_appearance 为唯一根对象创建专用预设材质，对全部明确直接面写原生通道和 UV。毫米重复尺寸，rotation 为绕面法向角度；共享定义拒绝自动扩散。',
    required_design_inputs: ['唯一目标 target、预设 preset、texture_size_mm:[宽,高]、rotation。', '主机已配置许可/哈希明确的材质目录与真实 .style。'],
    entry_kind: 'capability_probe', entry: capabilityProbe,
    prepare_example: { tool: 'start_agent_task', arguments: { intent: 'apply_native_appearance', instruction: '只给 P 应用木材，保持其他对象；准备原生回读、近景与独立 SKP。', idempotency_key: 'pbr-P-wood-750-v1', inputs: { runtime: 'queue', appearance: { kind: 'native_pbr', target: 'P', preset: 'wood', texture_size_mm: [750, 750], rotation: 30 } } } },
    execution_route: { tools: [toolContract('start_agent_task', ['intent', 'instruction', 'idempotency_key', 'inputs']), toolContract('submit_agent_task_input', ['task_id', 'idempotency_key', 'input']), toolContract('resume_agent_task', ['task_id'])],
      steps: ['start 返回具体受审计划；示例要求 P 已真实存在。', '本地主机批准后重新 discover/connect；向原 task_id submit input:{connection_task_id}，保留稳定幂等键。', '成功路径原生回读、严格恢复截图、保存服务器唯一新 SKP；unknown 只 resume，禁止重放。'], operations: [
      operation('material', ['name', 'workflow', 'texture', 'pbr']),
      operation('set_material', ['entity_path', 'material', 'instance_policy']),
      operation('style_load', ['name', 'path', 'activate']),
      operation('texture_transform', ['entity_path', 'material', 'projection', 'texture_size_mm', 'rotation', 'side', 'face_selector'])],
      workflow_value: 'pbr_metallic_roughness' },
    verification: ['读取实际 native getter 与 face UV；近景检查方向、尺度和通道效果后保存交付。仅明确要求时做重开复核。'],
    limits: ['执行仍需服务端批准和新鲜 Session Contract；不能由模型提交 approval_token。', '真实贴图/PBR getter/UV 不符即失败；纹理及来源哈希执行前后复核。', '.style 文件名不证明 Photoreal；原生显示与视觉审查、冷重开仍待实际验证。capture_current_display:true 仅保存已启用的当前显示。']
  },
  {
    task: 'native_hdr', task_number: 13, title: 'HDR 环境与场景外观', support: 'guided_native_appearance_review',
    semantics: 'apply_native_appearance 用目录 HDR 创建新环境，保留当前相机并绑定新场景/风格。intensity 同时写 skydome_exposure 和 reflection_exposure，已有场景不覆盖。',
    required_design_inputs: ['目录 environment（如 studio/daylight）、rotation、intensity（0..10）、新 scene_name。', '主机已配置许可/哈希明确的 HDR 目录与真实 .style。'],
    entry_kind: 'capability_probe', entry: capabilityProbe,
    prepare_example: { tool: 'start_agent_task', arguments: { intent: 'apply_native_appearance', instruction: '保持几何，准备新的 HDR 验收场景、原生近景和独立 SKP。', idempotency_key: 'hdr-studio-review-v1', inputs: { runtime: 'queue', appearance: { kind: 'native_hdr', environment: 'studio', rotation: 30, intensity: 1, scene_name: '验收外观' } } } },
    execution_route: { tools: [toolContract('start_agent_task', ['intent', 'instruction', 'idempotency_key', 'inputs']), toolContract('submit_agent_task_input', ['task_id', 'idempotency_key', 'input']), toolContract('resume_agent_task', ['task_id'])],
      steps: ['start 创建具体受审计划；等待本地主机批准。', '重新 discover/connect，向原 task_id submit input:{connection_task_id}，使用稳定幂等键。', '原生环境/场景/风格回读与几何保持后截图、保存新 SKP；unknown 只 resume，不重新执行。'], operations: [
      operation('environment_define', ['name', 'path', 'rotation', 'skydome_exposure', 'reflection_exposure', 'use_as_skydome', 'use_for_reflections']),
      operation('environment_activate', ['environment_ref']),
      operation('style_load', ['name', 'path', 'activate']),
      operation('scene', ['name', 'use_camera', 'environment_ref', 'use_environment', 'style_ref'])] },
    verification: ['读取实际原生环境、style 与 rendering options，截图后恢复原视图并保存交付。仅明确要求时做重开比较。'],
    limits: ['原生环境要求 SketchUp 2025+，完整恢复要求 2025.0.2+，以新鲜能力回执为准。', '本地目录文件存在与受审操作成功均不等于视觉或冷重开验收；quality_accepted 保持 false 待审。', '不能从文件名推断 Photoreal；capture_current_display:true 仅保存已经启用的当前原生显示。']
  },
  {
    task: 'local_repair', task_number: 14, title: '根据缺陷局部修正', support: 'guided_recovery_then_reviewed_edit',
    semantics: '先恢复原 task_id 和冻结规格，确认已提交状态。新增缺件与修改已有部件分流；已有部件修正走受审编辑，不能重放整个创建。',
    required_design_inputs: ['真实原 task_id、具体失败部件/视图/净空及缺陷证据。', '拟修正范围、需保留项；缺设计信息时由用户补足。'],
    entry_kind: 'inspect', entry: inspect('Inspect the current model before local defect repair; preserve existing objects and manual changes.'),
    execution_route: { tools: [toolContract('resume_agent_task', ['task_id']),
      toolContract('submit_agent_task_input', ['task_id', 'idempotency_key', 'input']),
      toolContract('start_agent_task', ['intent', 'instruction', 'inputs'])],
      creation_input_fields: ['refinement_code', 'refinement_part_ids', 'reverify', 'reviewed_edit_task_id'],
      preferred_first_step: '已有 task_id 时直接 resume_agent_task；entry 仅用于尚无恢复标识时的只读检查。', operations: [] },
    verification: ['继续使用服务端原冻结质量要求，复核缺陷及未选中对象；不修改历史失败为通过。'],
    limits: ['单部件最多连续自动修正三轮；耗尽后保留成果与失败原因，停止自动重试。', '响应不确定时查询原任务/回执，不能换幂等键盲目重建。']
  },
  {
    task: 'save_reopen', task_number: 15, title: '保存重开并继续参数修改', support: 'guided_saved_document_lifecycle_then_parameter_rebinding',
    semantics: 'deliver_model 保存已通过原生质量的创建或冻结验证结果；reopen_delivered_model 仅关闭该交付的原生文档并从同一文件重开，旧handle失效、新doc、文件SHA与完整revision都需实测。',
    required_design_inputs: ['保存：source_task_id、新鲜 connection_task_id、runtime:queue、稳定 idempotency_key。', '关闭/重开：saved_delivery_task_id 为原保存task；当前必须仍是确切已保存文档、未修改，再提供新鲜connection及稳定key。'],
    entry_kind: 'inspect', entry: inspect('Inspect the current model identity and state before saving a version and validating a real disk reopen.'),
    execution_route: { tools: [toolContract('start_agent_task', ['intent', 'instruction', 'idempotency_key', 'inputs']),
      toolContract('submit_agent_task_input', ['task_id', 'idempotency_key', 'input']), toolContract('resume_agent_task', ['task_id'])],
      gateway_save: { intent: 'deliver_model', inputs: ['runtime', 'source_task_id', 'connection_task_id'], runtime: 'queue',
        required_source: 'completed queue creation or signed frozen verification with unchanged identity/revision and live quality pass' },
      gateway_reopen: { intent: 'reopen_delivered_model', inputs: ['runtime', 'saved_delivery_task_id', 'connection_task_id'], runtime: 'queue',
        required_source: 'exact server saved receipt; no caller path, snapshot or direct session contract' },
      steps: ['保存后重新discover/connect，再start reopen_delivered_model。', '若pending_mdi_activation，激活已打开的目标窗口，然后resume只读确认；不要再open/close。', '后续新建modify_design_parameters：inputs.saved_delivery_task_id及parameter_edit.creation_task_id绑定原创建任务；先重新连接。重开本身不声称参数已rebind。'], operations: [] },
    verification: ['精确旧handle失效、新document及runtimeobject、同文件SHA/字节、完整revision与未修改状态；参数修改及原生外观另行验证。'],
    limits: ['deliver_model 的 cold_reopen_verified=false；单独重开任务只在真实证据齐全时变为true，不代表应用重启、视觉或release通过。',
      '保存无凭据不再保存；重开started无native-return不再close，已完成receipt仅验签与文件恢复。resume不发起首次关闭。',
      '只支持已安装兼容原生插件的macOS；源任务一经声明冻结，dirty/身份/revision/文件变更先拒绝，不丢弃修改。']
  }
];

const BY_TASK = new Map(WORKFLOWS.map(item => [item.task, item]));
const ALIASES = Object.freeze({
  query_assets: 'asset_query', import_asset: 'asset_import', arrange: 'array_align', align: 'array_align',
  modify_single_instance: 'resize_single', modify_all_instances: 'resize_linked', asset_replace: 'replace_asset',
  mirror: 'mirror_layout', pbr: 'native_pbr', hdr: 'native_hdr', repair: 'local_repair', resume: 'save_reopen'
});

export function getModelAccessibilityWorkflows({ task } = {}) {
  const header = { version: MODEL_ACCESSIBILITY_WORKFLOWS_VERSION, kind: 'model_accessibility_workflows', units: 'mm' };
  if (task === undefined || task === 'all') return {
    ...header,
    workflows: WORKFLOWS.map(({ task, task_number, title, support }) => ({ task, task_number, title, support })),
    selection: 'Request one task for its real entry call, required inputs and execution limits.',
    assurance: 'Workflow contracts do not establish model success rates or live acceptance.'
  };
  if (typeof task !== 'string' || !task.trim()) throw invalidTask();
  const name = task.trim();
  const workflow = BY_TASK.get(ALIASES[name] || name) || WORKFLOWS.find(item => String(item.task_number) === name);
  if (!workflow) throw invalidTask();
  return {
    ...header, ...structuredClone(workflow),
    entry_is_complete_mutation_example: false,
    execution_allowed_by_this_document: false,
    authorization: 'Use server-issued review and session bindings; client claims and confirmed fields never authorize an edit.'
  };
}

function invalidTask() {
  return new AgentContractError('INVALID_ARGUMENT', 'Choose a listed modeling workflow task.', {
    details: { field: 'task', supported_tasks: WORKFLOWS.map(item => item.task) }
  });
}

// The four-tool entry uses a separate small, flat contract. The expanded expert
// reference above remains available without making its artifact a prerequisite.
const GUIDED_TASKS = Object.freeze(['window', 'door', 'cabinet', 'sink_counter', 'asset_query', 'asset_place', 'array_align', 'edit_single', 'edit_linked', 'asset_replace', 'mirror_layout', 'native_pbr', 'native_hdr', 'local_repair', 'save_reopen_resume']);
const GUIDED_ALIASES = Object.freeze({ ...ALIASES, asset_import: 'asset_place', resize_single: 'edit_single', resize_linked: 'edit_linked', replace_asset: 'asset_replace', save_reopen: 'save_reopen_resume' });
const discover = inputs => ({ tool: 'start_agent_task', arguments: { intent: 'discover', instruction: 'Read the next modeling contract.', inputs } });
const template = (intent, inputs) => ({ tool: 'start_agent_task', arguments: { intent, instruction: 'Use explicit user design values.', idempotency_key: 'replace-with-stable-key', inputs: { runtime: 'queue', ...inputs } } });
const inspectTargets = () => ({ tool: 'start_agent_task', arguments: { intent: 'understand_model', instruction: 'Read actual target identities, bounds and sharing.', inputs: { runtime: 'queue', include_entities: true } } });

export function getModelAccessibilityWorkflowGuide({ task } = {}) {
  const header = { kind: 'model_accessibility_discovery', topic: 'workflows', evidence_level: 'preflight_only', quality_accepted: false };
  if (task === undefined || task === 'all') return { ...header, task_names: [...GUIDED_TASKS], next_step: 'Select task_name and repeat discover topic=workflows. Each selected response contains its core inputs inline.' };
  let name = typeof task === 'string' ? task.trim() : '';
  if (/^(?:[1-9]|1[0-5])$/.test(name)) name = GUIDED_TASKS[Number(name) - 1];
  for (let i = 0; i < 2 && GUIDED_ALIASES[name] && !GUIDED_TASKS.includes(name); i++) name = GUIDED_ALIASES[name];
  if (!GUIDED_TASKS.includes(name)) throw new AgentContractError('INVALID_ARGUMENT', 'Choose a listed workflow task_name.', { details: { field: 'task_name', supported_tasks: [...GUIDED_TASKS] } });
  const common = { ...header, task_name: name, template_only: true };
  if (GUIDED_TASKS.indexOf(name) < 4) {
    const selected = getModelAccessibilityTaskCatalog({ task: name, detail: 'examples' }).tasks[0];
    return { ...common, support: 'guided_creation',
      next_call: { tool: 'start_agent_task', arguments: { intent: 'preflight_model', instruction: 'Check the explicit dimensions before creation.', inputs: { task: selected.examples.minimal.arguments.inputs.task, runtime: 'queue' } } },
      fixed_design: selected.fixed_design,
      next_step: 'Replace example dimensions/ID/origin; preflight is read-only. Then discover connect runtime=queue; create_model with the same inputs.task, returned connection_task_id and stable idempotency_key. Keep task_id; resume uncertainty.',
      limits: 'mm; +X width,+Y back,+Z up. placement or instances:[{id,origin_mm,rotation_z_deg?}], never both. Actual native geometry/views must pass; requirements freeze after creation.' };
  }
  if (name === 'asset_query') return { ...common, template_only: false, support: 'guided_read_only',
    next_call: discover({ topic: 'assets', query: '' }),
    next_step: 'Set query to the requested asset. Returned catalog records include ID, availability, dimensions, axes, source and license; JSON is already saved.',
    limits: 'Catalog dimensions are recorded evidence, not native measurement. Import requires an available .skp; recipe source files are not SKP assets. No purchase/download.' };
  const connection = discover({ topic: 'connect', runtime: 'queue' });
  if (['asset_place', 'asset_replace'].includes(name)) return { ...common, support: 'reviewed_native_asset',
    next_call: discover({ topic: 'assets', query: '' }),
    call_template: template('reviewed_existing_model_edit', { save_model: false, asset_edit: { version: 1, mode: name === 'asset_place' ? 'place' : 'replace', asset: { id: 'actual-catalog-id' }, ...(name === 'asset_replace' ? { target: { target_id: 'actual-root-id' } } : {}), placement: { origin_mm: [0, 0, 0], rotation_z_deg: 0 } } }),
    next_step: 'Use actual catalog ID and explicit world-mm placement. Prepare, obtain host review, connect queue, then submit the same task with input.connection_task_id and stable key.',
    limits: name === 'asset_replace' ? 'Placement must equal target current rigid transform; one unlocked root only. Preserve identity/peers/attributes; SHA checked. Review is not quality acceptance.' : 'Original SKP scale and complete root; rotate world +Z then place. Server catalog/source SHA required; no arbitrary path or explode. Review is not quality acceptance.' };
  if (['edit_single', 'edit_linked'].includes(name)) return { ...common, support: 'guided_parameter_review',
    next_call: discover({ topic: 'parameter_sources', runtime: 'queue' }),
    call_template: template('modify_design_parameters', { parameter_edit: { creation_task_id: 'actual-creation-task-id', scope: name === 'edit_single' ? 'single' : 'all', targets: [{ target_id: 'actual-root-id' }], changes: { width_mm: 800 } } }),
    next_step: 'Use returned creation_task_id, root target and supported parameters; replace design values. Connect queue and add inputs.connection_task_id. Retain the returned task for host review/submit; resume uncertainty.',
    limits: (name === 'edit_single' ? 'Exactly one target; peers unchanged. ' : 'Explicit complete shared-definition instance list; partial/nested coverage rejected. ') + 'No whole-object scale. Missing/stale/manual-diverged baseline blocks. After disk reopen add saved_delivery_task_id. Reverify with creation_task_id+parameter_task_id; original quality is not reused.' };
  if (['native_pbr', 'native_hdr'].includes(name)) return { ...common, support: 'guided_native_appearance_review', next_call: connection,
    call_template: template('apply_native_appearance', { appearance: name === 'native_pbr' ? { kind: name, target: 'actual-root-id', preset: 'wood', texture_size_mm: [750, 750], rotation: 30 } : { kind: name, environment: 'studio', rotation: 30, intensity: 1, scene_name: 'new-review-scene' } }),
    next_step: 'Prepare, obtain host review, reconnect, submit same task input:{connection_task_id} with stable key. Review the closeup, deliver saved artifacts and stop. Only on explicit user request use reopen_delivered_model. Resume uncertainty; never replay writes.',
    limits: (name === 'native_pbr' ? 'Unique unshared root; mm repeat size and face-normal degrees. ' : 'New scene only; preserve camera; intensity sets both exposures (0..10). ') + 'Host licensed SHA catalog and actual .style required. Native getter/UV or environment readback, capture restoration and unique SKP save are checked. Visual quality/cold reopen remain unaccepted.' };
  if (name === 'save_reopen_resume') return { ...common, support: 'guided_saved_document_lifecycle', next_call: connection,
    call_template: template('deliver_model', { source_task_id: 'actual-quality-passed-task-id' }),
    next_step: 'Add inputs.connection_task_id and start. After save reconnect; start reopen_delivered_model with inputs:{runtime:"queue",saved_delivery_task_id:<saved task_id>,connection_task_id:<fresh connect>} and stable key. Already saved appearance skips deliver: use its task_id. Uncertainty/pending activation: resume same task only.',
    limits: 'Save requires frozen live quality pass. Reopen needs exact saved clean document/file SHA; macOS plugin only. No app restart or parameter rebind claim. Later new modify_design_parameters adds saved_delivery_task_id and parameter_edit.creation_task_id. Never change frozen source or retry first close.' };
  if (name === 'local_repair') return { ...common, support: 'existing_task_recovery_then_reviewed_repair',
    next_call: inspectTargets(),
    call_template: template('reviewed_existing_model_edit', { save_model: false, targets: [{ entity_path: 'pid:123.456', instance_policy: 'make_unique', instance_id: 'actual-root-id' }], operations: [{ op: 'transform_object', entity_path: 'pid:123.456', instance_policy: 'make_unique', instance_id: 'actual-root-id', local_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 20, 0, 1] }] }),
    next_step: 'Have task_id? resume_agent_task first. Else replace path/root/matrix with measured local delta; prepare review, connect and submit same task. Keep manual edits/peers.',
    limits: 'Column-major local delta, translation mm; make_unique isolates this root. Example is not a diagnosed repair. Frozen QA/max 3 automatic refinements per part remain; exhaustion/unknown never permits replay.' };
  return { ...common, support: 'expert_transforms_then_reviewed', next_call: inspectTargets(),
    call_template: template('reviewed_existing_model_edit', { save_model: false, targets: [{ target_id: 'actual-root-id' }], operations: name === 'array_align' ? [{ op: 'duplicate_entity', target_id: 'actual-root-id', new_id: 'unique-copy-id', new_name: 'Copy', translate: [1000, 0, 0] }] : [{ op: 'transform_object', target_id: 'actual-root-id', scale: 1, mirror: 'x', pivot: [0, 0, 0] }] }),
    next_step: 'Replace target and design values with measured explicit operations; prepare host review, connect queue, then submit same task input.connection_task_id with stable key.',
    limits: name === 'array_align' ? 'No generic array/align intent. World-mm translate; compute count-1 distinct copies. Existing alignment uses transform_object translate from measured min/center/max anchor. Check spacing, sharing, peers and collision.' : 'Example mirrors original about world x=0, not a copy. Specify plane/keep-original; mirror x|y|z and pivot mm. A copied layout needs an explicit separately prepared instance plan. Check handedness, door swing, faces and collision; no quality pass implied.' };
}
