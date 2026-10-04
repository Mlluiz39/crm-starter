import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const mod=await import('../scripts/wacli-client.mjs').catch(()=>({}));
const reader=await import('../scripts/wacli-reader.mjs').catch(()=>({}));
test('wacli confirma aceite com ID e nunca presume entrega',async()=>{
 assert.equal(typeof mod.createWacliClient,'function');let args,options;
 const cli=mod.createWacliClient({binary:'fixture',store:'/tmp/fixture',execFileImpl:(b,a,o,cb)=>{args=a;options=o;cb(null,JSON.stringify({success:true,data:{sent:true,id:'real-id'}}),'');}});
 const result=await cli.send({recipient:'+5511999999999',body:'Olá $(echo teste)'});
 assert.deepEqual(result,{providerId:'real-id',status:'aceita'});assert.equal(options.shell,false);assert.ok(args.includes('Olá $(echo teste)'));assert.ok(args.includes('--no-preview'));
});
test('timeout e retorno sem ID são incertos e não repetem CLI',async()=>{
 assert.equal(typeof mod.createWacliClient,'function');let count=0;
 const cli=mod.createWacliClient({store:'/tmp/fixture',execFileImpl:(b,a,o,cb)=>{count++;cb(Object.assign(Error('timeout'),{killed:true}),'','');}});
 await assert.rejects(cli.send({recipient:'+5511999999999',body:'Olá'}),{outcome:'uncertain'});assert.equal(count,1);
 const invalid=mod.createWacliClient({store:'/tmp/fixture',execFileImpl:(b,a,o,cb)=>cb(null,'{"success":true,"data":{"sent":true}}','')});
 await assert.rejects(invalid.send({recipient:'+5511999999999',body:'Olá'}),{outcome:'uncertain'});
});
test('não autenticado é falha confirmada anterior ao envio',async()=>{
 assert.equal(typeof mod.createWacliClient,'function');
 const cli=mod.createWacliClient({store:'/tmp/fixture',execFileImpl:(b,a,o,cb)=>cb(Error('exit'),'',JSON.stringify({success:false,error:'not authenticated; run auth'}))});
 await assert.rejects(cli.send({recipient:'+5511999999999',body:'Olá'}),{outcome:'failed'});
});
test('leitura rowid não perde lote grande ou mensagens com mesmo timestamp',()=>{
 assert.equal(typeof reader.readWacliMessages,'function');const dir=mkdtempSync(path.join(tmpdir(),'wacli-reader-')),dbPath=path.join(dir,'wacli.db');
 const db=new DatabaseSync(dbPath);db.exec('PRAGMA journal_mode=WAL;CREATE TABLE messages(chat_jid TEXT,msg_id TEXT,sender_jid TEXT,ts INTEGER,from_me INTEGER,text TEXT,media_caption TEXT,revoked INTEGER,deleted_for_me INTEGER)');
 const add=db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)');for(let i=0;i<250;i++)add.run('5511999999999@s.whatsapp.net','m'+i,'5511999999999@s.whatsapp.net',1700000000,0,'Olá','',0,0);
 const a=reader.readWacliMessages({dbPath,afterRowid:0,limit:100}),b=reader.readWacliMessages({dbPath,afterRowid:a.cursor,limit:100}),c=reader.readWacliMessages({dbPath,afterRowid:b.cursor,limit:100});
 assert.equal(a.messages.length+b.messages.length+c.messages.length,250);assert.equal(c.cursor,250);
 assert.throws(()=>reader.readWacliMessages({dbPath,afterRowid:999,limit:100}),/cursor/i);db.close();rmSync(dir,{recursive:true,force:true});
});
