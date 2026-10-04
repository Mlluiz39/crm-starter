// Cliente de referência para ser executado como ferramenta pelo Hermes.
// Não consulta AISA/Jev nem faz envio externo.
import {readFileSync} from 'node:fs';
const [command,idOrFile,maybeFile]=process.argv.slice(2);
const routes={
 claim:()=>['/api/agent/jobs/claim',{}],
 complete:()=>['/api/agent/jobs/'+encodeURIComponent(idOrFile)+'/complete',read(maybeFile)],
 fail:()=>['/api/agent/jobs/'+encodeURIComponent(idOrFile)+'/fail',read(maybeFile)],
 decision:()=>['/api/agent/decisions',read(idOrFile)],
 campaign:()=>['/api/campaigns',read(idOrFile)],
 submit:()=>['/api/campaigns/'+encodeURIComponent(idOrFile)+'/submit',{}],
};
function read(file){if(!file)throw Error('Informe um arquivo JSON.');return JSON.parse(readFileSync(file,'utf8'));}
try{
 if(!routes[command])throw Error('Uso: node scripts/hermes-client.mjs claim | complete ID arquivo.json | fail ID arquivo.json | decision arquivo.json | campaign arquivo.json | submit ID');
 const base=new URL(process.env.CRM_URL||'http://127.0.0.1:3080');
 if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw Error('Use HTTPS fora do localhost.');
 const token=process.env.CRM_AGENT_TOKEN;if(!token)throw Error('Configure CRM_AGENT_TOKEN no ambiente.');
 const [p,b]=routes[command]();
 const response=await fetch(new URL(p,base),{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(b)});
 const result=await response.json();if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);
 console.log(JSON.stringify(result,null,2));
}catch(e){console.error(e.message);process.exitCode=1;}
