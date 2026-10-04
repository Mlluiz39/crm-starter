import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchAisaPlaces,testAisaConnection} from '../scripts/aisa-search.mjs';

async function withNetwork(fn,run){
 const original=globalThis.fetch,old=process.env.AISA_API_KEY;
 globalThis.fetch=fn;process.env.AISA_API_KEY='fixture-only-key';
 try {return await run();} finally {globalThis.fetch=original;if(old===undefined)delete process.env.AISA_API_KEY;else process.env.AISA_API_KEY=old;}
}
const response=result=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,result}),{headers:{'Content-Type':'application/json','Mcp-Session-Id':'session-fixture'}});
function network(tool){
 return async(u,o)=>{
  assert.equal(new URL(u).hostname,'mcp.aisa.one');
  if(o.method==='DELETE')return new Response(null,{status:204});
  const b=JSON.parse(o.body);
  if(b.method==='initialize')return response({serverInfo:{name:'fixture',version:'1'},protocolVersion:'2025-03-26',capabilities:{}});
  if(b.method==='notifications/initialized')return new Response(null,{status:202});
  return tool(b);
 };
}
test('teste de conexão usa cotação gratuita e nunca executa use',async()=>{
 let quoted=false;
 await withNetwork(network(b=>{
  assert.equal(b.params.name,'get_details');assert.equal(b.params.arguments.with_quote,true);quoted=true;
  return response({structuredContent:{successful:true,price:{model:'quoted',amount_usd:0.004}}});
 }),async()=>{assert.match(await testAisaConnection('fixture-only-key'),/autenticada/);assert.equal(quoted,true);});
});
test('AISA aceita SSE e resultado JSON em content; ignora resultados sem fonte',async()=>{
 await withNetwork(network(b=>{
  assert.equal(b.params.arguments.max_price_usd,0.5);
  const data={status_code:20000,cost:0.004,tasks:[{id:'task-fixture',status_code:20000,result:[{items:[
   {type:'maps_search',title:'Empresa com fonte',place_id:'place-fixture',phone:'+5511999999999',url:'https://example.com'},
   {type:'maps_search',title:'Sem fonte'},
   {type:'maps_search',title:'URL insegura',url:'javascript:alert(1)'},
  ]}]}]};
  const rpc={jsonrpc:'2.0',id:b.id,result:{content:[{type:'text',text:JSON.stringify({successful:true,data})}]}};
  return new Response('event: message\ndata: '+JSON.stringify(rpc)+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
 }),async()=>{
  const r=await searchAisaPlaces({niche:'Lojas',city:'São Paulo, SP',limit:5,budget:0.5});
  assert.equal(r.leads.length,1);assert.equal(r.leads[0].phone,'+5511999999999');assert.equal(r.actualCost,0.004);
  assert.ok(r.leads[0].sources[0].url.includes('place-fixture'));
 });
});
test('busca sem custo confirmado conserva estado incerto',async()=>{
 await withNetwork(network(()=>response({structuredContent:{successful:true,data:{status_code:20000,tasks:[{status_code:20000,result:[{items:[]}]}]}}})),async()=>{
  const r=await searchAisaPlaces({niche:'Lojas',city:'SP',limit:5,budget:1});assert.equal(r.costUncertain,true);
 });
});
test('erro 5xx no router conserva incerteza de cobrança',async()=>{
 await withNetwork(network(()=>response({structuredContent:{successful:false,error:{status:503,message:'Indisponível'}}})),async()=>{
  await assert.rejects(searchAisaPlaces({niche:'Lojas',city:'SP',limit:5,budget:1}),e=>e.costUncertain===true&&/Indisponível/.test(e.message));
 });
});
