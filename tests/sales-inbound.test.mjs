import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoverSalesInbound} from '../scripts/sales-inbound.mjs';
test('polling aplica respostas na ordem cronológica e salva cursor após importação',async()=>{
 const events=[],calls=[];
 const api=async(method,p,b)=>{calls.push({method,p,b});if(method==='GET')return {};if(p.endsWith('/inbound'))events.push(b);return {};};
 const state={settings:{emailEnabled:true,replyTo:'reply@example.com'},conversations:[{channel:'email',recipient:'lead@example.com'}]};
 const emailClient={listReceived:async()=>({has_more:false,data:[{id:'new',from:'lead@example.com',to:['reply@example.com'],created_at:'2026-10-03T12:00:00Z'},{id:'old',from:'lead@example.com',to:['reply@example.com'],created_at:'2026-10-03T11:00:00Z'}]}),getReceived:async id=>({text:id,message_id:'<'+id+'>'})};
 await recoverSalesInbound({api,state,emailClient});assert.deepEqual(events.map(e=>e.providerId),['old','new']);assert.equal(calls.at(-1).b.head,'new');
});
test('falha de importação não avança cursor e permite recuperar depois',async()=>{
 let cursor=false;const api=async(method,p,b)=>{if(method==='GET')return {};if(p.endsWith('/inbound'))throw Error('CRM offline');cursor=true;};
 const state={settings:{emailEnabled:true,replyTo:'reply@example.com'},conversations:[{channel:'email',recipient:'lead@example.com'}]};
 const emailClient={listReceived:async()=>({has_more:false,data:[{id:'one',from:'lead@example.com',to:['reply@example.com'],created_at:'2026-10-03T12:00:00Z'}]}),getReceived:async()=>({text:'Olá'})};
 await assert.rejects(recoverSalesInbound({api,state,emailClient}),/offline/);assert.equal(cursor,false);
});
