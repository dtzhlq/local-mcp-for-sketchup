export function getWorkflowBundle() {
  return {
    kind: 'sketchup_mcp_workflow_bundle',
    version: '2026-06-mainline-workflows.1',
    scope: 'mainline_safe_json_dsl',
    guardrails: [
      'Start live SketchUp workflows with get_capabilities or queue_diagnostics.',
      'Use safe JSON DSL build_model for modeling; do not bypass the operation registry.',
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
          { tool: 'capture_view', arguments: { runtime: 'queue', view: 'current' }, purpose: 'Save a visible current-viewport artifact when SketchUp is available.' },
          { tool: 'save_model', arguments: { runtime: 'queue' }, purpose: 'Use only when an SKP artifact is needed for evidence.' }
        ]
      },
      modeler: {
        intent: 'Build or revise a model through the safe DSL.',
        steps: [
          { tool: 'get_capabilities', arguments: { runtime: 'mock' }, purpose: 'Check the local contract before generating DSL.' },
          { tool: 'build_model', arguments: { runtime: 'mock' }, purpose: 'Iterate quickly in deterministic mock runtime.' },
          { tool: 'validate_model', arguments: { runtime: 'mock' }, purpose: 'Run layout QA and preview generation before queue work.' },
          { tool: 'build_model', arguments: { runtime: 'queue' }, purpose: 'Run live SketchUp only after mock passes.' },
          { tool: 'capture_view', arguments: { runtime: 'queue', view: 'iso' }, purpose: 'Capture visible live evidence for review.' },
          { tool: 'save_model', arguments: { runtime: 'queue' }, purpose: 'Save the final SKP artifact.' }
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
