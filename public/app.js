const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M18 8a3 3 0 0 1 0 6 M22 21v-2a4 4 0 0 0-3-3',pipeline:'M4 3h16v18H4z M9 7v10 M15 7v6',target:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10 M12 10v4 M10 12h4',mail:'M3 5h18v14H3z M3 5l9 7 9-7',check:'M9 11l3 3L22 4 M21 12v8H3V3h12',tag:'M3 3h8l10 10-8 8L3 11z M7 7h.01',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',plus:'M12 5v14 M5 12h14',refresh:'M20 7a8 8 0 1 0 0 10 M20 2v6h-6',download:'M12 3v12 M7 10l5 5 5-5 M3 16v5h18v-5',edit:'M15 4l5 5 M3 21l5-1L21 7l-5-5L3 15z',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',key:'M8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10 M12 12l9 9 M17 17l3-3',spark:'M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z',menu:'M3 6h18 M3 12h18 M3 18h18',logout:'M9 3H3v18h6 M10 12h11 M16 7l5 5-5 5',close:'M5 5l14 14 M5 19L19 5',building:'M4 21V3h12v18 M16 9h4v12 M8 7h4 M8 11h4 M8 15h4',dollar:'M12 2v20 M17 5H9a4 4 0 0 0 0 8h6a3 3 0 0 1 0 6H6',trash:'M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6 M10 11v6 M14 11v6'};
const icon=(name)=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.dashboard}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const names={novo:'Novo',qualificado:'Qualificado',contatado:'Contatado',reuniao:'Reunião',proposta:'Proposta',ganho:'Ganho',perdido:'Perdido',rascunho:'Rascunho',aguardando_aprovacao:'Aguardando aprovação',aprovada:'Aprovada',pendente:'Aguardando Hermes',executando:'Em pesquisa',concluida:'Concluída',falhou:'Falhou',enviada:'Enviada',aguardando_backup:'Aguardando sua decisão'};
let token=sessionStorage.getItem('crm_token')||'',data=null,page='dashboard',filter='',period='all',menu=false,dragId=null,refreshTimer=null;
let inboxId='',inboxSearch='',inboxFilter='all',inboxSending=false;const inboxDrafts={};
const routes=[['dashboard','Dashboard','dashboard'],['leads','Leads','users'],['pipeline','Pipeline','pipeline'],['clients','Clientes','building'],['prospecting','Prospecção IA','target'],['sales','Vendas Hermes','mail'],['conversations','Conversas','mail'],['campaigns','E-mail marketing','mail'],['approvals','Aprovações','check'],['types','Tipos de lead','tag'],['integrations','Integrações','settings']];
const date=v=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'—';
const badge=s=>`<span class="badge ${['aprovada','ganho','concluida','enviada'].includes(s)?'green':['aguardando_aprovacao','pendente','executando','aguardando_backup'].includes(s)?'gold':['falhou','perdido'].includes(s)?'red':'purple'}">${esc(names[s]||s)}</span>`;
const btn=(label,action,ico='',cls='',attrs='')=>`<button class="${cls}" data-action="${action}" ${attrs}>${ico?icon(ico):''}${label}</button>`;
function toast(s){$('#toast').textContent=s;$('#toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').style.display='none',5000);}
async function api(p,method='GET',b){const r=await fetch('/api'+p,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:b===undefined?undefined:JSON.stringify(b)});const d=await r.json();if(!r.ok){if(r.status===401){token='';sessionStorage.removeItem('crm_token');login();}throw Error(d.error||'Falha na solicitação.');}return d;}
let supabaseClient=null,realtimeChannel=null;
async function initSupabaseRealtime(){
 if(supabaseClient||!window.supabase)return;
 try{
  const res=await fetch('/api/config/supabase');
  const cfg=await res.json();
  if(!cfg.enabled||!cfg.url||!cfg.anonKey)return;
  supabaseClient=window.supabase.createClient(cfg.url,cfg.anonKey);
  realtimeChannel=supabaseClient.channel('crm-realtime-records')
   .on('postgres_changes',{event:'*',schema:'public',table:'records'},(payload)=>{
     if(token&&data){
       load().catch(console.error);
     }
   })
   .subscribe((status)=>{
     if(status==='SUBSCRIBED')console.log('[Supabase Realtime] Conectado e ativo!');
   });
 }catch(e){console.warn('[Supabase Realtime] Erro ao conectar:',e);}
}
async function load(){
 const selected=inboxId,focus=page==='conversations'?document.activeElement:null,focusId=focus?.id,selection=[focus?.selectionStart,focus?.selectionEnd],history=page==='conversations'?$('#inbox-history'):null,scroll=history?.scrollTop,atBottom=history?history.scrollHeight-history.clientHeight-history.scrollTop<45:true;
 data=await api('/state');initSupabaseRealtime();render();
 if(page==='conversations'&&selected===inboxId){const h=$('#inbox-history');if(h)h.scrollTop=atBottom?h.scrollHeight:scroll||0;const f=focusId?$('#'+focusId):null;if(f){f.focus();if(typeof f.setSelectionRange==='function'&&typeof selection[0]==='number')f.setSelectionRange(...selection);}}
}
function login(){
  $('#app').innerHTML=`<section class="card login">
    <div class="brand"><img src="/favicon.svg" alt=""><div><strong>MLLuiz DevTech</strong><small>RELACIONAMENTOS & NEGÓCIOS</small></div></div>
    <h1>Seu próximo negócio começa aqui.</h1>
    <p>Acesse o CRM local para gerenciar leads, pipeline, prospecção e conversas comerciais.</p>
    <form id="login-form">
      <div class="login-fields">
        <label class="field"><span>E-mail</span><input name="email" type="email" required autocomplete="username" placeholder="admin@mlluizdevtech.com.br" value="admin@mlluizdevtech.com.br"></label>
        <label class="field"><span>Senha</span><input name="password" type="password" required autocomplete="current-password" placeholder="Sua senha"></label>
      </div>
      <button class="primary">Entrar no CRM</button>
      <p class="error" id="login-error"></p>
    </form>
    <div class="login-hint">
      <p><strong>Acesso padrão inicial:</strong><br>
      E-mail: <code>admin@mlluizdevtech.com.br</code><br>
      Senha: <code>admin123456</code></p>
    </div>
  </section>`;
  $('#login-form').onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const email=(fd.get('email')||'').trim(),password=fd.get('password')||'';
    const errEl=$('#login-error');
    errEl.textContent='';
    try{
      const res=await fetch('/api/auth/login',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email,password})
      });
      const d=await res.json();
      if(!res.ok)throw Error(d.error||'Falha ao efetuar login.');
      token=d.token;
      sessionStorage.setItem('crm_token',token);
      await load();
    }catch(err){
      errEl.textContent=err.message;
    }
  };
}
function heading(title,sub,action=''){return `<header class="page-heading"><div><h1>${title}</h1><p class="subtitle">${sub}</p></div>${action}</header>`;}
function empty(title,desc,action='',ico='target'){return `<div class="empty"><div class="icon-box">${icon(ico)}</div><h2>${title}</h2><p>${desc}</p>${action}</div>`;}
function render(){clearTimeout(refreshTimer);const pending=data.campaigns.filter(c=>c.status==='aguardando_aprovacao').length;
$('#app').innerHTML=`<aside class="sidebar ${menu?'open':''}"><div class="brand"><img src="/favicon.svg" alt=""><div><strong>MLLuiz DevTech</strong><small>CRM COMERCIAL</small></div></div><nav><div class="nav-label">Principal</div>${routes.map(([id,title,ico],i)=>`${i===4?'<div class="nav-label">Prospecção & comunicação</div>':i===7?'<div class="nav-label">Configurações</div>':''}<button class="nav-item ${page===id?'active':''}" data-page="${id}">${icon(ico)}${title}${id==='approvals'&&pending?`<span class="count">${pending}</span>`:''}</button>`).join('')}</nav><div class="side-bottom">Visualizando como<strong>Administrador</strong></div></aside><header class="topbar">${btn('','menu','menu','mobile-menu','aria-label="Abrir menu"')}<label class="global-search">${icon('search')}<input id="global-search" placeholder="Buscar leads, clientes..." aria-label="Buscar leads" value="${esc(filter)}"></label><div class="top-actions"><span class="realtime-badge"><span class="realtime-dot"></span>Supabase Realtime</span><span class="layout-note">Ambiente local</span><div class="profile" data-action="profile" role="button" title="Meu perfil e senha"><span class="avatar">ML</span><div class="profile-text">Marcelo Luiz<small>Administrador</small></div></div>${btn('','logout','logout','quiet','aria-label="Sair"')}</div></header><main id="content">${({dashboard:dashboard,leads:leads,clients:clients,pipeline:pipeline,prospecting:prospecting,sales:sales,conversations:conversations,campaigns:campaigns,approvals:approvals,types:types,integrations:integrations}[page]||dashboard)()}</main>`;bind();if(page==='conversations')bindInbox();scheduleProspectingRefresh();}
function scheduleProspectingRefresh(){
 if(!token)return;
 if(page==='prospecting'&&!data.jobs.some(j=>['pendente','executando'].includes(j.status)))return;
 if(page==='sales'&&!data.sales?.settings.enabled)return;
 if(!['prospecting','sales','conversations'].includes(page))return;
 refreshTimer=setTimeout(async()=>{
  if(!['prospecting','sales','conversations'].includes(page)||!token)return;
  if($('#modal')?.open||inboxSending||(page!=='conversations'&&document.activeElement?.closest('form'))){scheduleProspectingRefresh();return;}
  try{await load();}catch(e){toast(e.message);scheduleProspectingRefresh();}
 },5000);
}

