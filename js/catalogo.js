(function () {
  "use strict";

  const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  const BUCKET = "catalogos";
  const IMAGEM_PADRAO = "../img/sem-foto.png";
  const parametros = new URLSearchParams(window.location.search);
  const comercioId = (parametros.get("id") || parametros.get("comercio_id") || "").trim();
  const chaveCarrinho = `guia-catalogo-cart:${comercioId}`;

  let supabaseClient = null;
  let catalogo = null;
  let comercio = null;
  let categorias = [];
  let produtos = [];
  let categoriaSelecionada = "todas";
  let carrinho = {};
  let pedidoEmRevisao = null;
  let podePedir = false;
  let telefonePedido = "";
  const STATUS_TOKEN_RE = /^[a-f0-9]{64}$/i;
  const INTERVALO_STATUS_OFFLINE = 20000;
  let consultaStatusOfflineEmAndamento = null;
  let consultaStatusOfflineChave = "";
  let contextoConsultaStatusOffline = null;
  let consultaStatusOfflineTimer = null;
  let comprovanteOfflineVersao = 0;
  let comprovanteOfflineMemoria = null;
  let statusOfflineAviso = false;
  let dialogoSomenteComprovante = false;
  const PROVEDORES_PIX = new Set(["pix", "mercadopago"]);
  const STATUS_TERMINAIS_SEM_ACAO = new Set(["cancelado", "canceled", "expirado", "expired", "estornado", "refunded", "charged_back", "contestado", "revisao_parcial"]);

  const $ = (id) => document.getElementById(id);

  function clienteSupabase() {
    if (supabaseClient) return supabaseClient;
    supabaseClient = window.supabaseLoginClient || window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
    return supabaseClient;
  }

  function escapar(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, (caractere) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    })[caractere]);
  }

  function mostrarEstado(titulo, texto) {
    $("statusTitulo").textContent = titulo;
    $("statusTexto").textContent = texto;
    $("catalogoAviso").hidden = false;
    $("catalogoConteudo").hidden = true;
    $("abrirCarrinho").hidden = true;
  }

  function caminhoImagem(valor) {
    if (!valor) return IMAGEM_PADRAO;
    if (/^https?:\/\//i.test(valor)) return valor;
    const { data } = clienteSupabase().storage.from(BUCKET).getPublicUrl(String(valor).replace(/^catalogos\//, ""));
    return data?.publicUrl || IMAGEM_PADRAO;
  }

  function salvarCarrinho() {
    try {
      localStorage.setItem(chaveCarrinho, JSON.stringify(carrinho));
    } catch (erro) {
      console.warn("Não foi possível salvar a sacola neste navegador.", erro);
    }
  }

  function carregarCarrinhoSalvo() {
    try {
      carrinho = window.CatalogoUtils.normalizarCarrinho(
        JSON.parse(localStorage.getItem(chaveCarrinho) || "{}"),
        produtos.map((produto) => produto.id),
      );
    } catch {
      carrinho = {};
    }
  }

  function itensCarrinho() {
    const porId = new Map(produtos.map((produto) => [String(produto.id), produto]));
    return Object.entries(carrinho)
      .map(([id, quantidade]) => {
        const produto = porId.get(String(id));
        return produto ? { ...produto, quantidade: Number(quantidade) } : null;
      })
      .filter(Boolean);
  }

  function totalCarrinho() {
    return window.CatalogoUtils.calcularTotal(itensCarrinho());
  }

  function atualizarBotaoSacola() {
    const quantidade = Object.values(carrinho).reduce((total, item) => total + Number(item), 0);
    $("cartFabCount").textContent = String(quantidade);
    $("cartFabTotal").textContent = window.CatalogoUtils.formatarMoeda(totalCarrinho());
    $("abrirCarrinho").hidden = !podePedir || quantidade === 0;
    $("irCheckout").disabled = quantidade === 0;
  }

  function renderizarCategorias() {
    const nav = $("categoriasNav");
    const todas = [{ id: "todas", nome: "Todos" }, ...categorias];
    nav.innerHTML = todas.map((categoria) => `
      <button class="category-chip" type="button" data-category="${escapar(categoria.id)}"
        aria-pressed="${String(categoriaSelecionada === categoria.id)}">${escapar(categoria.nome)}</button>
    `).join("");
  }

  function renderizarProdutos() {
    const lista = categoriaSelecionada === "todas"
      ? produtos
      : produtos.filter((produto) => String(produto.categoria_id) === String(categoriaSelecionada));
    const container = $("produtosGrid");

    if (!lista.length) {
      container.innerHTML = '<div class="empty-products">Não há produtos disponíveis nesta categoria no momento.</div>';
      return;
    }

    container.innerHTML = lista.map((produto) => `
      <article class="product-card">
        <img class="product-photo" src="${escapar(caminhoImagem(produto.imagem))}" alt="Foto de ${escapar(produto.nome)}" loading="lazy" data-product-image>
        <div class="product-info">
          <h3>${escapar(produto.nome)}</h3>
          <p>${escapar(produto.descricao || "")}</p>
          <div class="product-bottom">
            <span class="product-price">${window.CatalogoUtils.formatarMoeda(produto.preco)}</span>
            <button class="add-button" type="button" data-add="${escapar(produto.id)}" ${podePedir ? "" : "disabled"}>${podePedir ? "Adicionar" : "Pedidos indisponíveis"}</button>
          </div>
        </div>
      </article>
    `).join("");

    container.querySelectorAll("[data-product-image]").forEach((imagem) => {
      imagem.addEventListener("error", () => { imagem.src = IMAGEM_PADRAO; }, { once: true });
    });
  }

  function renderizarSacola() {
    const itens = itensCarrinho();
    $("cartItems").innerHTML = itens.map((item) => `
      <article class="cart-line">
        <div>
          <h3>${escapar(item.nome)}</h3>
          <small>${window.CatalogoUtils.formatarMoeda(item.preco)} cada</small>
          <div class="quantity-controls" aria-label="Quantidade de ${escapar(item.nome)}">
            <button type="button" data-change="-1" data-id="${escapar(item.id)}" aria-label="Diminuir quantidade">−</button>
            <span>${Number(item.quantidade)}</span>
            <button type="button" data-change="1" data-id="${escapar(item.id)}" aria-label="Aumentar quantidade">+</button>
          </div>
        </div>
        <div class="cart-line-total">${window.CatalogoUtils.formatarMoeda(window.CatalogoUtils.calcularTotal([item]))}</div>
      </article>
    `).join("");

    $("cartEmpty").hidden = itens.length > 0;
    $("limparCarrinho").hidden = itens.length === 0;
    $("cartTotal").textContent = window.CatalogoUtils.formatarMoeda(totalCarrinho());
    atualizarBotaoSacola();
  }

  function abrirSacola() {
    $("cartPanel").hidden = false;
    $("cartBackdrop").hidden = false;
    requestAnimationFrame(() => $("cartPanel").classList.add("is-open"));
    $("cartPanel").setAttribute("aria-hidden", "false");
    $("abrirCarrinho").setAttribute("aria-expanded", "true");
    $("fecharCarrinho").focus();
  }

  function fecharSacola() {
    $("cartPanel").classList.remove("is-open");
    $("cartPanel").setAttribute("aria-hidden", "true");
    $("abrirCarrinho").setAttribute("aria-expanded", "false");
    window.setTimeout(() => {
      $("cartPanel").hidden = true;
      $("cartBackdrop").hidden = true;
    }, 220);
  }

  function preencherCheckout() {
    const modalidadesAtivas = (catalogo.modalidades || []).filter((chave) => window.CatalogoUtils.MODALIDADES[chave]);
    const pagamentosAtivos = (catalogo.metodos_pagamento || []).filter((chave) => window.CatalogoUtils.FORMAS_PAGAMENTO[chave]);
    const modalidadeInicial = modalidadesAtivas[0] || "retirada";

    $("modalidadeOptions").innerHTML = modalidadesAtivas.map((chave, indice) => `
      <label class="choice-option"><input type="radio" name="modalidade" value="${escapar(chave)}" ${indice === 0 ? "checked" : ""} required>
        <span>${escapar(window.CatalogoUtils.MODALIDADES[chave])}</span></label>
    `).join("");
    $("pagamentoSelect").innerHTML = pagamentosAtivos.map((chave) => `
      <option value="${escapar(chave)}">${escapar(chave === "pix" ? "Pix online (QR Code e copia e cola)" : window.CatalogoUtils.FORMAS_PAGAMENTO[chave])}</option>
    `).join("");

    if (!pagamentosAtivos.length) {
      $("pagamentoSelect").innerHTML = '<option value="">Combine o pagamento com o comércio</option>';
    }

    const endereco = $("enderecoEntrega");
    const ajustarCampos = () => {
      const escolhida = document.querySelector('input[name="modalidade"]:checked')?.value || modalidadeInicial;
      const exige = escolhida === "entrega";
      endereco.hidden = !exige;
      ["endereco", "numero", "bairro"].forEach((nome) => {
        const campo = $("checkoutForm").elements.namedItem(nome);
        if (campo) campo.required = exige;
      });
    };
    document.querySelectorAll('input[name="modalidade"]').forEach((radio) => radio.addEventListener("change", ajustarCampos));
    ajustarCampos();
  }

  function lerCheckout() {
    const form = $("checkoutForm");
    const dados = new FormData(form);
    return {
      nome: String(dados.get("nome") || "").trim(),
      telefone: String(dados.get("telefone") || "").trim(),
      email: String(dados.get("email") || "").trim().toLowerCase(),
      modalidade: String(dados.get("modalidade") || ""),
      pagamento: String(dados.get("pagamento") || ""),
      endereco: String(dados.get("endereco") || "").trim(),
      numero: String(dados.get("numero") || "").trim(),
      bairro: String(dados.get("bairro") || "").trim(),
      complemento: String(dados.get("complemento") || "").trim(),
      referencia: String(dados.get("referencia") || "").trim(),
      cidade: "Andrelândia-MG",
      observacoes: String(dados.get("observacoes") || "").trim(),
    };
  }

  function renderizarResumo(pedido) {
    const items = pedido.itens.map((item) => `
      <li>${Number(item.quantidade)}× ${escapar(item.nome)} — ${window.CatalogoUtils.formatarMoeda(window.CatalogoUtils.calcularTotal([item]))}</li>
    `).join("");
    const modalidade = window.CatalogoUtils.MODALIDADES[pedido.modalidade] || pedido.modalidade;
    const pagamento = window.CatalogoUtils.FORMAS_PAGAMENTO[pedido.pagamento] || pedido.pagamento;
    const endereco = pedido.modalidade === "entrega"
      ? `<p><strong>Entrega:</strong><br>${[pedido.cliente.endereco, pedido.cliente.numero && `nº ${pedido.cliente.numero}`, pedido.cliente.complemento, pedido.cliente.bairro, pedido.cliente.referencia && `Referência: ${pedido.cliente.referencia}`, pedido.cliente.cidade].filter(Boolean).map(escapar).join("<br>")}</p>`
      : "";

    $("resumoPedido").innerHTML = `
      <h3>Itens</h3><ul class="review-items">${items}</ul>
      <div class="review-total"><span>Total dos produtos</span><strong>${window.CatalogoUtils.formatarMoeda(window.CatalogoUtils.calcularTotal(pedido.itens))}</strong></div>
      <p><strong>Cliente:</strong> ${escapar(pedido.cliente.nome)}<br><strong>Telefone:</strong> ${escapar(pedido.cliente.telefone)}<br><strong>E-mail:</strong> ${escapar(pedido.cliente.email)}</p>
      <p><strong>Modalidade:</strong> ${escapar(modalidade)}</p>${endereco}
      <p><strong>Pagamento:</strong> ${escapar(pagamento)}</p>
      ${pedido.observacoes ? `<p><strong>Observações:</strong> ${escapar(pedido.observacoes)}</p>` : ""}
    `;
  }

  function chavePedidoOfflineSalvo() { return `guia-offline-order:${comercioId}`; }
  function chaveComprovanteArquivado() { return `guia-offline-receipt:${comercioId}`; }
  function pedidoEmRevisaoValido(pedido = pedidoEmRevisao) {
    return Boolean(pedido && Array.isArray(pedido.itens) && pedido.itens.length
      && pedido.cliente && String(pedido.cliente.nome || "").trim()
      && String(pedido.cliente.telefone || "").trim()
      && String(pedido.modalidade || "").trim());
  }
  function tokenStatusValido(token) { return STATUS_TOKEN_RE.test(String(token || "").trim()); }
  function comprovanteEhPix(salvo) { return PROVEDORES_PIX.has(String(salvo?.provedor || "").trim().toLowerCase()); }
  function statusComprovante(salvo) { return String(salvo?.status || "").trim().toLowerCase(); }
  function statusPagamentoComprovante(salvo) { return String(salvo?.status_pagamento || "").trim().toLowerCase(); }
  function comprovanteTerminal(salvo) {
    return STATUS_TERMINAIS_SEM_ACAO.has(statusComprovante(salvo))
      || STATUS_TERMINAIS_SEM_ACAO.has(statusPagamentoComprovante(salvo));
  }
  function pagamentoPixAprovado(salvo) {
    return comprovanteEhPix(salvo) && ["aprovado", "approved"].includes(statusPagamentoComprovante(salvo));
  }
  function normalizarQrPix(valor) {
    const qr = String(valor || "").trim();
    if (!qr || qr.length > 100000) return "";
    if (/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=_-]+$/i.test(qr)) return qr;
    return /^[a-z0-9+/=_-]+$/i.test(qr) ? qr : "";
  }
  function ticketMercadoPagoValido(valor) {
    const ticket = String(valor || "").trim();
    if (!ticket) return "";
    try {
      const URLCtor = window.URL || (typeof URL === "function" ? URL : null);
      if (!URLCtor) return "";
      const url = new URLCtor(ticket);
      const host = String(url.hostname || "").toLowerCase();
      const mercadoPago = host === "mercadopago.com" || host.endsWith(".mercadopago.com")
        || host === "mercadopago.com.br" || host.endsWith(".mercadopago.com.br");
      return url.protocol === "https:" && mercadoPago ? url.href : "";
    } catch {
      return "";
    }
  }
  function normalizarComprovanteSalvo(salvo) {
    if (!salvo || typeof salvo !== "object" || Array.isArray(salvo)) return null;
    if (!salvo.pedido_id || !Number.isFinite(Date.parse(salvo.codigo_expira_em))) return null;
    const provedorBruto = String(salvo.provedor || "offline").trim().toLowerCase();
    if (!["offline", ...PROVEDORES_PIX].includes(provedorBruto)) return null;
    const pixAprovado = PROVEDORES_PIX.has(provedorBruto) && ["aprovado", "approved"].includes(String(salvo.status_pagamento || "").trim().toLowerCase());
    const codigoBruto = String(salvo.codigo_entrega || "");
    const codigo = PROVEDORES_PIX.has(provedorBruto) && (!pixAprovado || salvo.codigo_ativo !== true) ? "" : codigoBruto;
    const semCodigoPermitido = salvo.concluido === true || String(salvo.status || "") === "entregue"
      || STATUS_TOKEN_RE.test(String(salvo.status_token || ""));
    if (codigo && !/^\d{6}$/.test(codigo)) return null;
    if (!codigo && !semCodigoPermitido) return null;
    const comprovante = {
      pedido_id: String(salvo.pedido_id),
      codigo_entrega: codigo,
      codigo_expira_em: String(salvo.codigo_expira_em),
      provedor: provedorBruto,
    };
    // Comprovantes antigos não têm status_token. Preserve tokens legados sem
    // permitir que um valor arbitrário seja enviado como token de leitura.
    if (typeof salvo.status_token === "string" && STATUS_TOKEN_RE.test(salvo.status_token.trim())) {
      comprovante.status_token = salvo.status_token.trim();
    }
    for (const campo of ["status", "status_pagamento"]) {
      if (typeof salvo[campo] === "string" && salvo[campo].trim()) comprovante[campo] = salvo[campo].trim().toLowerCase();
    }
    for (const campo of ["aceito_em", "reembolso_pendente", "codigo_ativo", "concluido", "revisao_financeira"]) {
      if (typeof salvo[campo] === "boolean" || (campo === "aceito_em" && salvo[campo])) comprovante[campo] = salvo[campo];
    }
    if (comprovanteEhPix(comprovante)) {
      const pixCodigo = String(salvo.pix_codigo || "").trim();
      const qr = normalizarQrPix(salvo.pix_qr_code_base64);
      const ticket = ticketMercadoPagoValido(salvo.ticket_url);
      if (pixCodigo && pixCodigo.length <= 10000) comprovante.pix_codigo = pixCodigo;
      if (qr) comprovante.pix_qr_code_base64 = qr;
      if (ticket) comprovante.ticket_url = ticket;
    }
    return comprovante;
  }
  function comprovanteExpirado(salvo) {
    const expiraEm = Date.parse(salvo?.codigo_expira_em || "");
    return Number.isFinite(expiraEm) && expiraEm <= Date.now();
  }
  function salvarComprovanteOffline(comprovante) {
    const normalizado = normalizarComprovanteSalvo(comprovante);
    if (!normalizado) return;
    comprovanteOfflineMemoria = normalizado;
    comprovanteOfflineVersao += 1;
    try { localStorage.setItem(chavePedidoOfflineSalvo(), JSON.stringify(normalizado)); } catch { /* fica disponível na tela */ }
  }
  function arquivarComprovanteOffline(comprovante) {
    const normalizado = normalizarComprovanteSalvo({ ...comprovante, codigo_entrega: "", concluido: true, codigo_ativo: false });
    if (!normalizado) return;
    try { localStorage.setItem(chaveComprovanteArquivado(), JSON.stringify(normalizado)); } catch { /* preserva em memória quando possível */ }
  }
  function lerPedidoOfflineSalvo() {
    let salvo = null;
    try {
      salvo = normalizarComprovanteSalvo(JSON.parse(localStorage.getItem(chavePedidoOfflineSalvo()) || "null"));
      if (!salvo) salvo = normalizarComprovanteSalvo(JSON.parse(localStorage.getItem(chaveComprovanteArquivado()) || "null"));
    } catch { salvo = comprovanteOfflineMemoria; }
    if (!salvo) salvo = comprovanteOfflineMemoria;
    if (!salvo) return null;
    if (comprovanteExpirado(salvo) && salvo.concluido !== true) {
      // Expira somente o segredo de entrega: mantém o pedido e o token para acompanhar baixa/reembolso.
      if (tokenStatusValido(salvo.status_token)) {
        const semCodigo = { ...salvo, codigo_entrega: "", codigo_ativo: false };
        if (salvo.codigo_entrega) salvarComprovanteOffline(semCodigo);
        return semCodigo;
      }
      try { localStorage.removeItem(chavePedidoOfflineSalvo()); } catch { /* comprovante legado sem recuperação */ }
      comprovanteOfflineMemoria = null;
      comprovanteOfflineVersao += 1;
      return null;
    }
    return salvo;
  }
  function comprovanteAindaAtual(salvo, versao) {
    if (!salvo || versao !== comprovanteOfflineVersao) return false;
    const atual = lerPedidoOfflineSalvo();
    return Boolean(atual && atual.pedido_id === salvo.pedido_id
      && atual.codigo_entrega === salvo.codigo_entrega
      && atual.codigo_expira_em === salvo.codigo_expira_em
      && (atual.status_token || "") === (salvo.status_token || ""));
  }
  function atualizarAvisoStatusOffline(mostrar, texto) {
    statusOfflineAviso = Boolean(mostrar);
    const aviso = $("offlinePedidoStatusAviso");
    if (aviso) {
      aviso.textContent = texto || "Não foi possível consultar o status agora. O código continua salvo até a expiração indicada.";
      aviso.hidden = !statusOfflineAviso;
    }
    if (statusOfflineAviso && $("offlinePedidoStatus")) {
      $("offlinePedidoStatus").textContent = "Não foi possível consultar o status agora. O código continua salvo até a expiração indicada.";
    }
    if (statusOfflineAviso && $("pixPedidoBox") && !$("pixPedidoBox").hidden && $("pixPedidoStatus")) {
      $("pixPedidoStatus").textContent = texto || "Não foi possível consultar o status agora. O Pix continua disponível enquanto não expirar.";
    }
  }
  function comprovantePodeExibirCodigo(salvo) {
    if (!salvo?.codigo_entrega || salvo.codigo_ativo === false || salvo.concluido === true
      || comprovanteTerminal(salvo) || statusComprovante(salvo) === "entregue" || comprovanteExpirado(salvo)) return false;
    if (comprovanteEhPix(salvo)) return pagamentoPixAprovado(salvo) && salvo.codigo_ativo === true;
    return true;
  }
  function atualizarTextoExpiracao(salvo) {
    const expiraEm = Date.parse(salvo?.codigo_expira_em || "");
    const formatado = Number.isFinite(expiraEm)
      ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(expiraEm))
      : "";
    const expirado = comprovanteExpirado(salvo);
    const offlineExpiracao = $("offlinePedidoExpiracao");
    if (offlineExpiracao) {
      offlineExpiracao.textContent = formatado
        ? `${expirado ? "Código expirado em" : "Código de entrega expira em"} ${formatado}.`
        : "A validade do código será informada pelo comércio.";
    }
    const pixExpiracao = $("pixPedidoExpiracao");
    if (pixExpiracao) {
      pixExpiracao.textContent = formatado
        ? `${expirado ? "Este Pix expirou em" : "Este Pix expira em"} ${formatado}.`
        : "A validade deste Pix será informada pelo provedor.";
    }
  }
  function atualizarPixComprovante(salvo, exibir) {
    const box = $("pixPedidoBox");
    if (!box) return;
    box.hidden = !exibir;
    const codigo = String(salvo?.pix_codigo || "").trim();
    const textarea = $("pixPedidoCodigo");
    const label = $("pixPedidoCodigoLabel");
    const copiar = $("copiarPixPedido");
    if (textarea) {
      textarea.value = exibir ? codigo : "";
      textarea.hidden = !exibir || !codigo;
    }
    if (label) label.hidden = !exibir || !codigo;
    if (copiar) {
      copiar.disabled = !exibir || !codigo;
      copiar.hidden = !exibir || !codigo;
    }
    const qr = $("pixPedidoQr");
    const qrValue = normalizarQrPix(salvo?.pix_qr_code_base64);
    if (qr) {
      if (exibir && qrValue) {
        qr.src = /^data:image\//i.test(qrValue) ? qrValue : `data:image/png;base64,${qrValue}`;
        qr.hidden = false;
      } else {
        qr.src = "";
        qr.hidden = true;
      }
    }
    const ticket = $("abrirTicketPix");
    const ticketUrl = ticketMercadoPagoValido(salvo?.ticket_url);
    if (ticket) {
      ticket.href = exibir && ticketUrl ? ticketUrl : "";
      ticket.hidden = !exibir || !ticketUrl;
    }
    if (exibir && $("pixPedidoStatus")) {
      $("pixPedidoStatus").textContent = statusOfflineAviso
        ? "Não foi possível consultar o status agora. O Pix continua disponível enquanto não expirar."
        : codigo || qrValue || ticketUrl
          ? "Pix gerado. Conclua o pagamento pelo seu banco; a geração não confirma o pagamento."
          : "Pix registrado. Aguarde os dados do provedor ou tente consultar novamente.";
    }
  }
  function documentoVisivel() {
    return typeof document.visibilityState !== "string" || document.visibilityState === "visible";
  }
  function cancelarConsultaStatusOffline() {
    if (consultaStatusOfflineTimer !== null) window.clearTimeout(consultaStatusOfflineTimer);
    consultaStatusOfflineTimer = null;
    consultaStatusOfflineEmAndamento = null;
    consultaStatusOfflineChave = "";
    contextoConsultaStatusOffline = null;
  }
  function agendarConsultaStatusOffline(salvo, atraso = INTERVALO_STATUS_OFFLINE) {
    if (!salvo || !documentoVisivel() || consultaStatusOfflineTimer !== null || comprovanteTerminal(salvo) || comprovanteExpirado(salvo)) return;
    consultaStatusOfflineTimer = window.setTimeout(() => {
      consultaStatusOfflineTimer = null;
      consultarStatusOffline(salvo);
    }, atraso);
  }
  function atualizarAcoesComprovante(apenasComprovante = false) {
    const temRevisao = pedidoEmRevisaoValido() && !apenasComprovante;
    const whatsapp = $("enviarWhatsApp");
    if (whatsapp) whatsapp.hidden = !temRevisao || !podePedir;
    const resumo = $("resumoPedido");
    const instrucao = $("confirmarPedidoInstrucao");
    const voltar = $("voltarCheckout");
    if (resumo) resumo.hidden = apenasComprovante;
    if (instrucao) instrucao.hidden = apenasComprovante;
    if (voltar) voltar.hidden = apenasComprovante;
  }
  function mostrarComprovanteOffline(salvo, opcoes = {}) {
    const apenasComprovante = opcoes.somenteComprovante === true || !pedidoEmRevisaoValido();
    dialogoSomenteComprovante = apenasComprovante;
    const podeExibir = comprovantePodeExibirCodigo(salvo);
    const expirado = comprovanteExpirado(salvo);
    const terminal = comprovanteTerminal(salvo);
    const pixAprovado = pagamentoPixAprovado(salvo);
    const exibirPix = comprovanteEhPix(salvo) && !pixAprovado && !terminal && !expirado;
    const status = expirado || ["expirado", "expired"].includes(statusComprovante(salvo))
      ? "Este pedido expirou. Não é possível gerar um novo pagamento por este comprovante."
      : terminal
        ? "Pedido cancelado. Se o Pix tiver sido aprovado, o reembolso permanece pendente de confirmação."
        : exibirPix
          ? "Pix pendente. Conclua o pagamento pelo seu banco; a geração não confirma o pagamento."
        : pixAprovado && !podeExibir
          ? (salvo.revisao_financeira === true ? "Pagamento aprovado. O código aguarda a conferência financeira; entre em contato com o comércio." : "Pagamento aprovado. Aguardando a liberação do código de entrega.")
        : salvo.concluido === true
          ? "Pedido concluído. O código foi removido; o comprovante permanece salvo neste dispositivo."
            : statusOfflineAviso
            ? "Não foi possível consultar o status agora. O código continua salvo até a expiração indicada."
            : "Mostre este código ao entregador somente no momento da entrega.";
    if ($("offlinePedidoStatus")) $("offlinePedidoStatus").textContent = status;
    if ($("offlinePedidoCodigo")) $("offlinePedidoCodigo").textContent = podeExibir ? salvo.codigo_entrega : "";
    if ($("offlinePedidoBox")) $("offlinePedidoBox").hidden = exibirPix;
    if ($("copiarCodigoOffline")) {
      $("copiarCodigoOffline").hidden = !podeExibir;
      $("copiarCodigoOffline").disabled = !podeExibir;
    }
    atualizarTextoExpiracao(salvo);
    atualizarPixComprovante(salvo, exibirPix);
    if ($("pagarPix")) {
      // A geração só pertence a uma revisão nova; reabrir um comprovante nunca cria cobrança.
      $("pagarPix").hidden = true;
      $("pagarPix").disabled = true;
    }
    if ($("criarPedidoOffline")) $("criarPedidoOffline").hidden = true;
    atualizarBotoesCancelamento(salvo);
    atualizarAcoesComprovante(apenasComprovante);
  }
  function concluirComprovanteOffline(salvo) {
    if (!comprovanteAindaAtual(salvo, comprovanteOfflineVersao)) return;
    arquivarComprovanteOffline(salvo);
    try { localStorage.removeItem(chavePedidoOfflineSalvo()); } catch { /* armazenamento indisponível */ }
    comprovanteOfflineMemoria = null;
    comprovanteOfflineVersao += 1;
    cancelarConsultaStatusOffline();
    statusOfflineAviso = false;
    const aviso = $("offlinePedidoStatusAviso");
    if (aviso) aviso.hidden = true;
    if ($("offlinePedidoRecente")) $("offlinePedidoRecente").hidden = true;
    if ($("offlinePedidoBox")) $("offlinePedidoBox").hidden = true;
    if ($("offlinePedidoCodigo")) $("offlinePedidoCodigo").textContent = "";
    if (dialogoSomenteComprovante && !pedidoEmRevisaoValido() && $("confirmarPedidoDialog")?.open) {
      $("confirmarPedidoDialog").close();
    }
  }
  function mesclarStatusComprovante(salvo, data) {
    const proximo = { ...salvo };
    const terminalAtual = salvo.concluido === true || comprovanteTerminal(salvo) || statusComprovante(salvo) === "entregue";
    const respostaTerminal = data.concluido === true || STATUS_TERMINAIS_SEM_ACAO.has(String(data.status || "").trim().toLowerCase()) || String(data.status || "").trim().toLowerCase() === "entregue";
    if (terminalAtual && !respostaTerminal) return proximo;
    for (const campo of ["status", "status_pagamento", "aceito_em", "codigo_expira_em"]) {
      if (typeof data[campo] === "string" && data[campo].trim()) proximo[campo] = campo === "aceito_em" || campo === "codigo_expira_em"
        ? data[campo].trim() : data[campo].trim().toLowerCase();
    }
    if (typeof data.provedor === "string" && PROVEDORES_PIX.has(data.provedor.trim().toLowerCase())) {
      proximo.provedor = data.provedor.trim().toLowerCase();
    }
    for (const campo of ["reembolso_pendente", "codigo_ativo", "concluido", "revisao_financeira"]) {
      if (typeof data[campo] === "boolean") {
        proximo[campo] = data[campo];
        if (campo === "codigo_ativo" && data[campo] === false) proximo.codigo_entrega = "";
      }
    }
    if (tokenStatusValido(salvo.status_token) && /^\d{6}$/.test(String(data.codigo_entrega || ""))) {
      proximo.codigo_entrega = String(data.codigo_entrega);
    }
    if (comprovanteEhPix(proximo)) {
      const pixCodigo = String(data.pix_codigo || "").trim();
      const qr = normalizarQrPix(data.pix_qr_code_base64);
      const ticket = ticketMercadoPagoValido(data.ticket_url);
      if (pixCodigo && pixCodigo.length <= 10000) proximo.pix_codigo = pixCodigo;
      if (qr) proximo.pix_qr_code_base64 = qr;
      if (ticket) proximo.ticket_url = ticket;
    }
    return proximo;
  }
  const MENSAGEM_CANCELAMENTO_APOS_ACEITE = "seu pedido já esta sendo preparado pelo estabelecimento e não pode mais ser cancelado normalmente. caso exista um problema com o pedido entre em contato com o estabelecimento via WhatsApp.";
  function pedidoFoiAceito(salvo) {
    return Boolean(salvo?.aceito_em) || ["em_preparo", "pronto", "reservado", "coletado", "em_entrega"].includes(String(salvo?.status || ""));
  }
  function ocultarConfirmacaoCancelamento() {
    const caixa = $("cancelamentoConfirmacao");
    if (caixa) caixa.hidden = true;
  }
  function mostrarConfirmacaoCancelamento(salvo) {
    const caixa = $("cancelamentoConfirmacao");
    const mensagem = $("cancelamentoMensagem");
    if (!caixa || !mensagem) return;
    const aceito = pedidoFoiAceito(salvo);
    mensagem.textContent = aceito ? MENSAGEM_CANCELAMENTO_APOS_ACEITE : "Tem certeza que quer cancelar o pedido?";
    caixa.hidden = false;
    const confirmar = $("confirmarCancelamentoOffline");
    if (confirmar) confirmar.hidden = aceito;
    const whatsapp = $("cancelamentoWhatsApp");
    if (whatsapp) {
      whatsapp.hidden = !aceito || !podePedir;
      if (aceito && podePedir) {
        try { whatsapp.href = window.CatalogoUtils.gerarLinkWhatsApp(telefonePedido, "Olá! Preciso de ajuda com meu pedido."); } catch { whatsapp.hidden = true; }
      }
    }
  }
  function atualizarBotoesCancelamento(salvo) {
    const permitido = Boolean(salvo && tokenStatusValido(salvo.status_token) && salvo.concluido !== true
      && !comprovanteTerminal(salvo) && !comprovanteExpirado(salvo));
    for (const id of ["cancelarPedidoOffline", "cancelarPedidoNoDialog"]) {
      const botao = $(id);
      if (botao) botao.hidden = !permitido;
    }
  }
  function cancelarPedidoComToken() {
    const salvo = lerPedidoOfflineSalvo();
    if (!salvo || !tokenStatusValido(salvo.status_token)) return;
    mostrarConfirmacaoCancelamento(salvo);
  }
  async function confirmarCancelamentoOffline() {
    const salvo = lerPedidoOfflineSalvo();
    if (!salvo || !tokenStatusValido(salvo.status_token) || pedidoFoiAceito(salvo)) return;
    const botao = $("confirmarCancelamentoOffline");
    if (botao) botao.disabled = true;
    cancelarConsultaStatusOffline();
    comprovanteOfflineVersao += 1;
    try {
      const { data, error } = await clienteSupabase().functions.invoke("catalogo-pedido-offline", { body: {
        acao: "cancelar_pedido", pedido_id: salvo.pedido_id, comercio_id: comercioId,
        status_token: salvo.status_token, motivo: "Cancelado pelo comprador.",
      } });
      if (error || !data?.success) throw new Error(data?.mensagem || "Não foi possível cancelar o pedido.");
      const atualizado = mesclarStatusComprovante(salvo, data);
      atualizado.status = String(data.status || "cancelado");
      atualizado.codigo_ativo = false;
      salvarComprovanteOffline(atualizado);
      ocultarConfirmacaoCancelamento();
      mostrarComprovanteOffline(atualizado, { somenteComprovante: !pedidoEmRevisaoValido() });
      atualizarPedidoOfflineRecente();
    } catch (erro) {
      const mensagem = $("cancelamentoMensagem");
      if (mensagem) mensagem.textContent = erro.message || "Não foi possível cancelar o pedido.";
    } finally {
      if (botao) botao.disabled = false;
      atualizarPedidoOfflineRecente();
    }
  }
  async function consultarStatusOffline(salvo) {
    if (!salvo || !comercioId || !documentoVisivel() || comprovanteTerminal(salvo) || comprovanteExpirado(salvo)) return;
    const chave = `${salvo.pedido_id}:${salvo.codigo_expira_em}:${salvo.status_token || ""}`;
    if (consultaStatusOfflineEmAndamento && consultaStatusOfflineChave === chave) return consultaStatusOfflineEmAndamento;
    const versao = comprovanteOfflineVersao;
    const iniciadoEm = Date.now();
    const contexto = { pedido_id: salvo.pedido_id, iniciado_em: iniciadoEm, versao };
    contextoConsultaStatusOffline = contexto;
    const contextoAindaAtual = () => contextoConsultaStatusOffline === contexto
      && contexto.iniciado_em === iniciadoEm
      && contexto.pedido_id === salvo.pedido_id
      && comprovanteAindaAtual(salvo, versao);
    const tarefa = (async () => {
      try {
        const corpo = { acao: "consultar_status", pedido_id: salvo.pedido_id, comercio_id: comercioId };
        if (tokenStatusValido(salvo.status_token)) corpo.status_token = salvo.status_token;
        const resposta = await clienteSupabase().functions.invoke("catalogo-pedido-offline", { body: corpo });
        if (!contextoAindaAtual()) return;
        const data = resposta?.data;
        if (resposta?.error || !data?.success || String(data.pedido_id || "") !== String(salvo.pedido_id)) {
          atualizarAvisoStatusOffline(true);
          agendarConsultaStatusOffline(salvo);
          return;
        }
        const atualizado = mesclarStatusComprovante(salvo, data);
        if (JSON.stringify(atualizado) !== JSON.stringify(salvo)) salvarComprovanteOffline(atualizado);
        const atual = lerPedidoOfflineSalvo() || atualizado;
        atualizarAvisoStatusOffline(false);
        if ($("confirmarPedidoDialog")?.open && atual.pedido_id === salvo.pedido_id) {
          mostrarComprovanteOffline(atual, { somenteComprovante: dialogoSomenteComprovante });
        }
        if (data.concluido === true || String(data.status || "").trim().toLowerCase() === "entregue") {
          concluirComprovanteOffline(atual);
          return;
        }
        if (comprovanteTerminal(atual) || comprovanteExpirado(atual)) return;
        agendarConsultaStatusOffline(atual);
      } catch {
        if (!contextoAindaAtual()) return;
        atualizarAvisoStatusOffline(true);
        agendarConsultaStatusOffline(salvo);
      }
    })();
    consultaStatusOfflineChave = chave;
    consultaStatusOfflineEmAndamento = tarefa;
    tarefa.finally(() => {
      if (consultaStatusOfflineChave === chave) {
        consultaStatusOfflineEmAndamento = null;
        consultaStatusOfflineChave = "";
      }
      if (contextoConsultaStatusOffline === contexto) contextoConsultaStatusOffline = null;
    });
    return tarefa;
  }
  function atualizarPedidoOfflineRecente() {
    const salvo = lerPedidoOfflineSalvo();
    const aviso = $("offlinePedidoRecente");
    if (!salvo) {
      aviso.hidden = true;
      cancelarConsultaStatusOffline();
      return;
    }
    if (salvo.concluido === true || salvo.status === "entregue") {
      aviso.hidden = true;
      cancelarConsultaStatusOffline();
      return;
    }
    aviso.hidden = false;
    atualizarBotoesCancelamento(salvo);
    const botaoAbrir = $("abrirPedidoOfflineSalvo");
    if (botaoAbrir) botaoAbrir.textContent = salvo.status === "cancelado" || comprovanteExpirado(salvo)
      ? "Consultar situação do pedido" : "Ver código do pedido";
    if (botaoAbrir) botaoAbrir.onclick = () => {
      const atual = lerPedidoOfflineSalvo();
      if (!atual) { atualizarPedidoOfflineRecente(); return; }
      mostrarComprovanteOffline(atual, { somenteComprovante: !pedidoEmRevisaoValido() });
      if ($("confirmarPedidoDialog") && !$("confirmarPedidoDialog").open) $("confirmarPedidoDialog").showModal();
      consultarStatusOffline(atual);
    };
    const avisoAnterior = statusOfflineAviso;
    atualizarAvisoStatusOffline(avisoAnterior);
    if (!comprovanteTerminal(salvo) && !comprovanteExpirado(salvo)) consultarStatusOffline(salvo);
  }

  async function criarPedidoOffline() {
    if (!pedidoEmRevisao || !comercioId || !clienteSupabase()) return;
    const botao = $("criarPedidoOffline");
    botao.disabled = true;
    $("offlinePedidoStatus").textContent = "Validando produtos e registrando o pedido…";
    $("offlinePedidoBox").hidden = false;
    try {
      const { data, error } = await clienteSupabase().functions.invoke("catalogo-pedido-offline", { body: {
        acao: "criar_pedido_offline", comercio_id: comercioId, forma_pagamento: pedidoEmRevisao.pagamento,
        itens: pedidoEmRevisao.itens.map((item) => ({ id: String(item.id), quantidade: Number(item.quantidade) })),
        cliente: pedidoEmRevisao.cliente, modalidade: pedidoEmRevisao.modalidade, observacoes: pedidoEmRevisao.observacoes,
      } });
      if (error || !data?.success) throw new Error(data?.mensagem || "Não foi possível registrar o pedido.");
      const comprovante = { pedido_id: data.pedido_id, codigo_entrega: data.codigo_entrega, codigo_expira_em: data.codigo_expira_em, provedor: "offline", status: data.status || "aguardando_pagamento", status_pagamento: data.status_pagamento || "pendente", codigo_ativo: data.codigo_ativo !== false, concluido: data.concluido === true, reembolso_pendente: data.reembolso_pendente === true };
      if (tokenStatusValido(data.status_token)) comprovante.status_token = String(data.status_token).trim();
      statusOfflineAviso = false;
      salvarComprovanteOffline(comprovante);
      mostrarComprovanteOffline(comprovante);
      atualizarPedidoOfflineRecente();
      botao.hidden = true;
      botao.disabled = true;
      atualizarAcoesComprovante(false);
      carrinho = {}; salvarCarrinho(); renderizarSacola();
    } catch (error) { $("offlinePedidoStatus").textContent = error.message || "Não foi possível registrar o pedido."; botao.disabled = false; }
  }

  async function gerarPixPedido() {
    if (!pedidoEmRevisao || pedidoEmRevisao.pixGerado === true || !comercioId || !clienteSupabase()) return;
    const botao = $("pagarPix");
    const box = $("pixPedidoBox");
    botao.disabled = true;
    $("pixPedidoStatus").textContent = "Validando produtos e preparando o Pix…";
    box.hidden = false;
    try {
      pedidoEmRevisao.pixRequestId = pedidoEmRevisao.pixRequestId || crypto.randomUUID();
      const { data, error } = await clienteSupabase().functions.invoke("catalogo-pedido-pix", {
        body: {
          comercio_id: comercioId,
          request_id: pedidoEmRevisao.pixRequestId,
          itens: pedidoEmRevisao.itens.map((item) => ({ id: String(item.id), quantidade: Number(item.quantidade) })),
          cliente: pedidoEmRevisao.cliente,
          modalidade: pedidoEmRevisao.modalidade,
          observacoes: pedidoEmRevisao.observacoes,
        },
      });
      if (error || !data?.success) throw new Error(data?.mensagem || "Não foi possível gerar o Pix.");
      pedidoEmRevisao = { ...pedidoEmRevisao, pixGerado: true };
      const pixReceipt = {
        pedido_id: data.pedido_id,
        // A criação do Pix não prova baixa nem libera o segredo de entrega.
        codigo_entrega: "",
        codigo_expira_em: data.codigo_expira_em || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        provedor: PROVEDORES_PIX.has(String(data.provedor || "").trim().toLowerCase()) ? String(data.provedor).trim().toLowerCase() : "pix",
        status: data.status || "aguardando_pagamento",
        status_pagamento: data.status_pagamento || "pendente",
        codigo_ativo: false,
        concluido: false,
        reembolso_pendente: false,
        pix_codigo: String(data.pix_codigo || "").trim(),
        pix_qr_code_base64: normalizarQrPix(data.pix_qr_code_base64),
        ticket_url: ticketMercadoPagoValido(data.ticket_url),
      };
      if (tokenStatusValido(data.status_token)) pixReceipt.status_token = String(data.status_token).trim();
      if (pixReceipt.pedido_id && tokenStatusValido(pixReceipt.status_token)) {
        salvarComprovanteOffline(pixReceipt);
        atualizarPedidoOfflineRecente();
        consultarStatusOffline(pixReceipt);
      }
      statusOfflineAviso = false;
      mostrarComprovanteOffline(normalizarComprovanteSalvo(pixReceipt) || pixReceipt);
      botao.hidden = true;
      botao.disabled = true;
      atualizarAcoesComprovante(false);
    } catch (error) {
      box.hidden = false;
      $("pixPedidoStatus").textContent = error.message || "Não foi possível gerar o Pix.";
      botao.disabled = false;
    }
  }

  async function carregarCatalogo() {
    $("voltarPerfil").href = comercioId ? `local.html?id=${encodeURIComponent(comercioId)}` : "../index.html";
    if (!comercioId) {
      mostrarEstado("Catálogo digital indisponível", "O endereço do comércio não foi informado.");
      return;
    }

    const supabase = clienteSupabase();
    if (!supabase) {
      mostrarEstado("Não foi possível carregar o catálogo", "Tente novamente mais tarde.");
      return;
    }

    try {
      const { data: estadoCatalogo, error: erroEstado } = await supabase
        .from("catalogo_publicado")
        .select("comercio_id, modalidades, metodos_pagamento")
        .eq("comercio_id", comercioId)
        .maybeSingle();
      if (erroEstado) throw erroEstado;
      if (!estadoCatalogo) {
        mostrarEstado("Catálogo digital indisponível", "Este comércio ainda não conectou uma conta Mercado Pago ou está temporariamente indisponível.");
        return;
      }

      const respostaComercios = await fetch("../DATA/comercios.json", { cache: "no-store" });
      if (!respostaComercios.ok) throw new Error("Não foi possível consultar os dados do comércio.");
      const comercios = await respostaComercios.json();
      comercio = Array.isArray(comercios) ? comercios.find((item) => String(item.id) === comercioId) : null;
      if (!comercio || String(comercio.status || "").toLowerCase() !== "ativo") {
        mostrarEstado("Catálogo digital indisponível", "O perfil deste comércio não está disponível publicamente.");
        return;
      }
      catalogo = estadoCatalogo;

      const [{ data: dadosCategorias, error: erroCategorias }, { data: dadosProdutos, error: erroProdutos }] = await Promise.all([
        supabase.from("catalogo_categorias").select("id,nome,ordem,ativa,deletado_em").eq("comercio_id", comercioId).eq("ativa", true).is("deletado_em", null).order("ordem", { ascending: true }),
        supabase.from("catalogo_produtos").select("id,categoria_id,nome,descricao,preco,imagem,disponivel,ordem,deletado_em").eq("comercio_id", comercioId).eq("disponivel", true).is("deletado_em", null).order("ordem", { ascending: true }),
      ]);
      if (erroCategorias) throw erroCategorias;
      if (erroProdutos) throw erroProdutos;
      categorias = Array.isArray(dadosCategorias) ? dadosCategorias : [];
      produtos = (Array.isArray(dadosProdutos) ? dadosProdutos : []).filter((produto) => categorias.some((categoria) => String(categoria.id) === String(produto.categoria_id)));

      $("fotoComercio").src = comercio.imagem || comercio.imagens?.[0] || IMAGEM_PADRAO;
      $("fotoComercio").alt = `Foto de ${comercio.nome || "comércio"}`;
      $("fotoComercio").addEventListener("error", () => { $("fotoComercio").src = IMAGEM_PADRAO; }, { once: true });
      $("nomeComercio").textContent = comercio.nome || "Comércio local";
      $("descricaoComercio").textContent = comercio.descricao || "Conheça os produtos deste comércio de Andrelândia.";
      $("enderecoComercio").textContent = comercio.endereco || "Andrelândia — MG";

      podePedir = false;
      telefonePedido = "";
      let linkWhatsApp = "";
      for (const telefone of [comercio.whatsapp, comercio.telefone]) {
        if (!telefone) continue;
        try {
          linkWhatsApp = window.CatalogoUtils.gerarLinkWhatsApp(telefone, `Olá! Encontrei ${comercio.nome} pelo Guia Turístico de Andrelândia.`);
          telefonePedido = String(telefone);
          podePedir = true;
          break;
        } catch { /* Tenta o telefone alternativo, se houver. */ }
      }
      $("whatsappComercio").hidden = !podePedir;
      if (podePedir) $("whatsappComercio").href = linkWhatsApp;
      $("whatsappInvalido").hidden = podePedir;

      carregarCarrinhoSalvo();
      renderizarCategorias();
      renderizarProdutos();
      renderizarSacola();
      preencherCheckout();
      atualizarPedidoOfflineRecente();
      $("catalogoAviso").hidden = true;
      $("catalogoConteudo").hidden = false;
    } catch (erro) {
      console.error("Erro ao carregar catálogo:", erro);
      mostrarEstado("Não foi possível carregar o catálogo", "Tente novamente em alguns instantes.");
    }
  }

  function mostrarErroWhatsApp(mensagem) {
    const erro = $("whatsappErro");
    if (erro) {
      erro.textContent = mensagem;
      erro.hidden = false;
    }
  }
  function navegarWhatsApp(link) {
    if (window.location && typeof window.location.assign === "function") {
      window.location.assign(link);
      return;
    }
    const ancora = document.createElement("a");
    ancora.href = link;
    ancora.target = "_self";
    ancora.rel = "noopener noreferrer";
    ancora.textContent = "Continuar pelo WhatsApp";
    ancora.dataset.whatsapp = "navegacao";
    document.body.appendChild(ancora);
    ancora.click();
    ancora.remove();
  }

  function configurarEventos() {
    $("categoriasNav").addEventListener("click", (event) => {
      const botao = event.target.closest("[data-category]");
      if (!botao) return;
      categoriaSelecionada = botao.dataset.category;
      renderizarCategorias();
      renderizarProdutos();
    });

    $("produtosGrid").addEventListener("click", (event) => {
      const botao = event.target.closest("[data-add]");
      if (!botao || !podePedir) return;
      carrinho = window.CatalogoUtils.atualizarQuantidade(carrinho, botao.dataset.add, 1, produtos.map((produto) => produto.id));
      salvarCarrinho();
      renderizarSacola();
      botao.textContent = "Adicionado";
      window.setTimeout(() => { if (botao.isConnected) botao.textContent = "Adicionar"; }, 850);
    });

    $("cartItems").addEventListener("click", (event) => {
      const botao = event.target.closest("[data-change]");
      if (!botao) return;
      carrinho = window.CatalogoUtils.atualizarQuantidade(carrinho, botao.dataset.id, Number(botao.dataset.change), produtos.map((produto) => produto.id));
      salvarCarrinho();
      renderizarSacola();
    });

    $("abrirCarrinho").addEventListener("click", abrirSacola);
    $("fecharCarrinho").addEventListener("click", fecharSacola);
    $("cartBackdrop").addEventListener("click", fecharSacola);
    $("limparCarrinho").addEventListener("click", () => {
      carrinho = {};
      salvarCarrinho();
      renderizarSacola();
    });

    $("irCheckout").addEventListener("click", () => {
      if (!itensCarrinho().length) return;
      fecharSacola();
      $("checkoutErro").hidden = true;
      $("checkoutDialog").showModal();
    });

    $("checkoutForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const cliente = lerCheckout();
      if (cliente.modalidade === "entrega" && (!cliente.endereco || !cliente.numero || !cliente.bairro)) {
        $("checkoutErro").textContent = "Para entrega, informe endereço, número e bairro.";
        $("checkoutErro").hidden = false;
        return;
      }
      if (!cliente.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(cliente.email)) {
        $("checkoutErro").textContent = "Informe um e-mail válido para gerar o Pix.";
        $("checkoutErro").hidden = false;
        return;
      }
      if (!cliente.pagamento) {
        $("checkoutErro").textContent = "Este comércio ainda não configurou uma forma de pagamento; entre em contato pelo WhatsApp.";
        $("checkoutErro").hidden = false;
        return;
      }
      pedidoEmRevisao = { itens: itensCarrinho(), cliente, modalidade: cliente.modalidade, pagamento: cliente.pagamento, observacoes: cliente.observacoes, pixGerado: false };
      renderizarResumo(pedidoEmRevisao);
      $("checkoutDialog").close();
      $("confirmarPedidoDialog").showModal();
      dialogoSomenteComprovante = false;
      if ($("resumoPedido")) $("resumoPedido").hidden = false;
      if ($("confirmarPedidoInstrucao")) $("confirmarPedidoInstrucao").hidden = false;
      if ($("whatsappErro")) $("whatsappErro").hidden = true;
      const offline = cliente.pagamento !== "pix";
      $("pagarPix").hidden = offline;
      $("pagarPix").disabled = false;
      $("criarPedidoOffline").hidden = !offline;
      $("pixPedidoBox").hidden = true;
      $("offlinePedidoBox").hidden = true;
      atualizarPixComprovante({}, false);
      if ($("copiarCodigoOffline")) {
        $("copiarCodigoOffline").hidden = true;
        $("copiarCodigoOffline").disabled = true;
      }
      atualizarAcoesComprovante(false);
      atualizarPedidoOfflineRecente();
    });

    $("voltarCheckout").addEventListener("click", () => {
      $("confirmarPedidoDialog").close();
      $("checkoutDialog").showModal();
    });

    $("pagarPix").addEventListener("click", gerarPixPedido);
    $("criarPedidoOffline").addEventListener("click", criarPedidoOffline);
    $("copiarPixPedido").addEventListener("click", async () => {
      const codigo = $("pixPedidoCodigo").value;
      if (!codigo) return;
      await navigator.clipboard?.writeText(codigo);
      $("pixPedidoStatus").textContent = "Pix copiado. Conclua o pagamento pelo seu banco.";
    });
    $("copiarCodigoOffline").addEventListener("click", async () => {
      const codigo = $("offlinePedidoCodigo").textContent.trim();
      if (!codigo) return;
      await navigator.clipboard?.writeText(codigo);
      $("offlinePedidoStatus").textContent = "Código copiado. Mostre-o ao entregador somente no momento da entrega.";
    });
    if ($("cancelarPedidoOffline")) $("cancelarPedidoOffline").addEventListener("click", cancelarPedidoComToken);
    if ($("cancelarPedidoNoDialog")) $("cancelarPedidoNoDialog").addEventListener("click", cancelarPedidoComToken);
    if ($("confirmarCancelamentoOffline")) $("confirmarCancelamentoOffline").addEventListener("click", confirmarCancelamentoOffline);
    if ($("voltarCancelamentoOffline")) $("voltarCancelamentoOffline").addEventListener("click", ocultarConfirmacaoCancelamento);

    $("enviarWhatsApp").addEventListener("click", () => {
      if (!pedidoEmRevisaoValido() || !comercio) return;
      try {
        if (!podePedir) throw new Error("Este comércio ainda não possui um WhatsApp válido cadastrado para receber pedidos.");
        const numero = telefonePedido;
        const mensagem = window.CatalogoUtils.gerarMensagemPedido({
          comercio,
          itens: pedidoEmRevisao.itens,
          cliente: pedidoEmRevisao.cliente,
          modalidade: pedidoEmRevisao.modalidade,
          pagamento: pedidoEmRevisao.pagamento,
          observacoes: pedidoEmRevisao.observacoes,
          pixGerado: pedidoEmRevisao.pixGerado === true,
        });
        const link = window.CatalogoUtils.gerarLinkWhatsApp(numero, mensagem);
        navegarWhatsApp(link);
        if ($("confirmarPedidoDialog").open) $("confirmarPedidoDialog").close();
      } catch (erro) {
        mostrarErroWhatsApp(erro.message || "Não foi possível preparar a mensagem do WhatsApp.");
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        const salvo = lerPedidoOfflineSalvo();
        if (salvo) consultarStatusOffline(salvo);
      } else if (consultaStatusOfflineTimer !== null) {
        window.clearTimeout(consultaStatusOfflineTimer);
        consultaStatusOfflineTimer = null;
      }
    });
    window.addEventListener("pagehide", () => {
      // A resposta de uma aba que está saindo não pode limpar um comprovante
      // que o usuário já substituiu em outra navegação.
      comprovanteOfflineVersao += 1;
      cancelarConsultaStatusOffline();
    });

    document.querySelectorAll("[data-close-dialog]").forEach((botao) => {
      botao.addEventListener("click", () => $(botao.dataset.closeDialog).close());
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    configurarEventos();
    carregarCatalogo();
  });
})();
