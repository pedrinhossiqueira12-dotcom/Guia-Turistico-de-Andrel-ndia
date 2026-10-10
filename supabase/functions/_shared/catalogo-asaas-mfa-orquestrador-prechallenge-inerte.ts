/**
 * #42 — ORQUESTRACAO DE CONTRATO DOCUMENTAL — SOMENTE TESTES OFFLINE.
 *
 * Nao importar em Edge HTTP ou UI. Nenhuma chamada de rede/SQL aqui:
 * Auth e as tabelas owner-only exigem injeção explicita pelos testes.
 * A API nunca autoriza parecer, saque, baixa ou outra movimentacao.
 *
 * DIFERENCA PARA O SIMULADOR ORIGINAL:
 * nonce e contexto chegam EXCLUSIVAMENTE do livro PostgreSQL privado,
 * nunca de intencao/nonce fornecido pelo browser. A consulta de tentativa
 * em confirmar() deve ser nova leitura do banco, nao Map em memoria.
 *
 * REAL GO-TRUE MFA ainda nao ligado: somente um adaptador confiavel ao
 * Auth, assinaturas verificadas e consultas privadas PODERAO implementar
 * este contrato. Mesmo se OTP verificar, continua HOLD.
 */
import type {
  PortaDeAutenticacaoFalsa, SessaoAferidaEmEnsaio,
} from "./catalogo-asaas-stepup-documental-ensaio.ts";

export interface ContextoPrivadoPrechallengeInerte {
  id: string;
  userId: string;
  sessionId: string;
  factorId: string;
  separationId: string;
  evidenceHash: string;
  expiresAt: number; // unix milliseconds obtidos do banco
}
export interface DesafioPrivadoPrechallengeInerte {
  nonce: string;
  tentativa: string;
  challengeId: string;
  contexto: ContextoPrivadoPrechallengeInerte;
}
export interface RespostaBancoPrechallengeInerte {
  ok: boolean;
  motivo: string;
  nonce?: string | null;
  status_operacional: string;
  pagamento_autorizado: boolean;
  challenge_go_true_verificado: boolean;
  desafio_mfa_da_sessao_comprovado: boolean;
  liberacao_autorizada: boolean;
  baixa_realizada: boolean;
  movimenta_dinheiro: boolean;
}
export interface LivroPrivadoPrechallengeInerte {
  // EXCLUSIVAMENTE conexão owner SQL; nao usar Data API/service_role.
  reservarInicio(contextoId: string): Promise<RespostaBancoPrechallengeInerte>;
  lerContexto(contextoId: string): Promise<ContextoPrivadoPrechallengeInerte | null>;
  registrarDesafio(
    nonce: string, challengeId: string, tentativa: string,
  ): Promise<RespostaBancoPrechallengeInerte>;
  lerTentativa(tentativa: string): Promise<DesafioPrivadoPrechallengeInerte | null>;
  consumirDesafio(
    nonce: string, challengeId: string, tentativa: string,
  ): Promise<RespostaBancoPrechallengeInerte>;
}
export interface ResultadoOrquestradorInerte {
  ok: boolean;
  motivo: string;
  tentativa?: string;
  desafio_mfa_real_comprovado: false;
  pagamento_autorizado: false;
  liberacao_autorizada: false;
  parecer_financeiro_autorizado: false;
  baixa_realizada: false;
  movimenta_dinheiro: false;
  status_operacional: "HOLD_OBRIGATORIO";
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64 = /^[a-f0-9]{64}$/;
function hold(ok: boolean, motivo: string, tentativa?: string): ResultadoOrquestradorInerte {
  return {
    ok, motivo, ...(ok && tentativa ? { tentativa } : {}),
    desafio_mfa_real_comprovado: false,
    pagamento_autorizado: false, liberacao_autorizada: false,
    parecer_financeiro_autorizado: false, baixa_realizada: false,
    movimenta_dinheiro: false, status_operacional: "HOLD_OBRIGATORIO",
  };
}
function sqlHOLD(v: RespostaBancoPrechallengeInerte | null | undefined): v is RespostaBancoPrechallengeInerte {
  return !!v && typeof v.ok === "boolean" && typeof v.motivo === "string"
    && v.status_operacional === "HOLD_OBRIGATORIO"
    && v.pagamento_autorizado === false
    && v.challenge_go_true_verificado === false
    && v.desafio_mfa_da_sessao_comprovado === false
    && v.liberacao_autorizada === false
    && v.baixa_realizada === false
    && v.movimenta_dinheiro === false;
}
function contextoValido(c: ContextoPrivadoPrechallengeInerte | null | undefined): c is ContextoPrivadoPrechallengeInerte {
  return !!c && [c.id,c.userId,c.sessionId,c.factorId,c.separationId]
    .every(x=>typeof x==="string" && UUID.test(x))
    && typeof c.evidenceHash==="string" && HEX64.test(c.evidenceHash)
    && typeof c.expiresAt==="number" && Number.isFinite(c.expiresAt);
}
function mesmaSessao(a: ContextoPrivadoPrechallengeInerte,s: SessaoAferidaEmEnsaio | null): boolean {
  return !!s && s.userId===a.userId && s.sessionId===a.sessionId
    && s.aal==="aal1" && s.factorId===null
    && s.role==="authenticated" && s.anonymous===false;
}
function depoisMesmoFator(a: ContextoPrivadoPrechallengeInerte,s: SessaoAferidaEmEnsaio | null): boolean {
  return !!s && s.userId===a.userId && s.sessionId===a.sessionId
    && s.aal==="aal2" && s.factorId===a.factorId
    && s.role==="authenticated" && s.anonymous===false;
}
export class OrquestradorPrechallengeInerte {
  constructor(
    private readonly livro: LivroPrivadoPrechallengeInerte,
    private readonly auth: PortaDeAutenticacaoFalsa,
    private readonly agora: ()=>number,
    private readonly ambiente: "isolated-ci",
  ) {
    if (ambiente !== "isolated-ci" || typeof agora !== "function"
      || !livro || !auth) throw new Error("Orquestrador financeiro real proibido");
  }

