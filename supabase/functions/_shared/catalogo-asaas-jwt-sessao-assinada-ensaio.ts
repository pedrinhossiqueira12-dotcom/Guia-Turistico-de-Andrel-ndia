/**
 * #42 — validador ASSINADO apenas em CI. Sem handler HTTP / deploy.
 * Executa WebCrypto real para RS256/ES256 com JWKS previamente obtida
 * de origem CONFIAVEL, e requer consulta independente à sessao Auth.
 *
 * Nao fornece prova de step-up recente para a operacao; nenhuma resposta
 * autoriza pagamento, parecer, baixa, transferencia ou uso de nonce.
 * HS256 legado nao é aceito: migracao para chave assimetrica é requisito.
 *
 * Nunca usar claims decodificadas sem validar assinatura; nem tratar AAL2
 * como timestamp de challenge. Nao usar user_metadata para autorizacao.
 */
import type { SessaoAferidaEmEnsaio } from "./catalogo-asaas-stepup-documental-ensaio.ts";

export interface AuthSessaoConsultada {
  id: string;
  userId: string;
  aal: "aal1" | "aal2";
  factorId: string | null;
  notAfterMs: number | null;
  factorUserId: string | null;
  factorType: string | null;
  factorStatus: string | null;
}

// Consulta de sessao PRE-TOTP. Nunca declara MFA concluido: em AAL1
// auth.sessions.factor_id pode ser NULL e nao deve ser inventado.
export interface AuthSessaoBasicaConsultada {
  id: string;
  userId: string;
  aal: "aal1" | "aal2";
  notAfterMs: number | null;
  usuarioBloqueado: boolean;
}

export interface ProvedorIdentidadeAssinadaInerte {
  // Apenas JWKS da origem fixa/pinada do projeto Supabase. Se indisponivel,
  // negar por completo. Nao aceitar URLs ou chaves do token do cliente.
  buscarJwksConfiavel(): Promise<{ keys: JsonWebKey[] }>;
  // Apenas consulta administrativa backend, direta ou privada, em
  // auth.sessions+auth.mfa_factors. Nao é um RPC publico.
  consultarSessaoEFator(sessionId: string): Promise<AuthSessaoConsultada | null>;
  // Porta opcional de AAL1 para iniciar MFA: se nao houver leitor privado,
  // falha fechada. Nunca pode ser usada para comprovar fator/operacao.
  consultarSessaoBasica?(sessionId: string): Promise<AuthSessaoBasicaConsultada | null>;
}

export interface ConfigJWTInerte {
  projectUrl: string;
  agoraMs: () => number;
  maxIdadeTokenSegundos: number; // recomendado 300, nunca >300
  provedor: ProvedorIdentidadeAssinadaInerte;
}

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_JWT_LENGTH = 8192;
const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function decodeB64(s: string, max: number): Uint8Array {
  if (!s || s.length > max || !BASE64URL.test(s)) throw new Error("jwt_base64_invalido");
  const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length/4)*4,"="));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function decodeJson(s: string, max: number): Record<string, unknown> {
  const obj: unknown = JSON.parse(dec.decode(decodeB64(s,max)));
  if (!isObj(obj)) throw new Error("jwt_json_invalido");
  return obj;
}
function projectIssuer(projectUrl: string): string {
  const parsed = new URL(projectUrl);
  if (parsed.protocol !== "https:" ||
    !/^[a-z0-9-]{10,64}\.supabase\.co$/.test(parsed.hostname) ||
    parsed.username || parsed.password || parsed.port ||
    parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("emissor_supabase_invalido");
  }
  return parsed.origin + "/auth/v1";
}
function isSafeJwk(k: JsonWebKey, alg: string, kid: string): boolean {
  // DOM JsonWebKey nao declara kid (JOSE), embora JWKS do GoTrue o inclua.
  const jose = k as JsonWebKey & {kid?: string};
  if (!k || jose.kid !== kid || k.alg !== alg ||
    (k.use !== undefined && k.use !== "sig") ||
    (k.key_ops !== undefined && (!Array.isArray(k.key_ops) ||
      !k.key_ops.includes("verify"))) || "d" in k ||
    "k" in k || "p" in k || "q" in k) return false;
  if (alg === "ES256") return k.kty === "EC" && k.crv === "P-256"
    && typeof k.x === "string" && typeof k.y === "string";
  if (alg === "RS256") return k.kty === "RSA"
    && typeof k.n === "string" && typeof k.e === "string"
    && k.n.length >= 340; // RSA2048 minimum; 2048 bits ~342 base64url
  return false;
}
function numberSeconds(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
}
function equalClaimsSession(
  claims: Record<string, unknown>, row: AuthSessaoConsultada, now: number,
): boolean {
  return row.id === claims.session_id && row.userId === claims.sub &&
    row.aal === "aal2" && claims.aal === "aal2" &&
    typeof claims.sub === "string" && UUID.test(claims.sub) &&
    typeof claims.session_id === "string" && UUID.test(claims.session_id) &&
    typeof row.factorId === "string" && UUID.test(row.factorId) &&
    row.factorUserId === row.userId && row.factorType === "totp" &&
    row.factorStatus === "verified" &&
    (row.notAfterMs === null ||
     (Number.isFinite(row.notAfterMs) && row.notAfterMs > now));
}

/**
 * Nao é um banco de autorizacoes. Mesmo que devolva sessao aferida,
 * TODAS as funcoes financeiras mantem HOLD. Usa apenas bibliotecas WebCrypto
 * nativas + JWKS confiavel e lookup independente de auth.sessions.
 */
