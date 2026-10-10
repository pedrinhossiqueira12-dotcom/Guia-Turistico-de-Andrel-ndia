/**
 * #42 | PROTOCOLO MFA SIMULADO, ISOLADO E INERTE.
 *
 * Nao importar de Edge Functions ou paginas em producao. Somente testes offline.
 * As interfaces simulam Supabase Auth challenge/verify, mas NAO fazem chamadas reais.
 * A prova em CI NUNCA autoriza pagamento, baixa, parecer ou liberacao.
 */
export interface SessaoAferidaEmEnsaio {
  userId: string;
  sessionId: string;
  role: "authenticated";
  aal: "aal1" | "aal2";
  factorId: string | null;
  anonymous: boolean;
}

export interface IntencaoDocumentalEmEnsaio {
  nonce: string;
  userId: string;
  sessionId: string;
  factorId: string;
  separationId: string;
  evidenceHash: string;
  purpose: "consulta_documental_ensaio";
  expiresAt: number;
  consumed: boolean;
}

export interface PortaDeAutenticacaoFalsa {
  // A implementacao da fixture simula sessao verificada pelo Auth.
  // Nenhum JWT decodificado sem assinatura deve virar principal real.
  // "inicio" pode ser sessao AAL1 (factorId ainda nulo em auth.sessions).
  // "apos_verificacao" exige AAL2 + factorId correto. CI somente.
  autenticarToken(token: string, fase?: "inicio" | "apos_verificacao"): Promise<SessaoAferidaEmEnsaio | null>;
  // Leitor de titularidade de fator TOTP em auth.mfa_factors,
  // obrigatório ANTES do challenge quando a sessão é AAL1.
  // Nao verifica OTP nem prova a operacao.
  verificarFatorTotpAal1(args: {
    userId: string;
    sessionId: string;
    factorId: string;
  }): Promise<boolean>;
  criarDesafio(args: {
    bearerToken: string;
    factorId: string;
  }): Promise<{ id: string }>;
  verificarDesafio(args: {
    bearerToken: string;
    factorId: string;
    challengeId: string;
    otp: string;
  }): Promise<{ accessToken: string }>;
}

/**
 * Contrato de auditoria apenas para CI: porta compartilhada entre instancias.
 * Nao implementa armazenamento persistente nem abre acesso a Data API.
 * Um backend real devera implementar estas reservas de forma transacional
 * em PostgreSQL, com revalidacao server-side de sessao/acao/evidencias.
 * Nunca recebe bearer, OTP, refresh_token ou segredo MFA.
 */
export interface PortaReservaCompartilhadaMfaEmEnsaio {
  reservarInicio(args: Readonly<{
    nonce: string;
    userId: string;
    sessionId: string;
    factorId: string;
    separationId: string;
    evidenceHash: string;
    expiresAt: number;
  }>): Promise<boolean>;
  reservarVerificacao(args: Readonly<{
    nonce: string;
    tentativa: string;
    challengeId: string;
    userId: string;
    sessionId: string;
    factorId: string;
    separationId: string;
    evidenceHash: string;
    expiresAt: number;
  }>): Promise<boolean>;
}

type Registro = {
  tentativa: string;
  intencao: IntencaoDocumentalEmEnsaio;
  sessaoOriginal: SessaoAferidaEmEnsaio;
  challengeId: string;
  expiraEm: number;
  estado: "pendente" | "processando" | "consumida" | "recusada";
};

export type ResultadoInerte = {
  ok: boolean;
  motivo: string;
  tentativa?: string;
  protocolo_mock_validado: boolean;
  desafio_mfa_real_comprovado: false;
  parecer_financeiro_autorizado: false;
  pagamento_autorizado: false;
  liberacao_autorizada: false;
  baixa_realizada: false;
  movimenta_dinheiro: false;
  status_operacional: "HOLD_OBRIGATORIO";
};

function resposta(ok: boolean, motivo: string, tentativa?: string): ResultadoInerte {
  return {
    ok, motivo, ...(tentativa ? { tentativa } : {}),
    protocolo_mock_validado: ok && motivo === "desafio_simulado_conferido",
    desafio_mfa_real_comprovado: false,
    parecer_financeiro_autorizado: false,
    pagamento_autorizado: false,
    liberacao_autorizada: false,
    baixa_realizada: false,
    movimenta_dinheiro: false,
    status_operacional: "HOLD_OBRIGATORIO",
  };
}

function idCoerente(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}
function hashCoerente(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}
function mesmaIdentidade(a: SessaoAferidaEmEnsaio, b: SessaoAferidaEmEnsaio): boolean {
  return a.userId === b.userId && a.sessionId === b.sessionId
    && a.role === b.role && !b.anonymous;
}
function mesmoEstadoAntes(a: SessaoAferidaEmEnsaio, b: SessaoAferidaEmEnsaio): boolean {
  return mesmaIdentidade(a,b) && a.aal === b.aal && a.factorId === b.factorId;
}