function dashboard(){const cut=period==='all'?0:Date.now()-Number(period)*86400000;const ls=data.leads.filter(l=>Date.parse(l.createdAt)>=cut),won=ls.filter(l=>l.stage==='ganho').length;return heading('Dashboard','Uma visão clara das suas oportunidades.',btn('Exportar leads','export','download'))+`<div class="tabs">${[['1','24 horas'],['7','7 dias'],['30','30 dias'],['all','Tudo']].map(([v,l])=>`<button data-period="${v}" class="${period===v?'active':''}">${l}</button>`).join('')}</div><div class="stats">${[['users','blue',ls.length,'Leads cadastrados'],['check','green',won,'Negócios ganhos'],['target','',ls.filter(l=>l.stage==='qualificado').length,'Leads qualificados'],['mail','gold',data.campaigns.filter(c=>c.status==='aguardando_aprovacao').length,'Aprovações pendentes']].map(([i,c,n,t])=>`<div class="card stat"><div class="icon-box ${c}">${icon(i)}</div><strong>${n}</strong><label>${t}</label><div class="shape"></div></div>`).join('')}</div><p class="caption">Indicadores de leads no período selecionado. Aprovações mostram o total pendente atual.</p><div class="split"><section class="card"><div class="row between"><h2>Seu funil comercial</h2>${btn('Ver pipeline','pipeline','','quiet')}</div>${['novo','qualificado','contatado','reuniao','proposta','ganho'].map(s=>`<div class="metric-row"><div class="row between"><span class="muted">${names[s]}</span><strong>${ls.filter(l=>l.stage===s).length}</strong></div><div class="bar"><progress max="${Math.max(ls.length,1)}" value="${ls.filter(l=>l.stage===s).length}" aria-label="${names[s]}"></progress></div></div>`).join('')}</section><section class="card"><h2>Últimas atividades</h2>${data.audit.length?data.audit.slice(0,6).map(a=>`<div class="activity"><span class="dot"></span><div>${esc(activityName(a.action))}<small>${a.actor==='admin'?'Administrador':'Hermes'} · ${date(a.at)}</small></div></div>`).join(''):empty('Tudo pronto para começar','Adicione seu primeiro lead ou prepare uma pesquisa.',btn('Adicionar lead','new-lead','plus','primary'),'users')}</section></div>`;}
function activityName(s){return ({'lead.criado':'Lead cadastrado','lead.atualizado':'Lead atualizado','tipo.criado':'Tipo de lead criado','tipo.atualizado':'Tipo atualizado','campanha.criada':'Campanha criada','campanha.editada':'Campanha editada','campanha.submit':'Campanha enviada para revisão','campanha.approve':'Campanha aprovada','campanha.reject':'Campanha devolvida para revisão','pesquisa.criada':'Pesquisa adicionada à fila','pesquisa.assumida':'Hermes assumiu uma pesquisa','pesquisa.concluida':'Pesquisa concluída','pesquisa.falhou':'Pesquisa interrompida','pesquisa.aguardando_backup':'AISA falhou: aguardando sua decisão','pesquisa.apify_ativada':'Apify ativada como reserva','decisao.registrada':'Avaliação do worker registrada','integracao.hermes.conectada':'Hermes conectado no terminal','integracao.hermes.testada':'Hermes: conexão testada','integracao.hermes.falhou':'Hermes: falha na conexão','integracao.hermes.teste_falhou':'Hermes: teste falhou','integracao.apify.atualizada':'Chave da Apify atualizada','integracao.apify.removida':'Chave da Apify removida','integracao.aisa.atualizada':'Chave da AISA atualizada','integracao.aisa.removida':'Chave da AISA removida','integracao.openrouter.atualizada':'Chave do Jev/TypeSafe atualizada','integracao.openrouter.removida':'Chave do Jev/TypeSafe removida','integracao.resend.atualizada':'Chave do Resend atualizada','integracao.resend.removida':'Chave do Resend removida','integracao.apify.testada':'Apify: conexão testada','integracao.aisa.testada':'AISA: conexão testada','integracao.openrouter.testada':'Jev: conexão testada','integracao.resend.testada':'Resend: conexão testada','integracao.apify.teste_falhou':'Apify: teste falhou','integracao.aisa.teste_falhou':'AISA: teste falhou','integracao.openrouter.teste_falhou':'Jev: teste falhou','integracao.resend.teste_falhou':'Resend: teste falhou','pesquisa.limpeza':'Pesquisas antigas removidas','pesquisa.removida':'Pesquisa removida','campanha.enviada':'Campanha enviada','campanha.teste_enviado':'E-mail de teste enviado','campanha.envio_parcial':'Envio parcial (com falhas)','email.configurado':'Configurações de envio atualizadas'})[s]||s;}
function listLeads(client=false){return data.leads.filter(l=>(!client||l.stage==='ganho')&&[l.name,l.email,l.city,l.segment,l.contact].join(' ').toLowerCase().includes(filter.toLowerCase()));}
function leadTable(ls){return ls.length?`<div class="table-wrap"><table><thead><tr><th>Empresa / contato</th><th>Segmento</th><th>Localização</th><th>Etapa</th><th>Tipo</th><th></th></tr></thead><tbody>${ls.map(l=>`<tr><td><strong>${esc(l.name)}</strong><small>${esc(l.email||l.phone||'Sem contato cadastrado')}</small></td><td>${esc(l.segment||'—')}</td><td>${esc(l.city||'—')}</td><td>${l.blocked?'<span class="badge red">Não contatar</span>':badge(l.stage)}</td><td>${esc(data.types.find(t=>t.id===l.typeId)?.name||'—')}</td><td>${btn('Detalhes','lead-detail','','',`data-id="${l.id}"`)}</td></tr>`).join('')}</tbody></table></div>`:`<section class="card">${empty('Nenhum lead encontrado',filter?'Tente outro termo de busca.':'Cadastre seus contatos ou configure uma pesquisa com o Hermes.',btn('Adicionar lead','new-lead','plus','primary'),'users')}</section>`;}
function leads(){return heading('Leads','Contatos, contexto e próximos passos em um só lugar.',btn('Novo lead','new-lead','plus','primary'))+`<div class="toolbar"><span class="badge">${listLeads().length} registros</span><span class="spacer"></span>${btn('Atualizar','reload','refresh')}${btn('Exportar','export','download')}</div>`+leadTable(listLeads());}
function clients(){return heading('Clientes','Negócios marcados como ganhos no seu pipeline.')+leadTable(listLeads(true));}
function pipeline(){const st=['novo','qualificado','contatado','reuniao','proposta','ganho','perdido'];return heading('Pipeline','Arraste os cartões entre as colunas para mudar a etapa.',btn('Novo lead','new-lead','plus','primary'))+`<div class="kanban">${st.map(s=>{const ls=listLeads().filter(l=>l.stage===s);return `<section class="lane" data-stage="${s}"><h3>${names[s]}<span class="badge">${ls.length}</span></h3><div class="lane-body">${ls.map(l=>`<article class="lead-card" draggable="true" data-id="${l.id}"><strong>${esc(l.name)}</strong><p>${esc(l.segment||'Sem segmento')} · ${esc(l.city||'Sem cidade')}</p>${l.blocked?'<p class="error-text">Não contatar</p>':''}<select data-move="${l.id}" aria-label="Mover ${esc(l.name)} para outra etapa">${st.map(v=>`<option value="${v}" ${s===v?'selected':''}>${names[v]}</option>`).join('')}</select></article>`).join('')||'<p class="caption">Solte um cartão aqui.</p>'}</div></section>`;}).join('')}</div>`;}
function prospecting(){
const st=(data.integrations&&data.integrations.hermes)||{};
const ap=(data.integrations&&data.integrations.apify)||{};
const aisa=(data.integrations&&data.integrations.aisa)||{};
const ps=data.prospecting||{jobs:0,pending:0,running:0,completed:0,failed:0,finished:0,imported:0,cost:0};
const statCard=(ico,cor,val,lab)=>`<div class="card"><div class="icon-box ${cor}">${icon(ico)}</div><div><small>${lab}</small><strong>${val}</strong></div></div>`;
const workerCard=st.connected
  ?`<div class="card"><div class="icon-box green">${icon('check')}</div><div><small>Worker Hermes</small><strong>Ativo</strong><span class="caption">última atividade ${date(st.lastRunAt)}</span></div></div>`
  :`<div class="card"><div class="icon-box gold">${icon('clock')}</div><div><small>Worker Hermes</small><span class="badge gold">Aguardando 1ª execução</span></div></div>`;
const providersCard=`<div class="card"><div class="icon-box ${aisa.configured?'green':'gold'}">${icon('key')}</div><div><small>Fonte principal</small><strong>AISA</strong><span class="caption">${aisa.configured?'Chave configurada':'Configure a chave em Integrações'}</span><span class="caption">Apify: ${ap.configured?'reserva disponível, com sua autorização':'chave de reserva não configurada'}</span>${btn('Integrações','go-integrations','','quiet')}</div></div>`;
const costCard=`<div class="card"><div class="icon-box blue">${icon('dollar')}</div><div><small>Custo confirmado</small><strong>US$ ${ps.cost.toFixed(2)}</strong><span class="caption">acumulado das pesquisas</span></div></div>`;
const statsRow=`<div class="summary-cards">${statCard('target','',ps.jobs,'Pesquisas criadas')}${statCard('clock','gold',ps.pending+ps.running,'Na fila')}${statCard('check','green',ps.completed,'Concluídas')}${statCard('users','blue',ps.imported,'Leads importados')}</div>`;
const chips=(name,vals)=>`<span class="chips">${vals.map(v=>`<button type="button" class="chip" data-chip="${name}" data-value="${v}">${v}</button>`).join('')}</span>`;
const formCard=`<section class="card search-card"><div class="row"><div class="icon-box">${icon('spark')}</div><div><h2>Configurar busca de prospects</h2><p class="subtitle">Defina o público e envie a tarefa para a fila do Hermes.</p></div></div><form id="prospect-form"><div class="search-fields"><label class="field">Nicho de mercado<input name="niche" required maxlength="120" placeholder="Ex.: Academias">${chips('niche',['Academias','Dentistas','Lojas'])}</label><label class="field">Cidade / estado<input name="city" required maxlength="120" value="São Paulo, SP">${chips('city',['São Paulo, SP','Mauá, SP','Santo André, SP'])}</label><label class="field">Leads por busca<select name="limit"><option>5</option><option selected>10</option><option>20</option><option>30</option></select></label><label class="field">Teto de custo (US$)<input name="budget" type="number" value="5.00" min="0" max="100" step="0.01" required><span class="caption">A AISA pode usar até este orçamento. A Apify só usa o saldo restante quando você a ativa.</span></label></div><div class="form-actions"><button class="primary">${icon('spark')}Criar pesquisa</button></div></form></section>`;
const fila=ps.pending+ps.running>0?'Há pesquisas na fila aguardando o worker.':'Nenhuma pesquisa na fila.';
const infoLine=`<p class="info">AISA é a fonte principal. Se a busca falhar, você decide se deseja ativar a Apify. ${ps.awaitingBackup||0} pesquisa(s) aguardando sua decisão. ${fila} O worker do Hermes roda quando você o dispara — não há execução automática. Com teto zero a tarefa é recusada: a busca real é cobrada. Nenhum resultado é simulado.</p>`;
let jobsBlock;
if(!data.jobs.length){
  jobsBlock=`<div class="card">${empty('Inicie sua prospecção direcionada','Escolha um nicho e uma região. Os resultados aparecerão aqui quando o Hermes concluir a tarefa.','','target')}</div>`;
}else{
  const rows=data.jobs.map(j=>{
    const custo=jobCost(j);
    const erro=j.error?`<small class="error-text">${esc(j.error)}</small>`:'';
    const exced=j.budgetExceeded?'<small class="error-text">Teto excedido pelo worker</small>':'';
    const info=`${esc(j.niche)}<small>${esc(j.city)} · ${date(j.createdAt)} · ${j.searchProvider==='apify'?'Apify (reserva)':j.searchProvider==='aisa'?'AISA':'Fonte não registrada'}</small>${erro}${backupChoice(j)}`;
    return `<tr><td>${info}</td><td>${j.limit}</td><td>${badge(j.status)}${exced}</td><td>${custo}</td><td>${j.results.length}</td><td>${btn('Remover','remove-job','','quiet','data-id="'+j.id+'"')}</td></tr>`;
  }).join('');
  const cleanBtn=ps.finished?btn('Limpar concluídas e falhas','clean-jobs','',''):'';
  // No celular a tabela não cabe (6 colunas): cartões empilhados com a ação visível.
  const cards=data.jobs.map(j=>{
    const custo=jobCost(j);
    const erro=j.error?`<p class="error-text">${esc(j.error)}</p>`:'';
    return `<article class="job-card"><header><div><strong>${esc(j.niche)}</strong><small class="caption">${esc(j.city)} · ${date(j.createdAt)}</small></div>${badge(j.status)}</header><dl><dt>Solicitados</dt><dd>${j.limit}</dd><dt>Importados</dt><dd>${j.results.length}</dd><dt>Custo / teto</dt><dd>${custo}</dd></dl>${erro}${backupChoice(j)}<div class="form-actions">${btn('Remover','remove-job','','',`data-id="${j.id}"`)}</div></article>`;
  }).join('');
  jobsBlock=`<div class="toolbar"><span class="badge">${ps.jobs} pesquisa(s)</span><span class="spacer"></span>${cleanBtn}</div><div class="only-desktop"><div class="table-wrap"><table><thead><tr><th>Pesquisa</th><th>Solicitados</th><th>Status</th><th>Custo / teto</th><th>Importados</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div><div class="only-mobile">${cards}</div>`;
}
return heading('Prospecção IA','Encontre oportunidades e acompanhe a pesquisa do agente.')
  +`<div class="summary-cards">${workerCard}${providersCard}${costCard}</div>`
  +statsRow+formCard+infoLine+jobsBlock;
}
function campaigns(){return heading('E-mail marketing','Prepare campanhas e revise cada mensagem antes de aprovar.',btn('Nova campanha','new-campaign','plus','primary'))+`<div class="toolbar"><select id="campaign-filter" aria-label="Filtrar campanhas"><option value="">Todos os status</option>${['rascunho','aguardando_aprovacao','aprovada','enviada'].map(s=>`<option value="${s}">${names[s]}</option>`).join('')}</select>${btn('Atualizar','reload','refresh')}<span class="spacer"></span></div><div id="campaign-list">${campaignTable(data.campaigns)}</div>`;}
function campaignTable(cs){return cs.length?`<div class="table-wrap"><table><thead><tr><th>Campanha</th><th>Status</th><th>Destinatários</th><th>Versão</th><th>Data</th><th></th></tr></thead><tbody>${cs.map(c=>`<tr><td><strong>${esc(c.name)}</strong><small class="ellipsis">${esc(c.subject)}</small></td><td>${badge(c.status)}</td><td>${c.leadIds.length}</td><td>${c.version}</td><td>${date(c.createdAt)}</td><td>${btn('Abrir','edit-campaign','','',`data-id="${c.id}"`)}${btn('Excluir','delete-campaign','trash','danger',`data-id="${c.id}"`)}</td></tr>`).join('')}</tbody></table></div>`:`<section class="card">${empty('Sua próxima conversa começa aqui','Crie uma mensagem com contexto e selecione os contatos que deseja abordar.',btn('Criar campanha','new-campaign','plus','primary'),'mail')}</section>`;}
function backupChoice(j){
  if(j.status!=='aguardando_backup')return '';
  const remaining=Math.max(0,j.budget-(j.actualCost||0)-(j.reservedCost||0));
  const uncertain=j.costUncertain||j.reservedCost>0;
  const blocked=uncertain||remaining<=0;
  return `<div class="info"><strong>AISA falhou. Deseja ativar a Apify?</strong><p>Saldo restante: US$ ${remaining.toFixed(2)} de US$ ${j.budget.toFixed(2)}.</p>${uncertain?'<p>O custo da AISA ainda precisa ser confirmado. Confira o provedor antes de ativar a reserva.</p>':remaining<=0?'<p>Não há saldo para ativar a reserva.</p>':''}${btn('Ativar Apify','activate-apify','refresh','primary',`data-id="${j.id}" ${blocked?'disabled':''}`)}</div>`;
}
function outboxResult(o){
  const label={enviado:'enviado',falhou:'falhou',processando:'em processamento',incerto:'resultado incerto'}[o.status]||o.status;
  const color=o.status==='enviado'?'green':['incerto','processando'].includes(o.status)?'gold':'red';
  const help=['incerto','processando'].includes(o.status)?'Confira o envio no provedor antes de tentar novamente.':o.erro||'';
  return `<span class="badge ${color}">${esc(label)}</span><small class="error-text">${esc(help)}</small>`;
}
function jobCost(j){
  const confirmed=j.actualCost==null?'—':'US$ '+j.actualCost.toFixed(2)+' / US$ '+j.budget.toFixed(2);
  const pending=j.reservedCost>0?`<small>US$ ${j.reservedCost.toFixed(2)} a confirmar</small>`:j.costUncertain?'<small>Custo a confirmar</small>':'';
  return confirmed+pending+(j.warnings||[]).map(w=>`<small class="caption">${esc(w)}</small>`).join('');
}
function approvals(){
const pend=data.campaigns.filter(c=>c.status==='aguardando_aprovacao');
const prontas=data.campaigns.filter(c=>c.status==='aprovada');
const enviadas=data.campaigns.filter(c=>c.status==='enviada');
const cfg=data.emailSettings||{};
const blocoPend=pend.length?pend.map(c=>`<article class="card approval"><div class="row between"><div><h2>${esc(c.name)}</h2><p class="caption">Versão ${c.version} · ${c.leadIds.length} destinatário(s)</p></div>${badge(c.status)}</div><p><strong>Assunto:</strong> ${esc(c.subject)}</p><p class="caption">Para: ${c.leadIds.map(id=>{const l=data.leads.find(l=>l.id===id);return esc(l?`${l.name} <${l.email}>`:'Contato indisponível');}).join('; ')}</p><div class="message">${esc(c.body)}</div><div class="form-actions">${btn('Devolver para edição','reject','','',`data-id="${c.id}"`)}${btn('Aprovar esta versão','approve','check','primary',`data-id="${c.id}"`)}${btn('Excluir','delete-campaign','trash','danger',`data-id="${c.id}"`)}</div></article>`).join(''):`<section class="card">${empty('Nenhuma aprovação pendente','Submeta um rascunho de campanha para ele aparecer nesta fila.','','check')}</section>`;
const blocoProntas=prontas.length?`<h2 class="metric-row">Aprovadas, prontas para enviar</h2>${prontas.map(c=>{const d=c.approval?.recipients?.length||0;return `<article class="card approval"><div class="row between"><div><h2>${esc(c.name)}</h2><p class="caption">Versão ${c.version} · ${d} destinatário(s) aprovado(s)</p></div>${badge(c.status)}</div><p><strong>Assunto:</strong> ${esc(c.subject)}</p>${cfg.testMode?`<p class="info">Modo de teste ligado: a mensagem sai só para <strong>${esc(cfg.testRecipient||'— nenhum e-mail configurado —')}</strong>, nunca para os leads.</p>`:''}<div class="form-actions">${btn(cfg.testMode?'Enviar teste':'Enviar agora','send-campaign','mail','primary',`data-id="${c.id}"`)}${btn('Excluir','delete-campaign','trash','danger',`data-id="${c.id}"`)}</div></article>`;}).join('')}`:'';
const blocoEnviadas=enviadas.length?`<h2 class="metric-row">Enviadas</h2>${enviadas.map(c=>`<article class="card approval"><div class="row between"><div><h2>${esc(c.name)}</h2><p class="caption">Versão ${c.version} · enviada em ${date(c.sentAt)}</p></div>${badge(c.status)}</div><div class="form-actions">${btn('Excluir','delete-campaign','trash','danger',`data-id="${c.id}"`)}</div></article>`).join('')}`:'';
const historico=(data.outbox||[]).length?`<h2 class="metric-row">Histórico de envios</h2><div class="table-wrap"><table><thead><tr><th>Destinatário</th><th>Campanha</th><th>Modo</th><th>Resultado</th><th>Quando</th></tr></thead><tbody>${data.outbox.slice(0,20).map(o=>`<tr><td>${esc(o.email)}</td><td>${esc((data.campaigns.find(c=>c.id===o.campaignId)||{}).name||'—')} <small>v${o.version}</small></td><td>${o.modo==='teste'?'<span class="badge gold">teste</span>':'<span class="badge purple">produção</span>'}</td><td>${outboxResult(o)}</td><td>${date(o.at)}</td></tr>`).join('')}</tbody></table></div>`:'';
return heading('Aprovações','Confira o texto, aprove a versão e envie.')
+`<div class="toolbar"><span class="badge">${cfg.enviadosHoje??0} enviado(s) hoje</span><span class="badge ${cfg.testMode?'gold':'purple'}">${cfg.testMode?'Modo de teste':'Modo produção'}</span><span class="badge">Limite ${cfg.dailyLimit??20}/dia</span><span class="spacer"></span>${btn('Configurações de envio','email-settings','settings','')}</div>`
+blocoPend+blocoProntas+blocoEnviadas+historico
+`<p class="info">Aprovar registra sua autorização. Editar o texto invalida a aprovação. O envio usa o Resend e respeita o limite diário; testes e produção têm controles separados por versão e destinatário. Envios incertos exigem conferência no provedor.</p>`;
}
function types(){return heading('Tipos de lead','Organize os contatos conforme a relação com o seu negócio.',btn('Novo tipo','new-type','plus','primary'))+`<div class="types">${data.types.map(t=>`<article class="card type-card"><div class="row between"><div class="row"><div class="icon-box">${icon('tag')}</div><h3>${esc(t.name)}</h3></div><button class="toggle ${t.active?'on':''}" role="switch" aria-checked="${t.active}" aria-label="Ativar ${esc(t.name)}" data-action="toggle-type" data-id="${t.id}"><span></span></button></div><p class="desc">${esc(t.description||'Sem descrição.')}</p><span class="caption">${data.leads.filter(l=>l.typeId===t.id).length} leads vinculados</span><footer>${btn('Editar','edit-type','edit','',`data-id="${t.id}"`)}<span class="badge ${t.active?'purple':''}">${t.active?'Ativo':'Inativo'}</span></footer></article>`).join('')}</div>`;}
function integrations(){
const ig=data.integrations||{};
const hm=ig.hermes||{connected:false,lastRunAt:null};
// Cada card é um botão: abre o detalhe (e a configuração da chave, quando existe).
const card=(id,ico,nome,ok,okTxt,pendTxt,desc,extra)=>{
  const b=ok?`<span class="badge green">${okTxt}</span>`:`<span class="badge gold">${pendTxt}</span>`;
  const tip=id==='hermes'?(ok?'Clique para verificar ou reconectar no terminal':'Clique para conectar automaticamente no terminal'):'Clique para configurar a chave';
  return `<button class="card int-card" data-action="open-integration" data-id="${id}"><div class="row between"><div class="row"><div class="icon-box ${ok?'green':'gold'}">${icon(ico)}</div><h2>${nome}</h2></div>${b}</div><p>${desc}</p>${extra||''}<span class="caption">${tip}</span></button>`;
};
const chave=id=>{const s=ig[id]||{};return s.configured?`<p class="caption">Chave: <strong class="mono">${esc(s.masked)}</strong></p>`:'';};
const apifyCard=card('apify','key','Apify',ig.apify&&ig.apify.configured,'Conectada','Chave não configurada',
  'Pesquisa real de empresas no Google Maps: nome, categoria, endereço, telefone e site.',chave('apify'));
const aisaCard=card('aisa','search','AISA',ig.aisa&&ig.aisa.configured,'Conectada','Chave não configurada',
  'Fonte principal de pesquisa no Google Maps, com limite de orçamento. Também oferece enriquecimento de empresas.',chave('aisa'));
const jevCard=card('jev','spark','Jev (TypeSafe)',ig.jev&&ig.jev.configured,'Conectado','Chave não configurada',
  'Modelo de decisão pela API nativa da TypeSafe. Responde perguntas tipadas com probabilidade — o worker usa para qualificar leads.',chave('jev'));
const emailCard=card('email','mail','Envio de e-mail',ig.email&&ig.email.configured,'Chave configurada','Chave não configurada',
  'Resend. Envio real após configuração e aprovação. O modo de teste envia somente ao endereço de teste.',chave('email'));
const hermesCard=card('hermes','spark','Hermes Agent',hm.connected,'Ativo','Aguardando conexão',
  'Worker e API local: prospecção autônoma, importação de leads e vendas com IA.',
  hm.connected?(hm.lastRunAt?`<p class="caption">Última atividade: ${date(hm.lastRunAt)}</p>`:'<p class="caption">API local conectada na porta 8642</p>'):'<p class="caption">Gateway desligado ou com erro</p>');
return heading('Integrações','O que está conectado de verdade neste ambiente.')
+`<div class="integration-grid">${apifyCard}${aisaCard}${jevCard}${emailCard}${hermesCard}</div>`
+`<p class="info">Cada chave é gravada pelo servidor no arquivo de ambiente do Hermes e nunca aparece no navegador. Use <strong>Testar conexão</strong> para validar de verdade. O envio de e-mail exige configuração e aprovação; confira o modo de teste ou produção antes de enviar.</p>`;
}

