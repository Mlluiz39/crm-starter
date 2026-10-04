import http from 'node:http';
import {createSalesApi} from './scripts/sales-api.mjs';
import {createWacliClient} from './scripts/wacli-client.mjs';
import {createSalesEmailClient} from './scripts/sales-email.mjs';
import {salesHermesProfile,inspectHermes} from './scripts/hermes-sales.mjs';
import {connectHermes} from './scripts/connect-hermes.mjs';
import { estimateCost } from './scripts/apify-search.mjs';
import { testAisaConnection } from './scripts/aisa-search.mjs';
import { createSupabaseStore } from './scripts/db-supabase.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, timingSafeEqual, createHash, scryptSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, chmodSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.CRM_DATA_DIR || path.join(root, 'data');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const keyFile = path.join(dir, 'credentials.json');
let keys;
if (process.env.CRM_ADMIN_TOKEN && process.env.CRM_AGENT_TOKEN) {
  keys = { admin: process.env.CRM_ADMIN_TOKEN, agent: process.env.CRM_AGENT_TOKEN };
} else {
  if (!existsSync(keyFile)) writeFileSync(keyFile, JSON.stringify({ admin: randomBytes(32).toString('hex'), agent: randomBytes(32).toString('hex') }, null, 2), { mode: 0o600 });
  keys = JSON.parse(readFileSync(keyFile, 'utf8'));
}
if (keys.admin === keys.agent || keys.admin.length < 24 || keys.agent.length < 24) throw Error('Use tokens distintos com pelo menos 24 caracteres.');
const db = new DatabaseSync(path.join(dir, 'crm.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,id));`);

let supabaseStore = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  try {
    supabaseStore = createSupabaseStore({
      url: process.env.SUPABASE_URL,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    await supabaseStore.init();
  } catch (e) {
    console.error('Supabase Store fallback para SQLite:', e.message);
  }
}

const all = kind => (supabaseStore?.isReady() ? supabaseStore.all(kind) : db.prepare('SELECT payload FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(x => JSON.parse(x.payload)));
const get = (kind, id) => (supabaseStore?.isReady() ? supabaseStore.get(kind, id) : (db.prepare('SELECT payload FROM records WHERE kind=? AND id=?').get(kind,id) ? JSON.parse(db.prepare('SELECT payload FROM records WHERE kind=? AND id=?').get(kind,id).payload) : null));
const put = (kind, obj) => {
  if (supabaseStore?.isReady()) return supabaseStore.put(kind, obj);
  db.prepare('INSERT INTO records(kind,id,payload) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload').run(kind,obj.id,JSON.stringify(obj));
  return obj;
};
const del = (kind, id) => {
  if (supabaseStore?.isReady()) return supabaseStore.del(kind, id);
  return db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id).changes;
};
// Configurações não-secretas ficam no banco (o .env é só para chaves).
const DEFAULT_EMAIL = { from:'contato@mlluizdevtech.com.br', fromName:'MLLuiz DevTech', testMode:true, testRecipient:'', dailyLimit:20 };
const emailSettings = () => ({ ...DEFAULT_EMAIL, ...(get('settings','email') || {}) });
const saveEmailSettings = patch => put('settings', { id:'email', ...emailSettings(), ...patch });
const enviadosHoje = () => { const hoje = now().slice(0,10); return all('outbox').filter(o => o.status === 'enviado' && String(o.at).slice(0,10) === hoje).length+all('salesMessages').filter(o=>o.channel==='email'&&o.direction==='outbound'&&['aceita','entregue'].includes(o.status)&&String(o.at).slice(0,10)===hoje).length; };
const reservados = () => all('outbox').filter(o=>['processando','incerto'].includes(o.status)).length+all('salesMessages').filter(o=>o.channel==='email'&&o.direction==='outbound'&&['processando','incerto'].includes(o.status)).length;
const now = () => new Date().toISOString();
const audit = (actor, action, entityId) => put('audit', {id:randomUUID(),actor,action,entityId,at:now()});
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const salesApi=createSalesApi({db: supabaseStore?.isReady() ? supabaseStore : db,getLead:id=>get('leads',id),putLead:lead=>put('leads',lead),audit,emailSettings,
 emailQuota:()=>Number(emailSettings().dailyLimit)-enviadosHoje()-reservados(),
 sendEmail:m=>createSalesEmailClient({key:envValue(hermesEnvFile,'RESEND_API_KEY'),baseUrl:RESEND_BASE}).send(m),
 sendWhatsapp:async m=>{const cli=createWacliClient({binary:m.settings.wacliBinary,account:m.settings.wacliAccount,store:m.settings.wacliStore});const h=await cli.health();if(!h.authenticated||h.version!=='wacli 0.20.0')throw Object.assign(Error('Configure e autentique o wacli 0.20.0.'),{outcome:'failed',safeMessage:'Configure e autentique o wacli 0.20.0.'});m.beforeDispatch();return cli.send(m);},
 presenceWhatsapp:async({recipient,typing,settings})=>{try{const cfg=settings||get('settings','sales')||{};const cli=createWacliClient({binary:cfg.wacliBinary,account:cfg.wacliAccount,store:cfg.wacliStore});return await cli.presence({recipient,typing});}catch{return false;}},
 checkConnection:async cfg=>{
  const whatsapp=await createWacliClient({binary:cfg.wacliBinary,account:cfg.wacliAccount,store:cfg.wacliStore}).health();
  let hermes;try{hermes=await inspectHermes({...salesHermesProfile(),url:cfg.hermesUrl});}catch(e){hermes={connected:false,error:e.message};}
  return {whatsapp,hermes,jev:{configured:!!envValue(hermesEnvFile,'TYPESAFE_API_KEY')},email:{configured:!!envValue(hermesEnvFile,'RESEND_API_KEY'),receivingConfigured:!!cfg.replyTo}};
 }
});
const text = (v, name, max=500, required=false) => { if (typeof v !== 'string' || v.length > max || (required && !v.trim())) fail(400, `Campo inválido: ${name}`); return v.trim(); };
const opt = (v, name, max=500) => text(v ?? '',name,max);
// ─── Chaves de integração (gravadas fora do navegador) ────────────────────────
// HERMES_ENV_FILE permite apontar o alvo em testes; sem ele, usa $HERMES_HOME/.env.
const hermesEnvFile = process.env.HERMES_ENV_FILE || path.join(process.env.HERMES_HOME || path.join(homedir(), '.hermes'), '.env');
// RESEND_BASE_URL permite apontar para um stub nos testes (sem enviar e-mail de verdade).
const RESEND_BASE = process.env.RESEND_BASE_URL || 'https://api.resend.com';
const APIFY_ENV_KEY = 'APIFY_API_TOKEN';
// Registro das integrações com chave. `test` faz uma chamada real e barata ao
// provedor — é o que o botão "Testar conexão" executa.
const INTEGRATIONS = {
  apify: {
    label: 'Apify', key: 'APIFY_API_TOKEN',
    test: async t => {
      const r = await fetchJson('https://api.apify.com/v2/users/me', { headers: { Authorization: `Bearer ${t}` } });
      if (!r.ok) throw Error('A Apify recusou a chave.');
      return `Conta ${r.body?.data?.username || 'verificada'} · plano ${r.body?.data?.plan?.id || '—'}`;
    },
  },
  aisa: {
    label: 'AISA', key: 'AISA_API_KEY',
    test: testAisaConnection,
  },
  jev: {
    label: 'Jev (TypeSafe nativo)', key: 'TYPESAFE_API_KEY',
    // Valida autenticação e modelos sem executar uma decisão paga.
    test: async t => {
      const r = await fetchJson('https://api.typesafe.ai/v1/models', {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!r.ok || !Array.isArray(r.body?.models) || !r.body.models.some(m=>m.name==='jev-latest')) throw Error('A TypeSafe recusou a chave ou não disponibilizou o modelo Jev.');
      return 'TypeSafe conectada; modelo jev-latest disponível (sem geração).';
    },
  },
  email: {
    label: 'Resend (envio de e-mail)', key: 'RESEND_API_KEY',
    // Lista as chaves da própria conta: valida sem enviar e-mail a ninguém.
    test: async t => {
      const r = await fetchJson('https://api.resend.com/api-keys', { headers: { Authorization: `Bearer ${t}` } });
      if (!r.ok) throw Error('O Resend recusou a chave.');
      const n = Array.isArray(r.body?.data) ? r.body.data.length : 0;
      return `Chave válida (${n} chave(s) na conta)`;
    },
  },
};
// fetch com timeout e corpo já parseado; nunca lança por status HTTP.
async function fetchJson(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    // User-Agent explícito: provedores atrás de Cloudflare bloqueiam clientes sem UA (erro 1010).
    headers: { 'User-Agent': 'crm-starter/1.0', ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
  });
  const raw = await res.text();
  let parsed; try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw: raw.slice(0, 300) }; }
  return { ok: res.ok, status: res.status, body: parsed };
}
function envValue(file, key) {
  try { const m = readFileSync(file, 'utf8').match(new RegExp('^' + key + '=(.*)$', 'm')); return m ? m[1].trim() : ''; } catch { return ''; }
}
function maskSecret(v) {
  if (!v) return '';
  if (v.length <= 12) return '\u2022'.repeat(10);
  return (v.startsWith('apify_api_') ? 'apify_api_' : v.slice(0, 4)) + '\u2022\u2022\u2022\u2022\u2022\u2022' + v.slice(-4);
}
// Estatísticas reais da prospecção, calculadas dos jobs (nada inventado).
function prospectingStats() {
  const jobs = all('jobs');
  const by = s => jobs.filter(j => j.status === s);
  return {
    jobs: jobs.length,
    pending: by('pendente').length,
    running: by('executando').length,
    awaitingBackup: by('aguardando_backup').length,
    completed: by('concluida').length,
    failed: by('falhou').length,
    finished: by('concluida').length + by('falhou').length,
    // Leads de prospecção que existem no CRM agora (não o histórico de jobs, que pode ter sido limpo).
    imported: all('leads').filter(l => l.origin === 'hermes').length,
    cost: Number(jobs.reduce((s, j) => s + (Number(j.actualCost) || 0), 0).toFixed(4)),
  };
}
// Status em tempo real do Hermes (inspeciona a API local diretamente; não presume por histórico).
async function workerStatus() {
  const last = all('audit').find(a => a.action.startsWith('pesquisa.') || a.action === 'integracao.hermes.conectada');
  let liveConnected = false;
  try {
    const profileData = salesHermesProfile();
    const res = await inspectHermes({
      url: process.env.HERMES_URL || 'http://127.0.0.1:8642',
      key: profileData.key,
      profile: profileData.profile
    });
    liveConnected = !!res?.connected;
  } catch {
    liveConnected = false;
  }
  return { connected: liveConnected, lastRunAt: last ? last.at : null, lastAction: last ? last.action : null, url: process.env.HERMES_URL || 'http://127.0.0.1:8642' };
}
function apifyStatus() { return integrationStatus('apify'); }
function apiToken(service, v) {
  const nome = INTEGRATIONS[service].label;
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) fail(400, `Informe a chave: ${nome}.`);
  if (s.length < 8 || s.length > 400) fail(400, `Chave de ${nome} com tamanho inválido.`);
  // Estrito de propósito: sem espaços, quebras de linha ou aspas, para não injetar linhas no .env.
  if (!/^[A-Za-z0-9_.:-]+$/.test(s)) fail(400, `A chave de ${nome} contém caracteres inválidos.`);
  return s;
}
function integrationStatus(service) {
  const spec = INTEGRATIONS[service];
  const v = envValue(hermesEnvFile, spec.key);
  let updatedAt = null;
  try { if (v) updatedAt = statSync(hermesEnvFile).mtime.toISOString(); } catch {}
  return { id: service, label: spec.label, envKey: spec.key, configured: !!v, masked: maskSecret(v), updatedAt, path: hermesEnvFile };
}
function writeEnvVar(file, key, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  let raw = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const re = new RegExp('^' + key + '=.*$', 'm');
  raw = re.test(raw)
    ? raw.replace(re, `${key}=${value}`)
    : (raw && !raw.endsWith('\n') ? raw + '\n' : raw) + `${key}=${value}\n`;
  // Escrita atômica: grava em temporário e renomeia, para nunca corromper o .env do Hermes.
  const tmp = `${file}.tmp-${randomUUID()}`;
  writeFileSync(tmp, raw, { mode: 0o600 });
  try { chmodSync(tmp, statSync(file).mode & 0o777); } catch { chmodSync(tmp, 0o600); }
  renameSync(tmp, file);
}
function removeEnvVar(file, key) {
  if (!existsSync(file)) return;
  const raw = readFileSync(file, 'utf8');
  const next = raw.split('\n').filter(l => !new RegExp('^' + key + '=').test(l)).join('\n');
  if (next === raw) return;
  const tmp = `${file}.tmp-${randomUUID()}`;
  writeFileSync(tmp, next, { mode: 0o600 });
  try { chmodSync(tmp, statSync(file).mode & 0o777); } catch { chmodSync(tmp, 0o600); }
  renameSync(tmp, file);
}
const stages = ['novo','qualificado','contatado','reuniao','proposta','ganho','perdido'];
const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
function url(v) { if (!v) return ''; try { const u = new URL(v); if (!['http:','https:'].includes(u.protocol) || u.username || u.password) throw Error(); return u.href; } catch { fail(400, 'URL inválida. Use http ou https.'); } }
function email(v) { v=opt(v,'e-mail',254).toLowerCase(); if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail(400,'E-mail inválido.'); return v; }
function leadData(b, old={}) {
  const d = {...old, name:text(b.name ?? old.name,'empresa',180,true), segment:opt(b.segment ?? old.segment,'segmento',100), city:opt(b.city ?? old.city,'cidade',120), email:email(b.email ?? old.email), phone:opt(b.phone ?? old.phone,'telefone',40), website:url(b.website ?? old.website ?? ''), contact:opt(b.contact ?? old.contact,'contato',180), notes:opt(b.notes ?? old.notes,'notas',5000), typeId:opt(b.typeId ?? old.typeId,'tipo',80), stage:b.stage ?? old.stage ?? 'novo', blocked:b.blocked ?? old.blocked ?? false};
  if (!stages.includes(d.stage) || typeof d.blocked !== 'boolean') fail(400,'Etapa ou bloqueio inválido.');
  if (d.typeId && !get('types',d.typeId)) fail(400,'Tipo de lead não encontrado.');
  const duplicate=all('leads').find(x=>x.id!==old.id && ((d.email && x.email===d.email) || (d.phone.replace(/\D/g,'') && x.phone.replace(/\D/g,'')===d.phone.replace(/\D/g,'')) || (norm(x.name)===norm(d.name) && norm(x.city)===norm(d.city))));
  if(duplicate) fail(409,`Possível duplicata: ${duplicate.name}`);
  return d;
}
const digest = c => createHash('sha256').update(JSON.stringify([c.leadIds,c.subject,c.body,c.version])).digest('hex');
function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (typeof password !== 'string' || !stored) return false;
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const hash = scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  return hash.length === keyBuf.length && timingSafeEqual(hash, keyBuf);
}
if (!all('types').length) ['Prospect','Cliente','Parceiro'].forEach(name=>put('types',{id:randomUUID(),name,description:'',active:true}));
if (!all('users').length) {
  put('users', {
    id: randomUUID(),
    email: 'admin@mlluizdevtech.com.br',
    name: 'Marcelo Luiz',
    passwordHash: hashPassword('admin123456'),
    role: 'admin',
    createdAt: now()
  });
}

