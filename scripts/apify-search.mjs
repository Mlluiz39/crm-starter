#!/usr/bin/env node
/**
 * Busca real de empresas via Apify (Google Maps Scraper).
 *
 * Substitui a pesquisa de demonstração do worker: consulta o Actor
 * `compass~crawler-google-places`, aguarda a execução e devolve leads
 * normalizados no formato aceito pelo CRM.
 *
 * Variáveis de ambiente:
 *   APIFY_API_TOKEN — chave da Apify. Se ausente, é lida de $HERMES_HOME/.env
 *                     (o mesmo arquivo gravado pela tela Integrações do CRM).
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const ACTOR = 'compass~crawler-google-places';
// Google Maps Scraper: ~US$ 4 por 1000 lugares + taxa de início do run.
const COST_PER_PLACE_USD = 0.005;
const START_FEE_USD = 0.01;
const POLL_INTERVAL_MS = 5000;
const RUN_TIMEOUT_MS = 4 * 60_000;

export function loadApifyToken() {
  if (process.env.APIFY_API_TOKEN) return process.env.APIFY_API_TOKEN.trim();
  const home = process.env.HERMES_HOME || path.join(homedir(), '.hermes');
  const file = process.env.HERMES_ENV_FILE || path.join(home, '.env');
  if (!existsSync(file)) return '';
  const m = readFileSync(file, 'utf8').match(/^APIFY_API_TOKEN=(.*)$/m);
  return m ? m[1].trim() : '';
}

async function apify(pathname, { method = 'GET', body } = {}) {
  const token = loadApifyToken();
  if (!token) throw new Error('APIFY_API_TOKEN não configurado. Salve a chave na tela Integrações do CRM.');
  const res = await fetch(`https://api.apify.com/v2${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error?.message || `Apify respondeu HTTP ${res.status}`);
  // Os endpoints de recurso embrulham a resposta em {data:...}; o de itens devolve um array puro.
  return Array.isArray(payload) ? payload : payload.data;
}

/** Estimativa conservadora do custo de uma busca, usada para respeitar o teto. */
export function estimateCost(limit) {
  return Number((limit * COST_PER_PLACE_USD + START_FEE_USD).toFixed(4));
}

const httpUrl = v => (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : '');

/**
 * Pesquisa empresas reais.
 * @returns {Promise<{leads:Array, actualCost:number, query:string}>}
 */
export async function searchPlaces({ niche, city, limit, budget }) {
  const estimate = estimateCost(limit);
  // A regra do projeto: orçamento zero impede chamadas cobradas.
  if (!(Number(budget) > 0)) {
    throw new Error(
      `Orçamento zero: a pesquisa real usa a Apify e é cobrada. ` +
      `Defina um teto em USD (estimativa para ${limit} leads: US$ ${estimate.toFixed(2)}).`,
    );
  }
  if (estimate > Number(budget)) {
    throw new Error(
      `Orçamento insuficiente: estimativa de US$ ${estimate.toFixed(2)} para ${limit} leads, ` +
      `teto informado de US$ ${Number(budget).toFixed(2)}. Aumente o teto ou reduza a quantidade.`,
    );
  }

  const query = `${niche} ${city}`.trim();
  console.log(`🌐 Apify: "${query}" (até ${limit} lugares, teto US$ ${Number(budget).toFixed(2)})`);

  let run, finished;
  try {
    run = await apify(`/acts/${ACTOR}/runs?memory=1024&timeout=300&maxTotalChargeUsd=${Number(budget)}`, {
      method: 'POST',
      body: {
        searchStringsArray: [query],
        maxCrawledPlacesPerSearch: limit,
        language: 'pt-BR',
        skipClosedPlaces: true,
        maxReviews: 0,
        maxImages: 0,
        maxQuestions: 0,
      },
    });

    let status = run.status;
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    while (['READY', 'RUNNING', 'TIMING-OUT', 'ABORTING'].includes(status)) {
      if (Date.now() > deadline) throw new Error('Tempo esgotado aguardando a Apify terminar.');
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      status = (await apify(`/actor-runs/${run.id}`)).status;
    }
    finished = await apify(`/actor-runs/${run.id}`);
    if (status !== 'SUCCEEDED') throw new Error(`A execução da Apify terminou como ${status}.`);

    const items = await apify(`/datasets/${finished.defaultDatasetId}/items?limit=${limit * 2}`);
    if (!Array.isArray(items)) throw new Error('A Apify não retornou uma lista de lugares.');
    const costUncertain = typeof finished.usageTotalUsd !== 'number' || !Number.isFinite(finished.usageTotalUsd) || finished.usageTotalUsd < 0;
    const actualCost = costUncertain ? 0 : finished.usageTotalUsd;

    const leads = items
      .slice(0, limit)
      .map(it => ({
        name: String(it.title || '').trim() || 'Sem nome',
        segment: String(it.categoryName || niche).slice(0, 100),
        city: String(it.city || city).slice(0, 120),
        email: '',
        phone: String(it.phone || '').slice(0, 40),
        website: httpUrl(it.website),
        contact: '',
        notes: [
          it.categoryName,
          it.address,
          it.totalScore ? `Nota ${it.totalScore} no Google (${it.reviewsCount || 0} avaliações)` : '',
          it.permanentlyClosed ? 'Marcado como fechado permanentemente' : '',
        ].filter(Boolean).join(' · ').slice(0, 5000),
        // A própria URL do Google Maps é a fonte verificável do dado.
        sources: [{ url: httpUrl(it.url) }].filter(s => s.url),
      }))
      .filter(l => l.sources.length);

    console.log(`✅ Apify: ${leads.length} lugares reais · ${costUncertain?'custo a confirmar':'custo US$ '+actualCost.toFixed(4)}`);
    return { leads, actualCost, query, runId:run.id, costUncertain };
  } catch(error) {
    if(run?.id) {
      // Um timeout local não cancela o run remoto. Solicitar aborto e consultar custo final.
      if(!finished||['READY','RUNNING','TIMING-OUT','ABORTING'].includes(finished.status)) {
        try {await apify(`/actor-runs/${run.id}/abort`,{method:'POST'});} catch {}
        try {finished=await apify(`/actor-runs/${run.id}`);} catch {}
      }
      error.runId=run.id;
    }
    const known=typeof finished?.usageTotalUsd==='number'&&Number.isFinite(finished.usageTotalUsd)&&finished.usageTotalUsd>=0;
    error.actualCost=known?finished.usageTotalUsd:0;
    error.costUncertain=!known||!['SUCCEEDED','FAILED','TIMED-OUT','ABORTED'].includes(finished?.status);
    throw error;
  }
}