// Configurações de envio (não são segredo: ficam no banco do CRM).
function emailSettingsModal(){
  const c=data.emailSettings||{from:'',fromName:'',testMode:true,testRecipient:'',dailyLimit:20,enviadosHoje:0,restante:20};
  modal(`<h2>Configurações de envio</h2><p class="caption">Remetente, modo de teste e limite diário. A chave do Resend fica em Integrações.</p><form id="email-form"><div class="stack">`
    +`<label class="field">Remetente<input name="from" type="email" value="${esc(c.from)}" required></label>`
    +`<label class="field">Nome exibido<input name="fromName" value="${esc(c.fromName)}" maxlength="120"></label>`
    +`<label class="row"><input type="checkbox" name="testMode" ${c.testMode?'checked':''}>Modo de teste (envia só para o e-mail abaixo, nunca para os leads)</label>`
    +`<label class="field">E-mail de teste<input name="testRecipient" type="email" value="${esc(c.testRecipient)}" placeholder="seu@email.com"></label>`
    +`<label class="field">Limite diário de envios<input name="dailyLimit" type="number" min="1" max="500" value="${c.dailyLimit}"></label>`
    +`</div><p class="caption">${c.enviadosHoje} enviado(s) hoje · restam ${c.restante}.</p><div class="form-actions"><button class="primary">Salvar</button></div></form>`);
  $('#email-form').onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(e.target);
    try{
      await api('/email/settings','PATCH',{from:f.get('from').trim(),fromName:f.get('fromName').trim(),testMode:f.get('testMode')==='on',testRecipient:f.get('testRecipient').trim(),dailyLimit:Number(f.get('dailyLimit'))});
      $('#modal').close();await load();toast('Configurações de envio salvas.');
    }catch(err){toast(err.message);}
  };
}

