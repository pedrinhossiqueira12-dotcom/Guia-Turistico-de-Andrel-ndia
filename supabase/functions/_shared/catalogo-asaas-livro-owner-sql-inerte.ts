/**
 * #42 | Tradutor SQL para o contrato MFA owner-only (SOMENTE CI offline).
 *
 * Nao inclui driver, credenciais, fetch, RPC PostgREST, service_role ou Edge.
 * O caller injeta um executor *falso*. Sao apenas cinco SELECT parametrizados
 * que modelam as funcoes catalogo_private das migrations 18000/19000.
 *
 * NUNCA importar em produto/Edge: esta classe exige banco descartavel de CI
 * e NUNCA comprova OTP, autoriza baixa ou cria pagamento.
 */
import type {
  LivroPrivadoPrechallengeInerte,
  ContextoPrivadoPrechallengeInerte,
  DesafioPrivadoPrechallengeInerte,
  RespostaBancoPrechallengeInerte,
} from "./catalogo-asaas-mfa-orquestrador-prechallenge-inerte.ts";

export interface ExecutorOwnerSqlSomenteCi {
  readonly databaseName: "catalogo_asaas_guards_ci" | "catalogo_asaas_race_ci";
  // O executor recebe query preparada e parâmetros SEPARADOS.
  // Nenhum token, segredo MFA ou chave Pix pode ser enviado ao SQL.
  queryObject(sql: string, params: readonly string[]): Promise<readonly Record<string, unknown>[]>;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^[0-9a-f]{64}$/;
const SQL = Object.freeze({
  reservar:"SELECT catalogo_private.catalogo_asaas_reservar_inicio_compartilhado_inerte($1::uuid) AS result",
  contexto:"SELECT catalogo_private.catalogo_asaas_ler_contexto_prechallenge_inerte($1::uuid) AS result",
  registrar:"SELECT catalogo_private.catalogo_asaas_registrar_desafio_compartilhado_inerte($1::uuid,$2::uuid,$3::uuid) AS result",
  tentativa:"SELECT catalogo_private.catalogo_asaas_ler_tentativa_prechallenge_inerte($1::uuid) AS result",
  consumir:"SELECT catalogo_private.catalogo_asaas_consumir_desafio_compartilhado_inerte($1::uuid,$2::uuid,$3::uuid) AS result",
});
function obj(x:unknown):x is Record<string,unknown>{
  return x!==null && typeof x==="object" && !Array.isArray(x);
}
function uuid(v:unknown):v is string{return typeof v==="string"&&UUID.test(v);}
function contexto(v:unknown):ContextoPrivadoPrechallengeInerte{
  if(!obj(v) || !uuid(v.id) || !uuid(v.userId) || !uuid(v.sessionId)
    || !uuid(v.factorId) || !uuid(v.separationId)
    || typeof v.evidenceHash!=="string" || !SHA256.test(v.evidenceHash)
    || typeof v.expiresAt!=="number" || !Number.isSafeInteger(v.expiresAt)
    || v.expiresAt<=0)throw Error("snapshot_owner_sql_invalido");
  return {
    id:v.id,userId:v.userId,sessionId:v.sessionId,factorId:v.factorId,
    separationId:v.separationId,evidenceHash:v.evidenceHash,expiresAt:v.expiresAt,
  };
}
function resultado(v:unknown):RespostaBancoPrechallengeInerte{
  if(!obj(v) || typeof v.ok!=="boolean" || typeof v.motivo!=="string"
    || v.motivo.length<1 || v.motivo.length>160
    || !(v.nonce===null || v.nonce===undefined || uuid(v.nonce))
    || v.status_operacional!=="HOLD_OBRIGATORIO"
    || v.pagamento_autorizado!==false || v.challenge_go_true_verificado!==false
    || v.desafio_mfa_da_sessao_comprovado!==false
    || v.pode_registrar_parecer!==false || v.dupla_aprovacao_financeira!==false
    || v.liberacao_autorizada!==false || v.baixa_realizada!==false
    || v.movimenta_dinheiro!==false)throw Error("resposta_sql_sem_hold");
  return {
    ok:v.ok,motivo:v.motivo,nonce:v.nonce??null,
    status_operacional:"HOLD_OBRIGATORIO",pagamento_autorizado:false,
    challenge_go_true_verificado:false,
    desafio_mfa_da_sessao_comprovado:false,
    pode_registrar_parecer:false,dupla_aprovacao_financeira:false,
    liberacao_autorizada:false,baixa_realizada:false,movimenta_dinheiro:false,
  };
}
function desafio(v:unknown):DesafioPrivadoPrechallengeInerte{
  if(!obj(v) || !uuid(v.nonce) || !uuid(v.tentativa) || !uuid(v.challengeId)){
    throw Error("tentativa_owner_sql_invalida");
  }
  return {
    nonce:v.nonce,tentativa:v.tentativa,challengeId:v.challengeId,
    contexto:contexto(v.contexto),
  };
}
export class LivroSqlOwnerPrechallengeInerte implements LivroPrivadoPrechallengeInerte {
  constructor(private readonly db:ExecutorOwnerSqlSomenteCi,
    ambiente:"isolated-ci"){
    if(ambiente!=="isolated-ci" || !db ||
      !["catalogo_asaas_guards_ci","catalogo_asaas_race_ci"].includes(db.databaseName)
      || typeof db.queryObject!=="function"){
      throw Error("owner_sql_ambiente_nao_descartavel");
    }
  }

  private async run(sql:string,params:readonly string[]):Promise<unknown>{
    for(const p of params)if(!uuid(p))throw Error("sql_ignora_identificador_invalido");
    const rows=await this.db.queryObject(sql,params);
    if(!Array.isArray(rows)||rows.length!==1 || !obj(rows[0])
      || !Object.hasOwn(rows[0],"result"))throw Error("sql_resposta_fora_do_contrato");
    return rows[0].result;
  }

  async reservarInicio(id:string):Promise<RespostaBancoPrechallengeInerte>{
    return resultado(await this.run(SQL.reservar,[id]));
  }
  async lerContexto(id:string):Promise<ContextoPrivadoPrechallengeInerte|null>{
    const v=await this.run(SQL.contexto,[id]);
    return v===null?null:contexto(v);
  }
  async registrarDesafio(
    nonce:string,challengeId:string,tentativa:string,
  ):Promise<RespostaBancoPrechallengeInerte>{
    return resultado(await this.run(SQL.registrar,[nonce,challengeId,tentativa]));
  }
  async lerTentativa(tentativa:string):Promise<DesafioPrivadoPrechallengeInerte|null>{
    const v=await this.run(SQL.tentativa,[tentativa]);
    return v===null?null:desafio(v);
  }
  async consumirDesafio(
    nonce:string,challengeId:string,tentativa:string,
  ):Promise<RespostaBancoPrechallengeInerte>{
    return resultado(await this.run(SQL.consumir,[nonce,challengeId,tentativa]));
  }
}
