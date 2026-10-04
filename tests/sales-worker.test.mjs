import {test} from 'node:test';
import assert from 'node:assert/strict';
const worker=await import('../scripts/sales-worker.mjs').catch(()=>({}));
const jev=await import('../scripts/sales-decide.mjs').catch(()=>({}));
const hermes=await import('../scripts/hermes-sales.mjs').catch(()=>({}));
test('Jev usa endpoint documentado e rejeita resposta fora das opções',async()=>{
 assert.equal(typeof jev.decideSale,'function');let url,body;
 const context={lead:{name:'Empresa'},history:[],settings:{offers:'Sites'}};
 const r=await jev.decideSale(context,{key:'fixture',fetchImpl:async(u,o)=>{url=u;body=JSON.parse(o.body);return Response.json({id:'d',answers:{acao:{choice:'qualificar',confidence:.9},intencao:{choice:'indefinida'},objecao:{choice:'nenhuma'}},usage:{cost:.001}});}});
 assert.equal(url,'https://api.typesafe.ai/v1/systemone');assert.equal(body.model,'jev-1.13.0');assert.equal(body.questions.acao.type,'choice');assert.equal(r.action,'qualificar');
 await assert.rejects(jev.decideSale(context,{key:'fixture',fetchImpl:async()=>Response.json({answers:{acao:{choice:'send_money'}},usage:{cost:.001}})}),/inválida/);
});
test('Hermes recusa API com ferramentas de envio habilitadas antes de gerar texto',async()=>{
 assert.equal(typeof hermes.draftSale,'function');let posts=0;
 await assert.rejects(hermes.draftSale({settings:{},lead:{}},{url:'http://127.0.0.1:8642',key:'fixture',profile:{platform_toolsets:{api_server:['no_mcp']},mcp_servers:{},plugins:{}},fetchImpl:async(u,o)=>{if(o.method==='POST')posts++;return Response.json({data:[{enabled:true,tools:['send_message']}]});}}),/ferramentas/);
 assert.equal(posts,0);
});
test('Hermes gera JSON e resultado guarda custo não confirmado',async()=>{
 assert.equal(typeof hermes.draftSale,'function');let payload;
 const result=await hermes.draftSale({settings:{offers:'Site'},lead:{name:'Empresa'},decision:{action:'propor'}},{url:'http://127.0.0.1:8642',key:'fixture',profile:{platform_toolsets:{api_server:['no_mcp']},mcp_servers:{},plugins:{}},fetchImpl:async(u,o)=>{
  if(o.method!=='POST')return Response.json({data:[]});payload=JSON.parse(o.body);return Response.json({id:'h',choices:[{message:{content:'{"body":"Proposta para revisão","subject":"Site","terms":{}}'} }],usage:{}});
 }});
 assert.equal(payload.tool_choice,'none');assert.equal(result.costUsd,null);assert.equal(result.body,'Proposta para revisão');
});
function fixture(action='propor',decideError=false){
 const calls=[],settings={enabled:true,jevMaxCostUsd:.01,hermesMaxCostUsd:.02},context={settings,lead:{},conversation:{},history:[]};
 const api=async(method,p,b)=>{calls.push({method,p,b});if(p.endsWith('/state'))return {settings,conversations:[],messages:[]};if(p.endsWith('/claim'))return {task:{id:'t',leaseToken:'lease'},context};if(p.endsWith('/draft'))return {id:'m',status:action==='propor'?'aguardando_aprovacao':'pendente'};return {ok:true};};
 const decide=async()=>{calls.push({p:'DECIDE'});if(decideError)throw Error('timeout');return {action,confidence:.9,costUsd:.001,providerId:'j'};};
 const draft=async()=>{calls.push({p:'DRAFT'});return {body:'Proposta',terms:{},templateId:'inicio',costUsd:.002,providerId:'h'};};
 return {calls,api,decide,draft};
}
test('worker reserva antes de Jev/Hermes e proposta aguarda aprovação',async()=>{
 assert.equal(typeof worker.runSalesCycle,'function');const f=fixture();await worker.runSalesCycle(f);
 assert.ok(f.calls.findIndex(x=>x.b?.service==='jev')<f.calls.findIndex(x=>x.p==='DECIDE'));
 assert.ok(f.calls.findIndex(x=>x.b?.service==='hermes')<f.calls.findIndex(x=>x.p==='DRAFT'));
 assert.ok(!f.calls.some(x=>x.p.endsWith('/send')));assert.equal(f.calls.find(x=>x.p.endsWith('/draft')).b.kind,'propor');
});
test('worker pode enviar template de qualificação sem aprovação por mensagem',async()=>{
 assert.equal(typeof worker.runSalesCycle,'function');const f=fixture('qualificar');await worker.runSalesCycle(f);assert.ok(f.calls.some(x=>x.p.endsWith('/send')));
});
test('falha de Jev mantém reserva incerta e pausa atendimento',async()=>{
 assert.equal(typeof worker.runSalesCycle,'function');const f=fixture('qualificar',true);await worker.runSalesCycle(f);
 assert.equal(f.calls.find(x=>x.b?.settle)?.b.costUsd,null);assert.ok(f.calls.some(x=>x.p.endsWith('/fail')));assert.ok(!f.calls.some(x=>x.p==='DRAFT'));
});

