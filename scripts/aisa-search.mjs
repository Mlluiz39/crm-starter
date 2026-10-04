/** Busca principal: Google Maps via AISA, com limite de preço no gateway MCP. */
import { loadKey } from './enrich-decide.mjs';

const MCP_URL='https://mcp.aisa.one/mcp';
const OPERATION='post_dataforseo_serp_google_maps_live';
const httpUrl=value=>{
  try {const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';} catch {return '';}
};
function decodeRpc(raw) {
  try {return JSON.parse(raw);} catch {}
  // Streamable HTTP pode devolver JSON ou eventos SSE.
  for(const event of raw.split(/\r?\n\r?\n/)) {
    const data=event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');
    if(!data) continue;
    try {const parsed=JSON.parse(data);if(parsed.result||parsed.error)return parsed;} catch {}
  }
  throw Error('AISA devolveu uma resposta MCP inválida.');
}
function createMcpClient(key){
  let session='',id=0;
  async function rpc(method,params,notification=false){
    const r=await fetch(MCP_URL,{
      method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','User-Agent':'crm-starter/1.0',...(session?{'Mcp-Session-Id':session,'MCP-Protocol-Version':'2025-03-26'}:{})},
      body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id:++id}),method,params}),signal:AbortSignal.timeout(60000),
    });
    session=r.headers.get('mcp-session-id')||session;
    if(!r.ok)throw Object.assign(Error(`AISA respondeu HTTP ${r.status}.`),{confirmedNoCharge:[401,403,402].includes(r.status)});
    if(notification){await r.text();return;}
    const result=decodeRpc(await r.text());
    if(result.error)throw Error(String(result.error.message||'Erro MCP da AISA.'));
    return result.result;
  }
  return {
    rpc,
    async initialize(){
      await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'crm-starter',version:'0.1.0'}});
      await rpc('notifications/initialized',{},true);
    },
    async close(){
      if(!session)return;
      try {await fetch(MCP_URL,{method:'DELETE',headers:{Authorization:`Bearer ${key}`,'Mcp-Session-Id':session,'MCP-Protocol-Version':'2025-03-26'},signal:AbortSignal.timeout(5000)});} catch {}
    },
  };
}
function toolResult(reply){
  let result=reply?.structuredContent;
  if(!result){
    const text=(reply?.content||[]).find(c=>c.type==='text')?.text;
    if(text){try {result=JSON.parse(text);} catch {}}
  }
  if(reply?.isError||!result)throw Error('AISA não confirmou o resultado da operação.');
  return result;
}
export async function searchAisaPlaces({niche,city,limit,budget}) {
  let paidAttempt=false,actualCost=0,costUncertain=false,runId='';
  const key=loadKey('AISA_API_KEY'),client=createMcpClient(key);
  try {
    if(!key)throw Error('Chave da AISA não configurada.');
    if(!Number.isFinite(budget)||budget<=0)throw Error('Orçamento zero: a busca na AISA é cobrada.');
    if(!Number.isInteger(limit)||limit<1||limit>30)throw Error('Limite de leads inválido.');
    await client.initialize();
    paidAttempt=true;costUncertain=true;
    const reply=await client.rpc('tools/call',{name:'use',arguments:{operation_id:OPERATION,
      arguments:{body:[{keyword:`${niche} ${city}`.trim(),location_name:loadKey('AISA_LOCATION_NAME')||'Brazil',language_code:'pt',depth:limit}]},
      max_price_usd:budget,
    }});
    const result=toolResult(reply);
    if(result.successful===false) {
      costUncertain=![400,401,402,403,429].includes(Number(result.error?.status));
      throw Error(String(result.error?.message||'AISA recusou a busca.').slice(0,500));
    }
    const data=result.data;
    if(typeof data?.cost==='number'&&Number.isFinite(data.cost)&&data.cost>=0) {
      actualCost=data.cost;costUncertain=false;
    }
    const task=data?.tasks?.[0];runId=typeof task?.id==='string'?task.id:'';
    if(data?.status_code!==20000||task?.status_code!==20000)throw Error(String(task?.status_message||data?.status_message||'AISA não retornou uma tarefa concluída.').slice(0,500));
    const items=(task.result||[]).flatMap(r=>Array.isArray(r.items)?r.items:[]);
    const leads=items.filter(it=>it.type==='maps_search'&&typeof it.title==='string'&&it.title.trim()).map(it=>{
      const website=httpUrl(it.url);
      const source=it.place_id?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(it.title)}&query_place_id=${encodeURIComponent(it.place_id)}`:website;
      return {
        name:it.title.trim().slice(0,180),segment:String(it.category||niche).slice(0,100),city:String(it.address_info?.city||city).slice(0,120),
        phone:String(it.phone||'').slice(0,40),website,email:'',contact:'',
        notes:[it.address,typeof it.rating?.value==='number'?`Nota ${it.rating.value} no Google`:''].filter(Boolean).join(' · ').slice(0,5000),
        sources:source?[{url:source}]:[],
      };
    }).filter(l=>l.sources.length).slice(0,limit);
    return {leads,actualCost,costUncertain,runId};
  } catch(error) {
    if(error.confirmedNoCharge)costUncertain=false;
    error.actualCost=actualCost;error.costUncertain=paidAttempt&&costUncertain;error.runId=runId;
    throw error;
  } finally {await client.close();}
}

/** Teste gratuito de autenticação e contrato, sem executar a operação paga. */
export async function testAisaConnection(key) {
  const client=createMcpClient(key);
  try {
    await client.initialize();
    // with_quote autentica e consulta preço, sem executar a busca paga.
    const result=toolResult(await client.rpc('tools/call',{name:'get_details',arguments:{operation_id:OPERATION,with_quote:true,
      arguments:{body:[{keyword:'academias São Paulo, SP',location_name:'Brazil',language_code:'pt',depth:5}]},
    }}));
    if(result.successful!==true||result.price?.model!=='quoted')throw Error('AISA não confirmou a chave e a cotação.');
    return 'AISA autenticada. Contrato de busca e cotação verificados sem executar pesquisa paga.';
  } finally {await client.close();}
}
