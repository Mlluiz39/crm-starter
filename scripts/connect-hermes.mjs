#!/usr/bin/env node
import { execSync, execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, openSync, chmodSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { salesHermesProfile, inspectHermes } from './hermes-sales.mjs';

export function findHermesBin() {
  try {
    const out = execSync('which hermes', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out && existsSync(out)) return out;
  } catch {}

  const candidates = [
    path.join(os.homedir(), '.local/bin/hermes'),
    path.join(os.homedir(), '.hermes/hermes-agent/.hermes/bin/hermes'),
    '/usr/local/bin/hermes',
    '/usr/bin/hermes'
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  return null;
}

export async function ensureHermesInstalled({ log = console.log } = {}) {
  const internalHermes = path.join(os.homedir(), '.hermes/hermes-agent/.hermes/bin/hermes');
  const localBin = path.join(os.homedir(), '.local/bin');
  const targetBin = path.join(localBin, 'hermes');

  if (existsSync(internalHermes)) {
    try {
      execSync(`mkdir -p "${localBin}"`);
      writeFileSync(targetBin, `#!/bin/sh\nexec "${internalHermes}" "$@"\n`, { mode: 0o755 });
      chmodSync(targetBin, 0o755);
      log?.(`Hermes binário configurado em ${targetBin}`);
      return targetBin;
    } catch {}
  }

  log?.('Instalando Hermes via script oficial...');
  try {
    execSync('curl -fsSL https://raw.githubusercontent.com/NousResearch/Hermes-Agent/main/setup.sh | bash', {
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const found = findHermesBin();
    if (found) return found;
  } catch (err) {
    log?.(`Falha na instalação automática: ${err.message}`);
  }

  throw new Error('Hermes não está instalado no sistema e não foi possível instalá-lo automaticamente.');
}

export function ensureSalesProfile({ log = console.log } = {}) {
  const root = path.resolve('.');
  const salesHome = process.env.HERMES_SALES_HOME || path.resolve(root, 'data/hermes-sales');
  const configYaml = path.join(salesHome, 'config.yaml');
  const envFile = path.join(salesHome, '.env');

  if (!existsSync(configYaml) || !existsSync(envFile)) {
    log?.('Configurando perfil isolado de vendas para Hermes...');
    execFileSync('python3', [path.join(root, 'scripts/prepare-sales-hermes.py')], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }
}

export async function restartGateway({ hermesBin, home, log = console.log } = {}) {
  const pidFile = path.join(home, 'gateway.pid');

  try {
    execSync(`HERMES_HOME="${home}" "${hermesBin}" gateway stop 2>/dev/null || true`, { stdio: 'ignore' });
  } catch {}

  // Verifica e libera a porta 8642 se estiver ocupada
  try {
    const fuser = execSync('fuser 8642/tcp 2>/dev/null', { encoding: 'utf8' }).trim();
    if (fuser) {
      log?.(`Liberando porta 8642 (PID ${fuser})...`);
      try { execSync('fuser -k 8642/tcp 2>/dev/null'); } catch {}
      await new Promise(r => setTimeout(r, 600));
    }
  } catch {}

  // Limpa arquivos de lock antigos que possam bloquear a inicialização
  for (const f of ['gateway.lock', 'gateway.sock', 'gateway.pid']) {
    const fp = path.join(home, f);
    if (existsSync(fp)) {
      try { rmSync(fp, { force: true }); } catch {}
    }
  }

  const logPath = path.join(home, 'gateway-output.log');
  const outLog = openSync(logPath, 'a');

  log?.(`Iniciando Hermes Gateway (--replace) em segundo plano...`);
  const child = spawn(hermesBin, ['gateway', 'run', '--replace'], {
    env: {
      ...process.env,
      HERMES_HOME: home,
      PATH: `${path.dirname(hermesBin)}:${process.env.PATH || ''}`
    },
    detached: true,
    stdio: ['ignore', outLog, outLog]
  });
  child.unref();
}

export async function connectHermes({ log = console.log, timeoutMs = 15000 } = {}) {
  let hermesBin = findHermesBin();
  if (!hermesBin) {
    log?.('Hermes CLI não encontrado. Tentando localizar ou instalar...');
    hermesBin = await ensureHermesInstalled({ log });
  }

  ensureSalesProfile({ log });
  const profileData = salesHermesProfile();
  const url = process.env.HERMES_URL || 'http://127.0.0.1:8642';

  try {
    const inspection = await inspectHermes({
      url,
      key: profileData.key,
      profile: profileData.profile
    });
    if (inspection?.connected) {
      log?.(`Hermes Gateway já conectado e ativo em ${url}.`);
      return { ok: true, connected: true, alreadyRunning: true, url, details: inspection };
    }
  } catch (err) {
    log?.(`Hermes não está respondendo em ${url}: ${err.message}. Reiniciando...`);
  }

  await restartGateway({ hermesBin, home: profileData.home, log });

  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const inspection = await inspectHermes({
        url,
        key: profileData.key,
        profile: profileData.profile
      });
      if (inspection?.connected) {
        log?.(`Hermes conectado com sucesso em ${url}!`);
        return { ok: true, connected: true, started: true, url, details: inspection };
      }
    } catch (err) {
      lastError = err;
      await new Promise(r => setTimeout(r, 600));
    }
  }

  throw new Error(`Hermes Gateway iniciado, mas não respondeu na porta 8642: ${lastError?.message || 'timeout'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  connectHermes({ log: console.log })
    .then(res => {
      console.log('Hermes conectado com sucesso:', res);
      process.exit(0);
    })
    .catch(err => {
      console.error('Falha ao conectar Hermes:', err);
      process.exit(1);
    });
}
