import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

// O processo executa o worker real; só a rede é substituída. Nunca usa credenciais reais.
async function runWorker({budget=1,cost=0.05,empty=false,completeFails=false,configured=true,runFails=false,decisionsListFails=false,provider='apify',aisaFails=false,aisaEmpty=false,priorCost=0,aisaLost=false,aisaTaskFails=false}={}) {
 const dir=mkdtempSync(path.join(tmpdir(),'crm-worker-')),log=path.join(dir,'calls.json');
 const setup=`import {writeFileSync} from 'node:fs';
 const calls=[];process.on('exit',()=>writeFileSync(${JSON.stringify(log)},JSON.stringify(calls)));
 globalThis.fetch=async(input,options={})=>{
 const u=new URL(input),body=options.body?JSON.parse(options.body):null;calls.push({url:u.href,method:options.method||'GET',body});
 let result={},status=200;
 if(u.pathname.endsWith('/claim'))result={job:{id:'job-fixture',leaseToken:'lease',budget:${budget},limit:1,niche:'Lojas',city:'SP',searchProvider:${JSON.stringify(provider)},actualCost:${priorCost},reservedCost:0}};
 else if(u.pathname.endsWith('/progress')||u.pathname.endsWith('/fallback'))result={ok:true};
 else if(u.pathname.endsWith('/complete')){result=${completeFails}?{error:'falha de importação'}:{imported:1,duplicates:[]};status=${completeFails}?400:200;}
 else if(u.pathname.endsWith('/fail'))result={ok:true};
 else if(u.pathname==='/api/leads'){result=${decisionsListFails}?{error:'indisponível'}:[{id:'lead-fixture',name:'Empresa',city:'SP',jobId:'job-fixture'}];status=${decisionsListFails}?503:200;}
 else if(u.pathname==='/api/agent/decisions')result={ok:true};
 else if(u.hostname==='api.apify.com'&&u.pathname.endsWith('/runs'))result={data:{id:'run-fixture',status:${runFails}?'FAILED':'SUCCEEDED'}};
 else if(u.hostname==='api.apify.com'&&u.pathname.includes('/actor-runs/'))result={data:{id:'run-fixture',status:${runFails}?'FAILED':'SUCCEEDED',defaultDatasetId:'dataset',usageTotalUsd:${cost}}};
 else if(u.hostname==='api.apify.com'&&u.pathname.includes('/items'))result=${empty}?[]:[{title:'Empresa',city:'SP',website:'https://example.com',url:'https://maps.google.com/example'}];
 else if(u.hostname==='mcp.aisa.one'){
   if(${aisaLost}&&body.method==='tools/call')throw Error('Conexão perdida');
   if(body.method==='initialize') result={jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-03-26',capabilities:{},serverInfo:{name:'fixture',version:'1'}}};
   else if(body.method==='notifications/initialized')return new Response(null,{status:202});
   else if(body.method==='tools/call') {
    const data={status_code:20000,cost:0.01,tasks:[{id:'aisa-task',status_code:${aisaTaskFails}?40501:20000,result:[{items:${aisaEmpty}?[]:[{type:'maps_search',title:'Empresa',url:'https://example.com',place_id:'real-place-id',phone:'+551111111111',address_info:{city:'SP'},category:'Loja'}]}]}]};
    result={jsonrpc:'2.0',id:body.id,result:{structuredContent:${aisaFails}?{successful:false,error:{status:402,message:'Saldo insuficiente'}}:{successful:true,data},isError:false}};
   } else throw Error('Método MCP inesperado');
  }
  else if(u.hostname==='api.aisa.one')result={organization:{name:'Empresa'}};
 else if(u.hostname==='api.typesafe.ai')result={answers:{aderencia:{choice:'alta'}},usage:{cost:0.02}};
 else throw Error('Rota inesperada: '+u.href);
 return new Response(JSON.stringify(result),{status,headers:{'Content-Type':'application/json'}});
 };`;
 try {
 const child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(setup),'scripts/hermes-worker.mjs','--once'],{env:{...process.env,CRM_URL:'http://crm.invalid',CRM_AGENT_TOKEN:'fixture-only',HERMES_ENV_FILE:path.join(dir,'empty.env'),HERMES_HOME:dir,APIFY_API_TOKEN:'fixture-only',AISA_API_KEY:'fixture-only',TYPESAFE_API_KEY:'fixture-only',AISA_MAX_COST_USD:configured?'0.10':'',JEV_MAX_COST_USD:configured?'0.10':''},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
 assert.equal(code,0,output);return {calls:JSON.parse(readFileSync(log,'utf8')),output};
 } finally {rmSync(dir,{recursive:true,force:true});}
}
const at=(calls,suffix)=>calls.find(c=>new URL(c.url).pathname.endsWith(suffix));
test('worker registra decisões consumindo o array da API de leads',async()=>{
 const {calls,output}=await runWorker();
 assert.equal(at(calls,'/api/agent/decisions')?.body.leadId,'lead-fixture',output);
 assert.equal(at(calls,'/fail'),undefined);
});
test('worker repassa teto à Apify e não chama etapas sem saldo',async()=>{
 const {calls}=await runWorker({budget:0.05,cost:0.05});
 assert.equal(new URL(at(calls,'/runs').url).searchParams.get('maxTotalChargeUsd'),'0.05');
 assert.ok(!calls.some(c=>/api.aisa.one|api.typesafe.ai/.test(c.url)));
 assert.equal(at(calls,'/complete').body.actualCost,0.05);
});
test('worker pula chamadas de custo desconhecido e informa o motivo',async()=>{
 const {calls}=await runWorker({configured:false});
 assert.ok(!calls.some(c=>/api.aisa.one|api.typesafe.ai/.test(c.url)));
 assert.ok(at(calls,'/complete').body.warnings.length>=2);
});
test('reserva de enriquecimento não é declarada como custo real',async()=>{
 const {calls}=await runWorker();
 const result=at(calls,'/complete').body;
 assert.equal(result.actualCost,0.07);
 assert.equal(result.reservedCost,0.10);
 assert.equal(result.costUncertain,true);
});
test('falha após pesquisa preserva custo e token de reserva',async()=>{
 const {calls}=await runWorker({empty:true});
 const failure=at(calls,'/fail').body;
 assert.equal(failure.leaseToken,'lease');assert.equal(failure.actualCost,0.05);
});
test('falha na importação preserva custos já incorridos',async()=>{
 const {calls}=await runWorker({completeFails:true});
 assert.equal(at(calls,'/fail').body.actualCost,0.07);
 assert.equal(at(calls,'/fail').body.reservedCost,0.10);
});

