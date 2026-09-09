function number(value){const n=Number(value);return Number.isFinite(n)?n:0;}
function ratio(ok,total){return total>0?Math.round(ok/total*100):0;}

export function buildDiagnosticSummary({products=[],catalogQuality=null,catalogMetrics=null,baskets=[],kits=[],orders=[],integrationResults=[],publicationPlan=null}={}){
  const fallbackProductIssues=products.filter(product=>!product.nome||!product.codigo||!product.categoria||number(product.preco)<=0).length;
  const productIssues=catalogQuality
    ? number(catalogQuality.withoutPrice)+number(catalogQuality.withoutCategory)+number(catalogQuality.withoutImage)
    : fallbackProductIssues;
  const stockIssues=catalogQuality?number(catalogQuality.withoutStock):products.filter(product=>number(product.estoque)<=0).length;
  const collectionTotal=baskets.length+kits.length;
  const collectionIssues=[...baskets,...kits].filter(item=>!item?.id||!(item?.items||[]).length||number(item?.preco)<=0).length;
  const orderIssues=orders.filter(order=>!order?.cliente?.nome||!(order?.itens||[]).length||order?.integrationError).length;
  const integrationOk=integrationResults.filter(result=>result?.status==='ok').length;
  const integrationTotal=integrationResults.length;
  const publicationReady=Boolean(publicationPlan?.ready);
  const catalogTotal=catalogQuality?.total??products.length;
  const catalogDetail=catalogQuality
    ? `${catalogTotal} produtos · ${catalogQuality.withoutImage} sem imagem · ${catalogQuality.withoutPrice} sem preço · ${catalogQuality.withoutCategory} sem categoria`
    : `${products.length} produtos · ${productIssues} pendências essenciais`;
  const performanceOk=!catalogMetrics||number(catalogMetrics.totalMs)<=8000;
  const checks=[
    {id:'catalog',label:'Qualidade do catálogo',ok:catalogTotal>0&&productIssues===0,detail:catalogDetail},
    {id:'stock',label:'Disponibilidade de estoque',ok:stockIssues===0,detail:`${stockIssues} produtos sem estoque`},
    {id:'performance',label:'Desempenho da leitura',ok:performanceOk,detail:catalogMetrics?`${catalogMetrics.totalMs} ms total · ${catalogMetrics.firebaseMs} ms Firebase`:'Métricas ainda não coletadas'},
    {id:'collections',label:'Cestas e kits',ok:collectionTotal>0&&collectionIssues===0,detail:`${collectionTotal} coleções · ${collectionIssues} problemas`},
    {id:'orders',label:'Pedidos',ok:orders.length===0||orderIssues===0,detail:`${orders.length} pedidos · ${orderIssues} alertas`},
    {id:'integrations',label:'Integrações verificadas',ok:integrationTotal>0&&integrationOk===integrationTotal,detail:`${integrationOk} de ${integrationTotal} leituras aprovadas`},
    {id:'publication',label:'Plano de publicação',ok:publicationReady,detail:publicationReady?'Checklist pronto para revisão':'Publicação ainda bloqueada'}
  ];
  const passed=checks.filter(check=>check.ok).length;
  const score=ratio(passed,checks.length);
  const status=score===100?'ready':score>=70?'attention':'blocked';
  return Object.freeze({score,status,checks,passed,total:checks.length,productIssues,stockIssues,collectionIssues,orderIssues,integrationOk,integrationTotal,publicationReady,catalogQuality,catalogMetrics});
}

export function diagnosticRecommendations(summary){
  const map={catalog:'Corrigir imagem, preço e categoria dos produtos incompletos.',stock:'Revisar produtos zerados antes de liberar compra.',performance:'Investigar tempo de resposta do Firebase e tamanho do catálogo.',collections:'Corrigir composições e preços de cestas ou kits.',orders:'Revisar pedidos com dados ou integrações incompletas.',integrations:'Executar novamente apenas as leituras seguras das integrações.',publication:'Concluir checklist, revisão humana e referência de rollback.'};
  return summary.checks.filter(check=>!check.ok).map(check=>Object.freeze({id:check.id,text:map[check.id]}));
}
