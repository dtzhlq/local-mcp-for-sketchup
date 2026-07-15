#!/usr/bin/env node
import readline from 'node:readline';
import { SketchUpBridge, callTool } from './bridge.mjs';
import { compareSnapshots } from './snapshot-diff.mjs';
import { PRODUCT_VERSION } from './version.mjs';

const bridge = new SketchUpBridge();
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

const expertOptionProperties = {
  seed: { type: 'number', description: 'Seed for deterministic Expert Mode random helpers.' },
  maxOperations: { type: 'number', description: 'Maximum number of generated DSL operations.' },
  maxLoopIterations: { type: 'number', description: 'Maximum total loop iterations during Expert Mode compilation.' },
  maxStatements: { type: 'number', description: 'Maximum interpreted statement/expression steps during Expert Mode compilation.' },
  maxOutputBytes: { type: 'number', description: 'Maximum compiled JSON DSL output size in bytes.' },
  expertTimeoutMs: { type: 'number', description: 'Expert Mode compiler timeout in milliseconds.' }
};

const pythonSdkOptionProperties = {
  maxOperations: { type: 'number', description: 'Maximum number of generated DSL operations.' },
  maxLoopIterations: { type: 'number', description: 'Maximum total loop iterations during restricted Python SDK facade compilation.' },
  maxStatements: { type: 'number', description: 'Maximum interpreted statement/expression steps during restricted Python SDK facade compilation.' },
  maxOutputBytes: { type: 'number', description: 'Maximum compiled JSON DSL output size in bytes.' },
  pythonTimeoutMs: { type: 'number', description: 'Python ast parser timeout in milliseconds. The Python source is parsed, not executed.' },
  pythonCommand: { type: 'string', description: 'Optional Python command used only for ast.parse, such as python3.' }
};

