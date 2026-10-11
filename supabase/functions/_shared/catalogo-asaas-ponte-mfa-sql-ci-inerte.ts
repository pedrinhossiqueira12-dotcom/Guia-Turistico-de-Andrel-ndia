/**
 * #42 — PROVA DE CONTRATO APENAS EM CI ISOLADA.
 *
 * O esquema catalogo_mfa_ponte_ci_inerte e a role NOLOGIN nao existem em
 * STAGING/PROD. Este adaptador NAO fornece driver, login, credenciais,
 * proxy, endpoint, PostgREST, autorizacao de saque nem conexao.
 *
 * Exclusivamente para exercitar os cinco wrappers definidos na migration
 * CI-only 20261010021000 e verificar que NULL ou payload inseguro falham
 * fechados. Toda resposta financeira deve permanecer HOLD_OBRIGATORIO.
 */
import type {
  LivroPrivadoPrechallengeInerte,
  ContextoPrivadoPrechallengeInerte,
  DesafioPrivadoPrechallengeInerte,
  RespostaBancoPrechallengeInerte,
} from "./catalogo-asaas-mfa-orquestrador-prechallenge-inerte.ts";

export interface ExecutorPonteMfaCiInerte {
  readonly databaseName: "catalogo_asaas_guards_ci";
  readonly executionRole: "catalogo_mfa_ponte_ci_inerte";
  // A implementacao concreta EXCLUSIVAMENTE de testes recebe SQL preparado.
  // Nenhum driver ou segredo e construido/armazenado por esta classe.
  queryObject(sql: string, params: readonly string[]): Promise<readonly Record<string, unknown>[]>;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
const Q=Object.freeze({
  reservar:"SELECT catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_reservar_principal_inerte($1::uuid,$2::uuid,$3::uuid) AS result",
  contexto:"SELECT catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_ler_contexto_inerte($1::uuid) AS result",
  registrar:"SELECT catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_registrar_desafio_inerte($1::uuid,$2::uuid,$3::uuid) AS result",
  tentativa:"SELECT catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_ler_tentativa_inerte($1::uuid) AS result",
  consumir:"SELECT catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_consumir_desafio_inerte($1::uuid,$2::uuid,$3::uuid) AS result",
});
function obj(v:unknown):v is Record<string,unknown>{
  return !!v&&typeof v==="object"&&!Array.isArray(v);
}
function id(v:unknown):v is string{return typeof v==="string"&&UUID.test(v);}
function context(v:unknown):ContextoPrivadoPrechallengeInerte {
  if(!obj(v)||!id(v.id)||!id(v.userId)||!id(v.sessionId)||
    !id(v.factorId)||!id(v.separationId)||
    typeof v.evidenceHash!=="string"||!HASH.test(v.evidenceHash)||
    typeof v.expiresAt!=="number"||!Number.isSafeInteger(v.expiresAt)||
    v.expiresAt<=0){
    throw Error("ponte_ci_contexto_invalido");
  }
  return {
    id:v.id,userId:v.userId,sessionId:v.sessionId,
    factorId:v.factorId,separationId:v.separationId,
    evidenceHash:v.evidenceHash,expiresAt:v.expiresAt,
  };
}
function response(v:unknown):RespostaBancoPrechallengeInerte {
  // SQL retorna NULL quando perde o isolamento da role: jamais interpretar
  // NULL como sucesso, mesmo se alguma flag for true em outro campo.
  if(!obj(v)||typeof v.ok!=="boolean"||
    typeof v.motivo!=="string"||v.motivo.length<1||v.motivo.length>160||
    !(v.nonce===undefined||v.nonce===null||id(v.nonce))||
    v.status_operacional!=="HOLD_OBRIGATORIO"||
    v.pagamento_autorizado!==false||
    v.challenge_go_true_verificado!==false||
    v.desafio_mfa_da_sessao_comprovado!==false||
    v.pode_registrar_parecer!==false||
    v.dupla_aprovacao_financeira!==false||
    v.liberacao_autorizada!==false||
    v.baixa_realizada!==false||
    v.movimenta_dinheiro!==false){
    throw Error("ponte_ci_resposta_sem_hold");
  }
  return {
    ok:v.ok,motivo:v.motivo,nonce:v.nonce??null,
    status_operacional:"HOLD_OBRIGATORIO",
    pagamento_autorizado:false,challenge_go_true_verificado:false,
    desafio_mfa_da_sessao_comprovado:false,
    pode_registrar_parecer:false,dupla_aprovacao_financeira:false,
    liberacao_autorizada:false,baixa_realizada:false,movimenta_dinheiro:false,
  };
}
function attempt(v:unknown):DesafioPrivadoPrechallengeInerte {
  if(!obj(v)||!id(v.nonce)||!id(v.tentativa)||!id(v.challengeId))
    throw Error("ponte_ci_tentativa_invalida");
  return {
    nonce:v.nonce,tentativa:v.tentativa,challengeId:v.challengeId,
    contexto:context(v.contexto),
  };
}
export class LivroPonteMfaSqlCiInerte implements LivroPrivadoPrechallengeInerte{
  constructor(
    private readonly executor:ExecutorPonteMfaCiInerte,
    ambiente:"isolated-ci",
  ){
    if(ambiente!=="isolated-ci"||!executor||
      executor.databaseName!=="catalogo_asaas_guards_ci"||
      executor.executionRole!=="catalogo_mfa_ponte_ci_inerte"||
      typeof executor.queryObject!=="function")
      throw Error("ponte_ci_executor_ou_ambiente_nao_descartavel");
  }
  private async query(sql:string,parameters:readonly string[]):Promise<unknown>{
    if(!parameters.every(id))throw Error("ponte_ci_parametro_nao_uuid");
    const rows=await this.executor.queryObject(sql,parameters);
    if(!Array.isArray(rows)||rows.length!==1||!obj(rows[0])||
      !Object.hasOwn(rows[0],"result"))
      throw Error("ponte_ci_resultado_sql_invalido");
    return rows[0].result;
  }
  async reservarInicioVinculado(
    contextoId:string,userId:string,sessionId:string,
  ):Promise<RespostaBancoPrechallengeInerte>{
    return response(await this.query(Q.reservar,[contextoId,userId,sessionId]));
  }
  async lerContexto(contextoId:string):Promise<ContextoPrivadoPrechallengeInerte|null>{
    const v=await this.query(Q.contexto,[contextoId]);
    // NULL em leitura pode significar inexistente OU guarda da ponte.
    // O orquestrador tratara a ausencia como recusa, nunca autorizacao.
    return v===null?null:context(v);
  }
  async registrarDesafio(
    nonce:string,challengeId:string,tentativa:string,
  ):Promise<RespostaBancoPrechallengeInerte>{
    return response(await this.query(Q.registrar,[nonce,challengeId,tentativa]));
  }
  async lerTentativa(tentativa:string):Promise<DesafioPrivadoPrechallengeInerte|null>{
    const v=await this.query(Q.tentativa,[tentativa]);
    return v===null?null:attempt(v);
  }
  async consumirDesafio(
    nonce:string,challengeId:string,tentativa:string,
  ):Promise<RespostaBancoPrechallengeInerte>{
    return response(await this.query(Q.consumir,[nonce,challengeId,tentativa]));
  }
}
