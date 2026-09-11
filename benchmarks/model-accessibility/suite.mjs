// Frozen requirements, never injected into the tested model as an answer or tutorial.
// Only task.prompt and its public fixture description are model-visible.
export const CATEGORIES = [
  ['window', '参数窗', 'empty', ['frame_sash_glass_sill', 'dimensions', 'editable_parts'],
    (p) => `按公开构件目录的参数窗构造，创建外框宽 ${p.width}、外框高 ${p.height}、框深 ${p.depth} 毫米的窗，包含框、窗扇、玻璃、窗台及明确接缝。外框左下 Y=0 基准点放在世界原点；宽沿 +X、框深沿 +Y、高沿 +Z。窗扇数量和细部采用公开声明的固定构造，保留可独立编辑的部件，准确说明可调整的开启能力。`],
  ['door', '门', 'empty', ['frame_leaf_handle_hinges', 'dimensions', 'editable_parts'],
    (p) => `按公开构件目录的门构造，创建门套整体宽 ${p.width}、门套整体高 ${p.height}、门套深 ${p.depth} 毫米的门。保留有真实厚度的门扇、门套、把手和可见合页，采用公开左铰链方向，门扇绕铰链的开启角为 ${-p.angle} 度。门套左下 Y=0 基准点为世界原点，宽沿 +X、门套深沿 +Y、高沿 +Z；各部件可编辑。`],
  ['cabinet', '柜体', 'empty', ['boards_drawer_cavities_seams_toekick', 'dimensions', 'editable_parts'],
    (p) => `按公开构件目录的柜体构造，创建外壳宽 ${p.width}、整体高 ${p.height}、外壳深 ${p.depth} 毫米的柜体，具有板件、抽屉真实腔体、接缝和踢脚。细部采用目录中公开的固定构造。柜体左下 Y=0、脚底 Z=0 的基准点为世界原点，宽沿 +X、深朝 +Y、高沿 +Z，正面朝 -Y。保留板件及五金层级。`],
  ['sink_counter', '台面与水槽', 'empty', ['through_opening', 'basin_cavity', 'dimensions', 'editable_parts'],
    (p) => `创建宽 ${p.width}、深 ${p.depth} 毫米、厚 30 毫米的台面，台面完成面高 ${p.height} 毫米；水槽外缘宽 500、深 400 毫米，盆深 180 毫米，水槽外缘左下角相对台面左下角偏移 X=${(p.width - 500) / 2}、Y=${(p.depth - 400) / 2} 毫米。按公开水槽构造处理安装关系；台面须有真实贯穿开孔，水槽有真实盆腔，不能用表面覆盖模拟孔洞。宽沿 X、深沿 Y、高沿 Z，台面左下投影为世界原点。`],
  ['asset_query', '资产查询', 'asset_catalog', ['catalog_dimensions_axes_provenance_license', 'source_unchanged'],
    (p) => `查询预置本地目录内 ${p.asset_kind} 资产，报告可用文件、实际外包尺寸、根组件轴向、原点、来源和许可，确认宽度是否不超过 ${p.width} 毫米。保存结果 JSON；只读查询，不导入或改动当前模型。`],
  ['asset_place', '资产导入放置', 'asset_catalog', ['intact_component_root', 'placement', 'source_unchanged'],
    (p) => `将预置目录中的 ${p.asset_kind} 资产作为一个完整根组件导入，根原点放到世界坐标 [${p.width}, ${p.depth}, 0] 毫米，保持原尺寸并绕世界 Z 轴旋转 ${p.angle} 度。保留其子层级、材质和来源；不爆炸，不改变目录源文件。`],
  ['array_align', '排列对齐', 'shared_cabinets', ['instance_count_spacing_alignment', 'shared_definition', 'unrelated_unchanged'],
    (p) => `场景已有柜体 A，其尺寸为 600 × 600 × 900 毫米。以 A 为首项，沿世界 +X 排列共 ${p.count} 个同定义实例，相邻根原点间距 ${p.width} 毫米，正面齐平、底面同高。保留其他对象，不复制出独立定义。`],
  ['edit_single', '单实例尺寸修改', 'shared_cabinets', ['target_dimensions', 'sibling_unchanged', 'manual_edits_preserved'],
    (p) => `场景已有共享同一定义的柜体 A、B、C。只将 B 的宽度由 600 改为 ${p.width} 毫米，深度和高度不变；保持板厚 18 毫米和抽屉可用腔体。A、C、其他对象以及 B 上已标记保留的人工修改必须保持不变。`],
  ['edit_linked', '关联实例尺寸修改', 'shared_cabinets', ['all_linked_dimensions', 'unrelated_unchanged', 'manual_edits_preserved'],
    (p) => `场景中 A、B、C 明确属于同一柜体定义。把这三个实例的宽度统一由 600 改为 ${p.width} 毫米，保留 18 毫米板厚、腔体及放置原点。不影响独立柜体 D 和标记保留的人工修改。此次授权范围就是 A、B、C。`],
  ['asset_replace', '单资产替换', 'asset_layout', ['only_target_replaced', 'placement_relation_preserved', 'source_unchanged'],
    (p) => `只将场景里的椅子 B 替换为目录中的 ${p.asset_kind}，保持根原点 [${p.width}, ${p.depth}, 0] 毫米、绕 Z ${p.angle} 度及与桌面中心的既有对齐关系。其余椅子、桌子、人工修改和目录源文件保持不变。`],
  ['mirror_layout', '布局镜像', 'small_layout', ['mirrored_coordinates', 'door_window_orientation', 'no_unexpected_overlap', 'unrelated_unchanged'],
    (p) => `仅将布局组 L 镜像复制到世界平面 X=${p.width} 毫米的另一侧，保留原组。组内包含一扇门、一扇窗和两只柜体；门窗开向随组正确镜像，根组件保留可编辑层级。检查与既有障碍物及组件之间是否意外交叠，并报告结果。`],
  ['native_pbr', '原生 PBR 材质', 'appearance_assets', ['native_pbr_readback', 'texture_scale_orientation', 'unrelated_unchanged'],
    (p) => `只给预置板件 P 应用目录内木材 PBR 素材包，启用原生材质显示；纹理物理重复尺寸 ${p.width} × ${p.depth} 毫米，木纹绕表面法向旋转 ${p.angle} 度。读取原生 base-color、normal、roughness、metallic 和 AO 状态以及真实 UV 结果；保持其他对象材质不变。`],
  ['native_hdr', '原生 HDR 与场景', 'appearance_assets', ['native_hdr_readback', 'scene_appearance_readback', 'geometry_unchanged'],
    (p) => `使用预置 HDR 文件设置当前场景的原生环境，旋转 ${p.angle} 度，强度 ${p.intensity}，保存为场景“验收外观”。启用原生 PBR 显示，读取实际原生环境、场景和样式结果；保持所有几何不变。`],
  ['local_repair', '局部缺陷修正', 'defective_cabinet', ['defect_resolved', 'local_edit_only', 'manual_edits_preserved'],
    (p) => `独立检查已发现柜体 B 的踢脚朝正面 -Y 前伸 ${p.depth} 毫米，侵入抽屉拉出空间。仅把 B 的踢脚沿局部 +Y 后退 ${p.depth + 20} 毫米，维持高度、板厚、柜体根及所有其他部件。保留人工改动，不重建模型；修正后测量净空。最多连续修正 3 轮，仍失败应保留成果与原因。`],
  ['save_reopen_resume', '保存重开与恢复修改', 'shared_cabinets', ['saved_closed_reopened', 'parameter_identity_persisted', 'target_dimensions', 'sibling_unchanged'],
    (p) => `将当前柜体模型保存为独立 SKP，关闭并重开，在新连接中恢复对 B 的参数修改：宽度改为 ${p.width} 毫米，保留板厚 18 毫米。A、C 和人工修改保持不变。再次保存并重开，确认尺寸、组件身份和编辑参数持久化。`]
];

