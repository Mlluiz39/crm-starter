import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
const dir=mkdtempSync(path.join(tmpdir(),'crm-sales-'));
const admin='sales-admin-test-token-123456789',agent='sales-agent-test-token-123456789';
let child,base,lead;
before(async()=>{
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 base=`http://127.0.0.1:${port}`;
 child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',CRM_DATA_DIR:dir,HERMES_ENV_FILE:path.join(dir,'empty.env'),CRM_ADMIN_TOKEN:admin,CRM_AGENT_TOKEN:agent},stdio:['ignore','pipe','pipe']});
 await new Promise((r,j)=>{child.stdout.once('data',r);child.once('error',j);child.once('exit',c=>j(Error('exit '+c)));});
 lead=(await req('/leads','POST',{name:'Empresa Real',email:'empresa@example.com',phone:'+5511999999999'},agent)).data;
});
after(async()=>{if(child?.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});rmSync(dir,{recursive:true,force:true});});
async function req(p,method='GET',b,token=admin){const r=await fetch(base+'/api'+p,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:b===undefined?undefined:JSON.stringify(b)});return {status:r.status,data:await r.json()};}
test('vendas começa pausado e configuração é admin-only',async()=>{
 const s=await req('/state');assert.equal(s.data.sales?.settings.enabled,false);
 assert.equal((await req('/sales/settings','PATCH',{enabled:true},agent)).status,403);
 assert.equal((await req('/sales/settings','PATCH',{dailyBudgetUsd:-1})).status,400);
});
test('ingresso explícito preserva destinatário e evita duplicatas',async()=>{
 const b={leadIds:[lead.id],channel:'email'};
 const first=await req('/sales/conversations','POST',b);assert.equal(first.status,200);
 assert.equal(first.data.conversations[0].recipient,lead.email);
 assert.equal((await req('/sales/conversations','POST',b)).data.conversations[0].id,first.data.conversations[0].id);
 assert.equal((await req('/sales/conversations','POST',b,agent)).status,403);
});
test('WhatsApp exige confirmação explícita do canal e bloqueio impede ingresso',async()=>{
 assert.equal((await req('/sales/conversations','POST',{leadIds:[lead.id],channel:'whatsapp'})).status,400);
 assert.equal((await req('/sales/conversations','POST',{leadIds:[lead.id],channel:'whatsapp',whatsappVerified:true})).status,200);
 await req('/leads/'+lead.id,'PATCH',{blocked:true});
 assert.equal((await req('/sales/conversations','POST',{leadIds:[lead.id],channel:'email'})).status,409);
 await req('/leads/'+lead.id,'PATCH',{blocked:false});
});
test('agente vê somente contexto comercial e módulo pausado não libera tarefa',async()=>{
 const s=await req('/agent/sales/state','GET',undefined,agent);
 assert.equal(s.status,200);assert.equal(s.data.integrations,undefined);assert.equal(s.data.settings.enabled,false);
 assert.equal((await req('/agent/sales/tasks/claim','POST',{},agent)).data.task,null);
});

test('lead manual entra no atendimento sem mudar origem e mantém validações',async()=>{
 const created=await req('/leads','POST',{name:'Lead manual de teste',email:'manual@example.com',phone:'+5511988887777'});
 assert.equal(created.status,200);const manual=created.data;assert.equal(manual.origin,'manual');
 const email=await req('/sales/conversations','POST',{leadIds:[manual.id],channel:'email'});
 assert.equal(email.status,200);assert.equal(email.data.conversations[0].recipient,manual.email);
 assert.equal((await req('/sales/conversations','POST',{leadIds:[manual.id],channel:'whatsapp'})).status,400);
 assert.equal((await req('/sales/conversations','POST',{leadIds:[manual.id],channel:'whatsapp',whatsappVerified:true})).status,200);
 assert.equal((await req('/state')).data.leads.find(l=>l.id===manual.id).origin,'manual');
 await req('/leads/'+manual.id,'PATCH',{blocked:true});
 assert.equal((await req('/sales/conversations','POST',{leadIds:[manual.id],channel:'email'})).status,409);
 const noEmail=(await req('/leads','POST',{name:'Manual sem email'})).data;
 assert.equal((await req('/sales/conversations','POST',{leadIds:[noEmail.id],channel:'email'})).status,400);
});
