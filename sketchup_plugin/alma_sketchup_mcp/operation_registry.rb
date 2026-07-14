# frozen_string_literal: true

# Generated from src/capabilities.mjs. Run `npm run registry:sync` after editing the operation registry.

module AlmaSketchupMCP
  OPERATION_SUPPORT = {
    'reset' => {
      'status' => 'supported',
      'stability' => 'stable',
      'schema' => {
        'required' => ['op'],
        'optional' => []
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'material' => {
      'status' => 'partial',
      'stability' => 'stable',
      'schema' => {
        'required' => ['op', 'name'],
        'optional' => ['color', 'alpha', 'texture', 'workflow', 'pbr']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'tag' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name'],
        'optional' => ['color', 'visible']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'assign_tag' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'tag'],
        'optional' => ['name', 'tag_name', 'tagName', 'target_id', 'targetId', 'target', 'object']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'attribute' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'dictionary', 'namespace', 'key', 'attr_key', 'attrKey', 'value', 'attributes']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'classification' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'system', 'schema', 'type', 'classification', 'class', 'ifc_class', 'ifcClass', 'identifier', 'attributes']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'texture_transform' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'material', 'projection', 'offset', 'offset_u', 'offsetU', 'offset_v', 'offsetV', 'scale', 'scale_u', 'scaleU', 'scale_v', 'scaleV', 'rotation', 'rotation_degrees', 'rotationDegrees']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'uv_project_planar' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'material', 'offset', 'offset_u', 'offsetU', 'offset_v', 'offsetV', 'scale', 'scale_u', 'scaleU', 'scale_v', 'scaleV', 'rotation', 'rotation_degrees', 'rotationDegrees']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'uv_project_box' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'material', 'offset', 'offset_u', 'offsetU', 'offset_v', 'offsetV', 'scale', 'scale_u', 'scaleU', 'scale_v', 'scaleV', 'rotation', 'rotation_degrees', 'rotationDegrees']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'face_uv' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'uv'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'uv_id', 'uvId', 'face', 'face_id', 'face_selector', 'faceSelector', 'projection', 'material', 'image_reference', 'imageReference', 'image', 'mapping']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'image_reference' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'path'],
        'optional' => ['file', 'filename', 'image', 'width', 'height', 'scale', 'role', 'source', 'metadata']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'delete' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'rename' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'new_name'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'entity_path', 'entityPath', 'target_path', 'targetPath', 'edit_scope', 'editScope', 'instance_policy', 'instancePolicy', 'instance_id', 'instanceId']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'set_material' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'material'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'entity_path', 'entityPath', 'target_path', 'targetPath', 'edit_scope', 'editScope', 'instance_policy', 'instancePolicy', 'instance_id', 'instanceId']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'set_visibility' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'visible'],
        'optional' => ['name', 'hidden', 'target_id', 'targetId', 'target', 'object', 'entity_path', 'entityPath', 'target_path', 'targetPath', 'edit_scope', 'editScope', 'instance_policy', 'instancePolicy', 'instance_id', 'instanceId']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'transform_object' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'entity_path', 'entityPath', 'target_path', 'targetPath', 'edit_scope', 'editScope', 'instance_policy', 'instancePolicy', 'instance_id', 'instanceId', 'translate', 'rotateX', 'rotateY', 'rotateZ', 'axis', 'angle', 'rotate_axis', 'rotateAxis', 'local_axis', 'localAxis', 'local_angle', 'localAngle', 'rotate_local', 'rotateLocal', 'matrix', 'matrix4x4', 'local_matrix', 'localMatrix', 'matrix_local', 'matrixLocal', 'scale', 'mirror', 'pivot']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'box' => {
      'status' => 'supported',
      'stability' => 'stable',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'size'],
        'optional' => ['id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'rounded_box' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'size', 'radius'],
        'optional' => ['segments', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'beveled_panel' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'size', 'bevel'],
        'optional' => ['smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'fillet' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'size', 'radius'],
        'optional' => ['segments', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'chamfer' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'size', 'amount'],
        'optional' => ['bevel', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'recess' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'center', 'size', 'depth'],
        'optional' => ['radius', 'segments', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'engraved_line' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'points', 'width'],
        'optional' => ['depth', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'text_emboss' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'text', 'height'],
        'optional' => ['origin', 'center', 'width', 'depth', 'spacing', 'align', 'mode', 'text_mode', 'outline', 'font', 'bold', 'italic', 'filled', 'extrusion', 'tolerance', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'text_engrave' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'text', 'height'],
        'optional' => ['origin', 'center', 'width', 'depth', 'spacing', 'align', 'mode', 'text_mode', 'outline', 'font', 'bold', 'italic', 'filled', 'extrusion', 'tolerance', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'text_3d' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'text', 'height'],
        'optional' => ['origin', 'center', 'font', 'align', 'bold', 'italic', 'filled', 'extrusion', 'depth', 'tolerance', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'slot' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'center', 'length', 'width', 'depth'],
        'optional' => ['segments', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'slot_array' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'count', 'spacing', 'length', 'width', 'depth'],
        'optional' => ['center', 'origin', 'direction', 'segments', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'rib' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'length', 'height', 'thickness'],
        'optional' => ['direction', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'standoff_boss' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'center', 'outer_radius', 'inner_radius', 'height'],
        'optional' => ['segments', 'hole_material', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'button_on_panel' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'center', 'height'],
        'optional' => ['radius', 'size', 'corner_radius', 'segments', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'cut_hole' => {
      'status' => 'supported',
      'stability' => 'experimental',
      'schema' => {
        'required' => ['op', 'center', 'radius'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'face', 'plane', 'feature_id', 'featureId', 'depth', 'through', 'segments']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'cut_slot' => {
      'status' => 'supported',
      'stability' => 'experimental',
      'schema' => {
        'required' => ['op', 'center', 'length', 'width'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'face', 'plane', 'feature_id', 'featureId', 'depth', 'through', 'segments']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'cut_recess' => {
      'status' => 'supported',
      'stability' => 'experimental',
      'schema' => {
        'required' => ['op', 'center', 'size', 'depth'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'face', 'plane', 'feature_id', 'featureId', 'radius', 'segments']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'add_boss' => {
      'status' => 'supported',
      'stability' => 'experimental',
      'schema' => {
        'required' => ['op', 'center', 'radius', 'height'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'face', 'plane', 'feature_id', 'featureId', 'outer_radius', 'outerRadius', 'segments']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'add_raised_rib' => {
      'status' => 'supported',
      'stability' => 'experimental',
      'schema' => {
        'required' => ['op', 'center', 'length', 'height'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'face', 'plane', 'feature_id', 'featureId', 'width', 'thickness', 'direction']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'boolean_union' => {
      'status' => 'supported',
      'stability' => 'experimental',
      'schema' => {
        'required' => ['op'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'tools', 'tool_id', 'toolId', 'tool_ids', 'toolIds', 'result_name', 'resultName', 'result_id', 'resultId', 'keep_tools', 'keepTools', 'keep_originals', 'keepOriginals', 'allow_disjoint', 'allowDisjoint', 'material']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'boolean_difference' => {
      'status' => 'supported',
      'stability' => 'experimental',
      'schema' => {
        'required' => ['op'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'tools', 'tool_id', 'toolId', 'tool_ids', 'toolIds', 'result_name', 'resultName', 'result_id', 'resultId', 'keep_tools', 'keepTools', 'keep_originals', 'keepOriginals', 'allow_non_intersecting', 'allowNonIntersecting', 'material']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'boolean_intersect' => {
      'status' => 'supported',
      'stability' => 'experimental',
      'schema' => {
        'required' => ['op'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'tools', 'tool_id', 'toolId', 'tool_ids', 'toolIds', 'result_name', 'resultName', 'result_id', 'resultId', 'keep_tools', 'keepTools', 'keep_originals', 'keepOriginals', 'material']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'manifold_check' => {
      'status' => 'supported',
      'stability' => 'experimental',
      'schema' => {
        'required' => ['op'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'targets', 'target_ids', 'targetIds', 'check_id', 'checkId', 'fail_on_non_manifold', 'failOnNonManifold']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'manifold_repair' => {
      'status' => 'supported',
      'stability' => 'experimental',
      'schema' => {
        'required' => ['op'],
        'optional' => ['name', 'target_id', 'targetId', 'target', 'object', 'strategy', 'repair_id', 'repairId', 'fail_on_non_manifold', 'failOnNonManifold']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'image_plane' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'size'],
        'optional' => ['plane', 'image', 'texture', 'material', 'alpha', 'texture_transform', 'id', 'object_id', 'objectId', 'guid', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'prism' => {
      'status' => 'supported',
      'stability' => 'stable',
      'schema' => {
        'required' => ['op', 'name', 'plane', 'points', 'depth'],
        'optional' => ['id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'panel_with_openings' => {
      'status' => 'supported',
      'stability' => 'stable',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'plane', 'size', 'thickness'],
        'optional' => ['openings', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'boolean_cutout' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'size', 'cutouts'],
        'optional' => ['smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'face_with_holes' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'plane', 'outer'],
        'optional' => ['holes', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'profile_extrude' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'plane', 'outer', 'depth'],
        'optional' => ['holes', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'mesh' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'vertices', 'faces'],
        'optional' => ['back_material', 'f_material', 'b_material', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'geometry_input' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'vertices'],
        'optional' => ['faces', 'edges', 'material', 'smooth', 'faces[].pushpull', 'faces[].followme', 'faces[].position_material', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'curve' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'points'],
        'optional' => ['vertices', 'closed', 'material', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'arc_curve' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'center', 'radius'],
        'optional' => ['start_angle', 'startAngle', 'end_angle', 'endAngle', 'plane', 'segments', 'material', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'gable_roof' => {
      'status' => 'supported',
      'stability' => 'stable',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'width', 'depth', 'rise'],
        'optional' => ['overhang', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'shed_roof' => {
      'status' => 'supported',
      'stability' => 'stable',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'width', 'depth', 'rise'],
        'optional' => ['overhang', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'cylinder' => {
      'status' => 'supported',
      'stability' => 'stable',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'radius', 'height'],
        'optional' => ['segments', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'loft_between_profiles' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'profiles'],
        'optional' => ['smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'shell_from_front_side_profiles' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'front_profile', 'side_profile'],
        'optional' => ['smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'lofted_solid' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'profile'],
        'optional' => ['segments', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'face_on_cylinder' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'center', 'cylinder_radius', 'width', 'height'],
        'optional' => ['cylinder_center', 'angle', 'depth', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'analog_stick' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'origin'],
        'optional' => ['height', 'shaft_height', 'base_radius', 'shaft_radius', 'cap_radius', 'top_radius', 'profile', 'segments', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'screw_hole' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'center', 'radius'],
        'optional' => ['depth', 'head_radius', 'head_depth', 'segments', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'pipe_between_points' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'points', 'radius'],
        'optional' => ['path', 'start', 'end', 'segments', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'swept_path' => {
      'status' => 'partial',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'path', 'radius'],
        'optional' => ['segments', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'domed_surface' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'width', 'depth', 'thickness', 'crown_height'],
        'optional' => ['segments_x', 'segments_y', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'bowed_panel' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'width', 'height', 'thickness', 'bow_depth'],
        'optional' => ['segments_x', 'segments_z', 'smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'level' => {
      'status' => 'supported',
      'stability' => 'stable',
      'schema' => {
        'required' => ['op', 'name', 'elevation'],
        'optional' => ['height']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'floor_slab' => {
      'status' => 'supported',
      'stability' => 'stable',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'width', 'depth'],
        'optional' => ['thickness', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'footprint_slab' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'points', 'thickness'],
        'optional' => ['origin', 'holes', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'wall' => {
      'status' => 'supported',
      'stability' => 'stable',
      'schema' => {
        'required' => ['op', 'name', 'start', 'end', 'height'],
        'optional' => ['thickness', 'openings', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'wall_path' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'path', 'height'],
        'optional' => ['thickness', 'openings', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'curved_wall' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'center', 'radius', 'start_angle', 'end_angle', 'height'],
        'optional' => ['thickness', 'segments', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'roof_footprint' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'points'],
        'optional' => ['origin', 'holes', 'elevation', 'thickness', 'rise', 'slope_direction', 'overhang', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'hip_roof' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'width', 'depth', 'rise'],
        'optional' => ['thickness', 'overhang', 'ridge_ratio', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'parapet_path' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name'],
        'optional' => ['path', 'points', 'origin', 'closed', 'height', 'thickness', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'curtain_wall' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'height'],
        'optional' => ['path', 'start', 'end', 'module_width', 'mullion_width', 'row_count', 'thickness', 'panel_thickness', 'frame_material', 'panel_material', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'column_grid' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'height'],
        'optional' => ['origin', 'points', 'x_count', 'y_count', 'spacing', 'shape', 'column_size', 'radius', 'segments', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'path_surface' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'path', 'width'],
        'optional' => ['thickness', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'terrain_mesh' => {
      'status' => 'partial',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'vertices', 'faces'],
        'optional' => ['smooth', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'parking_stall_array' => {
      'status' => 'partial',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'count', 'stall_width', 'stall_depth'],
        'optional' => ['line_width', 'line_height', 'direction', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'door' => {
      'status' => 'supported',
      'stability' => 'stable',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'width', 'height'],
        'optional' => ['plane', 'thickness', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'window' => {
      'status' => 'supported',
      'stability' => 'stable',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'width', 'height'],
        'optional' => ['plane', 'thickness', 'id', 'object_id', 'objectId', 'guid', 'material', 'transform.translate', 'transform.rotateZ']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'stairs' => {
      'status' => 'supported',
      'stability' => 'stable',
      'schema' => {
        'required' => ['op', 'name', 'origin', 'steps', 'width', 'tread_depth', 'riser_height'],
        'optional' => ['direction', 'material']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'railing' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'path'],
        'optional' => ['height', 'rail_radius', 'post_radius', 'post_spacing', 'smooth', 'material']
      },
      'component_scope' => {
        'status' => 'supported'
      }
    },
    'component_definition' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name'],
        'optional' => ['size', 'operations', 'material']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'component_instance' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'name', 'definition', 'origin'],
        'optional' => ['transform', 'id', 'object_id', 'objectId', 'guid']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'selection' => {
      'status' => 'supported',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op', 'mode'],
        'optional' => ['targets']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'camera' => {
      'status' => 'supported',
      'stability' => 'stable',
      'schema' => {
        'required' => ['op', 'eye', 'target', 'up'],
        'optional' => ['fov']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'scene' => {
      'status' => 'supported',
      'stability' => 'stable',
      'schema' => {
        'required' => ['op', 'name'],
        'optional' => ['camera', 'transition_time', 'transitionTime', 'use_camera', 'useCamera', 'layer_visibility', 'layerVisibility', 'drawingelement_visibility', 'drawingElementVisibility', 'rendering_options', 'renderingOptions', 'shadow', 'shadow_info', 'shadowInfo', 'style', 'update_flags', 'updateFlags']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'style' => {
      'status' => 'partial',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op'],
        'optional' => ['name', 'display_edges', 'profiles', 'profile_width', 'display_watermarks', 'face_style', 'background_color', 'sky_color', 'ground_color']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'shadow' => {
      'status' => 'partial',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op'],
        'optional' => ['display', 'time', 'light', 'dark', 'use_sun_for_shading']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'rendering_options' => {
      'status' => 'partial',
      'stability' => 'beta',
      'schema' => {
        'required' => ['op'],
        'optional' => ['edge_display_mode', 'draw_hidden_geometry', 'display_color_by_layer', 'transparency', 'draw_back_edges', 'draw_ground']
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    },
    'room' => {
      'status' => 'supported',
      'stability' => 'stable',
      'schema' => {
        'required' => ['op', 'name', 'width', 'depth', 'height'],
        'optional' => []
      },
      'component_scope' => {
        'status' => 'unsupported'
      }
    }
  }.freeze
  SUPPORTED_OPERATIONS = OPERATION_SUPPORT.keys.freeze

  def self.operation_support_descriptor
    OPERATION_SUPPORT
  end
end