export class ValidadorJwtSessaoInerte {
  private issuer: string;
  constructor(private readonly cfg: ConfigJWTInerte) {
    this.issuer = projectIssuer(cfg.projectUrl);
    if (!Number.isSafeInteger(cfg.maxIdadeTokenSegundos) ||
      cfg.maxIdadeTokenSegundos < 1 || cfg.maxIdadeTokenSegundos > 300 ||
      typeof cfg.provedor?.buscarJwksConfiavel !== "function" ||
      typeof cfg.provedor?.consultarSessaoEFator !== "function" ||
      typeof cfg.agoraMs !== "function") {
      throw new Error("verificador_assinatura_sessao_nao_configurado");
    }
  }

  async verificar(token: string): Promise<SessaoAferidaEmEnsaio | null> {
    // Verificacao final: apenas AAL2 com fator TOTP efetivamente associado.
    return this.verificarInterno(token, false);
  }

  async verificarInicio(token: string): Promise<SessaoAferidaEmEnsaio | null> {
    // Somente fase anterior ao challenge. AAL1 e identidade, NUNCA prova MFA.
    return this.verificarInterno(token, true);
  }

  private async verificarInterno(
    token: string,
    aceitaAal1: boolean,
  ): Promise<SessaoAferidaEmEnsaio | null> {
    // Fail closed: nunca vazar JWT, JWK, OTP ou erro remoto nos logs.
    try {
      if (typeof token !== "string" || token.length > MAX_JWT_LENGTH) return null;
      const segments = token.split(".");
      if (segments.length !== 3) return null;
      const [h, payload, sig] = segments;
      const header = decodeJson(h,2048);
      if ((header.alg !== "RS256" && header.alg !== "ES256") ||
        typeof header.kid !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(header.kid) ||
        (header.typ !== undefined && header.typ !== "JWT") ||
        header.crit !== undefined || header.jku !== undefined ||
        header.jwk !== undefined || header.x5u !== undefined) return null;

      const signature = decodeB64(sig, 1400);
      const claims = decodeJson(payload, 6144);
      const now = this.cfg.agoraMs();
      if (!Number.isFinite(now)) return null;
      const nowSec = Math.floor(now/1000);
      const iat = numberSeconds(claims.iat);
      const exp = numberSeconds(claims.exp);
      const nbf = claims.nbf === undefined ? null : numberSeconds(claims.nbf);
      if (claims.iss !== this.issuer ||
        claims.aud !== "authenticated" ||
        claims.role !== "authenticated" ||
        claims.is_anonymous !== false ||
        (claims.aal !== "aal2" && !(aceitaAal1 && claims.aal === "aal1")) ||
        typeof claims.sub !== "string" || !UUID.test(claims.sub) ||
        typeof claims.session_id !== "string" || !UUID.test(claims.session_id) ||
        iat === null || exp === null || exp <= nowSec ||
        iat > nowSec || iat < nowSec-this.cfg.maxIdadeTokenSegundos ||
        exp <= iat || (claims.nbf !== undefined && (nbf === null || nbf > nowSec))
      ) return null;

      const jwks = await this.cfg.provedor.buscarJwksConfiavel();
      if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length > 25) return null;
      const candidates = jwks.keys.filter(k=>isSafeJwk(k,header.alg as string,header.kid as string));
      // Nao aceitar chaves ambiguas com kid repetido, ou fallback alg.
      if (candidates.length !== 1) return null;
      const key = candidates[0];
      const algorithm = header.alg === "ES256"
        ? { name:"ECDSA", namedCurve:"P-256" } as EcKeyImportParams
        : { name:"RSASSA-PKCS1-v1_5", hash:"SHA-256" } as RsaHashedImportParams;
      const imported = await crypto.subtle.importKey("jwk",key,algorithm,false,["verify"]);
      // Alguns runtimes usam Uint8Array<ArrayBufferLike>, mas WebCrypto
      // requer BufferSource<ArrayBuffer>. Copia local sem SharedArrayBuffer.
      const signatureBytes = new Uint8Array(new ArrayBuffer(signature.byteLength));
      signatureBytes.set(signature);
      const verified = await crypto.subtle.verify(
        header.alg === "ES256"
          ? {name:"ECDSA",hash:"SHA-256"}
          : {name:"RSASSA-PKCS1-v1_5"},
        imported,signatureBytes,enc.encode(h+"."+payload),
      );
      if (!verified) return null;

      // Somente DEPOIS da assinatura consultar Auth, sempre na fase correta.
      // AAL1 nao possui fator associado a esta sessao; a API de challenge
      // GoTrue sera responsavel por verificar posse do fator pelo usuario.
      if (claims.aal === "aal1") {
        const buscar = this.cfg.provedor.consultarSessaoBasica;
        if (!aceitaAal1 || typeof buscar !== "function") return null;
        const basica = await buscar(claims.session_id as string);
        if (!basica || basica.id !== claims.session_id ||
          basica.userId !== claims.sub || basica.aal !== "aal1" ||
          basica.usuarioBloqueado !== false ||
          (basica.notAfterMs !== null && (!Number.isFinite(basica.notAfterMs)
            || basica.notAfterMs <= now))) return null;
        return {
          userId: basica.userId, sessionId: basica.id, factorId: null,
          role: "authenticated", aal: "aal1", anonymous: false,
        };
      }
      const session = await this.cfg.provedor.consultarSessaoEFator(claims.session_id as string);
      if (!session || !equalClaimsSession(claims,session,now)) return null;
      return {
        userId:session.userId,sessionId:session.id,factorId:session.factorId,
        role:"authenticated",aal:"aal2",anonymous:false,
      };
    } catch {
      return null;
    }
  }
}