test('TypeSafe sem custo informado conserva reserva, sem tratar tokens como dólares',async()=>{
 const r=await jev.decideSale({lead:{name:'Teste'},history:[],settings:{offers:'Sites'}},{key:'native-fixture',fetchImpl:async()=>Response.json({model:'jev-1.13.0',answers:{acao:{choice:'responder',confidence:.9},intencao:{choice:'duvida'},objecao:{choice:'nenhuma'}},usage:{input_tokens:100,output_tokens:10}})});
 assert.equal(r.costUsd,null);assert.equal(r.model,'jev-1.13.0');assert.equal(r.providerId,null);
});
test('Hermes aceita termos vazios de template automático e mantém revisão de propostas',async()=>{
 const context={settings:{},lead:{},decision:{action:'qualificar'}},opts={url:'http://127.0.0.1:8642',key:'fixture',profile:{platform_toolsets:{api_server:['no_mcp']},mcp_servers:{},plugins:{}},fetchImpl:async(u,o)=>Response.json(o.method==='POST'?{choices:[{message:{content:JSON.stringify({body:'Olá',subject:'',terms:'',templateId:'inicio'})}}],usage:{}}:{data:[]})};
 const result=await hermes.draftSale(context,opts);assert.deepEqual(result.terms,{});assert.equal(result.templateId,'inicio');
 await assert.rejects(hermes.draftSale({...context,decision:{action:'propor'}},opts),/inválido/);
});
test('Jev calcula custo por tokens da versão tarifada e não presume preço de versões desconhecidas',async()=>{
 const context={lead:{},history:[],settings:{offers:'Sites'}},answer={answers:{acao:{choice:'qualificar',confidence:.9},intencao:{choice:'indefinida'},objecao:{choice:'nenhuma'}},usage:{input_tokens:1000,output_tokens:500}};
 const r=await jev.decideSale(context,{key:'fixture',fetchImpl:async()=>Response.json({...answer,model:'jev-1.13.0'})});assert.equal(r.costUsd,null);assert.equal(r.costEstimateUsd,.000042);assert.equal(r.inputTokens,1000);
 const other=await jev.decideSale(context,{key:'fixture',fetchImpl:async()=>Response.json({...answer,model:'jev-2.0.0'})});assert.equal(other.costEstimateUsd,null);
});
test('worker registra tokens tarifados e não reserva dólares para Hermes incluído',async()=>{
 const f=fixture('qualificar'),original=f.api;
 f.api=async(...args)=>{const r=await original(...args);if(r.settings)r.settings.hermesIncluded=true;if(r.context)r.context.settings.hermesIncluded=true;return r;};
 f.decide=async()=>({action:'qualificar',confidence:.9,costUsd:null,costEstimateUsd:.000042,inputTokens:1000,pricingModel:'jev-1.13.0'});
 await worker.runSalesCycle(f);assert.equal(f.calls.find(x=>x.b?.service==='hermes').b.reserveUsd,0);assert.equal(f.calls.find(x=>x.b?.inputTokens===1000).b.costEstimateUsd,.000042);
});
test('IA globalmente pausada continua recebendo mensagens sob controle humano, sem decidir',async()=>{
 const calls=[];const api=async(method,p,b)=>{calls.push({p,b});return p.endsWith('/state')?{settings:{enabled:false},conversations:[{id:'c',control:'human'}],messages:[]}:{ok:true};};
 const result=await worker.runSalesCycle({api,readWhatsapp:async()=>[{providerId:'reply'}],decide:async()=>{throw Error('Não deve decidir');}});assert.equal(result.paused,true);assert.ok(calls.some(x=>x.p.endsWith('/inbound')));assert.ok(!calls.some(x=>x.p.endsWith('/claim')));
});