const tools = [
  {
    name: 'get_docs',
    description: 'Return the safe SketchUp JSON DSL and runtime documentation.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'get_workflow_bundle',
    description: 'Return recommended inspector, modeler, and QA reviewer workflows for safe SketchUp MCP use.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'get_capabilities',
    description: 'Return runtime capability descriptors, using a live SketchUp plugin handshake for queue runtime.',
    inputSchema: {
      type: 'object',
      properties: { runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' }, timeoutMs: { type: 'number' } }
    }
  },
  {
    name: 'queue_diagnostics',
    description: 'Inspect local queue directories, pending requests, orphan responses, and queue lock state without sending a SketchUp request.',
    inputSchema: {
      type: 'object',
      properties: {
        includeFiles: { type: 'boolean', default: false },
        timeoutMs: { type: 'number' }
      }
    }
  },
  {
    name: 'prepare_image_modeling_brief',
    description: 'Validate path-based image-structured artifacts and prepare a review-aware MCP modeling brief. Returns compile permission and blockers; it does not call SketchUp.',
    inputSchema: {
      type: 'object',
      properties: {
        input_dir: { type: 'string', description: 'Directory containing asset-set.json, observations.json, candidate-graph.json, and modeling-brief.json.' },
        asset_set_path: { type: 'string' },
        observations_path: { type: 'string' },
        candidate_graph_path: { type: 'string' },
        modeling_brief_path: { type: 'string' },
        promotion_review_path: { type: 'string' },
        source_package_path: { type: 'string' },
        output_dir: { type: 'string' },
        output_json: { type: 'string' },
        output_markdown: { type: 'string' },
        max_candidates: { type: 'number', default: 80 }
      }
    }
  },
  {
    name: 'compile_reviewed_part_graph',
    description: 'Compile schema-valid, review-cleared image artifacts and a reviewed PartGraph to a safe JSON DSL preview. It never executes the DSL or calls the queue runtime.',
    inputSchema: {
      type: 'object',
      properties: {
        mcp_brief_path: { type: 'string' },
        promotion_review_path: { type: 'string' },
        part_graph_path: { type: 'string' },
        profile_path: { type: 'string' },
        output_dir: { type: 'string' },
        output_dsl: { type: 'string' }
      },
      required: ['mcp_brief_path', 'promotion_review_path', 'part_graph_path', 'profile_path']
    }
  },
  {
    name: 'prepare_existing_model_edit',
    description: 'Inspect and fingerprint the open model, validate persistent entity targets, classify edit risk, and write a reviewable edit plan without modifying geometry.',
    inputSchema: {
      type: 'object',
      properties: {
        instruction: { type: 'string' },
        operations: { type: 'array', items: { type: 'object' }, minItems: 1 },
        targets: { type: 'array', items: { type: ['string', 'object'] } },
        output_dir: { type: 'string' },
        recursive_limit: { type: 'number', default: 2000 },
        budgets: { type: 'object' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' }
      },
      required: ['instruction', 'operations']
    }
  },
  {
    name: 'apply_reviewed_model_edit',
    description: 'Apply an approved existing-model edit plan only when the live model revision still matches, then write before/after, diff, QA, review, and model artifacts.',
    inputSchema: {
      type: 'object',
      properties: {
        plan: { type: 'object' },
        plan_file: { type: 'string' },
        review: { type: 'object' },
        review_file: { type: 'string' },
        output_dir: { type: 'string' },
        save_model: { type: 'boolean', default: true },
        save_path: { type: 'string' },
        capture_view: { type: 'boolean', default: false },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' }
      }
    }
  },
  {
    name: 'build_model',
    description: 'Build model geometry from a safe JSON DSL string and return a structured snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JSON DSL string.' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' }
      },
      required: ['code']
    }
  },
  {
    name: 'compile_expert',
    description: 'Compile a restricted Expert Mode script into the safe JSON DSL without building geometry.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Expert Mode script string.' },
        ...expertOptionProperties
      },
      required: ['code']
    }
  },
  {
    name: 'compile_python_sdk',
    description: 'Compile restricted official-style Python SDK facade code into the safe JSON DSL without executing Python.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Restricted Python SDK facade script string.' },
        ...pythonSdkOptionProperties
      },
      required: ['code']
    }
  },
  {
    name: 'build_expert_model',
    description: 'Compile a restricted Expert Mode script into JSON DSL, then build it with the selected runtime.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Expert Mode script string.' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number', description: 'Runtime timeout in milliseconds.' },
        ...expertOptionProperties
      },
      required: ['code']
    }
  },
  {
    name: 'reset_model',
    description: 'Reset the current model session and return an empty snapshot.',
    inputSchema: {
      type: 'object',
      properties: { runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' }, timeoutMs: { type: 'number' } }
    }
  },
  {
    name: 'save_model',
    description: 'Save the current model session and return a file path plus snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        keep_session: { type: 'boolean', default: true },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' }
      }
    }
  },
  {
    name: 'save_model_version',
    description: 'Save the current model session to a versioned file path without overwriting the requested base path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        base_path: { type: 'string' },
        label: { type: 'string' },
        keep_session: { type: 'boolean', default: true },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' }
      }
    }
  },
  {
    name: 'open_model',
    description: 'Open an existing model into the selected runtime. Queue opens SKP files; mock opens saved mock JSON artifacts.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'queue' },
        timeoutMs: { type: 'number' }
      },
      required: ['path']
    }
  },
  {
    name: 'import_model',
    description: 'Import an external model into the current session and return the updated snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        mode: { type: 'string', enum: ['append', 'replace'], default: 'append' },
        prefix: { type: 'string' },
        options: { type: 'object' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'queue' },
        timeoutMs: { type: 'number' }
      },
      required: ['path']
    }
  },
  {
    name: 'export_model',
    description: 'Export the current model session to a runtime-supported file format.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        format: { type: 'string' },
        options: { type: 'object' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'queue' },
        timeoutMs: { type: 'number' }
      },
      required: ['path']
    }
  },
  {
    name: 'get_model_info',
    description: 'Return active model totals, bounding box, materials, tags, components, scenes, and warning summary.',
    inputSchema: {
      type: 'object',
      properties: {
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' }
      }
    }
  },
  {
    name: 'list_entities',
    description: 'List top-level groups and component instances with stable ids, names, kinds, bbox, material, tag, and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        includeHidden: { type: 'boolean', default: true },
        kind: { type: 'string' },
        material: { type: 'string' },
        tag: { type: 'string' },
        name: { type: 'string', description: 'Case-insensitive name regex filter.' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' }
      }
    }
  },
  {
    name: 'inspect_model',
    description: 'Inspect the active model and optionally include filtered entity summaries and the full snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        includeEntities: { type: 'boolean', default: true },
        includeSnapshot: { type: 'boolean', default: false },
        includeHidden: { type: 'boolean', default: true },
        kind: { type: 'string' },
        material: { type: 'string' },
        tag: { type: 'string' },
        name: { type: 'string' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' }
      }
    }
  },
  {
    name: 'adopt_open_model',
    description: 'Assign stable Alma references and recursively index persistent occurrence paths for safe, policy-gated existing-model editing.',
    inputSchema: {
      type: 'object',
      properties: {
        recursive: { type: 'boolean', default: false, description: 'Also return nested occurrence paths. Group/instance/Face/Edge entries expose type-specific allowed operations and shared-definition policy metadata.' },
        recursive_limit: { type: 'number', default: 500 },
        force: { type: 'boolean', default: false, description: 'Rewrite existing adopted references.' },
        prefix: { type: 'string', default: 'adopted' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' }
      }
    }
  },
  {
    name: 'resolve_model_targets',
    description: 'Resolve a natural-language or filtered target request against the active model and return stable target references for selection or iteration.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Target query such as "largest cabinet", "left wall", or "current selection".' },
        includeHidden: { type: 'boolean', default: true },
        kind: { type: 'string' },
        material: { type: 'string' },
        tag: { type: 'string' },
        name: { type: 'string' },
        definition: { type: 'string' },
        side: { type: 'string', enum: ['left', 'right', 'front', 'back', 'top', 'bottom'] },
        nth: { type: 'number' },
        target: { type: ['string', 'object'] },
        targets: { type: 'array', items: { type: ['string', 'object'] } },
        largest: { type: 'boolean' },
        smallest: { type: 'boolean' },
        selection: { type: 'boolean' },
        allowMultiple: { type: 'boolean', default: false },
        limit: { type: 'number', default: 10 },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' }
      }
    }
  },
  {
    name: 'get_selection',
    description: 'Return the current active selection as stable entity summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' }
      }
    }
  },
  {
    name: 'analyze_selection_geometry',
    description: 'Interpret the current selected Face/Edge/Group geometry into measured primitives, ordered face loops, oriented road graphs, approach/intersection relationships, and semantic hypotheses such as road segment or junction candidate. This is an analysis layer and should not be treated as confirmed domain truth without confidence checks.',
    inputSchema: {
      type: 'object',
      properties: {
        assume: { type: 'string', description: 'Optional user/domain hint, for example "road" or "road_surface".' },
        includeDetails: { type: 'boolean', default: true, description: 'Include selected polygon/polyline points in the response.' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' }
      }
    }
  },
  {
    name: 'plan_modification_intent',
    description: 'Turn the current target resolution, selection, and interpreted geometry into an auditable ModificationIntent before optional patch execution.',
    inputSchema: {
      type: 'object',
      properties: {
        instruction: { type: 'string', description: 'User-facing edit request recorded as audit context.' },
        action: { type: 'string', enum: ['set_material', 'assign_tag', 'set_attribute', 'transform_targets', 'create_selection_surface', 'create_aligned_box', 'delete_targets'] },
        parameters: { type: 'object', description: 'Structured action parameters, such as material, tag, attribute value, transform, origin, or size.' },
        target_query: { type: 'string', description: 'Optional target query resolved before planning intent.' },
        targets: { type: 'array', items: { type: ['string', 'object'] }, description: 'Optional explicit stable ids or object references.' },
        assume: { type: 'string', description: 'Optional geometry/domain hint passed to analyze_selection_geometry.' },
        output_dir: { type: 'string', description: 'Directory for selection-geometry, target-resolution, modification-intent, patch, and intent manifest artifacts.' },
        compile_patch: { type: 'boolean', default: true },
        allow_ambiguous_targets: { type: 'boolean', default: false },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' }
      }
    }
  },
  {
    name: 'set_selection',
    description: 'Set, add to, remove from, or clear the current active selection by stable ids or names.',
    inputSchema: {
      type: 'object',
      properties: {
        targets: { type: 'array', items: { type: ['string', 'object'] } },
        mode: { type: 'string', enum: ['replace', 'add', 'remove', 'clear'], default: 'replace' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' }
      }
    }
  },
  {
    name: 'capture_view',
    description: 'Capture the current live SketchUp viewport to an image artifact and return camera/model metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Output image path. Defaults to the queue state captures directory.' },
        view: { type: 'string', enum: ['current', 'top', 'front', 'right', 'left', 'back', 'iso'], default: 'current' },
        scene: { type: 'string', description: 'Optional saved SketchUp scene/Page name. When supplied, scene camera is used instead of view preset.' },
        width: { type: 'number', default: 1280 },
        height: { type: 'number', default: 720 },
        antialias: { type: 'boolean', default: true },
        compression: { type: 'number', default: 1.0 },
        zoom_extents: { type: 'boolean', default: true },
        runtime: { type: 'string', enum: ['queue'], default: 'queue' },
        timeoutMs: { type: 'number' }
      }
    }
  },
  {
    name: 'run_ruby_expert',
    description: 'Debug-only queue tool for running arbitrary SketchUp Ruby. Disabled unless ALMA_SKETCHUP_ENABLE_RUBY_EXPERT=1 is set in both Node and SketchUp plugin environments.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Ruby code to evaluate inside SketchUp. This is destructive and must not be used as an acceptance path.' },
        audit_path: { type: 'string', description: 'Optional audit artifact path. Defaults to the queue state audit directory.' },
        runtime: { type: 'string', enum: ['queue'], default: 'queue' },
        timeoutMs: { type: 'number' }
      },
      required: ['code']
    }
  },
  {
    name: 'evaluate_py',
    description: 'Official-shaped controlled evaluate_py compatibility layer. Executes JSON DSL, restricted Python SDK facade code, or restricted Expert Mode; arbitrary Python is intentionally blocked.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JSON DSL, restricted Python SDK facade, restricted Expert Mode, or gated ruby_expert code depending on input_format.' },
        input_format: { type: 'string', enum: ['auto', 'json_dsl', 'python_sdk', 'restricted_expert', 'expert', 'ruby_expert'], default: 'auto' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' },
        audit_path: { type: 'string' },
        ...expertOptionProperties,
        ...pythonSdkOptionProperties
      },
      required: ['code']
    }
  },
  {
    name: 'build_report',
    description: 'Build or inspect a model and write a bundled artifact report with snapshot, model info, optional QA, save artifact, and optional capture.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Optional JSON DSL string to build before reporting.' },
        snapshot: { type: 'object', description: 'Optional existing snapshot. If omitted and no code is supplied, inspects the active model.' },
        output_dir: { type: 'string' },
        save_model: { type: 'boolean', default: true },
        save_path: { type: 'string' },
        capture_view: { type: 'boolean', default: false },
        capture: { type: 'object' },
        validate_model: { type: 'boolean', default: true },
        validate_reference_model: { type: 'boolean', default: false },
        model_spec: { type: 'object' },
        reference_spec: { type: 'object' },
        includePreview: { type: 'boolean', default: true },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' }
      }
    }
  },
  {
    name: 'iterate_model',
    description: 'Inspect the active model, apply an incremental patch or safe ModificationIntent, then write before/after snapshots, diff, QA, optional saved model, and optional queue capture artifacts.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Incremental JSON DSL, restricted Python SDK facade, or restricted Expert Mode patch code. Include reset only when intentionally replacing the session.' },
        intent: { type: 'object', description: 'Auditable ModificationIntent. If code is omitted, it executes only when safe_to_execute=true and requires_confirmation=false.' },
        intent_file: { type: 'string', description: 'Path to a ModificationIntent JSON artifact.' },
        input_format: { type: 'string', enum: ['auto', 'json_dsl', 'python_sdk', 'restricted_expert', 'expert'], default: 'auto' },
        label: { type: 'string', description: 'Human-readable label used for the iteration id and versioned save path.' },
        output_dir: { type: 'string', description: 'Directory for manifest, input, before/after snapshots, diff, QA, and model artifacts.' },
        targets: { type: 'array', items: { type: ['string', 'object'] }, description: 'Optional top-level ids or nested {entity_path, edit_scope:"component_definition", instance_policy, instance_id?} references. Nested targets are reference-only and are not placed in SketchUp selection.' },
        target_query: { type: 'string', description: 'Optional natural-language target query resolved against the active model before applying the patch. JSON DSL patches can use "$target" or "$targets" placeholders.' },
        allow_ambiguous_targets: { type: 'boolean', default: false, description: 'Allow target queries that need confirmation or intentionally return multiple targets.' },
        preview_only: { type: 'boolean', default: false, description: 'Write before/target/input artifacts and manifest without executing the patch.' },
        selection_mode: { type: 'string', enum: ['replace', 'add', 'remove', 'clear'], default: 'replace' },
        save_model: { type: 'boolean', default: true },
        save_path: { type: 'string' },
        capture_view: { type: 'boolean', default: false },
        capture: { type: 'object' },
        validate_model: { type: 'boolean', default: true },
        validate_reference_model: { type: 'boolean', default: false },
        model_spec: { type: 'object' },
        reference_spec: { type: 'object' },
        includePreview: { type: 'boolean', default: true },
        toleranceMm: { type: 'number', default: 1 },
        topologyTolerance: { type: 'object' },
        budgets: { type: 'object' },
        topIssueLimit: { type: 'number', default: 10 },
        strictCollisions: { type: 'boolean' },
        strictUnanchored: { type: 'boolean' },
        floatingDetails: { type: 'boolean' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' },
        ...expertOptionProperties,
        ...pythonSdkOptionProperties
      }
    }
  },
  {
    name: 'compare_snapshots',
    description: 'Compare two structured snapshots and return a diff report.',
    inputSchema: {
      type: 'object',
      properties: {
        expected: { type: 'object' },
        actual: { type: 'object' },
        toleranceMm: { type: 'number', default: 1 },
        budgets: { type: 'object' },
        topIssueLimit: { type: 'number', default: 10 }
      },
      required: ['expected', 'actual']
    }
  },
  {
    name: 'compare_model',
    description: 'Build the same DSL with two runtimes and return a snapshot parity QA report.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JSON DSL string.' },
        expected_runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        actual_runtime: { type: 'string', enum: ['mock', 'queue'], default: 'queue' },
        timeoutMs: { type: 'number' },
        reset_first: { type: 'boolean', default: true },
        toleranceMm: { type: 'number', default: 1 },
        budgets: { type: 'object' },
        topIssueLimit: { type: 'number', default: 10 },
        include_snapshots: { type: 'boolean', default: false }
      },
      required: ['code']
    }
  },
  {
    name: 'validate_model',
    description: 'Build or inspect a model snapshot, run semantic layout QA, and return orthographic SVG/HTML previews plus correction suggestions.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JSON DSL string. Required unless snapshot is provided.' },
        snapshot: { type: 'object', description: 'Existing build_model snapshot. If provided, code is not required.' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' },
        spec: { type: 'object', description: 'Optional model QA spec with contacts, inside, support, and separation rules.' },
        includePreview: { type: 'boolean', default: true },
        strictCollisions: { type: 'boolean', default: true },
        strictUnanchored: { type: 'boolean', default: false },
        floatingDetails: { type: 'boolean', default: true }
      }
    }
  },
  {
    name: 'validate_reference_model',
    description: 'Build or inspect a model snapshot, run reference visual QA against orthographic silhouette/keypoint/area rules, and return PartGraph-targeted correction suggestions.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JSON DSL string. Required unless snapshot is provided.' },
        snapshot: { type: 'object', description: 'Existing build_model snapshot. If provided, code is not required.' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' },
        spec: { type: 'object', description: 'Reference visual QA spec with views, silhouettes, keypoints, area ratios, and relative-position rules.' },
        includePreview: { type: 'boolean', default: true }
      }
    }
  }
];

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
    await handleRequest(request);
  } catch (error) {
    respond(request?.id ?? null, null, error);
  }
});

