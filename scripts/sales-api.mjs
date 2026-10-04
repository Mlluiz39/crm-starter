import {randomUUID} from 'node:crypto';
import {createSalesStore} from './sales-store.mjs';
import {DEFAULT_SALES,salesError as fail,salesText as text,validateSalesSettings,salesRecipient,requiresApproval,templateMessage,withinSalesHours,salesDay} from './sales-policy.mjs';
export function createSalesApi({db,getLead,putLead,audit,emailSettings,sendEmail,sendWhatsapp,presenceWhatsapp,emailQuota,checkConnection}){
 const store=createSalesStore(db),{all,get,put,transaction}=store;
 const now=()=>new Date().toISOString();
 const settings=()=>({...DEFAULT_SALES,...get('settings','sales')});
 const admin=role=>{if(role!=='admin')fail(403,'Somente o administrador pode realizar esta ação.');};
 const agent=role=>{if(role!=='agent')fail(403,'Rota exclusiva do agente.');};
 const required=(kind,id)=>{const v=get(kind,id);if(!v)fail(404,'Registro comercial não encontrado.');return v;};
 const active=c=>{const cfg=settings(),lead=getLead(c.leadId);if(c.control==='human'||c.deletedAt||!cfg.enabled||!['ativa','aguardando_cliente'].includes(c.status)||!lead||lead.blocked)fail(409,'Atendimento pausado, encerrado ou lead bloqueado.');if(!(c.channel==='email'?cfg.emailEnabled:cfg.whatsappEnabled))fail(409,'Canal desabilitado.');if(salesRecipient(lead,c.channel,true)!==c.recipient)fail(409,'Destinatário mudou; revise a conversa.');return lead;};
 const humanActive=c=>{const cfg=settings(),lead=getLead(c.leadId);if(c.control!=='human'||c.deletedAt||['ganho','perdido'].includes(c.status)||!lead||lead.blocked)fail(409,'Assuma uma conversa disponível antes de responder.');if(!(c.channel==='email'?cfg.emailEnabled:cfg.whatsappEnabled))fail(409,'Canal desabilitado.');if(salesRecipient(lead,c.channel,true)!==c.recipient)fail(409,'Destinatário mudou; revise a conversa.');return lead;};
 const cancel=c=>{
  for(const m of all('salesMessages').filter(m=>m.conversationId===c.id&&['pendente','aprovada','aguardando_aprovacao'].includes(m.status)))put('salesMessages',{...m,status:'cancelada'});
  for(const t of all('salesTasks').filter(t=>t.conversationId===c.id&&['pendente','executando'].includes(t.status)))put('salesTasks',{...t,status:'cancelada'});
 };
 const enqueue=(c,reason)=>put('salesTasks',{id:randomUUID(),conversationId:c.id,conversationVersion:c.version,status:'pendente',reason,createdAt:now()});
 const lease=(id,b)=>{const t=required('salesTasks',id);if(t.status!=='executando'||t.leaseToken!==b.leaseToken||Date.parse(t.leaseUntil)<=Date.now())fail(409,'Reserva comercial inválida ou expirada.');return t;};
 const state=()=>({settings:settings(),conversations:all('salesConversations').filter(c=>!c.deletedAt).map(c=>({...c,typing:all('salesTasks').some(t=>t.conversationId===c.id&&t.status==='executando')})),deletedConversations:all('salesConversations').filter(c=>c.deletedAt),messages:all('salesMessages'),decisions:all('salesDecisions'),tasks:all('salesTasks').map(({leaseToken,...t})=>t),approvals:all('salesMessages').filter(m=>m.status==='aguardando_aprovacao'),costs:all('salesCosts'),worker:get('settings','salesWorker')||null,connection:get('settings','salesConnection')||null});
 async function dispatch(method,p,b,role){
  if(method==='POST'&&p==='/api/sales/health'){admin(role);const v=checkConnection?await checkConnection(settings()):{error:'Verificação de conexão indisponível.'};put('settings',{...v,id:'salesConnection',at:now()});return v;}
  if(method==='POST'&&p==='/api/agent/sales/heartbeat'){agent(role);if(!['ativo','pausado','erro'].includes(b.status))fail(400,'Estado inválido.');return put('settings',{id:'salesWorker',status:b.status,error:text(b.error||'','erro',500),at:now()});}
  const cursorRoute=p.match(/^\/api\/agent\/sales\/cursors\/([A-Za-z0-9_-]{1,80})$/);
  if(cursorRoute){agent(role);const old=get('salesCursors',cursorRoute[1])||{id:cursorRoute[1],rowid:0};
   if(method==='GET')return old;
   if(method==='POST'){
    if(b.rowid!==undefined&&(!Number.isSafeInteger(b.rowid)||b.rowid<old.rowid))fail(409,'Cursor não pode retroceder.');
    if(old.fingerprint&&b.fingerprint!==old.fingerprint)fail(409,'Banco mudou; revise cursor.');
    return put('salesCursors',{id:old.id,rowid:b.rowid??old.rowid,...(b.head?{head:text(b.head,'cursor',200,true)}:{}),...(b.fingerprint?{fingerprint:text(b.fingerprint,'banco',100,true)}:{}),at:now()});
   }
  }
  if(p==='/api/sales/settings'){
   admin(role);if(method==='GET')return settings();
   if(method==='PATCH'){const v=validateSalesSettings(b,settings());put('settings',{...v,id:'sales'});audit(role,'vendas.configurada','sales');return v;}
  }
  if(method==='GET'&&p==='/api/agent/sales/state'){agent(role);return {...state(),leads:all('salesConversations').filter(c=>!c.deletedAt).map(c=>getLead(c.leadId)).filter(Boolean)};}
  if(method==='POST'&&p==='/api/sales/conversations'){
   admin(role);if(!Array.isArray(b.leadIds)||!b.leadIds.length||b.leadIds.length>100)fail(400,'Selecione de 1 a 100 leads.');
   const selected=b.leadIds.map(id=>({lead:getLead(id),recipient:salesRecipient(getLead(id),b.channel,b.whatsappVerified)}));
   return transaction(()=>({conversations:selected.map(({lead,recipient})=>{
    const old=all('salesConversations').find(c=>!c.deletedAt&&c.leadId===lead.id&&c.channel===b.channel);if(old)return old;
    if(all('salesMessages').some(m=>m.channel===b.channel&&m.recipient===recipient&&['processando','incerto'].includes(m.status)))fail(409,'Confira o envio pendente na conversa excluída antes de iniciar outro atendimento.');
    const c=put('salesConversations',{id:randomUUID(),leadId:lead.id,channel:b.channel,recipient,status:'ativa',version:1,followups:0,createdAt:now(),nextActionAt:now()});
    put('salesTasks',{id:randomUUID(),conversationId:c.id,conversationVersion:1,status:'pendente',reason:'inicio',createdAt:now()});audit(role,'vendas.iniciada',c.id);return c;
   })}));
  }
  const removal=p.match(/^\/api\/sales\/conversations\/([^/]+)(?:\/(restore))?$/);
  if(removal&&((method==='DELETE'&&!removal[2])||(method==='POST'&&removal[2]==='restore'))){admin(role);return transaction(()=>{
   const c=required('salesConversations',removal[1]);
   if(removal[2]==='restore'){
    if(!c.deletedAt)fail(409,'Conversa não está excluída.');
    if(all('salesConversations').some(x=>!x.deletedAt&&x.id!==c.id&&x.leadId===c.leadId&&x.channel===c.channel))fail(409,'Já existe atendimento deste lead no canal.');
    delete c.deletedAt;c.status='pausada';c.nextActionAt=null;c.version++;put('salesConversations',c);audit(role,'vendas.restaurada',c.id);return c;
   }
   if(c.deletedAt)return {deleted:true,id:c.id};
   const tasks=all('salesTasks').filter(t=>t.conversationId===c.id);
   if(tasks.some(t=>t.status==='executando'&&Date.parse(t.leaseUntil)>Date.now())||all('salesCosts').some(x=>x.conversationId===c.id&&x.status==='reservada'&&tasks.some(t=>t.id===x.taskId&&Date.parse(t.leaseUntil)>Date.now()))||all('salesMessages').some(m=>m.conversationId===c.id&&m.status==='processando'))fail(409,'Aguarde a chamada ou confira o envio em andamento antes de excluir.');
   cancel(c);c.deletedAt=now();c.status='pausada';c.nextActionAt=null;c.version++;put('salesConversations',c);audit(role,'vendas.excluida',c.id);return {deleted:true,id:c.id};
  });}
  const takeover=p.match(/^\/api\/sales\/conversations\/([^/]+)\/takeover$/);
  if(method==='POST'&&takeover){admin(role);return transaction(()=>{
   const c=required('salesConversations',takeover[1]);if(c.deletedAt||['ganho','perdido'].includes(c.status))fail(409,'Conversa indisponível.');
   c.control='human';c.status='pausada';c.version++;c.nextActionAt=null;c.takenOverAt=now();c.error=null;cancel(c);put('salesConversations',c);audit(role,'vendas.assumida',c.id);return c;
  });}
  const humanDraft=p.match(/^\/api\/sales\/conversations\/([^/]+)\/human-message$/);
  if(method==='POST'&&humanDraft){admin(role);return transaction(()=>{
   const c=required('salesConversations',humanDraft[1]);humanActive(c);if(b.conversationVersion!==c.version)fail(409,'A conversa mudou; confira o histórico antes de enviar.');
   if(!['responder','propor','fechar'].includes(b.kind))fail(400,'Tipo inválido.');
   if(all('salesMessages').some(m=>m.conversationId===c.id&&['processando','incerto'].includes(m.status)))fail(409,'Confira o envio pendente antes de responder.');
   const body=text(b.body,'mensagem',8000,true),subject=text(b.subject||'Conversa comercial','assunto',200,true);c.version++;cancel(c);c.status='pausada';c.nextActionAt=null;put('salesConversations',c);
   const m={id:randomUUID(),conversationId:c.id,channel:c.channel,recipient:c.recipient,direction:'outbound',kind:b.kind,body,subject,terms:{},templateId:null,conversationVersion:c.version,version:1,status:b.kind==='responder'?'aprovada':'aguardando_aprovacao',author:'admin',createdAt:now()};
   if(m.status==='aprovada')m.approval={version:m.version,conversationVersion:c.version,approvedBy:'admin',approvedAt:now(),humanResponse:true};put('salesMessages',m);audit(role,'vendas.resposta_manual',m.id);return m;
  });}
  const pause=p.match(/^\/api\/sales\/conversations\/([^/]+)\/pause$/);
  const manualDraft=p.match(/^\/api\/sales\/conversations\/([^/]+)\/message$/);
  if(method==='POST'&&manualDraft){admin(role);return transaction(()=>{
   const c=required('salesConversations',manualDraft[1]);if(c.deletedAt)fail(409,'Conversa excluída.');if(!getLead(c.leadId)||getLead(c.leadId).blocked)fail(409,'Lead ausente ou bloqueado.');
   if(!['responder','propor','fechar'].includes(b.kind))fail(400,'Tipo de mensagem inválido.');
   const body=text(b.body,'mensagem',8000,true),subject=text(b.subject||'Conversa comercial','assunto',200,true);
   c.version++;cancel(c);c.status='aguardando_aprovacao';c.nextActionAt=null;put('salesConversations',c);
   const m=put('salesMessages',{id:randomUUID(),conversationId:c.id,channel:c.channel,recipient:c.recipient,direction:'outbound',kind:b.kind,body,subject,terms:{},templateId:null,conversationVersion:c.version,version:1,status:'aguardando_aprovacao',createdAt:now(),author:'admin'});audit(role,'vendas.rascunho_manual',m.id);return m;
  });}
  const costReconcile=p.match(/^\/api\/sales\/costs\/([^/]+)\/reconcile$/);
  if(method==='POST'&&costReconcile){admin(role);return transaction(()=>{
   const cost=required('salesCosts',costReconcile[1]),task=get('salesTasks',cost.taskId);
   if(!['reservada','incerta'].includes(cost.status)||(cost.status==='reservada'&&task?.status==='executando'&&Date.parse(task.leaseUntil)>Date.now()))fail(409,'Custo confirmado ou chamada em andamento.');
   if(typeof b.actualUsd!=='number'||!Number.isFinite(b.actualUsd)||b.actualUsd<0)fail(400,'Custo confirmado inválido.');
   cost.evidence=text(b.evidence,'evidência',2000,true);cost.actualUsd=b.actualUsd;cost.reservedUsd=0;cost.status='confirmada';put('salesCosts',cost);audit(role,'vendas.custo_conferido',cost.id);return cost;
  });}
  if(method==='POST'&&pause){admin(role);const c=required('salesConversations',pause[1]);if(c.deletedAt)fail(409,'Conversa excluída.');return transaction(()=>{c.status='pausada';c.version++;put('salesConversations',c);cancel(c);audit(role,'vendas.pausada',c.id);return c;});}
  const resume=p.match(/^\/api\/sales\/conversations\/([^/]+)\/(resume|close)$/);
  if(method==='POST'&&resume){admin(role);const c=required('salesConversations',resume[1]);if(c.deletedAt)fail(409,'Conversa excluída.');return transaction(()=>{
   if(all('salesMessages').some(m=>m.conversationId===c.id&&['processando','incerto'].includes(m.status)))fail(409,'Confira envio pendente/incerto antes de retomar.');
   if(resume[2]==='close'){if(!['ganho','perdido'].includes(b.outcome))fail(400,'Resultado inválido.');c.evidence=text(b.evidence,'evidência',2000,true);c.status=b.outcome;const l=getLead(c.leadId);if(l)putLead({...l,stage:b.outcome,updatedAt:now()});}
   else{salesRecipient(getLead(c.leadId),c.channel,true);c.control='ai';c.status='ativa';c.error=null;}
   c.version++;cancel(c);put('salesConversations',c);if(resume[2]==='resume')enqueue(c,'retomada');audit(role,'vendas.'+resume[2],c.id);return c;
  });}
  if(method==='POST'&&p==='/api/agent/sales/tasks/claim'){
   agent(role);const cfg=settings();if(!cfg.enabled||!withinSalesHours(cfg))return {task:null};
   return transaction(()=>{
    for(const t of all('salesTasks').filter(t=>t.status==='executando'&&Date.parse(t.leaseUntil)<Date.now())){
     const spent=all('salesCosts').some(x=>x.taskId===t.id&&(x.reservedUsd>0||x.actualUsd>0));t.status=spent?'falhou':'pendente';put('salesTasks',t);
     if(spent){const c=get('salesConversations',t.conversationId);if(c){c.status='pausada';c.error='Tarefa interrompida após chamada paga; confira custos antes de retomar.';put('salesConversations',c);}}
    }
    for(const c of all('salesConversations').filter(c=>c.status==='aguardando_cliente'&&c.nextActionAt&&Date.parse(c.nextActionAt)<=Date.now()&&c.followups<cfg.maxFollowups)){
     if(!all('salesTasks').some(t=>t.conversationId===c.id&&['pendente','executando'].includes(t.status))&&!all('salesMessages').some(m=>m.conversationId===c.id&&['pendente','aprovada','aguardando_aprovacao','processando','incerto'].includes(m.status)))enqueue(c,'acompanhamento');
    }
    for(const t of all('salesTasks').filter(t=>t.status==='pendente')){
     const c=get('salesConversations',t.conversationId);if(!c||c.version!==t.conversationVersion){t.status='cancelada';put('salesTasks',t);continue;}
     try{active(c);}catch{continue;}
     t.status='executando';t.leaseToken=randomUUID();t.leaseUntil=new Date(Date.now()+10*60_000).toISOString();put('salesTasks',t);
     if(presenceWhatsapp&&c.channel==='whatsapp'){try{presenceWhatsapp({recipient:c.recipient,typing:true,settings:cfg});}catch{}}
     return {task:t,context:{lead:getLead(c.leadId),conversation:c,history:all('salesMessages').filter(m=>m.conversationId===c.id),settings:cfg,phrases:get('settings','salesPhrases')||null,task:t}};
    }return {task:null};
   });
  }
  const taskRoute=p.match(/^\/api\/agent\/sales\/tasks\/([^/]+)\/(progress|draft|fail)$/);
  if(method==='POST'&&taskRoute){agent(role);return transaction(()=>{
   const t=b.settle===true?required('salesTasks',taskRoute[1]):lease(taskRoute[1],b),c=required('salesConversations',t.conversationId),cfg=settings();
   if(b.settle===true&&t.leaseToken!==b.leaseToken)fail(409,'Reserva comercial inválida.');
   if(taskRoute[2]==='progress'){
    if(b.settle===true){
     const cost=all('salesCosts').find(x=>x.taskId===t.id&&x.status==='reservada');if(!cost)fail(409,'Nenhuma reserva para confirmar.');
     if(b.costUsd!==null&&(typeof b.costUsd!=='number'||!Number.isFinite(b.costUsd)||b.costUsd<0))fail(400,'Custo inválido.');
     cost.providerId=b.providerId?text(b.providerId,'provedor',200):null;
     if(cost.included){cost.reportedCostUsd=b.costUsd;cost.actualUsd=0;cost.reservedUsd=0;cost.status='incluida';}
     else if(b.costUsd!==null){cost.actualUsd=b.costUsd;cost.reservedUsd=0;cost.status='confirmada';}
     else if(b.costEstimateUsd!==undefined&&b.costEstimateUsd!==null){
      if(cost.service!=='jev'||b.pricingModel!=='jev-1.13.0'||!Number.isSafeInteger(b.inputTokens)||b.inputTokens<0||!Number.isFinite(b.costEstimateUsd)||Math.abs(b.costEstimateUsd-b.inputTokens*.042/1e6)>1e-12)fail(400,'Cálculo do custo Jev inválido.');
      cost.estimatedUsd=b.costEstimateUsd;cost.inputTokens=b.inputTokens;cost.pricingModel=b.pricingModel;cost.pricePerMillion=.042;cost.pricingSource='https://docs.typesafe.ai/models';cost.reservedUsd=0;cost.status='calculada';
     }else cost.status='incerta';
     put('salesCosts',cost);
     if(b.decision){if(!b.decision||typeof b.decision!=='object'||Array.isArray(b.decision)||JSON.stringify(b.decision).length>5000)fail(400,'Decisão inválida.');put('salesDecisions',{id:randomUUID(),conversationId:c.id,taskId:t.id,decision:b.decision,providerId:cost.providerId,at:now()});}
     if(!cost.included&&((b.costUsd??b.costEstimateUsd??0)>cost.limitUsd)){c.status='pausada';c.error='Custo excedeu o teto; operação pausada.';put('salesConversations',c);}
    }else{
     active(c);if(c.version!==t.conversationVersion)fail(409,'Conversa mudou.');
     if(!['jev','hermes'].includes(b.service))fail(400,'Serviço inválido.');
     const included=b.service==='hermes'&&cfg.hermesIncluded;const cap=included?0:cfg[b.service+'MaxCostUsd'];if((!included&&!(cap>0))||b.reserveUsd!==cap)fail(400,'Reserva deve usar o teto configurado.');
     if(all('salesCosts').some(x=>x.taskId===t.id&&(x.status==='reservada'||(x.reservedUsd>0&&x.service===b.service))))fail(409,'Há custo pendente nesta tarefa.');
     const day=salesDay(cfg),period=cfg.budgetPeriod==='month'?day.slice(0,7):day;
     const used=all('salesCosts').filter(x=>!(cfg.hermesIncluded&&x.service==='hermes')).reduce((s,x)=>s+((cfg.budgetPeriod==='month'?x.day?.slice(0,7):x.day)===period?(x.actualUsd||0)+(x.estimatedUsd||0):0)+(x.reservedUsd||0),0);
     if(!included&&used+cap>(cfg.budgetPeriod==='month'?cfg.monthlyBudgetUsd:cfg.dailyBudgetUsd)+1e-9)fail(409,'Orçamento comercial insuficiente.');
     put('salesCosts',{id:randomUUID(),taskId:t.id,conversationId:c.id,service:b.service,included,day:salesDay(cfg),actualUsd:0,reservedUsd:cap,limitUsd:cap,status:'reservada',at:now()});
    }
    t.leaseUntil=new Date(Date.now()+10*60_000).toISOString();put('salesTasks',t);return {ok:true};
   }
   if(taskRoute[2]==='fail'){t.status='falhou';t.error=text(b.error,'erro',1000,true);put('salesTasks',t);if(c.version===t.conversationVersion){c.status='pausada';c.error=t.error;put('salesConversations',c);}if(presenceWhatsapp&&c.channel==='whatsapp'){try{presenceWhatsapp({recipient:c.recipient,typing:false,settings:cfg});}catch{}}return {ok:true};}
   active(c);if(c.version!==t.conversationVersion)fail(409,'Conversa mudou durante a redação.');
   if(!['qualificar','responder','acompanhar','propor','fechar','pausar','humano'].includes(b.kind))fail(400,'Ação inválida.');
   if(t.reason==='acompanhamento'&&['qualificar','responder','acompanhar'].includes(b.kind))b={...b,kind:'acompanhar',templateId:'acompanhamento',terms:{}};
   if(['pausar','humano'].includes(b.kind)){t.status='concluida';c.status='pausada';c.error=b.kind==='humano'?'Hermes solicitou intervenção humana.':text(b.body||'Atendimento pausado.','motivo',1000);put('salesTasks',t);put('salesConversations',c);if(presenceWhatsapp&&c.channel==='whatsapp'){try{presenceWhatsapp({recipient:c.recipient,typing:false,settings:cfg});}catch{}}return {status:'pausada'};}
   const terms=b.terms??{};if(typeof terms!=='object'||!terms||Array.isArray(terms)||JSON.stringify(terms).length>5000)fail(400,'Termos inválidos.');
   const sentTemplates=all('salesMessages').filter(m=>m.conversationId===c.id&&m.direction==='outbound'&&m.templateId).map(m=>m.templateId);
   if(b.templateId&&sentTemplates.includes(b.templateId)&&['qualificar','responder'].includes(b.kind)){
    if(['necessidade','detalhes'].includes(b.templateId))b={...b,templateId:'reuniao'};
    else if(b.templateId==='reuniao')b={...b,templateId:'encaminhar'};
   }
   const approval=requiresApproval({...b,terms});
   const latest=all('salesMessages').filter(m=>m.conversationId===c.id&&m.direction==='inbound').at(-1);
   const m=put('salesMessages',{id:randomUUID(),conversationId:c.id,channel:c.channel,recipient:c.recipient,direction:'outbound',kind:b.kind,templateId:approval?null:b.templateId,body:approval?text(b.body,'mensagem',8000,true):templateMessage(b.templateId,getLead(c.leadId),cfg),subject:approval?text(b.subject||'Proposta comercial','assunto',200,true):'Conversa com '+cfg.company,terms:approval?terms:{},conversationVersion:c.version,version:1,status:approval?'aguardando_aprovacao':'pendente',createdAt:now(),taskId:t.id,inReplyTo:latest?.threadId||null});
   m.isFollowup=t.reason==='acompanhamento';put('salesMessages',m);t.status='concluida';put('salesTasks',t);c.nextActionAt=null;if(approval)c.status='aguardando_aprovacao';put('salesConversations',c);if(presenceWhatsapp&&c.channel==='whatsapp'){try{presenceWhatsapp({recipient:c.recipient,typing:false,settings:cfg});}catch{}}audit(role,'vendas.rascunho',m.id);return m;
  });}
  const presenceRoute=p.match(/^\/api\/(?:agent\/)?sales\/conversations\/([^/]+)\/presence$/);
  if(method==='POST'&&presenceRoute){const c=required('salesConversations',presenceRoute[1]);if(c.channel==='whatsapp'&&presenceWhatsapp){await presenceWhatsapp({recipient:c.recipient,typing:b.typing!==false,settings:settings()});}return {ok:true};}
  const approval=p.match(/^\/api\/sales\/messages\/([^/]+)\/(approve|reject|edit|reconcile)$/);
  if(method==='POST'&&approval){admin(role);return transaction(()=>{
   const m=required('salesMessages',approval[1]),c=required('salesConversations',m.conversationId);
   if(approval[2]==='reconcile'){
    if(!['incerto','processando'].includes(m.status)||!['aceita','falhou','entregue'].includes(b.status))fail(409,'Reconciliação inválida.');
    m.evidence=text(b.evidence,'evidência',2000,true);m.status=b.status;put('salesMessages',m);audit(role,'vendas.reconciliada',m.id);return m;
   }
   if(c.deletedAt)fail(409,'Conversa excluída.');
   if(b.version!==m.version||m.conversationVersion!==c.version||!['aguardando_aprovacao','aprovada','pendente'].includes(m.status))fail(409,'Versão desatualizada ou mensagem indisponível.');
   if(approval[2]==='edit'){m.body=text(b.body,'mensagem',8000,true);m.subject=text(b.subject||m.subject,'assunto',200,true);m.version++;m.templateId=null;m.status='aguardando_aprovacao';delete m.approval;}
   else if(approval[2]==='approve'){m.status='aprovada';m.approval={version:m.version,conversationVersion:c.version,approvedBy:'admin',approvedAt:now()};c.status=c.control==='human'?'pausada':'ativa';put('salesConversations',c);}
   else{m.status='cancelada';c.status='pausada';put('salesConversations',c);}
   put('salesMessages',m);audit(role,'vendas.'+approval[2],m.id);return m;
  });}
  const send=p.match(/^\/api\/(?:agent\/)?sales\/messages\/([^/]+)\/send$/);
  if(method==='POST'&&send){if(!['admin','agent'].includes(role))fail(403,'Não autorizado.');
   let m,c,cfg,mailCfg,human;
   transaction(()=>{
    m=required('salesMessages',send[1]);c=required('salesConversations',m.conversationId);cfg=settings();human=role==='admin'&&m.author==='admin'&&c.control==='human';const l=human?humanActive(c):active(c);
    if(!human&&!withinSalesHours(cfg))fail(409,'Fora do horário comercial configurado.');
    if(m.conversationVersion!==c.version||!['pendente','aprovada'].includes(m.status))fail(409,'Mensagem cancelada, enviada, incerta ou versão desatualizada.');
    if(requiresApproval(m)&&(m.status!=='aprovada'||m.approval?.version!==m.version||m.approval?.conversationVersion!==c.version))fail(409,'Proposta, fechamento ou texto livre exige aprovação.');
    if(!requiresApproval(m)&&m.body!==templateMessage(m.templateId,l,cfg))fail(409,'Template mudou; revise a mensagem.');
    const day=salesDay(cfg),used=all('salesMessages').filter(x=>x.direction==='outbound'&&x.channel===c.channel&&x.sentDay===day&&['processando','incerto','aceita','entregue'].includes(x.status)).length;
    if(cfg.dailyLimit>0&&used>=cfg.dailyLimit)fail(429,'Limite diário comercial atingido.');
    mailCfg=emailSettings();if(c.channel==='email'&&emailQuota&&emailQuota()<=0)fail(429,'Limite diário global de e-mail atingido.');
    m.modo=c.channel==='email'&&mailCfg.testMode?'teste':'producao';m.deliveryRecipient=m.modo==='teste'?mailCfg.testRecipient:m.recipient;
    if(m.modo==='teste'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.deliveryRecipient||''))fail(400,'Configure o destinatário de teste de e-mail.');
    m.status='processando';m.at=now();m.sentDay=day;put('salesMessages',m);
   });
   try{
    const beforeDispatch=()=>{const latest=required('salesConversations',m.conversationId);if(human)humanActive(latest);else active(latest);if(latest.version!==m.conversationVersion||(!human&&!withinSalesHours(settings())))fail(409,'Conversa mudou antes do despacho.');};
    const result=await (m.channel==='email'?sendEmail({...m,from:mailCfg.from,fromName:mailCfg.fromName,replyTo:cfg.replyTo}):sendWhatsapp({...m,recipient:m.deliveryRecipient,settings:cfg,beforeDispatch}));
    if(!result||!result.providerId||!['aceita','entregue'].includes(result.status))throw Error('Provedor não confirmou o envio.');
    m.status=result.status;m.providerId=result.providerId;
   }catch(e){m.status=e.outcome==='failed'||e.status===409?'falhou':'incerto';m.error=String(e.safeMessage||(e.status===409?e.message:'Envio não confirmado. Confira o provedor antes de repetir.')).slice(0,500);}
   m.at=now();put('salesMessages',m);const current=get('salesConversations',c.id);
   if(current&&current.version===m.conversationVersion){
    if(['aceita','entregue'].includes(m.status)&&m.modo==='producao'){current.status=human?'pausada':'aguardando_cliente';if(!human&&(m.isFollowup||m.kind==='acompanhar'))current.followups++;current.nextActionAt=!human&&current.followups<cfg.maxFollowups?new Date(Date.now()+cfg.followupHours*3600000).toISOString():null;const l=getLead(c.leadId);if(l&&!l.blocked&&(['novo','qualificado'].includes(l.stage)||m.kind==='propor'))putLead({...l,stage:m.kind==='propor'?'proposta':'contatado',updatedAt:now()});}
    else{current.status='pausada';current.error=m.modo==='teste'?'Teste enviado; atendimento de produção não iniciado.':m.error||'Envio interrompido.';}
    put('salesConversations',current);
   }audit(role,'vendas.envio_'+m.status,m.id);return m;
  }
  const manual=p.match(/^\/api\/sales\/conversations\/([^/]+)\/inbound$/);
  if(method==='POST'&&(p==='/api/agent/sales/inbound'||manual)){
   if(manual){admin(role);const c=required('salesConversations',manual[1]);if(c.deletedAt)fail(409,'Conversa excluída.');b={...b,conversationId:c.id,channel:c.channel,account:'manual',providerId:randomUUID(),sender:c.recipient,receivedAt:now()};}else agent(role);
   if(!['email','whatsapp'].includes(b.channel))fail(400,'Canal inválido.');
   const id=text(b.providerId,'id do provedor',200,true),account=text(b.account,'conta',100,true),sender=text(b.sender,'remetente',254,true),body=text(b.body,'mensagem',10000,true);
   const receivedAt=new Date(b.receivedAt);if(!Number.isFinite(receivedAt.getTime())||receivedAt.getTime()>Date.now()+300000)fail(400,'Data de recebimento inválida.');
   return transaction(()=>{
    if(all('salesMessages').some(m=>m.direction==='inbound'&&m.channel===b.channel&&m.account===account&&m.providerId===id))return {imported:false};
    if(b.fromMe===true)return {imported:false};
    const mailbox=settings().replyTo||emailSettings().from;
    const wrongInbox=!manual&&b.channel==='email'&&(!b.recipient||b.recipient.toLowerCase()!==mailbox.toLowerCase());
    const matches=wrongInbox?[]:all('salesConversations').filter(c=>!c.deletedAt&&c.channel===b.channel&&c.recipient.toLowerCase()===sender.toLowerCase()&&(!b.conversationId||c.id===b.conversationId));
    const c=matches.length===1?matches[0]:null;
    let threadId=null;if(b.threadId){threadId=text(b.threadId,'thread',500,true);if(/[\r\n]/.test(threadId))fail(400,'Thread inválida.');}
    put('salesMessages',{id:randomUUID(),conversationId:c?.id||null,direction:'inbound',channel:b.channel,account,providerId:id,sender,body,threadId,receivedAt:receivedAt.toISOString(),status:c?'recebida':'revisao',createdAt:now()});
    if(!c)return {imported:true,review:true};
    if(receivedAt.getTime()<Date.parse(c.createdAt))return {imported:true,historical:true};
    c.version++;c.nextActionAt=null;cancel(c);
    const stop=/\b(stop|cancelar|remova|remover)\b|n[aã]o.{0,25}(contat|mensage|interess)|pare de|sem interesse|retire meu/i.test(body);
    const blocked=getLead(c.leadId)?.blocked;
    if(stop){const l=getLead(c.leadId);if(l)putLead({...l,blocked:true,updatedAt:now()});c.status='pausada';c.error='Pedido de não contato recebido.';}
    else if(c.control!=='human'&&!blocked&&!['ganho','perdido'].includes(c.status)){c.status='ativa';c.error=null;enqueue(c,'resposta');}
    put('salesConversations',c);audit(role,'vendas.resposta',c.id);return {imported:true,conversationId:c.id};
   });
  }
  return undefined;
 }
 return {state,dispatch,store};
}
