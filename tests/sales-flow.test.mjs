import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createSalesApi} from '../scripts/sales-api.mjs';
import * as policy from '../scripts/sales-policy.mjs';
function fixture(send){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE records(kind TEXT,id TEXT,payload TEXT,PRIMARY KEY(kind,id))');
 const lead={id:'l',name:'Empresa',email:'real@example.com',phone:'+5511999999999',origin:'hermes'};
 let calls=0;
 const api=createSalesApi({db,getLead:id=>id==='l'?lead:null,putLead:v=>Object.assign(lead,v),audit:()=>{},emailSettings:()=>({testMode:false,dailyLimit:20,from:'sales@example.com'}),emailQuota:()=>20,sendEmail:async m=>{calls++;return send?send(m):{providerId:'p'+calls,status:'aceita'};},sendWhatsapp:async()=>({providerId:'w',status:'aceita'})});
 const req=(p,b={},role='agent',method='POST')=>api.dispatch(method,'/api/'+p,b,role);
 const ready=async()=>{await req('sales/settings',{enabled:true,company:'Vendas',offers:'Sites',emailEnabled:true,replyTo:'sales@example.com',dailyBudgetUsd:1,jevMaxCostUsd:.05,hermesMaxCostUsd:.05,startHour:0,endHour:24},'admin','PATCH');return (await req('sales/conversations',{leadIds:['l'],channel:'email'},'admin')).conversations[0];};
 return {api,req,ready,lead,calls:()=>calls,db};
}
async function draft(f,kind='propor',extra={}){const {task}=await f.req('agent/sales/tasks/claim');assert.ok(task);return f.req(`agent/sales/tasks/${task.id}/draft`,{leaseToken:task.leaseToken,kind,body:'Proposta do serviço',subject:'Proposta',terms:{price:900,service:'Site'},...extra});}
test('texto livre e termos exigem aprovação; só templates do servidor são automáticos',()=>{
 assert.equal(typeof policy.requiresApproval,'function');
 assert.equal(policy.requiresApproval({kind:'responder',body:'R$ 900'}),true);
 assert.equal(policy.requiresApproval({kind:'propor',templateId:'inicio'}),true);
 assert.equal(policy.requiresApproval({kind:'qualificar',templateId:'inicio',terms:{}}),false);
});
test('proposta não pode ser aprovada nem enviada pelo agente antes da aprovação',async()=>{
 const f=fixture();await f.ready();const m=await draft(f);
 assert.equal(m.status,'aguardando_aprovacao');
 await assert.rejects(f.req('sales/messages/'+m.id+'/approve',{version:m.version}),{status:403});
 await assert.rejects(f.req('agent/sales/messages/'+m.id+'/send'),{status:409});assert.equal(f.calls(),0);
 await f.req('sales/messages/'+m.id+'/approve',{version:m.version},'admin');
 assert.equal((await f.req('agent/sales/messages/'+m.id+'/send')).status,'aceita');assert.equal(f.calls(),1);f.db.close();
});
test('nova resposta invalida a aprovação e cancela acompanhamento',async()=>{
 const f=fixture();const c=await f.ready();const m=await draft(f);await f.req('sales/messages/'+m.id+'/approve',{version:m.version},'admin');
 await f.req('agent/sales/inbound',{channel:'email',account:'email',providerId:'in-1',sender:c.recipient,recipient:'sales@example.com',body:'Quero outra condição',receivedAt:new Date().toISOString(),conversationId:c.id});
 await assert.rejects(f.req('agent/sales/messages/'+m.id+'/send'),{status:409});assert.equal(f.calls(),0);
 assert.equal(f.api.state().conversations[0].version,2);f.db.close();
});
test('inbound repetido não duplica; remetente desconhecido não dispara conversa',async()=>{
 const f=fixture();const c=await f.ready();const e={channel:'email',account:'email',providerId:'in-1',sender:c.recipient,recipient:'sales@example.com',body:'Olá',receivedAt:new Date().toISOString(),conversationId:c.id};
 assert.equal((await f.req('agent/sales/inbound',e)).imported,true);
 assert.equal((await f.req('agent/sales/inbound',e)).imported,false);
 const unknown=await f.req('agent/sales/inbound',{...e,providerId:'in-2',sender:'unknown@example.com'});assert.equal(unknown.review,true);
 assert.equal(f.api.state().conversations.length,1);f.db.close();
});
test('modelo não consegue substituir texto do template automático',async()=>{
 const f=fixture();await f.ready();const m=await draft(f,'qualificar',{templateId:'inicio',body:'Site por R$ 900, contrato fechado',terms:{}});
 assert.equal(m.status,'pendente');assert.ok(!m.body.includes('900'));assert.match(m.body,/Empresa/);f.db.close();
});
test('dois envios concorrentes reservam um único despacho',async()=>{
 let release;const waiting=new Promise(r=>release=r);const f=fixture(async()=>{await waiting;return {providerId:'p',status:'aceita'};});await f.ready();const m=await draft(f,'qualificar',{templateId:'inicio',terms:{}});
 const first=f.req('agent/sales/messages/'+m.id+'/send');await new Promise(r=>setImmediate(r));
 await assert.rejects(f.req('agent/sales/messages/'+m.id+'/send'),{status:409});release();await first;assert.equal(f.calls(),1);f.db.close();
});
test('timeout conserva resultado incerto e bloqueia reenvio',async()=>{
 const f=fixture(async()=>{throw Error('timeout');});await f.ready();const m=await draft(f,'qualificar',{templateId:'inicio',terms:{}});
 assert.equal((await f.req('agent/sales/messages/'+m.id+'/send')).status,'incerto');
 await assert.rejects(f.req('agent/sales/messages/'+m.id+'/send'),{status:409});assert.equal(f.calls(),1);f.db.close();
});
test('pausa e bloqueio são revalidados antes do envio',async()=>{
 const f=fixture();const c=await f.ready();const m=await draft(f,'qualificar',{templateId:'inicio',terms:{}});f.lead.blocked=true;
 await assert.rejects(f.req('agent/sales/messages/'+m.id+'/send'),{status:409});f.lead.blocked=false;
 await f.req('sales/conversations/'+c.id+'/pause',{},'admin');await assert.rejects(f.req('agent/sales/messages/'+m.id+'/send'),{status:409});assert.equal(f.calls(),0);f.db.close();
});
test('reserva de orçamento é persistente e não vira gasto confirmado',async()=>{
 const f=fixture();await f.ready();const {task}=await f.req('agent/sales/tasks/claim');
 await f.req(`agent/sales/tasks/${task.id}/progress`,{leaseToken:task.leaseToken,reserveUsd:.05,service:'jev'});
 let s=f.api.state();assert.equal(s.costs[0].reservedUsd,.05);assert.equal(s.costs[0].actualUsd,0);
 await assert.rejects(f.req(`agent/sales/tasks/${task.id}/progress`,{leaseToken:'wrong',reserveUsd:.05,service:'jev'}),{status:409});
 await f.req(`agent/sales/tasks/${task.id}/progress`,{leaseToken:task.leaseToken,settle:true,costUsd:.02,providerId:'call-1',decision:{action:'propor'}});
 s=f.api.state();assert.equal(s.costs[0].reservedUsd,0);assert.equal(s.costs[0].actualUsd,.02);assert.equal(s.decisions.length,1);f.db.close();
});
test('pedido de não contato bloqueia o lead e encerra sequências',async()=>{
 const f=fixture();const c=await f.ready();await f.req('agent/sales/inbound',{channel:'email',account:'email',providerId:'stop',sender:c.recipient,recipient:'sales@example.com',body:'Não me contate mais',receivedAt:new Date().toISOString(),conversationId:c.id});
 assert.equal(f.lead.blocked,true);assert.equal(f.api.state().conversations[0].status,'pausada');f.db.close();
});
test('edição invalida aprovação; fechamento exige aprovação e não marca ganho automaticamente',async()=>{
 const f=fixture();await f.ready();const m=await draft(f,'fechar');await f.req('sales/messages/'+m.id+'/approve',{version:1},'admin');
 const edited=await f.req('sales/messages/'+m.id+'/edit',{version:1,body:'Condições revisadas'},'admin');assert.equal(edited.version,2);assert.equal(edited.status,'aguardando_aprovacao');
 await assert.rejects(f.req('sales/messages/'+m.id+'/approve',{version:1},'admin'),{status:409});
 await f.req('sales/messages/'+m.id+'/approve',{version:2},'admin');await f.req('agent/sales/messages/'+m.id+'/send');assert.notEqual(f.lead.stage,'ganho');f.db.close();
});
test('recebimento em outra caixa não dispara resposta automática',async()=>{
 const f=fixture();const c=await f.ready();await f.req('agent/sales/inbound',{channel:'email',account:'resend',providerId:'foreign',sender:c.recipient,recipient:'another@example.com',body:'Mensagem',receivedAt:new Date().toISOString()});
 assert.equal(f.api.state().conversations[0].version,1);f.db.close();
});
test('cursor e heartbeat persistem no CRM sem expor segredos',async()=>{
 const f=fixture();await f.req('agent/sales/cursors/whatsapp-crm',{rowid:20,fingerprint:'1:2'});
 assert.equal((await f.req('agent/sales/cursors/whatsapp-crm',{},'agent','GET')).rowid,20);
 await assert.rejects(f.req('agent/sales/cursors/whatsapp-crm',{rowid:10,fingerprint:'1:2'}),{status:409});
 await f.req('agent/sales/heartbeat',{status:'ativo',error:''});assert.equal(f.api.state().worker.status,'ativo');f.db.close();
});
test('custo confirmado depois de resposta concorrente continua registrado',async()=>{
 const f=fixture();const c=await f.ready();const {task}=await f.req('agent/sales/tasks/claim');
 await f.req(`agent/sales/tasks/${task.id}/progress`,{leaseToken:task.leaseToken,reserveUsd:.05,service:'jev'});
 await f.req('agent/sales/inbound',{channel:'email',account:'email',providerId:'new',sender:c.recipient,recipient:'sales@example.com',body:'Mudei de ideia',receivedAt:new Date().toISOString()});
 await f.req(`agent/sales/tasks/${task.id}/progress`,{leaseToken:task.leaseToken,settle:true,costUsd:.02});
 assert.equal(f.api.state().costs[0].actualUsd,.02);
 await assert.rejects(f.req(`agent/sales/tasks/${task.id}/draft`,{leaseToken:task.leaseToken,kind:'propor',body:'Antiga',terms:{}}),{status:409});f.db.close();
});
test('mensagem manual permanece para aprovação e não permite enviar diretamente',async()=>{
 const f=fixture();const c=await f.ready();const m=await f.req('sales/conversations/'+c.id+'/message',{kind:'propor',body:'Site por R$ 900',subject:'Proposta'},'admin');
 assert.equal(m.status,'aguardando_aprovacao');await assert.rejects(f.req('agent/sales/messages/'+m.id+'/send'),{status:409});assert.equal(f.calls(),0);f.db.close();
});
test('reconciliação de custo incerto exige evidência e admin',async()=>{
 const f=fixture();await f.ready();const {task}=await f.req('agent/sales/tasks/claim');await f.req(`agent/sales/tasks/${task.id}/progress`,{leaseToken:task.leaseToken,reserveUsd:.05,service:'jev'});await f.req(`agent/sales/tasks/${task.id}/progress`,{leaseToken:task.leaseToken,settle:true,costUsd:null});
 const cost=f.api.state().costs[0];await assert.rejects(f.req('sales/costs/'+cost.id+'/reconcile',{actualUsd:.01,evidence:'Extrato'}),{status:403});
 await f.req('sales/costs/'+cost.id+'/reconcile',{actualUsd:.01,evidence:'Extrato de teste'},'admin');assert.equal(f.api.state().costs[0].reservedUsd,0);f.db.close();
});
test('acompanhamento é contabilizado mesmo se modelo o classificar como qualificação',async()=>{
 const f=fixture();const c=await f.ready();const m=await draft(f,'qualificar',{templateId:'inicio',terms:{}});await f.req('agent/sales/messages/'+m.id+'/send');
 const stored=f.api.store.get('salesConversations',c.id);stored.nextActionAt=new Date(Date.now()-1000).toISOString();f.api.store.put('salesConversations',stored);
 const follow=await draft(f,'qualificar',{templateId:'inicio',terms:{}});assert.equal(follow.kind,'acompanhar');assert.equal(follow.templateId,'acompanhamento');await f.req('agent/sales/messages/'+follow.id+'/send');assert.equal(f.api.state().conversations[0].followups,1);f.db.close();
});
test('outbox em processamento conserva bloqueio após recriar API',async()=>{
 const f=fixture();await f.ready();const m=await draft(f,'qualificar',{templateId:'inicio',terms:{}});m.status='processando';f.api.store.put('salesMessages',m);
 let sends=0;const restarted=createSalesApi({db:f.db,getLead:()=>f.lead,putLead:()=>{},audit:()=>{},emailSettings:()=>({testMode:false}),sendEmail:async()=>{sends++;return {providerId:'p',status:'aceita'};}});
 await assert.rejects(restarted.dispatch('POST','/api/agent/sales/messages/'+m.id+'/send',{},'agent'),{status:409});assert.equal(sends,0);f.db.close();
});
test('configuração comercial não permite iniciar e-mail sem caixa de resposta',async()=>{
 const f=fixture();await assert.rejects(f.req('sales/settings',{enabled:true,offers:'Sites',emailEnabled:true,dailyBudgetUsd:1,jevMaxCostUsd:.05,hermesMaxCostUsd:.05},'admin','PATCH'),{status:400});f.db.close();
});
test('reserva incerta de Jev permite Hermes no saldo, sem repetir nem exceder orçamento',async()=>{
 const f=fixture();await f.ready();await f.req('sales/settings',{dailyBudgetUsd:.1},'admin','PATCH');const {task}=await f.req('agent/sales/tasks/claim');const route=`agent/sales/tasks/${task.id}/progress`,leaseToken=task.leaseToken;
 await f.req(route,{leaseToken,service:'jev',reserveUsd:.05});
 await assert.rejects(f.req(route,{leaseToken,service:'hermes',reserveUsd:.05}),{status:409});
 await f.req(route,{leaseToken,settle:true,costUsd:null});
 await assert.rejects(f.req(route,{leaseToken,service:'jev',reserveUsd:.05}),{status:409});
 await f.req('sales/settings',{dailyBudgetUsd:.09},'admin','PATCH');
 await assert.rejects(f.req(route,{leaseToken,service:'hermes',reserveUsd:.05}),{status:409});
 await f.req('sales/settings',{dailyBudgetUsd:.1},'admin','PATCH');
 await f.req(route,{leaseToken,service:'hermes',reserveUsd:.05});
 assert.equal(f.api.state().costs.reduce((s,c)=>s+c.reservedUsd,0),.1);f.db.close();
});
test('exclusão é admin-only, cancela atendimento e preserva histórico e custos',async()=>{
 const f=fixture();const c=await f.ready();const {task}=await f.req('agent/sales/tasks/claim');
 await f.req(`agent/sales/tasks/${task.id}/progress`,{leaseToken:task.leaseToken,service:'jev',reserveUsd:.05});await f.req(`agent/sales/tasks/${task.id}/progress`,{leaseToken:task.leaseToken,settle:true,costUsd:null});
 const m=await f.req(`agent/sales/tasks/${task.id}/draft`,{leaseToken:task.leaseToken,kind:'propor',body:'Proposta',terms:{price:100}});
 await assert.rejects(f.req('sales/conversations/'+c.id,{},'agent','DELETE'),{status:403});
 assert.equal((await f.req('sales/conversations/'+c.id,{},'admin','DELETE')).deleted,true);
 const s=f.api.state();assert.equal(s.conversations.length,0);assert.equal(s.deletedConversations.length,1);assert.equal(s.approvals.length,0);assert.equal(s.messages.find(x=>x.id===m.id).status,'cancelada');assert.equal(s.costs[0].reservedUsd,.05);assert.equal(f.lead.name,'Empresa');
 await assert.rejects(f.req('sales/conversations/'+c.id+'/resume',{},'admin'),{status:409});
 const restored=await f.req('sales/conversations/'+c.id+'/restore',{},'admin');assert.equal(restored.status,'pausada');assert.equal(f.api.state().conversations.length,1);assert.equal((await f.req('agent/sales/tasks/claim')).task,null);f.db.close();
});
test('exclusão bloqueia tarefa paga em andamento e despacho concorrente',async()=>{
 const f=fixture();const c=await f.ready();const {task}=await f.req('agent/sales/tasks/claim');
 await assert.rejects(f.req('sales/conversations/'+c.id,{},'admin','DELETE'),{status:409});f.db.close();
 let done,entered;const gate=new Promise(r=>entered=r),g=fixture(async()=>{entered();return new Promise(r=>done=r);});const conv=await g.ready();const m=await draft(g,'qualificar',{templateId:'inicio',terms:{}});const sending=g.req('agent/sales/messages/'+m.id+'/send');await gate;
 await assert.rejects(g.req('sales/conversations/'+conv.id,{},'admin','DELETE'),{status:409});done({providerId:'confirmed',status:'aceita'});await sending;g.db.close();
});
test('resposta não reabre conversa excluída e restauração não duplica canal',async()=>{
 const f=fixture();const c=await f.ready();await f.req('sales/conversations/'+c.id,{},'admin','DELETE');
 const inbound=await f.req('agent/sales/inbound',{channel:'email',account:'test',providerId:'incoming',sender:f.lead.email,recipient:'sales@example.com',body:'olá',receivedAt:new Date().toISOString()});assert.equal(inbound.review,true);assert.equal(f.api.state().conversations.length,0);assert.equal((await f.req('agent/sales/tasks/claim')).task,null);
 const newer=(await f.req('sales/conversations',{leadIds:[f.lead.id],channel:'email'},'admin')).conversations[0];assert.notEqual(newer.id,c.id);
 await assert.rejects(f.req('sales/conversations/'+c.id+'/restore',{},'admin'),{status:409});f.db.close();
});
test('apagar envio incerto conserva reserva e impede recriar antes de conferência',async()=>{
 const f=fixture(async()=>{throw Error('timeout');});const c=await f.ready();const m=await draft(f,'qualificar',{templateId:'inicio',terms:{}});await f.req('agent/sales/messages/'+m.id+'/send');await f.req('sales/conversations/'+c.id,{},'admin','DELETE');
 assert.equal(f.api.state().messages.find(x=>x.id===m.id).status,'incerto');
 await assert.rejects(f.req('sales/conversations',{leadIds:[f.lead.id],channel:'email'},'admin'),{status:409});
 await f.req('sales/messages/'+m.id+'/reconcile',{status:'falhou',evidence:'Falha confirmada no provedor'},'admin');
 assert.ok((await f.req('sales/conversations',{leadIds:[f.lead.id],channel:'email'},'admin')).conversations[0].id!==c.id);f.db.close();
});
test('Hermes incluído e orçamento mensal Jev dispensam teto Hermes e permitem canal sem limite local',async()=>{
 const f=fixture();await f.req('sales/settings',{enabled:true,offers:'Sites',whatsappEnabled:true,hermesIncluded:true,hermesMaxCostUsd:0,budgetPeriod:'month',monthlyBudgetUsd:3,jevMaxCostUsd:.01,dailyLimit:0,startHour:0,endHour:24},'admin','PATCH');
 const c=(await f.req('sales/conversations',{leadIds:['l'],channel:'whatsapp',whatsappVerified:true},'admin')).conversations[0];const {task}=await f.req('agent/sales/tasks/claim');const route=`agent/sales/tasks/${task.id}/progress`,leaseToken=task.leaseToken;
 await f.req(route,{leaseToken,service:'hermes',reserveUsd:0});await f.req(route,{leaseToken,settle:true,costUsd:null});assert.equal(f.api.state().costs[0].status,'incluida');assert.equal(f.api.state().costs[0].reservedUsd,0);
 const m=await f.req(`agent/sales/tasks/${task.id}/draft`,{leaseToken,kind:'qualificar',templateId:'inicio',body:'Olá',terms:{}});assert.equal((await f.req('agent/sales/messages/'+m.id+'/send')).status,'aceita');f.db.close();
});
test('orçamento mensal conta dias do mês, estimativas e reservas; exclui Hermes incluído',async()=>{
 const f=fixture();await f.ready();await f.req('sales/settings',{budgetPeriod:'month',monthlyBudgetUsd:3,hermesIncluded:true},'admin','PATCH');const {task}=await f.req('agent/sales/tasks/claim');const today=policy.salesDay(f.api.state().settings),month=today.slice(0,7);
 for(const cost of [{id:'past',service:'jev',day:month+'-01',actualUsd:2.98,reservedUsd:0},{id:'pending',service:'jev',day:'2020-01-01',actualUsd:0,reservedUsd:.01},{id:'estimate',service:'jev',day:today,actualUsd:0,estimatedUsd:.01,reservedUsd:0},{id:'included',service:'hermes',day:today,actualUsd:0,reservedUsd:2.75}])f.db.prepare('INSERT INTO records VALUES(?,?,?)').run('salesCosts',cost.id,JSON.stringify(cost));
 await assert.rejects(f.req(`agent/sales/tasks/${task.id}/progress`,{leaseToken:task.leaseToken,service:'jev',reserveUsd:.05}),{status:409});
 await f.req('sales/settings',{monthlyBudgetUsd:3.1},'admin','PATCH');await f.req(`agent/sales/tasks/${task.id}/progress`,{leaseToken:task.leaseToken,service:'jev',reserveUsd:.05});f.db.close();
});
test('custo por tarifa pública é registrado como calculado, com tokens e sem reserva pendente',async()=>{
 const f=fixture();await f.ready();const {task}=await f.req('agent/sales/tasks/claim'),route=`agent/sales/tasks/${task.id}/progress`,leaseToken=task.leaseToken;
 await f.req(route,{leaseToken,service:'jev',reserveUsd:.05});await f.req(route,{leaseToken,settle:true,costUsd:null,costEstimateUsd:.000042,inputTokens:1000,pricingModel:'jev-1.13.0'});const cost=f.api.state().costs[0];assert.equal(cost.status,'calculada');assert.equal(cost.estimatedUsd,.000042);assert.equal(cost.actualUsd,0);assert.equal(cost.reservedUsd,0);assert.equal(cost.inputTokens,1000);f.db.close();
});
test('assumir conversa cancela IA e respostas recebidas ficam no histórico sem nova tarefa',async()=>{
 const f=fixture();const c=await f.ready();const {task}=await f.req('agent/sales/tasks/claim');await assert.rejects(f.req('sales/conversations/'+c.id+'/takeover',{},'agent'),{status:403});
 const human=await f.req('sales/conversations/'+c.id+'/takeover',{},'admin');assert.equal(human.control,'human');assert.equal(human.status,'pausada');
 await assert.rejects(f.req(`agent/sales/tasks/${task.id}/draft`,{leaseToken:task.leaseToken,kind:'qualificar',body:'Olá',templateId:'inicio',terms:{}}),{status:409});
 await f.req('agent/sales/inbound',{channel:'email',account:'test',providerId:'human-reply',sender:f.lead.email,recipient:'sales@example.com',body:'Quero saber mais',receivedAt:new Date().toISOString()});assert.equal((await f.req('agent/sales/tasks/claim')).task,null);assert.equal(f.api.state().messages.at(-1).body,'Quero saber mais');assert.equal(f.api.state().conversations[0].control,'human');f.db.close();
});
test('operador envia resposta com IA pausada; agente não pode enviar nem reassumir',async()=>{
 const f=fixture();const c=await f.ready();const human=await f.req('sales/conversations/'+c.id+'/takeover',{},'admin');await f.req('sales/settings',{enabled:false},'admin','PATCH');
 const body={body:'Olá, aqui é o Marcelo.',kind:'responder',conversationVersion:human.version};
 await assert.rejects(f.req('sales/conversations/'+c.id+'/human-message',body,'agent'),{status:403});
 const m=await f.req('sales/conversations/'+c.id+'/human-message',body,'admin');assert.equal(m.status,'aprovada');assert.equal(m.author,'admin');
 await assert.rejects(f.req('agent/sales/messages/'+m.id+'/send'),{status:409});assert.equal((await f.req('sales/messages/'+m.id+'/send',{},'admin')).status,'aceita');
 assert.equal(f.api.state().conversations[0].control,'human');assert.equal(f.api.state().conversations[0].nextActionAt,null);f.db.close();
});
test('proposta humana exige revisão e devolver à IA exige ação explícita',async()=>{
 const f=fixture();const c=await f.ready();const h=await f.req('sales/conversations/'+c.id+'/takeover',{},'admin');const m=await f.req('sales/conversations/'+c.id+'/human-message',{body:'Proposta',kind:'propor',conversationVersion:h.version},'admin');assert.equal(m.status,'aguardando_aprovacao');await assert.rejects(f.req('sales/messages/'+m.id+'/send',{},'admin'),{status:409});
 await f.req('sales/messages/'+m.id+'/approve',{version:m.version},'admin');assert.equal((await f.req('sales/messages/'+m.id+'/send',{},'admin')).status,'aceita');assert.equal((await f.req('agent/sales/tasks/claim')).task,null);
 const resumed=await f.req('sales/conversations/'+c.id+'/resume',{},'admin');assert.equal(resumed.control,'ai');assert.ok((await f.req('agent/sales/tasks/claim')).task);f.db.close();
});
test('resposta manual exige controle humano e versão atual; destino bloqueado continua protegido',async()=>{
 const f=fixture();const c=await f.ready();await assert.rejects(f.req('sales/conversations/'+c.id+'/human-message',{body:'Olá',kind:'responder',conversationVersion:c.version},'admin'),{status:409});const h=await f.req('sales/conversations/'+c.id+'/takeover',{},'admin');
 await assert.rejects(f.req('sales/conversations/'+c.id+'/human-message',{body:'Olá',kind:'responder',conversationVersion:c.version},'admin'),{status:409});f.lead.blocked=true;await assert.rejects(f.req('sales/conversations/'+c.id+'/human-message',{body:'Olá',kind:'responder',conversationVersion:h.version},'admin'),{status:409});f.db.close();
});
