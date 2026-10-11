/**
 * #42 — E2E contra Auth/GoTrue REAL do Supabase LOCAL e DESCARTAVEL em CI.
 *
 * Nunca conecta a staging, prod, Asaas ou PostgreSQL remoto.
 * Deno tem somente --allow-net=127.0.0.1:54321 e acesso limitado a UMA
 * chave publicavel gerada pelo supabase start local (nao service_role).
 * Cria usuario/fator temporarios; as containers sao removidos ao sair da CI.
 * Nao registra senhas, chaves, otpauth, OTP, bearer, refresh_token ou secret.
 */
import {VinculoMfaDossieLocalCI} from "./vinculo-mfa-dossie-local-ci.ts";
const SNAP_CI={decisaoId:"eb420000-0000-4000-8000-000000000042",separacaoId:"ec420000-0000-4000-8000-000000000042",fingerprint:"a".repeat(64),dossieHash:"b".repeat(64),beneficiarioId:"ed420000-0000-4000-8000-000000000042",autoresEvidencia:[]};
const BASE = "http://127.0.0.1:54321/auth/v1";
const EXPECTED_ORIGIN = "http://127.0.0.1:54321";
type Json = Record<string, unknown>;
function ensure(b: unknown, message: string): asserts b {
  if (!b) throw new Error(message);
}
function rec(o: unknown): Json {
  ensure(o !== null && typeof o === "object" && !Array.isArray(o), "GoTrue JSON inesperado");
  return o as Json;
}
function b32(source: string): Uint8Array {
  ensure(typeof source === "string" && /^[A-Z2-7]+=*$/i.test(source) && source.length >= 16,
    "TOTP secret em formato Base32 inesperado");
  const chars = source.replace(/=+$/, "").toUpperCase();
  let bits = 0, buffer = 0;
  const out: number[] = [];
  for (const ch of chars) {
    const index = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(ch);
    ensure(index !== -1, "TOTP Base32 nao canonico");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >>> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  ensure(out.length >= 10, "TOTP secret insuficiente");
  return Uint8Array.from(out);
}
export async function totp(secret: string, whenMs: number, digits = 6): Promise<string> {
  ensure(Number.isSafeInteger(whenMs) && whenMs >= 0, "relogio invalido");
  ensure(digits === 6 || digits === 8, "quantidade de digitos invalida");
  // WebCrypto requer backing ArrayBuffer próprio (não SharedArrayBuffer).
  const keyBytes: Uint8Array<ArrayBuffer> = new Uint8Array(b32(secret));
  const key = await crypto.subtle.importKey("raw", keyBytes,
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  let counter = BigInt(Math.floor(whenMs / 30000));
  const input = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    input[i] = Number(counter & 255n);
    counter >>= 8n;
  }
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, input));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const value = ((hmac[offset] & 0x7f) << 24)
    | (hmac[offset + 1] << 16)
    | (hmac[offset + 2] << 8)
    | hmac[offset + 3];
  return String(value % (10 ** digits)).padStart(digits, "0");
}
function jwtPayload(jwt: string): Json {
  const segments = jwt.split(".");
  ensure(segments.length === 3 && segments[1].length < 10000,
    "JWT local fora do contrato");
  const chars = segments[1].replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(chars.padEnd(Math.ceil(chars.length/4)*4,"=")),
    c => c.charCodeAt(0));
  return rec(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
}
class LocalGoTrue {
  constructor(private key: string) {
    ensure(key.length > 50 && !key.includes("\n"), "Chave ANON local nao informada");
    ensure(new URL(BASE).origin === EXPECTED_ORIGIN, "Host nao local");
  }
  async call(method: "GET" | "POST", path: string, token?: string,
    body?: Json): Promise<{status:number; data:Json}> {
    ensure(path.startsWith("/") && !path.startsWith("//") && !path.includes(".."),
      "Caminho Auth nao permitido");
    const url = new URL(BASE + path);
    ensure(url.origin === EXPECTED_ORIGIN && url.pathname.startsWith("/auth/v1/"),
      "E2E nao pode conectar a host externo");
    const response = await fetch(url, {
      method, redirect:"error", cache:"no-store",
      headers:{
        "apikey":this.key,
        "Authorization":"Bearer "+(token ?? this.key),
        "Content-Type":"application/json",
      },
      ...(method==="POST" ? {body:JSON.stringify(body??{})}:{}),
      signal:AbortSignal.timeout(10000),
    });
    // A resposta de enroll inclui QR SVG e pode ser grande; outras
    // respostas continuam limitadas. Nunca imprimir JWT, segredo ou SVG.
    const maxBytes = method === "POST" && path === "/factors"
      ? 1024 * 1024 : 65536;
    const length = response.headers.get("content-length");
    ensure(length === null || (/^\d+$/.test(length) && Number(length) <= maxBytes),
      "Payload Auth maior que limite");
    const reader = response.body?.getReader();
    ensure(reader, "GoTrue respondeu sem corpo");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const {done,value} = await reader.read();
        if(done)break;
        total += value.byteLength;
        ensure(total <= maxBytes,"Payload Auth maior que limite");
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(()=>{});
      throw error;
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const raw = new TextDecoder("utf-8",{fatal:true}).decode(bytes);
    let data:Json;
    try { data = rec(JSON.parse(raw)); }
    catch { throw new Error("GoTrue respondeu JSON inesperado (HTTP "+response.status+")"); }
    return {status:response.status,data};
  }
}
// Somente a rotina de CI usa estas credenciais em memoria, nunca logs.
interface RevisorGoTrueLocal {
  userId: string;
  sessionId: string;
  factorId: string;
  beforeToken: string;
  afterToken: string;
}
async function criarRevisorGoTrueLocal(
  gotrue: LocalGoTrue, numero: 1 | 2, binder: VinculoMfaDossieLocalCI,
): Promise<RevisorGoTrueLocal> {
  const uuid = crypto.randomUUID();
  const email = "ci-real-totp-reviewer-" + numero + "-" + uuid + "@example.com";
  const password = "CI-Local-Only-" + crypto.randomUUID() + "-Xy!9";
  let result = await gotrue.call("POST", "/signup", undefined,
    {email,password});
  ensure(result.status >= 200 && result.status < 300,
    "Nao foi possivel criar usuario ficticio no GoTrue local: HTTP "+result.status);
  let before = result.data.access_token;
  if (typeof before !== "string" || before.length < 40) {
    result = await gotrue.call("POST", "/token?grant_type=password", undefined,
      {email,password});
    ensure(result.status === 200, "Login de usuario ficticio recusado: HTTP "+result.status);
    before = result.data.access_token;
  }
  ensure(typeof before === "string" && before.length > 40, "JWT AAL1 indisponivel");
  const initial = jwtPayload(before);
  ensure(initial.aal === "aal1" && typeof initial.session_id === "string"
    && initial.role === "authenticated", "Cadastro nao iniciou sessao AAL1");
  const user = await gotrue.call("GET", "/user", before);
  ensure(user.status === 200 && user.data.id === initial.sub,
    "GoTrue nao reconhece JWT do usuario AAL1");

  result = await gotrue.call("POST", "/factors", before,
    {factor_type:"totp",friendly_name:"CI Guia Andrelandia, local only"});
  ensure(result.status >= 200 && result.status < 300,
    "Cadastro TOTP real foi recusado: HTTP "+result.status);
  const id = result.data.id;
  const secret = rec(result.data.totp).secret;
  ensure(typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id),
    "ID de fator TOTP inesperado");
  ensure(typeof secret === "string" && secret.length >= 16,
    "Auth nao devolveu segredo de inscricao TOTP local");

  const identidade={revisorId:String(initial.sub),sessaoId:String(initial.session_id),
    fatorId:id,decisaoId:SNAP_CI.decisaoId,separacaoId:SNAP_CI.separacaoId,
    fingerprint:SNAP_CI.fingerprint,dossieHash:SNAP_CI.dossieHash};
  // O contexto de operacao e ligado ANTES do challenge verdadeiro no GoTrue local.
  const reserved=binder.preparar(identidade);
  ensure(reserved.ok && typeof reserved.nonce==="string",
    "CI local nao vinculou identidade/versao antes do challenge");
  const challenge = await gotrue.call("POST", "/factors/"+id+"/challenge", before,{});
  ensure(challenge.status >= 200 && challenge.status < 300,
    "Challenge TOTP real nao iniciou: HTTP "+challenge.status);
  const cid = challenge.data.id;
  ensure(typeof cid === "string" && /^[a-f0-9-]{36}$/i.test(cid),
    "Challenge GoTrue sem ID");

  const linked=binder.vincularChallenge(reserved.nonce,cid);
  ensure(linked.ok && linked.status_operacional==="HOLD_OBRIGATORIO",
    "Challenge verdadeiro nao foi vinculado ao contexto local");
  const code = await totp(secret,Date.now());
  result = await gotrue.call("POST", "/factors/"+id+"/verify", before,
    {challenge_id:cid,code});
  ensure(result.status >= 200 && result.status < 300,
    "GoTrue recusou OTP local calculado com HMAC-SHA1: HTTP "+result.status);
  const next = result.data.access_token;
  ensure(typeof next === "string" && next.length > 40,
    "GoTrue verify nao retornou JWT AAL2");
  const after = jwtPayload(next);
  ensure(after.aal === "aal2" && after.sub === initial.sub
    && after.session_id === initial.session_id && after.role === "authenticated",
    "Upgrade AAL2 nao manteve usuario e sessao");
  const verified = await gotrue.call("GET", "/user", next);
  ensure(verified.status === 200 && verified.data.id === initial.sub,
    "GoTrue rejeitou a sessao apos verificar TOTP");
  // Confirmacao depende de resposta autentica do GoTrue local e dos
  // mesmos identidade/sessao/fator/challenge/versao congelados antes do OTP.
  const linkedProof=binder.registrarResultado(reserved.nonce,{
    ...identidade,challengeId:cid,aal:String(after.aal),
    usuarioAuthId:String(verified.data.id),
    sessaoAuthId:String(after.session_id),factorAuthId:id,
    autenticacaoLocalGoTrueConfirmada:true,
  });
  ensure(linkedProof.ok && linkedProof.status_operacional==="HOLD_OBRIGATORIO"
    && linkedProof.pagamento_autorizado===false,
    "Challenge concluido nao correspondeu ao dossie congelado");

  // Reautenticacao nao e autorizacao financeira:
  // NAO chamar nenhuma RPC de parecer, transferencia, Pix ou Asaas.
  return {
    userId: String(initial.sub),
    sessionId: String(initial.session_id),
    factorId: id,
    beforeToken: before,
    afterToken: next,
  };
}

