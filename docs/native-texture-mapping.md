# Native face texture mapping

`texture_transform` now positions real SketchUp faces using `Face.position_material` and immediately verifies UVQ coordinates through `Face.get_UVHelper`. `face_uv` uses the same verification. Missing materials, untextured materials, empty selectors, unsupported API, failed native positioning, and mismatched UV readback are errors. Parameters are stored only after successful application. Existing-model operations still use the existing reviewed target and ownership mechanism.

The target is a face, or the **direct faces** of a group/component instance. Child groups and child component definitions are never traversed. A container with only nested parts must identify a leaf explicitly. Editing a shared definition still follows the existing instance policy; this operation never silently makes instances unique. Source material texture dimensions are read, never changed globally.

Parameters:

| Field | Meaning |
| --- | --- |
| `projection` | `planar` (default) gives every face its own planar basis. `box` accepts axis-aligned faces only. |
| `texture_size_mm: [width, height]` | Physical size of one texture cycle in the entity's local coordinates. Defaults to the material's native texture size. |
| `scale: [u, v]` | Positive UV repeat multipliers. `[2,1]` repeats twice along U within one physical cycle. The scalar aliases `scale_u` / `scale_v` remain supported. |
| `rotation` | Texture rotation in degrees, positive counterclockwise in the chosen U/V plane. |
| `offset: [u,v]` | Added UV cycles, after rotation and repeat scaling. |
| `side` | `front` (default), `back`, or `both`. |
| `material` | Optional existing textured material. Otherwise use the face's material, then its target container's material. |
| `face_selector` | Optional direct-face index, `GeometryInputFace.id` string, or `{type:'all'}`, `{type:'index',value:0}`, `{type:'named',value:'id'}`. |

`planar` projects local +X into the face plane, falling back to +Y when parallel to the normal; V is normal × U. Texture phase uses the target's local origin. For `box`, Z-normal faces use X/Y, Y-normal faces use X/Z, and X-normal faces use Y/Z, on either side of the box. Sloped or curved facets explicitly require `planar`; cylindrical/spherical/unwrapped mapping is not implemented. Mirrored/nonuniform instance transforms act on the result like ordinary SketchUp geometry, so local physical dimensions are not a promise of unchanged world-space tile dimensions after scaling an instance.

Detailed recipes can include the same object in `shape.parameters.texture_transform`, for example:

```json
{
  "projection": "planar",
  "texture_size_mm": [1200, 180],
  "scale": [1, 1],
  "rotation": 90,
  "side": "both"
}
```

Completed leaf geometry is mapped before its object placement transform. This is connected through the common placement path used by `box`, `profile_extrude`, mesh and derived detailed primitives. It does not recursively map an assembly. Prefer inheriting the already assigned material when using a namespaced creation task; explicit nested material names must already be the runtime material name.

Snapshots include `native_uv` read from the current face mapping, with material, side, face persistent ID and UV samples. A previous `TextureTransform` attribute without successful native application is labeled `legacy_metadata_only`. Stored parameters can remain unchanged after a manual UV edit, while current `native_uv` and the model revision change. Offline mock metadata does not constitute native UV evidence.

Tests: `ruby test/ruby/native_texture_mapping_test.rb`, `node test/texture-transform-contract.mjs`. The Ruby API-shaped tests check physical dimensions, repeats, rotation, both sides, current readback, failed application, rejected selectors and absence of shared-child mutations. Native SketchUp save/reopen and visual acceptance are separate live checks.

Official API: [Face.position_material](https://ruby.sketchup.com/Sketchup/Face.html#position_material-instance_method), [Face.get_UVHelper](https://ruby.sketchup.com/Sketchup/Face.html#get_UVHelper-instance_method), [UVHelper](https://ruby.sketchup.com/Sketchup/UVHelper.html).
