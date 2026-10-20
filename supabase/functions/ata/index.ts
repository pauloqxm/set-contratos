// Função "ata": confere o login do SSO e lê ou grava as atas com a chave de serviço.
// Publicar com a verificação de JWT do Supabase desligada: quem confere o acesso é o token do SSO.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const ISSUER = "https://sso.idt.org.br/";
const CLIENT_IDS = (Deno.env.get("SSO_CLIENT_ID") ?? "set_contratos,set_contratos_2")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://set-contratos.up.railway.app,http://127.0.0.1:8080,http://localhost:8080")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

const jwks = createRemoteJWKSet(new URL(`${ISSUER}.well-known/jwks`));
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-sso-token, x-sso-name, x-sso-email, x-ata-token",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    Vary: "Origin",
  };
  if (ORIGINS.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

const VERSAO = "2026-10-19-diversa";

function tipoAta(valor: unknown): "comite" | "diversa" | "contratos" {
  const tipo = String(valor || "").trim().toLowerCase();
  if (tipo === "comite" || tipo === "diversa") return tipo;
  return "contratos";
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

async function exigirToken(req: Request): Promise<string | null> {
  const token = (req.headers.get("x-ata-token") ?? "").trim();
  if (!token) return "Para alterar ou excluir uma ata salva, informe o token de edição.";
  const url = Deno.env.get("ATA_TOKEN_URL") ?? "https://set-contratos.up.railway.app/api/validar-token";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "x-ata-token": token },
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 204) return null;
    if (response.status === 403) return "O token de edição não confere.";
  } catch {
    /* o site que guarda o token não respondeu */
  }
  return "Não foi possível confirmar o token de edição.";
}

function audiencia(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.map(String);
  return valor ? [String(valor)] : [];
}

async function usuario(req: Request): Promise<{ sub: string; nome: string } | { erro: string }> {
  const token = req.headers.get("x-sso-token") ?? "";
  if (!token) return { erro: "A ata não recebeu o login do SSO." };
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: ISSUER, clockTolerance: 60 });
    const auds = audiencia(payload.aud);
    const azp = String(payload.azp || payload.client_id || "");
    if (!CLIENT_IDS.some((id) => auds.includes(id) || azp === id)) {
      const recebido = [...new Set([...auds, azp].filter(Boolean))].join(", ") || "vazio";
      return { erro: `O login do SSO não é desta aplicação (recebido: ${recebido}).` };
    }
    const email = String(payload.email || req.headers.get("x-sso-email") || "").trim();
    const nome = String(payload.name || req.headers.get("x-sso-name") || email).trim();
    return { sub: String(payload.sub), nome };
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : "token recusado";
    return { erro: `O login do SSO foi recusado (${detalhe}).` };
  }
}

const ENCERRADOS = ["Concluído", "Não se aplica"];
const PRIORIDADE: Record<string, number> = { "Crítica": 0, Alta: 1, "Média": 2, Baixa: 3 };

// Pauta do Comitê Executivo: projetos ativos e os itens ainda abertos de cada um. Só leitura.
async function pautaComite(req: Request): Promise<Response> {
  const { data: projetos, error } = await db
    .from("projetos")
    .select("id, nome, descricao, prazo_conclusao")
    .eq("ativo", 1)
    .order("nome");
  if (error) return json(req, 500, { erro: error.message });
  const ids = (projetos ?? []).map((projeto) => projeto.id);
  const { data: itens, error: itensError } = ids.length
    ? await db
      .from("itens")
      .select("id, projeto_id, frente, entrega, responsavel, parceiros, prioridade, prazo, prazo_hora, status, proxima, obs, nup, atualizado_em")
      .in("projeto_id", ids)
    : { data: [], error: null };
  if (itensError) return json(req, 500, { erro: itensError.message });
  const abertos = (itens ?? [])
    .filter((item) => !ENCERRADOS.includes(String(item.status ?? "").trim()))
    .sort((a, b) =>
      (PRIORIDADE[a.prioridade] ?? 4) - (PRIORIDADE[b.prioridade] ?? 4) ||
      String(a.prazo || "9999").localeCompare(String(b.prazo || "9999"))
    );
  return json(req, 200, {
    projetos: (projetos ?? []).map((projeto) => ({
      ...projeto,
      itens: abertos.filter((item) => item.projeto_id === projeto.id),
    })),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

  const user = await usuario(req);
  if ("erro" in user) return json(req, 401, { erro: user.erro });

  if (req.method === "GET") {
    const params = new URL(req.url).searchParams;
    if (params.get("pauta") === "comite") return pautaComite(req);
    const id = params.get("id");
    if (!id) {
      const tipo = tipoAta(params.get("tipo"));
      const { data, error } = await db
        .from("ata_reunioes")
        .select("id, titulo, data, tipo, inicio, fim, autor_nome, responsavel_nome, atualizada_em")
        .eq("tipo", tipo)
        .order("data", { ascending: false })
        .order("atualizada_em", { ascending: false })
        .limit(50);
      if (error) return json(req, 500, { erro: error.message });
      return json(req, 200, { atas: data, versao: VERSAO });
    }

    const { data: ata, error } = await db.from("ata_reunioes").select("*").eq("id", id).maybeSingle();
    if (error) return json(req, 500, { erro: error.message });
    if (!ata) return json(req, 404, { erro: "Ata não encontrada." });
    const { data: itens, error: itensError } = await db
      .from("ata_itens")
      .select("nup, contrato, contratada, objeto, tempo, texto, ref, responsaveis, encaminhamentos, anexo")
      .eq("reuniao_id", id)
      .order("ordem");
    if (itensError) return json(req, 500, { erro: itensError.message });
    return json(req, 200, { ata: { ...ata, itens } });
  }

  if (req.method === "DELETE") {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return json(req, 400, { erro: "Informe a ata que será excluída." });
    const recusa = await exigirToken(req);
    if (recusa) return json(req, 403, { erro: recusa });
    const { error } = await db.from("ata_reunioes").delete().eq("id", id);
    if (error) return json(req, 500, { erro: error.message });
    return json(req, 200, { ok: true });
  }

  if (req.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json(req, 400, { erro: "Dados da ata inválidos." });
    }
    if (!body.titulo || !body.data || !Array.isArray(body.itens)) {
      return json(req, 400, { erro: "Informe título, data e os objetos da ata." });
    }
    if (body.id) {
      const recusa = await exigirToken(req);
      if (recusa) return json(req, 403, { erro: recusa });
    }
    const tipo = tipoAta(body.tipo);
    body.tipo = tipo;
    const { data, error } = await db.rpc("ata_salvar", {
      p_ata: body,
      p_autor_sub: user.sub,
      p_autor_nome: user.nome,
    });
    if (error) return json(req, 500, { erro: error.message });
    if (tipo !== "contratos") {
      const { error: tipoError } = await db.from("ata_reunioes").update({ tipo }).eq("id", data);
      if (tipoError) return json(req, 500, { erro: tipoError.message });
    }
    const { data: gravada, error: lerError } = await db.from("ata_reunioes").select("tipo").eq("id", data).maybeSingle();
    if (lerError) return json(req, 500, { erro: lerError.message });
    return json(req, 200, { id: data, tipo: gravada?.tipo ?? "", versao: VERSAO });
  }

  return json(req, 405, { erro: "Método não permitido." });
});
