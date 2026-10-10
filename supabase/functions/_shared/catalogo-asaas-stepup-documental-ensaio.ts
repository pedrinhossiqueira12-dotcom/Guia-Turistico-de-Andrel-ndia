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
  autenticarToken(token: string): Promise<SessaoAferidaEmEnsaio | null>;
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
function sessaoIgual(a: SessaoAferidaEmEnsaio, b: SessaoAferidaEmEnsaio): boolean {
  return a.userId === b.userId && a.sessionId === b.sessionId
    && a.factorId === b.factorId && a.role === b.role && !b.anonymous;
}

/**
 * Mecanica didatica: challengeId fica no servidor, never no payload do cliente.
 * Contextos e tokens sao ficticios, storage em memoria e sem durabilidade.
 * O literal "isolated-ci" e proposital: nao ha modo de producao neste modulo.
 */
export class SimuladorStepUpDocumental {
  private readonly tentativas = new Map<string, Registro>();

  constructor(
    private readonly provider: PortaDeAutenticacaoFalsa,
    private readonly agora: () => number,
    private readonly ambiente: "isolated-ci",
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
    const sessao = await this.provider.autenticarToken(bearerToken);
    if (!sessao || sessao.role !== "authenticated" || sessao.anonymous
      || sessao.userId !== intencao.userId || sessao.sessionId !== intencao.sessionId
      || sessao.factorId !== intencao.factorId) {
      return resposta(false, "sessao_ou_fator_divergente");
    }
    // Nao aceitar duplicar desafio ativo para o mesmo nonce.
    if ([...this.tentativas.values()].some(r => r.intencao.nonce === intencao.nonce)) {
      return resposta(false, "intencao_ja_vinculada");
    }
    // Marcar ANTES do primeiro await de criacao para evitar duplo begin.
    const tentativa = crypto.randomUUID();
    const registro: Registro = {
      tentativa, intencao: { ...intencao }, sessaoOriginal: { ...sessao },
      challengeId: "", expiraEm: Math.min(instante + 120_000, intencao.expiresAt),
      estado: "processando",
    };
    this.tentativas.set(tentativa, registro);
    try {
      const challenge = await this.provider.criarDesafio({ bearerToken, factorId: intencao.factorId });
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
    try {
      const antes = await this.provider.autenticarToken(bearerToken);
      if (!antes || !sessaoIgual(r.sessaoOriginal, antes)) {
        r.estado = "recusada";
        return resposta(false, "sessao_de_confirmacao_divergente");
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
      const depois = await this.provider.autenticarToken(verificado.accessToken);
      if (!depois || !sessaoIgual(r.sessaoOriginal, depois)
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
