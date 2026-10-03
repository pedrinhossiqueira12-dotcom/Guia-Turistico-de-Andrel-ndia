(function () {
  "use strict";

  const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  const ADMIN_USER_ID = "4b9a0233-6b72-4573-aebd-d596c5b15e1b";
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const MAX_GALLERY = 8;
  const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const U = window.EditorialUtils;
  const $ = (id) => document.getElementById(id);
  const access = $("acessoEditorial");
  const panel = $("painelEditorial");
  const message = $("mensagemEditorial");
  const accessMessage = $("mensagemAcessoEditorial");
  const form = $("formPublicacaoEditorial");
  const list = $("listaAdminEditorial");
  if (!U || !window.supabase?.createClient || !access || !panel || !form || !list) return;

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  let session = null;
  let items = [];
  let currentCover = null;
  let currentGallery = [];
  let loading = false;

  function setMessage(target, text, kind = "") {
    target.textContent = text || "";
    if (kind) target.dataset.kind = kind;
    else delete target.dataset.kind;
  }

  function showAccess() {
    access.hidden = false;
    panel.hidden = true;
    $("botaoSairEditorial").hidden = true;
  }

  function showPanel() {
    access.hidden = true;
    panel.hidden = false;
    $("botaoSairEditorial").hidden = false;
  }

  async function verifySession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    session = data.session;
    if (!session) {
      showAccess();
      return false;
    }
    if (session.user?.id !== ADMIN_USER_ID) {
      showAccess();
      setMessage(accessMessage, "Acesso restrito à conta administradora autorizada.", "error");
      return false;
    }
    showPanel();
    await loadItems();
    return true;
  }

  async function invoke(payload) {
    const { data, error } = await supabase.functions.invoke("noticias-admin", { body: payload });
    if (error) {
      const details = data?.mensagem || error.message || "Erro de comunicação.";
      throw new Error(details);
    }
    if (!data?.success) throw new Error(data?.mensagem || "A operação não foi concluída.");
    return data;
  }

  async function loadItems() {
    if (loading) return;
    loading = true;
    list.textContent = "Carregando publicações…";
    try {
      const result = await invoke({ acao: "listar" });
      items = Array.isArray(result.itens) ? result.itens : [];
      renderItems();
      setMessage(message, `${items.length} publicação(ões) carregada(s).`);
    } catch (error) {
      list.textContent = "Não foi possível carregar as publicações.";
      setMessage(message, error.message, "error");
    } finally {
      loading = false;
    }
  }

  function renderItems() {
    const e = U.escapeHtml;
    if (!items.length) {
      list.innerHTML = '<p class="editorial-empty">Nenhuma publicação cadastrada. Use o formulário para criar a primeira.</p>';
      return;
    }
    list.innerHTML = items.map((item) => {
      const deleted = item.status === "deletado" || Boolean(item.deletado_em);
      const status = deleted ? "deletado" : item.status;
      const kind = item.tipo === "evento" ? "Evento" : "Notícia";
      const date = item.tipo === "evento" && item.inicio_evento ? U.formatEventDateRange(item.inicio_evento, item.fim_evento) : "";
      const disabled = deleted ? " disabled" : "";
      return `<article class="editorial-admin-item" data-item-id="${e(item.id)}">
        <span class="editorial-admin-status" data-status="${e(status)}">${e(status)}</span>
        <span class="editorial-admin-status">${e(kind)}</span>
        ${item.destaque_hero && item.status === "publicado" ? '<span class="editorial-admin-status">Hero</span>' : ""}
        <h4>${e(item.titulo)}</h4>
        <p>${e(item.resumo || "Sem resumo.")}${date ? ` · ${e(date)}` : ""}</p>
        <div class="editorial-admin-actions">
          <button class="editorial-admin-action" type="button" data-action="editar" data-id="${e(item.id)}"${disabled}>Editar</button>
          ${item.status === "publicado" ? `<button class="editorial-admin-action" type="button" data-action="arquivar" data-id="${e(item.id)}"${disabled}>Arquivar</button>` : ""}
          ${!deleted ? `<button class="editorial-admin-action" type="button" data-action="excluir" data-id="${e(item.id)}">Excluir logicamente</button>` : ""}
        </div>
      </article>`;
    }).join("");
  }

  function toLocalDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(date).replace(" ", "T");
  }

  function renderExistingGallery() {
    const root = $("imagensGaleriaEditorial");
    if (!root) return;
    root.className = "editorial-gallery-items";
    root.innerHTML = currentGallery.map((imagePath, index) => {
      const url = U.publicImageUrl(imagePath, SUPABASE_URL);
      if (!url) return "";
      return `<div class="editorial-gallery-item"><img src="${U.escapeHtml(url)}" alt="Imagem ${index + 1} da galeria atual" loading="lazy"><button type="button" data-remove-gallery="${index}" aria-label="Retirar imagem ${index + 1} da galeria">Retirar referência</button></div>`;
    }).join("");
    $("galeriaAtualEditorial").textContent = currentGallery.length ? `${currentGallery.length} imagem(ns) cadastrada(s). Remover a referência não apaga o arquivo.` : "Nenhuma imagem adicional cadastrada.";
  }

  function resetForm() {
    form.reset();
    $("idPublicacao").value = "";
    $("slugPublicacao").readOnly = false;
    delete $("slugPublicacao").dataset.touched;
    $("tituloFormularioEditorial").textContent = "Nova publicação";
    $("statusPublicacao").value = "rascunho";
    $("ordemHeroPublicacao").value = "0";
    $("capaAtualEditorial").textContent = "";
    $("galeriaAtualEditorial").textContent = "";
    $("removerCapaEditorial").checked = false;
    currentCover = null;
    currentGallery = [];
    renderExistingGallery();
    updateEventFields();
  }

  function updateEventFields() {
    const isEvent = $("tipoPublicacao").value === "evento";
    $("camposEventoEditorial").hidden = !isEvent;
  }

  function editItem(item) {
    $("idPublicacao").value = item.id;
    $("tipoPublicacao").value = item.tipo;
    $("statusPublicacao").value = ["rascunho", "publicado", "arquivado"].includes(item.status) ? item.status : "rascunho";
    $("tituloPublicacao").value = item.titulo || "";
    $("slugPublicacao").value = item.slug || "";
    $("slugPublicacao").readOnly = true;
    $("resumoPublicacao").value = item.resumo || "";
    $("corpoPublicacao").value = item.corpo || "";
    $("localEventoPublicacao").value = item.local_evento || "";
    $("inicioEventoPublicacao").value = toLocalDate(item.inicio_evento);
    $("fimEventoPublicacao").value = toLocalDate(item.fim_evento);
    $("textoCtaPublicacao").value = item.texto_cta || "";
    $("urlCtaPublicacao").value = item.url_cta || "";
    $("destaqueHeroPublicacao").checked = Boolean(item.destaque_hero);
    $("ordemHeroPublicacao").value = String(item.ordem_hero ?? 0);
    currentCover = item.imagem_capa || null;
    currentGallery = Array.isArray(item.galeria) ? item.galeria : [];
    $("capaAtualEditorial").textContent = currentCover ? `Capa cadastrada: ${currentCover}` : "Nenhuma capa cadastrada.";
    $("removerCapaEditorial").checked = false;
    renderExistingGallery();
    $("tituloFormularioEditorial").textContent = "Editar publicação";
    updateEventFields();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function validateFiles(files, currentCount = 0) {
    if (currentCount + files.length > MAX_GALLERY) throw new Error(`A galeria aceita até ${MAX_GALLERY} imagens.`);
    for (const file of files) {
      if (!ALLOWED_TYPES.has(file.type)) throw new Error("Use somente imagens JPG, PNG ou WebP.");
      if (file.size > MAX_FILE_BYTES) throw new Error("Cada imagem deve ter no máximo 5 MiB.");
    }
  }

  async function uploadFile(file, folderId) {
    const extensionByType = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    const path = `publicacoes/${folderId}/${crypto.randomUUID()}.${extensionByType[file.type]}`;
    const { error } = await supabase.storage.from("noticias-eventos").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    });
    if (error) throw new Error(`Falha ao enviar imagem: ${error.message}`);
    return path;
  }

  async function submitForm(event) {
    event.preventDefault();
    if (!session || session.user?.id !== ADMIN_USER_ID) {
      setMessage(message, "A sessão autorizada não está ativa. Entre novamente.", "error");
      showAccess();
      return;
    }
    const existingId = $("idPublicacao").value || "";
    const folderId = existingId || crypto.randomUUID();
    const title = $("tituloPublicacao").value.trim();
    const slug = existingId ? $("slugPublicacao").value.trim() : ( $("slugPublicacao").value.trim() || U.slugify(title) );
    if (!slug) {
      setMessage(message, "O título precisa formar um endereço (slug) válido.", "error");
      return;
    }
    const previous = items.find((entry) => entry.id === existingId);
    const status = $("statusPublicacao").value;
    if (status === "publicado" && previous?.status !== "publicado" && !window.confirm(`Publicar “${title}” agora no site público?`)) return;
    if (previous?.status === "publicado" && status !== "publicado" && !window.confirm(`Retirar “${title}” do site público?`)) return;
    try {
      const galleryFiles = Array.from($("galeriaPublicacao").files || []);
      validateFiles(galleryFiles, currentGallery.length);
      const coverFile = $("capaPublicacao").files?.[0] || null;
      if (coverFile) validateFiles([coverFile]);
      if (coverFile && $("removerCapaEditorial").checked) throw new Error("Escolha uma nova capa ou marque para remover a atual, não as duas opções.");
      let coverPath = $("removerCapaEditorial").checked ? null : currentCover;
      if (coverFile) coverPath = await uploadFile(coverFile, folderId);
      const galleryPaths = [...currentGallery];
      for (const file of galleryFiles) galleryPaths.push(await uploadFile(file, folderId));
      const body = {
        acao: "salvar",
        item: undefined,
        id: existingId || undefined,
        tipo: $("tipoPublicacao").value,
        status,
        titulo: title,
        slug,
        resumo: $("resumoPublicacao").value,
        corpo: $("corpoPublicacao").value,
        local_evento: $("localEventoPublicacao").value,
        inicio_evento: $("inicioEventoPublicacao").value ? new Date(`${$("inicioEventoPublicacao").value}:00-03:00`).toISOString() : null,
        fim_evento: $("fimEventoPublicacao").value ? new Date(`${$("fimEventoPublicacao").value}:00-03:00`).toISOString() : null,
        imagem_capa: coverPath,
        galeria: galleryPaths,
        texto_cta: $("textoCtaPublicacao").value,
        url_cta: $("urlCtaPublicacao").value,
        destaque_hero: $("destaqueHeroPublicacao").checked,
        ordem_hero: Number($("ordemHeroPublicacao").value || 0),
      };
      const result = await invoke(body);
      const publicationMessage = !result.publicAffected
        ? "Rascunho salvo; ele permanece privado e não aparece no site público."
        : result.buildTriggered
          ? "Mudança pública salva. O novo build do Cloudflare Pages foi iniciado."
          : "Mudança pública salva na fonte ao vivo. Configure o Deploy Hook do Cloudflare Pages para atualizar/remover também o HTML estático e o SEO.";
      setMessage(message, publicationMessage, "success");
      resetForm();
      await loadItems();
    } catch (error) {
      setMessage(message, error.message || "Não foi possível salvar a publicação.", "error");
    }
  }

  async function handleListAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const item = items.find((entry) => entry.id === button.dataset.id);
    if (!item) return;
    if (button.dataset.action === "editar") return editItem(item);
    if (button.dataset.action === "arquivar") {
      if (!window.confirm(`Arquivar “${item.titulo}”? A publicação deixa de aparecer ao público.`)) return;
      try {
        const result = await invoke({ acao: "arquivar", id: item.id });
        setMessage(message, !result.publicAffected ? "Rascunho arquivado; nada foi exibido ao público." : result.buildTriggered ? "Publicação arquivada; build iniciado para atualizar/remover páginas públicas." : "Publicação arquivada. A versão ao vivo deixa de exibi-la; configure o Deploy Hook para atualizar o HTML estático.", "success");
        await loadItems();
      } catch (error) { setMessage(message, error.message, "error"); }
    }
    if (button.dataset.action === "excluir") {
      if (!window.confirm(`Excluir logicamente “${item.titulo}”? O conteúdo deixa de ser público; os arquivos de imagem não serão apagados.`)) return;
      try {
        const result = await invoke({ acao: "excluir", id: item.id });
        setMessage(message, !result.publicAffected ? "Rascunho excluído logicamente; as imagens foram mantidas." : result.buildTriggered ? "Publicação excluída logicamente; build iniciado. As imagens foram mantidas." : "Publicação excluída logicamente; a fonte ao vivo deixa de exibi-la. Configure o Deploy Hook para remover o HTML estático. As imagens foram mantidas.", "success");
        await loadItems();
      } catch (error) { setMessage(message, error.message, "error"); }
    }
  }

  $("formLoginEditorial").addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage(accessMessage, "Verificando acesso…");
    const { data, error } = await supabase.auth.signInWithPassword({
      email: $("emailEditorial").value.trim(),
      password: $("senhaEditorial").value,
    });
    if (error) {
      setMessage(accessMessage, "Não foi possível entrar. Confira o e-mail e a senha.", "error");
      return;
    }
    session = data.session;
    if (session?.user?.id !== ADMIN_USER_ID) {
      setMessage(accessMessage, "Esta conta não está autorizada a administrar publicações.", "error");
      return;
    }
    setMessage(accessMessage, "Acesso confirmado.", "success");
    await verifySession();
  });
  form.addEventListener("submit", submitForm);
  $("imagensGaleriaEditorial").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-gallery]");
    if (!button) return;
    const index = Number(button.dataset.removeGallery);
    if (!Number.isInteger(index) || index < 0 || index >= currentGallery.length) return;
    currentGallery.splice(index, 1);
    renderExistingGallery();
  });
  list.addEventListener("click", handleListAction);
  $("limparFormularioEditorial").addEventListener("click", resetForm);
  $("atualizarListaEditorial").addEventListener("click", loadItems);
  $("tipoPublicacao").addEventListener("change", updateEventFields);
  $("tituloPublicacao").addEventListener("input", () => {
    if (!$("idPublicacao").value && !$("slugPublicacao").dataset.touched) $("slugPublicacao").value = U.slugify($("tituloPublicacao").value);
  });
  $("slugPublicacao").addEventListener("input", () => { $("slugPublicacao").dataset.touched = "true"; });
  $("botaoSairEditorial").addEventListener("click", async () => {
    await supabase.auth.signOut();
    session = null;
    showAccess();
    setMessage(accessMessage, "Sessão encerrada.");
  });

  supabase.auth.onAuthStateChange((_event, newSession) => {
    session = newSession;
    if (!newSession) showAccess();
    else if (newSession.user?.id === ADMIN_USER_ID) void verifySession();
    else {
      showAccess();
      setMessage(accessMessage, "Acesso restrito à conta administradora autorizada.", "error");
    }
  });
  updateEventFields();
  verifySession().catch((error) => {
    showAccess();
    setMessage(accessMessage, error.message || "Não foi possível verificar o acesso.", "error");
  });
})();
