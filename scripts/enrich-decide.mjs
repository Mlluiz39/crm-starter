#!/usr/bin/env node
/**
 * Enriquecimento (AISA) e decisão (Jev) para o worker de prospecção.
 *
 * - AISA: gateway de dados. Enriquecimento de empresa via Apollo Organizations,
 *   usando o domínio do site como chave. Só preenche campos vazios.
 * - Jev: modelo de decisão da TypeSafe, chamado pelo endpoint de decisões do
 *   TypeSafe. Devolve respostas tipadas com probabilidade, não texto.
 *
 * As chaves são lidas do ambiente ou de $HERMES_HOME/.env (o mesmo arquivo que a
 * tela Integrações do CRM grava).
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const AISA_ENDPOINT = 'https://api.aisa.one/apis/v1/apollo/organizations/enrich';
const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const JEV_MODEL = 'jev-latest';
const TIMEOUT_MS = 45000;

function envFrom(file, key) {
  if (!existsSync(file)) return '';
  const m = readFileSync(file, 'utf8').match(new RegExp('^' + key + '=(.*)$', 'm'));
  return m ? m[1].trim() : '';
}

export function loadKey(name) {
  if (process.env[name]) return process.env[name].trim();
  const home = process.env.HERMES_HOME || path.join(homedir(), '.hermes');
  return envFrom(process.env.HERMES_ENV_FILE || path.join(home, '.env'), name);
}

async function post(url, { headers, body }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': 'crm-starter/1.0', ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const raw = await res.text();
  let parsed; try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw: raw.slice(0, 300) }; }
  return { ok: res.ok, status: res.status, body: parsed };
}
async function get(url, headers) {
  const res = await fetch(url, { headers: { 'User-Agent': 'crm-starter/1.0', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const raw = await res.text();
  let parsed; try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw: raw.slice(0, 300) }; }
  return { ok: res.ok, status: res.status, body: parsed };
}

const dominioDe = url => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};
const primeiro = (...vals) => vals.find(v => typeof v === 'string' && v.trim()) || '';

/**
 * Enriquece um lead pela AISA (Apollo Organizations).
 * Preenche apenas campos vazios; nunca sobrescreve dado já pesquisado.
 * @returns {Promise<{lead:object, usado:boolean, motivo?:string}>}
 */
export async function enrichLead(lead, { key } = {}) {
  const token = key ?? loadKey('AISA_API_KEY');
  const dominio = dominioDe(lead.website);
  if (!token) return { lead, usado: false, motivo: 'AISA_API_KEY ausente' };
  if (!dominio) return { lead, usado: false, motivo: 'lead sem site para usar como domínio' };

  const r = await get(`${AISA_ENDPOINT}?domain=${encodeURIComponent(dominio)}`, { Authorization: `Bearer ${token}` });
  if (!r.ok) throw new Error(`AISA respondeu HTTP ${r.status} para ${dominio}`);
  // A resposta do gateway embrulha o registro da Apollo; aceitamos as formas comuns.
  const org = r.body?.organization || r.body?.data?.organization || r.body?.data || r.body || {};
  if (!org || typeof org !== 'object' || !Object.keys(org).length) {
    return { lead, usado: false, motivo: `AISA não retornou dados para ${dominio}` };
  }

  const enriquecido = { ...lead };
  if (!enriquecido.phone) enriquecido.phone = primeiro(org.phone, org.sanitized_phone, org.primary_phone?.number).slice(0, 40);
  if (!enriquecido.website) enriquecido.website = primeiro(org.website_url, org.website);
  if (!enriquecido.contact) enriquecido.contact = primeiro(org.name);
  const extras = [
    org.industry && `Setor: ${org.industry}`,
    org.estimated_num_employees && `Funcionários: ${org.estimated_num_employees}`,
    org.linkedin_url && `LinkedIn: ${org.linkedin_url}`,
    org.founded_year && `Fundada em ${org.founded_year}`,
  ].filter(Boolean).join(' · ');
  if (extras) enriquecido.notes = [enriquecido.notes, `AISA/Apollo — ${extras}`].filter(Boolean).join(' · ').slice(0, 5000);
  return { lead: enriquecido, usado: true };
}

/**
 * Pergunta ao Jev se o lead merece contato.
 * @returns {Promise<{ok:boolean, decisao?:object, custoUsd:number, erro?:string}>}
 */
export async function decideLead(lead, { key, contexto } = {}) {
  const token = key ?? loadKey('TYPESAFE_API_KEY');
  if (!token) return { ok: false, custoUsd: 0, erro: 'TYPESAFE_API_KEY ausente (Jev)' };

  const estado = [
    `Empresa: ${lead.name}`,
    lead.segment ? `Segmento: ${lead.segment}` : '',
    lead.city ? `Cidade: ${lead.city}` : '',
    lead.phone ? `Telefone: ${lead.phone}` : '',
    lead.website ? `Site: ${lead.website}` : '',
    lead.notes ? `Observações: ${lead.notes}` : '',
    contexto ? `Contexto da busca: ${contexto}` : '',
  ].filter(Boolean).join('\n');

  const r = await post(JEV_ENDPOINT, {
    headers: { Authorization: `Bearer ${token}` },
    body: {
      model: JEV_MODEL,
      state: estado,
      questions: {
        aderencia: {
          type: 'choice',
          instructions: 'Qual o nível de aderência desta empresa ao público-alvo da busca?',
          criteria: {
            alta: 'Mesmo segmento e mesma região da busca, contato disponível',
            media: 'Segmento relacionado, mas região ou perfil divergem em parte',
            baixa: 'Segmento ou região claramente diferentes da busca',
            indefinida: 'Faltam dados para decidir',
          },
        },
        contato_disponivel: {
          type: 'noul',
          instructions: 'Há canal de contato direto (telefone ou site próprio) para abordagem?',
        },
      },
    },
  });
  if (!r.ok) return { ok: false, custoUsd: null, erro: `TypeSafe respondeu HTTP ${r.status} (Jev)` };

  const a = r.body?.answers || {};
  const reportedCost = r.body?.usage?.cost;
  const custoUsd = typeof reportedCost === 'number' && Number.isFinite(reportedCost) && reportedCost >= 0 ? reportedCost : null;
  const aderencia = a.aderencia?.choice || 'indefinida';
  const confianca = a.aderencia?.confidence;
  const contatoProb = a.contato_disponivel?.noul ?? a.contato_disponivel?.probability ?? a.contato_disponivel?.probability_yes ?? a.contato_disponivel?.yes;

  return {
    ok: true,
    custoUsd,
    decisao: {
      leadId: lead.id,
      question: 'Qual o nível de aderência ao público-alvo e há canal de contato?',
      answer: [
        `Aderência: ${aderencia}`,
        Number.isFinite(confianca) ? `(confiança ${(confianca * 100).toFixed(0)}%)` : '',
        Number.isFinite(contatoProb) ? `· Contato direto: ${(contatoProb * 100).toFixed(0)}%` : '',
      ].filter(Boolean).join(' ').slice(0, 2000),
      model: r.body?.model || JEV_MODEL,
      provider: 'TypeSafe nativo',
    },
  };
}
