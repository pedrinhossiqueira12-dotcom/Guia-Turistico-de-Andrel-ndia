(() => {
  "use strict";
  const STAGING_URL = "https://jbttwihctuibchhcyqtl.supabase.co";
  // Public/browser-safe Supabase API key. Never put service_role or OAuth secrets here.
  const STAGING_PUBLISHABLE_KEY = "sb_publishable_W80rooaGpHP4voYiLwtz7w_-k32qHsF";
  const $ = (id) => document.getElementById(id);
  const status = (message, error = false) => {
    $("status").textContent = message;
    $("status").dataset.error = String(error);
  };
  let busy = false;
  if (!window.supabase?.createClient) {
    status("Não foi possível carregar a biblioteca de autenticação. Atualize a página.", true);
    return;
  }
  const client = window.supabase.createClient(STAGING_URL, STAGING_PUBLISHABLE_KEY, {
    auth: {
      storageKey: "guia-andrelandia-staging-qa-auth",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  const show = (authenticated) => {
    $("loginPanel").hidden = authenticated;
    $("oauthPanel").hidden = !authenticated;
  };

  async function refresh() {
    const { data, error } = await client.auth.getUser();
    const authenticated = !error && Boolean(data?.user?.id);
    show(authenticated);
    status(authenticated ? "Sessão de teste autenticada. Você pode iniciar o OAuth."
      : "Entre com uma conta do STAGING para continuar.");
  }

  async function login(event) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    $("loginButton").disabled = true;
    try {
      const email = $("email").value.trim();
      const password = $("password").value;
      const { error } = await client.auth.signInWithPassword({ email, password });
      // Never persist, log or reflect the password in the UI.
      $("password").value = "";
      if (error) throw new Error("Credenciais inválidas ou login indisponível no STAGING.");
      await refresh();
    } catch (error) {
      $("password").value = "";
      status(error.message || "Não foi possível autenticar.", true);
    } finally {
      busy = false;
      $("loginButton").disabled = false;
    }
  }

  async function connect() {
    if (busy) return;
    busy = true;
    $("connectButton").disabled = true;
    status("Conferindo autorização de acesso e preparando OAuth de teste…");
    try {
      const { data: auth, error: authError } = await client.auth.getUser();
      if (authError || !auth?.user?.id) throw new Error("Sessão expirada. Entre novamente no STAGING.");
      const { data, error } = await client.functions.invoke("catalogo-oauth-qa-iniciar", {
        body: { acao: "iniciar_conexao_qa", comercio_id: $("commerceId").value },
      });
      if (error || data?.success !== true || typeof data.authorization_url !== "string") {
        throw new Error(data?.mensagem || "OAuth de teste ainda não está configurado no STAGING.");
      }
      const destination = new URL(data.authorization_url);
      const allowed = destination.protocol === "https:"
        && ["auth.mercadopago.com", "auth.mercadopago.com.br"].includes(destination.hostname)
        && destination.pathname === "/authorization";
      if (!allowed) throw new Error("O provedor devolveu um endereço inesperado. Redirecionamento bloqueado.");
      window.location.assign(destination.href);
    } catch (error) {
      status(error.message || "Não foi possível iniciar a autorização.", true);
      busy = false;
      $("connectButton").disabled = false;
    }
  }

  async function logout() {
    if (busy) return;
    busy = true;
    try {
      await client.auth.signOut();
      show(false);
      status("Sessão de homologação encerrada.");
    } catch {
      status("Não foi possível encerrar a sessão.", true);
    } finally {
      busy = false;
    }
  }

  $("loginForm").addEventListener("submit", login);
  $("connectButton").addEventListener("click", connect);
  $("logoutButton").addEventListener("click", logout);
  refresh().catch(() => {
    show(false);
    status("Falha ao verificar a sessão do STAGING.", true);
  });
})();
