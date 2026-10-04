import {DatabaseSync} from 'node:sqlite';
import {statSync} from 'node:fs';
import path from 'node:path';
export function readWacliMessages({dbPath,afterRowid=0,limit=100,fingerprint}){
 if(path.basename(dbPath)!=='wacli.db')throw Error('A recuperação lê somente wacli.db.');
 if(!Number.isSafeInteger(afterRowid)||afterRowid<0||!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Cursor/limite inválido.');
 const stat=statSync(dbPath),currentFingerprint=`${stat.dev}:${stat.ino}`;
 if(fingerprint&&fingerprint!==currentFingerprint)throw Error('Banco wacli mudou; revise o cursor.');
 const db=new DatabaseSync(dbPath,{readOnly:true});
 try{
  db.exec('PRAGMA query_only=ON;PRAGMA busy_timeout=1000;');
  const columns=new Set(db.prepare('PRAGMA table_info(messages)').all().map(x=>x.name));
  const required=['chat_jid','msg_id','sender_jid','ts','from_me','text','media_caption','revoked','deleted_for_me'];
  if(required.some(x=>!columns.has(x)))throw Error('Schema wacli incompatível com a versão validada.');
  const max=db.prepare('SELECT COALESCE(MAX(rowid),0) AS n FROM messages').get().n;
  if(afterRowid>max)throw Error('Cursor wacli excede o banco; revisão necessária.');
  const rows=db.prepare('SELECT rowid AS cursor,chat_jid,msg_id,sender_jid,ts,from_me,text,media_caption,revoked,deleted_for_me FROM messages WHERE rowid>? ORDER BY rowid LIMIT ?').all(afterRowid,limit);
  const messages=rows.filter(r=>!r.from_me&&!r.revoked&&!r.deleted_for_me&&/^\d+@s\.whatsapp\.net$/.test(r.chat_jid)&&(r.text||r.media_caption)).map(r=>({providerId:r.msg_id,sender:'+'+r.chat_jid.split('@')[0],body:(r.text||r.media_caption).slice(0,10000),receivedAt:new Date(r.ts*1000).toISOString(),channel:'whatsapp',fromMe:false}));
  return {messages,cursor:rows.at(-1)?.cursor??afterRowid,fingerprint:currentFingerprint,hasMore:rows.length===limit};
 }finally{db.close();}
}