/**
 * #42 - Duas IDENTIDADES REAIS do GoTrue, mas so no projeto LOCAL efemero.
 * Nunca cria papel financeiro; a autenticacao AAL2 nao equivale a aprovacao.
 * Provas e tokens permanecem apenas em memoria, sem log ou arquivo.
 */
export async function exerciseLocalAuthMfa(apiKey: string) {
  const gotrue = new LocalGoTrue(apiKey);
  const binder=new VinculoMfaDossieLocalCI(SNAP_CI,()=>Date.now(),"ci-local-descartavel");
  const a = await criarRevisorGoTrueLocal(gotrue, 1,binder);
  const b = await criarRevisorGoTrueLocal(gotrue, 2,binder);
  const diag=binder.diagnosticar(SNAP_CI);
  ensure(diag.duas_observacoes_locais_vinculadas===true
    && diag.revisores_distintos_vinculados_na_versao===2
    && diag.aprovacao_financeira===false,
    "Nao vinculou dois desafios independentes a mesma versao");
  const stale=binder.diagnosticar({...SNAP_CI,fingerprint:"c".repeat(64)});
  ensure(stale.duas_observacoes_locais_vinculadas===false
    && stale.movimenta_dinheiro===false,
    "Revisao de versao posterior reutilizou challenges antigos");
  ensure(a.userId !== b.userId && a.sessionId !== b.sessionId
    && a.factorId !== b.factorId,
    "GoTrue reutilizou identidade, sessao ou fator entre revisores");

  // GoTrue deve negar challenge para fator que pertence a OUTRO usuario,
  // mesmo que o token do solicitante seja AAL1 autenticado e valido.
  const wrongA = await gotrue.call(
    "POST", "/factors/" + b.factorId + "/challenge", a.beforeToken, {},
  );
  ensure(wrongA.status >= 400 && wrongA.status < 500,
    "GoTrue permitiu desafio no fator de outro revisor");
  const wrongB = await gotrue.call(
    "POST", "/factors/" + a.factorId + "/challenge", b.beforeToken, {},
  );
  ensure(wrongB.status >= 400 && wrongB.status < 500,
    "GoTrue permitiu desafio cruzado no fator da outra identidade");

  // Mesmo apos autenticacao forte, sessao de A nao passa a ser identidade B.
  const afterA = await gotrue.call("GET", "/user", a.afterToken);
  const afterB = await gotrue.call("GET", "/user", b.afterToken);
  ensure(afterA.status === 200 && afterB.status === 200
    && afterA.data.id === a.userId && afterB.data.id === b.userId
    && afterA.data.id !== afterB.data.id,
    "GoTrue trocou ou confundiu identidades de sessoes AAL2");

  // Apenas fatos nao sensiveis. Nao retornar bearer, TOTP ou fator.
  return {
    verified: true,
    sessionUnchanged: true,
    twoIndependentReviewers: true,
    crossUserFactorDenied: true,
    dossierVersionBound: true,
    moneyAuthorized: false,
  } as const;
}
if (import.meta.main) {
  if(Deno.args.length!==1 || Deno.args[0]!=="--native-ci-local-only")
    throw new Error("Somente --native-ci-local-only. Nada de staging/producao");
  for(const key of ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_ACCESS_TOKEN",
    "DATABASE_URL","SUPABASE_DB_PASSWORD","ASAAS_API_KEY","MP_PLATFORM_ACCESS_TOKEN"]){
    if(Deno.env.get(key))throw new Error("Ambiente externo/financeiro proibido: "+key);
  }
  const key = Deno.env.get("LOCAL_SUPABASE_ANON_KEY") ?? "";
  const proof = await exerciseLocalAuthMfa(key);
  ensure(proof.verified && proof.sessionUnchanged
    && proof.twoIndependentReviewers && proof.crossUserFactorDenied
    && proof.dossierVersionBound && !proof.moneyAuthorized,
    "Prova local de duas sessoes/fatores independentes incompleta");
  console.log("PASS: GoTrue REAL LOCAL: dois usuarios e fatores TOTP, AAL1=>AAL2, mesma sessao por usuario, challenges cruzados recusados; HOLD sem dinheiro");
}
