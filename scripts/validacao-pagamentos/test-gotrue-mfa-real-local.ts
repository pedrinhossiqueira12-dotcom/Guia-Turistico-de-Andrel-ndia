/**
 * #42 — E2E contra Auth/GoTrue REAL do Supabase LOCAL e DESCARTAVEL em CI.
 *
 * Nunca conecta a staging, prod, Asaas ou PostgreSQL remoto.
 * Deno tem somente --allow-net=127.0.0.1:54321 e acesso limitado a UMA
 * chave publicavel gerada pelo supabase start local (nao service_role).
 * Cria usuario/fator temporarios; as containers sao removidos ao sair da CI.
 * Nao registra senhas, chaves, otpauth, OTP, bearer, refresh_token ou secret.
 */
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
  const key = await crypto.subtle.importKey("raw", b32(secret),
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
    // Nunca exibir response body: pode conter JWT, TOTP secret, QR ou refresh.
    const raw = await response.text();
    ensure(raw.length <= 65536, "Payload Auth maior que limite");
    let data:Json;
    try { data = rec(JSON.parse(raw)); }
    catch { throw new Error("GoTrue respondeu JSON inesperado (HTTP "+response.status+")"); }
    return {status:response.status,data};
  }
}
export async function exerciseLocalAuthMfa(apiKey: string) {
  const gotrue = new LocalGoTrue(apiKey);
  const uuid = crypto.randomUUID();
  const email = "ci-real-totp-" + uuid + "@example.com";
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

  const challenge = await gotrue.call("POST", "/factors/"+id+"/challenge", before,{});
  ensure(challenge.status >= 200 && challenge.status < 300,
    "Challenge TOTP real nao iniciou: HTTP "+challenge.status);
  const cid = challenge.data.id;
  ensure(typeof cid === "string" && /^[a-f0-9-]{36}$/i.test(cid),
    "Challenge GoTrue sem ID");

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

  // Reautenticacao nao e autorizacao financeira:
  // NAO chamar nenhuma RPC de parecer, transferencia, Pix ou Asaas.
  return {verified:true,sessionUnchanged:true,moneyAuthorized:false} as const;
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
  ensure(proof.verified && proof.sessionUnchanged && !proof.moneyAuthorized,
    "Prova local incompleta");
  console.log("PASS: GoTrue REAL LOCAL confirmou enrollment TOTP, challenge, verify, AAL1=>AAL2 e mesma sessao; zero dinheiro");
}
