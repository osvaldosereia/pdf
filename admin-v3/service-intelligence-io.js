(()=>{
  'use strict';

  const C=window.DA_ADMIN_V3_CONFIG||{};
  const AUTH_KEY='da_admin_v3_auth';
  const SCHEMA='dona-antonia-service-intelligence/v1';
  const MARKER='<!-- DONA_ANTONIA_AI_CONFIG_V1 -->';
  const $=id=>document.getElementById(id);
  const clean=v=>String(v??'').replace(/\r/g,'').trim();
  const slug=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,54)||'item';
  const loadAuth=()=>{try{return JSON.parse(localStorage.getItem(AUTH_KEY)||'null')}catch{return null}};
  const saveAuth=a=>localStorage.setItem(AUTH_KEY,JSON.stringify(a));
  const toast=(message,kind='')=>{
    const host=$('toastRegion');
    if(!host)return;
    const node=document.createElement('div');
    node.className=`toast ${kind}`.trim();
    node.textContent=message;
    host.appendChild(node);
    setTimeout(()=>node.remove(),kind==='error'?6500:3600);
  };

  async function refreshAuth(auth){
    const r=await fetch(`${C.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,{
      method:'POST',
      headers:{apikey:C.supabasePublishableKey,'Content-Type':'application/json'},
      body:JSON.stringify({refresh_token:auth?.refresh_token})
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok||!data.access_token)throw new Error('Sessão expirada. Faça login novamente.');
    saveAuth(data);
    return data;
  }

  async function api(action,payload={},retry=true){
    let auth=loadAuth();
    if(!auth?.access_token)throw new Error('Faça login no Admin principal.');
    const r=await fetch(`${C.supabaseUrl}/functions/v1/admin-service-intelligence-v1`,{
      method:'POST',
      headers:{apikey:C.supabasePublishableKey,Authorization:`Bearer ${auth.access_token}`,'Content-Type':'application/json'},
      body:JSON.stringify({action,...payload})
    });
    const data=await r.json().catch(()=>({}));
    if(r.status===401&&retry){auth=await refreshAuth(auth);return api(action,payload,false)}
    if(!r.ok||data.ok===false)throw new Error(data.detail||data.error||`Erro ${r.status}`);
    return data;
  }

  function exportKnowledge(x){
    return {
      id:x.id||null,
      knowledge_key:x.knowledge_key||null,
      status:x.status||'draft',
      category:x.category||'geral',
      title:x.title||'',
      content:x.content||'',
      priority:Number(x.priority??90),
      keywords:Array.isArray(x.keywords)?x.keywords:[],
      channel_scope:Array.isArray(x.channel_scope)&&x.channel_scope.length?x.channel_scope:['whatsapp'],
      source_note:x.source_note||'Admin da inteligência do atendimento'
    };
  }

  function exportGuidance(x){
    return {
      id:x.id||null,
      rule_key:x.rule_key||null,
      status:x.status||'draft',
      title:x.title||'',
      instruction:x.instruction||'',
      priority:Number(x.priority??90),
      intent_scope:Array.isArray(x.intent_scope)?x.intent_scope:[],
      stage_scope:Array.isArray(x.stage_scope)?x.stage_scope:[],
      behavior_tags:Array.isArray(x.behavior_tags)?x.behavior_tags:['mvp_whatsapp'],
      channel_scope:Array.isArray(x.channel_scope)&&x.channel_scope.length?x.channel_scope:['whatsapp']
    };
  }

  function exportProcedure(x){
    return {
      id:x.id||null,
      procedure_key:x.procedure_key||null,
      status:x.status||'draft',
      title:x.title||'',
      trigger_description:x.trigger_description||'',
      steps:Array.isArray(x.steps)?x.steps:[],
      priority:Number(x.priority??90),
      allowed_actions:Array.isArray(x.allowed_actions)?x.allowed_actions:[],
      confirmation_actions:Array.isArray(x.confirmation_actions)?x.confirmation_actions:[],
      fallback:x.fallback||null
    };
  }

  function markdownFor(bundle){
    const exportedAt=new Date().toISOString();
    const data={
      schema:SCHEMA,
      exported_at:exportedAt,
      instructions_version:1,
      knowledge:bundle.knowledge.map(exportKnowledge),
      guidance:bundle.guidance.map(exportGuidance),
      procedures:bundle.procedure.map(exportProcedure)
    };
    return `# Dona Antônia — Configuração da IA de atendimento\n\nExportado em: ${exportedAt}\n\n## Instruções para a IA que vai revisar este arquivo\n\nEste arquivo representa as informações, orientações e regras usadas pela IA de atendimento da Dona Antônia. Você pode melhorar textos existentes, organizar instruções, reduzir ambiguidades e **criar novas regras** quando isso tornar o atendimento mais seguro, simples, vendedor e coerente.\n\n### Regras obrigatórias de edição\n\n1. Preserve o marcador \`${MARKER}\` e mantenha **um único bloco JSON** logo abaixo dele.\n2. Ao melhorar um item existente, **mantenha o \`id\` original exatamente como está**. Nunca invente, troque ou copie IDs.\n3. Para **criar uma nova informação, orientação ou regra**, adicione um novo objeto no array correto e use \`\"id\": null\` ou omita o campo \`id\`.\n4. Em itens novos, as chaves \`knowledge_key\`, \`rule_key\` e \`procedure_key\` podem ser \`null\`; o Admin cria uma chave segura automaticamente na importação.\n5. Novos itens importados entram como **rascunho** e precisam ser revisados/publicados por uma pessoa no Admin.\n6. Não exclua um item existente apenas por achar redundante. Prefira melhorar ou consolidar o texto mantendo seu \`id\`. Se recomendar exclusão, explique fora do JSON; a importação não apaga registros.\n7. Não coloque aqui preço atual, estoque atual, custo, disponibilidade, dados do Bling ou outras verdades comerciais dinâmicas. Esses dados vêm automaticamente do sistema.\n8. Não crie promessas comerciais, políticas, prazos ou condições que não estejam sustentadas pelas informações já existentes. Quando faltar uma verdade da empresa, sinalize a necessidade de validação humana.\n9. Escreva em português brasileiro claro e operacional. Regras devem dizer **quando se aplicam** e **o que fazer**.\n10. Preserve os nomes dos campos e o valor de \`schema\`. Não inclua comentários dentro do JSON.\n11. Ao terminar, devolva **o arquivo Markdown completo**, não apenas trechos alterados.\n\n### Onde criar cada tipo de conteúdo\n\n- **knowledge** — fatos estáveis que a IA precisa saber sobre empresa, entrega, pagamento, cestas, trocas e atendimento.\n- **guidance** — como a IA deve se comportar: tom, condução, venda, perguntas, respostas, sugestões e uso do contexto.\n- **procedures** — regras importantes com gatilho e passos em ordem. Use para situações que precisam de procedimento claro.\n\n### Campos mínimos para itens novos\n\n- \`knowledge\`: \`category\`, \`title\`, \`content\`.\n- \`guidance\`: \`title\`, \`instruction\`.\n- \`procedures\`: \`title\`, \`trigger_description\`, \`steps\` (array de textos).\n\n> O texto acima serve como manual para qualquer IA que receber este arquivo. O bloco abaixo é a parte importável pelo Admin.\n\n${MARKER}\n\n\`\`\`json\n${JSON.stringify(data,null,2)}\n\`\`\`\n`;
  }

  async function exportMarkdown(){
    const button=$('siExportMd');
    const old=button?.textContent||'Exportar .md';
    try{
      if(button){button.disabled=true;button.textContent='Exportando…'}
      const [dashboard,knowledge,guidance,procedure]=await Promise.all([
        api('dashboard'),api('list',{type:'knowledge'}),api('list',{type:'guidance'}),api('list',{type:'procedure'})
      ]);
      const counts=dashboard.counts||{};
      const rows={knowledge:knowledge.items||[],guidance:guidance.items||[],procedure:procedure.items||[]};
      if((counts.knowledge||0)>rows.knowledge.length||(counts.guidance||0)>rows.guidance.length||(counts.procedures||0)>rows.procedure.length){
        throw new Error('A exportação excedeu o limite da tela e seria incompleta. Não foi gerado arquivo parcial.');
      }
      const blob=new Blob([markdownFor(rows)],{type:'text/markdown;charset=utf-8'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      const stamp=new Date().toISOString().slice(0,10);
      a.href=url;a.download=`dona-antonia-configuracao-ia-${stamp}.md`;
      document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
      toast('Arquivo .md exportado com as instruções para a IA.','success');
    }catch(e){toast(e.message||'Não consegui exportar.','error')}
    finally{if(button){button.disabled=false;button.textContent=old}}
  }

  function pickJson(text){
    const markerIndex=text.indexOf(MARKER);
    const area=markerIndex>=0?text.slice(markerIndex+MARKER.length):text;
    const blocks=[...area.matchAll(/```json\s*([\s\S]*?)```/gi)].map(m=>m[1]);
    for(const raw of blocks){
      try{const data=JSON.parse(raw);if(data?.schema===SCHEMA)return data}catch{}
    }
    throw new Error('Arquivo incompatível: não encontrei o bloco JSON estruturado da Dona Antônia.');
  }

  function text(v,max=12000){return clean(v).slice(0,max)}
  function arr(v,max=30){return Array.isArray(v)?v.map(x=>text(x,2000)).filter(Boolean).slice(0,max):[]}
  function priority(v){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(100,n)):90}
  function key(prefix,title,current){return text(current,100).toLowerCase()||`${prefix}_${slug(title)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`}
  function validId(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(v,80))?text(v,80):null}

  function normalize(type,x){
    const id=validId(x?.id);
    if(type==='knowledge'){
      const title=text(x?.title,180),content=text(x?.content,12000),category=text(x?.category,80)||'geral';
      if(!title||!content)throw new Error('Há uma informação sem título ou conteúdo.');
      return {type,id,knowledge_key:key('info',title,x?.knowledge_key),category,title,content,keywords:arr(x?.keywords,30),channel_scope:arr(x?.channel_scope,10).length?arr(x?.channel_scope,10):['whatsapp'],priority:priority(x?.priority),source_note:text(x?.source_note,500)||'Importado de arquivo Markdown'};
    }
    if(type==='guidance'){
      const title=text(x?.title,180),instruction=text(x?.instruction,8000);
      if(!title||!instruction)throw new Error('Há uma orientação sem título ou instrução.');
      return {type,id,rule_key:key('orientacao',title,x?.rule_key),title,instruction,intent_scope:arr(x?.intent_scope,30),stage_scope:arr(x?.stage_scope,30),behavior_tags:arr(x?.behavior_tags,30),channel_scope:arr(x?.channel_scope,10).length?arr(x?.channel_scope,10):['whatsapp'],priority:priority(x?.priority)};
    }
    const title=text(x?.title,180),trigger=text(x?.trigger_description,2000),steps=arr(x?.steps,30);
    if(!title||!trigger||!steps.length)throw new Error('Há uma regra sem título, gatilho ou passos.');
    return {type,id,procedure_key:key('regra',title,x?.procedure_key),title,trigger_description:trigger,steps,allowed_actions:arr(x?.allowed_actions,30),confirmation_actions:arr(x?.confirmation_actions,30),fallback:text(x?.fallback,2000)||null,priority:priority(x?.priority)};
  }

  function prepareImport(data){
    if(data?.schema!==SCHEMA)throw new Error('Versão do arquivo não reconhecida.');
    const groups=[['knowledge',data.knowledge],['guidance',data.guidance],['procedure',data.procedures]];
    const records=[];
    for(const [type,list] of groups){
      if(!Array.isArray(list))throw new Error(`O bloco ${type} está ausente ou inválido.`);
      if(list.length>200)throw new Error(`O bloco ${type} excede 200 registros.`);
      list.forEach(x=>records.push(normalize(type,x||{})));
    }
    if(!records.length)throw new Error('O arquivo não contém registros para importar.');
    const ids=records.map(x=>x.id).filter(Boolean);
    if(new Set(ids).size!==ids.length)throw new Error('O arquivo repete o mesmo id em mais de um item.');
    return records;
  }

  function showImportDialog(file,records){
    const old=$('siImportDialog');if(old)old.remove();
    const counts={knowledge:0,guidance:0,procedure:0,new:0,update:0};
    records.forEach(x=>{counts[x.type]++;x.id?counts.update++:counts.new++});
    const dialog=document.createElement('dialog');
    dialog.id='siImportDialog';dialog.className='si-import-dialog';
    dialog.innerHTML=`<div class="si-import-head"><div><div class="eyebrow">Revisão do arquivo</div><h2>Importar configuração da IA</h2><p>${escapeHtml(file.name)}</p></div><button class="si-dialog-close" type="button" aria-label="Fechar">×</button></div><div class="si-import-body"><div class="si-import-summary"><div><strong>${counts.knowledge}</strong><span>Informações</span></div><div><strong>${counts.guidance}</strong><span>Orientações</span></div><div><strong>${counts.procedure}</strong><span>Regras</span></div></div><div class="si-import-impact"><p><strong>${counts.update}</strong> registros existentes serão atualizados.</p><p><strong>${counts.new}</strong> itens novos serão criados como <strong>rascunho</strong>.</p><p>Nenhum registro será apagado e nenhum item novo será publicado automaticamente.</p></div></div><div class="si-import-actions"><button class="button secondary si-cancel-import" type="button">Cancelar</button><button class="button primary si-confirm-import" type="button">Importar agora</button></div>`;
    document.body.appendChild(dialog);dialog.showModal();
    const close=()=>{dialog.close();dialog.remove()};
    dialog.querySelector('.si-dialog-close').addEventListener('click',close);
    dialog.querySelector('.si-cancel-import').addEventListener('click',close);
    dialog.addEventListener('click',e=>{if(e.target===dialog)close()});
    dialog.querySelector('.si-confirm-import').addEventListener('click',async e=>{
      const button=e.currentTarget,oldText=button.textContent;button.disabled=true;button.textContent='Importando…';
      let done=0;
      try{
        for(const record of records){await api('save',record);done++}
        close();
        toast(`${done} itens importados. Novos itens ficaram em rascunho.`,'success');
        $('siRefresh')?.click();
      }catch(err){button.disabled=false;button.textContent=oldText;toast(`Importação interrompida após ${done} itens: ${err.message||err}`,'error')}
    });
  }

  function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}

  async function readImport(file){
    try{
      if(!file)return;
      if(!/\.md$/i.test(file.name))throw new Error('Selecione um arquivo .md exportado por esta tela.');
      if(file.size>2_000_000)throw new Error('O arquivo é grande demais. Limite: 2 MB.');
      const data=pickJson(await file.text());
      const records=prepareImport(data);
      showImportDialog(file,records);
    }catch(e){toast(e.message||'Não consegui ler o arquivo.','error')}
    finally{if($('siImportFile'))$('siImportFile').value=''}
  }

  function boot(){
    $('siExportMd')?.addEventListener('click',exportMarkdown);
    $('siImportMd')?.addEventListener('click',()=>$('siImportFile')?.click());
    $('siImportFile')?.addEventListener('change',e=>readImport(e.target.files?.[0]));
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
