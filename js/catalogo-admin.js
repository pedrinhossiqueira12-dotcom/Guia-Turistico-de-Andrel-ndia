(function () {
  "use strict";

  const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  const BUCKET = "catalogos";
  const IMAGEM_PADRAO = "../img/sem-foto.png";
  const parametros = new URLSearchParams(window.location.search);
  const comercioId = (parametros.get("id") || parametros.get("comercio_id") || "").trim();
  const $ = (id) => document.getElementById(id);

  let supabaseClient = null;
  let categorias = [];
  let produtos = [];
  let comercio = null;
  let removendoCategoriaId = null;
  let carregando = false;
  const ENTREGA_API_URL = `${SUPABASE_URL}/functions/v1/catalogo-entregas`;
  const STALE_SESSION_REQUEST = "STALE_SESSION_REQUEST";
  const entregaState = { motoboys: [], generation: 0, userId: "", sessionToken: "", carregando: false };

  const modalidades = { entrega: "Entrega", retirada: "Retirada", consumo_local: "Consumo no local" };
  const pagamentos = {
    pix: "Pix online (QR Code e copia e cola)",
    dinheiro: "Dinheiro",
    cartao_credito: "Cartão de crédito",
    cartao_debito: "Cartão de débito",
    pagamento_entrega: "Pagamento na entrega",
    pagamento_local: "Pagamento no estabelecimento",
  };

  function getClient() {
    if (supabaseClient) return supabaseClient;
    supabaseClient = window.supabaseLoginClient || window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
    return supabaseClient;
  }

  function setNotice(titulo, texto, erro = false) {
    $("noticeTitle").textContent = titulo;
    $("noticeText").textContent = texto;
    $("adminNotice").classList.toggle("is-error", Boolean(erro));
    $("adminNotice").hidden = false;
  }

  function setFeedback(id, texto, erro = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = texto || "";
    el.style.color = erro ? "#a4332a" : "";
  }

  function escapar(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, (caractere) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    })[caractere]);
  }

  function linkPerfil() {
    const url = comercioId ? `local.html?id=${encodeURIComponent(comercioId)}` : "../index.html";
    $("linkPerfil").href = url;
    $("linkCriarConta").href = url;
    $("linkContratacao").href = `catalogo-venda.html?id=${encodeURIComponent(comercioId)}`;
  }

  async function validarProprietario() {
    const supabase = getClient();
    const { data, error } = await supabase.functions.invoke("catalogo-admin", {
      body: { acao: "verificar_proprietario", comercio_id: comercioId },
    });
    if (error) throw new Error(error.message || "Não foi possível validar o proprietário.");
    if (!data?.proprietario && !data?.admin) throw new Error(data?.mensagem || "Esta conta não está vinculada ao comércio.");
    return data;
  }

  async function carregarComercio() {
    const response = await fetch("../DATA/comercios.json", { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    return Array.isArray(data) ? data.find((item) => String(item.id) === comercioId) : null;
  }

  async function entrarPainel() {
    if (carregando) return;
    carregando = true;
    const supabase = getClient();
    try {
      const { data: { session } = {} } = await supabase.auth.getSession();
      if (!session) {
        entregaState.generation += 1; entregaState.userId = ""; entregaState.sessionToken = ""; entregaState.motoboys = [];
        $("loginCard").hidden = false;
        $("catalogoBloqueado").hidden = true;
        $("painelCatalogo").hidden = true;
        setNotice("Entre para continuar", "Somente o proprietário autenticado pode gerenciar o catálogo.");
        return;
      }

      entregaState.generation += 1;
      entregaState.userId = session.user?.id || "";
      entregaState.sessionToken = session.access_token || "";
      $("loginCard").hidden = true;
      $("logoutCatalogo").hidden = false;
      const resultado = await validarProprietario();
      comercio = await carregarComercio();
      $("nomeComercioAdmin").textContent = comercio?.nome || comercioId;

      if (!resultado.ativo && (!resultado.admin || resultado.proprietario)) {
        $("painelCatalogo").hidden = true;
        $("catalogoBloqueado").hidden = false;
        if (resultado.bloqueado) {
          $("lockedTitle").textContent = "Catálogo temporariamente bloqueado";
          $("lockedText").textContent = "O administrador do Guia bloqueou este catálogo. Entre em contato pelo perfil do comércio para obter orientação.";
          $("linkContratacao").hidden = true;
        } else {
          $("lockedTitle").textContent = "Catálogo não liberado";
          $("lockedText").textContent = "Conecte a conta Mercado Pago do comércio para liberar gratuitamente a gestão do catálogo.";
          $("linkContratacao").hidden = false;
        }
        setNotice("Acesso à gestão bloqueado", "A gestão e a vitrine são liberadas após a conexão ativa do Mercado Pago.");
        return;
      }

      $("catalogoBloqueado").hidden = true;
      $("painelCatalogo").hidden = false;
      setNotice(resultado.admin ? "Acesso administrativo confirmado" : "Acesso confirmado", resultado.admin
        ? "Você está corrigindo o catálogo como administrador do Guia."
        : "Você está gerenciando o catálogo deste comércio.");
      await carregarDadosPainel();
    } catch (erro) {
      console.error("Erro no painel de catálogo:", erro);
      $("loginCard").hidden = true;
      $("catalogoBloqueado").hidden = false;
      $("lockedTitle").textContent = "Não foi possível confirmar o acesso";
      $("lockedText").textContent = erro.message || "Tente novamente ou retorne ao perfil do comércio.";
      $("linkContratacao").hidden = true;
      setNotice("Acesso não confirmado", erro.message || "A verificação de proprietário falhou.", true);
    } finally {
      carregando = false;
    }
  }

  function montarCheckboxes(containerId, opcoes, valoresAtivos) {
    $(containerId).innerHTML = Object.entries(opcoes).map(([valor, nome]) => `
      <label class="check-card"><input type="checkbox" name="${containerId}" value="${escapar(valor)}" ${valoresAtivos.includes(valor) ? "checked" : ""}><span>${escapar(nome)}</span></label>
    `).join("");
  }

  function lerCheckboxes(containerId) {
    return Array.from($(containerId).querySelectorAll("input:checked")).map((input) => input.value);
  }

  function reais(centavos) {
    return window.CatalogoUtils.formatarMoeda(Number(centavos || 0) / 100);
  }

  function statusOffline(status) {
    return ({ aguardando_pagamento: "Aguardando confirmação", pago: "Pago, aguardando aceite", em_preparo: "Em preparo", pronto: "Pronto para entrega", entregue: "Concluído", cancelado: "Cancelado", cancelamento_solicitado: "Ocorrência solicitada", nao_atribuido: "Sem entregador", ofertado: "Ofertado à rede", reservado: "Reservado", coletado: "Coletado", em_entrega: "Em entrega" })[status] || status || "Em acompanhamento";
  }

  function statusPagamento(status) {
    return ({ aprovado: "Pagamento aprovado", pendente: "Pagamento pendente", processando: "Pagamento em processamento", recusado: "Pagamento recusado", cancelado: "Pagamento cancelado", estornado: "Pagamento estornado", contestado: "Pagamento contestado" })[status] || status || "Pagamento não informado";
  }

  function pedidoIdSeguro(pedido) { return String(pedido.id || pedido.pedido_id || ""); }

  function renderizarItensPedido(pedido) {
    const itens = Array.isArray(pedido.itens) ? pedido.itens.filter((item) => item && typeof item === "object") : [];
    if (!itens.length) return '<p class="order-items-missing">Detalhes dos itens indisponíveis neste pedido. Não prepare apenas pelo valor total.</p>';
    const linhas = itens.map((item) => {
      const quantidade = Number(item.quantidade);
      const quantidadeTexto = Number.isInteger(quantidade) && quantidade > 0 ? String(quantidade) : "Quantidade não informada";
      const preco = Number(item.preco_unitario_centavos);
      const total = Number(item.total_item_centavos);
      const precoTexto = item.preco_unitario_centavos != null && Number.isSafeInteger(preco) && preco >= 0 ? `${reais(preco)} cada` : "Preço não informado";
      const totalTexto = item.total_item_centavos != null && Number.isSafeInteger(total) && total >= 0 ? reais(total) : "Valor não informado";
      return `<li><div class="order-item-description"><strong>${escapar(quantidadeTexto)} × ${escapar(item.nome_produto || "Produto não identificado")}</strong>${item.descricao_produto ? `<small>${escapar(item.descricao_produto)}</small>` : ""}<small>${escapar(precoTexto)}</small></div><span class="order-item-total">${escapar(totalTexto)}</span></li>`;
    }).join("");
    return `<details class="order-items" open><summary>Itens do pedido</summary><ul>${linhas}</ul></details>`;
  }

  function renderizarObservacoesPedido(pedido) {
    if (pedido.dados_cliente_ocultos || Number(pedido.versao_financeira) === 2 && !pedido.aceito_em) return "";
    const observacoes = String(pedido.observacoes || "").trim();
    return observacoes ? `<p class="order-notes"><strong>Observações do comprador:</strong> ${escapar(observacoes)}</p>` : "";
  }

  function renderizarContatoCliente(pedido) {
    if (pedido.dados_cliente_ocultos || Number(pedido.versao_financeira) === 2 && !pedido.aceito_em) {
      return '<small class="customer-contact customer-contact-locked">Telefone e demais contatos disponíveis após aceitar o pedido.</small>';
    }
    const telefone = String(pedido.cliente_telefone || "").trim();
    if (!telefone) return '<small class="customer-contact">Telefone não informado.</small>';
    const digitos = telefone.replace(/\D/g, "");
    const ligar = /^\d{8,15}$/.test(digitos) ? `<a href="tel:+${digitos.length <= 11 ? "55" : ""}${digitos}">Ligar</a>` : "";
    let whatsapp = "";
    try {
      const link = window.CatalogoUtils.gerarLinkWhatsApp(telefone, "Olá! Somos do comércio e precisamos esclarecer uma informação sobre seu pedido.");
      whatsapp = `<a href="${escapar(link)}" target="_blank" rel="noopener noreferrer">WhatsApp do comprador</a>`;
    } catch { /* Mantém o número legível mesmo quando não for um WhatsApp válido. */ }
    return `<div class="customer-contact"><span><strong>Telefone do comprador:</strong> ${escapar(telefone)}</span><div class="customer-contact-actions">${ligar}${whatsapp}</div></div>`;
  }

  function renderizarEstadoEntregador(pedido) {
    if (pedido.modalidade !== "entrega") return "";
    const responsavelId = String(pedido.motoboy_id || "");
    const preferidoId = String(pedido.motoboy_preferido_id || "");
    const conhecido = entregaState.motoboys.find((item) => String(item.usuario_id) === (responsavelId || preferidoId));
    const nome = escapar(conhecido?.nome || "Motoboy autorizado");
    const fase = String(pedido.entrega_status || "");
    let titulo = "Nenhum motoboy atribuído";
    let detalhe = pedido.status === "pronto" ? "Oferta disponível na rede; aguardando um motoboy aceitar." : "Selecione um motoboy ou use a rede e marque o pedido como pronto.";
    let estado = "sem_responsavel";
    if (responsavelId) {
      titulo = `Motoboy atribuído: ${nome}`;
      detalhe = ({ coletado: "Pedido coletado pelo motoboy.", em_entrega: "Motoboy a caminho do comprador.", entregue: "Entrega concluída." })[fase] || "O motoboy assumiu a entrega. Aguardando a coleta.";
      estado = "atribuido";
    } else if (preferidoId) {
      titulo = `Motoboy selecionado: ${nome}`;
      detalhe = pedido.status === "pronto" ? "Oferta disponibilizada para esse motoboy; aguardando o aceite dele." : "Marque como pronto para disponibilizar o pedido ao motoboy.";
      estado = "selecionado";
    }
    if (["cancelado", "entregue"].includes(pedido.status)) detalhe = pedido.status === "entregue" ? "Entrega concluída." : "Pedido cancelado; não enviar para entrega.";
    return `<div class="delivery-responsibility" data-delivery-state="${estado}" role="status"><strong>${titulo}</strong><small>${detalhe}</small></div>`;
  }

  async function chamarEntregas(acao, dados = {}, generation = entregaState.generation, userId = entregaState.userId) {
    const client = getClient();
    if (!client?.auth) throw new Error("Autenticação indisponível. Atualize a página e entre novamente.");
    const { data, error } = await client.auth.getSession();
    if (error) throw new Error("Não foi possível verificar sua sessão.");
    const session = data?.session;
    const token = session?.access_token;
    if (!token) throw new Error("Sua sessão expirou. Entre novamente.");
    if (generation !== entregaState.generation || !entregaState.userId || entregaState.userId !== userId || session.user?.id !== userId) throw new Error(STALE_SESSION_REQUEST);
    const response = await fetch(ENTREGA_API_URL, { method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }, body: JSON.stringify({ acao, comercio_id: comercioId, ...dados }) });
    const result = await response.json().catch(() => ({}));
    if (generation !== entregaState.generation || entregaState.userId !== userId) throw new Error(STALE_SESSION_REQUEST);
    if (!response.ok || result?.success !== true) { const failure = new Error(result?.mensagem || "A operação de entregas não foi autorizada."); failure.status = response.status; throw failure; }
    return result;
  }

  function opcoesMotoboys(pedido) {
    const atual = String(pedido.motoboy_id || pedido.motoboy_preferido_id || "");
    const rede = `<option value="" ${atual ? "" : "selected"}>🛵 Motoboys disponíveis</option>`;
    const conhecidos = entregaState.motoboys.filter((item) => item && item.ativo === true);
    return rede + conhecidos.map((item) => `<option value="${escapar(item.usuario_id)}" ${String(item.usuario_id) === atual ? "selected" : ""}>${escapar(item.nome || item.email || "Motoboy")}</option>`).join("");
  }

  function renderizarMotoboysLinha(pedido) {
    const id = pedidoIdSeguro(pedido);
    const fase = pedido.entrega_status || "";
    const bloqueado = ["coletado", "em_entrega", "entregue", "cancelado"].includes(fase) || ["coletado", "em_entrega", "entregue", "cancelado"].includes(pedido.status);
    return `<div class="delivery-assignment" data-delivery-assignment="${escapar(id)}"><label for="motoboy-${escapar(id)}">Entregador</label><select id="motoboy-${escapar(id)}" data-atribuir-select="${escapar(id)}" ${bloqueado ? "disabled" : ""}>${opcoesMotoboys(pedido)}</select><button class="small-button" type="button" data-atribuir="${escapar(id)}" ${bloqueado ? "disabled" : ""}>${pedido.motoboy_id ? "Atualizar atribuição" : "Atribuir"}</button></div>`;
  }

  async function carregarMotoboys() {
    if (!entregaState.userId) return;
    try {
      const resultado = await chamarEntregas("listar_motoboys", {}, entregaState.generation, entregaState.userId);
      entregaState.motoboys = Array.isArray(resultado.motoboys) ? resultado.motoboys : [];
      if (Array.isArray(ultimaListaPedidos)) renderizarPedidosOffline(ultimaListaPedidos);
    } catch (error) {
      if (error.message !== STALE_SESSION_REQUEST) setFeedback("pedidosOfflineFeedback", error.message || "Não foi possível carregar os motoboys.", true);
    }
  }

  let ultimaListaPedidos = [];

  async function chamarPedidosOffline(body) {
    const client = getClient();
    if (!client?.functions) throw new Error("Autenticação indisponível. Atualize a página e entre novamente.");
    const { data, error } = await client.functions.invoke("catalogo-pedidos-offline-admin", { body: { ...body, comercio_id: comercioId } });
    if (error) {
      let mensagem = data?.mensagem;
      if (!mensagem && error.context?.json) {
        try { mensagem = (await error.context.json())?.mensagem; } catch { /* resposta sem JSON */ }
      }
      throw new Error(mensagem || "Não foi possível processar o pedido. Verifique sua sessão.");
    }
    if (!data?.success) throw new Error(data?.mensagem || "Não foi possível consultar os pedidos offline.");
    return data;
  }

  function renderizarPedidosOffline(pedidos) {
    ultimaListaPedidos = Array.isArray(pedidos) ? pedidos : [];
    const lista = $("listaPedidosOffline");
    const ativos = ultimaListaPedidos.filter((pedido) => !["entregue", "cancelado"].includes(pedido.status)).length;
    $("offlineSummary").innerHTML = `<span>${ultimaListaPedidos.length} pedido(s) no histórico</span><span>${ativos} em andamento</span><span>V2: ${ultimaListaPedidos.filter((pedido) => Number(pedido.versao_financeira) === 2).length} · V1: ${ultimaListaPedidos.filter((pedido) => Number(pedido.versao_financeira || 1) !== 2).length}</span>`;
    $("offlineSummary").hidden = false;
    if (!ultimaListaPedidos.length) { lista.innerHTML = '<p class="form-feedback">Nenhum pedido registrado.</p>'; return; }
    lista.innerHTML = ultimaListaPedidos.map((pedido) => {
      const id = pedidoIdSeguro(pedido);
      const pix = pedido.forma_pagamento === "pix" || ["pix", "mercadopago"].includes(pedido.provedor);
      const pixAprovado = ["aprovado", "approved"].includes(String(pedido.status_pagamento || "").toLowerCase());
      const aguardandoPix = pix && !pixAprovado && pedido.status === "aguardando_pagamento";
      const proxima = ["aguardando_pagamento", "pago"].includes(pedido.status) && (!pix || pixAprovado) ? "Aceitar e preparar" : pedido.status === "em_preparo" && (!pix || pixAprovado) ? "Marcar como pronto" : "";
      const podeCancelar = ["aguardando_pagamento", "pago", "em_preparo", "pronto"].includes(pedido.status);
      const podeConfirmar = podeCancelar && (!pix || pixAprovado);
      const aceito = Boolean(pedido.aceito_em) || ["reservado", "coletado", "em_entrega", "entregue", "cancelamento_solicitado"].includes(pedido.entrega_status);
      const endereco = pedido.modalidade === "entrega" && pedido.cliente_endereco ? ` · ${escapar(pedido.cliente_endereco)}${pedido.cliente_numero ? `, ${escapar(pedido.cliente_numero)}` : ""}` : "";
      const versao = Number(pedido.versao_financeira) === 2 ? "Taxa atual" : "Taxa histórica";
      const plataforma = Number(pedido.taxa_plataforma_centavos ?? pedido.taxa_plataforma ?? 0);
      const motoboy = Number(pedido.taxa_motoboy_centavos ?? 0);
      const totalFee = Number(pedido.taxa_total_centavos ?? plataforma + motoboy);
      const snapshots = pedido.feeSnapshots || pedido.fee_snapshots || pedido.metadata?.feeSnapshots;
      const snapshotText = snapshots ? ` · snapshot ${escapar(typeof snapshots === "string" ? snapshots : "registrado")}` : "";
      const atribuir = pedido.modalidade === "entrega" && !["entregue", "cancelado"].includes(pedido.status) ? renderizarMotoboysLinha(pedido) : "";
      return `<article class="manager-row offline-order-row" data-pedido-id="${escapar(id)}"><div class="offline-order-copy"><strong>${escapar(pedido.cliente_nome || "Cliente")} · ${reais(pedido.total_centavos)}</strong><small>Pedido: ${escapar(pedido.referencia_externa || id)}</small><small>${escapar(pedido.provedor || "offline")} · ${escapar(pedido.forma_pagamento || "Pagamento não informado")} · ${escapar(pedido.modalidade || "")}${endereco}</small>${renderizarItensPedido(pedido)}${renderizarObservacoesPedido(pedido)}${renderizarContatoCliente(pedido)}${renderizarEstadoEntregador(pedido)}<small>Produtos: ${reais(pedido.subtotal_produtos_centavos)} · Taxa do pedido: ${reais(totalFee)}</small><small>${escapar(versao)}${snapshotText} · ${escapar(statusPagamento(pedido.status_pagamento))}</small><span class="offline-status" data-status="${escapar(pedido.entrega_status || pedido.status)}">${escapar(statusOffline(pedido.entrega_status || pedido.status))}</span></div><div class="manager-actions offline-order-actions">${aguardandoPix ? `<p class="form-feedback">Aguardando pagamento Pix. O aceite será liberado após a aprovação.</p>` : ""}${proxima ? `<button class="small-button" type="button" data-offline-next="${escapar(id)}" data-offline-status="${escapar(["aguardando_pagamento", "pago"].includes(pedido.status) ? "em_preparo" : "pronto")}">${proxima}</button>` : ""}${podeConfirmar ? `<button class="small-button" type="button" data-offline-confirm="${escapar(id)}">Confirmar código</button>` : ""}${podeCancelar ? `<button class="small-button danger" type="button" data-offline-cancel="${escapar(id)}">${aceito ? "Solicitar ocorrência" : "Cancelar pedido"}</button>` : ""}${atribuir}</div></article>`;
    }).join("");
  }

  async function carregarPedidosOffline() {
    $("listaPedidosOffline").innerHTML = '<p class="form-feedback">Atualizando pedidos…</p>';
    try {
      renderizarPedidosOffline((await chamarPedidosOffline({ acao: "listar_pedidos" })).pedidos || []);
      await carregarMotoboys();
    }
    catch (error) { $("listaPedidosOffline").innerHTML = `<p class="form-feedback">${escapar(error.message || "Não foi possível carregar os pedidos.")}</p>`; }
  }

  async function alterarStatusOffline(pedidoId, status, motivo = "") {
    await chamarPedidosOffline({ acao: "atualizar_status", pedido_id: pedidoId, status, motivo });
    await carregarPedidosOffline();
    setFeedback("pedidosOfflineFeedback", status === "pronto" ? "Pedido pronto. O backend fará a oferta automática aos motoboys autorizados/disponíveis." : "Status atualizado.");
  }

  async function atribuirPedidoLinha(pedidoId, botao) {
    const selecao = Array.from(document.querySelectorAll("[data-atribuir-select]")).find((elemento) => String(elemento.dataset.atribuirSelect) === String(pedidoId));
    if (!selecao) return;
    const generation = entregaState.generation;
    const userId = entregaState.userId;
    botao.disabled = true;
    setFeedback("pedidosOfflineFeedback", "Salvando preferência de entrega…");
    try {
      await chamarEntregas("atribuir_pedido", { pedido_id: pedidoId, motoboy_id: selecao.value || null }, generation, userId);
      await carregarPedidosOffline();
      setFeedback("pedidosOfflineFeedback", selecao.value ? "Motoboy selecionado. Confira o destaque no card: o pedido deve estar pronto e o motoboy precisa aceitar a oferta." : "Pedido configurado para Motoboys disponíveis; o backend ofertará ao marcar pronto.");
    } catch (error) {
      if (error.message !== STALE_SESSION_REQUEST) setFeedback("pedidosOfflineFeedback", error.message || "Não foi possível atribuir o pedido.", true);
    } finally { botao.disabled = false; }
  }

  function pedidoAceito(pedidoId) {
    return ultimaListaPedidos.find((pedido) => pedidoIdSeguro(pedido) === String(pedidoId));
  }

  function abrirCancelamento(pedidoId) {
    const pedido = pedidoAceito(pedidoId);
    if (!pedido) return;
    $("cancelamentoPedidoId").value = pedidoId;
    $("cancelamentoMotivo").value = "";
    $("cancelamentoConfirmado").checked = false;
    $("cancelamentoDepoisAceite").textContent = Boolean(pedido.aceito_em) || pedido.entrega_status && !["nao_atribuido", "ofertado"].includes(pedido.entrega_status)
      ? "O pedido já foi aceito ou entrou no fluxo de entrega. Isto criará uma solicitação/ocorrência para análise; nenhuma comissão será alterada diretamente."
      : "Antes do aceite, o cancelamento encerra o pedido conforme as regras legadas.";
    $("cancelamentoDialog").showModal();
    $("cancelamentoMotivo").focus();
  }

  async function confirmarCancelamento(event) {
    event.preventDefault();
    const pedidoId = $("cancelamentoPedidoId").value;
    const pedido = pedidoAceito(pedidoId);
    const motivo = $("cancelamentoMotivo").value.trim();
    if (!motivo || !$("cancelamentoConfirmado").checked) { setFeedback("cancelamentoFeedback", "Confirme o motivo do cancelamento para continuar.", true); return; }
    const posAceite = Boolean(pedido?.aceito_em) || Boolean(pedido?.entrega_status && !["nao_atribuido", "ofertado"].includes(pedido.entrega_status));
    const botao = $("cancelamentoEnviar");
    botao.disabled = true;
    setFeedback("cancelamentoFeedback", posAceite ? "Registrando solicitação para análise…" : "Cancelando pedido…");
    try {
      if (posAceite) await chamarEntregas("solicitar_cancelamento", { pedido_id: pedidoId, motivo });
      else await alterarStatusOffline(pedidoId, "cancelado", motivo);
      $("cancelamentoDialog").close();
      await carregarPedidosOffline();
      setFeedback("pedidosOfflineFeedback", posAceite ? "Solicitação/ocorrência registrada. A comissão permanece para análise administrativa." : "Pedido cancelado antes do aceite.");
    } catch (error) { setFeedback("cancelamentoFeedback", error.message || "Não foi possível registrar o cancelamento.", true); }
    finally { botao.disabled = false; }
  }

  function abrirConfirmacaoOffline(pedidoId) {
    $("confirmarEntregaPainelForm").reset();
    $("confirmarEntregaPedidoId").value = pedidoId;
    setFeedback("confirmarEntregaFeedback", "");
    $("confirmarEntregaPainelDialog").showModal();
    $("confirmarEntregaCodigo").focus();
  }

  async function confirmarEntregaOffline(event) {
    event.preventDefault();
    const codigo = $("confirmarEntregaCodigo").value.trim();
    if (!/^\d{6}$/.test(codigo)) {
      setFeedback("confirmarEntregaFeedback", "Informe exatamente seis números.", true);
      return;
    }
    if (!$("confirmarEntregaRecebido").checked) return;
    const botao = $("confirmarEntregaEnviar");
    botao.disabled = true;
    setFeedback("confirmarEntregaFeedback", "Validando código…");
    try {
      await chamarPedidosOffline({ acao: "confirmar_entrega", pedido_id: $("confirmarEntregaPedidoId").value,
        codigo_entrega: codigo, entregador: $("confirmarEntregaEntregador").value.trim() });
      $("confirmarEntregaPainelDialog").close();
      $("confirmarEntregaPainelForm").reset();
      await carregarPedidosOffline();
      setFeedback("pedidosOfflineFeedback", "Entrega confirmada. A taxa registrada é a do snapshot financeiro do pedido e não é cobrada novamente.");
    } catch (error) {
      setFeedback("confirmarEntregaFeedback", error.message || "Não foi possível confirmar a entrega.", true);
    } finally { botao.disabled = false; }
  }

  async function consultarExtratoOffline() {
    const competencia = $("competenciaOffline").value;
    if (!competencia) { $("extratoOffline").innerHTML = '<p class="form-feedback">Escolha um mês para consultar o extrato.</p>'; return; }
    $("extratoOffline").innerHTML = '<p class="form-feedback">Consultando extrato…</p>';
    try {
      const data = await chamarPedidosOffline({ acao: "consultar_fechamento", competencia });
      const fechamento = data.fechamento; const comissoes = data.comissoes || [];
      if (!fechamento && !comissoes.length) { $("extratoOffline").innerHTML = '<p class="form-feedback">Nenhuma comissão registrada nesta competência.</p>'; return; }
      const total = fechamento?.total_comissao_centavos ?? comissoes.reduce((sum, item) => sum + Number(item.valor_comissao_centavos || 0), 0);
      $("extratoOffline").innerHTML = `<p><strong>Total de pedidos:</strong> ${fechamento?.total_pedidos ?? comissoes.length}</p><p><strong>Comissão devida:</strong> ${reais(total)}</p><p><strong>Status:</strong> ${escapar(fechamento?.status || "em aberto")}${fechamento?.vencimento_em ? ` · vencimento ${escapar(fechamento.vencimento_em)}` : ""}</p>`;
    } catch (error) { $("extratoOffline").innerHTML = `<p class="form-feedback">${escapar(error.message || "Não foi possível consultar o extrato.")}</p>`; }
  }

  function traducaoCobranca(status) {
    return ({
      aberto: "Em aberto",
      faturado: "Fechada, aguardando pagamento",
      pendente: "Pix pendente",
      pago: "Paga",
      vencido: "Vencida",
      bloqueado: "Bloqueada por inadimplência",
      expirado: "Pix expirado",
      cancelado: "Cancelada",
      estornado: "Estornada (crédito revogado)",
      contestado: "Contestada (chargeback)",
      divergente: "Divergência de valor — conferência manual",
    })[status] || status || "sem cobrança";
  }

  async function chamarFaturaPix(body) {
    const { data, error } = await getClient().functions.invoke("catalogo-fatura-pix", { body: { ...body, comercio_id: comercioId } });
    if (error || !data?.success) throw new Error(data?.mensagem || error?.message || "Não foi possível processar a cobrança da fatura.");
    return data;
  }

  function competenciaDaFatura() {
    const competencia = $("competenciaOffline").value;
    if (!competencia) throw new Error("Escolha o mês da fatura antes de gerar o Pix.");
    return competencia;
  }

  function renderizarPixFatura(data) {
    const fatura = data.fatura || {};
    const pix = data.pix || {};
    const total = Number(data.valor_centavos ?? fatura.total_comissao_centavos ?? 0);
    const situacao = data.cobranca_status || fatura.status || "";
    const partes = [
      `<p><strong>Comissão da competência:</strong> ${reais(total)}</p>`,
      `<p><strong>Situação:</strong> ${escapar(traducaoCobranca(situacao))}${fatura.vencimento_em ? ` · vencimento ${escapar(fatura.vencimento_em)}` : ""}</p>`,
    ];
    if (data.mensagem) partes.push(`<p class="form-feedback">${escapar(data.mensagem)}</p>`);
    if (pix.code) {
      if (pix.imageBase64) partes.push(`<img class="pix-qr" alt="QR Code Pix da fatura" src="data:image/png;base64,${pix.imageBase64}">`);
      partes.push(`<label class="pix-copy">Pix copia e cola<textarea readonly rows="3">${escapar(pix.code)}</textarea></label>`);
      partes.push('<button id="copiarPixFatura" class="small-button" type="button">Copiar código Pix</button>');
      if (/^https:\/\//.test(pix.ticketUrl || "")) partes.push(`<p><a class="button button-secondary" href="${escapar(pix.ticketUrl)}" target="_blank" rel="noopener">Abrir no Mercado Pago</a></p>`);
    }
    $("faturaPixResultado").innerHTML = partes.join("");
    const copiar = $("copiarPixFatura");
    if (copiar) copiar.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(pix.code); copiar.textContent = "Código copiado"; }
      catch { copiar.textContent = "Copie o código manualmente"; }
    });
  }

  async function gerarPixFatura() {
    $("faturaPixResultado").innerHTML = '<p class="form-feedback">Solicitando o Pix da fatura…</p>';
    try { renderizarPixFatura(await chamarFaturaPix({ acao: "criar_cobranca", competencia: competenciaDaFatura() })); }
    catch (error) { $("faturaPixResultado").innerHTML = `<p class="form-feedback">${escapar(error.message || "Não foi possível gerar o Pix da fatura.")}</p>`; }
  }

  async function consultarPixFatura() {
    $("faturaPixResultado").innerHTML = '<p class="form-feedback">Verificando o pagamento da fatura…</p>';
    try { renderizarPixFatura(await chamarFaturaPix({ acao: "consultar_cobranca", competencia: competenciaDaFatura() })); }
    catch (error) { $("faturaPixResultado").innerHTML = `<p class="form-feedback">${escapar(error.message || "Não foi possível verificar o pagamento da fatura.")}</p>`; }
  }

  async function carregarDadosPainel() {
    const supabase = getClient();
    const [{ data: cfg, error: erroCfg }, { data: cats, error: erroCats }, { data: prods, error: erroProds }] = await Promise.all([
      supabase.from("catalogos").select("comercio_id,modalidades,metodos_pagamento").eq("comercio_id", comercioId).single(),
      supabase.from("catalogo_categorias").select("id,comercio_id,nome,ordem,ativa,deletado_em").eq("comercio_id", comercioId).is("deletado_em", null).order("ordem", { ascending: true }),
      supabase.from("catalogo_produtos").select("id,comercio_id,categoria_id,nome,descricao,preco,imagem,disponivel,ordem,deletado_em").eq("comercio_id", comercioId).is("deletado_em", null).order("ordem", { ascending: true }),
    ]);
    if (erroCfg) throw erroCfg;
    if (erroCats) throw erroCats;
    if (erroProds) throw erroProds;
    categorias = cats || [];
    produtos = prods || [];
    montarCheckboxes("modalidadesSettings", modalidades, cfg.modalidades || []);
    montarCheckboxes("pagamentosSettings", pagamentos, cfg.metodos_pagamento || []);
    renderizarCategorias();
    renderizarProdutos();
    preencherCategoriasProduto();
    const month = new Date().toISOString().slice(0, 7);
    if (!$("competenciaOffline").value) $("competenciaOffline").value = month;
    await carregarPedidosOffline();
  }

  function renderizarCategorias() {
    const lista = $("listaCategorias");
    if (!categorias.length) {
      lista.innerHTML = '<p class="form-feedback">Ainda não há categorias. Crie uma para começar a cadastrar produtos.</p>';
      return;
    }
    lista.innerHTML = categorias.map((categoria, indice) => `
      <article class="manager-row">
        <div class="manager-copy"><strong>${escapar(categoria.nome)}</strong><small>Ordem ${indice + 1}${categoria.ativa ? " · visível" : " · oculta"}</small></div>
        <div class="manager-actions">
          <button class="small-button" type="button" data-cat-move="up" data-id="${escapar(categoria.id)}" aria-label="Mover categoria para cima" ${indice === 0 ? "disabled" : ""}>↑</button>
          <button class="small-button" type="button" data-cat-move="down" data-id="${escapar(categoria.id)}" aria-label="Mover categoria para baixo" ${indice === categorias.length - 1 ? "disabled" : ""}>↓</button>
          <button class="small-button" type="button" data-cat-edit="${escapar(categoria.id)}">Editar</button>
          <button class="small-button danger" type="button" data-cat-delete="${escapar(categoria.id)}">Arquivar</button>
        </div>
      </article>
    `).join("");
  }

  function preencherCategoriasProduto() {
    const ativo = categorias.filter((categoria) => categoria.ativa && !categoria.deletado_em);
    $("produtoCategoria").innerHTML = ativo.length
      ? ativo.map((categoria) => `<option value="${escapar(categoria.id)}">${escapar(categoria.nome)}</option>`).join("")
      : '<option value="">Crie uma categoria primeiro</option>';
    $("salvarProduto").disabled = !ativo.length;
  }

  function publicUrl(imagem) {
    if (!imagem) return IMAGEM_PADRAO;
    if (/^https?:\/\//i.test(imagem)) return imagem;
    return getClient().storage.from(BUCKET).getPublicUrl(String(imagem).replace(/^catalogos\//, "")).data?.publicUrl || IMAGEM_PADRAO;
  }

  function renderizarProdutos() {
    $("contadorProdutos").textContent = String(produtos.length);
    const lista = $("listaProdutos");
    if (!produtos.length) {
      lista.innerHTML = '<p class="form-feedback">Ainda não há produtos cadastrados.</p>';
      return;
    }
    const porCategoria = new Map(categorias.map((categoria) => [String(categoria.id), categoria.nome]));
    lista.innerHTML = produtos.map((produto) => `
      <article class="manager-row product-row">
        <div class="product-row-main">
          <img class="product-row-image" src="${escapar(publicUrl(produto.imagem))}" alt="" loading="lazy" data-admin-image>
          <div class="manager-copy"><strong>${escapar(produto.nome)} · ${window.CatalogoUtils.formatarMoeda(produto.preco)}</strong><small>${escapar(porCategoria.get(String(produto.categoria_id)) || "Sem categoria")}${produto.descricao ? ` · ${escapar(produto.descricao)}` : ""}</small><small class="${produto.disponivel ? "available-label" : "unavailable-label"}">${produto.disponivel ? "Disponível" : "Indisponível"}</small></div>
        </div>
        <div class="manager-actions">
          <button class="small-button" type="button" data-product-edit="${escapar(produto.id)}">Editar</button>
          <button class="small-button" type="button" data-product-toggle="${escapar(produto.id)}">${produto.disponivel ? "Pausar" : "Ativar"}</button>
          <button class="small-button danger" type="button" data-product-delete="${escapar(produto.id)}">Excluir</button>
        </div>
      </article>
    `).join("");
    lista.querySelectorAll("[data-admin-image]").forEach((img) => img.addEventListener("error", () => { img.src = IMAGEM_PADRAO; }, { once: true }));
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
      return (c === "x" ? r : (r & 3) | 8).toString(16);
    });
  }

  async function otimizarImagem(file) {
    const tiposAceitos = ["image/jpeg", "image/png", "image/webp"];
    if (!file || !tiposAceitos.includes(file.type)) throw new Error("Escolha uma foto JPG, PNG ou WebP.");
    if (file.size > 15 * 1024 * 1024) throw new Error("A foto original deve ter até 15 MiB.");

    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, 1440 / bitmap.width, 1440 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    const contexto = canvas.getContext("2d", { alpha: false });
    if (!contexto) throw new Error("Não foi possível preparar a foto neste navegador.");
    contexto.fillStyle = "#fff";
    contexto.fillRect(0, 0, canvas.width, canvas.height);
    contexto.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    let blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.84));
    let ext = "webp";
    let mime = "image/webp";
    if (!blob || blob.type !== "image/webp") {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      ext = "jpg";
      mime = "image/jpeg";
    }
    if (!blob || blob.type !== mime || blob.size > 5 * 1024 * 1024) throw new Error("A foto otimizada deve ficar abaixo de 5 MiB. Use uma imagem menor.");
    return { blob, ext, mime };
  }

  async function enviarImagem(file, productId) {
    const { blob, ext, mime } = await otimizarImagem(file);
    const nome = `${comercioId}/${productId}/${Date.now()}-${uuid()}.${ext}`;
    const { error } = await getClient().storage.from(BUCKET).upload(nome, blob, { contentType: mime, upsert: false, cacheControl: "3600" });
    if (error) throw error;
    return `${BUCKET}/${nome}`;
  }

  function limparFormularioProduto() {
    $("produtoForm").reset();
    $("produtoId").value = "";
    $("produtoDisponivel").checked = true;
    $("salvarProduto").textContent = "Adicionar produto";
    $("cancelarProduto").hidden = true;
    setFeedback("produtoFeedback", "");
  }

  function iniciarEdicaoProduto(id) {
    const produto = produtos.find((item) => String(item.id) === String(id));
    if (!produto) return;
    $("produtoId").value = produto.id;
    $("produtoNome").value = produto.nome;
    $("produtoDescricao").value = produto.descricao || "";
    $("produtoPreco").value = Number(produto.preco).toFixed(2);
    $("produtoCategoria").value = produto.categoria_id;
    $("produtoDisponivel").checked = Boolean(produto.disponivel);
    $("produtoImagem").value = "";
    $("salvarProduto").textContent = "Salvar alterações";
    $("cancelarProduto").hidden = false;
    $("produtoForm").scrollIntoView({ behavior: "smooth", block: "center" });
    $("produtoNome").focus();
  }

  async function salvarProduto(event) {
    event.preventDefault();
    const supabase = getClient();
    const botao = $("salvarProduto");
    botao.disabled = true;
    setFeedback("produtoFeedback", "Salvando produto…");

    try {
      const produtoId = $("produtoId").value || uuid();
      const existente = produtos.find((produto) => String(produto.id) === String(produtoId));
      const file = $("produtoImagem").files?.[0];
      const payload = {
        id: produtoId,
        comercio_id: comercioId,
        categoria_id: $("produtoCategoria").value,
        nome: $("produtoNome").value.trim(),
        descricao: $("produtoDescricao").value.trim(),
        preco: Number($("produtoPreco").value),
        disponivel: $("produtoDisponivel").checked,
        ordem: existente?.ordem ?? produtos.length,
        imagem: existente?.imagem || null,
      };
      if (!payload.nome || !payload.categoria_id || !Number.isFinite(payload.preco) || payload.preco < 0) throw new Error("Preencha nome, categoria e preço válido.");
      if (file) payload.imagem = await enviarImagem(file, produtoId);

      const resposta = existente
        ? await supabase.from("catalogo_produtos").update(payload).eq("id", produtoId).eq("comercio_id", comercioId)
        : await supabase.from("catalogo_produtos").insert(payload);
      if (resposta.error) throw resposta.error;
      await carregarDadosPainel();
      limparFormularioProduto();
      setFeedback("produtoFeedback", "Produto salvo. Se uma foto foi substituída, a anterior ficará sujeita à retenção de sete dias.");
    } catch (erro) {
      console.error("Erro ao salvar produto:", erro);
      setFeedback("produtoFeedback", erro.message || "Não foi possível salvar o produto.", true);
    } finally {
      botao.disabled = false;
    }
  }

  async function salvarCategoria(event) {
    event.preventDefault();
    const id = $("categoriaId").value;
    const nome = $("categoriaNome").value.trim();
    if (!nome) return;
    const botao = $("salvarCategoria");
    botao.disabled = true;
    setFeedback("categoriaFeedback", "Salvando categoria…");
    try {
      const resposta = id
        ? await getClient().from("catalogo_categorias").update({ nome }).eq("id", id).eq("comercio_id", comercioId)
        : await getClient().from("catalogo_categorias").insert({ comercio_id: comercioId, nome, ordem: categorias.length });
      if (resposta.error) throw resposta.error;
      $("categoriaForm").reset();
      $("categoriaId").value = "";
      $("salvarCategoria").textContent = "Adicionar categoria";
      $("cancelarCategoria").hidden = true;
      await carregarDadosPainel();
      setFeedback("categoriaFeedback", "Categoria salva.");
    } catch (erro) {
      setFeedback("categoriaFeedback", erro.message || "Não foi possível salvar a categoria.", true);
    } finally {
      botao.disabled = false;
    }
  }

  async function excluirCategoria(id) {
    const categoria = categorias.find((item) => String(item.id) === String(id));
    if (!categoria) return;
    const associadas = produtos.filter((produto) => String(produto.categoria_id) === String(id));
    if (associadas.length) {
      const destino = categorias.filter((item) => String(item.id) !== String(id) && item.ativa && !item.deletado_em);
      if (!destino.length) {
        setFeedback("categoriaFeedback", "Crie outra categoria antes de arquivar esta: há produtos vinculados.", true);
        return;
      }
      removendoCategoriaId = id;
      $("reassignCategorySelect").innerHTML = destino.map((item) => `<option value="${escapar(item.id)}">${escapar(item.nome)}</option>`).join("");
      $("reassignCategoryDialog").showModal();
      return;
    }
    if (!window.confirm(`Arquivar a categoria “${categoria.nome}”?`)) return;
    await aplicarExclusaoCategoria(id, null);
  }

  async function aplicarExclusaoCategoria(id, categoriaDestino) {
    try {
      if (categoriaDestino) {
        const { error: erroMover } = await getClient().from("catalogo_produtos").update({ categoria_id: categoriaDestino }).eq("comercio_id", comercioId).eq("categoria_id", id).is("deletado_em", null);
        if (erroMover) throw erroMover;
      }
      const { error } = await getClient().from("catalogo_categorias").update({ ativa: false, deletado_em: new Date().toISOString() }).eq("id", id).eq("comercio_id", comercioId);
      if (error) throw error;
      $("reassignCategoryDialog").close();
      await carregarDadosPainel();
      setFeedback("categoriaFeedback", "Categoria arquivada.");
    } catch (erro) {
      setFeedback("categoriaFeedback", erro.message || "Não foi possível arquivar a categoria.", true);
    }
  }

  async function moverCategoria(id, direcao) {
    const indice = categorias.findIndex((item) => String(item.id) === String(id));
    const proximo = indice + (direcao === "up" ? -1 : 1);
    if (indice < 0 || proximo < 0 || proximo >= categorias.length) return;
    const lista = [...categorias];
    [lista[indice], lista[proximo]] = [lista[proximo], lista[indice]];
    try {
      for (let pos = 0; pos < lista.length; pos += 1) {
        const { error } = await getClient().from("catalogo_categorias").update({ ordem: pos }).eq("id", lista[pos].id).eq("comercio_id", comercioId);
        if (error) throw error;
      }
      await carregarDadosPainel();
    } catch (erro) {
      setFeedback("categoriaFeedback", erro.message || "Não foi possível reordenar as categorias.", true);
    }
  }

  async function excluirProduto(id) {
    const produto = produtos.find((item) => String(item.id) === String(id));
    if (!produto || !window.confirm(`Excluir “${produto.nome}” da vitrine? A foto respeitará a retenção de sete dias.`)) return;
    const { error } = await getClient().from("catalogo_produtos").update({ disponivel: false, imagem: null, deletado_em: new Date().toISOString() }).eq("id", id).eq("comercio_id", comercioId);
    if (error) {
      setFeedback("produtoFeedback", error.message || "Não foi possível excluir o produto.", true);
      return;
    }
    await carregarDadosPainel();
    setFeedback("produtoFeedback", "Produto retirado da vitrine; a foto não foi apagada imediatamente.");
  }

  async function alternarProduto(id) {
    const produto = produtos.find((item) => String(item.id) === String(id));
    if (!produto) return;
    const { error } = await getClient().from("catalogo_produtos").update({ disponivel: !produto.disponivel }).eq("id", id).eq("comercio_id", comercioId);
    if (error) {
      setFeedback("produtoFeedback", error.message || "Não foi possível atualizar a disponibilidade.", true);
      return;
    }
    await carregarDadosPainel();
  }

  async function salvarConfiguracoes(event) {
    event.preventDefault();
    const modos = lerCheckboxes("modalidadesSettings");
    const formas = lerCheckboxes("pagamentosSettings");
    if (!modos.length || !formas.length) {
      setFeedback("settingsFeedback", "Selecione ao menos uma modalidade e uma forma de pagamento.", true);
      return;
    }
    const { error } = await getClient().from("catalogos").update({ modalidades: modos, metodos_pagamento: formas }).eq("comercio_id", comercioId);
    if (error) setFeedback("settingsFeedback", error.message || "Não foi possível salvar as configurações.", true);
    else setFeedback("settingsFeedback", "Configurações salvas.");
  }

  function configurarEventos() {
    $("produtoForm").addEventListener("submit", salvarProduto);
    $("categoriaForm").addEventListener("submit", salvarCategoria);
    $("settingsForm").addEventListener("submit", salvarConfiguracoes);
    $("cancelarProduto").addEventListener("click", limparFormularioProduto);
    $("cancelarCategoria").addEventListener("click", () => {
      $("categoriaForm").reset();
      $("categoriaId").value = "";
      $("salvarCategoria").textContent = "Adicionar categoria";
      $("cancelarCategoria").hidden = true;
    });
    $("listaCategorias").addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.catEdit) {
        const item = categorias.find((categoria) => String(categoria.id) === String(button.dataset.catEdit));
        if (!item) return;
        $("categoriaId").value = item.id;
        $("categoriaNome").value = item.nome;
        $("salvarCategoria").textContent = "Salvar categoria";
        $("cancelarCategoria").hidden = false;
        $("categoriaNome").focus();
      } else if (button.dataset.catDelete) excluirCategoria(button.dataset.catDelete);
      else if (button.dataset.catMove) moverCategoria(button.dataset.id, button.dataset.catMove);
    });
    $("listaProdutos").addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.productEdit) iniciarEdicaoProduto(button.dataset.productEdit);
      else if (button.dataset.productToggle) alternarProduto(button.dataset.productToggle);
      else if (button.dataset.productDelete) excluirProduto(button.dataset.productDelete);
    });
    $("listaPedidosOffline").addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.offlineConfirm) {
        abrirConfirmacaoOffline(button.dataset.offlineConfirm);
        return;
      }
      if (button.dataset.atribuir) {
        await atribuirPedidoLinha(button.dataset.atribuir, button);
        return;
      }
      if (button.dataset.offlineCancel) {
        abrirCancelamento(button.dataset.offlineCancel);
        return;
      }
      button.disabled = true;
      try {
        if (button.dataset.offlineNext) await alterarStatusOffline(button.dataset.offlineNext, button.dataset.offlineStatus);
      } catch (error) { setFeedback("settingsFeedback", error.message || "Não foi possível atualizar o pedido.", true); button.disabled = false; }
    });
    $("confirmarEntregaPainelForm").addEventListener("submit", confirmarEntregaOffline);
    $("cancelarConfirmarEntrega").addEventListener("click", () => $("confirmarEntregaPainelDialog").close());
    $("confirmarEntregaPainelDialog").addEventListener("close", () => {
      $("confirmarEntregaPainelForm").reset();
      setFeedback("confirmarEntregaFeedback", "");
    });
    $("atualizarPedidosOffline").addEventListener("click", carregarPedidosOffline);
    $("consultarExtratoOffline").addEventListener("click", consultarExtratoOffline);
    $("gerarPixFatura").addEventListener("click", gerarPixFatura);
    $("consultarPixFatura").addEventListener("click", consultarPixFatura);
    $("cancelamentoForm").addEventListener("submit", confirmarCancelamento);
    $("cancelarCancelamento").addEventListener("click", () => $("cancelamentoDialog").close());
    $("cancelamentoDialog").addEventListener("close", () => { $("cancelamentoForm").reset(); setFeedback("cancelamentoFeedback", ""); });
    $("logoutCatalogo").addEventListener("click", async () => {
      entregaState.generation += 1; entregaState.userId = ""; entregaState.sessionToken = ""; entregaState.motoboys = []; ultimaListaPedidos = [];
      $("listaPedidosOffline").innerHTML = ""; $("painelCatalogo").hidden = true; $("loginCard").hidden = false; $("logoutCatalogo").hidden = true;
      try { await getClient()?.auth?.signOut({ scope: "local" }); } catch { /* bloqueio visual mesmo se a sessão remota falhar */ }
    });
    $("reassignCategoryForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!removendoCategoriaId) return;
      await aplicarExclusaoCategoria(removendoCategoriaId, $("reassignCategorySelect").value);
      removendoCategoriaId = null;
    });
    $("cancelarReassign").addEventListener("click", () => {
      removendoCategoriaId = null;
      $("reassignCategoryDialog").close();
    });
  }

  async function iniciar() {
    linkPerfil();
    if (!comercioId) {
      setNotice("Comércio não informado", "Volte ao perfil e abra a gestão do catálogo por lá.", true);
      $("loginCard").hidden = true;
      $("catalogoBloqueado").hidden = true;
      return;
    }
    const supabase = getClient();
    if (!supabase) {
      setNotice("Serviço de autenticação indisponível", "Tente novamente mais tarde.", true);
      return;
    }
    supabase.auth.onAuthStateChange((evento) => {
      if (evento === "SIGNED_IN" || evento === "SIGNED_OUT" || evento === "TOKEN_REFRESHED") entrarPainel();
    });
    await entrarPainel();
  }

  document.addEventListener("DOMContentLoaded", () => {
    configurarEventos();
    iniciar();
  });
})();
