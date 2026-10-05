(function () {
  "use strict";
  const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const form = document.getElementById("confirmarEntregaForm");
  const status = document.getElementById("confirmacaoStatus");
  const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = document.getElementById("codigoEntrega").value.trim();
    const entregador = document.getElementById("entregador").value.trim();
    if (!token || !/^\d{6}$/.test(code)) { status.textContent = "Link ou código inválido."; return; }
    const button = form.querySelector("button"); button.disabled = true; status.textContent = "Validando código…";
    try {
      const { data, error } = await supabase.functions.invoke("catalogo-pedido-offline", { body: { acao: "confirmar_entrega", cliente_token: token, codigo_entrega: code, entregador } });
      if (error || !data?.success) throw new Error(data?.mensagem || "Não foi possível confirmar a entrega.");
      status.textContent = "Entrega confirmada. A comissão foi registrada no extrato mensal.";
      form.hidden = true;
    } catch (error) { status.textContent = error.message || "Não foi possível confirmar a entrega."; button.disabled = false; }
  });
})();
