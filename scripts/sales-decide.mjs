import {loadKey} from './enrich-decide.mjs';
const ACTIONS={qualificar:'Faltam informações sobre necessidade ou contexto da empresa.',responder:'O cliente trouxe uma dúvida e merece uma pergunta ou orientação informativa.',acompanhar:'Não houve resposta e um acompanhamento está autorizado.',propor:'Cliente interessado e dados suficientes para preparar uma proposta para aprovação humana.',fechar:'Cliente aceitou condições e é necessário preparar confirmação para aprovação humana.',pausar:'Recusa, pedido de não contato ou ausência de oportunidade.',humano:'Cliente irritado ou frustrado com a IA, pediu atendente humano, conflito ou exceção comercial.'};
const INTENTS={interesse:'Interesse explícito',duvida:'Pedido de informação',recusa:'Recusa ou não contato',aceite:'Aceitou proposta',indefinida:'Não há evidência suficiente'};
const OBJECTIONS={preco:'Preço ou orçamento',prazo:'Prazo',confianca:'Confiança ou evidências',necessidade:'Não vê necessidade',nenhuma:'Nenhuma objeção identificada',outra:'Outra objeção ou incerta'};

function detectPhraseContext(history, phrases){
 const latest=history?.filter(m=>m.direction==='inbound').at(-1);if(!latest?.body)return null;
 const raw=String(latest.body).trim(),lower=raw.toLowerCase(),words=lower.split(/\s+/).filter(Boolean);
 const isQuestion=raw.includes('?');
 const p=phrases||{};
 const inList=list=>Array.isArray(list)&&list.some(term=>lower.includes(term.toLowerCase()));
 const irritationTerms=['atendente','humano','pessoa real','robô','robo','inteligencia artificial','ia burra','mesma pergunta','já respondi','ja falei','ja disse','repetindo','não entendeu','nao entendeu','burro','chato','irritado','de novo','falar com alguém','falar com alguem','atendimento humano'];
 if(inList(p.irritado)||irritationTerms.some(term=>lower.includes(term)))return `Cliente demonstrou irritação, frustração com o atendimento da IA ou pediu contato humano: "${raw}". Ação OBRIGATÓRIA: humano.`;
 if(inList(p.recusa))return `Cliente indicou recusa ou desinteresse: "${raw}". Ação esperada: pausar.`;
 if(inList(p.duvidas)||(isQuestion&&words.length<=10))return `Cliente enviou uma dúvida ou pergunta sobre serviço/preço: "${raw}". Ação esperada: responder a dúvida.`;
 if(inList(p.aceite)||(words.length<=4&&inList(['sim','claro','pode ser','vamos','ok','topo','beleza'])))return `Cliente confirmou ou demonstrou aceite/interesse: "${raw}". Ação esperada: qualificar ou avançar.`;
 if(inList(p.qualificacao)||(words.length<=4&&!isQuestion))return `Cliente enviou resposta curta de contexto/necessidade: "${raw}". Ação esperada: qualificar ou responder, não ignorar.`;
 return null;
}

export async function decideSale(context,{key=loadKey('TYPESAFE_API_KEY'),fetchImpl=fetch}={}){
 if(!key)throw Object.assign(Error('Configure a chave Jev/TypeSafe em Integrações.'),{costUsd:0});
 const phraseHint=detectPhraseContext(context.history,context.phrases||context.settings?.phrases);
 const state={lead:context.lead,offers:context.settings.offers,conditions:context.settings.conditions,reason:context.task?.reason,history:context.history?.slice(-20).map(m=>({direction:m.direction,body:m.body.slice(0,1500),status:m.status})),...(phraseHint?{contextoRespostaCurta:phraseHint}:{})};
 const r=await fetchImpl('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'jev-1.13.0',state,questions:{acao:{type:'choice',instructions:'Qual a próxima ação comercial? Se o cliente demonstrar irritação, frustração com a IA ou pedir para falar com uma pessoa, escolha sempre "humano". Proposta e fechamento sempre precisam de aprovação humana. Qualificação e respostas normais avançam automaticamente.',criteria:ACTIONS},intencao:{type:'choice',instructions:'Qual a intenção explícita da última resposta do cliente?',criteria:INTENTS},objecao:{type:'choice',instructions:'Qual a objeção principal identificada?',criteria:OBJECTIONS}}}),signal:AbortSignal.timeout(45000)});
 if(!r.ok)throw Object.assign(Error(`Jev respondeu HTTP ${r.status}.`),{costUsd:[400,401,402,403,404,413,429].includes(r.status)?0:null});
 const data=await r.json(),a=data.answers||{},costUsd=typeof data.usage?.cost==='number'&&Number.isFinite(data.usage.cost)&&data.usage.cost>=0?data.usage.cost:null;
 const inputTokens=Number.isSafeInteger(data.usage?.input_tokens)&&data.usage.input_tokens>=0?data.usage.input_tokens:null;
 const pricingModel=data.model==='jev-1.13.0'?'jev-1.13.0':null;
 const costEstimateUsd=costUsd===null&&pricingModel&&inputTokens!==null?inputTokens*.042/1e6:null;
 if(!Object.hasOwn(ACTIONS,a.acao?.choice)||!Object.hasOwn(INTENTS,a.intencao?.choice)||!Object.hasOwn(OBJECTIONS,a.objecao?.choice))throw Object.assign(Error('Resposta Jev inválida.'),{costUsd,costEstimateUsd,inputTokens,pricingModel,providerId:data.id});
 const confidence=a.acao.confidence;
 if(confidence!==undefined&&(typeof confidence!=='number'||!Number.isFinite(confidence)||confidence<0||confidence>1))throw Object.assign(Error('Confiança Jev inválida.'),{costUsd,costEstimateUsd,inputTokens,pricingModel,providerId:data.id});
 return {action:a.acao.choice,intent:a.intencao.choice,objection:a.objecao.choice,confidence:confidence??null,costUsd,costEstimateUsd,inputTokens,pricingModel,providerId:data.id||null,model:data.model||'jev-latest'};
}