test('falha da Apify conserva custo do run no relatório de falha',async()=>{
 const {calls}=await runWorker({runFails:true});
 const failure=at(calls,'/fail').body;
 assert.equal(failure.actualCost,0.05);assert.equal(failure.providerRunId,'run-fixture');
 assert.equal(failure.reservedCost,0);assert.equal(at(calls,'/complete'),undefined);
});
test('erro ao consultar leads após conclusão não tenta falhar o job concluído',async()=>{
 const {calls}=await runWorker({decisionsListFails:true});
 assert.ok(at(calls,'/complete'));assert.equal(at(calls,'/fail'),undefined);
});

test('AISA é a busca principal e repassa o orçamento total como limite',async()=>{
 const {calls}=await runWorker({provider:'aisa'});
 const use=calls.find(c=>c.body?.params?.name==='use');
 assert.equal(use?.body.params.arguments.max_price_usd,1);
 assert.equal(use.body.params.arguments.operation_id,'post_dataforseo_serp_google_maps_live');
 assert.ok(!calls.some(c=>new URL(c.url).hostname==='api.apify.com'));
 const done=at(calls,'/complete').body;
 assert.equal(done.leads[0].name,'Empresa');assert.ok(done.leads[0].sources[0].url.includes('real-place-id'));
});
test('falha da AISA aguarda escolha do usuário sem chamar Apify',async()=>{
 const {calls}=await runWorker({provider:'aisa',aisaFails:true});
 assert.ok(at(calls,'/fallback'));
 assert.ok(!calls.some(c=>new URL(c.url).hostname==='api.apify.com'));
 assert.equal(at(calls,'/complete'),undefined);
});
test('AISA sem resultados oferece Apify e preserva custo da consulta',async()=>{
 const {calls}=await runWorker({provider:'aisa',aisaEmpty:true});
 assert.equal(at(calls,'/fallback')?.body.actualCost,0.01);
 assert.ok(!calls.some(c=>new URL(c.url).hostname==='api.apify.com'));
});

test('backup autorizado usa somente saldo restante e soma o custo da AISA',async()=>{
 const {calls}=await runWorker({provider:'apify',priorCost:0.25,budget:1});
 assert.equal(new URL(at(calls,'/runs').url).searchParams.get('maxTotalChargeUsd'),'0.75');
 assert.equal(at(calls,'/complete').body.actualCost,0.32);
});
test('timeout da AISA mantém reserva e aguarda decisão sem executar backup',async()=>{
 const {calls}=await runWorker({provider:'aisa',aisaLost:true});
 const pending=at(calls,'/fallback').body;
 assert.equal(pending.reservedCost,1);assert.equal(pending.costUncertain,true);
 assert.ok(!calls.some(c=>new URL(c.url).hostname==='api.apify.com'));
});
test('erro de tarefa com HTTP 200 é falha da AISA e conserva custo relatado',async()=>{
 const {calls}=await runWorker({provider:'aisa',aisaTaskFails:true});
 assert.equal(at(calls,'/fallback').body.actualCost,0.01);
 assert.equal(at(calls,'/complete'),undefined);
});
