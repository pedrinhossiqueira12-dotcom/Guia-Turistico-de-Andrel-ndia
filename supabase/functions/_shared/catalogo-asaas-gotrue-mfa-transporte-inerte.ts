/**
 * #42 — adaptador GoTrue Auth em modo de CONTRATO. Nao ha endpoint implantado.
 *
 * Este modulo so especifica as chamadas REAIS do Supabase Auth:
 * POST /auth/v1/factors/:factor_id/challenge
 * POST /auth/v1/factors/:factor_id/verify
 * GET  /auth/v1/user
 *
 * O transport HTTP deve ser fornecido explicitamente; NAO tem fetch global
 * como fallback e NAO usa service_role. Os testes injetam um transport fake
 * com --deny-net. Este modulo, por si, NAO comprova MFA na operacao:
 * um verificador confiavel da ASSINATURA JWT + sessao revogada/ativa
 * precisa ser fornecido por um backend auditado (ainda nao implementado).
 * Nenhuma funcao financeira e importada; nenhuma prova vira permissao.
 */
import type {
  PortaDeAutenticacaoFalsa,
  SessaoAferidaEmEnsaio,
} from "./catalogo-asaas-stepup-documental-ensaio.ts";

export type VerificadorServidorAssinaturaESessao = (
  accessToken: string,
) => Promise<SessaoAferidaEmEnsaio | null>;

export interface GoTrueMfaConfigInerte {
  projectUrl: string;
  publishableKey: string;
  http: typeof fetch;
  /** NÃO usar parse JWT sem assinatura, nem so GET /user. */
  verificarAssinaturaJwtESessaoNoServidor: VerificadorServidorAssinaturaESessao;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT_BEARER = /^[A-Za-z0-9_.~-]{6,8192}$/;
function record(v: unknown): Record<string, unknown> | null {
  return !!v && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown> : null;
}
function validPrincipal(
  p: SessaoAferidaEmEnsaio | null,
): p is SessaoAferidaEmEnsaio {
  return !!p && UUID.test(p.userId) && UUID.test(p.sessionId)
    && typeof p.factorId === "string" && UUID.test(p.factorId)
    && p.role === "authenticated"
    && (p.aal === "aal1" || p.aal === "aal2")
    && p.anonymous === false;
}
function projectAuthBase(url: string): string {
  const u = new URL(url);
  // Rejeita dominios tipo project.supabase.co.attacker.net e SSRF.
  if (u.protocol !== "https:" || !/^[a-z0-9-]{10,64}\.supabase\.co$/.test(u.hostname)
    || u.username || u.password || u.port || u.pathname !== "/"
    || u.search || u.hash) throw new Error("URL Supabase Auth nao confiavel");
  return u.origin + "/auth/v1";
}

export class GoTrueMfaTransporteInerte implements PortaDeAutenticacaoFalsa {
  private readonly authBase: string;
  private readonly cfg: GoTrueMfaConfigInerte;

  constructor(cfg: GoTrueMfaConfigInerte) {
    this.authBase = projectAuthBase(cfg.projectUrl);
    if (!cfg.publishableKey.startsWith("sb_publishable_") ||
      cfg.publishableKey.length < 23 ||
      typeof cfg.http !== "function" ||
      typeof cfg.verificarAssinaturaJwtESessaoNoServidor !== "function") {
      throw new Error("Configuracao de transporte MFA sem chave publica/verificador");
    }
    this.cfg = cfg;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    bearerToken: string,
    body?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    if (!JWT_BEARER.test(bearerToken) || bearerToken.includes("..")) {
      throw new Error("Bearer da sessao invalido");
    }
    // Path e construida apenas por strings controladas pelo servidor.
    const response = await this.cfg.http(this.authBase + path, {
      method,
      headers: {
        "Authorization": "Bearer " + bearerToken,
        "apikey": this.cfg.publishableKey,
        "Content-Type": "application/json",
      },
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      // Proibido registrar error body que poderia expor OTP, desafio ou JWT.
      throw new Error("Resposta GoTrue recusada");
    }
    const ct = response.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) {
      throw new Error("Resposta GoTrue nao-JSON");
    }
    const parsed: unknown = await response.json();
    const obj = record(parsed);
    if (!obj) throw new Error("Payload GoTrue inesperado");
    return obj;
  }

  async autenticarToken(token: string): Promise<SessaoAferidaEmEnsaio | null> {
    // Um GET /user valida usuario, mas sozinho NAO prova session_id,
    // revogacao da sessao, nem garantia criptografica das claims.
    if (!JWT_BEARER.test(token)) return null;
    const principal = await this.cfg.verificarAssinaturaJwtESessaoNoServidor(token);
    if (!validPrincipal(principal)) return null;
    const gotrue = await this.request("GET", "/user", token);
    return gotrue.id === principal.userId ? principal : null;
  }

  async criarDesafio(args: {
    bearerToken: string;
    factorId: string;
  }): Promise<{ id: string }> {
    if (!UUID.test(args.factorId)) throw new Error("Fator do Auth invalido");
    const data = await this.request(
      "POST", "/factors/" + args.factorId + "/challenge",
      args.bearerToken, {},
    );
    if (typeof data.id !== "string" || !UUID.test(data.id)) {
      throw new Error("GoTrue nao retornou id do desafio");
    }
    return { id: data.id };
  }

  async verificarDesafio(args: {
    bearerToken: string;
    factorId: string;
    challengeId: string;
    otp: string;
  }): Promise<{ accessToken: string }> {
    if (!UUID.test(args.factorId) || !UUID.test(args.challengeId) ||
      !/^\d{6}$/.test(args.otp)) throw new Error("Challenge/TOTP invalido");
    const data = await this.request(
      "POST", "/factors/" + args.factorId + "/verify",
      args.bearerToken, { challenge_id: args.challengeId, code: args.otp },
    );
    // Nunca retornar refresh_token (se vier na resposta), cookie ou OTP.
    if (typeof data.access_token !== "string" || !JWT_BEARER.test(data.access_token)) {
      throw new Error("GoTrue nao retornou access_token");
    }
    return { accessToken: data.access_token };
  }
}
