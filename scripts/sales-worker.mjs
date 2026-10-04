import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadKey} from './enrich-decide.mjs';
import {decideSale} from './sales-decide.mjs';
import {draftSale,salesHermesProfile,inspectHermes} from './hermes-sales.mjs';
import {recoverSalesInbound} from './sales-inbound.mjs';
export async function runSalesCycle({api,decide=decideSale,draft,readWhatsapp,readEmail,prepare}={}){
 const state=await api('GET','/api/agent/sales/state');
 const receiving=state.settings.enabled||state.conversations?.some(c=>c.control==='human'&&!['ganho','perdido'].includes(c.status));
 if(receiving)for(const read of [readWhatsapp,readEmail])if(read)for(const event of await read(state))await api('POST','/api/agent/sales/inbound',event);
 if(!state.settings.enabled)return {paused:true};
 if(prepare)await prepare(state);
 for(const m of state.messages.filter(m=>m.direction==='outbound'&&['pendente','aprovada'].includes(m.status)))try{await api('POST',`/api/agent/sales/messages/${m.id}/send`,{});}catch(e){if(e.status!==409)throw e;}
 const {task,context}=await api('POST','/api/agent/sales/tasks/claim',{});if(!task)return {idle:true};
 let reserved=false;
 const progress=b=>api('POST',`/api/agent/sales/tasks/${task.id}/progress`,{leaseToken:task.leaseToken,...b});
 async function call(service,fn,decision){
  await progress({service,reserveUsd:service==='hermes'&&context.settings.hermesIncluded?0:context.settings[service+'MaxCostUsd']});reserved=true;
  const v=await fn();await progress({settle:true,costUsd:v.costUsd??null,providerId:v.providerId,costEstimateUsd:v.costEstimateUsd,inputTokens:v.inputTokens,pricingModel:v.pricingModel,...(decision?{decision:v}:{})});reserved=false;return v;
 }
 const isWhatsapp=context.conversation?.channel==='whatsapp';
 const typingPing=isWhatsapp?setInterval(()=>{api('POST',`/api/agent/sales/conversations/${context.conversation.id}/presence`,{typing:true}).catch(()=>{});},6000):null;
 try{
  const decision=await call('jev',()=>decide(context),true);
  let kind=decision.action;
  const isRetomada=task.reason==='retomada';
  const minConf=Number.isFinite(context.settings?.minConfidence)?context.settings.minConfidence:0.4;
  if(!isRetomada&&(!Number.isFinite(decision.confidence)||decision.confidence<minConf))kind='humano';
  if(['humano','pausar'].includes(kind)){await api('POST',`/api/agent/sales/tasks/${task.id}/draft`,{leaseToken:task.leaseToken,kind,body:'Jev solicitou pausa ou revisão humana.'});return {review:true};}
  const message=await call('hermes',()=>draft({...context,decision}));
  const result=await api('POST',`/api/agent/sales/tasks/${task.id}/draft`,{leaseToken:task.leaseToken,kind,...message});
  if(result.status==='pendente')await api('POST',`/api/agent/sales/messages/${result.id}/send`,{});
  return {status:result.status};
 }catch(e){
  if(reserved)try{await progress({settle:true,costUsd:e.costUsd??null,providerId:e.providerId,costEstimateUsd:e.costEstimateUsd,inputTokens:e.inputTokens,pricingModel:e.pricingModel});}catch{}
  try{await api('POST',`/api/agent/sales/tasks/${task.id}/fail`,{leaseToken:task.leaseToken,error:String(e.message).slice(0,1000)});}catch{}
  return {error:e.message};
 }finally{
  if(typingPing)clearInterval(typingPing);
  if(isWhatsapp)try{await api('POST',`/api/agent/sales/conversations/${context.conversation.id}/presence`,{typing:false});}catch{}
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const base=process.env.CRM_URL||'http://127.0.0.1:3080',token=process.env.CRM_AGENT_TOKEN;
 if(!token)throw Error('Configure CRM_AGENT_TOKEN.');
 const api=async(method,route,b)=>{const r=await fetch(new URL(route,base),{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:b===undefined?undefined:JSON.stringify(b),signal:AbortSignal.timeout(60000)});const v=await r.json();if(!r.ok)throw Object.assign(Error(v.error||'Falha CRM'),{status:r.status});return v;};
 const cycle=async()=>{
  try{
   const s=await api('GET','/api/agent/sales/state');
   if(s.settings.enabled||s.conversations.some(c=>c.control==='human'&&!['ganho','perdido'].includes(c.status)))await recoverSalesInbound({api,state:s});
   const result=await runSalesCycle({api,decide:decideSale,draft:c=>{const p=salesHermesProfile();return draftSale(c,{...p,url:c.settings.hermesUrl});},prepare:async(state)=>{if(!loadKey('TYPESAFE_API_KEY'))throw Error('Configure Jev/TypeSafe em Integrações.');const p=salesHermesProfile();await inspectHermes({...p,url:state.settings.hermesUrl});}});
   await api('POST','/api/agent/sales/heartbeat',{status:result.error?'erro':result.paused?'pausado':'ativo',error:result.error||''});console.log('Ciclo comercial:',result.error?'erro: '+result.error:result.paused?'pausado':'concluído');
  }catch(e){try{await api('POST','/api/agent/sales/heartbeat',{status:'erro',error:String(e.message).slice(0,500)});}catch{}console.error('Ciclo comercial indisponível:',e.message);}
 };
 do{await cycle();if(process.argv.includes('--once'))break;await new Promise(r=>setTimeout(r,Number(process.env.SALES_POLL_MS||5000)));}while(true);
}
