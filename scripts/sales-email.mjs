function error(outcome,message){return Object.assign(Error(message),{outcome,safeMessage:message});}
export function createSalesEmailClient({key,baseUrl='https://api.resend.com',fetchImpl=fetch}={}){
 async function request(route,{method='GET',body,headers={}}={}){
  if(!key)throw error('failed','Configure a chave Resend.');
  const r=await fetchImpl(baseUrl+route,{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  let data;try{data=await r.json();}catch{throw error('uncertain','Resposta Resend não confirmada.');}
  if(!r.ok)throw error(r.status>=400&&r.status<500&&![408,409].includes(r.status)?'failed':'uncertain',`Resend respondeu HTTP ${r.status}.`);return data;
 }
 return {
  async send(m){
   const body={from:m.fromName?`${m.fromName} <${m.from}>`:m.from,to:[m.deliveryRecipient],subject:m.subject,text:m.body,...(m.replyTo?{reply_to:m.replyTo}:{})};
   if(m.inReplyTo)body.headers={'In-Reply-To':m.inReplyTo,References:m.inReplyTo};
   const r=await request('/emails',{method:'POST',headers:{'Idempotency-Key':m.id},body});if(typeof r.id!=='string'||!r.id)throw error('uncertain','Resend não retornou ID.');return {providerId:r.id,status:'aceita'};
  },
  listReceived:({after}={})=>request('/emails/receiving?limit=100'+(after?'&after='+encodeURIComponent(after):'')),
  getReceived:id=>request('/emails/receiving/'+encodeURIComponent(id))
 };
}
