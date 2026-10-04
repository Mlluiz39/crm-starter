import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import net from 'node:net';
import path from 'node:path';

const dir=mkdtempSync(path.join(tmpdir(),'crm-prosp-'));
// Isola o arquivo de ambiente: sem isto o teste leria o .env real do usuário.
const envFile=path.join(dir,'hermes.env');
const admin='admin-test-token-123456789012345',agent='agent-test-token-123456789012345';
let child,base,port;

before(async()=>{
  port=await new Promise(r=>{const s=net.createServer();s.on('error',e=>{throw e;});s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
  base='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),CRM_DATA_DIR:dir,HERMES_ENV_FILE:envFile,CRM_ADMIN_TOKEN:admin,CRM_AGENT_TOKEN:agent},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',c=>reject(Error('exit '+c)));});
});
after(async()=>{await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM');});rmSync(dir,{recursive:true,force:true});});

async function req(p,method='GET',body,token=admin){
  const r=await fetch(base+'/api'+p,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
}
const mkJob=(b)=>req('/prospecting/jobs','POST',{niche:'Dentistas',city:'São Paulo, SP',limit:5,budget:5,...b});

test('prospecting stats reflect real job data, not fabricated numbers',async()=>{
  let s=await req('/state');
  assert.equal(s.data.prospecting.jobs,0);
  assert.equal(s.data.prospecting.imported,0);
  assert.equal(s.data.prospecting.cost,0);
  // integrações têm forma real, não strings
  assert.equal(typeof s.data.integrations.hermes.connected,'boolean');
  assert.equal(s.data.integrations.hermes.connected,false);
  assert.equal(typeof s.data.integrations.apify.configured,'boolean');
  // e-mail agora é uma integração com chave (Resend), como as demais
  assert.equal(s.data.integrations.email.configured,false);
  assert.equal(s.data.integrations.email.envKey,'RESEND_API_KEY');

  await mkJob({});
  s=await req('/state');
  assert.equal(s.data.prospecting.jobs,1);
  assert.equal(s.data.prospecting.pending,1);
  assert.equal(s.data.prospecting.completed,0);
  assert.equal(s.data.prospecting.cost,0);
});

test('clean removes only finished jobs and keeps imported leads',async()=>{
  // conclui um job importando um lead com fonte real
  const claim=await req('/agent/jobs/claim','POST',{},agent);
  const j=claim.data.job;
  const done=await req('/agent/jobs/'+j.id+'/complete','POST',{leaseToken:j.leaseToken,actualCost:0.025,leads:[{name:'Dentista Real',city:'São Paulo, SP',sources:[{url:'https://www.google.com/maps/place/x'}]}]},agent);
  assert.equal(done.data.imported,1);

  // cria um que falha e outro que fica pendente
  await mkJob({niche:'Lojas'});
  const c2=await req('/agent/jobs/claim','POST',{},agent);
  await req('/agent/jobs/'+c2.data.job.id+'/fail','POST',{leaseToken:c2.data.job.leaseToken,error:'falha de teste'},agent);
  await mkJob({niche:'Academias',city:'Mauá, SP'});

  let s=await req('/state');
  assert.equal(s.data.prospecting.jobs,3);
  assert.equal(s.data.prospecting.completed,1);
  assert.equal(s.data.prospecting.failed,1);
  assert.equal(s.data.prospecting.pending,1);
  assert.equal(s.data.prospecting.finished,2);
  assert.equal(s.data.prospecting.imported,1);
  assert.equal(s.data.prospecting.cost,0.025);
  const leadsAntes=s.data.leads.length;

  // limpar só as finalizadas
  const clean=await req('/prospecting/jobs/clean','POST',{status:'finished'});
  assert.equal(clean.data.removed,2);

  s=await req('/state');
  assert.equal(s.data.prospecting.jobs,1,'só a pendente permanece');
  assert.equal(s.data.prospecting.pending,1);
  assert.equal(s.data.prospecting.finished,0);
  // os leads importados continuam no CRM
  assert.equal(s.data.leads.length,leadsAntes);
  assert.ok(s.data.leads.some(l=>l.name==='Dentista Real'));
});

test('clean is admin-only, validated, and single delete works',async()=>{
  assert.equal((await req('/prospecting/jobs/clean','POST',{status:'finished'},agent)).status,403);
  assert.equal((await req('/prospecting/jobs/clean','POST',{status:'inventado'})).status,400);

  const s=await req('/state');
  const id=s.data.jobs[0].id;
  assert.equal((await req('/prospecting/jobs/'+id,'DELETE',undefined,agent)).status,403);
  assert.equal((await req('/prospecting/jobs/'+id,'DELETE')).status,200);
  assert.equal((await req('/prospecting/jobs/'+id,'DELETE')).status,404,'remover de novo dá 404');
  assert.equal((await req('/state')).data.prospecting.jobs,0);
});

test('clean with nothing to remove is a no-op',async()=>{
  const r=await req('/prospecting/jobs/clean','POST',{status:'finished'});
  assert.equal(r.status,200);
  assert.equal(r.data.removed,0);
});

test('progress renova reserva e falha preserva custos conhecidos e pendentes',async()=>{
  const j=(await mkJob({budget:1})).data;
  const claimed=(await req('/agent/jobs/claim','POST',{},agent)).data.job;
  const payload={leaseToken:claimed.leaseToken,actualCost:0.07,reservedCost:0.1,costUncertain:true,providerRunId:'run-test',warnings:['AISA: custo aguardando confirmação']};
  assert.equal((await req('/agent/jobs/'+j.id+'/progress','POST',payload)).status,403);
  assert.equal((await req('/agent/jobs/'+j.id+'/progress','POST',{...payload,leaseToken:'wrong'},agent)).status,409);
  assert.equal((await req('/agent/jobs/'+j.id+'/progress','POST',payload,agent)).status,200);
  assert.equal((await req('/agent/jobs/'+j.id+'/fail','POST',{leaseToken:claimed.leaseToken,error:'Importação falhou'},agent)).status,200);
  const saved=(await req('/state')).data.jobs.find(x=>x.id===j.id);
  assert.equal(saved.actualCost,0.07);assert.equal(saved.reservedCost,0.1);
  assert.equal(saved.costUncertain,true);assert.equal(saved.providerRunId,'run-test');
});

test('reserva expirada com possível gasto não repete trabalho pago',async()=>{
  const j=(await mkJob({budget:1})).data;
  const claimed=(await req('/agent/jobs/claim','POST',{},agent)).data.job;
  await req('/agent/jobs/'+j.id+'/progress','POST',{leaseToken:claimed.leaseToken,actualCost:0,reservedCost:1,costUncertain:true},agent);
  const {DatabaseSync}=await import('node:sqlite');
  const db=new DatabaseSync(path.join(dir,'crm.sqlite'));
  try {
    const row=db.prepare("SELECT payload FROM records WHERE kind='jobs' AND id=?").get(j.id);
    const expired={...JSON.parse(row.payload),leaseUntil:'2000-01-01T00:00:00.000Z'};
    db.prepare("UPDATE records SET payload=? WHERE kind='jobs' AND id=?").run(JSON.stringify(expired),j.id);
  } finally {db.close();}
  assert.equal((await req('/agent/jobs/claim','POST',{},agent)).data.job,null);
  const saved=(await req('/state')).data.jobs.find(x=>x.id===j.id);
  assert.equal(saved.status,'falhou');assert.equal(saved.reservedCost,1);
});

test('novas pesquisas usam AISA; Apify exige ativação explícita do administrador',async()=>{
  const j=(await mkJob({budget:1})).data;
  assert.equal(j.searchProvider,'aisa');
  const claimed=(await req('/agent/jobs/claim','POST',{},agent)).data.job;
  const fallback='/agent/jobs/'+j.id+'/fallback';
  assert.equal((await req(fallback,'POST',{leaseToken:claimed.leaseToken,error:'AISA indisponível',actualCost:0.05,reservedCost:0,costUncertain:false},agent)).status,200);
  let saved=(await req('/state')).data.jobs.find(x=>x.id===j.id);
  assert.equal(saved.status,'aguardando_backup');
  assert.equal((await req('/agent/jobs/claim','POST',{},agent)).data.job,null);
  const activate='/prospecting/jobs/'+j.id+'/activate-apify';
  assert.equal((await req(activate,'POST',{},agent)).status,403);
  assert.equal((await req(activate,'POST',{})).status,200);
  assert.equal((await req(activate,'POST',{})).status,409);
  saved=(await req('/agent/jobs/claim','POST',{},agent)).data.job;
  assert.equal(saved.id,j.id);assert.equal(saved.searchProvider,'apify');assert.equal(saved.actualCost,0.05);
  await req('/agent/jobs/'+j.id+'/fail','POST',{leaseToken:saved.leaseToken,error:'cleanup'},agent);
});
test('saldo incerto ou insuficiente impede ativar Apify',async()=>{
  const j=(await mkJob({budget:1})).data;
  const claimed=(await req('/agent/jobs/claim','POST',{},agent)).data.job;
  await req('/agent/jobs/'+j.id+'/fallback','POST',{leaseToken:claimed.leaseToken,error:'Conexão perdida',actualCost:0,reservedCost:1,costUncertain:true},agent);
  assert.equal((await req('/prospecting/jobs/'+j.id+'/activate-apify','POST',{})).status,409);
});
