import {readFileSync,mkdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
const keys=JSON.parse(readFileSync('data/credentials.json','utf8'));
const r=await fetch((process.env.CRM_URL||'http://127.0.0.1:3080')+'/api/sales/settings',{headers:{Authorization:'Bearer '+keys.admin}});
if(!r.ok)throw Error('Inicie o servidor CRM antes do pareamento.');
const cfg=await r.json();mkdirSync(cfg.wacliStore,{recursive:true,mode:0o700});
const child=spawn(cfg.wacliBinary,['--store',cfg.wacliStore,'auth'],{shell:false,stdio:'inherit'});
child.once('error',()=>{console.error('wacli indisponível. Verifique o caminho em Vendas.');process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code||0;});
