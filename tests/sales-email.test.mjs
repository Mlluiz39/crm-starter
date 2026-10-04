import {test} from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../scripts/sales-email.mjs').catch(()=>({}));
test('Resend envia com idempotência e Reply-To para receber resposta',async()=>{
 assert.equal(typeof mod.createSalesEmailClient,'function');let options;
 const c=mod.createSalesEmailClient({key:'fixture',fetchImpl:async(u,o)=>{options=o;return Response.json({id:'resend-id'});}});
 const r=await c.send({id:'outbox-id',deliveryRecipient:'real@example.com',from:'sales@example.com',subject:'Olá',body:'Texto',replyTo:'reply@example.com'});
 assert.equal(r.status,'aceita');assert.equal(options.headers['Idempotency-Key'],'outbox-id');assert.equal(JSON.parse(options.body).reply_to,'reply@example.com');
});
test('Resend 5xx mantém envio incerto; 422 é falha confirmada',async()=>{
 assert.equal(typeof mod.createSalesEmailClient,'function');
 for(const status of [503,422]){const c=mod.createSalesEmailClient({key:'fixture',fetchImpl:async()=>Response.json({message:'erro'},{status})});await assert.rejects(c.send({id:'m',deliveryRecipient:'a@example.com',subject:'S',body:'T'}),{outcome:status===422?'failed':'uncertain'});}
});
test('recebimento pagina e retorna IDs para recuperação persistente',async()=>{
 assert.equal(typeof mod.createSalesEmailClient,'function');let url;
 const c=mod.createSalesEmailClient({key:'fixture',fetchImpl:async u=>{url=new URL(u);return Response.json({data:[{id:'a'}],has_more:true});}});
 const r=await c.listReceived({after:'previous'});assert.equal(url.searchParams.get('after'),'previous');assert.equal(r.has_more,true);
});
