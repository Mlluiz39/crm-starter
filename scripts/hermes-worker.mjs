#!/usr/bin/env node
/**
 * Worker de Prospecção — Integração Hermes → CRM
 * 
 * Ciclo: claim → reserva de custos → AISA (Apify após ativação no painel) → complete
 * 
 * Uso:
 *   node scripts/hermes-worker.mjs [--once] [--verbose]
 * 
 * Variáveis de ambiente:
 *   CRM_URL         — URL do servidor CRM (padrão: http://127.0.0.1:3080)
 *   CRM_AGENT_TOKEN — Token do agente (obrigatório)
 *   WORKER_INTERVAL — Intervalo entre ciclos em ms (padrão: 60000)
 */

import { searchAisaPlaces } from './aisa-search.mjs';
import { searchPlaces, estimateCost } from './apify-search.mjs';
import { enrichLead, decideLead, loadKey } from './enrich-decide.mjs';

// ─── Configuração ────────────────────────────────────────────────────────────

const CRM_URL = process.env.CRM_URL || 'http://127.0.0.1:3080';
const CRM_AGENT_TOKEN = process.env.CRM_AGENT_TOKEN;
const WORKER_INTERVAL = Number(process.env.WORKER_INTERVAL || 60000);
const MAX_LEADS_PER_JOB = 30;

if (!CRM_AGENT_TOKEN) {
  console.error('❌ Configure CRM_AGENT_TOKEN no ambiente.');
  process.exit(1);
}

// ─── Cliente HTTP ─────────────────────────────────────────────────────────────

