(() => {
  "use strict";
  const atualizar = () => {
    const link = document.getElementById("linkGerenciarEntregadores");
    if (!link) return;
    const parametros = new URLSearchParams(window.location.search);
    const comercioId = (parametros.get("id") || parametros.get("comercio_id") || "").trim();
    link.href = comercioId ? `entregadores-admin.html?id=${encodeURIComponent(comercioId)}` : "entregadores-admin.html";
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", atualizar, { once: true });
  else atualizar();
})();
