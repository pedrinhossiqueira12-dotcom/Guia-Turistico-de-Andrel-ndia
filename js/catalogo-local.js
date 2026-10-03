(function () {
  "use strict";
  const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  const comercioId = (new URLSearchParams(location.search).get("id") || "").trim();
  let supabaseClient = null;

  function client() {
    if (!supabaseClient) supabaseClient = window.supabaseLoginClient || window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
    return supabaseClient;
  }

  async function catalogoPublico() {
    const area = document.getElementById("areaCatalogoPublico");
    const link = document.getElementById("linkVerCatalogo");
    if (!area || !link || !comercioId) return;
    area.hidden = true;
    try {
      const response = await fetch("../DATA/comercios.json", { cache: "no-store" });
      if (!response.ok) return;
      const list = await response.json();
      const comercio = Array.isArray(list) ? list.find((item) => String(item.id) === comercioId) : null;
      if (!comercio || String(comercio.status || "").toLowerCase() !== "ativo") return;
      const { data, error } = await client().from("catalogo_publicado")
        .select("comercio_id")
        .eq("comercio_id", comercioId)
        .maybeSingle();
      if (error || !data) return;
      link.href = `catalogo.html?id=${encodeURIComponent(comercioId)}`;
      area.hidden = false;
    } catch (error) {
      console.warn("Não foi possível verificar a disponibilidade do catálogo.", error);
    }
  }

  function mostrarAcaoProprietario(estado) {
    const area = document.getElementById("areaCatalogoOwner");
    const link = document.getElementById("acaoCatalogoOwner");
    const texto = document.getElementById("estadoCatalogoOwner");
    if (!area || !link || !texto) return;

    if (!estado?.proprietario) {
      area.hidden = true;
      return;
    }
    area.hidden = false;
    if (estado.bloqueado) {
      texto.textContent = "Este catálogo está temporariamente bloqueado pelo administrador do Guia.";
      link.textContent = "Ver detalhes";
      link.href = `catalogo-venda.html?id=${encodeURIComponent(comercioId)}`;
      return;
    }
    if (estado.ativo) {
      texto.textContent = "Sua assinatura está ativa. Atualize produtos, categorias e opções de pedido.";
      link.textContent = "Gerenciar catálogo";
      link.href = `catalogo-admin.html?id=${encodeURIComponent(comercioId)}`;
    } else {
      texto.textContent = estado.assinatura_status === "pendente"
        ? "Existe um pedido de teste pendente; nenhuma cobrança real ocorreu e a vitrine continua fechada."
        : "Planos definidos: R$ 59,90 por mês ou R$ 599,90 por ano. O link abre somente o teste sandbox; não ativa a vitrine.";
      link.textContent = "Criar catálogo digital";
      link.href = `catalogo-venda.html?id=${encodeURIComponent(comercioId)}`;
    }
  }

  async function verificarProprietario() {
    const area = document.getElementById("areaCatalogoOwner");
    if (!area || !comercioId) return;
    const supabase = client();
    const { data: { session } = {} } = await supabase.auth.getSession();
    if (!session) {
      mostrarAcaoProprietario(null);
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("catalogo-admin", {
        body: { acao: "verificar_proprietario", comercio_id: comercioId },
      });
      if (error) throw error;
      mostrarAcaoProprietario(data);
    } catch (error) {
      mostrarAcaoProprietario(null);
      console.info("Ação do proprietário do catálogo não foi exibida:", error.message || error);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    catalogoPublico();
    const supabase = client();
    if (!supabase) return;
    verificarProprietario();
    supabase.auth.onAuthStateChange((evento) => {
      if (evento === "SIGNED_IN" || evento === "SIGNED_OUT") verificarProprietario();
    });
  });
})();
