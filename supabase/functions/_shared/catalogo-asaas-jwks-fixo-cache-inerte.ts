/**
 * #42 — resolvedor JWKS PINADO somente em laboratorio, sem Edge publicada.
 * Nao ha requisicao HTTP real por padrao: fetch obrigatoriamente injetado.
 * Nao valida usuario ou MFA sozinho. Não conceder permissão financeira.
 */
import type { ProvedorIdentidadeAssinadaInerte } from "./catalogo-asaas-jwt-sessao-assinada-ensaio.ts";

export type OrigemDeSessaoPrivada = Pick<
  ProvedorIdentidadeAssinadaInerte, "consultarSessaoEFator"
>;

export interface ConfigJwksPinadoInerte {
  projectRef: string;
  projectUrl: string;
  buscarHttp: typeof fetch;
  consultarSessaoEFator: OrigemDeSessaoPrivada["consultarSessaoEFator"];
  agoraMs: () => number;
  /** TTL de laboratorio (1–60 segundos), expira sem servir stale. */
  ttlSegundos: number;
}

const REF=/^[a-z0-9]{20}$/;
const MAX_BYTES=32768;
const MAX_KEYS=12;
const SAFE_B64=/^[a-zA-Z0-9_-]+$/;
type JwkComKid = JsonWebKey & { kid?: string };

function keyValida(k: unknown): k is JsonWebKey {
  if (!k || typeof k!=="object" || Array.isArray(k)) return false;
  const key=k as JwkComKid;
  if (typeof key.kid!=="string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(key.kid)
      || key.use!=="sig" || (key.alg!=="ES256" && key.alg!=="RS256")
      || (key.key_ops!==undefined && (!Array.isArray(key.key_ops)
        || key.key_ops.some(v=>v!=="verify")))
      || ["d","k","p","q","dp","dq","qi","oth"].some(f=>f in key)) return false;
  if (key.alg==="ES256") return key.kty==="EC" && key.crv==="P-256"
    && typeof key.x==="string" && typeof key.y==="string"
    && key.x.length===43 && key.y.length===43
    && SAFE_B64.test(key.x) && SAFE_B64.test(key.y);
  return key.kty==="RSA" && typeof key.n==="string"
    && key.n.length>=342 && key.n.length<=1024 && SAFE_B64.test(key.n)
    && typeof key.e==="string" && key.e.length>=2
    && key.e.length<=12 && SAFE_B64.test(key.e);
}
function validarOrigem(c:ConfigJwksPinadoInerte):string {
  if (!REF.test(c.projectRef)) throw new Error("JWKS_ref_invalido");
  const url = new URL(c.projectUrl);
  if (url.protocol!=="https:" || url.hostname!==c.projectRef+".supabase.co"
    || url.username || url.password || url.port || url.pathname!=="/"
    || url.search || url.hash) throw new Error("JWKS_origem_nao_pina_projeto");
  if (typeof c.buscarHttp!=="function"
    || typeof c.consultarSessaoEFator!=="function"
    || typeof c.agoraMs!=="function"
    || !Number.isSafeInteger(c.ttlSegundos)
    || c.ttlSegundos<1 || c.ttlSegundos>60) {
    throw new Error("JWKS_configuracao_nao_segura");
  }
  return url.origin+"/auth/v1/.well-known/jwks.json";
}

export class ResolvedorJwksPinadoInerte implements ProvedorIdentidadeAssinadaInerte {
  private readonly endpoint:string;
  private cache:{keys:JsonWebKey[];venceEm:number}|null=null;
  private emCurso:Promise<{keys:JsonWebKey[]}>|null=null;
  private ultimoRelogio=-Infinity;
  constructor(private readonly cfg:ConfigJwksPinadoInerte){
    this.endpoint=validarOrigem(cfg);
  }

  consultarSessaoEFator(sessionId:string) {
    // A consulta é SEMPRE fornecida por backend isolado, sem RPC de Data API.
    return this.cfg.consultarSessaoEFator(sessionId);
  }

  async buscarJwksConfiavel():Promise<{keys:JsonWebKey[]}>{
    const now=this.cfg.agoraMs();
    if (!Number.isFinite(now) || now<this.ultimoRelogio) {
      this.cache=null;
      throw new Error("JWKS_relogio_retrocedeu_ou_invalido");
    }
    this.ultimoRelogio=now;
    if (this.cache && now<this.cache.venceEm) {
      return {keys:structuredClone(this.cache.keys)};
    }
    // Expirou? Nunca usar chave velha enquanto a rede falha.
    this.cache=null;
    if (this.emCurso) return this.emCurso;
    const pending=this.obterNovasChaves();
    this.emCurso=pending;
    try{return await pending;}
    finally{if(this.emCurso===pending)this.emCurso=null;}
  }

  private async obterNovasChaves():Promise<{keys:JsonWebKey[]}>{
    const res=await this.cfg.buscarHttp(this.endpoint,{
      method:"GET",
      redirect:"error",
      credentials:"omit",
      cache:"no-store",
      headers:{"Accept":"application/json"},
      signal:AbortSignal.timeout(3500),
    });
    if (!res.ok || !/\bapplication\/json\b/i.test(res.headers.get("content-type")??"")) {
      throw new Error("JWKS_resposta_indisponivel");
    }
    const len=res.headers.get("content-length");
    if (len!==null && (!/^\d+$/.test(len) || Number(len)>MAX_BYTES)) {
      throw new Error("JWKS_tamanho_invalido");
    }
    if (!res.body) throw new Error("JWKS_corpo_ausente");
    const reader=res.body.getReader();
    let total=0;
    const chunks:Uint8Array[]=[];
    try{
      for(;;){
        const {done,value}=await reader.read();
        if(done)break;
        total+=value.byteLength;
        if(total>MAX_BYTES) throw new Error("JWKS_corpo_excessivo");
        chunks.push(value);
      }
    } catch(e){
      await reader.cancel().catch(()=>{});
      throw e;
    } finally{reader.releaseLock();}
    const buffer=new Uint8Array(total);
    let p=0;
    for(const chunk of chunks){buffer.set(chunk,p);p+=chunk.byteLength;}
    const obj:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(buffer));
    if (!obj || typeof obj!=="object" || Array.isArray(obj) || !("keys" in obj)) {
      throw new Error("JWKS_payload_invalido");
    }
    const keys=(obj as {keys:unknown}).keys;
    if (!Array.isArray(keys) || keys.length===0 || keys.length>MAX_KEYS
      || !keys.every(keyValida)) throw new Error("JWKS_chaves_invalidas");
    const ids=keys.map(k=>(k as JwkComKid).kid);
    if (new Set(ids).size!==ids.length) throw new Error("JWKS_kid_duplicado");
    const fresh=this.cfg.agoraMs();
    if (!Number.isFinite(fresh) || fresh<this.ultimoRelogio) {
      this.cache=null;
      throw new Error("JWKS_relogio_retrocedeu_ao_buscar");
    }
    this.ultimoRelogio=fresh;
    // Se request atravessou a expiração e demorou, nunca retroagir TTL.
    // Cópias profundas impedem mutação de arrays como key_ops no cache.
    this.cache={keys:structuredClone(keys),venceEm:fresh+this.cfg.ttlSegundos*1000};
    return {keys:structuredClone(keys)};
  }
}