/**
 * Mecanica didatica: challengeId fica no servidor, never no payload do cliente.
 * Contextos e tokens sao ficticios, storage em memoria e sem durabilidade.
 * O literal "isolated-ci" e proposital: nao ha modo de producao neste modulo.
 */
export class SimuladorStepUpDocumental {
  private readonly tentativas = new Map<string, Registro>();
  // Uma reserva atomicamente síncrona por nonce ANTES de qualquer await.
  // No simulador, falhas queimam o nonce: proibido retry silencioso.
  // Em backend real, usar UNIQUE + transacao PostgreSQL, nao este Set.
  private readonly noncesReservados = new Set<string>();

  constructor(
    private readonly provider: PortaDeAutenticacaoFalsa,
    private readonly agora: () => number,
    private readonly ambiente: "isolated-ci",
    private readonly reservaCompartilhada?: PortaReservaCompartilhadaMfaEmEnsaio,
  ) {
    if (ambiente !== "isolated-ci") throw new Error("MFA simulado proibido fora da CI");
  }

  async iniciar(intencao: IntencaoDocumentalEmEnsaio, bearerToken: string): Promise<ResultadoInerte> {
    const instante = this.agora();
    if (!intencao || intencao.purpose !== "consulta_documental_ensaio"
      || !idCoerente(intencao.nonce) || !idCoerente(intencao.userId)
      || !idCoerente(intencao.sessionId) || !idCoerente(intencao.factorId)
      || !idCoerente(intencao.separationId)
      || !hashCoerente(intencao.evidenceHash)
      || !Number.isFinite(intencao.expiresAt) || intencao.consumed
      || intencao.expiresAt <= instante) {
      return resposta(false, "intencao_invalida_ou_expirada");
    }
    // Fazer snapshot ANTES da primeira espera async. O chamador nao
    // pode trocar revisor, fator, nonce, escrow ou hash durante o IO.
    const snapshot = Object.freeze({ ...intencao });
    // ANTES de autenticar o bearer, de consultar o fator ou de emitir
    // challenge: bloquear duas chamadas concorrentes no mesmo processo.
    // Inclui cenários com callbacks de rede pendentes/indisponíveis.
    if (this.noncesReservados.has(snapshot.nonce)) {
      return resposta(false, "intencao_ja_vinculada");
    }
    this.noncesReservados.add(snapshot.nonce);
    // Uma reserva externa rejeita replay entre DUAS instancias simuladas.
    // Se falhar ou ficar indisponivel, nao chamar Auth nem criar challenge.
    // Em producao a reserva deve ser transacional e persistida, nao fake.
    if (this.reservaCompartilhada) {
      try {
        const reservado = await this.reservaCompartilhada.reservarInicio({
          nonce: snapshot.nonce,
          userId: snapshot.userId,
          sessionId: snapshot.sessionId,
          factorId: snapshot.factorId,
          separationId: snapshot.separationId,
          evidenceHash: snapshot.evidenceHash,
          expiresAt: snapshot.expiresAt,
        });
        if (reservado !== true) {
          return resposta(false, "reserva_compartilhada_inicio_duplicada");
        }
      } catch {
        return resposta(false, "reserva_compartilhada_inicio_indisponivel");
      }
      if (this.agora() >= Math.min(instante + 120_000, snapshot.expiresAt)) {
        return resposta(false, "desafio_ou_intencao_expirada");
      }
    }
    let sessao: SessaoAferidaEmEnsaio | null = null;
    try {
      sessao = await this.provider.autenticarToken(bearerToken, "inicio");
    } catch {
      return resposta(false, "autenticacao_indisponivel");
    }
    if (!sessao || sessao.role !== "authenticated" || sessao.anonymous
      || sessao.userId !== snapshot.userId || sessao.sessionId !== snapshot.sessionId
      || !(sessao.aal === "aal1" && sessao.factorId === null
        || sessao.aal === "aal2" && sessao.factorId === snapshot.factorId)) {
      return resposta(false, "sessao_ou_fator_divergente");
    }
    // O JWT AAL1 não inclui fator associado à sessão: antes de permitir
    // o challenge, exigir que o fator TOTP VERIFICADO pertença ao usuário
    // de auth.sessions. O banco backend é independente do JWT do cliente.
    if (sessao.aal === "aal1") {
      try {
        const fatorElegivel = await this.provider.verificarFatorTotpAal1({
          userId: sessao.userId,
          sessionId: sessao.sessionId,
          factorId: snapshot.factorId,
        });
        if (fatorElegivel !== true) {
          return resposta(false, "fator_totp_nao_elegivel");
        }
      } catch {
        return resposta(false, "checagem_fator_totp_indisponivel");
      }
    }
    // A reserva é feita ANTES de todos os awaits; esse ponto não
    // pode ser a primeira trava (Auth e factor preflight são async).
    if (this.agora() >= Math.min(instante + 120_000, snapshot.expiresAt)) {
      return resposta(false, "desafio_ou_intencao_expirada");
    }
    // Marcar o desafio antes de seu await para impedir reentrância.
    const tentativa = crypto.randomUUID();
    const registro: Registro = {
      tentativa, intencao: { ...snapshot }, sessaoOriginal: { ...sessao },
      challengeId: "", expiraEm: Math.min(instante + 120_000, snapshot.expiresAt),
      estado: "processando",
    };
    this.tentativas.set(tentativa, registro);
    try {
      const challenge = await this.provider.criarDesafio({ bearerToken, factorId: snapshot.factorId });
      if (!challenge || !idCoerente(challenge.id)
        || this.agora() >= registro.expiraEm) {
        registro.estado = "recusada";
        return resposta(false, "desafio_nao_criado");
      }
      registro.challengeId = challenge.id;
      registro.estado = "pendente";
      return resposta(true, "desafio_simulado_iniciado", tentativa);
    } catch {
      registro.estado = "recusada";
      return resposta(false, "provedor_simulado_indisponivel");
    }
  }

