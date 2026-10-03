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
    pix: "Pix (combinar com o comércio)",
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
    if (!data?.proprietario) throw new Error(data?.mensagem || "Esta conta não está vinculada ao comércio.");
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
        setNotice("Entre para continuar", "Somente o proprietário autenticado pode gerenciar o catálogo.");
        return;
      }

      $("loginCard").hidden = true;
      const resultado = await validarProprietario();
      comercio = await carregarComercio();
      $("nomeComercioAdmin").textContent = comercio?.nome || comercioId;

      if (!resultado.ativo && !resultado.admin) {
        $("painelCatalogo").hidden = true;
        $("catalogoBloqueado").hidden = false;
        if (resultado.bloqueado) {
          $("lockedTitle").textContent = "Catálogo temporariamente bloqueado";
          $("lockedText").textContent = "O administrador do Guia bloqueou este catálogo. Entre em contato pelo perfil do comércio para obter orientação.";
          $("linkContratacao").hidden = true;
        } else {
          $("lockedTitle").textContent = "Catálogo não liberado";
          $("lockedText").textContent = resultado.assinatura_status === "pendente"
            ? "Há uma solicitação pendente, mas esta demonstração não gerou Pix nem liberou o catálogo."
            : "Para gerenciar produtos, o catálogo precisa estar com assinatura ativa.";
          $("linkContratacao").hidden = false;
        }
        setNotice("Acesso à gestão bloqueado", "A administração e a vitrine dependem de assinatura ativa.");
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
