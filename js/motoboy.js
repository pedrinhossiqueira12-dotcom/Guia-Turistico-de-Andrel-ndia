(() => {
  "use strict";

  const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  const API_URL = `${SUPABASE_URL}/functions/v1/catalogo-entregas`;
  const ASAAS_URL = `${SUPABASE_URL}/functions/v1/catalogo-asaas-financeiro`;
  const STALE_REQUEST = "STALE_SESSION_REQUEST";
  const STATUS_LABELS = {
    nao_atribuido: "Aguardando distribuição",
    ofertado: "Oferta disponível",
    reservado: "Reservada para você",
    coletado: "Pedido coletado",
    em_entrega: "Em entrega",
    entregue: "Entregue",
    cancelamento_solicitado: "Ocorrência em análise",
    cancelado: "Cancelada",
    aguardando_pagamento: "Aguardando pagamento",
    em_preparo: "Em preparo",
    pronto: "Pronto para coleta",
  };
  const PAYMENT_LABELS = {
    pix: "Pix",
    mercadopago: "Pagamento online",
    dinheiro: "Presencial em dinheiro",
    cartao_credito: "Presencial no cartão de crédito",
    cartao_debito: "Presencial no cartão de débito",
    pagamento_entrega: "Pagamento presencial",
    pagamento_local: "Pagamento presencial",
  };
  const OCCURRENCE_CATEGORIES = {
    cliente_nao_localizado: "Cliente não localizado",
    endereco_incorreto: "Endereço incorreto",
    problema_pedido: "Problema com o pedido",
    acidente: "Imprevisto no trajeto",
    outro: "Outro motivo",
  };
  const ACTION_FIELDS = {
    listar_entregas: ["offset"],
    consultar_extrato: ["offset"],
    consultar_carteira: [],
    solicitar_saque: [],
    definir_disponibilidade: ["disponivel"],
    aceitar_entrega: ["pedido_id"],
    coletar: ["pedido_id"],
    em_entrega: ["pedido_id"],
    desistir_entrega: ["pedido_id", "motivo"],
    registrar_ocorrencia: ["pedido_id", "categoria", "motivo"],
    salvar_chave_pix: ["chave_pix"],
    confirmar_entrega: ["pedido_id", "comercio_id", "codigo_entrega", "recebimento_confirmado"],
  };

  const state = {
    client: null,
    session: null,
    termosAceitos: false,
    sessionToken: "",
    userId: "",
    generation: 0,
    pedidos: [],
    offset: 0,
    hasMore: false,
    extrato: null,
    carteira: null,
    withdrawalLoading: false,
    timer: null,
    subscription: null,
    destroyed: false,
    lockedAfterLogout: false,
    loading: false,
    extractLoading: false,
    actionInFlight: new Set(),
    availability: false,
    availabilityLoading: false,
    commerceNames: new Map(),
  };

  const $ = (id) => document.getElementById(id);

  function obterCliente() {
    if (state.client) return state.client;
    if (window.supabaseLoginClient) {
      state.client = window.supabaseLoginClient;
      return state.client;
    }
    if (window.supabase && typeof window.supabase.createClient === "function") {
      window.supabaseLoginClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      state.client = window.supabaseLoginClient;
      return state.client;
    }
    return null;
  }

  function escapar(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, (caractere) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[caractere]);
  }

  function textoSeguro(valor, limite = 500) {
    return String(valor ?? "").trim().slice(0, limite);
  }

  function definirFeedback(id, mensagem, erro = false) {
    const elemento = $(id);
    if (!elemento) return;
    elemento.textContent = mensagem || "";
    elemento.classList.toggle("is-error", Boolean(erro));
  }

  function definirAviso(titulo, texto, estado = "") {
    const aviso = $("motoboyNotice");
    if (!aviso) return;
    $("motoboyNoticeTitle").textContent = titulo || "";
    $("motoboyNoticeText").textContent = texto || "";
    aviso.classList.toggle("is-error", estado === "erro");
    aviso.classList.toggle("is-success", estado === "sucesso");
  }

  function formatarMoeda(centavos) {
    const valor = Number(centavos);
    if (!Number.isFinite(valor)) return "R$ 0,00";
    return (valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatarData(valor) {
    if (!valor) return "";
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return "";
    return data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }

  function statusEntrega(pedido) {
    return String(pedido?.entrega_status || pedido?.status || "").toLowerCase();
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || "Em acompanhamento";
  }

  function statusClass(status) {
    if (["ofertado", "pronto"].includes(status)) return "is-ready";
    if (["entregue"].includes(status)) return "is-complete";
    if (["cancelado", "cancelamento_solicitado"].includes(status)) return "is-danger";
    return "is-waiting";
  }

  function enderecoPedido(pedido) {
    return [pedido?.cliente_endereco, pedido?.cliente_numero, pedido?.cliente_bairro, pedido?.cliente_complemento, pedido?.cliente_referencia, pedido?.cliente_cidade]
      .filter((valor) => String(valor ?? "").trim())
      .map((valor) => String(valor).trim())
      .join(", ");
  }

  function telefoneSeguro(valor) {
    const numero = String(valor ?? "").replace(/[^\d+]/g, "");
    return numero.length >= 8 ? `tel:${numero}` : "";
  }

  function rotaSegura(pedido) {
    const destino = enderecoPedido(pedido);
    if (!destino) return "";
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)}`;
    try {
      const validada = new URL(url);
      return validada.protocol === "https:" && validada.hostname === "www.google.com" ? validada.href : "";
    } catch {
      return "";
    }
  }

  function formaPagamento(pedido) {
    const forma = String(pedido?.forma_pagamento || pedido?.metodo_pagamento || "").toLowerCase();
    return PAYMENT_LABELS[forma] || (forma ? textoSeguro(forma, 60) : "Pagamento informado pelo servidor");
  }

  function pagamentoPix(pedido) {
    const forma = String(pedido?.forma_pagamento || pedido?.metodo_pagamento || "").toLowerCase();
    return forma === "pix" || forma === "pix_online" || pedido?.pix_pago === true;
  }

  function pedidoEhOferta(pedido) {
    return pedido?.oferta === true || statusEntrega(pedido) === "ofertado";
  }

  function pedidoPertenceAoMotoboy(pedido) {
    if (pedidoEhOferta(pedido)) return false;
    const ids = [pedido?.motoboy_id, pedido?.entregador_id, pedido?.responsavel_id, pedido?.atribuido_para]
      .filter(Boolean).map(String);
    return !ids.length || ids.includes(String(state.userId));
  }

  function validarSessaoAtual(generation, userId) {
    if (state.destroyed || generation !== state.generation || !state.session || state.userId !== userId) {
      throw new Error(STALE_REQUEST);
    }
  }

  function prepararBody(body) {
    const entrada = body && typeof body === "object" ? body : {};
    const acao = textoSeguro(entrada.acao, 40);
    const permitido = ACTION_FIELDS[acao] || [];
    const saida = { acao };
    for (const campo of permitido) {
      if (entrada[campo] === undefined) continue;
      if (campo === "pedido_id" || campo === "comercio_id") {
        const valor = textoSeguro(entrada[campo], 180);
        if (valor) saida[campo] = valor;
      } else if (campo === "offset") {
        const valor = Number(entrada[campo]);
        saida[campo] = Number.isInteger(valor) && valor >= 0 ? Math.min(valor, 10000) : 0;
      } else if (campo === "disponivel" || campo === "recebimento_confirmado") {
        saida[campo] = entrada[campo] === true;
      } else if (campo === "codigo_entrega") {
        saida[campo] = textoSeguro(entrada[campo], 6);
      } else if (campo === "chave_pix") {
        saida[campo] = textoSeguro(entrada[campo], 120);
      } else {
        saida[campo] = textoSeguro(entrada[campo], campo === "motivo" ? 500 : 80);
      }
    }
    return saida;
  }

  async function chamarApi(body, generation = state.generation, userId = state.userId, endpoint = API_URL) {
    const cliente = obterCliente();
    if (!cliente) throw new Error("O serviço de login não está disponível. Atualize a página e tente novamente.");
    const { data, error } = await cliente.auth.getSession();
    if (error) throw new Error("Não foi possível verificar sua sessão.");
    const token = data?.session?.access_token;
    if (!token) throw new Error("Sua sessão expirou. Entre novamente.");
    validarSessaoAtual(generation, userId);
    if (data?.session?.user?.id !== userId) throw new Error(STALE_REQUEST);

    const resposta = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(prepararBody(body)),
    });
    const resultado = await resposta.json().catch(() => ({}));
    validarSessaoAtual(generation, userId);
    if (!resposta.ok || (resultado?.success !== true && resultado?.ok !== true)) {
      const failure = new Error(resultado?.mensagem || "A operação não foi autorizada.");
      failure.status = resposta.status;
      failure.code = resultado?.codigo || "";
      throw failure;
    }
    return resultado;
  }

  function limparPedidos() {
    state.pedidos = [];
    state.offset = 0;
    state.hasMore = false;
    const lista = $("motoboyOrders");
    if (lista) {
      lista.innerHTML = "";
      lista.setAttribute("aria-busy", "false");
    }
    if ($("motoboyEmpty")) $("motoboyEmpty").hidden = true;
    if ($("motoboyLoadMore")) $("motoboyLoadMore").hidden = true;
  }

  function limparExtrato() {
    state.extrato = null;
    state.carteira = null;
    if ($("motoboyAsaasBalance")) $("motoboyAsaasBalance").textContent = "R$ 0,00";
    if ($("motoboyWithdrawPix")) $("motoboyWithdrawPix").disabled = true;
    if ($("motoboyWithdrawHistory")) $("motoboyWithdrawHistory").innerHTML = "";
    state.availability = false;
    const extrato = $("motoboyEarnings");
    if (extrato) extrato.hidden = true;
    const perfil = $("motoboyProfileForm");
    if (perfil) perfil.reset();
  }

  function limparDadosPrivados() {
    limparPedidos();
    limparExtrato();
    state.actionInFlight.clear();
  }

  function renderizarPedidos() {
    const lista = $("motoboyOrders");
    if (!lista) return;
    const pedidos = state.pedidos;
    if (!pedidos.length) {
      if ($("motoboyEmpty")) $("motoboyEmpty").hidden = false;
      lista.innerHTML = "";
    } else {
      if ($("motoboyEmpty")) $("motoboyEmpty").hidden = true;
      lista.innerHTML = pedidos.map(renderizarPedido).join("");
    }
    if ($("motoboyLoadMore")) $("motoboyLoadMore").hidden = !state.hasMore || !pedidos.length;
  }

  function renderizarAcao(pedido, acao, label, classe = "motoboy-button-primary") {
    const id = String(pedido?.pedido_id || "");
    const chave = `${acao}:${id}`;
    const ocupado = state.actionInFlight.has(chave);
    return `<button class="motoboy-button ${classe}" type="button" data-entrega-action="${escapar(acao)}" data-pedido-id="${escapar(id)}" ${ocupado ? "disabled aria-busy=\"true\"" : ""}>${escapar(ocupado ? "Processando…" : label)}</button>`;
  }

  function renderizarPedido(pedido) {
    const id = String(pedido?.pedido_id || "");
    const comercioId = String(pedido?.comercio_id || "");
    const comercio = state.commerceNames.get(comercioId) || pedido?.comercio_nome || comercioId || "Comércio autorizado";
    const status = statusEntrega(pedido);
    const oferta = pedidoEhOferta(pedido);
    const responsavel = pedidoPertenceAoMotoboy(pedido);
    const podeVerDados = !oferta && responsavel && Boolean(pedido?.cliente_endereco || pedido?.cliente_nome || pedido?.itens);
    const itens = podeVerDados && Array.isArray(pedido?.itens) ? pedido.itens : [];
    const itensHtml = itens.length
      ? `<ul class="motoboy-items" aria-label="Itens seguros do pedido">${itens.map((item) => `<li>${escapar(item?.quantidade)} × ${escapar(item?.nome_produto || item?.nome)}</li>`).join("")}</ul>`
      : "";
    const telefone = podeVerDados ? telefoneSeguro(pedido?.cliente_telefone) : "";
    const rota = podeVerDados ? rotaSegura(pedido) : "";
    const contato = telefone ? `<a href="${escapar(telefone)}">Ligar para o cliente</a>` : "Telefone não informado";
    const navegacao = rota ? `<a href="${escapar(rota)}" target="_blank" rel="noopener noreferrer">Abrir rota segura</a>` : "Rota disponível após aceite";
    const orientacao = oferta
      ? "Oferta para motoboys autorizados e disponíveis. O primeiro aceite válido reserva o pedido."
      : status === "reservado" || status === "pronto"
        ? "Confirme a coleta somente quando estiver com o pedido em mãos."
        : status === "coletado"
          ? "Pedido coletado. Marque em entrega quando iniciar o trajeto."
          : status === "em_entrega"
            ? "Ao chegar, peça o código de seis números ao cliente."
            : status === "entregue"
              ? "Entrega confirmada pelo servidor."
              : "Acompanhe a próxima etapa pelo servidor.";
    const forma = !oferta && pedido?.forma_pagamento ? formaPagamento(pedido) : "Pagamento conforme dados liberados após aceite";
    const detalhes = podeVerDados
      ? `<div class="motoboy-detail-line"><strong>Cliente</strong><span>${escapar(pedido?.cliente_nome || "Cliente")}</span></div>
         <div class="motoboy-detail-line"><strong>Endereço</strong><span>${escapar(enderecoPedido(pedido) || "Endereço não informado")}</span><span>${navegacao}</span></div>
         <div class="motoboy-detail-line"><strong>Contato</strong><span>${contato}</span></div>`
      : `<div class="motoboy-safe-offer"><strong>Oferta sem dados pessoais</strong><span>Endereço, telefone, observações e itens aparecem somente depois do aceite autorizado.</span></div>`;
    const pagamento = !oferta && pedido?.status_pagamento
      ? `${forma} · ${escapar(String(pedido.status_pagamento) === "aprovado" ? "status confirmado pelo servidor" : "status acompanhado pelo servidor")}`
      : forma;
    const taxa = Number.isFinite(Number(pedido?.taxa_motoboy_centavos))
      ? `<div class="motoboy-detail-line"><strong>Remuneração indicada</strong><span>${formatarMoeda(pedido.taxa_motoboy_centavos)} conforme extrato do servidor</span></div>`
      : "";
    let acoes = "";
    if (oferta) {
      acoes += renderizarAcao(pedido, "aceitar_entrega", "Aceitar oferta");
    } else if (["reservado", "pronto"].includes(status)) {
      acoes += renderizarAcao(pedido, "coletar", "Confirmar coleta");
      acoes += renderizarAcao(pedido, "desistir_entrega", "Desistir antes da coleta", "motoboy-button-danger");
    } else if (status === "coletado") {
      acoes += renderizarAcao(pedido, "em_entrega", "Iniciar entrega");
      acoes += renderizarAcao(pedido, "registrar_ocorrencia", "Relatar ocorrência", "motoboy-button-secondary");
    } else if (status === "em_entrega") {
      acoes += renderizarAcao(pedido, "confirmar_entrega", "Informar código de entrega");
      acoes += renderizarAcao(pedido, "registrar_ocorrencia", "Relatar ocorrência", "motoboy-button-secondary");
    } else if (["cancelamento_solicitado", "cancelado", "entregue"].includes(status)) {
      acoes = `<span class="motoboy-action-note">Nenhuma ação adicional disponível nesta etapa.</span>`;
    }
    return `<article class="motoboy-delivery-card ${oferta ? "is-offer" : ""}" data-pedido-id="${escapar(id)}">
      <div class="motoboy-delivery-header">
        <div><span class="eyebrow">${oferta ? "OFERTA AUTORIZADA" : "MINHA ENTREGA"}</span><h3>${escapar(comercio)}</h3>
          <p class="motoboy-order-total">Pedido ${escapar(id)} · ${formatarMoeda(pedido?.total_centavos)}${pedido?.criado_em ? ` · ${escapar(formatarData(pedido.criado_em))}` : ""}</p></div>
        <span class="motoboy-status ${statusClass(status)}">${escapar(statusLabel(status))}</span>
      </div>
      <div class="motoboy-delivery-details">
        <div class="motoboy-detail-line"><strong>Pagamento</strong><span>${pagamento}</span></div>
        ${taxa}${detalhes}
      </div>
      ${itensHtml}
      ${podeVerDados && pedido?.observacoes ? `<p class="motoboy-order-guidance"><strong>Orientações do comércio:</strong> ${escapar(pedido.observacoes)}</p>` : ""}
      <p class="motoboy-order-guidance">${escapar(orientacao)}</p>
      <div class="motoboy-delivery-actions">${acoes}</div>
    </article>`;
  }

  async function carregarEntregas({ append = false } = {}) {
    if (!state.session || state.loading || !navigator.onLine) {
      if (!navigator.onLine) definirFeedback("motoboyOrdersFeedback", "Você está offline. Use Atualizar quando a conexão voltar.", true);
      return;
    }
    const generation = state.generation;
    const userId = state.userId;
    const offset = append ? Math.min(10000, Math.max(0, Math.floor(Number(state.offset) || 0))) : 0;
    state.loading = true;
    $("motoboyOrders")?.setAttribute("aria-busy", "true");
    if (!append) {
      if ($("motoboyEmpty")) $("motoboyEmpty").hidden = true;
      if ($("motoboyOrders")) $("motoboyOrders").innerHTML = '<p class="motoboy-feedback">Atualizando entregas…</p>';
    }
    definirFeedback("motoboyOrdersFeedback", "");
    try {
      const resultado = await chamarApi({ acao: "listar_entregas", offset }, generation, userId);
      validarSessaoAtual(generation, userId);
      const pedidos = Array.isArray(resultado?.pedidos) ? resultado.pedidos : [];
      state.pedidos = append ? state.pedidos.concat(pedidos) : pedidos;
      state.offset = state.pedidos.length;
      state.hasMore = resultado?.has_more === true;
      renderizarPedidos();
      definirAviso("Entregas atualizadas", "Ofertas e entregas mostram somente o que a conta está autorizada a receber.", "sucesso");
    } catch (erro) {
      if (erro.message === STALE_REQUEST) return;
      if (erro.status === 403 || erro.status === 401) { limparDadosPrivados(); fecharConfirmacao(); }
      if (!append && $("motoboyOrders")) $("motoboyOrders").innerHTML = "";
      definirFeedback("motoboyOrdersFeedback", erro.message || "Não foi possível carregar suas entregas.", true);
      definirAviso("Não foi possível atualizar", erro.message || "Verifique sua sessão e tente novamente.", "erro");
    } finally {
      if (generation === state.generation) {
        state.loading = false;
        $("motoboyOrders")?.setAttribute("aria-busy", "false");
      }
    }
  }

  function renderizarCarteira() {
    const carteira = state.carteira || {};
    const saldo = Number(carteira.saldo_disponivel_centavos || 0);
    const minimo = Number(carteira.saque_minimo_centavos || 10000);
    const teto = Number(carteira.saque_maximo_por_pix_centavos || 500000);
    const saldoValido = Number.isSafeInteger(saldo) && saldo >= minimo;
    const creditoContagem=Number(carteira.total_comissoes_disponiveis || 0);
    if ($("motoboyWithdrawMinimo")) $("motoboyWithdrawMinimo").textContent =
      `Mínimo: ${formatarMoeda(minimo)}. Teto de segurança por Pix: ${formatarMoeda(teto)}. Saldo excedente permanece na carteira, sem prazo de expiração operacional.`;
    if ($("motoboyCreditoContagem")) $("motoboyCreditoContagem").textContent =
      `${creditoContagem.toLocaleString("pt-BR")} comissões liberadas acumuladas, sem limite de quantidade por saque.`;
    if ($("motoboyAsaasBalance")) $("motoboyAsaasBalance").textContent = formatarMoeda(saldo);
    const botao = $("motoboyWithdrawPix");
    if (botao) {
      botao.disabled = !state.session || state.withdrawalLoading || !carteira.saque_habilitado || !saldoValido;
      botao.textContent = saldo>teto ? `Sacar até ${formatarMoeda(teto)} via Pix`
        : `Sacar ${formatarMoeda(saldo)} via Pix`;
    }
    const historico = $("motoboyWithdrawHistory");
    if (historico) {
      historico.innerHTML = Array.isArray(carteira.saques) ? carteira.saques.map((saque) => {
        const status = { reservado: "Em análise", enviado: "Pix solicitado", concluido: "Pix confirmado", falhou: "Falha confirmada", revisao: "Revisão financeira" }[saque.status] || "Em revisão";
        return `<li><strong>${escapar(status)}</strong><span>${escapar(formatarData(saque.criado_em))}</span><b>${formatarMoeda(saque.valor_centavos)}</b></li>`;
      }).join("") : "";
    }
    const pendencias = Array.isArray(carteira.pendencias_por_comercio) ? carteira.pendencias_por_comercio : [];
    const lista = $("motoboyPendingByStore");
    if (lista) lista.innerHTML = pendencias.length ? pendencias.map(item => {
      const nome = state.commerceNames?.get(String(item.comercio_id)) || String(item.comercio_id || "Comércio");
      const situacao = ({fatura_vencida:"Fatura vencida",aguardando_pagamento:"Aguardando pagamento da fatura",pagamento_em_conferencia:"Pagamento em conferência",aguardando_fechamento:"Aguardando fechamento mensal"})[item.situacao] || "Em análise";
      return `<li><strong>${escapar(nome)}</strong><span>${escapar(situacao)} · ${escapar(String(item.competencia||""))}</span><b>${escapar(formatarMoeda(item.valor_centavos))}</b></li>`;
    }).join("") : "<li>Nenhuma comissão de fatura pendente identificada.</li>";
    const residualBloco=$("motoboyResidualBloco");
    const residual=carteira.saldo_residual || null;
    const residualAberto=residual && ["pendente","em_analise"].includes(residual.status);
    if(residualBloco)residualBloco.hidden=!(residualAberto || saldo>0 && saldo<minimo);
    const residualBtn=$("motoboyResidualSubmit");
    if(residualBtn)residualBtn.disabled=Boolean(residualAberto)||!state.termosAceitos;
    if(residualBloco)definirFeedback("motoboyResidualFeedback",
      residualAberto ? "Sua solicitação está aguardando análise. O saldo continua disponível e nenhum Pix foi criado."
      : residual?.status==="concluida" ? "A solicitação anterior foi concluída. Consulte o suporte para conferir os documentos."
      : residual?.status==="recusada" ? "A solicitação anterior foi recusada. Entre em contato com o suporte para esclarecer."
      : "Peça análise somente se for interromper suas atividades. Esta ação não realiza transferência.");
    const saida=carteira.regularizacao_saida||null;
    const saidaAberta=saida&&["pendente","em_analise"].includes(saida.status);
    const saidaBloco=$("motoboySaidaBloco");
    if(saidaBloco)saidaBloco.hidden=!(saidaAberta||
      carteira.entregador_ativo===false&&saldo>=minimo);
    const saidaBtn=$("motoboySaidaSubmit");
    if(saidaBtn)saidaBtn.disabled=Boolean(saidaAberta)||!state.termosAceitos;
    if(saidaBloco)definirFeedback("motoboySaidaFeedback",
      saidaAberta ? "Sua regularização está aguardando conferência administrativa. Nenhum pagamento foi iniciado."
      : saida?.status==="recusada" ? "Seu pedido anterior de regularização foi recusado. Seus créditos não foram eliminados; solicite esclarecimento à administração."
      : "Solicitação de conferência sem transferência, movimentação de créditos ou garantia de pagamento.");
    const situacaoSaque=carteira.entregador_ativo===false
      ? saldo>0
        ? "Seu perfil de entregador está inativo. Seu saldo permanece registrado, mas o saque comum está suspenso até regularização administrativa."
        : "Seu perfil de entregador está inativo. Consulte o histórico para acompanhar eventuais créditos."
      : carteira.saque_habilitado
        ? saldoValido
          ? "Você pode solicitar o Pix diretamente pelo Guia Andrelândia."
          : `Faltam ${formatarMoeda(Math.max(0,minimo-saldo))} em créditos liberados para alcançar o saque mínimo.`
        : "O saque automático ainda não foi habilitado pela plataforma.";
    definirFeedback("motoboyWithdrawFeedback", situacaoSaque);
  }

  async function solicitarAnaliseSaldoResidual(event) {
    event.preventDefault();
    if(!state.session || !state.termosAceitos)return;
    const generation=state.generation,uid=state.userId;
    const btn=$("motoboyResidualSubmit");
    if(btn)btn.disabled=true;
    definirFeedback("motoboyResidualFeedback","Registrando pedido de análise…");
    try{
      const resposta=await chamarApi({acao:"solicitar_analise_residual",
        motivo:$("motoboyResidualMotivo")?.value||""},generation,uid,ASAAS_URL);
      validarSessaoAtual(generation,uid);
      definirFeedback("motoboyResidualFeedback",resposta.mensagem||"Solicitação recebida.");
      await carregarCarteira();
    }catch(erro){
      if(erro.message!==STALE_REQUEST)
        definirFeedback("motoboyResidualFeedback",erro.message||"Não foi possível registrar análise.",true);
    }finally{
      if(generation===state.generation&&btn)btn.disabled=Boolean(state.carteira?.saldo_residual && ["pendente","em_analise"].includes(state.carteira.saldo_residual.status));
    }
  }
  async function solicitarRegularizacaoSaida(event) {
    event.preventDefault();
    if(!state.session||!state.termosAceitos||state.carteira?.entregador_ativo!==false)return;
    const generation=state.generation,uid=state.userId;
    const btn=$("motoboySaidaSubmit");
    if(btn)btn.disabled=true;
    definirFeedback("motoboySaidaFeedback","Enviando solicitação para conferência…");
    try{
      const resposta=await chamarApi({acao:"solicitar_regularizacao_saida",
        motivo:$("motoboySaidaMotivo")?.value||""},generation,uid,ASAAS_URL);
      validarSessaoAtual(generation,uid);
      definirFeedback("motoboySaidaFeedback",resposta.mensagem||"Pedido registrado.");
      await carregarCarteira();
    }catch(erro){
      if(erro.message!==STALE_REQUEST)
        definirFeedback("motoboySaidaFeedback",erro.message||"Não foi possível registrar o pedido.",true);
    }finally{
      if(generation===state.generation&&btn)
        btn.disabled=Boolean(state.carteira?.regularizacao_saida&&
          ["pendente","em_analise"].includes(state.carteira.regularizacao_saida.status));
    }
  }

  async function carregarCarteira() {
    if (!state.session || !navigator.onLine || state.withdrawalLoading) return;
    const generation = state.generation;
    const userId = state.userId;
    try {
      const result = await chamarApi({ acao: "consultar_carteira" }, generation, userId, ASAAS_URL);
      validarSessaoAtual(generation, userId);
      state.carteira = result;
      renderizarCarteira();
    } catch (error) {
      if (error.message === STALE_REQUEST) return;
      state.carteira = null;
      if ($("motoboyWithdrawPix")) $("motoboyWithdrawPix").disabled = true;
      if ($("motoboyResidualSubmit")) $("motoboyResidualSubmit").disabled = true;
      if ($("motoboySaidaSubmit")) $("motoboySaidaSubmit").disabled = true;
      if ($("motoboyResidualBloco")) $("motoboyResidualBloco").hidden = true;
      if ($("motoboySaidaBloco")) $("motoboySaidaBloco").hidden = true;
      if ($("motoboyAsaasBalance")) $("motoboyAsaasBalance").textContent = "Indisponível";
      definirFeedback("motoboyWithdrawFeedback", error.message || "Não foi possível consultar o saldo. Isso não significa que seus créditos foram zerados.", true);
    }
  }

  async function solicitarSaque() {
    if (!state.session || state.withdrawalLoading || !state.carteira?.saque_habilitado ||
        Number(state.carteira?.saldo_disponivel_centavos || 0) < Number(state.carteira?.saque_minimo_centavos || 10000)) return;
    if (typeof window.confirm === "function" &&
        !window.confirm(`Confirmar solicitação de saque de até ${formatarMoeda(Math.min(
          Number(state.carteira.saldo_disponivel_centavos),
          Number(state.carteira.saque_maximo_por_pix_centavos||500000)
        ))} via Pix? O valor exato é reservado e validado pelo servidor; o restante continua na carteira.`)) return;
    const generation = state.generation, userId = state.userId;
    state.withdrawalLoading = true;
    if ($("motoboyWithdrawPix")) $("motoboyWithdrawPix").disabled = true;
    definirFeedback("motoboyWithdrawFeedback", "Solicitando transferência Pix ao provedor…");
    try {
      const result = await chamarApi({ acao: "solicitar_saque" }, generation, userId, ASAAS_URL);
      validarSessaoAtual(generation, userId);
      definirFeedback("motoboyWithdrawFeedback", result.mensagem || "Saque solicitado; acompanhe o status.");
      await carregarExtrato();
    } catch (error) {
      if (error.message !== STALE_REQUEST)
        definirFeedback("motoboyWithdrawFeedback", error.message || "Não foi possível confirmar o saque. Consulte o histórico antes de tentar novamente.", true);
    } finally {
      if (generation === state.generation) {
        state.withdrawalLoading = false;
        await carregarCarteira();
      }
    }
  }

  function renderizarExtrato() {
    const bloco = $("motoboyEarnings");
    if (!bloco || !state.extrato) return;
    const saldo = state.extrato.saldo || {};
    const confiabilidade = state.extrato.confiabilidade || {};
    const perfil = state.extrato.perfil || {};
    bloco.hidden = false;
    $("motoboyBalanceAReceber").textContent = formatarMoeda(saldo.a_receber_centavos);
    $("motoboyBalancePago").textContent = formatarMoeda(saldo.pago_centavos);
    $("motoboyBalanceRetido").textContent = formatarMoeda(saldo.retido_centavos);
    renderizarCarteira();
    const amostra = Number(confiabilidade.amostra);
    const indice = Number(confiabilidade.indice);
    const emFormacao = confiabilidade.situacao === "em_formacao" || !Number.isFinite(indice) || !Number.isFinite(amostra) || amostra <= 0;
    $("motoboyReliabilityValue").textContent = emFormacao ? "Em formação" : `${indice.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    $("motoboyReliabilityText").textContent = emFormacao
      ? "Ainda não há amostra suficiente para uma leitura de confiabilidade. Cancelamentos do cliente ou do comércio não são atribuídos automaticamente a você."
      : `Leitura baseada em ${amostra} registro(s) concluído(s) pela fonte do servidor. O histórico pode ser revisado pelo administrador.`;
    const disponibilidade = perfil.disponivel === true;
    state.availability = disponibilidade;
    const checkbox = $("motoboyAvailability");
    if (checkbox) { checkbox.checked = disponibilidade; checkbox.disabled = false; }
    const chave = $("motoboyPixKey");
    if (chave && typeof perfil.chave_pix === "string" && document.activeElement !== chave) chave.value = perfil.chave_pix;
    const concluidadas = Array.isArray(state.extrato.entregas_concluidas) ? state.extrato.entregas_concluidas : [];
    const pagamentos = Array.isArray(state.extrato.pagamentos) ? state.extrato.pagamentos : [];
    const historico = $("motoboyHistory");
    if (historico) {
      const rows = concluidadas.concat(pagamentos);
      historico.innerHTML = rows.length ? rows.slice(0, 100).map((item) => {
        const nome = item.comercio_nome || item.comercio_id || "Comércio autorizado";
        const valor = item.remuneracao_centavos ?? item.valor_centavos ?? item.taxa_motoboy_centavos;
        const status = item.status_pagamento || item.status || "Registrado no servidor";
        return `<li><strong>${escapar(nome)}</strong><span>Pedido ${escapar(item.pedido_id || "não informado")} · ${escapar(status)}</span><b>${formatarMoeda(valor)}</b><small>${escapar(formatarData(item.pago_em || item.criado_em || item.entregue_em))}</small></li>`;
      }).join("") : '<li class="motoboy-history-empty">Ainda não há lançamentos no extrato do servidor.</li>';
    }
  }

  async function carregarExtrato() {
    if (!state.session || state.extractLoading || !navigator.onLine) return;
    const generation = state.generation;
    const userId = state.userId;
    state.extractLoading = true;
    definirFeedback("motoboyEarningsFeedback", "Consultando saldo e histórico na fonte do servidor…");
    try {
      const resultado = await chamarApi({ acao: "consultar_extrato", offset: 0 }, generation, userId);
      validarSessaoAtual(generation, userId);
      state.extrato = resultado;
      renderizarExtrato();
      definirFeedback("motoboyEarningsFeedback", "Extrato atualizado pela fonte do servidor.");
    } catch (erro) {
      if (erro.message === STALE_REQUEST) return;
      if (erro.status === 401 || erro.status === 403) limparDadosPrivados();
      definirFeedback("motoboyEarningsFeedback", erro.message || "Não foi possível consultar o extrato.", true);
    } finally {
      if (generation === state.generation) state.extractLoading = false;
    }
  }

  function fecharConfirmacao() {
    const dialog = $("motoboyConfirmDialog");
    if (dialog?.open) dialog.close();
    $("motoboyConfirmForm")?.reset();
    definirFeedback("motoboyConfirmFeedback", "");
  }

  function pedidoPorId(pedidoId) {
    return state.pedidos.find((pedido) => String(pedido?.pedido_id) === String(pedidoId)) || null;
  }

  function atualizarModoPagamento(pedido) {
    const pix = pagamentoPix(pedido);
    const checkbox = $("motoboyConfirmReceived");
    const label = $("motoboyConfirmReceivedText");
    const info = $("motoboyConfirmPaymentInfo");
    if (checkbox) { checkbox.checked = pix; checkbox.disabled = pix; }
    if (label) label.textContent = pix ? "Pagamento Pix já consta como confirmado pelo servidor" : "Produto entregue e pagamento presencial recebido";
    if (info) info.textContent = pix ? "Pagamento Pix: a baixa financeira vem do servidor; confirme apenas o código de entrega." : "Pagamento presencial: confirme o recebimento somente depois de receber do cliente.";
  }

  function abrirConfirmacao(pedidoId) {
    if (!state.session) return;
    const pedido = pedidoPorId(pedidoId) || { pedido_id: pedidoId };
    $("motoboyConfirmForm")?.reset();
    $("motoboyConfirmOrderId").value = pedidoId || "";
    $("motoboyConfirmCommerceId").value = pedido?.comercio_id || "";
    atualizarModoPagamento(pedido);
    definirFeedback("motoboyConfirmFeedback", "");
    const dialog = $("motoboyConfirmDialog");
    if (!dialog) return;
    dialog.showModal();
    $("motoboyConfirmCode")?.focus();
  }

  async function confirmarEntrega(event) {
    event.preventDefault();
    const codigo = $("motoboyConfirmCode").value.trim();
    const pedidoId = $("motoboyConfirmOrderId").value;
    const comercioId = $("motoboyConfirmCommerceId").value;
    const pedido = pedidoPorId(pedidoId) || {};
    if (!/^\d{6}$/.test(codigo)) {
      definirFeedback("motoboyConfirmFeedback", "Informe exatamente seis números.", true);
      return;
    }
    const recebeu = pagamentoPix(pedido) || $("motoboyConfirmReceived").checked;
    if (!recebeu) {
      definirFeedback("motoboyConfirmFeedback", "Confirme o recebimento do pagamento presencial antes de concluir.", true);
      return;
    }
    const botao = $("motoboySendConfirm");
    const generation = state.generation;
    const userId = state.userId;
    botao.disabled = true;
    definirFeedback("motoboyConfirmFeedback", "Validando código no servidor…");
    try {
      const resultado = await chamarApi({
        acao: "confirmar_entrega",
        pedido_id: pedidoId,
        comercio_id: comercioId,
        codigo_entrega: codigo,
        recebimento_confirmado: true,
      }, generation, userId);
      validarSessaoAtual(generation, userId);
      const status = resultado?.pedido?.status || resultado?.status;
      if (status && status !== "entregue") throw new Error("A API não confirmou a entrega.");
      state.pedidos = state.pedidos.filter((item) => String(item?.pedido_id) !== String(pedidoId));
      state.offset = state.pedidos.length;
      renderizarPedidos();
      fecharConfirmacao();
      definirFeedback("motoboyOrdersFeedback", "Entrega confirmada. A remuneração aparecerá no extrato após a baixa financeira válida.");
      definirAviso("Entrega registrada", "O código foi validado pelo servidor e a entrega saiu da lista ativa.", "sucesso");
      carregarExtrato();
    } catch (erro) {
      if (erro.message === STALE_REQUEST) return;
      if (erro.status === 401 || (erro.status === 403 && erro.code !== "codigo_incorreto" && erro.message !== "Código de entrega incorreto.")) {
        limparDadosPrivados(); fecharConfirmacao();
        definirFeedback("motoboyOrdersFeedback", erro.message || "A autorização desta entrega mudou.", true);
        definirAviso("Acesso à entrega atualizado", "Atualize a lista antes de continuar.", "erro");
        return;
      }
      definirFeedback("motoboyConfirmFeedback", erro.message || "Não foi possível confirmar a entrega.", true);
    } finally {
      if (generation === state.generation && botao) botao.disabled = false;
    }
  }

  function abrirOcorrencia(pedidoId) {
    if (!state.session) return;
    $("motoboyOccurrenceForm")?.reset();
    $("motoboyOccurrenceOrderId").value = pedidoId || "";
    definirFeedback("motoboyOccurrenceFeedback", "");
    const dialog = $("motoboyOccurrenceDialog");
    if (dialog) dialog.showModal();
  }

  async function registrarOcorrencia(event) {
    event.preventDefault();
    const pedidoId = $("motoboyOccurrenceOrderId").value;
    const categoria = $("motoboyOccurrenceCategory").value;
    const motivo = textoSeguro($("motoboyOccurrenceReason").value, 500);
    if (!Object.prototype.hasOwnProperty.call(OCCURRENCE_CATEGORIES, categoria)) {
      definirFeedback("motoboyOccurrenceFeedback", "Escolha uma categoria.", true);
      return;
    }
    if (motivo.length < 3) {
      definirFeedback("motoboyOccurrenceFeedback", "Explique o ocorrido em poucas palavras.", true);
      return;
    }
    const generation = state.generation;
    const chave = `registrar_ocorrencia:${pedidoId}`;
    if (state.actionInFlight.has(chave)) return;
    state.actionInFlight.add(chave);
    renderizarPedidos();
    const botao = $("motoboyOccurrenceSubmit");
    if (botao) botao.disabled = true;
    try {
      await chamarApi({ acao: "registrar_ocorrencia", pedido_id: pedidoId, categoria, motivo }, generation, state.userId);
      validarSessaoAtual(generation, state.userId);
      $("motoboyOccurrenceDialog")?.close();
      definirAviso("Ocorrência registrada", "O comércio e a operação poderão analisar o relato. Nenhuma entrega foi concluída ou cancelada automaticamente.", "sucesso");
      await carregarEntregas();
    } catch (erro) {
      if (erro.message !== STALE_REQUEST) definirFeedback("motoboyOccurrenceFeedback", erro.message || "Não foi possível registrar a ocorrência.", true);
    } finally {
      state.actionInFlight.delete(chave);
      if (generation === state.generation && botao) botao.disabled = false;
      renderizarPedidos();
    }
  }

  async function executarAcao(pedidoId, acao) {
    const pedido = pedidoPorId(pedidoId);
    if (!pedido || !state.session) return;
    if (acao === "confirmar_entrega") { abrirConfirmacao(pedidoId); return; }
    if (acao === "registrar_ocorrencia") { abrirOcorrencia(pedidoId); return; }
    if (acao === "desistir_entrega" && typeof window.confirm === "function" && !window.confirm("Desistir antes da coleta? O pedido será reofertado pelo servidor.")) return;
    const chave = `${acao}:${pedidoId}`;
    if (state.actionInFlight.has(chave)) return;
    state.actionInFlight.add(chave);
    renderizarPedidos();
    const generation = state.generation;
    try {
      await chamarApi({ acao, pedido_id: pedidoId, motivo: acao === "desistir_entrega" ? "desistencia_antes_coleta" : undefined }, generation, state.userId);
      validarSessaoAtual(generation, state.userId);
      const texto = acao === "aceitar_entrega" ? "Oferta aceita. A reserva concorrente foi decidida pelo servidor." : acao === "coletar" ? "Coleta registrada. Só avance quando estiver com o pedido." : acao === "em_entrega" ? "Entrega iniciada." : "Desistência registrada; a oferta poderá ser reaberta pelo servidor.";
      definirFeedback("motoboyOrdersFeedback", texto);
      await carregarEntregas();
    } catch (erro) {
      if (erro.message !== STALE_REQUEST) {
        definirFeedback("motoboyOrdersFeedback", erro.message || "Não foi possível executar esta ação.", true);
        if (erro.status === 401 || erro.status === 403) limparDadosPrivados();
      }
    } finally {
      state.actionInFlight.delete(chave);
      renderizarPedidos();
    }
  }

  async function definirDisponibilidade(event) {
    const checkbox = event.currentTarget || $("motoboyAvailability");
    if (!state.session || state.availabilityLoading) return;
    const anterior = state.availability;
    const disponivel = Boolean(checkbox?.checked);
    state.availabilityLoading = true;
    if (checkbox) checkbox.disabled = true;
    definirFeedback("motoboyAvailabilityFeedback", "Salvando disponibilidade…");
    const generation = state.generation;
    try {
      await chamarApi({ acao: "definir_disponibilidade", disponivel }, generation, state.userId);
      validarSessaoAtual(generation, state.userId);
      state.availability = disponivel;
      definirFeedback("motoboyAvailabilityFeedback", disponivel ? "Você está disponível para novas ofertas." : "Você não receberá novas ofertas enquanto estiver indisponível.");
    } catch (erro) {
      if (erro.message !== STALE_REQUEST) {
        state.availability = anterior;
        if (checkbox) checkbox.checked = anterior;
        definirFeedback("motoboyAvailabilityFeedback", erro.message || "Não foi possível salvar a disponibilidade.", true);
      }
    } finally {
      if (generation === state.generation) {
        state.availabilityLoading = false;
        if (checkbox) checkbox.disabled = false;
      }
    }
  }

  async function salvarChavePix(event) {
    event.preventDefault();
    const campo = $("motoboyPixKey");
    const chavePix = textoSeguro(campo?.value, 120);
    if (chavePix && chavePix.length < 3) {
      definirFeedback("motoboyPixFeedback", "Informe uma chave Pix válida ou deixe o campo vazio.", true);
      return;
    }
    const botao = $("motoboyPixButton");
    const generation = state.generation;
    if (botao) botao.disabled = true;
    definirFeedback("motoboyPixFeedback", "Salvando sua chave Pix…");
    try {
      const resultado = await chamarApi({ acao: "salvar_chave_pix", chave_pix: chavePix }, generation, state.userId);
      validarSessaoAtual(generation, state.userId);
      const perfil = resultado?.perfil || {};
      if (campo && typeof perfil.chave_pix === "string") campo.value = perfil.chave_pix;
      definirFeedback("motoboyPixFeedback", chavePix ? "Chave Pix própria salva. Ela será utilizada quando você solicitar um saque habilitado." : "Chave Pix removida do seu perfil.");
      carregarCarteira();
    } catch (erro) {
      if (erro.message !== STALE_REQUEST) definirFeedback("motoboyPixFeedback", erro.message || "Não foi possível salvar a chave Pix.", true);
    } finally {
      if (generation === state.generation && botao) botao.disabled = false;
    }
  }

  function pararPolling() {
    if (state.timer) window.clearInterval(state.timer);
    state.timer = null;
  }

  function iniciarPolling() {
    pararPolling();
    if (!state.session || state.destroyed) return;
    state.timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine && !$("motoboyConfirmDialog")?.open && !$("motoboyOccurrenceDialog")?.open) {
        carregarEntregas();
        carregarExtrato();
      }
    }, 30000);
  }

  function limparSessaoVisual() {
    state.generation += 1;
    state.session = null;
    state.termosAceitos = false;
    state.sessionToken = "";
    state.userId = "";
    state.loading = false;
    state.extractLoading = false;
    pararPolling();
    limparDadosPrivados();
    fecharConfirmacao();
    $("motoboyOccurrenceDialog")?.close();
    $("motoboyTermsDialog")?.close();
    if ($("motoboyLoginCard")) $("motoboyLoginCard").hidden = false;
    if ($("motoboyPanel")) $("motoboyPanel").hidden = true;
    if ($("motoboyLogout")) $("motoboyLogout").hidden = true;
    definirAviso("Entre para consultar ofertas e entregas.", "A autorização é feita por cada comércio, sem compartilhar senhas.");
  }

  async function aplicarSessao(session) {
    if (state.destroyed || (state.lockedAfterLogout && session)) return;
    const user = session?.user || null;
    const userId = user?.id || "";
    const token = session?.access_token || "";
    if (state.session && userId === state.userId && token === state.sessionToken) return;
    if (!user) {
      limparSessaoVisual();
      return;
    }
    state.generation += 1;
    state.session = session;
    state.termosAceitos = false;
    state.sessionToken = token;
    state.userId = userId;
    state.loading = false;
    state.extractLoading = false;
    limparDadosPrivados();
    fecharConfirmacao();
    if ($("motoboyLoginCard")) $("motoboyLoginCard").hidden = true;
    if ($("motoboyPanel")) $("motoboyPanel").hidden = false;
    if ($("motoboyLogout")) $("motoboyLogout").hidden = false;
    definirFeedback("motoboyLoginFeedback", "");
    definirAviso("Sessão autenticada", "Verificando a ciência dos termos vigentes…");
    try {
      const termos = await chamarApi({acao:"consultar_termos",papel:"motoboy"},state.generation,state.userId,ASAAS_URL);
      validarSessaoAtual(state.generation,state.userId);
      if (!termos.aceito) {
        $("motoboyPanel").hidden = true;
        if (!$("motoboyTermsDialog").open) $("motoboyTermsDialog").showModal();
        definirAviso("Termos obrigatórios", "Leia os termos para entregadores e a política de privacidade antes de utilizar o painel.");
        return;
      }
      state.termosAceitos = true;
    } catch (erro) {
      $("motoboyPanel").hidden = true;
      if ($("motoboyLoginCard")) $("motoboyLoginCard").hidden = false;
      definirFeedback("motoboyLoginFeedback", erro.message || "Não foi possível verificar os termos.", true);
      return;
    }
    iniciarPolling();
    await Promise.all([carregarEntregas(), carregarExtrato(), carregarCarteira()]);
  }

  async function fazerLogin(event) {
    event.preventDefault();
    const cliente = obterCliente();
    if (!cliente) { definirFeedback("motoboyLoginFeedback", "Não foi possível conectar ao serviço de login.", true); return; }
    const botao = $("motoboyLoginButton");
    botao.disabled = true;
    definirFeedback("motoboyLoginFeedback", "Entrando…");
    try {
      const email = $("motoboyLoginEmail").value.trim();
      const password = $("motoboyLoginPassword").value;
      const { data, error } = await cliente.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message || "E-mail ou senha incorretos.");
      if (!data?.session) throw new Error("A sessão não ficou disponível. Tente novamente.");
      state.lockedAfterLogout = false;
      $("motoboyLoginPassword").value = "";
      await aplicarSessao(data.session);
    } catch (erro) {
      definirFeedback("motoboyLoginFeedback", erro.message || "Não foi possível entrar.", true);
    } finally { botao.disabled = false; }
  }

  async function criarConta(event) {
    event.preventDefault();
    const cliente = obterCliente();
    if (!cliente) { definirFeedback("motoboySignupFeedback", "Não foi possível conectar ao serviço de login.", true); return; }
    const nome = $("motoboySignupName").value.trim();
    const email = $("motoboySignupEmail").value.trim();
    const password = $("motoboySignupPassword").value;
    if (!nome) { definirFeedback("motoboySignupFeedback", "Informe seu nome.", true); return; }
    if (password.length < 6) { definirFeedback("motoboySignupFeedback", "A senha precisa ter pelo menos 6 caracteres.", true); return; }
    const botao = $("motoboySignupButton");
    botao.disabled = true;
    definirFeedback("motoboySignupFeedback", "Criando sua conta…");
    try {
      const { data, error } = await cliente.auth.signUp({ email, password, options: { data: { nome } } });
      if (error) throw new Error(error.message || "Não foi possível criar sua conta.");
      if (data?.session) {
        state.lockedAfterLogout = false;
        $("motoboySignupPassword").value = "";
        await aplicarSessao(data.session);
      } else {
        definirFeedback("motoboySignupFeedback", "Conta criada. Confirme o e-mail e peça ao comércio para autorizar este e-mail.");
        $("motoboyLoginEmail").value = email;
        $("motoboySignupForm").reset();
      }
    } catch (erro) { definirFeedback("motoboySignupFeedback", erro.message || "Não foi possível criar sua conta.", true); }
    finally { botao.disabled = false; }
  }

  async function sair() {
    const cliente = obterCliente();
    if (!cliente) return;
    state.lockedAfterLogout = true;
    limparSessaoVisual();
    try {
      const { error } = await cliente.auth.signOut({ scope: "local" });
      if (error) throw error;
      definirFeedback("motoboyLoginFeedback", "Você saiu do painel.");
    } catch (erro) {
      limparSessaoVisual();
      definirFeedback("motoboyLoginFeedback", "Não foi possível encerrar a sessão remota. A tela foi bloqueada; entre novamente se precisar continuar.", true);
    }
  }

  async function aceitarTermosOperacionais(event) {
    event.preventDefault();
    if (!state.session || state.destroyed) return;
    const aceitar = $("motoboyTermsAccepted")?.checked === true;
    const privacidade = $("motoboyPrivacyAcknowledged")?.checked === true;
    if (!aceitar || !privacidade) return;
    const generation=state.generation,userId=state.userId;
    try {
      const resposta=await chamarApi({acao:"aceitar_termos",papel:"motoboy",aceito_termos:aceitar,
        ciente_privacidade:privacidade},generation,userId,ASAAS_URL);
      validarSessaoAtual(generation,userId);
      if (!resposta.aceito) throw new Error("O aceite não pôde ser confirmado.");
      state.termosAceitos = true;
      $("motoboyTermsDialog")?.close();
      $("motoboyPanel").hidden = false;
      iniciarPolling();
      await Promise.all([carregarEntregas(),carregarExtrato(),carregarCarteira()]);
    } catch (erro) {
      definirFeedback("motoboyTermsFeedback",erro.message || "Não foi possível registrar aceite.",true);
    }
  }

  function iniciarEventos() {
    $("motoboyTermsForm")?.addEventListener("submit",aceitarTermosOperacionais);
    $("motoboyTermsDialog")?.addEventListener("cancel",event => event.preventDefault());
    $("motoboyLoginForm")?.addEventListener("submit", fazerLogin);
    $("motoboySignupForm")?.addEventListener("submit", criarConta);
    $("motoboyLogout")?.addEventListener("click", sair);
    $("motoboyRefresh")?.addEventListener("click", () => { carregarEntregas(); carregarExtrato(); carregarCarteira(); });
    $("motoboyWithdrawPix")?.addEventListener("click", solicitarSaque);
    $("motoboyResidualForm")?.addEventListener("submit",solicitarAnaliseSaldoResidual);
    $("motoboySaidaForm")?.addEventListener("submit",solicitarRegularizacaoSaida);
    $("motoboyLoadMore")?.addEventListener("click", () => carregarEntregas({ append: true }));
    $("motoboyAvailability")?.addEventListener("change", definirDisponibilidade);
    $("motoboyPixForm")?.addEventListener("submit", salvarChavePix);
    $("motoboyCancelConfirm")?.addEventListener("click", fecharConfirmacao);
    $("motoboyConfirmForm")?.addEventListener("submit", confirmarEntrega);
    $("motoboyCancelOccurrence")?.addEventListener("click", () => $("motoboyOccurrenceDialog")?.close());
    $("motoboyOccurrenceForm")?.addEventListener("submit", registrarOcorrencia);
    $("motoboyOrders")?.addEventListener("click", (event) => {
      const botao = event.target.closest?.("[data-entrega-action]");
      if (!botao || botao.disabled) return;
      executarAcao(botao.dataset.pedidoId, botao.dataset.entregaAction);
    });
    $("motoboyConfirmDialog")?.addEventListener("click", (event) => { if (event.target === $("motoboyConfirmDialog")) fecharConfirmacao(); });
    $("motoboyConfirmDialog")?.addEventListener("close", () => { $("motoboyConfirmForm")?.reset(); definirFeedback("motoboyConfirmFeedback", ""); });
    $("motoboyOccurrenceDialog")?.addEventListener("click", (event) => { if (event.target === $("motoboyOccurrenceDialog")) $("motoboyOccurrenceDialog").close(); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") pararPolling();
      else if (state.session && state.termosAceitos) {
        iniciarPolling();
        if (!$('motoboyConfirmDialog')?.open && !$('motoboyOccurrenceDialog')?.open && navigator.onLine) {
          carregarEntregas();
          carregarExtrato();
        }
      }
    });
    window.addEventListener("online", () => {
      if (state.session && state.termosAceitos && document.visibilityState === "visible") { carregarEntregas(); carregarExtrato(); }
    });
    window.addEventListener("pagehide", () => {
      state.destroyed = true;
      state.generation += 1;
      state.session = null;
      state.userId = "";
      state.sessionToken = "";
      pararPolling();
      state.subscription?.unsubscribe?.();
      state.subscription = null;
      fecharConfirmacao();
      $("motoboyOccurrenceDialog")?.close();
      limparDadosPrivados();
    });
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) return;
      state.destroyed = false;
      restaurarAposVoltar();
    });
  }

  async function restaurarAposVoltar() {
    const cliente = obterCliente();
    if (!cliente) return;
    if (!state.subscription) {
      const listener = cliente.auth.onAuthStateChange((_evento, session) => {
        window.setTimeout(() => { aplicarSessao(session); }, 0);
      });
      state.subscription = listener?.data?.subscription || null;
    }
    const { data, error } = await cliente.auth.getSession();
    if (!error && !state.destroyed) await aplicarSessao(data?.session || null);
  }

  async function carregarNomesPublicos() {
    try {
      const response = await fetch("../DATA/comercios.json", { cache: "no-store" });
      if (!response.ok) return;
      const rows = await response.json();
      if (!Array.isArray(rows)) return;
      state.commerceNames = new Map(rows.filter((row) => row && row.id && row.nome).map((row) => [String(row.id), String(row.nome)]));
    } catch { /* O nome do comércio pode vir da resposta autorizada do servidor. */ }
  }

  async function iniciar() {
    iniciarEventos();
    carregarNomesPublicos().then(() => { if (!state.destroyed && state.session) renderizarPedidos(); });
    const cliente = obterCliente();
    if (!cliente) {
      definirAviso("Login indisponível", "Não foi possível carregar o serviço de autenticação.", "erro");
      return;
    }
    if (!state.subscription) {
      const listener = cliente.auth.onAuthStateChange((_evento, session) => {
        window.setTimeout(() => { aplicarSessao(session); }, 0);
      });
      state.subscription = listener?.data?.subscription || null;
    }
    const { data, error } = await cliente.auth.getSession();
    if (error) {
      definirAviso("Não foi possível verificar a sessão", "Entre novamente para consultar o painel.", "erro");
      return;
    }
    await aplicarSessao(data?.session || null);
  }

  document.addEventListener("DOMContentLoaded", iniciar, { once: true });
})();
