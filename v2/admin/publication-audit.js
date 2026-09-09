function text(value){return String(value??'').trim();}
function unique(values){return [...new Set(values.filter(Boolean))];}

export function buildPublicationPlan({environment='homologation',sourceBranch='rebuild-v2',targetBranch='main',files=[],checks=[]}={}){
  const normalizedFiles=(files||[]).map(file=>Object.freeze({path:text(file.path),type:text(file.type||'update'),risk:text(file.risk||'medium'),reason:text(file.reason)})).filter(file=>file.path);
  const normalizedChecks=(checks||[]).map(check=>Object.freeze({id:text(check.id||check.label),label:text(check.label||check.id),passed:check.passed===true,required:check.required!==false,detail:text(check.detail)})).filter(check=>check.id);
  const blocking=normalizedChecks.filter(check=>check.required&&!check.passed);
  const warnings=normalizedChecks.filter(check=>!check.required&&!check.passed);
  const sensitive=normalizedFiles.filter(file=>file.risk==='high');
  return Object.freeze({environment,sourceBranch,targetBranch,files:Object.freeze(normalizedFiles),checks:Object.freeze(normalizedChecks),blocking:Object.freeze(blocking),warnings:Object.freeze(warnings),sensitive:Object.freeze(sensitive),paths:Object.freeze(unique(normalizedFiles.map(file=>file.path))),ready:environment==='homologation'&&normalizedFiles.length>0&&blocking.length===0});
}

export function rollbackPlan(plan,reference=''){
  return Object.freeze({reference:text(reference)||'commit-anterior-confirmado',targetBranch:plan?.targetBranch||'main',actions:Object.freeze((plan?.files||[]).map(file=>({path:file.path,action:'restore_previous_version'}))),automatic:false,requiresApproval:true});
}

export function publicationChecklist({tests=false,mobile=false,integrations=false,backup=false,review=false,noProductionWrites=true}={}){
  return Object.freeze([
    {id:'tests',label:'Testes da V2 revisados',passed:tests,required:true},
    {id:'mobile',label:'Fluxos mobile conferidos',passed:mobile,required:true},
    {id:'integrations',label:'Integrações diagnosticadas',passed:integrations,required:true},
    {id:'backup',label:'Referência de rollback definida',passed:backup,required:true},
    {id:'review',label:'Revisão humana final',passed:review,required:true},
    {id:'safe-mode',label:'Nenhuma escrita de produção nesta tela',passed:noProductionWrites,required:true}
  ]);
}

export function summarizePublicationHistory(entries=[]){const rows=(entries||[]).map(entry=>({id:text(entry.id),createdAt:text(entry.createdAt),status:text(entry.status||'planned'),files:Number(entry.files)||0,reference:text(entry.reference)}));return Object.freeze({rows:Object.freeze(rows),total:rows.length,planned:rows.filter(row=>row.status==='planned').length,approved:rows.filter(row=>row.status==='approved').length,rolledBack:rows.filter(row=>row.status==='rolled_back').length});}
