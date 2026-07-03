export function getWorkflowBundle() {
  return {
    kind: 'sketchup_mcp_workflow_bundle',
    version: '2026-07-natural-iteration.1',
    scope: 'mainline_safe_json_dsl',
    guardrails: [
      'Start live SketchUp workflows with get_capabilities or queue_diagnostics.',
      'Use safe JSON DSL build_model for modeling; do not bypass the operation registry.',
      'Use adopt_open_model before editing arbitrary local SKP files so unnamed or non-MCP objects receive stable references.',
      'Use plan_modification_intent to convert selected geometry and targets into auditable edit intent before mutation.',
      'Use iterate_model for incremental revisions that need before/after evidence, snapshot diff, QA, and a versioned artifact.',
      'After substantial queue edits, save a snapshot or SKP artifact and run QA.',
      'Use capture_view as visible evidence, not as a replacement for snapshot/layout/reference gates.',
      'Use run_ruby_expert only for explicitly enabled local debugging; it is destructive, audited, and outside acceptance gates.',
      'Run queue commands serially against one SketchUp Bridge session.'
    ],
    workflows: {
      inspector: {
        intent: 'Inspect a live SketchUp queue session before editing.',
        steps: [
          { tool: 'queue_diagnostics', purpose: 'Detect stale locks, pending requests, and orphan responses before sending work.' },
          { tool: 'get_capabilities', arguments: { runtime: 'queue' }, purpose: 'Confirm plugin version, manifest, capability version, and compatibility.' },
          { tool: 'adopt_open_model', arguments: { runtime: 'queue', recursive: true }, purpose: 'Assign stable references to top-level entities in an already open local SKP and return a read-only nested index.' },
          { tool: 'resolve_model_targets', arguments: { runtime: 'queue', query: 'current selection' }, purpose: 'Resolve a natural target request before issuing a scoped edit.' },
          { tool: 'analyze_selection_geometry', arguments: { runtime: 'queue' }, purpose: 'Interpret selected Face/Edge/Group geometry into measured primitives, oriented road graphs, approach/intersection relationships, and semantic hypotheses before applying domain-specific edits.' },
          { tool: 'plan_modification_intent', arguments: { runtime: 'queue', action: 'set_attribute' }, purpose: 'Record the intended edit, evidence, confidence, and confirmation gate before mutation.' },
          { tool: 'capture_view', arguments: { runtime: 'queue', view: 'current' }, purpose: 'Save a visible current-viewport artifact when SketchUp is available.' },
          { tool: 'save_model', arguments: { runtime: 'queue' }, purpose: 'Use only when an SKP artifact is needed for evidence.' }
        ]
      },
      modeler: {
        intent: 'Build or revise a model through the safe DSL.',
        steps: [
          { tool: 'get_capabilities', arguments: { runtime: 'mock' }, purpose: 'Check the local contract before generating DSL.' },
          { tool: 'build_model', arguments: { runtime: 'mock' }, purpose: 'Iterate quickly in deterministic mock runtime.' },
          { tool: 'iterate_model', arguments: { runtime: 'mock' }, purpose: 'Apply a targeted patch to the active session and save before/after/diff artifacts.' },
          { tool: 'validate_model', arguments: { runtime: 'mock' }, purpose: 'Run layout QA and preview generation before queue work.' },
          { tool: 'build_model', arguments: { runtime: 'queue' }, purpose: 'Run live SketchUp only after mock passes.' },
          { tool: 'iterate_model', arguments: { runtime: 'queue', capture_view: true }, purpose: 'Use for live incremental edits that need a saved SKP plus visible capture evidence.' },
          { tool: 'capture_view', arguments: { runtime: 'queue', view: 'iso' }, purpose: 'Capture visible live evidence for review.' },
          { tool: 'save_model', arguments: { runtime: 'queue' }, purpose: 'Save the final SKP artifact.' }
        ]
      },
      iterator: {
        intent: 'Revise an existing active model without losing the previous state.',
        steps: [
          { tool: 'inspect_model', purpose: 'Read model totals, named entities, selection, and optionally the full snapshot before editing.' },
          { tool: 'adopt_open_model', purpose: 'Use when the active model was not produced by this MCP or lacks stable entity ids.' },
          { tool: 'resolve_model_targets', purpose: 'Resolve natural requests such as largest cabinet, left wall, or current selection into stable references.' },
          { tool: 'analyze_selection_geometry', purpose: 'Use for selected surfaces or edges when the edit depends on inferred scene semantics such as road, floor, boundary, or junction candidate.' },
          { tool: 'plan_modification_intent', arguments: { action: 'set_attribute', compile_patch: true }, purpose: 'Convert the selected/targeted geometry into a ModificationIntent with evidence and confirmation status.' },
          { tool: 'iterate_model', arguments: { intent_file: 'output/intent/modification-intent.json', save_model: true, validate_model: true }, purpose: 'Apply only safe confirmed intent, or write a blocked preview manifest when confirmation is required.' },
          { tool: 'validate_reference_model', purpose: 'Run only when a reference spec exists and visual similarity is part of acceptance.' },
          { tool: 'capture_view', arguments: { runtime: 'queue', view: 'iso' }, purpose: 'Capture live visible evidence after queue iterations.' }
        ]
      },
      qa_reviewer: {
        intent: 'Review model quality and runtime parity.',
        steps: [
          { tool: 'compare_model', arguments: { expected_runtime: 'mock', actual_runtime: 'queue' }, purpose: 'Compare mock and queue snapshots with explicit tolerances.' },
          { tool: 'validate_model', purpose: 'Check semantic layout rules and collisions.' },
          { tool: 'validate_reference_model', purpose: 'Check reference visual rules when a spec exists.' },
          { tool: 'capture_view', arguments: { runtime: 'queue', view: 'top' }, purpose: 'Capture a top or iso viewport for human-visible evidence.' },
          { command: 'npm test', purpose: 'Run the root regression gate before committing broad runtime changes.' }
        ]
      }
    }
  };
}