async function handleRequest(request) {
  if (request.method === 'initialize') {
    return respond(request.id, {
      protocolVersion: request.params?.protocolVersion || '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'sketchup-mcp-replica', version: PRODUCT_VERSION }
    });
  }

  if (request.method === 'notifications/initialized') return;

  if (request.method === 'tools/list') {
    return respond(request.id, { tools });
  }

  if (request.method === 'tools/call') {
    const name = request.params?.name;
    const args = request.params?.arguments || {};
    const result = name === 'compare_snapshots'
      ? compareSnapshots(normalizeSnapshotArgument(args.expected), normalizeSnapshotArgument(args.actual), { toleranceMm: args.toleranceMm, budgets: args.budgets, topIssueLimit: args.topIssueLimit })
      : await callTool(name, args, bridge);
    return respond(request.id, {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    });
  }

  throw new Error(`Unsupported MCP method: ${request.method}`);
}

function normalizeSnapshotArgument(document) {
  if (!document?.snapshot) return document;
  return {
    ...document.snapshot,
    artifact_size_bytes: document.snapshot.artifact_size_bytes ?? document.file_size_bytes
  };
}

function respond(id, result, error) {
  const payload = error
    ? { jsonrpc: '2.0', id, error: { code: -32000, message: error.message } }
    : { jsonrpc: '2.0', id, result };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