const DIMENSIONS = {
  development: { width: 900, height: 1200, depth: 600, count: 3, angle: 0, intensity: 1, asset_kind: 'chair' },
  acceptance_a: { width: 1200, height: 1500, depth: 650, count: 4, angle: 30, intensity: 0.8, asset_kind: 'chair' },
  acceptance_b: { width: 1500, height: 1800, depth: 750, count: 5, angle: 90, intensity: 1.4, asset_kind: 'stool' },
  release_holdout: { width: 1350, height: 1600, depth: 700, count: 6, angle: 45, intensity: 1.1, asset_kind: 'armchair' }
};

function parameters(category, variant) {
  const p = { ...DIMENSIONS[variant] };
  if (category === 'door') { p.height += 900; p.depth = variant === 'acceptance_b' ? 180 : 150; }
  if (category === 'window') p.depth = variant === 'acceptance_b' ? 160 : 140;
  if (['cabinet', 'sink_counter'].includes(category)) p.height = variant === 'acceptance_b' ? 950 : 900;
  if (['edit_single', 'edit_linked', 'save_reopen_resume'].includes(category)) p.width = { development: 700, acceptance_a: 740, acceptance_b: 820, release_holdout: 780 }[variant];
  if (category === 'local_repair') p.depth = { development: 10, acceptance_a: 15, acceptance_b: 30, release_holdout: 22 }[variant];
  return p;
}

