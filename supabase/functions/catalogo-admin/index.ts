import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SECRET_BUNDLE = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_USER_ID = "4b9a0233-6b72-4573-aebd-d596c5b15e1b";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

type CatalogConfigRow = {
  comercio_id: string;
  bloqueado: boolean;
  motivo_bloqueio: string | null;
  modalidades: string[];
  metodos_pagamento: string[];
  criado_em: string;
};
type SubscriptionRow = { comercio_id: string; status: string; expira_em: string | null; criado_em: string };
type PublishedCommerceRow = { local_id: string; status: string };

let serviceKey = "";
try {
  const parsed = SECRET_BUNDLE ? JSON.parse(SECRET_BUNDLE) : null;
  serviceKey = parsed?.default || parsed?.service_role || "";
} catch (error) {
  console.error("Unable to parse configured Supabase service key bundle.", String(error));
}
if (!serviceKey) serviceKey = SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !serviceKey) throw new Error("Required Supabase server configuration is missing.");

const admin = createClient(SUPABASE_URL, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

function slug(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "perfil";
}

function recordMatchesCommerce(record: Record<string, unknown>, commerceId: string): boolean {
  const candidates = [
    record.local_id,
    record.id_publico,
    record.slug,
    record.comercio_id,
    slug(record.nome),
  ].map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean);
  return candidates.includes(commerceId.toLowerCase());
}

async function verifyBearer(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return { user: data.user, token };
}

async function verifyCommerceOwner(userId: string, commerceId: string) {
  if (!/^[a-z0-9-]{1,180}$/.test(commerceId)) {
    return { valid: false, reason: "Identificador do comércio inválido." };
  }

  const { data: published, error: publishedError } = await admin
    .from("comercios_publicados")
    .select("local_id,status")
    .eq("local_id", commerceId)
    .maybeSingle();
  if (publishedError) throw new Error(`Falha ao validar comércio publicado: ${publishedError.message}`);
  if (!published || published.status !== "ativo") {
    return { valid: false, reason: "Este comércio não está publicado e ativo." };
  }

  const { data: registrations, error: registrationError } = await admin
    .from("cadastros_comercios")
    .select("id,usuario_id,nome,status,local_id")
    .eq("usuario_id", userId)
    .eq("status", "aprovado")
    .limit(100);
  if (registrationError) throw new Error(`Falha ao consultar vínculo do proprietário: ${registrationError.message}`);

  const record = (registrations || []).find((item: Record<string, unknown>) => recordMatchesCommerce(item, commerceId));
  if (!record) return { valid: false, reason: "A conta não está vinculada a este comércio aprovado." };
  return { valid: true, record };
}

async function ensureCatalog(userId: string, commerceId: string, createIfMissing = false) {
  const { data: existing, error: lookupError } = await admin
    .from("catalogos")
    .select("comercio_id,proprietario_id,bloqueado,motivo_bloqueio")
    .eq("comercio_id", commerceId)
    .maybeSingle();
  if (lookupError) throw new Error(`Falha ao consultar configuração do catálogo: ${lookupError.message}`);
  if (existing && existing.proprietario_id !== userId) {
    return { allowed: false, exists: true, blocked: false, reason: "O comércio já está vinculado a outra conta." };
  }

  if (!existing) {
    if (!createIfMissing) return { allowed: true, exists: false, blocked: false, reason: null };
    const { error: insertError } = await admin.from("catalogos").insert({
      comercio_id: commerceId,
      proprietario_id: userId,
      modalidades: ["retirada"],
      metodos_pagamento: ["pix"],
    });
    if (insertError && insertError.code !== "23505") {
      throw new Error(`Falha ao preparar catálogo: ${insertError.message}`);
    }
    if (insertError?.code === "23505") {
      const { data: raced, error: raceError } = await admin
        .from("catalogos")
        .select("comercio_id,proprietario_id,bloqueado,motivo_bloqueio")
        .eq("comercio_id", commerceId)
        .maybeSingle();
      if (raceError) throw new Error(`Falha ao confirmar vínculo do catálogo: ${raceError.message}`);
      if (!raced || raced.proprietario_id !== userId) {
        return { allowed: false, exists: true, blocked: false, reason: "O comércio já está vinculado a outra conta." };
      }
      return { allowed: true, exists: true, blocked: Boolean(raced.bloqueado), reason: raced.motivo_bloqueio || null };
    }
    return { allowed: true, exists: true, blocked: false, reason: null };
  }

  return { allowed: true, exists: true, blocked: Boolean(existing.bloqueado), reason: existing.motivo_bloqueio || null };
}