async function api(method, path, body = null) {
  const url = new URL(path, CRM_URL);
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${CRM_AGENT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  };
  if (body) options.body = JSON.stringify(body);
  
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── Pesquisa de Empresas ────────────────────────────────────────────────────

/**
 * Pesquisa empresas reais via Apify (Google Maps Scraper).
 * Nunca fabrica resultados: se a Apify falhar, o job é marcado como falha.
 */
async function pesquisarEmpresas(niche, city, limit, budget) {
  return searchPlaces({ niche, city, limit, budget });
}

// ─── Ciclo Principal ─────────────────────────────────────────────────────────

async function processarJob(job) {
  console.log(`\n📋 Processando job ${job.id}: ${job.niche} em ${job.city}`);
  const source=job.searchProvider||'aisa';
  let actualCost=job.actualCost||0,reservedCost=job.reservedCost||0,providerRunId=job.providerRunId||'',completed=false,budgetStopped=false,searching=false;
  const priorCost=actualCost,priorReserved=reservedCost;
  const warnings=[...(job.warnings||[])];
  const rounded=v=>Number(v.toFixed(6));
  const costs=()=>({actualCost:rounded(actualCost),reservedCost:rounded(reservedCost),costUncertain:reservedCost>0,providerRunId,warnings});
  const progress=()=>api('POST',`/api/agent/jobs/${job.id}/progress`,{leaseToken:job.leaseToken,...costs()});
  const warn=message=>{warnings.push(message);console.log(`   · ${message}`);};
  async function reserve(service,keyName) {
    if(budgetStopped) {warn(`${service}: custo anterior excedeu a reserva; etapa pulada.`);return 0;}
    if(!loadKey(keyName)) {warn(`${service}: chave ausente; etapa pulada.`);return 0;}
    const cap=Number(loadKey(`${service}_MAX_COST_USD`));
    if(!Number.isFinite(cap)||cap<=0) {warn(`${service}: custo máximo por chamada não configurado; etapa pulada.`);return 0;}
    if(cap>rounded(job.budget-actualCost-reservedCost)) {warn(`${service}: saldo insuficiente; etapa pulada.`);return 0;}
    reservedCost=rounded(reservedCost+cap);
    await progress(); // Reserva durável antes da chamada cobrada; também renova o lease.
    return cap;
  }
  try {
    const searchBudget=rounded(job.budget-actualCost-reservedCost);
    searching=true;
    if(!(searchBudget>0)) throw Object.assign(Error('Orçamento insuficiente para a busca.'),{actualCost:0,costUncertain:false});
    if(source==='apify'&&estimateCost(job.limit)>searchBudget) throw Object.assign(Error('Saldo insuficiente para pesquisar na Apify.'),{actualCost:0,costUncertain:false});
    const hasKey=source==='aisa'?loadKey('AISA_API_KEY'):loadKey('APIFY_API_TOKEN');
    if(!hasKey) throw Object.assign(Error(`Chave de ${source==='aisa'?'AISA':'Apify'} não configurada.`),{actualCost:0,costUncertain:false});
    reservedCost=rounded(priorReserved+searchBudget);
    await progress();
    const found=source==='aisa'
      ?await searchAisaPlaces({niche:job.niche,city:job.city,limit:job.limit,budget:searchBudget})
      :await pesquisarEmpresas(job.niche,job.city,job.limit,searchBudget);
    providerRunId=found.runId||providerRunId;
    actualCost=rounded(priorCost+found.actualCost);
    reservedCost=found.costUncertain?rounded(priorReserved+searchBudget):priorReserved;
    await progress();
    const {leads}=found;
    if(!leads.length) throw Object.assign(Error(`${source==='aisa'?'AISA':'Apify'} não encontrou leads com fontes para os critérios informados.`),{actualCost:found.actualCost,costUncertain:found.costUncertain});
    searching=false;
    const enriquecidos=[];
    for(const lead of leads) {
      let atual=lead;
      // Não reservar enriquecimento que não pode ser executado por ausência de domínio.
      const aisaCap=lead.website?await reserve('AISA','AISA_API_KEY'):0;
      if(aisaCap) {
        try {
          const r=await enrichLead(lead);atual=r.lead;
          if(!r.usado) warn(`AISA: ${r.motivo||'sem dados'}`);
          // O endpoint não confirma custo: conservar a reserva sem inventar gasto real.
          warn('AISA: custo não confirmado; reserva mantida.');
        } catch(e) {warn(`AISA: ${e.message}; reserva mantida.`);}
        await progress();
      }
      const jevCap=await reserve('JEV','TYPESAFE_API_KEY');
      if(jevCap) {
        try {
          const d=await decideLead(atual,{contexto:`${job.niche} em ${job.city}`});
          if(Number.isFinite(d.custoUsd)&&d.custoUsd>=0) {
            reservedCost=rounded(reservedCost-jevCap);actualCost=rounded(actualCost+d.custoUsd);
            if(d.custoUsd>jevCap) {
              warn('JEV: custo excedeu a reserva configurada; próximas chamadas pagas interrompidas.');
              // Não continuar gastando com uma configuração de custo subestimada.
              budgetStopped=true;
            }
          } else warn('JEV: custo não confirmado; reserva mantida.');
          if(d.ok) atual._decisao=d.decisao;else warn(`JEV: ${d.erro}`);
        } catch(e) {warn(`JEV: ${e.message}; reserva mantida.`);}
        await progress();
      }
      enriquecidos.push(atual);
    }
    const response=await api('POST',`/api/agent/jobs/${job.id}/complete`,{
      leaseToken:job.leaseToken,...costs(),leads:enriquecidos.map(({_decisao,...l})=>l),
    });
    completed=true;
    console.log(`✅ Job concluído: ${response.imported} importados, ${response.duplicates.length} duplicados`);
    const decisoes=enriquecidos.filter(l=>l._decisao);
    if(decisoes.length) {
      const noCrm=await api('GET','/api/leads');
      for(const l of decisoes) {
        const salvo=noCrm.find(x=>x.jobId===job.id&&x.name===l.name&&x.city===l.city);
        if(!salvo) continue;
        try {await api('POST','/api/agent/decisions',{...l._decisao,leadId:salvo.id});}
        catch(e) {console.error(`Decisão não registrada (${l.name}): ${e.message}`);}
      }
    }
  } catch(error) {
    console.error(`❌ Erro ao processar job: ${error.message}`);
    if(completed) return; // Uma falha de registro posterior não desfaz a importação concluída.
    if(error.runId) providerRunId=error.runId;
    if(searching&&Number.isFinite(error.actualCost)) actualCost=rounded(priorCost+error.actualCost);
    if(searching&&error.costUncertain===false) reservedCost=priorReserved;
    try {await api('POST',`/api/agent/jobs/${job.id}/${source==='aisa'&&searching?'fallback':'fail'}`,{leaseToken:job.leaseToken,...costs(),error:error.message});}
    catch(e) {console.error(`❌ Falha ao reportar erro: ${e.message}`);}
  }
}

async function ciclo() {
  try {
    console.log(`\n🔄 [${new Date().toLocaleString('pt-BR')}] Verificando tarefas...`);
    
    // 1. Fazer claim de uma tarefa
    const { job } = await api('POST', '/api/agent/jobs/claim', {});
    
    if (!job) {
      console.log('💤 Nenhuma tarefa pendente.');
      return;
    }
    
    // 2. Processar a tarefa
    await processarJob(job);
    
  } catch (error) {
    console.error(`❌ Erro no ciclo: ${error.message}`);
  }
}

// ─── Execução ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const runOnce = args.includes('--once');
const verbose = args.includes('--verbose');

console.log('🤖 Worker de Prospecção — Hermes → CRM');
console.log(`   URL: ${CRM_URL}`);
console.log(`   Intervalo: ${WORKER_INTERVAL}ms`);
console.log(`   Modo: ${runOnce ? 'execução única' : 'contínuo'}`);

// Manter processo vivo
process.on('SIGINT', () => {
  console.log('\n\n🛑 Worker encerrado.');
  process.exit(0);
});

if (runOnce) {
  await ciclo();
  console.log('\n✅ Execução única concluída.');
} else {
  console.log('\n▶️  Iniciando loop contínuo...');
  await ciclo();
  while(true) {
    await new Promise(resolve=>setTimeout(resolve,WORKER_INTERVAL));
    await ciclo();
  }
}