  async iniciar(contextoId: string,bearer: string): Promise<ResultadoOrquestradorInerte> {
    if (typeof contextoId!=="string" || !UUID.test(contextoId)
      || typeof bearer!=="string" || bearer.length<1 || bearer.length>8192)
      return hold(false,"contexto_ou_bearer_invalido");
    const iniciouEm=this.agora();
    if (!Number.isFinite(iniciouEm)) return hold(false,"relogio_invalido");
    // REGISTRA no banco antes de QUALQUER await de Auth.
    // Falhas queimam o nonce, impedindo reprocessamentos silenciosos.
    let reservado: RespostaBancoPrechallengeInerte;
    try { reservado=await this.livro.reservarInicio(contextoId); }
    catch { return hold(false,"reserva_sql_indisponivel"); }
    if (!sqlHOLD(reservado) || reservado.ok!==true
      || typeof reservado.nonce!=="string" || !UUID.test(reservado.nonce))
      return hold(false,"reserva_sql_recusada_ou_sem_hold");
    // So depois da reserva buscar os dados originais do CONTEXTO PRIVADO.
    let contexto: ContextoPrivadoPrechallengeInerte | null;
    try { contexto=await this.livro.lerContexto(contextoId); }
    catch { return hold(false,"contexto_privado_indisponivel"); }
    if (!contextoValido(contexto) || contexto.id!==contextoId
      || this.agora()>=Math.min(contexto.expiresAt,iniciouEm+120000))
      return hold(false,"contexto_privado_invalido_ou_expirado");
    const original=Object.freeze({...contexto});
    let principal: SessaoAferidaEmEnsaio | null;
    try { principal=await this.auth.autenticarToken(bearer,"inicio"); }
    catch { return hold(false,"auth_inicial_indisponivel"); }
    if (!mesmaSessao(original,principal)) return hold(false,"sessao_aal1_divergente");
    try {
      const owns=await this.auth.verificarFatorTotpAal1({
        userId:original.userId,sessionId:original.sessionId,factorId:original.factorId,
      });
      if (owns!==true) return hold(false,"fator_totp_privado_invalido");
    } catch { return hold(false,"fator_totp_privado_indisponivel"); }
    if (this.agora()>=Math.min(original.expiresAt,iniciouEm+120000))
      return hold(false,"contexto_privado_expirado_antes_challenge");
    const tentativa=crypto.randomUUID(); // nunca fornecida pelo cliente
    let challengeId: string;
    try {
      const ch=await this.auth.criarDesafio({bearerToken:bearer,factorId:original.factorId});
      challengeId=ch?.id;
    } catch { return hold(false,"auth_challenge_indisponivel"); }
    if (typeof challengeId!=="string" || !UUID.test(challengeId)
      || this.agora()>=Math.min(original.expiresAt,iniciouEm+120000))
      return hold(false,"auth_challenge_invalido_ou_expirado");
    let registered: RespostaBancoPrechallengeInerte;
    try { registered=await this.livro.registrarDesafio(reservado.nonce,challengeId,tentativa); }
    catch { return hold(false,"registro_challenge_sql_indisponivel"); }
    if (!sqlHOLD(registered) || registered.ok!==true
      || registered.nonce!==reservado.nonce
      || this.agora()>=Math.min(original.expiresAt,iniciouEm+120000))
      return hold(false,"registro_challenge_sql_recusado");
    return hold(true,"desafio_documental_registrado_sem_mfa",tentativa);
  }