async function subscriptionState(commerceId: string) {
  const { data: active, error: activeError } = await admin
    .from("catalogo_assinaturas")
    .select("id,status,expira_em")
    .eq("comercio_id", commerceId)
    .eq("status", "ativa")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeError) throw new Error(`Falha ao consultar assinatura: ${activeError.message}`);

  if (active && (!active.expira_em || Date.parse(active.expira_em) > Date.now())) {
    return { ativo: true, assinatura_status: "ativa" };
  }

  const { data: pending, error: pendingError } = await admin
    .from("catalogo_assinaturas")
    .select("id,status")
    .eq("comercio_id", commerceId)
    .eq("status", "pendente")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingError) throw new Error(`Falha ao consultar solicitação pendente: ${pendingError.message}`);
  if (pending) return { ativo: false, assinatura_status: "pendente" };

  const { data: previous, error: previousError } = await admin
    .from("catalogo_assinaturas")
    .select("status,expira_em")
    .eq("comercio_id", commerceId)
    .in("status", ["cancelada", "expirada", "ativa"])
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previousError) throw new Error(`Falha ao consultar histórico da assinatura: ${previousError.message}`);
  if (previous?.status === "ativa" && previous.expira_em && Date.parse(previous.expira_em) <= Date.now()) {
    return { ativo: false, assinatura_status: "expirada" };
  }
  return { ativo: false, assinatura_status: previous?.status || "sem_assinatura" };
}

async function solicitarAtivacao(commerceId: string) {
  const current = await subscriptionState(commerceId);
  if (current.ativo) return { solicitacao_registrada: true, assinatura_status: "ativa", ativo: true };
  if (current.assinatura_status === "pendente") {
    return { solicitacao_registrada: true, assinatura_status: "pendente", ativo: false };
  }

  const { error } = await admin.from("catalogo_assinaturas").insert({
    comercio_id: commerceId,
    status: "pendente",
    valor: null,
    gateway: null,
    cobranca_id: null,
    metadata: { modo: "demonstracao", cobranca_criada: false },
  });
  if (error && error.code !== "23505") throw new Error(`Falha ao registrar interesse: ${error.message}`);
  const after = await subscriptionState(commerceId);
  return { solicitacao_registrada: after.assinatura_status === "pendente" || after.ativo, assinatura_status: after.assinatura_status, ativo: after.ativo };
}

async function listarCatalogosAdmin() {
  const { data: configs, error: configError } = await admin.from("catalogos")
    .select("comercio_id,bloqueado,motivo_bloqueio,modalidades,metodos_pagamento,criado_em")
    .order("comercio_id", { ascending: true })
    .limit(500);
  if (configError) throw new Error(`Falha ao listar catálogos: ${configError.message}`);
  const rows = (configs || []) as CatalogConfigRow[];
  if (!rows.length) return [];
  const ids = rows.map((row) => row.comercio_id);
  const [{ data: subscriptions, error: subscriptionError }, { data: businesses, error: businessError }] = await Promise.all([
    admin.from("catalogo_assinaturas").select("comercio_id,status,expira_em,criado_em")
      .in("comercio_id", ids).order("criado_em", { ascending: false }).limit(2000),
    admin.from("comercios_publicados").select("local_id,status").in("local_id", ids).limit(1000),
  ]);
  if (subscriptionError) throw new Error(`Falha ao listar assinaturas: ${subscriptionError.message}`);
  if (businessError) throw new Error(`Falha ao validar publicação: ${businessError.message}`);

  const now = Date.now();
  const subscriptionRows = (subscriptions || []) as SubscriptionRow[];
  const businessRows = (businesses || []) as PublishedCommerceRow[];
  const subscriptionsByCommerce = new Map<string, SubscriptionRow[]>();
  for (const subscription of subscriptionRows) {
    const group = subscriptionsByCommerce.get(subscription.comercio_id) || [];
    group.push(subscription);
    subscriptionsByCommerce.set(subscription.comercio_id, group);
  }
  const businessStatus = new Map<string, string>(businessRows.map((row) => [row.local_id, row.status]));

  return rows.map((config: CatalogConfigRow) => {
    const history = subscriptionsByCommerce.get(config.comercio_id) || [];
    const active = history.find((item) => item.status === "ativa" && (!item.expira_em || Date.parse(item.expira_em) > now));
    const pending = history.find((item) => item.status === "pendente");
    const expiredActive = history.find((item) => item.status === "ativa" && item.expira_em && Date.parse(item.expira_em) <= now);
    const expired = history.find((item) => item.status === "expirada");
    const latest = history[0];
    const assinaturaStatus = active ? "ativa" : pending ? "pendente" : expiredActive || expired ? "expirada" : latest?.status || "sem_assinatura";
    const catalogoAtivo = Boolean(active && !config.bloqueado && businessStatus.get(config.comercio_id) === "ativo");
    return {
      ...config,
      assinatura_status: assinaturaStatus,
      expira_em: active?.expira_em || null,
      catalogo_ativo: catalogoAtivo,
      comercio_publicado: businessStatus.get(config.comercio_id) === "ativo",
    };
  });
}

