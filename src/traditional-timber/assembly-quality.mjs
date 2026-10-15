import { timberDetailSpecification, evaluateTimberQuality } from './quality.mjs';
import { DETAIL_SAMPLE_RESOURCE_BUDGET } from '../detailed-modeling/scenes.mjs';
import { traditionalAssemblyJointChecks, evaluateTraditionalAssemblyJoints } from './assembly-joint-measurements.mjs';

export const TRADITIONAL_ASSEMBLY_QUALITY_SCOPE='traditional-assembly-summary.v1';
export function traditionalAssemblyDetailSpecification(graph,views,recipe,requiredVoids) {
  return {...timberDetailSpecification(graph,views,recipe.rule_binding),coverage_version:TRADITIONAL_ASSEMBLY_QUALITY_SCOPE,
    resource_budget:structuredClone(DETAIL_SAMPLE_RESOURCE_BUDGET),required_voids:requiredVoids,
    connection_checks:recipe.connections,compiler_expected_values:recipe.measurements,parameter_sources:recipe.parameter_sources,
    native_joint_checks:traditionalAssemblyJointChecks(graph),
    ...(views.length===0?{deferred_scene_overview:true}:{}),
    validation_scope:'native_major_assemblies_resources_selected_openings_and_overview',
    visible_joint_review:'requires_overview_or_selected_under_eave_review'};
}
export function evaluateTraditionalAssemblyQuality({summary,creation,captures=[],regionInspection=null,trustedRegionInspection=false,jointMeasurements=null,trustedJointMeasurements=false}) {
  const result=evaluateTimberQuality({summary,creation,captures}),spec=creation.frozen_spec.specification,issues=[...result.issues];
  const totals=summary.snapshot?.resource_totals,counts={};
  if(spec.deferred_scene_overview)issues.push({type:'assembly.scene_overview_deferred',status:'unverified'});
  for(const [key,max] of Object.entries(spec.resource_budget)) {
    const metric=key.replace('max_',''),actual=totals?.complete===true&&totals.scope==='all_native_stored_geometry'&&Number.isSafeInteger(totals[metric])?totals[metric]:null;
    counts[metric]=actual;
    if(actual===null)issues.push({type:'assembly.resource_unverified',resource:metric,status:'unverified'});
    else if(actual>max)issues.push({type:'assembly.resource_exceeded',resource:metric,actual,expected:max,status:'fail'});
  }
  let measuredVoids=0;
  for(const requirement of spec.required_voids) {
    const wanted=creation.occurrence_path_map?.[JSON.stringify(requirement.instance_path)]||requirement.instance_path.map(id=>creation.identity_map[id]||id);
    const matches=(regionInspection?.results||[]).filter(row=>row.id===requirement.id),row=matches.length===1?matches[0]:null;
    const trusted=trustedRegionInspection&&regionInspection?.version==='native-detail-regions.v1'&&regionInspection.read_only===true
      &&regionInspection.model_revision_complete===true&&regionInspection.model_revision===summary.model_revision
      &&row?.evidence_source==='sketchup_runtime'&&row.model_revision===summary.model_revision
      &&JSON.stringify(row.instance_path)===JSON.stringify(wanted)&&JSON.stringify(row.bounds_mm)===JSON.stringify(requirement.bounds_mm)
      &&row.search_scope===(requirement.search_scope||'scene')&&JSON.stringify(row.boundary_checks)===JSON.stringify(requirement.boundary_checks||[]);
    if(!trusted)issues.push({type:'assembly.opening_unverified',void_id:requirement.id,status:'unverified'});
    else if(row.status!=='pass')issues.push({type:'assembly.opening_obstructed',void_id:requirement.id,status:row.status==='fail'?'fail':'unverified',reason:row.reason});
    else measuredVoids++;
  }
  const joints=evaluateTraditionalAssemblyJoints({creation,summary,measurements:jointMeasurements,trusted:trustedJointMeasurements});
  issues.push(...joints.issues);
  const status=issues.some(i=>i.status==='fail')?'fail':issues.length?'unverified':'pass';
  return {...result,version:TRADITIONAL_ASSEMBLY_QUALITY_SCOPE,quality_status:status,quality_accepted:status==='pass',
    resource_costs:{kind:'geometry_resource_costs',scope:'all_native_stored_geometry',counts,limits:spec.resource_budget},measured_voids:measuredVoids,
    connection_checks:spec.connection_checks,connection_evidence_level:'compiler_expected_coordinates',
    native_joint_evidence_level:joints.evidence_level,
    native_joint_measurements:joints.results,joint_measurement_scope:'selected_member_pairs_only',
    joint_penetration_checked:false,joint_bearing_capacity_checked:false,
    validation_scope:spec.validation_scope,issues,remaining:issues};
}
