import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=mkdtempSync(path.join(tmpdir(),'crm-test-'));
// Isola o arquivo de ambiente: sem isto o teste leria o .env real do usuário.
const envFile=path.join(dir,'hermes.env');
const admin='admin-test-token-123456789012345',agent='agent-test-token-123456789012345';
let child,base;
// The test server is configured with a fixed test-only port via a free socket.
import net from 'node:net';
let port;
before(async()=>{port=await new Promise(r=>{const s=net.createServer();s.on('error',e=>{throw e;});s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});base='http://127.0.0.1:'+port;child=spawn(process.execPath,['server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),CRM_DATA_DIR:dir,HERMES_ENV_FILE:envFile,CRM_ADMIN_TOKEN:admin,CRM_AGENT_TOKEN:agent},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',c=>reject(Error('exit '+c)));});});
after(async()=>{await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM');});rmSync(dir,{recursive:true,force:true});});
async function req(p,method='GET',body,token=admin){const r=await fetch(base+'/api'+p,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
let lead,campaign;
test('authentication, role separation and input validation',async()=>{
 assert.equal((await req('/state','GET',undefined,'wrong')).status,401);
 assert.equal((await req('/state','GET',undefined,agent)).status,403);
 assert.equal((await req('/leads','POST',{name:'X',website:'javascript:alert(1)'})).status,400);
 assert.equal((await req('/leads','POST',{name:'X',stage:'ganho'},agent)).status,403);
 assert.equal((await req('/campaigns','POST',{leadIds:7})).status,400);
});
test('lead persistence, duplicate prevention and block protection',async()=>{
 let r=await req('/leads','POST',{name:'Empresa de teste',email:'contato@example.com',city:'São Paulo'});assert.equal(r.status,200);lead=r.data;
 assert.equal((await req('/leads','POST',{name:'Outro nome',email:lead.email})).status,409);
 assert.equal((await req('/leads/'+lead.id,'PATCH',{blocked:false},agent)).status,403);
 const s=await req('/state');assert.equal(s.data.leads.length,1);
});
test('approval is admin-only, versioned, invalidated on edit; sending is gated',async()=>{
 let r=await req('/campaigns','POST',{name:'Piloto',subject:'Uma ideia',body:'Olá, teste.',leadIds:[lead.id]},agent);assert.equal(r.status,200);campaign=r.data;
 assert.equal((await req('/campaigns/'+campaign.id+'/submit','POST',{},agent)).status,200);
 assert.equal((await req('/campaigns/'+campaign.id+'/approve','POST',{version:1},agent)).status,403);
 assert.equal((await req('/campaigns/'+campaign.id+'/approve','POST',{version:999})).status,409);
 r=await req('/campaigns/'+campaign.id+'/approve','POST',{version:1});assert.equal(r.data.status,'aprovada');assert.equal(r.data.approval.recipients[0].email,lead.email);
 r=await req('/campaigns/'+campaign.id,'PATCH',{body:'Alterado',version:1},agent);assert.equal(r.data.status,'rascunho');assert.equal(r.data.approval,null);assert.equal(r.data.version,2);
 assert.equal((await req('/campaigns/'+campaign.id,'PATCH',{body:'Stale',version:1})).status,409);
 // O envio passou a existir (Resend), com travas. Sem chave configurada ele recusa.
 assert.equal((await req('/campaigns/'+campaign.id+'/send','POST',{})).status,400);
 await req('/leads/'+lead.id,'PATCH',{blocked:true});await req('/campaigns/'+campaign.id+'/submit','POST',{});
 assert.equal((await req('/campaigns/'+campaign.id+'/approve','POST',{version:2})).status,409);
});
test('worker lease, source requirement, atomic imports and duplicate handling',async()=>{
 let r=await req('/prospecting/jobs','POST',{niche:'Academias',city:'São Paulo',limit:5,budget:0});assert.equal(r.status,200);
 r=await req('/agent/jobs/claim','POST',{},agent);const j=r.data.job;assert.equal(j.status,'executando');
 assert.equal((await req('/agent/jobs/claim','POST',{},agent)).data.job,null);
 const p='/agent/jobs/'+j.id+'/complete';
 assert.equal((await req(p,'POST',{leaseToken:'bad',leads:[],actualCost:0},agent)).status,409);
 assert.equal((await req(p,'POST',{leaseToken:j.leaseToken,leads:[{name:'Sem fonte'}],actualCost:0},agent)).status,400);
 const valid={name:'Academia teste',city:'São Paulo',sources:[{url:'https://example.org'}]};
 assert.equal((await req(p,'POST',{leaseToken:j.leaseToken,leads:[valid,{name:'Inválido'}],actualCost:0},agent)).status,400);
 assert.equal((await req('/leads')).data.length,1);
 r=await req(p,'POST',{leaseToken:j.leaseToken,leads:[valid,valid],actualCost:0},agent);assert.equal(r.status,200);assert.equal(r.data.imported,1);assert.equal(r.data.duplicates.length,1);
 assert.equal((await req(p,'POST',{leaseToken:j.leaseToken,leads:[],actualCost:0},agent)).status,409);
});
test('static application serves CSP and traversal is not exposed',async()=>{
 const r=await fetch(base);assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(await r.text(),/MLLuiz DevTech/);
 assert.equal((await fetch(base+'/data/credentials.json')).status,404);
});
test('email/password traditional login, session issuance, and logout',async()=>{
 let r = await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@mlluizdevtech.com.br',password:'wrongpass'})});
 assert.equal(r.status,401);

 r = await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@mlluizdevtech.com.br',password:'admin123456'})});
 assert.equal(r.status,200);
 const data = await r.json();
 assert.ok(data.token);
 assert.equal(data.user.email,'admin@mlluizdevtech.com.br');
 assert.equal(data.user.role,'admin');

 const s = await fetch(base+'/api/session',{headers:{Authorization:'Bearer '+data.token}});
 assert.equal(s.status,200);
 assert.equal((await s.json()).role,'admin');

 const lo = await fetch(base+'/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+data.token}});
 assert.equal(lo.status,200);

 const s2 = await fetch(base+'/api/session',{headers:{Authorization:'Bearer '+data.token}});
 assert.equal(s2.status,401);
});
