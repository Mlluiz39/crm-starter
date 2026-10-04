import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no .env');
  process.exit(1);
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const sqlitePath = path.resolve('data/crm.sqlite');

async function migrate() {
  if (!fs.existsSync(sqlitePath)) {
    console.log('Arquivo SQLite não encontrado em:', sqlitePath);
    return;
  }

  // Verifica se a tabela records existe no Supabase
  const testRes = await supabase.from('records').select('kind').limit(1);
  if (testRes.error) {
    console.error('Erro ao acessar a tabela records no Supabase:', testRes.error.message);
    console.error('Certifique-se de executar o script SQL em scripts/supabase-schema.sql no painel Supabase.');
    process.exit(1);
  }

  console.log('Lendo dados do SQLite...');
  const db = new DatabaseSync(sqlitePath);
  const rows = db.prepare('SELECT kind, id, payload FROM records').all();
  console.log(`Encontrados ${rows.length} registros no SQLite.`);

  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).map(r => {
      let parsed;
      try {
        parsed = JSON.parse(r.payload);
      } catch {
        parsed = { raw: r.payload };
      }
      return {
        kind: r.kind,
        id: r.id,
        payload: parsed,
      };
    });

    const { error } = await supabase.from('records').upsert(batch, { onConflict: 'kind,id' });
    if (error) {
      console.error(`Erro ao migrar lote ${i} - ${i + batch.length}:`, error.message);
    } else {
      console.log(`Migrado com sucesso: registros ${i + 1} a ${Math.min(i + batchSize, rows.length)}`);
    }
  }

  console.log('Migração concluída com sucesso!');
}

migrate().catch(e => {
  console.error('Falha na migração:', e);
  process.exit(1);
});