async function body(req) {
  let s=''; for await (const part of req) { s+=part; if(Buffer.byteLength(s)>1_000_000) fail(413,'Corpo muito grande.'); }
  try { const b=JSON.parse(s||'{}'); if(!b||typeof b!=='object'||Array.isArray(b)) throw Error(); return b; } catch { fail(400,'JSON inválido.'); }
}
function auth(req) {
  const v=(req.headers.authorization||'').replace(/^Bearer /,'');
  if(!v) return null;
  const same=k=>Buffer.byteLength(v)===Buffer.byteLength(k)&&timingSafeEqual(Buffer.from(v),Buffer.from(k));
  if(same(keys.admin)) return 'admin';
  if(same(keys.agent)) return 'agent';
  const sess = get('sessions', v);
  if(sess && sess.expiresAt > Date.now()) {
    return sess.role || 'admin';
  }
  return null;
}
function admin(role) { if(role!=='admin') fail(403,'Somente o administrador pode realizar esta ação.'); }
function jobCosts(b,j) {
  const fields={};
  for(const key of ['actualCost','reservedCost']) {
    if(b[key]!==undefined) {
      if(typeof b[key]!=='number'||!Number.isFinite(b[key])||b[key]<0) fail(400,'Custo inválido.');
      fields[key]=b[key];
    }
  }
  if(b.costUncertain!==undefined) {
    if(typeof b.costUncertain!=='boolean') fail(400,'Estado de custo inválido.');
    fields.costUncertain=b.costUncertain;
  }
  if(b.providerRunId!==undefined) fields.providerRunId=opt(b.providerRunId,'execução do provedor',120);
  if(b.warnings!==undefined) {
    if(!Array.isArray(b.warnings)||b.warnings.length>200) fail(400,'Avisos inválidos.');
    fields.warnings=b.warnings.map(w=>text(w,'aviso',1000));
  }
  fields.budgetExceeded=(fields.actualCost??j.actualCost??0)>j.budget;
  return fields;
}
function required(kind,id) { const v=get(kind,id); if(!v) fail(404,'Registro não encontrado.'); return v; }
async function dispatch(method, p, b, role) {
  const salesResult=await salesApi.dispatch(method,p,b,role);
  if(salesResult!==undefined)return salesResult;
  if(method==='GET' && p==='/api/session') return {role};
  if(method==='GET' && p==='/api/state') {
    admin(role); return {sales:salesApi.state(),leads:all('leads'),campaigns:all('campaigns'),jobs:all('jobs').map(({leaseToken,...j})=>j),types:all('types'),audit:all('audit').slice(0,100),decisions:all('decisions'),integrations:{
      hermes:await workerStatus(),
      apify:integrationStatus('apify'),
      aisa:integrationStatus('aisa'),
      jev:integrationStatus('jev'),
      email:integrationStatus('email'),
    },prospecting:prospectingStats(),
      emailSettings:{...emailSettings(),enviadosHoje:enviadosHoje(),restante:Math.max(0,Number(emailSettings().dailyLimit)-enviadosHoje()-reservados())},
      outbox:all('outbox').slice(0,200)};
  }
  if(method==='GET' && p==='/api/leads') return all('leads');
  if(method==='POST' && p==='/api/leads') {
    if(role==='agent' && (b.blocked===true || (b.stage && !['novo','qualificado'].includes(b.stage)))) fail(403,'O agente não pode criar bloqueios ou etapas avançadas.');
    const d=leadData(b); const item=put('leads',{...d,id:randomUUID(),createdAt:now(),updatedAt:now(),origin:role==='agent'?'hermes':'manual'}); audit(role,'lead.criado',item.id); return item;
  }
  let m=p.match(/^\/api\/leads\/([^/]+)$/);
  if(method==='PATCH' && m) {
    const old=required('leads',m[1]);
    if(role==='agent' && (b.blocked!==undefined || (b.stage!==undefined && !['novo','qualificado'].includes(b.stage)))) fail(403,'O agente só pode definir novo/qualificado e não pode alterar bloqueios.');
    const item=put('leads',{...leadData(b,old),updatedAt:now()}); audit(role,'lead.atualizado',item.id); return item;
  }
  if(method==='DELETE' && m) {
    admin(role); required('leads',m[1]);
    // Remove o lead de todas as campanhas para não deixar campanhas órfãs.
    const campanhas=all('campaigns');
    for(const c of campanhas) {
      if(c.leadIds && c.leadIds.includes(m[1])) {
        c.leadIds=c.leadIds.filter(id=>id!==m[1]);
        c.updatedAt=now();
        put('campaigns',c);
      }
    }
    del('leads',m[1]); audit(role,'lead.removido',m[1]); return {removed:1};
  }
  if(method==='POST' && p==='/api/types') {
    admin(role); const item=put('types',{id:randomUUID(),name:text(b.name,'nome',80,true),description:opt(b.description,'descrição',200),active:true}); audit(role,'tipo.criado',item.id); return item;
  }
  m=p.match(/^\/api\/types\/([^/]+)$/);
  if(method==='PATCH' && m) {
    admin(role); const old=required('types',m[1]); if(b.active!==undefined && typeof b.active!=='boolean') fail(400,'Ativação inválida.');
    const item=put('types',{...old,name:text(b.name??old.name,'nome',80,true),description:opt(b.description??old.description,'descrição',200),active:b.active??old.active}); audit(role,'tipo.atualizado',item.id);return item;
  }
  if(method==='POST' && p==='/api/campaigns') {
    if(!Array.isArray(b.leadIds)) fail(400,'Destinatários inválidos.');
    const leadIds=[...new Set(b.leadIds)]; if(!leadIds.length||leadIds.length>100) fail(400,'Selecione entre 1 e 100 leads.');
    leadIds.forEach(id=>{const l=required('leads',id);if(l.blocked) fail(409,'Destinatário bloqueado.');if(!l.email) fail(400,`${l.name}: e-mail ausente.`);});
    const c=put('campaigns',{id:randomUUID(),name:text(b.name,'campanha',150,true),subject:text(b.subject,'assunto',200,true),body:text(b.body,'mensagem',12000,true),leadIds,status:'rascunho',version:1,createdAt:now(),updatedAt:now(),approval:null}); audit(role,'campanha.criada',c.id);return c;
  }
  m=p.match(/^\/api\/campaigns\/([^/]+)(?:\/(submit|approve|reject|send))?$/);
  if(m) {
    const c=required('campaigns',m[1]), action=m[2];
    if(method==='DELETE' && !action) {
      admin(role);
      del('campaigns',m[1]); audit(role,'campanha.removida',m[1]); return {removed:1};
    }
    if(method==='PATCH' && !action) {
      if(!Number.isInteger(b.version)||b.version!==c.version) fail(409,'Versão desatualizada. Atualize a tela.');
      c.name=text(b.name??c.name,'campanha',150,true);c.subject=text(b.subject??c.subject,'assunto',200,true);c.body=text(b.body??c.body,'mensagem',12000,true);
      c.version++;c.status='rascunho';c.approval=null;c.updatedAt=now();put('campaigns',c);audit(role,'campanha.editada',c.id);return c;
    }
    if(method==='POST' && action) {
      if(action==='send') {
        // Envio real via Resend, com as travas abaixo. Nada sai sem passar por todas.
        admin(role); // enviar é ação do administrador, como aprovar
        let cfg, apiKey, modo, reservas;
        db.exec('BEGIN IMMEDIATE');
        try {
          Object.assign(c, required('campaigns',c.id));
          cfg=emailSettings(); apiKey=envValue(hermesEnvFile,'RESEND_API_KEY');
          if(!apiKey) fail(400,'Chave do Resend não configurada. Salve em Integrações.');
          if(!cfg.from) fail(400,'Remetente não configurado.');
          if(c.status!=='aprovada'||!c.approval) fail(409,'A campanha precisa estar aprovada para enviar.');
          // A aprovação precisa valer para esta versão e este conteúdo exatos.
          if(c.approval.version!==c.version||c.approval.hash!==digest(c)) fail(409,'A aprovação não corresponde à versão atual. Revise e aprove novamente.');
          const destinatarios=c.approval.recipients||[];
          if(!destinatarios.length) fail(400,'A aprovação não tem destinatários.');
          // Ninguém pode ter sido bloqueado ou removido depois da aprovação.
          for(const r of destinatarios) {
            const l=get('leads',r.leadId);
            if(!l) fail(409,'Um destinatário aprovado não existe mais.');
            if(l.blocked) fail(409,`${l.name} está bloqueado.`);
            if(l.email!==r.email) fail(409,`O e-mail de ${l.name} mudou depois da aprovação.`);
          }
          // Modo de teste: só sai para o endereço configurado, nunca para os leads.
          let alvos=destinatarios.map(r=>({leadId:r.leadId,email:r.email}));
          modo='producao';
          if(cfg.testMode) {
            const para=opt(cfg.testRecipient,'destinatário de teste',254).toLowerCase();
            if(!para||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) fail(400,'Modo de teste ligado: informe um e-mail de teste em Configurações de envio.');
            alvos=[{leadId:destinatarios[0].leadId,email:para}];
            modo='teste';
          }
          // Reservar todos os destinatários e a cota antes de qualquer await.
          const historico=all('outbox').filter(o=>o.campaignId===c.id&&o.version===c.version&&(o.modo||'producao')===modo);
          if(historico.some(o=>['processando','incerto'].includes(o.status)||(o.status==='falhou'&&o.retryable!==true))) fail(409,'Envio em processamento ou resultado incerto. Confira a caixa de saída e o provedor antes de repetir.');
          const pendentes=alvos.filter(a=>!historico.some(o=>o.email===a.email&&o.status==='enviado'));
          if(!pendentes.length) fail(409,'Esta versão já foi enviada para os destinatários selecionados.');
          const restante=Number(cfg.dailyLimit)-enviadosHoje()-reservados();
          if(pendentes.length>restante) fail(429,`Restam ${Math.max(0,restante)} envio(s) hoje (limite diário ${cfg.dailyLimit}, incluindo reservas).`);
          reservas=pendentes.map(a=>put('outbox',{
            id:randomUUID(),campaignId:c.id,version:c.version,leadId:a.leadId,email:a.email,modo,
            from:cfg.from,subject:c.subject,at:now(),status:'processando',providerId:null,erro:null,
          }));
          db.exec('COMMIT');
        } catch(e) { db.exec('ROLLBACK'); throw e; }
        const enviados=[],falhas=[];
        for(const registro of reservas) {
          try {
            // Revalidar após cada chamada: edição/bloqueio durante um lote cancela o restante.
            const atual=get('campaigns',c.id), lead=get('leads',registro.leadId);
            if(!atual||atual.status!=='aprovada'||atual.version!==c.version||digest(atual)!==c.approval.hash||!lead||lead.blocked||(!cfg.testMode&&lead.email!==registro.email)) {
              registro.status='falhou';registro.erro='Campanha ou destinatário mudou durante o envio.';
            } else {
              const r=await fetchJson(`${RESEND_BASE}/emails`,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Idempotency-Key':registro.id},
                body:{from:cfg.fromName?`${cfg.fromName} <${cfg.from}>`:cfg.from,to:[registro.email],subject:c.subject,text:c.body}});
              if(r.ok&&typeof r.body?.id==='string'&&r.body.id) {registro.status='enviado';registro.providerId=r.body.id;}
              else {
                // 5xx, conflitos ou resposta inválida podem ocultar um envio aceito.
                registro.status=!r.ok&&r.status>=400&&r.status<500&&![408,409].includes(r.status)?'falhou':'incerto';
                registro.erro=String(r.body?.message||r.body?.error||`Resposta não confirmada (HTTP ${r.status})`).slice(0,300);
              }
            }
          } catch(e) {registro.status='incerto';registro.erro=String(e.message).slice(0,300);}
          registro.retryable=registro.status==='falhou';registro.at=now();put('outbox',registro);
          if(registro.status==='enviado') enviados.push(registro.email);
          else falhas.push({email:registro.email,erro:registro.erro,status:registro.status});
        }
        // Nunca sobrescrever uma edição ocorrida enquanto aguardávamos o provedor.
        const atual=get('campaigns',c.id);
        if(modo==='producao'&&enviados.length&&!falhas.length&&atual?.status==='aprovada'&&atual.version===c.version&&digest(atual)===c.approval.hash) {
          atual.status='enviada';atual.sentAt=now();put('campaigns',atual);
        }
        audit(role, falhas.length?'campanha.envio_parcial':modo==='teste'?'campanha.teste_enviado':'campanha.enviada', c.id);
        return {campaignId:c.id,version:c.version,modo,enviados:enviados.length,falhas};
      }
      if(action==='submit') { if(c.status!=='rascunho') fail(409,'Apenas rascunhos podem ser submetidos.');c.status='aguardando_aprovacao'; }
      if(['approve','reject'].includes(action)) {
        admin(role);if(c.status!=='aguardando_aprovacao') fail(409,'Campanha não está aguardando aprovação.');
        if(b.version!==c.version) fail(409,'Versão desatualizada. Revise a mensagem atual.');
        if(action==='approve') {
          const recipients=c.leadIds.map(id=>{const l=required('leads',id);if(l.blocked||!l.email) fail(409,'Destinatário bloqueado ou sem e-mail.');return {leadId:id,email:l.email};});
          c.approval={by:'admin',at:now(),version:c.version,hash:digest(c),recipients};c.status='aprovada';
        } else {c.status='rascunho';c.approval=null;}
      }
      put('campaigns',c);audit(role,`campanha.${action}`,c.id);return c;
    }
  }
  if(method==='POST' && p==='/api/prospecting/jobs') {
    admin(role);
    const budget=Number(b.budget),limit=Number(b.limit);
    if(!Number.isFinite(budget)||budget<0||budget>100||!Number.isInteger(limit)||limit<1||limit>30) fail(400,'Limites inválidos (1–30 leads; US$ 0–100).');
    const j=put('jobs',{id:randomUUID(),niche:text(b.niche,'nicho',120,true),city:text(b.city,'cidade',120,true),limit,budget,currency:'USD',status:'pendente',searchProvider:'aisa',createdAt:now(),actualCost:null,results:[]}); audit(role,'pesquisa.criada',j.id);return j;
  }
  if(method==='POST' && p==='/api/prospecting/jobs/clean') {
    admin(role);
    // Remove pesquisas já finalizadas. Os leads importados permanecem no CRM.
    const which=b.status||'finished';
    if(!['finished','concluida','falhou','all'].includes(which)) fail(400,'Filtro de limpeza inválido.');
    const alvo=all('jobs').filter(j=>which==='all'?true:which==='finished'?['concluida','falhou'].includes(j.status):j.status===which);
    if(!alvo.length) return {removed:0};
    db.exec('BEGIN IMMEDIATE');
    try { for(const j of alvo) del('jobs',j.id); audit(role,'pesquisa.limpeza',String(alvo.length)); db.exec('COMMIT'); }
    catch(e){ db.exec('ROLLBACK'); throw e; }
    return {removed:alvo.length};
  }
  m=p.match(/^\/api\/prospecting\/jobs\/([^/]+)\/activate-apify$/);
  if(method==='POST' && m) {
    admin(role);const j=required('jobs',m[1]);
    if(j.status!=='aguardando_backup') fail(409,'A pesquisa não está aguardando ativação da Apify.');
    const remaining=Number((j.budget-(j.actualCost||0)-(j.reservedCost||0)).toFixed(6));
    if(j.costUncertain||j.reservedCost>0) fail(409,'Custo da AISA ainda não confirmado. Confira o provedor antes de ativar Apify.');
    if(remaining<=0||remaining<estimateCost(j.limit)) fail(409,'Saldo restante insuficiente para a busca na Apify.');
    j.searchProvider='apify';j.status='pendente';j.apifyActivatedAt=now();j.apifyActivatedBy='admin';j.error=null;
    put('jobs',j);audit(role,'pesquisa.apify_ativada',j.id);return j;
  }
  m=p.match(/^\/api\/prospecting\/jobs\/([^/]+)$/);
  if(method==='DELETE' && m) {
    admin(role); required('jobs',m[1]);
    del('jobs',m[1]); audit(role,'pesquisa.removida',m[1]); return {removed:1};
  }
  if(method==='POST' && p==='/api/agent/jobs/claim') {
    if(role!=='agent') fail(403,'Use o token do agente.');
    for(const expired of all('jobs').filter(x=>x.status==='executando'&&Date.parse(x.leaseUntil)<Date.now()&&(x.actualCost>0||x.reservedCost>0||x.providerRunId))) {
      expired.status='falhou';expired.error='Reserva expirada após trabalho pago. Confira custos e execução no provedor antes de criar outra pesquisa.';delete expired.leaseToken;put('jobs',expired);audit(role,'pesquisa.falhou',expired.id);
    }
    const j=all('jobs').reverse().find(x=>x.status==='pendente'||(x.status==='executando'&&Date.parse(x.leaseUntil)<Date.now()));
    if(!j) return {job:null};
    j.searchProvider=j.searchProvider||'aisa';j.status='executando';j.leaseToken=randomUUID();j.leaseUntil=new Date(Date.now()+15*60_000).toISOString();put('jobs',j);audit(role,'pesquisa.assumida',j.id);return {job:j};
  }
  m=p.match(/^\/api\/agent\/jobs\/([^/]+)\/(complete|fail|progress|fallback)$/);
  if(method==='POST' && m) {
    if(role!=='agent') fail(403,'Use o token do agente.');const j=required('jobs',m[1]);
    if(j.status!=='executando'||b.leaseToken!==j.leaseToken||Date.parse(j.leaseUntil)<Date.now()) fail(409,'Reserva inválida ou expirada.');
    const costs=jobCosts(b,j);
    if(m[2]==='fallback') {
      if(j.searchProvider!=='aisa') fail(409,'Apenas falhas da busca principal podem solicitar Apify.');
      Object.assign(j,costs);j.status='aguardando_backup';j.error=text(b.error,'erro da AISA',1000,true);j.aisaError=j.error;
      delete j.leaseToken;delete j.leaseUntil;put('jobs',j);audit(role,'pesquisa.aguardando_backup',j.id);return {id:j.id,status:j.status};
    }
    if(m[2]==='progress') {Object.assign(j,costs);j.leaseUntil=new Date(Date.now()+15*60_000).toISOString();put('jobs',j);return {id:j.id,leaseUntil:j.leaseUntil};}
    if(m[2]==='fail') {Object.assign(j,costs);j.status='falhou';j.completedAt=now();j.error=text(b.error,'erro',1000,true);delete j.leaseToken;put('jobs',j);audit(role,'pesquisa.falhou',j.id);return {id:j.id,status:j.status};}
    if(!Array.isArray(b.leads)||b.leads.length>j.limit||typeof b.actualCost!=='number'||!Number.isFinite(b.actualCost)||b.actualCost<0) fail(400,'Resultados ou custo inválidos.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const imported=[],duplicates=[];
      for(const entry of b.leads) {
        if(!Array.isArray(entry.sources)||!entry.sources.length||entry.sources.length>10) fail(400,'Todo lead pesquisado precisa de fontes.');
        const sources=entry.sources.map(s=>({url:url(text(s.url,'fonte',2000,true)),checkedAt:now()}));
        let d;try{d=leadData({...entry,stage:'novo',blocked:false});}catch(e){if(e.status===409){duplicates.push(e.message);continue;}throw e;}
        const l=put('leads',{...d,id:randomUUID(),origin:'hermes',searchProvider:j.searchProvider||'aisa',createdAt:now(),updatedAt:now(),sources,jobId:j.id});imported.push(l.id);
      }
      Object.assign(j,costs);j.results=imported;j.duplicates=duplicates;j.status='concluida';j.actualCost=b.actualCost;j.budgetExceeded=b.actualCost>j.budget;j.completedAt=now();delete j.leaseToken;put('jobs',j);audit(role,'pesquisa.concluida',j.id);db.exec('COMMIT');return {id:j.id,status:j.status,imported:imported.length,duplicates};
    } catch(e){db.exec('ROLLBACK');throw e;}
  }
  if(method==='POST' && p==='/api/agent/decisions') {
    if(role!=='agent') fail(403,'Use o token do agente.');const l=required('leads',b.leadId);
    const decision=put('decisions',{id:randomUUID(),leadId:l.id,question:text(b.question,'pergunta',1000,true),answer:text(b.answer,'resposta',2000,true),model:text(b.model,'modelo',180,true),provider:opt(b.provider,'provedor',120),source:'relatado_pelo_worker',createdAt:now()});audit(role,'decisao.registrada',decision.id);return decision;
  }
  if(method==='GET' && p==='/api/email/settings') {
    admin(role);
    const cfg=emailSettings();
    return {...cfg, enviadosHoje:enviadosHoje(), restante:Math.max(0,Number(cfg.dailyLimit)-enviadosHoje()-reservados())};
  }
  if(method==='PATCH' && p==='/api/email/settings') {
    admin(role);
    const atual=emailSettings(), patch={};
    if(b.from!==undefined) { const f=text(b.from,'remetente',254,true).toLowerCase(); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f)) fail(400,'Remetente inválido.'); patch.from=f; }
    if(b.fromName!==undefined) patch.fromName=opt(b.fromName,'nome do remetente',120);
    if(b.testMode!==undefined) { if(typeof b.testMode!=='boolean') fail(400,'Modo de teste inválido.'); patch.testMode=b.testMode; }
    if(b.testRecipient!==undefined) { const t=opt(b.testRecipient,'destinatário de teste',254).toLowerCase(); if(t&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) fail(400,'E-mail de teste inválido.'); patch.testRecipient=t; }
    if(b.dailyLimit!==undefined) { const n=Number(b.dailyLimit); if(!Number.isInteger(n)||n<1||n>500) fail(400,'Limite diário deve ser um inteiro entre 1 e 500.'); patch.dailyLimit=n; }
    const salvo=saveEmailSettings(patch); audit(role,'email.configurado','email');
    return {...salvo, enviadosHoje:enviadosHoje(), restante:Math.max(0,Number(salvo.dailyLimit)-enviadosHoje())};
  }
  if(method==='GET' && p==='/api/outbox') { admin(role); return all('outbox').slice(0,200); }
  // Integrações com chave: apify, aisa, openrouter (Jev), resend (e-mail) e hermes.
  if(method==='POST' && p==='/api/integrations/hermes/connect') {
    admin(role);
    try {
      const res = await connectHermes();
      audit(role, 'integracao.hermes.conectada', 'hermes');
      return { ok: true, connected: true, ...res, message: 'Hermes conectado com sucesso.' };
    } catch(e) {
      audit(role, 'integracao.hermes.falhou', 'hermes');
      fail(500, e.message || 'Falha ao conectar com o Hermes.');
    }
  }
  if(method==='GET' && p==='/api/integrations/hermes') {
    admin(role);
    return await workerStatus();
  }
  if(method==='POST' && p==='/api/integrations/hermes/test') {
    admin(role);
    try {
      const profileData = salesHermesProfile();
      const res = await inspectHermes({ url: process.env.HERMES_URL || 'http://127.0.0.1:8642', key: profileData.key, profile: profileData.profile });
      audit(role, 'integracao.hermes.testada', 'hermes');
      return { ok: true, detail: 'Hermes ativo e conectado com segurança.' };
    } catch(e) {
      audit(role, 'integracao.hermes.teste_falhou', 'hermes');
      return { ok: false, detail: e.message || 'Hermes indisponível.' };
    }
  }
  m=p.match(/^\/api\/integrations\/([a-z]+)$/);
  if(m && INTEGRATIONS[m[1]]) {
    admin(role);
    const service=m[1], spec=INTEGRATIONS[service];
    if(method==='GET') return integrationStatus(service);
    if(method==='POST') {
      const token=apiToken(service,b.token);
      writeEnvVar(hermesEnvFile, spec.key, token);
      audit(role,`integracao.${service}.atualizada`,service);
      return integrationStatus(service);
    }
    if(method==='DELETE') {
      removeEnvVar(hermesEnvFile, spec.key);
      audit(role,`integracao.${service}.removida`,service);
      return integrationStatus(service);
    }
  }
  // Teste de conexão: usa a chave gravada e faz uma chamada real ao provedor.
  m=p.match(/^\/api\/integrations\/([a-z]+)\/test$/);
  if(method==='POST' && m && INTEGRATIONS[m[1]]) {
    admin(role);
    const service=m[1], spec=INTEGRATIONS[service];
    const token=envValue(hermesEnvFile, spec.key);
    if(!token) fail(400,`Salve a chave de ${spec.label} antes de testar.`);
    try {
      const detail=await spec.test(token);
      audit(role,`integracao.${service}.testada`,service);
      return {ok:true,detail};
    } catch(e) {
      audit(role,`integracao.${service}.teste_falhou`,service);
      return {ok:false,detail:e.message||'Falha ao contatar o provedor.'};
    }
  }
  fail(404,'Rota não encontrada.');
}
const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/favicon.svg':'favicon.svg'};
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const p=new URL(req.url,'http://localhost').pathname;
    if(p.startsWith('/api/')) {
      if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}` && req.headers.origin!==`https://${req.headers.host}`) fail(403,'Origem não permitida.');
      const b=['POST','PATCH'].includes(req.method)?await body(req):{};

      if(p==='/api/config/supabase' && req.method==='GET') {
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          url: process.env.SUPABASE_URL || null,
          anonKey: process.env.SUPABASE_ANON_KEY || null,
          enabled: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
        }));
        return;
      }

      if(p==='/api/auth/login' && req.method==='POST') {
        const email = text(b.email||'', 'email', 200, false).toLowerCase();
        const password = String(b.password||'');

        if (supabaseStore?.supabase) {
          try {
            const { data: supaAuth, error: supaErr } = await supabaseStore.supabase.auth.signInWithPassword({ email, password });
            if (supaAuth?.user && !supaErr) {
              const sessionToken = randomBytes(32).toString('hex');
              put('sessions', { id: sessionToken, userId: supaAuth.user.id, email: supaAuth.user.email, role: 'admin', expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });
              audit('admin', 'auth.supabase_login', supaAuth.user.id);
              res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
              res.end(JSON.stringify({
                token: sessionToken,
                supabaseToken: supaAuth.session?.access_token,
                user: { id: supaAuth.user.id, email: supaAuth.user.email, name: supaAuth.user.user_metadata?.name || 'Marcelo Luiz', role: 'admin' }
              }));
              return;
            }
          } catch(e) {
            // Continua para login local
          }
        }

        if(keys.admin && (password === keys.admin || email === keys.admin)) {
          const sessionToken = randomBytes(32).toString('hex');
          put('sessions', { id: sessionToken, userId: 'admin-key', email: 'admin@mlluizdevtech.com.br', role: 'admin', expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });
          audit('admin', 'auth.login_fallback', 'admin');
          res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
          res.end(JSON.stringify({ token: sessionToken, user: { id: 'admin-key', email: 'admin@mlluizdevtech.com.br', name: 'Marcelo Luiz', role: 'admin' } }));
          return;
        }
        const user = all('users').find(u => u.email.toLowerCase() === email);
        if(!user || !verifyPassword(password, user.passwordHash)) {
          fail(401, 'E-mail ou senha inválidos.');
        }
        const sessionToken = randomBytes(32).toString('hex');
        put('sessions', { id: sessionToken, userId: user.id, email: user.email, role: user.role || 'admin', expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });
        audit(user.role || 'admin', 'auth.login', user.id);
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({ token: sessionToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } }));
        return;
      }

      if(p==='/api/auth/logout' && req.method==='POST') {
        const v=(req.headers.authorization||'').replace(/^Bearer /,'');
        if(v) del('sessions', v);
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({ok:true}));
        return;
      }

      if(p==='/api/auth/change-password' && req.method==='POST') {
        const role = auth(req);
        if(!role) fail(401, 'Entre com o token de administrador.');
        const currentPassword = String(b.currentPassword||'');
        const newPassword = String(b.newPassword||'');
        if(!newPassword || newPassword.length < 6) fail(400, 'A nova senha deve ter no mínimo 6 caracteres.');
        const v = (req.headers.authorization||'').replace(/^Bearer /,'');
        const sess = get('sessions', v);
        const user = sess ? get('users', sess.userId) : all('users')[0];
        if(!user) fail(404, 'Usuário não encontrado.');
        if(!verifyPassword(currentPassword, user.passwordHash)) fail(400, 'Senha atual incorreta.');
        put('users', { ...user, passwordHash: hashPassword(newPassword), updatedAt: now() });
        audit(role, 'auth.senha_alterada', user.id);
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({ ok: true, message: 'Senha alterada com sucesso.' }));
        return;
      }

      const role=auth(req);if(!role) fail(401,'Entre com o token de administrador.');
      const result=await dispatch(req.method,p,b,role);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(result));return;
    }
    if(req.method!=='GET'||!files[p]) fail(404,'Página não encontrada.');
    const f=files[p],mime=f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.svg')?'image/svg+xml':'text/html';
    res.writeHead(200,{'Content-Type':mime+'; charset=utf-8'});res.end(readFileSync(path.join(root,'public',f)));
  } catch(e) {res.writeHead(e.status||500,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:e.status?e.message:'Erro interno.'}));if(!e.status) console.error(e);}
});
server.listen(Number(process.env.PORT||3080),process.env.HOST||'127.0.0.1',()=>console.log(`CRM local: http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||3080}\nTokens locais: ${keyFile}\nE-mail via Resend: envio habilitado mediante configuração e aprovação; modo de teste por padrão.`));
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0);}));