// Configuração de uma integração com chave (apify, aisa, jev, email).
function integrationModal(id){
  const ig=data.integrations||{}, hm=ig.hermes||{};
  if(id==='hermes'){
    modal(`<h2>Hermes Agent</h2>
      <div id="hermes-connect-status">
        <p class="caption">Executando script de conexão no terminal (verificando instalação, perfil e gateway)...</p>
        <div class="typing-dots" style="margin: 16px 0;"><span></span><span></span><span></span></div>
        <div class="form-actions" style="margin-top: 16px;">
          ${btn('Fechar', 'close', '', 'quiet')}
        </div>
      </div>`);
    const statusBox = $('#hermes-connect-status');
    const bindClose = () => $('#modal').querySelectorAll('[data-action="close"]').forEach(b => b.onclick = () => $('#modal').close());
    bindClose();
    (async () => {
      try {
        toast('Conectando ao Hermes via terminal...');
        const r = await api('/integrations/hermes/connect', 'POST', {});
        await load();
        if(statusBox && $('#modal').open){
          statusBox.innerHTML = `
            <div class="row" style="margin-bottom: 12px;">
              <div class="icon-box green">${icon('check')}</div>
              <div>
                <strong>Hermes conectado com sucesso!</strong>
                <p class="caption">O script executou e validou a conexão no terminal. O gateway está respondendo e as ferramentas MCP estão configuradas com segurança.</p>
              </div>
            </div>
            <p class="caption">URL do Gateway: <strong class="mono">${esc(r.url || 'http://127.0.0.1:8642')}</strong></p>
            <div class="form-actions" style="margin-top: 16px; justify-content: flex-start; gap: 10px;">
              ${btn('Reconectar / Testar novamente', 'hermes-reconnect', 'spark', 'primary')}
              ${btn('Fechar', 'close', '', 'quiet')}
            </div>
          `;
          const rec = statusBox.querySelector('[data-action="hermes-reconnect"]');
          if(rec) rec.onclick = () => integrationModal('hermes');
          bindClose();
        }
        toast('Hermes conectado com sucesso!');
      } catch(err) {
        if(statusBox && $('#modal').open){
          statusBox.innerHTML = `
            <div class="row" style="margin-bottom: 12px;">
              <div class="icon-box red">${icon('alert')}</div>
              <div>
                <strong>Falha ao conectar Hermes</strong>
                <p class="error-text">${esc(err.message)}</p>
              </div>
            </div>
            <div class="form-actions" style="margin-top: 16px; justify-content: flex-start; gap: 10px;">
              ${btn('Tentar novamente', 'hermes-reconnect', 'spark', 'primary')}
              ${btn('Fechar', 'close', '', 'quiet')}
            </div>
          `;
          const rec = statusBox.querySelector('[data-action="hermes-reconnect"]');
          if(rec) rec.onclick = () => integrationModal('hermes');
          bindClose();
        }
        toast('Erro ao conectar Hermes: ' + err.message);
      }
    })();
    return;
  }
  const INFO={
    apify:['Apify','Reserva para pesquisar empresas no Google Maps após sua ativação.','Obtenha a chave em apify.com/account/integrations.'],
    aisa:['AISA','Fonte principal de busca de empresas no Google Maps. A Apify fica como reserva, ativada por você.','Obtenha a chave no painel da AISA (aisa.one).'],
    jev:['Jev (TypeSafe)','Modelo de decisão pela API nativa TypeSafe. O worker envia um estado e perguntas tipadas e recebe probabilidades.','Use sua chave nativa da TypeSafe. O teste consulta os modelos sem gerar uma decisão paga.'],
    email:['Envio de e-mail','Provedor Resend. A chave é validada contra a API, sem enviar mensagem alguma.','Obtenha a chave em resend.com/api-keys.']
  }[id];
  if(!INFO) return;
  const st=ig[id]||{configured:false,masked:'',updatedAt:null};
  const tem=st.configured;
  modal(`<h2>${INFO[0]}</h2><p class="caption">${INFO[1]}</p>`
    +(tem?`<p class="caption">Chave atual: <strong class="mono">${esc(st.masked)}</strong>${st.updatedAt?' · atualizada em '+date(st.updatedAt):''}</p>`:'')
    +`<form id="int-form"><label class="field">${tem?'Nova chave':'Chave da API'}<input name="token" type="password" autocomplete="off" spellcheck="false" placeholder="${tem?esc(st.masked):'cole a chave aqui'}"></label>`
    +`<div class="form-actions">${tem?btn('Remover chave','remove-integration','','',`data-id="${id}"`):''}${btn('Fechar','close','','quiet')}<button class="primary">${tem?'Trocar chave':'Salvar chave'}</button></div></form>`
    +`<div class="form-actions" style="justify-content:flex-start">${btn('Testar conexão','test-integration','','',`data-id="${id}"`)}</div>`
    +`<p class="caption" id="int-result"></p><p class="caption">${INFO[2]}</p>`);
  // O modal vive fora de #app: bind() não alcança seus [data-action].
  $('#modal').querySelectorAll('[data-action="close"]').forEach(b=>b.onclick=()=>$('#modal').close());
  $('#int-form').onsubmit=async e=>{
    e.preventDefault();
    const sub=e.target.querySelector('button.primary'),v=(new FormData(e.target).get('token')||'').trim();
    if(!v){toast('Informe a chave.');return;}
    sub.disabled=true;
    try{await api('/integrations/'+id,'POST',{token:v});$('#modal').close();await load();toast('Chave de '+INFO[0]+' salva.');}
    catch(err){toast(err.message);}finally{sub.disabled=false;}
  };
  const rm=$('#modal').querySelector('[data-action="remove-integration"]');
  if(rm) rm.onclick=()=>action('remove-integration',id);
  const ts=$('#modal').querySelector('[data-action="test-integration"]');
  if(ts) ts.onclick=()=>action('test-integration',id);
}
function modal(html){
  const m=$('#modal');
  m.innerHTML=btn('','close','close','quiet modal-close','aria-label="Fechar"')+html;
  if(!m.open) m.showModal();
  m.querySelectorAll('[data-action="close"]').forEach(b=>b.onclick=()=>m.close());
  m.onclick=(e)=>{
    const r=m.getBoundingClientRect();
    if(e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom){
      m.close();
    }
  };
}
const field=(name,label,val='',type='text',required=false)=>`<label class="field">${label}<input name="${name}" type="${type}" value="${esc(val)}" ${required?'required':''}></label>`;
function leadForm(l={}){modal(`<h2>${l.id?'Editar lead':'Novo lead'}</h2><form id="lead-form"><div class="fields">${field('name','Empresa',l.name,'text',true)}${field('contact','Nome do contato',l.contact)}${field('email','E-mail profissional',l.email,'email')}${field('phone','Telefone',l.phone)}${field('segment','Segmento',l.segment)}${field('city','Cidade / estado',l.city)}${field('website','Site',l.website,'url')}<label class="field">Tipo<select name="typeId"><option value="">Sem tipo</option>${data.types.filter(t=>t.active||t.id===l.typeId).map(t=>`<option value="${t.id}" ${t.id===l.typeId?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label><label class="field full">Contexto / observações<textarea name="notes">${esc(l.notes)}</textarea></label><label class="row full"><input type="checkbox" name="blocked" ${l.blocked?'checked':''}>Não contatar este lead</label></div><div class="form-actions"><button class="primary">Salvar lead</button></div></form>`);$('#lead-form').onsubmit=e=>runForm(e,async b=>{b.blocked=e.target.elements.blocked.checked;await api('/leads'+(l.id?'/'+l.id:''),l.id?'PATCH':'POST',b);});}
function leadDetail(id){const l=data.leads.find(l=>l.id===id),ds=data.decisions.filter(d=>d.leadId===id);modal(`<div class="details"><h2>${esc(l.name)}</h2>${l.blocked?'<span class="badge red">Não contatar</span>':badge(l.stage)}<dl><dt>Contato</dt><dd>${esc(l.contact||'—')}</dd><dt>E-mail</dt><dd>${esc(l.email||'—')}</dd><dt>Telefone</dt><dd>${esc(l.phone||'—')}</dd><dt>Localização</dt><dd>${esc(l.city||'—')}</dd><dt>Site</dt><dd>${l.website?`<a href="${esc(l.website)}" target="_blank" rel="noopener noreferrer">${esc(l.website)}</a>`:'Não informado'}</dd><dt>Origem</dt><dd>${esc(l.origin)}</dd></dl><div class="message">${esc(l.notes||'Sem observações.')}</div>${l.sources?.length?`<h3 class="metric-row">Fontes</h3>${l.sources.map(s=>`<p class="source"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.url)}</a></p>`).join('')}`:''}${ds.length?`<h3 class="metric-row">Avaliações recebidas do worker</h3>${ds.map(d=>`<p><strong>${esc(d.question)}</strong><br>${esc(d.answer)}<br><small class="muted">${esc(d.model)} · ${date(d.createdAt)}</small></p>`).join('')}`:''}<div class="form-actions">${btn('Editar lead','modal-edit','edit','primary')}${btn('Excluir lead','delete-lead','trash','danger',`data-id="${l.id}"`)}</div></div>`);$('[data-action="modal-edit"]').onclick=()=>leadForm(l);const del=$('[data-action="delete-lead"]');if(del)del.onclick=()=>{modal(`<h2>Excluir lead</h2><p>Tem certeza que deseja excluir <strong>${esc(l.name)}</strong>?</p><p class="caption">Esta ação remove o lead e todas as suas decisões. Não pode ser desfeita.</p><div class="form-actions"><button class="danger" id="confirm-delete">Sim, excluir</button><button id="cancel-delete">Cancelar</button></div>`);$('#cancel-delete').onclick=()=>$('#modal').close();$('#confirm-delete').onclick=async()=>{try{await api('/leads/'+l.id,'DELETE');$('#modal').close();await load();toast('Lead excluído.');}catch(e){toast(e.message);}};};}
function campaignForm(c){const elegiveis=data.leads.filter(l=>!l.blocked);const available=elegiveis.filter(l=>l.email);modal(`<h2>${c?'Editar campanha':'Nova campanha'}</h2><form id="campaign-form"><div class="stack">${field('name','Nome da campanha',c?.name,'text',true)}${field('subject','Assunto',c?.subject,'text',true)}<label class="field">Mensagem<textarea name="body" required rows="7" placeholder="Escreva uma abordagem personalizada...">${esc(c?.body||'')}</textarea></label>${c?`<p class="caption">${c.leadIds.length} destinatário(s) · versão ${c.version}. Salvar retorna a campanha para rascunho.</p>`:`<label class="field">Destinatários<span class="caption">Todos os leads aparecem aqui. Quem não tem e-mail fica marcado e não pode ser selecionado. A busca também encontra pelo e-mail.</span></label><div class="recip-tools"><input id="recip-search" placeholder="Buscar por nome, e-mail ou cidade" aria-label="Buscar destinatários"><label class="recip-all"><input type="checkbox" id="recip-all">Selecionar todos com e-mail</label><span class="badge" id="recip-count">0 selecionados</span></div><div class="recipient-list" id="recip-list">${elegiveis.map(l=>`<label data-busca="${esc([l.name,l.email,l.city,l.segment].join(' ').toLowerCase())}" class="${l.email?'':'sem-email'}"><input type="checkbox" name="leadIds" value="${l.id}" ${l.email?'':'disabled'}>${esc(l.name)}${l.email?'':'<span class="badge gold">sem e-mail</span>'}</label>`).join('')||'<p class="caption">Cadastre um lead para criar campanhas.</p>'}</div><p class="caption">${available.length} de ${elegiveis.length} lead(s) podem receber e-mail.</p>`}</div><div class="form-actions">${c?.status==='rascunho'?btn('Submeter versão salva','submit-campaign','','',`type="button" data-id="${c.id}"`):''}<button class="primary" ${!c&&!available.length?'disabled':''}>Salvar rascunho</button></div></form>`);$('#campaign-form').onsubmit=e=>runForm(e,async b=>{if(c){b.version=c.version;await api('/campaigns/'+c.id,'PATCH',b);}else{b.leadIds=new FormData(e.target).getAll('leadIds');await api('/campaigns','POST',b);}});if($('#recip-list')){const lista=$('#recip-list'),busca=$('#recip-search'),todos=$('#recip-all'),cont=$('#recip-count');
  const visiveis=()=>[...lista.querySelectorAll('label[data-busca]')].filter(l=>l.style.display!=='none');
  const marca=()=>{const sel=[...lista.querySelectorAll('input[name="leadIds"]')].filter(i=>i.checked).length;if(cont)cont.textContent=sel+' selecionado'+(sel===1?'':'s');
    if(todos){const alvos=visiveis().map(l=>l.querySelector('input')).filter(i=>!i.disabled);const v=alvos.filter(i=>i.checked).length;todos.checked=alvos.length>0&&v===alvos.length;todos.indeterminate=v>0&&v<alvos.length;}};
  if(busca)busca.oninput=e=>{const q=e.target.value.trim().toLowerCase();lista.querySelectorAll('label[data-busca]').forEach(l=>{l.style.display=!q||l.dataset.busca.includes(q)?'':'none';});marca();};
  if(todos)todos.onchange=e=>{visiveis().forEach(l=>{const i=l.querySelector('input');if(!i.disabled)i.checked=e.target.checked;});marca();};
  lista.onchange=marca;marca();
}
const submit=$('[data-action="submit-campaign"]');if(submit)submit.onclick=async()=>{try{const f=new FormData($('#campaign-form'));if(['name','subject','body'].some(k=>f.get(k)!==c[k])){toast('Salve as alterações antes de submeter.');return;}await api('/campaigns/'+c.id+'/submit','POST');$('#modal').close();await load();toast('Campanha enviada para aprovação.');}catch(e){toast(e.message);}};}
function typeForm(t){modal(`<h2>${t?'Editar tipo':'Novo tipo de lead'}</h2><form id="type-form"><div class="stack">${field('name','Nome',t?.name,'text',true)}${field('description','Descrição',t?.description)}</div><div class="form-actions"><button class="primary">Salvar tipo</button></div></form>`);$('#type-form').onsubmit=e=>runForm(e,b=>api('/types'+(t?'/'+t.id:''),t?'PATCH':'POST',b));}
async function runForm(e,fn){e.preventDefault();const submit=e.target.querySelector('button[type="submit"],button.primary');if(submit)submit.disabled=true;try{await fn(Object.fromEntries(new FormData(e.target)));$('#modal').close();await load();toast('Salvo com sucesso.');}catch(err){toast(err.message);}finally{if(submit)submit.disabled=false;}}
function exportLeads(){const safe=v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};const rows=[['Empresa','Contato','Email','Telefone','Cidade','Segmento','Etapa','Não contatar'],...listLeads(page==='clients').map(l=>[l.name,l.contact,l.email,l.phone,l.city,l.segment,names[l.stage],l.blocked?'Sim':'Não'])];const a=document.createElement('a'),u=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(safe).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));a.href=u;a.download='leads-mlluiz.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function bind(){document.querySelectorAll('[data-page]').forEach(el=>el.onclick=()=>{page=el.dataset.page;menu=false;filter='';render();});$('#app').querySelectorAll('[data-action]').forEach(el=>{if(!el.closest('#campaign-list'))el.onclick=()=>action(el.dataset.action,el.dataset.id);});document.querySelectorAll('[data-period]').forEach(el=>el.onclick=()=>{period=el.dataset.period;render();});document.querySelectorAll('[data-move]').forEach(el=>el.onchange=async()=>{try{await api('/leads/'+el.dataset.move,'PATCH',{stage:el.value});await load();toast('Etapa atualizada.');}catch(e){toast(e.message);await load();}});document.querySelectorAll('[data-chip]').forEach(el=>el.onclick=()=>$('#prospect-form').elements[el.dataset.chip].value=el.dataset.value);$('#global-search').oninput=e=>{filter=e.target.value;if(!['leads','clients','pipeline'].includes(page))page='leads';const start=e.target.selectionStart;render();$('#global-search').focus();$('#global-search').setSelectionRange(start,start);};document.querySelectorAll('.lead-card[draggable]').forEach(card=>{card.addEventListener('dragstart',e=>{dragId=card.dataset.id;e.dataTransfer.setData('text/plain',dragId);e.dataTransfer.effectAllowed='move';card.classList.add('dragging');});card.addEventListener('dragend',()=>{card.classList.remove('dragging');dragId=null;document.querySelectorAll('.lane.drag-over').forEach(l=>l.classList.remove('drag-over'));});});
document.querySelectorAll('.lane').forEach(lane=>{lane.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';lane.classList.add('drag-over');});lane.addEventListener('dragleave',e=>{if(!lane.contains(e.relatedTarget))lane.classList.remove('drag-over');});lane.addEventListener('drop',async e=>{e.preventDefault();lane.classList.remove('drag-over');const id=e.dataTransfer.getData('text/plain')||dragId;if(!id)return;const stage=lane.dataset.stage,lead=data.leads.find(l=>l.id===id);if(!lead||lead.stage===stage)return;try{await api('/leads/'+id,'PATCH',{stage});await load();toast('Lead movido para '+names[stage]+'.');}catch(err){toast(err.message);await load();}});});
if($('#campaign-filter'))$('#campaign-filter').onchange=e=>$('#campaign-list').innerHTML=campaignTable(data.campaigns.filter(c=>!e.target.value||c.status===e.target.value));if($('#campaign-list'))$('#campaign-list').onclick=e=>{const b=e.target.closest('[data-action]');if(b){e.stopPropagation();action(b.dataset.action,b.dataset.id);}};if($('#prospect-form'))$('#prospect-form').onsubmit=e=>runForm(e,async b=>{const budget=Number(b.budget);if(!(budget>0)&&!confirm('Teto de custo zero: a busca real usa a AISA e é cobrada, então o worker vai recusar a tarefa.\n\nCriar mesmo assim?'))return;await api('/prospecting/jobs','POST',{...b,limit:Number(b.limit),budget});});}
async function action(a,id){try{if(a==='close'||a==='modal-close'){$('#modal').close();return;}if(a.startsWith('sales-'))return await salesAction(a,id);if(a==='menu'){menu=!menu;render();}if(a==='logout'){clearTimeout(refreshTimer);try{await fetch('/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token}});}catch(e){}token='';sessionStorage.removeItem('crm_token');data=null;login();}
if(a==='profile'){modal('<h2>Meu perfil</h2><div class="profile-meta"><p><strong>Administrador:</strong> Marcelo Luiz</p><p><small>admin@mlluizdevtech.com.br</small></p></div><form id="change-pass-form"><h3>Alterar senha</h3><div class="login-fields"><label class="field"><span>Senha atual</span><input name="currentPassword" type="password" required autocomplete="current-password"></label><label class="field"><span>Nova senha (mínimo 6 caracteres)</span><input name="newPassword" type="password" required minlength="6" autocomplete="new-password"></label></div><div class="form-actions"><button class="primary">Atualizar senha</button></div><p class="error" id="change-pass-error"></p></form>');$('#change-pass-form').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);try{const r=await api('/auth/change-password','POST',{currentPassword:fd.get('currentPassword'),newPassword:fd.get('newPassword')});$('#modal').close();toast(r.message||'Senha atualizada com sucesso!');}catch(err){$('#change-pass-error').textContent=err.message;}};return;}if(a==='reload')await load();if(a==='pipeline'){page='pipeline';render();}if(a==='export')exportLeads();if(a==='new-lead')leadForm();if(a==='lead-detail')leadDetail(id);if(a==='new-campaign')campaignForm();if(a==='edit-campaign')campaignForm(data.campaigns.find(c=>c.id===id));if(a==='new-type')typeForm();if(a==='edit-type')typeForm(data.types.find(t=>t.id===id));if(a==='clean-jobs'){const ps=data.prospecting||{};if(!confirm('Remover '+ps.finished+' pesquisa(s) concluída(s)/com falha da lista?\n\nOs leads já importados permanecem no CRM.'))return;const r=await api('/prospecting/jobs/clean','POST',{status:'finished'});await load();toast(r.removed+' pesquisa(s) removida(s).');}
if(a==='activate-apify'){await api('/prospecting/jobs/'+id+'/activate-apify','POST',{});await load();toast('Apify ativada. A pesquisa será executada pelo worker com o saldo restante.');return;}
if(a==='remove-job'){if(!confirm('Remover esta pesquisa da lista? Os leads importados permanecem no CRM.'))return;await api('/prospecting/jobs/'+id,'DELETE');await load();toast('Pesquisa removida.');}
if(a==='go-integrations'){page='integrations';render();return;}
if(a==='open-integration'){integrationModal(id);return;}
if(a==='remove-integration'){if(!confirm('Remover esta chave do arquivo de ambiente do Hermes?'))return;await api('/integrations/'+id,'DELETE');$('#modal').close();await load();toast('Chave removida.');}
if(a==='email-settings'){emailSettingsModal();return;}
if(a==='send-campaign'){const c=data.campaigns.find(x=>x.id===id);const cfg=data.emailSettings||{};const alvo=cfg.testMode?`APENAS para o e-mail de teste (${cfg.testRecipient||'não configurado'})`:`os ${c.approval?.recipients?.length||0} destinatário(s) aprovado(s)`;if(!confirm(`Enviar "${c.name}" (versão ${c.version}) para ${alvo}?`))return;try{const r=await api('/campaigns/'+id+'/send','POST',{});await load();toast(r.falhas&&r.falhas.length?`${r.enviados} enviado(s), ${r.falhas.length} falha(s).`:`${r.enviados} e-mail(s) enviado(s) em modo ${r.modo}.`);}catch(e){toast(e.message);}return;}
if(a==='delete-campaign'){const c=data.campaigns.find(x=>x.id===id);if(!confirm(`Excluir a campanha "${c.name}"?\n\nEsta ação remove a campanha e sua aprovação. Não pode ser desfeita.`))return;try{await api('/campaigns/'+id,'DELETE');await load();toast('Campanha excluída.');}catch(e){toast(e.message);}return;}
if(a==='test-integration'){const el=$('#int-result');if(el){el.textContent='Testando…';el.className='caption';}try{const r=await api('/integrations/'+id+'/test','POST');if(el){el.textContent=(r.ok?'✓ ':'✗ ')+r.detail;el.className=r.ok?'caption':'error-text';}toast(r.ok?'Conexão OK.':'Falha no teste.');}catch(e){if(el){el.textContent='✗ '+e.message;el.className='error-text';}toast(e.message);}}if(a==='toggle-type'){const t=data.types.find(t=>t.id===id);await api('/types/'+id,'PATCH',{active:!t.active});await load();}if(['approve','reject'].includes(a)){const c=data.campaigns.find(c=>c.id===id);await api('/campaigns/'+id+'/'+a,'POST',{version:c.version});await load();toast(a==='approve'?'Versão aprovada. Nenhuma mensagem foi enviada.':'Campanha devolvida para edição.');}}catch(e){toast(e.message);}}
Object.assign(names,{calculada:'Calculado por tokens',incluida:'Incluído no plano',ativa:'Em atendimento',pausada:'Pausada',aguardando_cliente:'Aguardando cliente',aceita:'Aceita pelo provedor',entregue:'Entregue',incerto:'Resultado incerto',cancelada:'Cancelada',recebida:'Recebida',revisao:'Revisão manual'});
function sales(){
 const s=data.sales||{},cfg=s.settings||{},cs=s.conversations||[],ms=s.messages||[],costs=s.costs||[];
 const billable=costs.filter(c=>!(cfg.hermesIncluded&&c.service==='hermes'));
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:cfg.timezone||'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const day=['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-'),period=cfg.budgetPeriod==='month'?day.slice(0,7):day;
 const currentCosts=billable.filter(c=>(cfg.budgetPeriod==='month'?c.day?.slice(0,7):c.day)===period);
 const actual=currentCosts.reduce((n,c)=>n+(c.actualUsd||0)+(c.estimatedUsd||0),0),reserved=billable.reduce((n,c)=>n+(c.reservedUsd||0),0),pending=ms.filter(m=>m.status==='aguardando_aprovacao');
 const health=s.connection;
 const connection=health?`<p>WhatsApp: ${esc(health.whatsapp?.authenticated?'Pareado':health.whatsapp?.error||'Aguardando pareamento')} · Jev: ${health.jev?.configured?'Chave configurada':'Configure a chave em Integrações'} · Hermes: ${esc(health.hermes?.connected?'API conectada':health.hermes?.error||'API indisponível')}</p><p class="caption">E-mail: ${health.email?.configured?'chave configurada':'chave ausente'} · recebimento: ${health.email?.receivingConfigured?'endereço informado; valide no Resend':'configure Reply-To e recebimento no Resend'}</p>`:'<p class="caption">Verifique as conexões antes de iniciar. WhatsApp precisa de pareamento e Hermes de API local configurada.</p>';
 return heading('Vendas com Hermes','Converse com os leads cadastrados e acompanhe cada oportunidade.',btn('Configurar vendas','sales-settings','settings'))+
 `<p class="info"><strong>Propostas e fechamento exigem sua aprovação.</strong> Abordagens e acompanhamentos usam mensagens controladas; textos livres também ficam para revisão.</p>
 <div class="summary-cards"><div class="card"><small>Operação</small><strong>${cfg.enabled?'Ativa':'Pausado'}</strong>${btn(cfg.enabled?'Pausar vendas':'Iniciar vendas','sales-toggle',cfg.enabled?'clock':'check',cfg.enabled?'':'primary')}</div><div class="card"><small>Conversas</small><strong>${cs.length}</strong><span class="caption">${cs.filter(c=>['ativa','aguardando_cliente'].includes(c.status)).length} em acompanhamento</span></div><div class="card"><small>Para revisar</small><strong>${pending.length}</strong></div><div class="card"><small>Custo registrado${cfg.hermesIncluded?' do Jev':''}</small><strong>US$ ${actual.toFixed(4)}</strong><span class="caption">US$ ${reserved.toFixed(2)} a confirmar · orçamento ${cfg.budgetPeriod==='month'?'mensal':'diário'} US$ ${Number(cfg.budgetPeriod==='month'?cfg.monthlyBudgetUsd||0:cfg.dailyBudgetUsd||0).toFixed(2)}</span>${currentCosts.some(c=>c.estimatedUsd>0)?'<span class="caption">Inclui valores calculados por tokens; não são confirmação de fatura.</span>':''}</div></div>
 <section class="card"><div class="row between"><h2>Conexões e execução</h2>${btn('Verificar conexões','sales-health','refresh')}</div>${connection}<p class="caption">Worker: ${esc(s.worker?.status||'ainda não verificado')} · ${date(s.worker?.at)}</p>${s.worker?.error?`<p class="error-text">${esc(s.worker.error)}</p>`:''}<p class="caption">O ingresso é explícito: pesquisar novos leads não inicia contato automaticamente.</p>${reserved>0?btn('Conferir custos pendentes','sales-costs','',''):''}</section>
 <div class="toolbar"><h2>Conversas comerciais</h2><span class="spacer"></span>${btn('Selecionar leads','sales-enroll','plus','primary')}${btn('Atualizar','reload','refresh')}</div>
 ${cs.length?`<div class="sales-grid">${cs.map(c=>{const l=data.leads.find(l=>l.id===c.leadId);return `<article class="card"><div class="row between"><h3>${esc(l?.name||'Lead removido')}</h3>${badge(c.status)}</div><p>${esc(c.channel==='whatsapp'?'WhatsApp':'E-mail')} · ${esc(c.recipient)}</p>${c.error?`<p class="error-text">${esc(c.error)}</p>`:''}<p class="caption">Próximo acompanhamento: ${date(c.nextActionAt)}</p>${btn('Acompanhar / assumir','sales-inbox','','',`data-id="${c.id}"`)}${btn('Excluir conversa','sales-delete','trash','danger',`data-id="${c.id}"`)}</article>`;}).join('')}</div>`:empty('Nenhuma conversa iniciada','Configure a oferta e selecione os leads que deseja atender.','','mail')}
 ${(s.deletedConversations||[]).length?`<details class="card metric-row"><summary>Conversas excluídas (${s.deletedConversations.length})</summary><p class="caption">Histórico, custos e envios incertos são preservados. Restaurar mantém o atendimento pausado.</p>${s.deletedConversations.map(c=>`<div class="row between"><span>${esc(data.leads.find(l=>l.id===c.leadId)?.name||'Lead removido')} · ${esc(c.channel)}</span><div>${btn('Abrir histórico','sales-conversation','','',`data-id="${c.id}"`)}${btn('Restaurar','sales-restore','','',`data-id="${c.id}"`)}</div></div>`).join('')}</details>`:''}
 ${pending.length?'<h2 class="metric-row">Propostas, fechamento e textos para revisão</h2>'+pending.map(m=>`<section class="card"><div class="row between"><h3>${esc(data.leads.find(l=>l.id===cs.find(c=>c.id===m.conversationId)?.leadId)?.name||'Conversa')}</h3>${badge(m.status)}</div><p>${esc(m.kind)} · ${esc(m.channel)} · versão ${m.version}</p><div class="message">${esc(m.body)}</div>${btn('Revisar mensagem','sales-conversation','check','primary',`data-id="${m.conversationId}"`)}</section>`).join(''):''}`;
}
function salesSettings(){
 const cfg=data.sales.settings;
 const input=(key,label,type='text',attrs='')=>`<label class="field">${label}<input name="${key}" type="${type}" value="${esc(cfg[key])}" ${attrs}></label>`;
 const area=(key,label)=>`<label class="field">${label}<textarea name="${key}" rows="3" maxlength="5000">${esc(cfg[key])}</textarea></label>`;
 modal(`<h2>Configuração comercial</h2><p class="caption">Defina a oferta e os limites. Salvar não inicia os envios.</p><form id="sales-settings"><div class="stack">${input('company','Empresa')}${input('seller','Nome do vendedor')}${area('offers','Serviços e oferta: descrição e público')}${area('portfolio','Portfólio e evidências verificadas')}${area('conditions','Preços, prazos e condições permitidos para propostas')}
 <label><input type="checkbox" name="hermesIncluded" ${cfg.hermesIncluded?'checked':''}> Hermes incluído no meu plano, sem cobrança adicional por geração</label><p class="caption">Com essa opção, apenas Jev consome o orçamento. O período mensal usa o mês do calendário no fuso configurado. Os limites do seu provedor continuam valendo.</p><div class="sales-fields"><label class="field">Período do orçamento<select name="budgetPeriod"><option value="day" ${cfg.budgetPeriod==='month'?'':'selected'}>Diário</option><option value="month" ${cfg.budgetPeriod==='month'?'selected':''}>Mensal</option></select></label>${input('monthlyBudgetUsd','Orçamento mensal (USD)','number','min="0" max="1000" step="0.001"')}${input('dailyBudgetUsd','Orçamento diário de IA (USD)','number','min="0" max="1000" step="0.001"')}${input('jevMaxCostUsd','Teto por decisão Jev (USD)','number','min="0" max="100" step="0.001"')}${input('hermesMaxCostUsd','Teto por geração Hermes (USD)','number','min="0" max="100" step="0.001"')}${input('dailyLimit','Mensagens por dia e canal (0 = sem teto local)','number','min="0" max="500"')}${input('followupHours','Intervalo de acompanhamento (horas)','number','min="1" max="720"')}${input('maxFollowups','Máximo de acompanhamentos','number','min="0" max="10"')}${input('startHour','Hora inicial','number','min="0" max="23"')}${input('endHour','Hora final','number','min="1" max="24"')}${input('timezone','Fuso horário')}</div>
 <label><input name="whatsappEnabled" type="checkbox" ${cfg.whatsappEnabled?'checked':''}> Habilitar WhatsApp via wacli</label><label><input name="emailEnabled" type="checkbox" ${cfg.emailEnabled?'checked':''}> Habilitar e-mail via Resend</label>${input('replyTo','E-mail de recebimento (Reply-To)','email')}
 <details><summary>Conexões locais</summary><div class="stack">${input('wacliBinary','Binário wacli 0.20.0')}${input('wacliStore','Diretório da sessão WhatsApp comercial')}${input('wacliAccount','Identificador da conta comercial')}${input('hermesUrl','URL da API local Hermes')}</div></details>
 <p class="caption">Os tetos de IA reservam orçamento local; configure também limites nas contas dos provedores. Para parear o WhatsApp, execute ./pair-sales-whatsapp.sh no terminal deste projeto. Chaves Jev/Resend são configuradas em Integrações.</p><p id="sales-form-error" class="error-text" role="alert"></p><button class="primary" type="submit">Salvar configuração</button></div></form>`);
 $('#sales-settings').onsubmit=e=>salesForm(e,async f=>{const b=Object.fromEntries(f);for(const k of ['dailyBudgetUsd','monthlyBudgetUsd','jevMaxCostUsd','hermesMaxCostUsd','dailyLimit','followupHours','maxFollowups','startHour','endHour'])b[k]=Number(b[k]);b.hermesIncluded=f.has('hermesIncluded');b.whatsappEnabled=f.has('whatsappEnabled');b.emailEnabled=f.has('emailEnabled');await api('/sales/settings','PATCH',b);});
}
async function salesForm(e,fn){e.preventDefault();const b=e.target.querySelector('button[type="submit"]');b.disabled=true;const error=$('#sales-form-error');if(error)error.textContent='';try{await fn(new FormData(e.target));$('#modal').close();await load();toast('Salvo.');}catch(err){if(error)error.textContent=err.message;else toast(err.message);}finally{b.disabled=false;}}
function salesEnroll(){
 const leads=data.leads.filter(l=>!l.blocked);
 modal(`<h2>Iniciar atendimento de leads</h2><p class="caption">Quando vendas estiver ativa, o Hermes contatará os leads selecionados pelo canal escolhido.</p><form id="sales-enroll"><div class="stack"><label class="field">Canal<select name="channel"><option value="whatsapp">WhatsApp (wacli)</option><option value="email">E-mail (Resend)</option></select></label><div class="recipient-list">${leads.map(l=>`<label><input name="leadIds" type="checkbox" value="${l.id}">${esc(l.name)}<small>${esc(l.email||'sem e-mail')} · ${esc(l.phone||'sem telefone')}</small></label>`).join('')||'<p class="caption">Nenhum lead disponível.</p>'}</div><label><input name="whatsappVerified" type="checkbox"> Confirmei que os telefones selecionados são canais WhatsApp das empresas.</label><p id="sales-form-error" class="error-text" role="alert"></p><button type="submit" class="primary" ${leads.length?'':'disabled'}>Adicionar ao atendimento</button></div></form>`);
 $('#sales-enroll').onsubmit=e=>salesForm(e,f=>api('/sales/conversations','POST',{leadIds:f.getAll('leadIds'),channel:f.get('channel'),whatsappVerified:f.has('whatsappVerified')}));
}
function salesConversation(id){
 const s=data.sales,c=[...s.conversations,...(s.deletedConversations||[])].find(c=>c.id===id),l=data.leads.find(l=>l.id===c.leadId),messages=s.messages.filter(m=>m.conversationId===id),ds=s.decisions.filter(d=>d.conversationId===id);
 modal(`<h2>${esc(l?.name||'Conversa')}</h2><p>${esc(c.channel)} · ${esc(c.recipient)} · ${badge(c.status)}</p><p class="caption">Aceite pelo provedor não confirma entrega nem pagamento.</p>${c.error?`<p class="error-text">${esc(c.error)}</p>`:''}
 <div class="sales-history">${messages.map(m=>`<article class="sales-message ${m.direction==='inbound'?'incoming':''}"><div class="row between"><strong>${m.direction==='inbound'?'Cliente':m.kind==='fechar'?'Fechamento':m.kind==='propor'?'Proposta':'Hermes'}</strong>${badge(m.status)}</div><p class="caption">${date(m.receivedAt||m.at||m.createdAt)}${m.direction==='outbound'?' · v'+m.version:''}</p><div class="message">${esc(m.body)}</div>${m.terms&&Object.keys(m.terms).length?`<pre class="sales-terms">${esc(JSON.stringify(m.terms,null,2))}</pre>`:''}
 ${['aguardando_aprovacao','aprovada'].includes(m.status)?`<div class="form-actions">${btn('Editar','sales-edit','edit','',`data-id="${m.id}"`)}${m.status==='aguardando_aprovacao'?btn('Aprovar esta versão','sales-approve','check','primary',`data-id="${m.id}"`):btn('Enviar versão aprovada','sales-send','mail','primary',`data-id="${m.id}"`)}${btn('Rejeitar','sales-reject','','',`data-id="${m.id}"`)}</div>`:''}${['incerto','processando'].includes(m.status)?btn('Conferir resultado do envio','sales-reconcile','','',`data-id="${m.id}"`):''}</article>`).join('')||'<p class="caption">Hermes ainda não preparou uma mensagem.</p>'}</div>
 ${ds.length?`<details><summary>Decisões do Jev</summary>${ds.map(d=>`<p>${esc(d.decision.action)} · intenção: ${esc(d.decision.intent||'—')} · objeção: ${esc(d.decision.objection||'—')} · confiança: ${typeof d.decision.confidence==='number'?Math.round(d.decision.confidence*100)+'%':'não informada'}</p>`).join('')}</details>`:''}
 <div class="form-actions">${c.deletedAt?btn('Restaurar conversa','sales-restore','','',`data-id="${id}"`):`${btn('Registrar resposta recebida','sales-inbound','','',`data-id="${id}"`)}${btn('Preparar mensagem manual','sales-manual','edit','',`data-id="${id}"`)}${btn(c.status==='pausada'?'Retomar conversa':'Pausar / assumir','sales-'+(c.status==='pausada'?'resume':'pause'),'clock','',`data-id="${id}"`)}${btn('Registrar resultado','sales-close','check','',`data-id="${id}"`)}${btn('Excluir conversa','sales-delete','trash','danger',`data-id="${id}"`)}`}</div>`);
 $('#modal').querySelectorAll('[data-action^="sales-"]').forEach(b=>b.onclick=()=>salesAction(b.dataset.action,b.dataset.id).catch(e=>toast(e.message)));
}
async function salesAction(a,id){
 if(a==='sales-inbox-open'){inboxId=id;render();return;}
 if(a==='sales-inbox-takeover'||a==='sales-inbox-resume'){
  await api('/sales/conversations/'+id+'/'+(a==='sales-inbox-takeover'?'takeover':'resume'),'POST',{});await load();if(a==='sales-inbox-takeover')setTimeout(()=>$('#inbox-body')?.focus(),100);return toast(a==='sales-inbox-takeover'?'IA pausada. Você assumiu a conversa.':'Atendimento devolvido à IA.');
 }

 if(a==='sales-delete'){
  if(!confirm('Excluir esta conversa comercial da lista ativa?\n\nTarefas e mensagens pendentes serão canceladas. O lead, o histórico e os custos serão preservados. Você poderá restaurar a conversa.'))return;
  await api('/sales/conversations/'+id,'DELETE');$('#modal').close();await load();return toast('Conversa excluída.');
 }
 if(a==='sales-restore'){await api('/sales/conversations/'+id+'/restore','POST',{});$('#modal').close();await load();return toast('Conversa restaurada e pausada.');}

 if(a==='sales-costs'){
  const costs=data.sales.costs.filter(c=>c.reservedUsd>0);
  modal(`<h2>Conferir custo no provedor</h2><p class="caption">Informe o valor efetivamente cobrado e uma referência verificável. Chamadas em andamento não podem ser reconciliadas.</p><form id="sales-cost-form"><div class="stack"><label class="field">Reserva<select name="id">${costs.map(c=>`<option value="${esc(c.id)}">${esc(c.service)} · ${date(c.at)} · US$ ${c.reservedUsd.toFixed(4)}</option>`).join('')}</select></label><label class="field">Custo confirmado (USD)<input name="actualUsd" type="number" min="0" step="0.000001" required></label><label class="field">Evidência<textarea name="evidence" required maxlength="2000"></textarea></label><p id="sales-form-error" class="error-text" role="alert"></p><button class="primary" type="submit">Registrar custo confirmado</button></div></form>`);
  $('#sales-cost-form').onsubmit=e=>salesForm(e,f=>api('/sales/costs/'+f.get('id')+'/reconcile','POST',{actualUsd:Number(f.get('actualUsd')),evidence:f.get('evidence')}));return;
 }
 if(a==='sales-inbox'){page='conversations';inboxId=id||'';render();return;}
 if(a==='sales-settings')return salesSettings();if(a==='sales-enroll')return salesEnroll();if(a==='sales-conversation')return salesConversation(id);
 if(a==='sales-toggle'){await api('/sales/settings','PATCH',{enabled:!data.sales.settings.enabled});await load();return toast(data.sales.settings.enabled?'Vendas ativa para os leads selecionados.':'Vendas pausada.');}
 if(a==='sales-health'){toast('Verificando conexões…');await api('/sales/health','POST',{});await load();return toast('Verificação concluída.');}
 if(['sales-approve','sales-reject','sales-send','sales-pause','sales-resume'].includes(a)){
  const m=data.sales.messages.find(m=>m.id===id),route=a.slice(6),p=['pause','resume'].includes(route)?'/sales/conversations/':'/sales/messages/';
  await api(p+id+'/'+route,'POST',m?{version:m.version}:{});$('#modal').close();await load();return toast(route==='approve'?'Versão aprovada; o worker enviará durante o horário configurado.':'Atualizado.');
 }
 if(['sales-edit','sales-inbound','sales-manual','sales-close','sales-reconcile'].includes(a)){
  const m=data.sales.messages.find(m=>m.id===id);
  const close=a==='sales-close',reconcile=a==='sales-reconcile';
  modal(`<h2>${close?'Registrar ganho ou perda':reconcile?'Reconciliação de envio':a==='sales-edit'?'Editar mensagem para revisão':a==='sales-inbound'?'Registrar resposta do cliente':'Preparar mensagem manual'}</h2><form id="sales-text-form"><div class="stack">${close?'<label class="field">Resultado<select name="outcome"><option value="ganho">Ganho</option><option value="perdido">Perdido</option></select></label>':reconcile?'<label class="field">Resultado conferido no provedor<select name="status"><option value="aceita">Aceita pelo provedor</option><option value="entregue">Entrega comprovada</option><option value="falhou">Falha comprovada</option></select></label>':a==='sales-manual'?'<label class="field">Tipo<select name="kind"><option value="responder">Resposta</option><option value="propor">Proposta</option><option value="fechar">Fechamento</option></select></label>':''}${a==='sales-edit'||a==='sales-manual'?`<label class="field">Assunto<input name="subject" maxlength="200" value="${esc(m?.subject||'Conversa comercial')}"></label>`:''}<label class="field">${close||reconcile?'Evidência / referência da confirmação':'Mensagem'}<textarea name="${close||reconcile?'evidence':'body'}" rows="6" required maxlength="${close||reconcile?'2000':'8000'}">${esc(a==='sales-edit'?m.body:'')}</textarea></label><p id="sales-form-error" class="error-text" role="alert"></p><button class="primary" type="submit">${close||reconcile?'Registrar confirmação':'Salvar'}</button></div></form>`);
  $('#sales-text-form').onsubmit=e=>salesForm(e,f=>{const b=Object.fromEntries(f);if(a==='sales-edit')return api('/sales/messages/'+id+'/edit','POST',{...b,version:m.version});if(reconcile)return api('/sales/messages/'+id+'/reconcile','POST',b);return api('/sales/conversations/'+id+'/'+(close?'close':a==='sales-manual'?'message':'inbound'),'POST',b);});
 }
}
if(token)load().catch(e=>{login();toast(e.message);});else login();
function conversations(){
 const s=data.sales||{},cs=s.conversations||[],ms=s.messages||[],query=inboxSearch.toLocaleLowerCase('pt-BR');
 const shown=cs.filter(c=>{const l=data.leads.find(l=>l.id===c.leadId),match=[l?.name,c.recipient,c.channel].join(' ').toLocaleLowerCase('pt-BR').includes(query);return match&&(inboxFilter==='all'||(inboxFilter==='human'?c.control==='human':inboxFilter==='ai'?c.control!=='human'&&['ativa','aguardando_cliente'].includes(c.status):inboxFilter==='review'?ms.some(m=>m.conversationId===c.id&&m.status==='aguardando_aprovacao'):c.status==='pausada'));}).sort((a,b)=>{
  const last=c=>{const m=ms.filter(m=>m.conversationId===c.id).at(-1);return Date.parse(m?.at||m?.receivedAt||m?.createdAt||c.createdAt)||0;};return last(b)-last(a);
 });
 if(!shown.some(c=>c.id===inboxId))inboxId=shown[0]?.id||'';
 const c=shown.find(c=>c.id===inboxId),l=c?data.leads.find(l=>l.id===c.leadId):null,messages=c?ms.filter(m=>m.conversationId===c.id):[],decision=c?(s.decisions||[]).filter(d=>d.conversationId===c.id).at(-1):null,draft=inboxDrafts[inboxId]||{body:'',subject:'',kind:'responder'};
 const mode=c?.control==='human'?'Você no controle':c?.status==='pausada'?'IA pausada':s.settings?.enabled?'IA no atendimento':'IA pausada globalmente';
 return heading('Conversas','Acompanhe o atendimento e assuma a conversa quando precisar.',btn('Atualizar','reload','refresh'))+
 `<p class="caption">Atualização a cada 5 segundos · worker ${esc(s.worker?.status||'não verificado')} · propostas e fechamento exigem aprovação</p><div class="conversation-workspace">
 <aside class="card conversation-sidebar"><label class="field">Buscar conversa<input id="inbox-search" value="${esc(inboxSearch)}" placeholder="Nome ou telefone"></label><label class="field">Exibir<select id="inbox-filter">${[['all','Todas'],['ai','Com a IA'],['human','Sob meu controle'],['paused','Pausadas'],['review','Para aprovação']].map(([id,name])=>`<option value="${id}" ${inboxFilter===id?'selected':''}>${name}</option>`).join('')}</select></label><div class="conversation-list">${shown.map(item=>{const lead=data.leads.find(l=>l.id===item.leadId),last=ms.filter(m=>m.conversationId===item.id).at(-1);return `<button class="conversation-contact ${item.id===inboxId?'selected':''}" data-action="sales-inbox-open" data-id="${item.id}" aria-pressed="${item.id===inboxId}"><strong>${esc(lead?.name||'Lead removido')}</strong><small>${esc(item.channel==='whatsapp'?'WhatsApp':'E-mail')} · ${item.control==='human'?'Você no controle':esc(names[item.status]||item.status)}</small>${item.typing?'<span class="typing-pill"><span class="typing-dot-small"></span> digitando...</span>':`<span>${esc((last?.body||'Ainda sem mensagens').slice(0,90))}</span>`}<time>${date(last?.at||last?.receivedAt||last?.createdAt||item.createdAt)}</time></button>`;}).join('')||'<p class="caption">Nenhuma conversa neste filtro.</p>'}</div></aside>
 <section class="card conversation-thread">${c?`<header class="conversation-header"><div><h2>${esc(l?.name||'Lead removido')}</h2><p class="caption">${esc(c.channel)} · ${esc(c.recipient)}</p><strong class="conversation-control">${mode}</strong></div><div class="form-actions">${!['ganho','perdido'].includes(c.status)?btn(c.control==='human'?'Devolver à IA':'Pausar IA e assumir',c.control==='human'?'sales-inbox-resume':'sales-inbox-takeover',c.control==='human'?'spark':'clock','primary',`data-id="${c.id}"`):''}${btn('Mais opções','sales-conversation','settings','',`data-id="${c.id}"`)}</div></header>
 ${c.error?`<p class="info">${esc(c.error)}</p>`:''}${messages.some(m=>m.status==='processando')?'<p class="info">Um envio já em andamento pode concluir mesmo após você pausar a IA.</p>':''}
 <div id="inbox-history" class="conversation-history" role="log" aria-label="Histórico da conversa">${messages.map(m=>`<article class="conversation-bubble ${m.direction==='inbound'?'incoming':m.author==='admin'?'human':'outgoing'}"><div class="row between"><strong>${m.direction==='inbound'?'Cliente':m.author==='admin'?'Você':'Hermes'}</strong>${badge(m.status)}</div><p>${esc(m.body)}</p><time class="caption">${date(m.at||m.receivedAt||m.createdAt)}</time>${m.error?`<p class="error-text">${esc(m.error)}</p>`:''}${m.status==='aguardando_aprovacao'||m.status==='aprovada'?`<div class="form-actions">${btn('Revisar mensagem','sales-conversation','check','',`data-id="${m.id}"`)}</div>`:''}${['incerto','processando'].includes(m.status)?btn('Conferir envio','sales-reconcile','','',`data-id="${m.id}"`):''}</article>`).join('')||'<p class="caption">Nenhuma mensagem registrada.</p>'}${c.typing?`<article class="conversation-bubble outgoing typing" role="status" aria-label="Hermes está digitando"><div class="typing-header"><strong>Hermes</strong><span class="typing-label">digitando</span></div><div class="typing-dots"><span></span><span></span><span></span></div></article>`:''}</div>
 ${decision?`<details class="conversation-decision"><summary>Última decisão do Jev: ${esc(decision.decision.action)}</summary><p class="caption">Intenção: ${esc(decision.decision.intent||'—')} · objeção: ${esc(decision.decision.objection||'—')} · confiança: ${Number.isFinite(decision.decision.confidence)?Math.round(decision.decision.confidence*100)+'%':'não informada'}</p></details>`:''}
 ${c.control==='human'&&!['ganho','perdido'].includes(c.status)?`<form id="inbox-compose" class="conversation-compose"><div class="sales-fields"><label class="field">Tipo<select id="inbox-kind" name="kind">${[['responder','Resposta'],['propor','Proposta'],['fechar','Fechamento']].map(([id,name])=>`<option value="${id}" ${draft.kind===id?'selected':''}>${name}</option>`).join('')}</select></label>${c.channel==='email'?`<label class="field">Assunto<input id="inbox-subject" name="subject" maxlength="200" value="${esc(draft.subject)}"></label>`:''}</div><label class="field">Sua mensagem<textarea id="inbox-body" name="body" rows="4" required maxlength="8000" placeholder="Escreva sua resposta...">${esc(draft.body)}</textarea></label><p class="caption">Você envia respostas diretamente. Propostas e fechamento ficam para revisão antes do envio.</p><p id="inbox-error" class="error-text" role="alert"></p><button class="primary" id="inbox-submit" type="submit" ${inboxSending?'disabled':''}>${draft.kind==='responder'?'Enviar resposta':'Preparar para aprovação'}</button></form>`:`<div class="conversation-callout ${c.status==='pausada'?'warning':''}"><div class="row between"><div><strong>${c.status==='pausada'?'⚠️ Intervenção necessária: IA pausada':'IA ativa no atendimento'}</strong><p class="caption">${esc(c.error||'Você pode assumir esta conversa para responder ao lead imediatamente.')}</p></div>${!['ganho','perdido'].includes(c.status)?btn('Assumir e responder','sales-inbox-takeover','clock','primary',`data-id="${c.id}"`):''}</div></div>`}`:empty('Selecione uma conversa','Inicie um atendimento em Vendas Hermes para acompanhá-lo aqui.','','mail')}</section></div>`;
}
function bindInbox(){
 const search=$('#inbox-search');if(search)search.oninput=e=>{const cursor=e.target.selectionStart;inboxSearch=e.target.value;render();$('#inbox-search').focus();$('#inbox-search').setSelectionRange(cursor,cursor);};
 const filter=$('#inbox-filter');if(filter)filter.onchange=e=>{inboxFilter=e.target.value;render();};
 const history=$('#inbox-history');if(history)history.scrollTop=history.scrollHeight;
 const form=$('#inbox-compose');if(!form)return;
 const save=()=>{inboxDrafts[inboxId]={body:$('#inbox-body').value,subject:$('#inbox-subject')?.value||'',kind:$('#inbox-kind').value};$('#inbox-submit').textContent=inboxDrafts[inboxId].kind==='responder'?'Enviar resposta':'Preparar para aprovação';};
 form.oninput=save;form.onchange=save;
 form.onsubmit=async e=>{
  e.preventDefault();if(inboxSending)return;save();const id=inboxId,c=data.sales.conversations.find(c=>c.id===id),draft={...inboxDrafts[id]};inboxSending=true;$('#inbox-submit').disabled=true;form.setAttribute('aria-busy','true');$('#inbox-error').textContent='';
  try{const m=await api('/sales/conversations/'+id+'/human-message','POST',{...draft,conversationVersion:c.version});delete inboxDrafts[id];if(draft.kind==='responder'){const result=await api('/sales/messages/'+m.id+'/send','POST',{});toast(result.status==='aceita'||result.status==='entregue'?'Resposta aceita pelo provedor.':result.error||'Confira o resultado no histórico.');}else toast('Mensagem preparada para aprovação.');await load();}catch(err){const error=$('#inbox-error');if(error)error.textContent=err.message;else toast(err.message);}finally{inboxSending=false;if($('#inbox-submit'))$('#inbox-submit').disabled=false;if($('#inbox-compose'))$('#inbox-compose').setAttribute('aria-busy','false');scheduleProspectingRefresh();}
 };
}
