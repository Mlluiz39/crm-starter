import path from 'node:path';
import {createSalesEmailClient} from './sales-email.mjs';
import {readWacliMessages} from './wacli-reader.mjs';
import {loadKey} from './enrich-decide.mjs';
const mailbox=v=>String(v||'').match(/<([^>]+)>/)?.[1]?.toLowerCase()||String(v||'').trim().toLowerCase();
export async function recoverSalesInbound({api,state,emailClient=createSalesEmailClient({key:loadKey('RESEND_API_KEY')})}){
 const cfg=state.settings;
 if(cfg.whatsappEnabled&&state.conversations.some(c=>c.channel==='whatsapp')){
  const account=cfg.wacliAccount,id='whatsapp-'+account,saved=await api('GET','/api/agent/sales/cursors/'+encodeURIComponent(id));
  let cursor=saved.rowid||0,fingerprint=saved.fingerprint,more;
  do{
   const batch=readWacliMessages({dbPath:path.join(cfg.wacliStore,'wacli.db'),afterRowid:cursor,fingerprint,limit:500});
   for(const event of batch.messages)if(state.conversations.some(c=>c.channel==='whatsapp'&&c.recipient===event.sender))await api('POST','/api/agent/sales/inbound',{...event,account});
   cursor=batch.cursor;fingerprint=batch.fingerprint;more=batch.hasMore;await api('POST','/api/agent/sales/cursors/'+encodeURIComponent(id),{rowid:cursor,fingerprint});
  }while(more);
 }
 if(cfg.emailEnabled&&cfg.replyTo){
  const id='email-resend',saved=await api('GET','/api/agent/sales/cursors/'+id);let after,head,finished=false;const pending=[];
  do{
   const page=await emailClient.listReceived({after});if(!Array.isArray(page.data))throw Error('Lista de e-mails inválida.');head=head||page.data[0]?.id;
   for(const e of page.data){
    if(e.id===saved.head){finished=true;break;}
    if(!(e.to||[]).some(x=>mailbox(x)===cfg.replyTo.toLowerCase()))continue;
    const sender=mailbox(e.from);if(!state.conversations.some(c=>c.channel==='email'&&c.recipient===sender))continue;
    pending.push({...e,sender});
   }
   after=page.data.at(-1)?.id;if(!page.has_more||!after)finished=true;
  }while(!finished);
  pending.sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
  for(const e of pending){const full=await emailClient.getReceived(e.id);if(typeof full.text==='string'&&full.text.trim())await api('POST','/api/agent/sales/inbound',{channel:'email',account:'resend',providerId:e.id,sender:e.sender,recipient:cfg.replyTo,body:full.text.slice(0,10000),receivedAt:e.created_at,threadId:full.message_id});}
  if(head)await api('POST','/api/agent/sales/cursors/'+id,{head});
 }
}