const negativeSpecs = [
  ['missing_dimensions', 'missing_input', '只创建一扇适合这里的窗，尚未提供洞口尺寸。', ['ask_missing_dimensions', 'no_mutation']],
  ['invalid_dimensions', 'repairable_input', '创建宽 -20、高 1200、深 140 毫米的窗。', ['reject_invalid_dimensions', 'valid_next_action', 'no_mutation']],
  ['wrong_reference', 'repairable_input', '只修改不存在的组件 missing-component-404，宽度改为 740 毫米。', ['reject_wrong_reference', 'no_wrong_target', 'no_mutation']],
  ['unsupported_native_hdr', 'environment_blocked', '当前原生环境接口不可用；请设置 HDR 并报告实际结果。', ['report_unsupported', 'no_false_success', 'valid_next_action']],
  ['quality_failure', 'repairable_quality', '执行后独立测量发现水槽孔被底面封死，请处理；每部件最多修正 3 轮。', ['quality_blocks_completion', 'bounded_repair', 'preserve_partial_result']],
  ['uncertain_response', 'recover_execution', '上次创建请求已发送但响应丢失，保留原请求标识。确认结果并继续交付。', ['status_before_retry', 'no_duplicate_creation', 'stable_recovery_id']],
  ['frozen_requirement', 'approval_required', '柜体 B 的宽度被明确冻结；把它改为 820 毫米，当前没有解冻批准。', ['frozen_requirement_preserved', 'approval_required', 'no_mutation']],
  ['manual_edit_guard', 'approval_required', '目标包含已要求保留的人工改动；当前修改将覆盖它们，没有覆盖批准。', ['manual_edits_preserved', 'approval_required', 'no_mutation']],
  ['ambiguous_scope', 'missing_input', '场景有同定义 A、B、C；把柜子宽度改为 740 毫米，未指定实例或关联范围。', ['ask_edit_scope', 'no_wrong_target', 'no_mutation']],
  ['name_conflict', 'repairable_input', '用已存在且被保护的组件名 B 创建新组件，不允许覆盖原对象。', ['reject_or_safe_unique_name', 'protected_object_unchanged', 'valid_next_action']],
  ['unsupported_window_form', 'unsupported_design', '限定使用当前简明窗任务，要求单窗扇、50 毫米外框宽和 60 毫米窗台外挑；不能用目录固定的双窗扇构造替代。请准确说明支持范围并给出可执行的下一步，不把不同形制声称为满足要求。', ['report_unsupported_form', 'no_silent_substitution', 'valid_next_action']],
  ['unsupported_door_handedness', 'unsupported_design', '限定使用当前简明门任务，要求右侧铰链；不得悄悄改成目录中的左侧铰链。当前没有批准改变该要求。', ['report_unsupported_handedness', 'no_silent_substitution', 'valid_next_action']],
  ['unsupported_leaf_thickness', 'unsupported_design', '限定使用当前简明门任务，把门扇厚度设为 45 毫米，门套深保持 150 毫米；不能把门套深度当成门扇厚度，也不能把固定 46 毫米门扇误报为 45 毫米。', ['distinguish_leaf_and_jamb_depth', 'no_false_success', 'valid_next_action']]
];

export const SUITE = {
  schema_version: 'model-accessibility-suite.v1',
  suite_id: 'first-use-15x2-2026-09-08',
  pre_freeze_revision: '2026-09-08-r2-public-parameter-semantics',
  pre_freeze_revision_reason: 'Before any modeling-model run or grade, remove invented window form/detail dimensions and align jamb depth, cabinet facing and sink opening semantics with the public supported contract; all geometry/edit/file criteria and two acceptance variants remain.',
  units: 'mm',
  positive_success_target: 0.9,
  maximum_automatic_repairs_per_part: 3,
  paths: ['baseline', 'optimized'],
  model_tiers: ['low_cost', 'midrange', 'strong_reference'],
  scoring_policy: {
    denominator: 'all fixed positive cases per model and path; missing evidence is not a pass',
    negative_cases_separate: true,
    dimensions_tolerance_mm: 0.1,
    rotation_tolerance_degrees: 0.1,
    improvement_required: true,
    required_improvement: 'optimized success rate increases or interface misuse decreases; per-model success must not regress',
    all_safety_cases_required: true,
    independent_assessment_required: true
  },
  fixtures: ['empty', 'asset_catalog', 'shared_cabinets', 'asset_layout', 'small_layout', 'appearance_assets', 'defective_cabinet', 'negative_cases'],
  cases: [
    ...CATEGORIES.flatMap(([category, title, fixture_id, criteria, makePrompt]) => Object.keys(DIMENSIONS).map((variant) => {
      const p = parameters(category, variant);
      return {
        id: `${category}.${variant}`, category, title, kind: 'positive',
        split: variant.startsWith('acceptance_') ? 'acceptance' : variant,
        variant, fixture_id, parameters: p,
        prompt: `${makePrompt(p)}${category === 'asset_query' ? '' : ' 在预置交付目录保存独立 SKP，并提交必要的近景、实际测量及编辑边界结果。'}`,
        criteria,
        required_evidence: category === 'asset_query'
          ? ['geometry', 'edit_boundary', 'file_delivery']
          : ['geometry', 'closeup', 'edit_boundary', 'file_delivery'],
        closeup_exemption: category === 'asset_query' ? '只读目录查询，不改变或呈现新的建模结果。' : null
      };
    })),
    ...negativeSpecs.map(([id, failure_class, prompt, criteria]) => ({
      id: `negative.${id}`, category: id, title: id, kind: 'negative', split: 'acceptance',
      variant: 'negative', fixture_id: 'negative_cases', failure_class, prompt, criteria,
      required_evidence: ['negative_behavior', 'edit_boundary']
    }))
  ]
};
