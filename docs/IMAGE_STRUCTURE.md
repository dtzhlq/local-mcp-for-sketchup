# Single-image structure and modeling (0.2.0 candidate)

This path supports building, interior and product images through the existing `image_artifact` and `create_model` intents. A camera solution is optional. This document describes implemented candidate behavior, not a formal-release acceptance certificate.

1. Register an image with `start_agent_task`, intent `image_artifact`, using the existing `image_base64` + `media_type` input. Keep its immutable `image_handle`.
2. Start `image_artifact` with `inputs.action="structure"`, `domain`, the image handle, and observations. The default goal is `understanding`. No CV runs by default. Request `helpers:["lines"]`, `contours`, or `boundaries` only when useful.
3. Keep `source_understanding` from the result. A new structure task can reference it and submit just corrected observations or a PartGraph. Completed tasks remain completed. Failed helpers and compile diagnostics do not erase valid observations. Same-task retries do not repeat completed helper calls.
4. For a complete model candidate set `goal:"complete_model"` and supply a complete explicit PartGraph. The result includes `source_image_model`, the whole plan preview, assumptions and offline geometry bounds. Missing geometry returns a specific gap; no bounding-box model is substituted.
5. Start `create_model` with `source_image_model` and `runtime:"mock"` or `"queue"`. Review the server-frozen image, geometry and assumption plan using the existing local approval host. Submit after approval. A fresh queue connection/session contract remains required. Client-provided review flags or DSL cannot authorize or replace the plan.
6. Creation uses the existing build, QA and delivery mechanisms. Inspect visual fidelity and editability, then use the existing delivery/save/reopen workflow. Offline compilation alone does not establish complete model delivery. Creation retains the source and assumption record.

Minimal structure input:

```json
{
  "action":"structure",
  "domain":"product",
  "image_handle":"image-artifact:sha256:...",
  "scale_mode":"relative",
  "observations":[{
    "instance_id":"body-1","role":"sculptural shell",
    "evidence":{"image_handle":"image-artifact:sha256:...","description":"Visible main body"},
    "parameters":{}
  }]
}
```

`instance_id` identifies a physical part, not a class. Roles are open strings. New observations for the same instance retain a `replaces` candidate link. Geometry parts use that same `id`; repeated windows, legs or buttons use different ids. Every part needs image evidence. PartGraph v1 supplies `parts`; v2 may use internal assembly children and roots. All parts must be reachable and all observed modeled instances must be represented.

A shape is `{primitive:"box",parameters:{origin:[0,0,0],size:[100,60,40]}}`; the server supplies operation/id/name. Each parameter has a corresponding `parameter_provenance` entry: `observed`, `inferred` or `assumed`. Observed values must match a recorded observation parameter with a reason. Every assumed value must have a matching `{id,instance_id,parameter,value,reason}` assumption. Approval never makes an assumption an observation. Material definitions accept only name, color and alpha; external assets and arbitrary root operations are unsupported here.

Nominal DSL units are mm. In relative mode these numbers express proportions, not measured millimeters. Known mode requires an explicit scale reference and evidence; supply geometry in mm. The source scale reference does not silently rescale geometry. Physical measurement accuracy is not inferred from one photograph.

A source reference contains `{task_id,artifact_handle,content_hash}`. The server checks ownership, immutable image integrity and content hash before consuming it. Changes to geometry or assumptions require a new source plan and corresponding review; they do not require re-running image recognition. An approved creation task can be resumed without another review of the same unchanged plan.

Supported release target: Apple Silicon Mac with SketchUp 2026. Windows and Intel Mac are not accepted release targets in this round. Official signing, independent installation, three real editable `.skp` deliveries and save/reopen checks are required before the candidate can be called a formal release.

### Explicit assembly contacts

`part_graph.contacts` optionally lists `{instance_id, with_instance_id, assumption_id}` pairs. Each endpoint must be a distinct geometric instance in the same graph. The referenced assumption must have `instance_id` equal to the first endpoint, `parameter:"contact"`, `value` equal to the second endpoint, and an explanation in `reason`. The server alone translates these reviewed pairs into existing QA contact metadata. Unlisted overlaps remain errors; this is not a global collision exemption. Contacts and their reasons remain assumptions after approval, and are part of the frozen plan hash.

Mesh face loops must be planar. A failed mesh preflight identifies the part and face index; submit explicit triangles for a warped quad. The adapter never silently changes geometry after approval.
