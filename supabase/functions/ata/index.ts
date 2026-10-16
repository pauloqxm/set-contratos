// Função "ata": confere o login do SSO e lê ou grava as atas com a chave de serviço.
// Publicar com a verificação de JWT do Supabase desligada: quem confere o acesso é o token do SSO.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const ISSUER = "https://sso.idt.org.br/";
const CLIENT_ID = Deno.env.get("SSO_CLIENT_ID") ?? "set_contratos";
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

async function usuario(req: Request): Promise<{ sub: string; nome: string } | null> {
  const token = req.headers.get("x-sso-token") ?? "";
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: ISSUER, audience: CLIENT_ID });
    const email = String(payload.email || req.headers.get("x-sso-email") || "").trim();
    const nome = String(payload.name || req.headers.get("x-sso-name") || email).trim();
    return { sub: String(payload.sub), nome };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

  const user = await usuario(req);
  if (!user) return json(req, 401, { erro: "Entre pelo SSO para usar a ata." });

  if (req.method === "GET") {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      const { data, error } = await db
        .from("ata_reunioes")
        .select("id, titulo, data, autor_nome, responsavel_nome, atualizada_em")
        .order("data", { ascending: false })
        .order("atualizada_em", { ascending: false })
        .limit(50);
      if (error) return json(req, 500, { erro: error.message });
      return json(req, 200, { atas: data });
    }

    const { data: ata, error } = await db.from("ata_reunioes").select("*").eq("id", id).maybeSingle();
    if (error) return json(req, 500, { erro: error.message });
    if (!ata) return json(req, 404, { erro: "Ata não encontrada." });
    const { data: itens, error: itensError } = await db
      .from("ata_itens")
      .select("nup, contrato, contratada, objeto, tempo, texto")
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
    const { data, error } = await db.rpc("ata_salvar", {
      p_ata: body,
      p_autor_sub: user.sub,
      p_autor_nome: user.nome,
    });
    if (error) return json(req, 500, { erro: error.message });
    return json(req, 200, { id: data });
  }

  return json(req, 405, { erro: "Método não permitido." });
});
