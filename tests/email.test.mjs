import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

// Stub local do Resend: nenhum e-mail sai de verdade. Registra o que teria sido enviado.
const enviados=[];
let proximoStatus=200;
let onSend;
const stub=http.createServer((req,res)=>{
  let corpo='';req.on('data',c=>corpo+=c);
  req.on('end',async()=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/emails'&&req.method==='POST'){
      const body=JSON.parse(corpo||'{}');
      if(onSend) await onSend();
      if(proximoStatus===0){req.socket.destroy();return;}
      if(proximoStatus!==200){res.writeHead(proximoStatus);res.end(JSON.stringify({message:'stub recusou'}));return;}
      enviados.push({...body,authorization:req.headers.authorization,idempotencyKey:req.headers['idempotency-key']});
      res.writeHead(200);res.end(JSON.stringify({id:'stub-'+enviados.length}));return;
    }
    res.writeHead(404);res.end('{}');
  });
});

const dir=mkdtempSync(path.join(tmpdir(),'crm-email-'));
const envFile=path.join(dir,'hermes.env');
const admin='admin-test-token-123456789012345',agent='agent-test-token-123456789012345';
let child,base,port,stubUrl;

before(async()=>{
  await new Promise(r=>stub.listen(0,'127.0.0.1',r));
  stubUrl=`http://127.0.0.1:${stub.address().port}`;
  port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
  base='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),CRM_DATA_DIR:dir,HERMES_ENV_FILE:envFile,RESEND_BASE_URL:stubUrl,CRM_ADMIN_TOKEN:admin,CRM_AGENT_TOKEN:agent},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',c=>reject(Error('exit '+c)));});
});
after(async()=>{await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM');});await new Promise(r=>stub.close(r));rmSync(dir,{recursive:true,force:true});});

async function req(p,method='GET',body,token=admin){
  const r=await fetch(base+'/api'+p,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
}
const limpa=()=>{enviados.length=0;proximoStatus=200;};

// Prepara: chave do Resend, dois leads com e-mail, campanha aprovada.
// O sufixo evita duplicata entre testes (o CRM barra e-mail repetido).
let seq=0;
async function prepararCampanha(){
  const s=++seq;
  writeFileSync(envFile,'RESEND_API_KEY=re_teste_0000000000000000\n',{mode:0o600});
  const l1=(await req('/leads','POST',{name:`Alvo Um ${s}`,email:`um${s}@example.com`,city:'Santo André'})).data;
  const l2=(await req('/leads','POST',{name:`Alvo Dois ${s}`,email:`dois${s}@example.com`,city:'São Paulo'})).data;
  const c=(await req('/campaigns','POST',{name:'Piloto',subject:'Uma ideia',body:'Olá, tudo bem?',leadIds:[l1.id,l2.id]})).data;
  await req('/campaigns/'+c.id+'/submit','POST',{});
  const ap=(await req('/campaigns/'+c.id+'/approve','POST',{version:c.version})).data;
  return {l1,l2,c:ap};
}

test('configurações de envio: padrão seguro, validação e persistência',async()=>{
  const s=await req('/email/settings');
  assert.equal(s.data.testMode,true,'modo de teste ligado por padrão');
  assert.equal(s.data.from,'contato@mlluizdevtech.com.br');
  assert.equal(s.data.dailyLimit,20);
  assert.equal(s.data.enviadosHoje,0);

  assert.equal((await req('/email/settings','PATCH',{from:'não-é-email'})).status,400);
  assert.equal((await req('/email/settings','PATCH',{testRecipient:'quebrado@'})).status,400);
  assert.equal((await req('/email/settings','PATCH',{dailyLimit:0})).status,400);
  assert.equal((await req('/email/settings','PATCH',{dailyLimit:9999})).status,400);
  assert.equal((await req('/email/settings','PATCH',{testMode:'sim'})).status,400);

  const r=await req('/email/settings','PATCH',{fromName:'MLLuiz',dailyLimit:5,testRecipient:'eu@example.com'});
  assert.equal(r.status,200);assert.equal(r.data.dailyLimit,5);assert.equal(r.data.restante,5);
  // e as configurações sobrevivem a uma releitura
  const s2=await req('/email/settings');
  assert.equal(s2.data.dailyLimit,5);assert.equal(s2.data.testRecipient,'eu@example.com');
});

test('envio exige aprovação, chave e respeita o modo de teste',async()=>{
  limpa();
  const {c}=await prepararCampanha();
  // sem chave do Resend (prepararCampanha grava a chave, então limpamos depois)
  writeFileSync(envFile,'',{mode:0o600});
  let r=await req('/campaigns/'+c.id+'/send','POST',{});
  assert.equal(r.status,400);assert.match(r.data.error,/Chave do Resend/);

  writeFileSync(envFile,'RESEND_API_KEY=re_teste_0000000000000000\n',{mode:0o600});
  // rascunho não envia
  const c2=(await req('/campaigns','POST',{name:'Sem aprovar',subject:'x',body:'y',leadIds:[c.leadIds[0]]})).data;
  assert.equal((await req('/campaigns/'+c2.id+'/send','POST',{})).status,409);

  // modo de teste exige destinatário de teste
  await req('/email/settings','PATCH',{testMode:true,testRecipient:''});
  r=await req('/campaigns/'+c.id+'/send','POST',{});
  assert.equal(r.status,400);assert.match(r.data.error,/e-mail de teste/i);
  assert.equal(enviados.length,0,'nada pode ter sido enviado');

  // com destinatário de teste: sai UM e-mail, só para ele
  await req('/email/settings','PATCH',{testMode:true,testRecipient:'eu@example.com'});
  r=await req('/campaigns/'+c.id+'/send','POST',{});
  assert.equal(r.status,200);assert.equal(r.data.modo,'teste');assert.equal(r.data.enviados,1);
  assert.equal(enviados.length,1,'exatamente um e-mail');
  assert.deepEqual(enviados[0].to,['eu@example.com'],'nunca para os leads');
  assert.match(enviados[0].from,/contato@mlluizdevtech\.com\.br/);
  assert.equal(enviados[0].subject,'Uma ideia');
});

test('envio em produção vai para os destinatários aprovados, uma vez cada',async()=>{
  limpa();
  const {c}=await prepararCampanha();
  await req('/email/settings','PATCH',{testMode:false,dailyLimit:20});
  const r=await req('/campaigns/'+c.id+'/send','POST',{});
  assert.equal(r.status,200);assert.equal(r.data.modo,'producao');assert.equal(r.data.enviados,2);
  assert.equal(enviados.length,2);
  assert.ok(enviados.every(e=>/^(um|dois)\d*@example\.com$/.test(e.to[0])),'destinatários aprovados');
  // campanha passa a "enviada"
  const s=await req('/state');
  assert.equal(s.data.campaigns.find(x=>x.id===c.id).status,'enviada');
  const desta=s.data.outbox.filter(o=>o.campaignId===c.id);
  assert.equal(desta.length,2);
  assert.ok(desta.every(o=>o.status==='enviado'&&o.providerId),'cada envio com o id do provedor');

  // reenviar a mesma versão é bloqueado (idempotência)
  const r2=await req('/campaigns/'+c.id+'/send','POST',{});
  assert.equal(r2.status,409,'reenvio bloqueado');
  assert.equal(enviados.length,2,'nada novo foi enviado');
});

test('editar depois de aprovar invalida a aprovação e bloqueia o envio',async()=>{
  limpa();
  const {c}=await prepararCampanha();
  await req('/email/settings','PATCH',{testMode:false});
  await req('/campaigns/'+c.id,'PATCH',{body:'Texto trocado',version:c.version});
  const r=await req('/campaigns/'+c.id+'/send','POST',{});
  assert.equal(r.status,409);assert.match(r.data.error,/aprovada/i);
  assert.equal(enviados.length,0);
});

test('bloquear um destinatário depois da aprovação impede o envio',async()=>{
  limpa();
  const {l1,c}=await prepararCampanha();
  await req('/email/settings','PATCH',{testMode:false});
  await req('/leads/'+l1.id,'PATCH',{blocked:true});
  const r=await req('/campaigns/'+c.id+'/send','POST',{});
  assert.equal(r.status,409);assert.match(r.data.error,/bloqueado/i);
  assert.equal(enviados.length,0);
});

test('limite diário barra o envio',async()=>{
  limpa();
  const {c}=await prepararCampanha();
  await req('/email/settings','PATCH',{testMode:false,dailyLimit:1});
  const r=await req('/campaigns/'+c.id+'/send','POST',{});
  assert.equal(r.status,429);assert.match(r.data.error,/limite diário/i);
  assert.equal(enviados.length,0);
});

test('falha do provedor é registrada e a campanha não é marcada como enviada',async()=>{
  limpa();
  const {c}=await prepararCampanha();
  await req('/email/settings','PATCH',{testMode:false,dailyLimit:20});
  proximoStatus=422;
  const r=await req('/campaigns/'+c.id+'/send','POST',{});
  assert.equal(r.status,200);
  assert.equal(r.data.enviados,0);assert.equal(r.data.falhas.length,2);
  const s=await req('/state');
  assert.equal(s.data.campaigns.find(x=>x.id===c.id).status,'aprovada','não vira "enviada"');
  const desta=s.data.outbox.filter(o=>o.campaignId===c.id);
  assert.equal(desta.length,2);
  assert.ok(desta.every(o=>o.status==='falhou'&&o.erro),'cada falha registrada com o erro');
});

test('envio e configurações são admin-only',async()=>{
  const {c}=await prepararCampanha();
  assert.equal((await req('/campaigns/'+c.id+'/send','POST',{},agent)).status,403);
  assert.equal((await req('/email/settings','GET',undefined,agent)).status,403);
  assert.equal((await req('/email/settings','PATCH',{dailyLimit:5},agent)).status,403);
  assert.equal((await req('/outbox','GET',undefined,agent)).status,403);
});

// Reservas precisam existir enquanto o provedor ainda está processando.
async function duranteEnvio(fn){
  let release, started;
  const gate=new Promise(r=>release=r), entered=new Promise(r=>started=r);
  let first=true;
  onSend=async()=>{if(first){first=false;started();await gate;}};
  try {await fn(entered,release);} finally {release();onSend=null;}
}
test('envios simultâneos da mesma campanha não duplicam destinatários',async()=>{
  limpa();const {c}=await prepararCampanha();
  await req('/email/settings','PATCH',{testMode:false,dailyLimit:500});
  await duranteEnvio(async(entered,release)=>{
    const first=req('/campaigns/'+c.id+'/send','POST',{});
    await entered;
    const second=await req('/campaigns/'+c.id+'/send','POST',{});
    release();await first;
    assert.equal(second.status,409);
  });
  assert.equal(enviados.length,2);
  assert.ok(enviados.every(e=>e.idempotencyKey));
  assert.equal(new Set(enviados.map(e=>e.idempotencyKey)).size,2);
});
test('reservas de outra campanha consomem a cota diária durante envio',async()=>{
  limpa();const {c}=await prepararCampanha(),other=(await prepararCampanha()).c;
  const today=(await req('/email/settings')).data.enviadosHoje;
  await req('/email/settings','PATCH',{testMode:false,dailyLimit:today+2});
  await duranteEnvio(async(entered,release)=>{
    const first=req('/campaigns/'+c.id+'/send','POST',{});await entered;
    const second=await req('/campaigns/'+other.id+'/send','POST',{});
    release();await first;assert.equal(second.status,429);
  });
  assert.equal(enviados.length,2);
});
test('falha confirmada permite repetir a mesma versão',async()=>{
  limpa();const {c}=await prepararCampanha();
  await req('/email/settings','PATCH',{testMode:false,dailyLimit:500});
  proximoStatus=422;await req('/campaigns/'+c.id+'/send','POST',{});
  proximoStatus=200;const r=await req('/campaigns/'+c.id+'/send','POST',{});
  assert.equal(r.status,200);assert.equal(r.data.enviados,2);
});
test('teste preserva aprovação e permite enviar a mesma versão em produção',async()=>{
  limpa();const {c}=await prepararCampanha();
  // Mesmo endereço de um lead: separação não pode depender apenas do e-mail.
  await req('/email/settings','PATCH',{testMode:true,testRecipient:c.approval.recipients[0].email,dailyLimit:500});
  await req('/campaigns/'+c.id+'/send','POST',{});
  assert.equal((await req('/state')).data.campaigns.find(x=>x.id===c.id).status,'aprovada');
  await req('/email/settings','PATCH',{testMode:false});
  const r=await req('/campaigns/'+c.id+'/send','POST',{});
  assert.equal(r.status,200);assert.equal(r.data.enviados,2);assert.equal(enviados.length,3);
});
test('conexão perdida conserva estado incerto e impede reenvio automático',async()=>{
  limpa();const {c}=await prepararCampanha();
  await req('/email/settings','PATCH',{testMode:false,dailyLimit:500});
  proximoStatus=0;await req('/campaigns/'+c.id+'/send','POST',{});
  const out=(await req('/state')).data.outbox.filter(o=>o.campaignId===c.id);
  assert.ok(out.every(o=>o.status==='incerto'));
  proximoStatus=200;assert.equal((await req('/campaigns/'+c.id+'/send','POST',{})).status,409);
  assert.equal(enviados.length,0);
});

test('repetição de lote parcial envia somente o destinatário que falhou',async()=>{
  limpa();const {c}=await prepararCampanha();
  await req('/email/settings','PATCH',{testMode:false,dailyLimit:500});
  let n=0;onSend=()=>{proximoStatus=n++?422:200;};
  try {await req('/campaigns/'+c.id+'/send','POST',{});} finally {onSend=null;proximoStatus=200;}
  assert.equal(enviados.length,1);
  const r=await req('/campaigns/'+c.id+'/send','POST',{});
  assert.equal(r.data.enviados,1);assert.equal(enviados.length,2);
  assert.equal(new Set(enviados.map(e=>e.to[0])).size,2);
});
test('edição durante envio não é sobrescrita e interrompe o restante do lote',async()=>{
  limpa();const {c}=await prepararCampanha();
  await req('/email/settings','PATCH',{testMode:false,dailyLimit:500});
  await duranteEnvio(async(entered,release)=>{
    const first=req('/campaigns/'+c.id+'/send','POST',{});await entered;
    await req('/campaigns/'+c.id,'PATCH',{version:c.version,body:'Nova mensagem'});
    release();await first;
  });
  const current=(await req('/state')).data.campaigns.find(x=>x.id===c.id);
  assert.equal(current.body,'Nova mensagem');assert.equal(current.status,'rascunho');
  assert.equal(enviados.length,1);
});
test('falha antiga sem confirmação não autoriza repetir o envio',async()=>{
  limpa();const {c}=await prepararCampanha();
  await req('/email/settings','PATCH',{testMode:false,dailyLimit:500});
  proximoStatus=422;await req('/campaigns/'+c.id+'/send','POST',{});
  // Simula o formato anterior, que gravava timeouts como falha comum.
  const {DatabaseSync}=await import('node:sqlite');
  const db=new DatabaseSync(path.join(dir,'crm.sqlite'));
  try {for(const row of db.prepare("SELECT id,payload FROM records WHERE kind='outbox'").all()) {
    const o=JSON.parse(row.payload);if(o.campaignId!==c.id)continue;
    delete o.retryable;db.prepare("UPDATE records SET payload=? WHERE kind='outbox' AND id=?").run(JSON.stringify(o),row.id);
  }} finally {db.close();}
  proximoStatus=200;assert.equal((await req('/campaigns/'+c.id+'/send','POST',{})).status,409);
  assert.equal(enviados.length,0);
});

test('interrupção do servidor conserva reservas e bloqueia duplicação após reinício',async()=>{
  limpa();const {c}=await prepararCampanha();
  await req('/email/settings','PATCH',{testMode:false,dailyLimit:500});
  await duranteEnvio(async(entered,release)=>{
    const sending=req('/campaigns/'+c.id+'/send','POST',{}).catch(()=>null);
    await entered;
    await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGKILL');});
    release();await sending;
  });
  child=spawn(process.execPath,['server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),CRM_DATA_DIR:dir,HERMES_ENV_FILE:envFile,RESEND_BASE_URL:stubUrl,CRM_ADMIN_TOKEN:admin,CRM_AGENT_TOKEN:agent},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',c=>reject(Error('exit '+c)));});
  const out=(await req('/state')).data.outbox.filter(o=>o.campaignId===c.id);
  assert.equal(out.length,2);assert.ok(out.every(o=>o.status==='processando'));
  const count=enviados.length;
  assert.equal((await req('/campaigns/'+c.id+'/send','POST',{})).status,409);
  assert.equal(enviados.length,count);
});
