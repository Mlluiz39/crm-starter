import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import net from 'node:net';
import path from 'node:path';

// A chave da Apify é gravada no arquivo de ambiente do Hermes. O teste aponta
// HERMES_ENV_FILE para um arquivo temporário — nunca para o .env real do usuário.
const dir=mkdtempSync(path.join(tmpdir(),'crm-apify-'));
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

test('apify key: admin-only, validated, written to env file and never echoed back',async()=>{
  // Nada configurado no início.
  let r=await req('/integrations/apify');
  assert.equal(r.status,200);
  assert.equal(r.data.configured,false);
  assert.equal(r.data.masked,'');

  // O agente não pode ler nem escrever a chave.
  assert.equal((await req('/integrations/apify','GET',undefined,agent)).status,403);
  assert.equal((await req('/integrations/apify','POST',{token:'apify_api_abcdefghijklmnop'},agent)).status,403);
  assert.equal((await req('/integrations/apify','DELETE',undefined,agent)).status,403);

  // Rejeita vazio, curto, e — o caso crítico — conteúdo que injetaria linhas no .env.
  assert.equal((await req('/integrations/apify','POST',{})).status,400);
  assert.equal((await req('/integrations/apify','POST',{token:'curta'})).status,400);
  assert.equal((await req('/integrations/apify','POST',{token:'apify_api_ok\nEVIL=1'})).status,400);
  assert.equal((await req('/integrations/apify','POST',{token:'apify_api_ok com espaco'})).status,400);
  assert.equal((await req('/integrations/apify','POST',{token:'apify_api_ok"aspas'})).status,400);

  // Nada foi gravado pelas tentativas inválidas.
  assert.equal((await req('/integrations/apify')).data.configured,false);

  // Grava uma chave válida.
  const token='apify_api_0123456789abcdefghijklmnopqrstuv';
  r=await req('/integrations/apify','POST',{token});
  assert.equal(r.status,200);
  assert.equal(r.data.configured,true);
  // O retorno é mascarado: nunca devolve a chave inteira.
  assert.ok(!r.data.masked.includes(token));
  assert.match(r.data.masked,/^apify_api_/);
  assert.ok(r.data.masked.endsWith(token.slice(-4)));

  // Confere o arquivo: chave presente, permissão restrita, conteúdo exato.
  const raw=readFileSync(envFile,'utf8');
  assert.ok(raw.includes(`APIFY_API_TOKEN=${token}`));
  assert.equal(statSync(envFile).mode & 0o777,0o600);
  assert.equal(raw.includes('EVIL'),false);

  // O /api/state também expõe apenas o valor mascarado.
  const state=await req('/state');
  assert.equal(state.data.integrations.apify.configured,true);
  assert.ok(!JSON.stringify(state.data).includes(token));
});

test('apify key: replacing updates in place and preserves other env lines',async()=>{
  // Simula um .env do Hermes já com outras chaves.
  writeFileSync(envFile,'OPENAI_API_KEY=sk-existente\nAPIFY_API_TOKEN=apify_api_oldoldoldoldoldoldoldold\nWEB_TOOLS_DEBUG=1\n',{mode:0o600});

  const token='apify_api_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
  const r=await req('/integrations/apify','POST',{token});
  assert.equal(r.status,200);

  const raw=readFileSync(envFile,'utf8');
  assert.ok(raw.includes(`APIFY_API_TOKEN=${token}`));
  // Substituiu em vez de acrescentar uma segunda linha.
  assert.equal(raw.match(/^APIFY_API_TOKEN=/gm).length,1);
  // Preservou as demais chaves e a permissão restrita.
  assert.ok(raw.includes('OPENAI_API_KEY=sk-existente'));
  assert.ok(raw.includes('WEB_TOOLS_DEBUG=1'));
  assert.equal(statSync(envFile).mode & 0o777,0o600);
});

test('apify key: delete removes only that line',async()=>{
  const r=await req('/integrations/apify','DELETE');
  assert.equal(r.status,200);
  assert.equal(r.data.configured,false);

  const raw=readFileSync(envFile,'utf8');
  assert.equal(/^APIFY_API_TOKEN=/m.test(raw),false);
  assert.ok(raw.includes('OPENAI_API_KEY=sk-existente'));
});
