-- Atas das reuniões do painel de contratos.
-- Executar no Supabase: SQL Editor → New query → Run
-- Projeto: ftuycoafwraxaachidlh
--
-- Não mexe nas tabelas do SET Projetos. Reexecutar é seguro e não apaga atas.
-- RLS ligado e sem políticas: a chave publicável não lê nem grava aqui.
-- Só a função "ata" (Edge Function, com a chave de serviço) acessa as tabelas.

CREATE TABLE IF NOT EXISTS public.ata_reunioes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo TEXT NOT NULL,
    data DATE NOT NULL,
    participantes TEXT NOT NULL DEFAULT '',
    duracao TEXT NOT NULL DEFAULT '',
    autor_sub TEXT NOT NULL,
    autor_nome TEXT NOT NULL DEFAULT '',
    criada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ata_itens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reuniao_id UUID NOT NULL REFERENCES public.ata_reunioes(id) ON DELETE CASCADE,
    ordem INTEGER NOT NULL,
    nup TEXT NOT NULL DEFAULT '',
    contrato TEXT NOT NULL DEFAULT '',
    contratada TEXT NOT NULL DEFAULT '',
    objeto TEXT NOT NULL DEFAULT '',
    tempo TEXT NOT NULL DEFAULT '',
    texto TEXT NOT NULL DEFAULT ''
);

ALTER TABLE public.ata_reunioes ADD COLUMN IF NOT EXISTS responsavel_sub TEXT;
ALTER TABLE public.ata_reunioes ADD COLUMN IF NOT EXISTS responsavel_nome TEXT NOT NULL DEFAULT '';
ALTER TABLE public.ata_reunioes ADD COLUMN IF NOT EXISTS inicio TEXT NOT NULL DEFAULT '';
ALTER TABLE public.ata_reunioes ADD COLUMN IF NOT EXISTS fim TEXT NOT NULL DEFAULT '';
-- tipo: 'contratos', 'comite' (Comitê Executivo) ou 'diversa' (Reunião Diversa).
ALTER TABLE public.ata_reunioes ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'contratos';
-- ref: id do projeto nas atas do Comitê.
ALTER TABLE public.ata_itens ADD COLUMN IF NOT EXISTS ref TEXT NOT NULL DEFAULT '';
ALTER TABLE public.ata_itens ADD COLUMN IF NOT EXISTS responsaveis TEXT NOT NULL DEFAULT '';
ALTER TABLE public.ata_itens ADD COLUMN IF NOT EXISTS encaminhamentos TEXT NOT NULL DEFAULT '';
ALTER TABLE public.ata_itens ADD COLUMN IF NOT EXISTS anexo TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_ata_reunioes_data ON public.ata_reunioes(data DESC);
CREATE INDEX IF NOT EXISTS idx_ata_reunioes_tipo ON public.ata_reunioes(tipo, data DESC);
CREATE INDEX IF NOT EXISTS idx_ata_itens_reuniao ON public.ata_itens(reuniao_id, ordem);

ALTER TABLE public.ata_reunioes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ata_itens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ata_reunioes, public.ata_itens FROM anon, authenticated;

-- Grava a ata e os itens numa transação só. Ao editar, os itens são substituídos.
-- O responsável é texto livre (responsavel_nome).
CREATE OR REPLACE FUNCTION public.ata_salvar(p_ata JSONB, p_autor_sub TEXT, p_autor_nome TEXT)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_id UUID := NULLIF(p_ata->>'id', '')::UUID;
    v_resp_nome TEXT := COALESCE(NULLIF(TRIM(p_ata->>'responsavel_nome'), ''), '');
    v_tipo TEXT := CASE
        WHEN p_ata->>'tipo' = 'comite' THEN 'comite'
        WHEN p_ata->>'tipo' = 'diversa' THEN 'diversa'
        ELSE 'contratos'
    END;
BEGIN
    IF v_id IS NULL THEN
        INSERT INTO ata_reunioes (titulo, data, participantes, duracao, autor_sub, autor_nome, responsavel_nome, inicio, fim, tipo)
        VALUES (
            p_ata->>'titulo',
            (p_ata->>'data')::DATE,
            COALESCE(p_ata->>'participantes', ''),
            COALESCE(p_ata->>'duracao', ''),
            p_autor_sub,
            COALESCE(p_autor_nome, ''),
            v_resp_nome,
            COALESCE(p_ata->>'inicio', ''),
            COALESCE(p_ata->>'fim', ''),
            v_tipo
        )
        RETURNING id INTO v_id;
    ELSE
        UPDATE ata_reunioes
        SET titulo = p_ata->>'titulo',
            data = (p_ata->>'data')::DATE,
            participantes = COALESCE(p_ata->>'participantes', ''),
            duracao = COALESCE(p_ata->>'duracao', ''),
            inicio = COALESCE(p_ata->>'inicio', ''),
            fim = COALESCE(p_ata->>'fim', ''),
            responsavel_nome = v_resp_nome,
            tipo = v_tipo,
            atualizada_em = now()
        WHERE id = v_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Ata não encontrada';
        END IF;
        DELETE FROM ata_itens WHERE reuniao_id = v_id;
    END IF;

    INSERT INTO ata_itens (reuniao_id, ordem, nup, contrato, contratada, objeto, tempo, texto, ref, responsaveis, encaminhamentos, anexo)
    SELECT
        v_id,
        (item.ordinality - 1)::INTEGER,
        COALESCE(item.value->>'nup', ''),
        COALESCE(item.value->>'contrato', ''),
        COALESCE(item.value->>'contratada', ''),
        COALESCE(item.value->>'objeto', ''),
        COALESCE(item.value->>'tempo', ''),
        COALESCE(item.value->>'texto', ''),
        COALESCE(item.value->>'ref', ''),
        COALESCE(item.value->>'responsaveis', ''),
        COALESCE(item.value->>'encaminhamentos', ''),
        COALESCE(item.value->>'anexo', '')
    FROM jsonb_array_elements(COALESCE(p_ata->'itens', '[]'::JSONB)) WITH ORDINALITY AS item(value, ordinality);

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ata_salvar(JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ata_salvar(JSONB, TEXT, TEXT) TO service_role;
