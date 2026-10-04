export const DEFAULT_SALES={enabled:false,company:'MLLuiz DevTech',seller:'Hermes',offers:'',portfolio:'',conditions:'',timezone:'America/Sao_Paulo',startHour:9,endHour:18,dailyLimit:20,followupHours:48,maxFollowups:2,dailyBudgetUsd:0,monthlyBudgetUsd:0,budgetPeriod:'day',hermesIncluded:false,jevMaxCostUsd:0,hermesMaxCostUsd:0,emailEnabled:false,whatsappEnabled:false,replyTo:'',wacliBinary:'.tools/wacli-0.20.0/wacli',wacliAccount:'crm-vendas',wacliStore:'data/wacli-sales',hermesUrl:'http://127.0.0.1:8642'};
export function salesError(status,message){throw Object.assign(Error(message),{status});}
export function salesText(v,name,max=500,required=false){if(typeof v!=='string'||v.length>max||(required&&!v.trim()))salesError(400,'Campo inválido: '+name);return v.trim();}
export function validateSalesSettings(patch,old){
 const result={...old};
 for(const [k,v] of Object.entries(patch)){
  if(!Object.hasOwn(DEFAULT_SALES,k))salesError(400,'Configuração desconhecida: '+k);
  if(typeof DEFAULT_SALES[k]==='boolean'){if(typeof v!=='boolean')salesError(400,'Campo inválido: '+k);result[k]=v;}
  else if(typeof DEFAULT_SALES[k]==='number'){
   const bounds={startHour:[0,23],endHour:[1,24],dailyLimit:[0,500],followupHours:[1,720],maxFollowups:[0,10],dailyBudgetUsd:[0,1000],monthlyBudgetUsd:[0,1000],jevMaxCostUsd:[0,100],hermesMaxCostUsd:[0,100]};
   if(typeof v!=='number'||!Number.isFinite(v)||v<bounds[k][0]||v>bounds[k][1]||(['startHour','endHour','dailyLimit','maxFollowups'].includes(k)&&!Number.isInteger(v)))salesError(400,'Campo inválido: '+k);result[k]=v;
  }else result[k]=salesText(v,k,['offers','portfolio','conditions'].includes(k)?5000:500);
 }
 if(!['day','month'].includes(result.budgetPeriod))salesError(400,'Período do orçamento inválido.');
 if(result.startHour>=result.endHour)salesError(400,'Horário final deve ser posterior ao inicial.');
 try{new Intl.DateTimeFormat('pt-BR',{timeZone:result.timezone});}catch{salesError(400,'Fuso inválido.');}
 if(result.replyTo&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.replyTo))salesError(400,'Reply-To inválido.');
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(result.wacliAccount))salesError(400,'Conta wacli inválida.');
 let u;try{u=new URL(result.hermesUrl);}catch{salesError(400,'URL Hermes inválida.');}
 if(u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password)salesError(400,'Use API Hermes local sem credenciais na URL.');
 if(result.enabled&&(!result.offers||!result.company||(!result.emailEnabled&&!result.whatsappEnabled)||(result.budgetPeriod==='month'?result.monthlyBudgetUsd:result.dailyBudgetUsd)<=0||result.jevMaxCostUsd<=0||(!result.hermesIncluded&&result.hermesMaxCostUsd<=0)))salesError(400,'Preencha oferta, canais, orçamento e tetos antes de iniciar.');
 if(result.enabled&&result.emailEnabled&&!result.replyTo)salesError(400,'Configure o endereço de recebimento Reply-To antes de iniciar e-mail comercial.');
 return result;
}
export function salesRecipient(lead,channel,verified){
 if(!lead||lead.blocked)salesError(409,'Lead ausente ou bloqueado.');
 if(channel==='email'){if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email||''))salesError(400,'Lead sem e-mail válido.');return lead.email.toLowerCase();}
 if(channel!=='whatsapp')salesError(400,'Canal inválido.');
 if(verified!==true)salesError(400,'Confirme que o telefone é um canal WhatsApp verificado.');
 let phone=String(lead.phone||'').replace(/[()\s.-]/g,'');
 if(/^\d{10,11}$/.test(phone))phone='+55'+phone;
 if(/^55\d{10,11}$/.test(phone))phone='+'+phone;
 if(!/^\+[1-9]\d{9,14}$/.test(phone))salesError(400,'Telefone internacional inválido.');
 return phone;
}
export const SALES_TEMPLATES={
 inicio:'Olá! Sou {seller}, da {company}. Gostaria de entender como a {lead} atende clientes hoje. Vocês estão buscando melhorar o site ou automatizar alguma etapa do atendimento?',
 necessidade:'Qual é a principal dificuldade de vocês hoje e o que gostariam de melhorar primeiro?',
 detalhes:'Entendi. Pode me contar um pouco mais sobre essa necessidade e como vocês trabalham hoje?',
 reuniao:'Podemos conversar para entender o cenário e avaliar a melhor solução para vocês? Qual horário seria conveniente?',
 horario:'Perfeito! Qual horário seria mais conveniente para você: pela manhã ou no período da tarde?',
 confirmar:'Combinado! Já anotei aqui. Vou preparar as informações para nossa conversa.',
 duvida:'Desenvolvemos sites institucionais, landing pages e automações de atendimento para empresas. Qual dessas frentes vocês querem estruturar primeiro?',
 acompanhamento:'Olá! Retomando nossa conversa sobre a {lead}: ainda faz sentido conversarmos sobre as melhorias que vocês procuram?',
 encaminhar:'Obrigado por compartilhar. Vou preparar os detalhes para revisão e retorno com as condições aprovadas.'
};
export function requiresApproval(m){return !(['qualificar','responder','acompanhar'].includes(m.kind)&&Object.hasOwn(SALES_TEMPLATES,m.templateId)&&(!m.terms||Object.keys(m.terms).length===0));}
export function templateMessage(id,lead,cfg){
 if(!Object.hasOwn(SALES_TEMPLATES,id))salesError(400,'Template desconhecido.');
 // Dados de terceiros não entram como texto livre em uma mensagem automática.
 const clean=v=>String(v||'').replace(/[^\p{L}\p{N} &().-]/gu,'').slice(0,100);
 return SALES_TEMPLATES[id].replace(/\{(seller|company|lead)\}/g,(_,k)=>clean(k==='lead'?lead.name:cfg[k]));
}
export function withinSalesHours(cfg,date=new Date()){
 const h=Number(new Intl.DateTimeFormat('en-GB',{timeZone:cfg.timezone,hour:'numeric',hourCycle:'h23'}).format(date));return h>=cfg.startHour&&h<cfg.endHour;
}
export function salesDay(cfg,date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:cfg.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