  async confirmar(tentativa: string,bearer: string,otp: string): Promise<ResultadoOrquestradorInerte> {
    if (typeof tentativa!=="string" || !UUID.test(tentativa)
      || typeof bearer!=="string" || bearer.length<1 || bearer.length>8192)
      return hold(false,"tentativa_ou_bearer_invalido");
    if (typeof otp!=="string" || !/^\d{6}$/.test(otp))
      return hold(false,"formato_otp_invalido");
    let registro: DesafioPrivadoPrechallengeInerte | null;
    // NAO ler Map local: instancia que inicia pode ser diferente da que confirma.
    try { registro=await this.livro.lerTentativa(tentativa); }
    catch { return hold(false,"tentativa_sql_indisponivel"); }
    if (!registro || registro.tentativa!==tentativa
      || !UUID.test(registro.nonce) || !UUID.test(registro.challengeId)
      || !contextoValido(registro.contexto) || this.agora()>=registro.contexto.expiresAt)
      return hold(false,"tentativa_sql_invalida_ou_expirada");
    const frozen=Object.freeze({...registro,contexto:Object.freeze({...registro.contexto})});
    let antes: SessaoAferidaEmEnsaio | null;
    try { antes=await this.auth.autenticarToken(bearer,"inicio"); }
    catch { return hold(false,"auth_confirmacao_indisponivel"); }
    if (!mesmaSessao(frozen.contexto,antes))return hold(false,"sessao_confirmacao_divergente");
    try {
      const owns=await this.auth.verificarFatorTotpAal1({
        userId:frozen.contexto.userId,sessionId:frozen.contexto.sessionId,
        factorId:frozen.contexto.factorId,
      });
      if (owns!==true) return hold(false,"fator_confirmacao_invalido");
    } catch { return hold(false,"fator_confirmacao_indisponivel"); }
    if(this.agora()>=frozen.contexto.expiresAt) return hold(false,"tentativa_expirada_antes_consumo");
    let consumo: RespostaBancoPrechallengeInerte;
    // Consumo at-most-once SQL ANTES da verificacao do OTP no Auth.
    try {consumo=await this.livro.consumirDesafio(frozen.nonce,frozen.challengeId,tentativa);}
    catch { return hold(false,"consumo_sql_indisponivel"); }
    if (!sqlHOLD(consumo) || consumo.ok!==true || consumo.nonce!==frozen.nonce)
      return hold(false,"consumo_sql_recusado_ou_sem_hold");
    if(this.agora()>=frozen.contexto.expiresAt) return hold(false,"tentativa_expirada_apos_consumo");
    let nextToken: string;
    try {
      const verified=await this.auth.verificarDesafio({
        bearerToken:bearer,factorId:frozen.contexto.factorId,
        challengeId:frozen.challengeId,otp,
      });
      nextToken=verified?.accessToken;
    } catch { return hold(false,"auth_verify_indisponivel_ou_recusado"); }
    if (typeof nextToken!=="string" || !nextToken
      || this.agora()>=frozen.contexto.expiresAt)
      return hold(false,"auth_token_depois_invalido");
    let depois: SessaoAferidaEmEnsaio | null;
    try { depois=await this.auth.autenticarToken(nextToken,"apos_verificacao"); }
    catch { return hold(false,"auth_aal2_indisponivel"); }
    if (!depoisMesmoFator(frozen.contexto,depois)
      || this.agora()>=frozen.contexto.expiresAt)
      return hold(false,"aal2_nao_prova_mesma_sessao_fator");
    // Mesmo AAL2 depois de verify nao prova a vinculacao temporal no GoTrue.
    // Nenhuma funcao financeira deve interpretar esta resposta como autorizacao.
    return hold(true,"protocolo_auth_conferido_sem_prova_financeira");
  }
}
