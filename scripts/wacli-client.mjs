import {execFile} from 'node:child_process';
function failure(outcome,safeMessage){return Object.assign(Error(safeMessage),{outcome,safeMessage});}
export function parseSendResult(v){if(v?.success!==true||v.data?.sent!==true||typeof v.data.id!=='string'||!v.data.id||v.data.id.length>200)throw failure('uncertain','wacli não confirmou ID do envio.');return {providerId:v.data.id,status:'aceita'};}
export function createWacliClient({binary='wacli',account='crm-vendas',store='',execFileImpl=execFile}={}){
 if(!/^[A-Za-z0-9_-]{1,64}$/.test(account))throw failure('failed','Conta wacli inválida.');
 const prefix=store?['--store',store]:['--account',account];
 async function run(args,{readOnly=false,timeout=20000}={}){
  const result=await new Promise(resolve=>execFileImpl(binary,[...prefix,'--json','--timeout','15s',...(readOnly?['--read-only']:[]),...args],{shell:false,timeout,maxBuffer:1024*1024,encoding:'utf8',windowsHide:true},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
  let data;try{data=JSON.parse(result.stdout);}catch{}
  if(result.error){
   let e;try{e=JSON.parse(result.stderr);}catch{}
   const preflight=e?.success===false&&typeof e.error==='string'&&/not authenticated|read-only mode|invalid recipient/i.test(e.error);
   throw failure(preflight||result.error.code==='ENOENT'?'failed':'uncertain',preflight?'wacli não autenticado ou destinatário inválido.':result.error.code==='ENOENT'?'wacli não instalado.':'Resultado wacli não confirmado.');
  }
  if(!data||data.success!==true)throw failure('uncertain','Resposta wacli inválida.');return data;
 }
 return {
  async send({recipient,body}){if(!/^\+[1-9]\d{9,14}$/.test(recipient)||typeof body!=='string'||!body.trim()||body.length>8000)throw failure('failed','Destinatário ou mensagem inválidos.');return parseSendResult(await run(['send','text','--to',recipient,'--message',body,'--no-preview']));},
  async presence({recipient,typing=true}){if(!/^\+[1-9]\d{9,14}$/.test(recipient))return false;try{await run(['presence',typing?'typing':'paused','--to',recipient],{timeout:5000});return true;}catch{return false;}},
  async health(){
   try{
    const version=await new Promise(resolve=>execFileImpl(binary,['--version'],{shell:false,timeout:3000,maxBuffer:1024,encoding:'utf8'},(e,out)=>resolve(e?'':out.trim())));
    if(version!=='wacli 0.20.0')return {installed:!!version,authenticated:false,connected:false,version:version.slice(0,60),error:version?'Use wacli 0.20.0 validado.':'wacli não instalado.'};
    const v=(await run(['doctor'],{readOnly:true})).data;
    return {installed:true,version,authenticated:v?.authenticated===true&&!v?.session_revoked,connected:v?.connected===true,connectionState:v?.connection_state||'desconhecido'};
   }catch(e){return {installed:true,authenticated:false,connected:false,error:e.safeMessage||'wacli indisponível.'};}
  },
  async listMessages({chat,after,limit=100}){if(!/^\d+@s\.whatsapp\.net$/.test(chat))throw failure('failed','Chat privado inválido.');return (await run(['messages','list','--chat',chat,'--after',after,'--asc','--from-them','--limit',String(Math.min(500,limit))],{readOnly:true})).data;}
 };
}
