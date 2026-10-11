/**
 * #42 — Adaptador SQL para as CINCO funções da ponte MFA NOLOGIN (CI ONLY).
 *
 * Sem pool/conexão, senha, driver, HTTP, Edge, service_role ou PostgREST.
 * Requer executor de banco DESCARTAVEL e role CI explícita. Nunca usar
 * em STAGING/PROD. Não concede autorização financeira nem prova MFA real.
 *
 * O próprio SQL consulta banco/current_user/session_user a cada statement
 * na MESMA conexão da função; backend não injeta SET ROLE nem credenciais.
 * NULL é fail-closed para operações de escrita; leituras NULL são ausência.
 */
import type {
  LivroPrivadoPrechallengeInerte,
  RespostaBancoPrechallengeInerte,
  ContextoPrivadoPrechallengeInerte,
  DesafioPrivadoPrechallengeInerte,
} from "./catalogo-asaas-mfa-orquestrador-prechallenge-inerte.ts";

export interface ExecutorPonteMfaNoLoginSomenteCi {
  readonly databaseName: "catalogo_asaas_guards_ci";
  readonly currentRole: "catalogo_mfa_ponte_ci_inerte";
  queryObject(sql: string, params: readonly string[]): Promise<readonly Record<string,unknown>[]>;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const pre="SELECT CASE WHEN current_database() = 'catalogo_asaas_guards_ci'"+
 " AND current_user = 'catalogo_mfa_ponte_ci_inerte'"+
 " AND session_user = 'postgres' THEN ";
const sql=Object.freeze({
  vinculado:pre+"catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_reservar_principal_inerte($1::uuid,$2::uuid,$3::uuid) END AS result",
  contexto:pre+"catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_ler_contexto_inerte($1::uuid) END AS result",
  registrar:pre+"catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_registrar_desafio_inerte($1::uuid,$2::uuid,$3::uuid) END AS result",
  tentativa:pre+"catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_ler_tentativa_inerte($1::uuid) END AS result",
  consumir:pre+"catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_consumir_desafio_inerte($1::uuid,$2::uuid,$3::uuid) END AS result",
});
function obj(v:unknown):v is Record<string,unknown>{
  return v!==null && typeof v==="object" && !Array.isArray(v);
}
function uuid(v:unknown):v is string{return typeof v==="string"&&UUID.test(v);}
function hold(raw:unknown):RespostaBancoPrechallengeInerte {
  if(!obj(raw)||typeof raw.ok!=="boolean" ||typeof raw.motivo!=="string"
    || raw.motivo.length<1 ||raw.motivo.length>160
    || (![undefined,null].includes(raw.nonce as undefined|null) && !uuid(raw.nonce))
    // Recusas nao podem entregar nonce validavel ao chamador: o banco
    // deve falhar FECHADO antes de queimar ou emitir um nonce do revisor.
    || (raw.ok===false && raw.nonce!==null && raw.nonce!==undefined)
    || (raw.ok===true && !uuid(raw.nonce))
    || raw.status_operacional!=="HOLD_OBRIGATORIO"
    || raw.pagamento_autorizado!==false
    || raw.challenge_go_true_verificado!==false
    || raw.desafio_mfa_da_sessao_comprovado!==false
    || raw.pode_registrar_parecer!==false
    || raw.dupla_aprovacao_financeira!==false
    || raw.liberacao_autorizada!==false
    || raw.baixa_realizada!==false
    || raw.movimenta_dinheiro!==false) {
    throw Error("ponte_sql_invalida_ou_sem_hold");
  }
  return {
    ok:raw.ok,motivo:raw.motivo,
    nonce:raw.nonce===undefined?null:raw.nonce as string|null,
    status_operacional:"HOLD_OBRIGATORIO",pagamento_autorizado:false,
    challenge_go_true_verificado:false,desafio_mfa_da_sessao_comprovado:false,
    pode_registrar_parecer:false,dupla_aprovacao_financeira:false,
    liberacao_autorizada:false,baixa_realizada:false,movimenta_dinheiro:false,
  };
}
function contexto(raw:unknown):ContextoPrivadoPrechallengeInerte{
  if(!obj(raw)||!uuid(raw.id)||!uuid(raw.userId)||!uuid(raw.sessionId)
    ||!uuid(raw.factorId)||!uuid(raw.separationId)
    ||typeof raw.evidenceHash!=="string"||!SHA.test(raw.evidenceHash)
    ||typeof raw.expiresAt!=="number"||!Number.isSafeInteger(raw.expiresAt)
    ||raw.expiresAt<=0)throw Error("ponte_sql_snapshot_invalido");
  return {
    id:raw.id,userId:raw.userId,sessionId:raw.sessionId,
    factorId:raw.factorId,separationId:raw.separationId,
    evidenceHash:raw.evidenceHash,expiresAt:raw.expiresAt,
  };
}
function tentativa(raw:unknown):DesafioPrivadoPrechallengeInerte{
  if(!obj(raw)||!uuid(raw.nonce)||!uuid(raw.tentativa)||!uuid(raw.challengeId))
    throw Error("ponte_sql_tentativa_invalida");
  return {nonce:raw.nonce,tentativa:raw.tentativa,challengeId:raw.challengeId,
    contexto:contexto(raw.contexto)};
}
export class LivroSqlPonteNoLoginInerte implements LivroPrivadoPrechallengeInerte {
  constructor(private readonly db:ExecutorPonteMfaNoLoginSomenteCi,
    ambiente:"isolated-ci") {
    if(ambiente!=="isolated-ci"||!db||
      db.databaseName!=="catalogo_asaas_guards_ci"||
      db.currentRole!=="catalogo_mfa_ponte_ci_inerte"||
      typeof db.queryObject!=="function")throw Error("ponte_nao_e_conexao_ci_descartavel");
  }
  private async run(statement:string,params:readonly string[]):Promise<unknown>{
    if(params.some(v=>!uuid(v)))throw Error("ponte_parametro_uuid_invalido");
    const rows=await this.db.queryObject(statement,params);
    if(!Array.isArray(rows)||rows.length!==1||!obj(rows[0])||
      !Object.hasOwn(rows[0],"result"))throw Error("ponte_resultado_sql_invalido");
    return rows[0].result;
  }
  async reservarInicioVinculado(contextoId:string,userId:string,sessionId:string){
    return hold(await this.run(sql.vinculado,[contextoId,userId,sessionId]));
  }
  async lerContexto(id:string):Promise<ContextoPrivadoPrechallengeInerte|null>{
    const v=await this.run(sql.contexto,[id]);
    if(v===null)return null;
    const row=contexto(v);
    // A consulta privada nao pode devolver dados de outro contexto, mesmo
    // quando todas as propriedades isoladamente sao UUIDs validos.
    if(row.id!==id)throw Error("ponte_sql_contexto_trocado");
    return row;
  }
  async registrarDesafio(nonce:string,challengeId:string,attempt:string){
    const response=hold(await this.run(sql.registrar,[nonce,challengeId,attempt]));
    // Operacoes aceitas devem atestar o MESMO nonce que foi fornecido.
    // Nao aceitar nonce de outro revisor/operacao pelo resultado do SQL.
    if(response.ok && response.nonce!==nonce)
      throw Error("ponte_sql_nonce_de_operacao_divergente");
    return response;
  }
  async lerTentativa(id:string):Promise<DesafioPrivadoPrechallengeInerte|null>{
    const v=await this.run(sql.tentativa,[id]);
    if(v===null)return null;
    const row=tentativa(v);
    if(row.tentativa!==id)throw Error("ponte_sql_tentativa_trocada");
    return row;
  }
  async consumirDesafio(nonce:string,challengeId:string,attempt:string){
    const response=hold(await this.run(sql.consumir,[nonce,challengeId,attempt]));
    if(response.ok && response.nonce!==nonce)
      throw Error("ponte_sql_nonce_de_operacao_divergente");
    return response;
  }
}
