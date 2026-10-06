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

  const modalidades = { entrega: "Entrega", retirada: "Retirada", consumo_local: "Consumo no local" };
  const pagamentos = {
    pix: "Pix (combinar com o comÃ©rcio)",
    dinheiro: "Dinheiro",
    cartao_credito: "CartÃ£o de crÃ©dito",
    cartao_debito: "CartÃ£o de dÃ©bito",
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
    if (error) throw new Error(error.message || "NÃ£o foi possÃ­vel validar o proprietÃ¡rio.");
    if (!data?.proprietario && !data?.admin) throw new Error(data?.mensagem || "Esta conta nÃ£o estÃ¡ vinculada ao comÃ©rcio.");
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
        $("loginCard").hidden = false;
        $("catalogoBloqueado").hidden = true;
        $("painelCatalogo").hidden = true;
        setNotice("Entre para continuar", "Somente o proprietÃ¡rio autenticado pode gerenciar o catÃ¡logo.");
        return;
      }

      $("loginCard").hidden = true;
      const resultado = await validarProprietario();
      comercio = await carregarComercio();
      $("nomeComercioAdmin").textContent = comercio?.nome || comercioId;

      if (!resultado.ativo && (!resultado.admin || resultado.proprietario)) {
        $("painelCatalogo").hidden = true;
        $("catalogoBloqueado").hidden = false;
        if (resultado.bloqueado) {
          $("lockedTitle").textContent = "CatÃ¡logo temporariamente bloqueado";
          $("lockedText").textContent = "O administrador do Guia bloqueou este catÃ¡logo. Entre em contato pelo perfil do comÃ©rcio para obter orientaÃ§Ã£o.";
          $("linkContratacao").hidden = true;
        } else {
          $("lockedTitle").textContent = "CatÃ¡logo nÃ£o liberado";
          $("lockedText").textContent = "Conecte a conta Mercado Pago do comÃ©rcio para liberar gratuitamente a gestÃ£o do catÃ¡logo.";
          $("linkContratacao").hidden = false;
        }
        setNotice("Acesso Ã  gestÃ£o bloqueado", "A gestÃ£o e a vitrine sÃ£o liberadas apÃ³s a conexÃ£o ativa do Mercado Pago.");
        return;
      }

      $("catalogoBloqueado").hidden = true;
      $("painelCatalogo").hidden = false;
      setNotice(resultado.admin ? "Acesso administrativo confirmado" : "Acesso confirmado", resultado.admin
        ? "VocÃª estÃ¡ corrigindo o catÃ¡logo como administrador do Guia."
        : "VocÃª estÃ¡ gerenciando o catÃ¡logo deste comÃ©rcio.");
      await carregarDadosPainel();
    } catch (erro) {
      console.error("Erro no painel de catÃ¡logo:", erro);
      $("loginCard").hidden = true;
      $("catalogoBloqueado").hidden = false;
      $("lockedTitle").textContent = "NÃ£o foi possÃ­vel confirmar o acesso";
      $("lockedText").textContent = erro.message || "Tente novamente ou retorne ao perfil do comÃ©rcio.";
      $("linkContratacao").hidden = true;
      setNotice("Acesso nÃ£o confirmado", erro.message || "A verificaÃ§Ã£o de proprietÃ¡rio falhou.", true);
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
    return ({ aguardando_pagamento: "Aguardando confirmaÃ§Ã£o", em_preparo: "Em preparo", pronto: "Pronto para entrega", entregue: "ConcluÃ­do", cancelado: "Cancelado" })[status] || status;
  }

  async function chamarPedidosOffline(body) {
    const { data, error } = await getClient().functions.invoke("catalogo-pedidos-offline-admin", { body: { ...body, comercio_id: comercioId } });
    if (error || !data?.success) throw new Error(data?.mensagem || error?.message || "NÃ£o foi possÃ­vel consultar os pedidos offline.");
    return data;
  }

  function renderizarPedidosOffline(pedidos) {
    const lista = $("listaPedidosOffline");
    const ativos = pedidos.filter((pedido) => ["aguardando_pagamento", "em_preparo", "pronto"].includes(pedido.status)).length;
    $("offlineSummary").innerHTML = `<span>${pedidos.length} pedido(s) no histÃ³rico</span><span>${ativos} em andamento</span>`;
    $("offlineSummary").hidden = false;
    if (!pedidos.length) { lista.innerHTML = '<p class="form-feedback">Nenhum pedido presencial registrado.</p>'; return; }
    lista.innerHTML = pedidos.map((pedido) => {
      const proxima = pedido.status === "aguardando_pagamento" ? "Aceitar e preparar" : pedido.status === "em_preparo" ? "Marcar como pronto" : "";
      const podeCancelar = ["aguardando_pagamento", "em_preparo", "pronto"].includes(pedido.status);
      const endereco = pedido.modalidade === "entrega" && pedido.cliente_endereco ? ` Â· ${escapar(pedido.cliente_endereco)}${pedido.cliente_numero ? `, ${escapar(pedido.cliente_numero)}` : ""}` : "";
      return `<article class="manager-row offline-order-row"><div class="offline-order-copy"><strong>${escapar(pedido.cliente_nome)} Â· ${reais(pedido.total_centavos)}</strong><small>${escapar(pedido.forma_pagamento)} Â· ${escapar(pedido.modalidade)}${endereco}</small><small>Produtos: ${reais(pedido.subtotal_produtos_centavos)} Â· ComissÃ£o: ${reais(pedido.taxa_plataforma_centavos)}</small><span class="offline-status" data-status="${escapar(pedido.status)}">${escapar(statusOffline(pedido.status))}</span></div><div class="manager-actions offline-order-actions">${proxima ? `<button class="small-button" type="button" data-offline-next="${escapar(pedido.id)}" data-offline-status="${escapar(pedido.status === "aguardando_pagamento" ? "em_preparo" : "pronto")}">${proxima}</button>` : ""}${podeCancelar ? `<button class="small-button danger" type="button" data-offline-cancel="${escapar(pedido.id)}">Cancelar</button>` : ""}</div></article>`;
    }).join("");
  }

  async function carregarPedidosOffline() {
    $("listaPedidosOffline").innerHTML = '<p class="form-feedback">Atualizando pedidosâ€¦</p>';
    try { renderizarPedidosOffline((await chamarPedidosOffline({ acao: "listar_pedidos" })).pedidos || []); }
    catch (error) { $("listaPedidosOffline").innerHTML = `<p class="form-feedback">${escapar(error.message || "NÃ£o foi possÃ­vel carregar os pedidos.")}</p>`; }
  }

  async function alterarStatusOffline(pedidoId, status, motivo = "") {
    await chamarPedidosOffline({ acao: "atualizar_status", pedido_id: pedidoId, status, motivo });
    await carregarPedidosOffline();
  }

  async function consultarExtratoOffline() {
    const competencia = $("competenciaOffline").value;
    if (!competencia) { $("extratoOffline").innerHTML = '<p class="form-feedback">Escolha um mÃªs para consultar o extrato.</p>'; return; }
    $("extratoOffline").innerHTML = '<p class="form-feedback">Consultando extratoâ€¦</p>';
    try {
      const data = await chamarPedidosOffline({ acao: "consultar_fechamento", competencia });
      const fechamento = data.fechamento; const comissoes = data.comissoes || [];
      if (!fechamento && !comissoes.length) { $("extratoOffline").innerHTML = '<p class="form-feedback">Nenhuma comissÃ£o registrada nesta competÃªncia.</p>'; return; }
      const total = fechamento?.total_comissao_centavos ?? comissoes.reduce((sum, item) => sum + Number(item.valor_comissao_centavos || 0), 0);
      $("extratoOffline").innerHTML = `<p><strong>Total de pedidos:</strong> ${fechamento?.total_pedidos ?? comissoes.length}</p><p><strong>ComissÃ£o devida:</strong> ${reais(total)}</p><p><strong>Status:</strong> ${escapar(fechamento?.status || "em aberto")}${fechamento?.vencimento_em ? ` Â· vencimento ${escapar(fechamento.vencimento_em)}` : ""}</p>`;
    } catch (error) { $("extratoOffline").innerHTML = `<p class="form-feedback">${escapar(error.message || "NÃ£o foi possÃ­vel consultar o extrato.")}</p>`; }
  }

  function traducaoCobranca(status) {
    return ({
      aberto: "Em aberto",
      faturado: "Fechada, aguardando pagamento",
      pendente: "Pix pendente",
      pago: "Paga",
      vencido: "Vencida",
      bloqueado: "Bloqueada por inadimplÃªncia",
      expirado: "Pix expirado",
      cancelado: "Cancelada",
      estornado: "Estornada (crÃ©dito revogado)",
      contestado: "Contestada (chargeback)",
      divergente: "DivergÃªncia de valor â€” conferÃªncia manual",
    })[status] || status || "sem cobranÃ§a";
  }

  async function chamarFaturaPix(body) {
    const { data, error } = await getClient().functions.invoke("catalogo-fatura-pix", { body: { ...body, comercio_id: comercioId } });
    if (error || !data?.success) throw new Error(data?.mensagem || error?.message || "NÃ£o foi possÃ­vel processar a cobranÃ§a da fatura.");
    return data;
  }

  function competenciaDaFatura() {
    const competencia = $("competenciaOffline").value;
    if (!competencia) throw new Error("Escolha o mÃªs da fatura antes de gerar o Pix.");
    return competencia;
  }

  function renderizarPixFatura(data) {
    const fatura = data.fatura || {};
    const pix = data.pix || {};
    const total = Number(data.valor_centavos ?? fatura.total_comissao_centavos ?? 0);
    const situacao = data.cobranca_status || fatura.status || "";
    const partes = [
      `<p><strong>ComissÃ£o da competÃªncia:</strong> ${reais(total)}</p>`,
      `<p><strong>SituaÃ§Ã£o:</strong> ${escapar(traducaoCobranca(situacao))}${fatura.vencimento_em ? ` Â· vencimento ${escapar(fatura.vencimento_em)}` : ""}</p>`,
    ];
    if (data.mensagem) partes.push(`<p class="form-feedback">${escapar(data.mensagem)}</p>`);
    if (pix.code) {
      if (pix.imageBase64) partes.push(`<img class="pix-qr" alt="QR Code Pix da fatura" src="data:image/png;base64,${pix.imageBase64}">`);
      partes.push(`<label class="pix-copy">Pix copia e cola<textarea readonly rows="3">${escapar(pix.code)}</textarea></label>`);
      partes.push('<button id="copiarPixFatura" class="small-button" type="button">Copiar cÃ³digo Pix</button>');
      if (/^https:\/\//.test(pix.ticketUrl || "")) partes.push(`<p><a class="button button-secondary" href="${escapar(pix.ticketUrl)}" target="_blank" rel="noopener">Abrir no Mercado Pago</a></p>`);
    }
    $("faturaPixResultado").innerHTML = partes.join("");
    const copiar = $("copiarPixFatura");
    if (copiar) copiar.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(pix.code); copiar.textContent = "CÃ³digo copiado"; }
      catch { copiar.textContent = "Copie o cÃ³digo manualmente"; }
    });
  }

  async function gerarPixFatura() {
    $("faturaPixResultado").innerHTML = '<p class="form-feedback">Solicitando o Pix da faturaâ€¦</p>';
    try { renderizarPixFatura(await chamarFaturaPix({ acao: "criar_cobranca", competencia: competenciaDaFatura() })); }
    catch (error) { $("faturaPixResultado").innerHTML = `<p class="form-feedback">${escapar(error.message || "NÃ£o foi possÃ­vel gerar o Pix da fatura.")}</p>`; }
  }

  async function consultarPixFatura() {
    $("faturaPixResultado").innerHTML = '<p class="form-feedback">Verificando o pagamento da faturaâ€¦</p>';
    try { renderizarPixFatura(await chamarFaturaPix({ acao: "consultar_cobranca", competencia: competenciaDaFatura() })); }
    catch (error) { $("faturaPixResultado").innerHTML = `<p class="form-feedback">${escapar(error.message || "NÃ£o foi possÃ­vel verificar o pagamento da fatura.")}</p>`; }
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
      lista.innerHTML = '<p class="form-feedback">Ainda nÃ£o hÃ¡ categorias. Crie uma para comeÃ§ar a cadastrar produtos.</p>';
      return;
    }
    lista.innerHTML = categorias.map((categoria, indice) => `
      <article class="manager-row">
        <div class="manager-copy"><strong>${escapar(categoria.nome)}</strong><small>Ordem ${indice + 1}${categoria.ativa ? " Â· visÃ­vel" : " Â· oculta"}</small></div>
        <div class="manager-actions">
          <button class="small-button" type="button" data-cat-move="up" data-id="${escapar(categoria.id)}" aria-label="Mover categoria para cima" ${indice === 0 ? "disabled" : ""}>â†‘</button>
          <button class="small-button" type="button" data-cat-move="down" data-id="${escapar(categoria.id)}" aria-label="Mover categoria para baixo" ${indice === categorias.length - 1 ? "disabled" : ""}>â†“</button>
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
      lista.innerHTML = '<p class="form-feedback">Ainda nÃ£o hÃ¡ produtos cadastrados.</p>';
      return;
    }
    const porCategoria = new Map(categorias.map((categoria) => [String(categoria.id), categoria.nome]));
    lista.innerHTML = produtos.map((produto) => `
      <article class="manager-row product-row">
        <div class="product-row-main">
          <img class="product-row-image" src="${escapar(publicUrl(produto.imagem))}" alt="" loading="lazy" data-admin-image>
          <div class="manager-copy"><strong>${escapar(produto.nome)} Â· ${window.CatalogoUtils.formatarMoeda(produto.preco)}</strong><small>${escapar(porCategoria.get(String(produto.categoria_id)) || "Sem categoria")}${produto.descricao ? ` Â· ${escapar(produto.descricao)}` : ""}</small><small class="${produto.disponivel ? "available-label" : "unavailable-label"}">${produto.disponivel ? "DisponÃ­vel" : "IndisponÃ­vel"}</small></div>
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
    if (file.size > 15 * 1024 * 1024) throw new Error("A foto original deve ter atÃ© 15 MiB.");

    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, 1440 / bitmap.width, 1440 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    const contexto = canvas.getContext("2d", { alpha: false });
    if (!contexto) throw new Error("NÃ£o foi possÃ­vel preparar a foto neste navegador.");
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
    $("salvarProduto").textContent = "Salvar alteraÃ§Ãµes";
    $("cancelarProduto").hidden = false;
    $("produtoForm").scrollIntoView({ behavior: "smooth", block: "center" });
    $("produtoNome").focus();
  }

  async function salvarProduto(event) {
    event.preventDefault();
    const supabase = getClient();
    const botao = $("salvarProduto");
    botao.disabled = true;
    setFeedback("produtoFeedback", "Salvando produtoâ€¦");

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
      if (!payload.nome || !payload.categoria_id || !Number.isFinite(payload.preco) || payload.preco < 0) throw new Error("Preencha nome, categoria e preÃ§o vÃ¡lido.");
      if (file) payload.imagem = await enviarImagem(file, produtoId);

      const resposta = existente
        ? await supabase.from("catalogo_produtos").update(payload).eq("id", produtoId).eq("comercio_id", comercioId)
        : await supabase.from("catalogo_produtos").insert(payload);
      if (resposta.error) throw resposta.error;
      await carregarDadosPainel();
      limparFormularioProduto();
      setFeedback("produtoFeedback", "Produto salvo. Se uma foto foi substituÃ­da, a anterior ficarÃ¡ sujeita Ã  retenÃ§Ã£o de sete dias.");
    } catch (erro) {
      console.error("Erro ao salvar produto:", erro);
      setFeedback("produtoFeedback", erro.message || "NÃ£o foi possÃ­vel salvar o produto.", true);
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
    setFeedback("categoriaFeedback", "Salvando categoriaâ€¦");
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
      setFeedback("categoriaFeedback", erro.message || "NÃ£o foi possÃ­vel salvar a categoria.", true);
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
        setFeedback("categoriaFeedback", "Crie outra categoria antes de arquivar esta: hÃ¡ produtos vinculados.", true);
        return;
      }
      removendoCategoriaId = id;
      $("reassignCategorySelect").innerHTML = destino.map((item) => `<option value="${escapar(item.id)}">${escapar(item.nome)}</option>`).join("");
      $("reassignCategoryDialog").showModal();
      return;
    }
    if (!window.confirm(`Arquivar a categoria â€œ${categoria.nome}â€?`)) return;
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
      setFeedback("categoriaFeedback", erro.message || "NÃ£o foi possÃ­vel arquivar a categoria.", true);
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
      setFeedback("categoriaFeedback", erro.message || "NÃ£o foi possÃ­vel reordenar as categorias.", true);
    }
  }

  async function excluirProduto(id) {
    const produto = produtos.find((item) => String(item.id) === String(id));
    if (!produto || !window.confirm(`Excluir â€œ${produto.nome}â€ da vitrine? A foto respeitarÃ¡ a retenÃ§Ã£o de sete dias.`)) return;
    const { error } = await getClient().from("catalogo_produtos").update({ disponivel: false, imagem: null, deletado_em: new Date().toISOString() }).eq("id", id).eq("comercio_id", comercioId);
    if (error) {
      setFeedback("produtoFeedback", error.message || "NÃ£o foi possÃ­vel excluir o produto.", true);
      return;
    }
    await carregarDadosPainel();
    setFeedback("produtoFeedback", "Produto retirado da vitrine; a foto nÃ£o foi apagada imediatamente.");
  }

  async function alternarProduto(id) {
    const produto = produtos.find((item) => String(item.id) === String(id));
    if (!produto) return;
    const { error } = await getClient().from("catalogo_produtos").update({ disponivel: !produto.disponivel }).eq("id", id).eq("comercio_id", comercioId);
    if (error) {
      setFeedback("produtoFeedback", error.message || "NÃ£o foi possÃ­vel atualizar a disponibilidade.", true);
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
    if (error) setFeedback("settingsFeedback", error.message || "NÃ£o foi possÃ­vel salvar as configuraÃ§Ãµes.", true);
    else setFeedback("settingsFeedback", "ConfiguraÃ§Ãµes salvas.");
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
      button.disabled = true;
      try {
        if (button.dataset.offlineNext) await alterarStatusOffline(button.dataset.offlineNext, button.dataset.offlineStatus);
        if (button.dataset.offlineCancel) await alterarStatusOffline(button.dataset.offlineCancel, "cancelado", "Cancelado pelo comÃ©rcio.");
      } catch (error) { setFeedback("settingsFeedback", error.message || "NÃ£o foi possÃ­vel atualizar o pedido.", true); button.disabled = false; }
    });
    $("atualizarPedidosOffline").addEventListener("click", carregarPedidosOffline);
    $("consultarExtratoOffline").addEventListener("click", consultarExtratoOffline);
    $("gerarPixFatura").addEventListener("click", gerarPixFatura);
    $("consultarPixFatura").addEventListener("click", consultarPixFatura);
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
      setNotice("ComÃ©rcio nÃ£o informado", "Volte ao perfil e abra a gestÃ£o do catÃ¡logo por lÃ¡.", true);
      $("loginCard").hidden = true;
      $("catalogoBloqueado").hidden = true;
      return;
    }
    const supabase = getClient();
    if (!supabase) {
      setNotice("ServiÃ§o de autenticaÃ§Ã£o indisponÃ­vel", "Tente novamente mais tarde.", true);
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
    $("gerarPixFatura").addEventListener("click", gerarPixFatura);
    $("consultarPixFatura").addEventListener("click", consultarPixFatura);
