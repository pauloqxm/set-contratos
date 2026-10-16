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
    "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-sso-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

type Usuario = { sub: string; nome: string; email: string };

async function usuario(req: Request): Promise<Usuario | null> {
  const token = req.headers.get("x-sso-token") ?? "";
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: ISSUER, audience: CLIENT_ID });
    const email = String(payload.email ?? "");
    return { sub: String(payload.sub), nome: String(payload.name ?? email), email };
  } catch {
    return null;
  }
}

async function registrar(user: Usuario): Promise<void> {
  await db.from("ata_pessoas").upsert(
    { sub: user.sub, nome: user.nome, email: user.email, ultimo_acesso: new Date().toISOString() },
    { onConflict: "sub" },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

  const user = await usuario(req);
  if (!user) return json(req, 401, { erro: "Entre pelo SSO para usar a ata." });
  await registrar(user);

  if (req.method === "GET") {
    const params = new URL(req.url).searchParams;
    if (params.has("pessoas")) {
      const { data, error } = await db.from("ata_pessoas").select("sub, nome, email").order("nome");
      if (error) return json(req, 500, { erro: error.message });
      return json(req, 200, { pessoas: data });
    }

    const id = params.get("id");
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