  async confirmar(tentativa: string, bearerToken: string, otp: string): Promise<ResultadoInerte> {
    const r = this.tentativas.get(tentativa);
    if (!r || r.estado !== "pendente") return resposta(false, "tentativa_indisponivel_ou_consumida");
    // Os 6 digitos sao verificados pelo provider fake. Nunca armazenar/logar OTP.
    if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
      return resposta(false, "formato_otp_invalido");
    }
    if (this.agora() >= r.expiraEm) {
      r.estado = "recusada";
      return resposta(false, "desafio_ou_intencao_expirada");
    }
    // Consumir atomicamente no processo JS ANTES de qualquer chamada assíncrona.
    // Um endpoint futuro ainda exigira storage/locks compartilhados em Postgres.
    r.estado = "processando";
    // Consumo global antes de qualquer OTP ou revalidacao via rede.
    // A chave inclui nonce + challenge + identidade e evidencia originais.
    if (this.reservaCompartilhada) {
      try {
        const reservado = await this.reservaCompartilhada.reservarVerificacao({
          nonce: r.intencao.nonce,
          tentativa: r.tentativa,
          challengeId: r.challengeId,
          userId: r.sessaoOriginal.userId,
          sessionId: r.sessaoOriginal.sessionId,
          factorId: r.intencao.factorId,
          separationId: r.intencao.separationId,
          evidenceHash: r.intencao.evidenceHash,
          expiresAt: r.expiraEm,
        });
        if (reservado !== true) {
          r.estado = "recusada";
          return resposta(false, "reserva_compartilhada_verificacao_duplicada");
        }
      } catch {
        r.estado = "recusada";
        return resposta(false, "reserva_compartilhada_verificacao_indisponivel");
      }
      if (this.agora() >= r.expiraEm) {
        r.estado = "recusada";
        return resposta(false, "desafio_ou_intencao_expirada");
      }
    }
    try {
      const antes = await this.provider.autenticarToken(bearerToken, "inicio");
      if (!antes || !mesmoEstadoAntes(r.sessaoOriginal, antes)) {
        r.estado = "recusada";
        return resposta(false, "sessao_de_confirmacao_divergente");
      }
      // Auth pode demorar: não encaminhar OTP ao provedor depois do prazo.
      // A validação inicial antes do await não basta para esta janela.
      if (this.agora() >= r.expiraEm) {
        r.estado = "recusada";
        return resposta(false, "desafio_ou_intencao_expirada");
      }
      const verificado = await this.provider.verificarDesafio({
        bearerToken, factorId: r.intencao.factorId,
        challengeId: r.challengeId, otp,
      });
      if (!verificado || !verificado.accessToken) {
        r.estado = "recusada";
        return resposta(false, "challenge_recusado");
      }
      // O resultado confiavel DEVE vir de nova autenticacao pelo Auth
      // e comparar a mesma sessao; um JWT AAL2 alegado pelo cliente nao serve.
      const depois = await this.provider.autenticarToken(verificado.accessToken, "apos_verificacao");
      if (!depois || !mesmaIdentidade(r.sessaoOriginal, depois)
        || depois.factorId !== r.intencao.factorId
        || depois.aal !== "aal2"
        || this.agora() >= r.expiraEm) {
        r.estado = "recusada";
        return resposta(false, "resposta_auth_sem_mesma_sessao_aal2");
      }
      r.estado = "consumida";
      return resposta(true, "desafio_simulado_conferido");
    } catch {
      r.estado = "recusada";
      return resposta(false, "verificacao_simulada_falhou");
    }
  }
}
