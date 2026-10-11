/**
 * #42 | Contrato SQL de cinco wrappers MFA NOLOGIN — SOMENTE CI DESCARTAVEL.
 *
 * Nenhuma conexao PostgreSQL, credencial, fetch ou endpoint neste arquivo.
 * O executor e INJETADO no teste, que deve executar SET LOCAL ROLE
 * catalogo_mfa_ponte_ci_inerte dentro de transacao num clone descartavel.
 *
 * roleName/databaseName abaixo sao marcadores de teste, NAO prova de
 * autenticacao nem autorizacao para um executor real. Nunca implantar Edge.
 * Todos os resultados financeiros ficam HOLD_OBRIGATORIO.
 */
import type {
  LivroPrivadoPrechallengeInerte,
  ContextoPrivadoPrechallengeInerte,
  DesafioPrivadoPrechallengeInerte,
  RespostaBancoPrechallengeInerte,
} from "./catalogo-asaas-mfa-orquestrador-prechallenge-inerte.ts";

export interface ExecutorPonteMfaSomenteCi {
  readonly databaseName: "catalogo_asaas_guards_ci";
  readonly roleName: "catalogo_mfa_ponte_ci_inerte";
  queryObject(sql:string,params:readonly string[]):Promise<readonly Record<string,unknown>[]>;
}
const ROLE="catalogo_mfa_ponte_ci_inerte" as const;
const DB="catalogo_asaas_guards_ci" as const;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/i;
const SQL=Object.freeze({
  reservar:"SELECT catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_reservar_principal_inerte($1::uuid,$2::uuid,$3::uuid) AS result",
  contexto:"SELECT catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_ler_contexto_inerte($1::uuid) AS result",
  registrar:"SELECT catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_registrar_desafio_inerte($1::uuid,$2::uuid,$3::uuid) AS result",
  tentativa:"SELECT catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_ler_tentativa_inerte($1::uuid) AS result",
  consumir:"SELECT catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_consumir_desafio_inerte($1::uuid,$2::uuid,$3::uuid) AS result",
});
function isObject(v:unknown):v is Record<string,unknown> {
  return v!==null&&typeof v==="object"&&!Array.isArray(v);
}
function isUuid(v:unknown):v is string{
  return typeof v==="string"&&UUID.test(v);
}
function parseHold(value:unknown):RespostaBancoPrechallengeInerte {
  if(!isObject(value) || typeof value.ok!=="boolean"
    || typeof value.motivo!=="string"||value.motivo.length<1||value.motivo.length>160
    || (value.nonce!==undefined&&value.nonce!==null&&!isUuid(value.nonce))
    || value.status_operacional!=="HOLD_OBRIGATORIO"
    || value.pagamento_autorizado!==false
    || value.challenge_go_true_verificado!==false
    || value.desafio_mfa_da_sessao_comprovado!==false
    || value.pode_registrar_parecer!==false
    || value.dupla_aprovacao_financeira!==false
    || value.liberacao_autorizada!==false
    || value.baixa_realizada!==false
    || value.movimenta_dinheiro!==false
    || (value.ok===false&&value.nonce!==null&&value.nonce!==undefined)) {
    throw Error("ponte_mfa_sql_sem_hold");
  }
  return {
    ok:value.ok,motivo:value.motivo,nonce:value.nonce??null,
    status_operacional:"HOLD_OBRIGATORIO",
    pagamento_autorizado:false,challenge_go_true_verificado:false,
    desafio_mfa_da_sessao_comprovado:false,pode_registrar_parecer:false,
    dupla_aprovacao_financeira:false,liberacao_autorizada:false,
    baixa_realizada:false,movimenta_dinheiro:false,
  };
}
function parseContext(value:unknown):ContextoPrivadoPrechallengeInerte {
  if(!isObject(value)||!isUuid(value.id)||!isUuid(value.userId)
    ||!isUuid(value.sessionId)||!isUuid(value.factorId)
    ||!isUuid(value.separationId)
    ||typeof value.evidenceHash!=="string"||!HASH.test(value.evidenceHash)
    ||typeof value.expiresAt!=="number"||!Number.isSafeInteger(value.expiresAt)
    ||value.expiresAt<=0) {
    throw Error("ponte_mfa_contexto_invalido");
  }
  return {
    id:value.id,userId:value.userId,sessionId:value.sessionId,
    factorId:value.factorId,separationId:value.separationId,
    evidenceHash:value.evidenceHash,expiresAt:value.expiresAt,
  };
}
function parseAttempt(v:unknown):DesafioPrivadoPrechallengeInerte{
  if(!isObject(v)||!isUuid(v.nonce)||!isUuid(v.tentativa)||!isUuid(v.challengeId)){
    throw Error("ponte_mfa_tentativa_invalida");
  }
  return {
    nonce:v.nonce,tentativa:v.tentativa,
    challengeId:v.challengeId,contexto:parseContext(v.contexto),
  };
}
export class LivroSqlPonteMfaCiInerte implements LivroPrivadoPrechallengeInerte {
  constructor(private readonly db:ExecutorPonteMfaSomenteCi,
    ambiente:"isolated-ci"){
    if(ambiente!=="isolated-ci"||!db||db.databaseName!==DB||db.roleName!==ROLE
      ||typeof db.queryObject!=="function") {
      throw Error("ponte_mfa_sql_ambiente_ou_papel_invalido");
    }
  }
  private async read(sql:string,ids:readonly string[]):Promise<unknown> {
    if(!ids.every(isUuid))throw Error("ponte_mfa_identificador_invalido");
    const rows=await this.db.queryObject(sql,ids);
    if(!Array.isArray(rows)||rows.length!==1||!isObject(rows[0])
      ||!Object.hasOwn(rows[0],"result"))throw Error("ponte_mfa_formato_sql_invalido");
    // NULL quando houver grant inesperado a qualquer role (fail-closed
    // nos 5 wrappers). Para operacoes mutantes, parseHold REJEITA NULL.
    return rows[0].result;
  }
  reservarInicioVinculado(c:string,u:string,s:string):Promise<RespostaBancoPrechallengeInerte>{
    return this.read(SQL.reservar,[c,u,s]).then(parseHold);
  }
  async lerContexto(c:string):Promise<ContextoPrivadoPrechallengeInerte|null>{
    const v=await this.read(SQL.contexto,[c]);
    return v===null?null:parseContext(v);
  }
  registrarDesafio(n:string,ch:string,t:string):Promise<RespostaBancoPrechallengeInerte>{
    return this.read(SQL.registrar,[n,ch,t]).then(parseHold);
  }
  async lerTentativa(t:string):Promise<DesafioPrivadoPrechallengeInerte|null>{
    const v=await this.read(SQL.tentativa,[t]);
    return v===null?null:parseAttempt(v);
  }
  consumirDesafio(n:string,ch:string,t:string):Promise<RespostaBancoPrechallengeInerte>{
    return this.read(SQL.consumir,[n,ch,t]).then(parseHold);
  }
}
