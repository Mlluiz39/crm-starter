-- =========================================================================
-- MLLuiz DevTech CRM - Supabase Migration Schema
-- Execute este script no SQL Editor do seu painel Supabase (Dashboard -> SQL Editor)
-- =========================================================================

-- 1. Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Tabela unificada records (armazena leads, conversas, mensagens, configurações, etc.)
CREATE TABLE IF NOT EXISTS public.records (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (kind, id)
);

-- 3. Índices para performance máxima de consulta
CREATE INDEX IF NOT EXISTS idx_records_kind ON public.records(kind);
CREATE INDEX IF NOT EXISTS idx_records_created_at ON public.records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_updated_at ON public.records(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_payload_gin ON public.records USING gin(payload);

-- 4. Função e trigger para manter updated_at automático
CREATE OR REPLACE FUNCTION update_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_records_updated_at ON public.records;
CREATE TRIGGER trigger_records_updated_at
    BEFORE UPDATE ON public.records
    FOR EACH ROW
    EXECUTE FUNCTION update_records_updated_at();

-- 5. Configurar Row Level Security (RLS)
ALTER TABLE public.records ENABLE ROW LEVEL SECURITY;

-- Política 1: Acesso completo para service_role (backend CRM, workers, integrações)
DROP POLICY IF EXISTS "Acesso total service_role" ON public.records;
CREATE POLICY "Acesso total service_role" ON public.records
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Política 2: Leitura e escrita para usuários autenticados via Supabase Auth
DROP POLICY IF EXISTS "Acesso completo autenticados" ON public.records;
CREATE POLICY "Acesso completo autenticados" ON public.records
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Política 3: Leitura para anon (permite Realtime receber eventos de novas mensagens no painel)
DROP POLICY IF EXISTS "Leitura anon para realtime" ON public.records;
CREATE POLICY "Leitura anon para realtime" ON public.records
    FOR SELECT
    TO anon
    USING (true);

-- 6. Habilitar publicação Realtime na tabela records
-- Isso permite ao frontend receber notificações instantâneas via WebSocket sem atrasos
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'records'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.records;
    END IF;
END $$;
