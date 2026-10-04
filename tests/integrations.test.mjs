import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import net from 'node:net';
import path from 'node:path';

// As quatro integrações com chave gravam em HERMES_ENV_FILE (arquivo temporário).
const dir=mkdtempSync(path.join(tmpdir(),'crm-int-'));
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
const SERVICOS=['apify','aisa','jev','email'];

test('todas as integrações começam sem chave e expõem o envKey correto',async()=>{
  const s=await req('/state');
  const esperado={apify:'APIFY_API_TOKEN',aisa:'AISA_API_KEY',jev:'TYPESAFE_API_KEY',email:'RESEND_API_KEY'};
  for(const k of SERVICOS){
    assert.equal(s.data.integrations[k].configured,false,`${k} deveria começar sem chave`);
    assert.equal(s.data.integrations[k].envKey,esperado[k],`envKey de ${k}`);
  }
  // o Hermes não tem chave: é token gerado pelo próprio CRM
  assert.equal(typeof s.data.integrations.hermes.connected,'boolean');
});

test('gravar cada chave escreve a variável certa e mascara o valor',async()=>{
  const chaves={apify:'apify_api_TESTE0000000000000000000000000000',aisa:'aisa_teste_0000000000000000',jev:'typesafe-teste0000000000000000000000000000',email:'re_teste0000000000000000'};
  for(const k of SERVICOS){
    const r=await req('/integrations/'+k,'POST',{token:chaves[k]});
    assert.equal(r.status,200,`POST ${k}`);
    assert.equal(r.data.configured,true);
    assert.ok(!r.data.masked.includes(chaves[k]),`${k}: não pode devolver a chave inteira`);
    assert.ok(r.data.masked.endsWith(chaves[k].slice(-4)),`${k}: máscara preserva os 4 últimos`);
  }
  const raw=readFileSync(envFile,'utf8');
  for(const k of SERVICOS){
    const envKey=(await req('/integrations/'+k)).data.envKey;
    assert.ok(raw.includes(`${envKey}=${chaves[k]}`),`${envKey} gravada`);
  }
  assert.equal(statSync(envFile).mode & 0o777,0o600,'permissão restrita');
});

test('validação rejeita injeção de linha, vazio e serviço inexistente',async()=>{
  assert.equal((await req('/integrations/aisa','POST',{token:'abc\nEVIL=1'})).status,400);
  assert.equal((await req('/integrations/aisa','POST',{token:'abc def'})).status,400);
  assert.equal((await req('/integrations/aisa','POST',{token:''})).status,400);
  assert.equal((await req('/integrations/aisa','POST',{token:'curto'})).status,400);
  assert.equal((await req('/integrations/banana','POST',{token:'x'.repeat(30)})).status,404);
  // nada disso pode ter sujado o arquivo
  assert.equal(readFileSync(envFile,'utf8').includes('EVIL'),false);
});

test('toda integração é admin-only (ler, gravar, remover e testar)',async()=>{
  for(const k of SERVICOS){
    assert.equal((await req('/integrations/'+k,'GET',undefined,agent)).status,403,`GET ${k}`);
    assert.equal((await req('/integrations/'+k,'POST',{token:'x'.repeat(30)},agent)).status,403,`POST ${k}`);
    assert.equal((await req('/integrations/'+k,'DELETE',undefined,agent)).status,403,`DELETE ${k}`);
    assert.equal((await req('/integrations/'+k+'/test','POST',{},agent)).status,403,`test ${k}`);
  }
});

test('testar sem chave salva responde 400, não chama o provedor',async()=>{
  await req('/integrations/aisa','DELETE');
  const r=await req('/integrations/aisa/test','POST');
  assert.equal(r.status,400);
  assert.match(r.data.error,/Salve a chave/i);
});

test('remover apaga só a variável daquele serviço',async()=>{
  // grava todas de novo
  for(const k of SERVICOS) await req('/integrations/'+k,'POST',{token:`${k}_valor_de_teste_1234567890`});
  assert.equal((await req('/integrations/aisa','DELETE')).status,200);
  const raw=readFileSync(envFile,'utf8');
  assert.equal(/^AISA_API_KEY=/m.test(raw),false,'AISA removida');
  for(const k of ['apify','jev','email']){
    const envKey=(await req('/integrations/'+k)).data.envKey;
    assert.ok(raw.includes(envKey+'='),`${envKey} preservada`);
  }
});
