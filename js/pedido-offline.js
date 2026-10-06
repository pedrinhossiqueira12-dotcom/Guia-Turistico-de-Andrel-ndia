// Página antiga mantida somente para orientar clientes; nenhuma chamada ao backend.
(function () {
  "use strict";
  const form = document.getElementById("confirmarEntregaForm");
  if (form) form.hidden = true;
  const status = document.getElementById("confirmacaoStatus");
  if (status) status.textContent = "A confirmação exige o painel autenticado do comércio ou do motoboy autorizado. Informe o código apenas na entrega.";
  // Remove tokens antigos do endereço local sem enviar seus valores a outro serviço.
  try {
    if (new URLSearchParams(window.location.search).has("token")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  } catch { /* Não impede a orientação em navegadores antigos. */ }
})();
