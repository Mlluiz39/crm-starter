import { createClient } from '@supabase/supabase-js';

export function createSupabaseStore({ url, serviceKey }) {
  if (!url || !serviceKey) {
    return null;
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
    realtime: {
      params: {
        eventsPerSecond: 20
      }
    }
  });

  // Cache em memória para operações síncronas ultra-rápidas
  const cache = new Map(); // `${kind}:${id}` -> payload
  let initialized = false;

  async function init() {
    try {
      const { data, error } = await supabase.from('records').select('kind, id, payload');
      if (error) {
        console.error('[Supabase Store] Erro ao carregar registros:', error.message);
        return false;
      }
      cache.clear();
      for (const row of data || []) {
        cache.set(`${row.kind}:${row.id}`, row.payload);
      }
      initialized = true;
      console.log(`[Supabase Store] ${cache.size} registros sincronizados do Supabase.`);

      // Sincronização em tempo real via Realtime WebSocket
      supabase.channel('server-records-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'records' }, (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old;
            if (old?.kind && old?.id) {
              cache.delete(`${old.kind}:${old.id}`);
            }
          } else if (payload.new?.kind && payload.new?.id) {
            cache.set(`${payload.new.kind}:${payload.new.id}`, payload.new.payload);
          }
        })
        .subscribe();

      return true;
    } catch (e) {
      console.error('[Supabase Store] Falha na inicialização:', e.message);
      return false;
    }
  }

  function all(kind) {
    const list = [];
    for (const [key, val] of cache.entries()) {
      if (key.startsWith(`${kind}:`)) {
        list.push(val);
      }
    }
    return list;
  }

  function get(kind, id) {
    return cache.get(`${kind}:${id}`) || null;
  }

  function put(kind, obj) {
    if (!obj || !obj.id) return obj;
    cache.set(`${kind}:${obj.id}`, obj);
    supabase.from('records')
      .upsert({ kind, id: obj.id, payload: obj }, { onConflict: 'kind,id' })
      .then(({ error }) => {
        if (error) console.error(`[Supabase Store] Erro ao persistir ${kind}/${obj.id}:`, error.message);
      })
      .catch(e => console.error(`[Supabase Store] Exceção ao persistir ${kind}/${obj.id}:`, e));
    return obj;
  }

  function del(kind, id) {
    const existed = cache.delete(`${kind}:${id}`);
    supabase.from('records')
      .delete()
      .eq('kind', kind)
      .eq('id', id)
      .then(({ error }) => {
        if (error) console.error(`[Supabase Store] Erro ao deletar ${kind}/${id}:`, error.message);
      })
      .catch(e => console.error(`[Supabase Store] Exceção ao deletar ${kind}/${id}:`, e));
    return existed ? 1 : 0;
  }

  function transaction(fn) {
    return fn();
  }

  return {
    init,
    all,
    get,
    put,
    del,
    transaction,
    supabase,
    isReady: () => initialized
  };
}