async function adminAction(userId: string, body: Record<string, unknown>) {
  if (userId !== ADMIN_USER_ID) return json({ success: false, mensagem: "Ação administrativa não autorizada." }, 403);
  if (body.acao === "admin_listar_catalogos") {
    return json({ success: true, catalogos: await listarCatalogosAdmin() });
  }
  const commerceId = String(body.comercio_id || "").trim();
  if (!/^[a-z0-9-]{1,180}$/.test(commerceId)) return json({ success: false, mensagem: "Identificador do comércio inválido." }, 400);
  if (body.acao === "admin_bloquear_catalogo") {
    const bloqueado = Boolean(body.bloqueado);
    const motivo = String(body.motivo_bloqueio || "").trim().slice(0, 500) || null;
    const { data, error } = await admin.from("catalogos")
      .update({ bloqueado, motivo_bloqueio: bloqueado ? motivo : null })
      .eq("comercio_id", commerceId)
      .select("comercio_id,bloqueado,motivo_bloqueio")
      .maybeSingle();
    if (error) throw new Error(`Falha ao atualizar bloqueio: ${error.message}`);
    if (!data) return json({ success: false, mensagem: "Catálogo não encontrado." }, 404);
    return json({ success: true, ...data });
  }
  return json({ success: false, mensagem: "Ação administrativa desconhecida." }, 400);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ success: false, mensagem: "Use POST." }, 405);

  const authenticated = await verifyBearer(request);
  if (!authenticated) return json({ success: false, mensagem: "Sessão ausente ou inválida." }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.acao || "");
    if (action.startsWith("admin_")) return await adminAction(authenticated.user.id, body);

    const commerceId = String(body?.comercio_id || "").trim();
    if (!commerceId) return json({ success: false, mensagem: "Informe o comércio." }, 400);
    if (!["verificar_proprietario", "solicitar_ativacao"].includes(action)) {
      return json({ success: false, mensagem: "Ação não reconhecida." }, 400);
    }

    if (authenticated.user.id === ADMIN_USER_ID && action === "verificar_proprietario") {
      if (!/^[a-z0-9-]{1,180}$/.test(commerceId)) return json({ proprietario: false, mensagem: "Identificador do comércio inválido." }, 400);
      const ownership = await verifyCommerceOwner(authenticated.user.id, commerceId);
      if (ownership.valid) {
        const catalog = await ensureCatalog(authenticated.user.id, commerceId, false);
        if (!catalog.allowed) return json({ proprietario: false, admin: true, mensagem: catalog.reason }, 403);
        const state = await subscriptionState(commerceId);
        return json({
          proprietario: true,
          admin: true,
          ativo: state.ativo && !catalog.blocked,
          bloqueado: catalog.blocked,
          motivo_bloqueio: catalog.reason,
          assinatura_status: state.assinatura_status,
          catalogo_configurado: catalog.exists,
          modo_demonstracao: true,
        });
      }

      const { data: config, error: configError } = await admin.from("catalogos")
        .select("comercio_id,bloqueado,motivo_bloqueio")
        .eq("comercio_id", commerceId)
        .maybeSingle();
      if (configError) throw new Error(`Falha ao validar acesso administrativo: ${configError.message}`);
      if (!config) return json({ proprietario: false, admin: true, admin_catalog_access: false, mensagem: "Este comércio ainda não possui configuração de catálogo." }, 404);
      const state = await subscriptionState(commerceId);
      return json({ proprietario: false, admin: true, admin_catalog_access: true, ativo: state.ativo && !config.bloqueado, bloqueado: config.bloqueado, motivo_bloqueio: config.motivo_bloqueio, assinatura_status: state.assinatura_status });
    }

    const ownership = await verifyCommerceOwner(authenticated.user.id, commerceId);
    if (!ownership.valid) {
      return json({ proprietario: false, mensagem: ownership.reason || "Proprietário não confirmado." }, 403);
    }

    const catalog = await ensureCatalog(authenticated.user.id, commerceId, action === "solicitar_ativacao");
    if (!catalog.allowed) return json({ proprietario: false, mensagem: catalog.reason }, 403);
    if (action === "verificar_proprietario" && !catalog.exists) {
      return json({ proprietario: true, ativo: false, bloqueado: false, assinatura_status: "sem_assinatura", modo_demonstracao: true });
    }
    const subscription = await subscriptionState(commerceId);

    if (action === "verificar_proprietario") {
      return json({
        proprietario: true,
        ativo: subscription.ativo && !catalog.blocked,
        bloqueado: catalog.blocked,
        motivo_bloqueio: catalog.reason,
        assinatura_status: subscription.assinatura_status,
        modo_demonstracao: true,
      });
    }

    if (catalog.blocked) {
      return json({ solicitacao_registrada: false, proprietario: true, bloqueado: true, mensagem: "O catálogo está bloqueado pelo administrador." }, 403);
    }
    const result = await solicitarAtivacao(commerceId);
    return json({
      ...result,
      proprietario: true,
      bloqueado: false,
      modo_demonstracao: true,
      cobranca_criada: false,
      pix_gerado: false,
      mensagem: "Interesse registrado sem cobrança Pix e sem ativação de assinatura.",
    });
  } catch (error) {
    console.error("catalogo-admin failed:", (error as Error).message);
    return json({ success: false, mensagem: "Não foi possível concluir a operação. Tente novamente mais tarde." }, 500);
  }
});
