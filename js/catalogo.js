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
  function lerPedidoOfflineSalvo() {
    try {
      const salvo = JSON.parse(localStorage.getItem(chavePedidoOfflineSalvo()) || "null");
      if (!salvo?.codigo_entrega || !salvo?.cliente_token || Date.parse(salvo.codigo_expira_em) <= Date.now()) {
        localStorage.removeItem(chavePedidoOfflineSalvo());
        return null;
      }
      return salvo;
    } catch { return null; }
  }
  function mostrarComprovanteOffline(salvo) {
    $("offlinePedidoStatus").textContent = "Mostre este código ao entregador somente no momento da entrega.";
    $("offlinePedidoCodigo").textContent = salvo.codigo_entrega;
    $("offlineConfirmLink").href = `pedido-offline.html?token=${encodeURIComponent(salvo.cliente_token)}`;
    $("offlineConfirmLink").hidden = false;
    $("offlinePedidoBox").hidden = false;
  }
  function atualizarPedidoOfflineRecente() {
    const salvo = lerPedidoOfflineSalvo();
    const aviso = $("offlinePedidoRecente");
    if (!salvo) { aviso.hidden = true; return; }
    aviso.hidden = false;
    $("abrirPedidoOfflineSalvo").onclick = () => {
      mostrarComprovanteOffline(salvo);
      if (!$("confirmarPedidoDialog").open) $("confirmarPedidoDialog").showModal();
    };
    $("limparPedidoOfflineSalvo").onclick = () => {
      localStorage.removeItem(chavePedidoOfflineSalvo());
      aviso.hidden = true;
    };
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
      const comprovante = { pedido_id: data.pedido_id, codigo_entrega: data.codigo_entrega, cliente_token: data.cliente_token, codigo_expira_em: data.codigo_expira_em };
      try { localStorage.setItem(chavePedidoOfflineSalvo(), JSON.stringify(comprovante)); } catch { /* O comprovante continua disponível nesta tela. */ }
      mostrarComprovanteOffline(comprovante);
      atualizarPedidoOfflineRecente();
      botao.hidden = true;
      $("enviarWhatsApp").hidden = true;
      carrinho = {}; salvarCarrinho(); renderizarSacola();
    } catch (error) { $("offlinePedidoStatus").textContent = error.message || "Não foi possível registrar o pedido."; botao.disabled = false; }
  }

  async function gerarPixPedido() {
    if (!pedidoEmRevisao || !comercioId || !clienteSupabase()) return;
    const botao = $("pagarPix");
    const box = $("pixPedidoBox");
    botao.disabled = true;
    $("pixPedidoStatus").textContent = "Validando produtos e preparando o Pix…";
    box.hidden = false;
    try {
      const { data, error } = await clienteSupabase().functions.invoke("catalogo-pedido-pix", {
        body: {
          comercio_id: comercioId,
          request_id: crypto.randomUUID(),
          itens: pedidoEmRevisao.itens.map((item) => ({ id: String(item.id), quantidade: Number(item.quantidade) })),
          cliente: pedidoEmRevisao.cliente,
          modalidade: pedidoEmRevisao.modalidade,
          observacoes: pedidoEmRevisao.observacoes,
        },
      });
      if (error || !data?.success) throw new Error(data?.mensagem || "Não foi possível gerar o Pix.");
      $("pixPedidoStatus").textContent = "Pix gerado. Conclua o pagamento pelo seu banco.";
      $("pixPedidoCodigo").value = data.pix_codigo || "";
      $("copiarPixPedido").disabled = !data.pix_codigo;
      if (data.pix_qr_code_base64) {
        $("pixPedidoQr").src = `data:image/png;base64,${data.pix_qr_code_base64}`;
        $("pixPedidoQr").hidden = false;
      }
      if (data.ticket_url) {
        $("abrirTicketPix").href = data.ticket_url;
        $("abrirTicketPix").hidden = false;
      }
      botao.hidden = true;
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
        mostrarEstado("Catálogo digital indisponível", "Este comércio ainda não tem uma assinatura ativa ou está temporariamente indisponível.");
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
      pedidoEmRevisao = { itens: itensCarrinho(), cliente, modalidade: cliente.modalidade, pagamento: cliente.pagamento, observacoes: cliente.observacoes };
      renderizarResumo(pedidoEmRevisao);
      $("checkoutDialog").close();
      $("confirmarPedidoDialog").showModal();
      const offline = cliente.pagamento !== "pix";
      $("pagarPix").hidden = offline;
      $("criarPedidoOffline").hidden = !offline;
      $("pixPedidoBox").hidden = true;
      $("offlinePedidoBox").hidden = true;
      $("enviarWhatsApp").hidden = false;
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

    $("enviarWhatsApp").addEventListener("click", () => {
      if (!pedidoEmRevisao || !comercio) return;
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
        });
        const link = window.CatalogoUtils.gerarLinkWhatsApp(numero, mensagem);
        window.open(link, "_blank", "noopener,noreferrer");
        $("confirmarPedidoDialog").close();
      } catch (erro) {
        $("catalogoErro").textContent = erro.message || "Não foi possível preparar a mensagem do WhatsApp.";
        $("catalogoErro").hidden = false;
      }
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
