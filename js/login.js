/* =========================================================
   ANDRELÂNDIA — GUIA TURÍSTICO
   LOGIN.JS

   RESPONSABILIDADE:
   - Login
   - Cadastro
   - Logout
   - Sessão Supabase
   - Modal de autenticação
   - Estado do usuário
   - Atualização da interface de autenticação

   NÃO CONTÉM:
   - Avaliações
   - Mapa
   - Mural
   - Dados dos locais
========================================================= */


/* =========================================================
   CONFIGURAÇÃO SUPABASE
========================================================= */

const LOGIN_SUPABASE_URL =
  "https://xdmbkflufsfqziixzpxc.supabase.co";

const LOGIN_SUPABASE_KEY =
  "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";


/* =========================================================
   SUPABASE
========================================================= */

/*
 * O index.js já possui um supabaseClient.
 *
 * Portanto, se ele existir, reutilizamos o mesmo cliente.
 *
 * Caso o login.js seja carregado em uma página que ainda
 * não possui o cliente, criamos um próprio.
 */

if (
  typeof supabaseClient === "undefined" ||
  !supabaseClient
) {

  if (
    window.supabase &&
    typeof window.supabase.createClient === "function"
  ) {

    window.supabaseLoginClient =
      window.supabase.createClient(
        LOGIN_SUPABASE_URL,
        LOGIN_SUPABASE_KEY
      );

  } else {

    console.error(
      "Supabase não foi carregado."
    );

  }

}


/* =========================================================
   CLIENTE SUPABASE DO LOGIN
========================================================= */

function obterSupabaseLogin() {

  /*
   * Primeiro tenta utilizar o cliente global
   * existente no index.js.
   */

  if (
    typeof supabaseClient !== "undefined" &&
    supabaseClient
  ) {

    return supabaseClient;

  }


  /*
   * Caso contrário utiliza o cliente criado
   * especificamente para o login.
   */

  if (
    window.supabaseLoginClient
  ) {

    return window.supabaseLoginClient;

  }


  return null;

}


/* =========================================================
   USUÁRIO ATUAL
========================================================= */

/*
 * IMPORTANTE:
 *
 * Não declaramos:
 *
 * let usuarioAtual = null;
 *
 * aqui.
 *
 * O index.js já possui essa variável e o mural utiliza
 * exatamente esse estado.
 *
 * O login.js apenas atualiza a variável existente.
 */

function atualizarUsuarioAtual(
  usuario
) {

  /*
   * Compatibilidade com o index.js.
   */

  if (
    typeof usuarioAtual !== "undefined"
  ) {

    usuarioAtual =
      usuario || null;

  }


  /*
   * Compatibilidade com o local.js.
   *
   * O local.js utiliza:
   *
   * window.usuarioAtualSupabase
   */

  window.usuarioAtualSupabase =
    usuario || null;

}


/* =========================================================
   OBTER USUÁRIO ATUAL
========================================================= */

function obterUsuarioLogin() {

  if (
    typeof usuarioAtual !== "undefined" &&
    usuarioAtual
  ) {

    return usuarioAtual;

  }

  return (
    window.usuarioAtualSupabase ||
    null
  );

}


/* =========================================================
   NOME DO USUÁRIO
========================================================= */

function obterNomeUsuario(
  user
) {

  if (!user) {
    return "Usuário";
  }

  return (
    user.user_metadata?.nome ||
    user.email?.split("@")[0] ||
    "Usuário"
  );

}


const PERFIL_FOTOS_BUCKET = "perfil-fotos";
const CONTA_EDGE_FUNCTION_URL = `${LOGIN_SUPABASE_URL}/functions/v1/conta-usuario`;
const AVATAR_FALLBACK = "img/icones/pessoa.png";

function avatarPathFromUrl(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const pathname = new URL(value).pathname;
    const marker = `/storage/v1/object/public/${PERFIL_FOTOS_BUCKET}/`;
    return pathname.includes(marker) ? decodeURIComponent(pathname.split(marker)[1]) : "";
  } catch { return ""; }
}

function renderizarAvatarUsuario(user) {
  const image = document.getElementById("avatarUsuario");
  const button = document.getElementById("botaoRemoverFotoPerfil");
  if (!image) return;
  const avatar = user?.user_metadata?.avatar_url;
  image.src = typeof avatar === "string" && avatar ? avatar : AVATAR_FALLBACK;
  image.alt = user ? `Foto de ${obterNomeUsuario(user)}` : "Foto de perfil";
  image.onerror = () => { image.onerror = null; image.src = AVATAR_FALLBACK; };
  if (button) button.disabled = !(typeof avatar === "string" && avatar);
}

function setFeedbackFotoPerfil(message, error = false) {
  const target = document.getElementById("feedbackFotoPerfil");
  if (!target) return;
  target.textContent = message || "";
  target.dataset.kind = error ? "error" : "success";
}

async function uploadAvatarUsuario(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use uma imagem JPG, PNG ou WEBP.");
  if (file.size > 2 * 1024 * 1024) throw new Error("A foto deve ter no máximo 2 MB.");
  const client = obterSupabaseLogin();
  const { data: sessionData } = await client.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) throw new Error("Sua sessão expirou. Entre novamente.");
  const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
  const path = `${user.id}/avatar-${Date.now()}.${extension}`;
  const { error: uploadError } = await client.storage.from(PERFIL_FOTOS_BUCKET).upload(path, file, { upsert: false, contentType: file.type, cacheControl: "3600" });
  if (uploadError) throw new Error(uploadError.message || "Não foi possível enviar a foto.");
  const { data: publicData } = client.storage.from(PERFIL_FOTOS_BUCKET).getPublicUrl(path);
  const oldPath = user.user_metadata?.avatar_path || avatarPathFromUrl(user.user_metadata?.avatar_url);
  const { error: metadataError } = await client.auth.updateUser({ data: { avatar_url: publicData.publicUrl, avatar_path: path } });
  if (metadataError) {
    await client.storage.from(PERFIL_FOTOS_BUCKET).remove([path]);
    throw new Error(metadataError.message || "Não foi possível salvar a foto.");
  }
  if (oldPath && oldPath !== path) await client.storage.from(PERFIL_FOTOS_BUCKET).remove([oldPath]);
  const { data: refreshed } = await client.auth.getUser();
  renderizarAvatarUsuario(refreshed?.user || { ...user, user_metadata: { ...user.user_metadata, avatar_url: publicData.publicUrl, avatar_path: path } });
}

async function removerAvatarUsuario() {
  const client = obterSupabaseLogin();
  const { data: sessionData } = await client.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) throw new Error("Sua sessão expirou. Entre novamente.");
  const oldPath = user.user_metadata?.avatar_path || avatarPathFromUrl(user.user_metadata?.avatar_url);
  if (oldPath) {
    const { error } = await client.storage.from(PERFIL_FOTOS_BUCKET).remove([oldPath]);
    if (error) throw new Error(error.message || "Não foi possível remover a foto.");
  }
  const { error } = await client.auth.updateUser({ data: { avatar_url: null, avatar_path: null } });
  if (error) throw new Error(error.message || "Não foi possível atualizar o perfil.");
  const { data: refreshed } = await client.auth.getUser();
  renderizarAvatarUsuario(refreshed?.user || null);
}

async function excluirContaUsuario() {
  const confirmou = window.confirm("Apagar a conta é permanente. Seu login, foto de perfil e perfil público serão removidos/arquivados e não poderão ser recuperados. Deseja continuar?");
  if (!confirmou) return;
  const button = document.getElementById("botaoExcluirConta");
  try {
    if (button) { button.disabled = true; button.textContent = "Apagando..."; }
    const client = obterSupabaseLogin();
    const { data: sessionData } = await client.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error("Sua sessão expirou. Entre novamente.");
    const response = await fetch(CONTA_EDGE_FUNCTION_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: LOGIN_SUPABASE_KEY }, body: JSON.stringify({ acao: "excluir_conta" }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.sucesso !== true) throw new Error(result.erro || "Não foi possível apagar a conta.");
    await client.auth.signOut({ scope: "local" });
    window.location.href = "index.html?conta=excluida";
  } catch (error) {
    setFeedbackFotoPerfil(error.message || "Não foi possível apagar a conta.", true);
    if (button) { button.disabled = false; button.textContent = "Apagar minha conta"; }
  }
}

function configurarControlesPerfil() {
  const input = document.getElementById("inputFotoPerfil");
  const avatarButton = document.getElementById("avatarUsuarioButton");
  const removeButton = document.getElementById("botaoRemoverFotoPerfil");
  const deleteButton = document.getElementById("botaoExcluirConta");
  if (input && !input.dataset.configurado) {
    input.dataset.configurado = "true";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      try { setFeedbackFotoPerfil("Enviando foto…"); await uploadAvatarUsuario(file); setFeedbackFotoPerfil("Foto de perfil atualizada."); }
      catch (error) { setFeedbackFotoPerfil(error.message || "Não foi possível enviar a foto.", true); }
    });
  }
  if (avatarButton && !avatarButton.dataset.configurado) { avatarButton.dataset.configurado = "true"; avatarButton.addEventListener("click", () => input?.click()); }
  if (removeButton && !removeButton.dataset.configurado) { removeButton.dataset.configurado = "true"; removeButton.addEventListener("click", async () => { if (!window.confirm("Remover sua foto de perfil?")) return; try { removeButton.disabled = true; await removerAvatarUsuario(); setFeedbackFotoPerfil("Foto removida."); } catch (error) { setFeedbackFotoPerfil(error.message || "Não foi possível remover a foto.", true); } }); }
  if (deleteButton && !deleteButton.dataset.configurado) { deleteButton.dataset.configurado = "true"; deleteButton.addEventListener("click", excluirContaUsuario); }
}

/* =========================================================
   USUÁRIO LOGADO
========================================================= */

async function mostrarUsuarioLogado(
  user
) {

  if (!user) {
    mostrarUsuarioDeslogado();
    return;
  }


  atualizarUsuarioAtual(
    user
  );

  configurarControlesPerfil();
  renderizarAvatarUsuario(user);


  const areaAuth =
    document.getElementById(
      "areaAutenticacao"
    );


  const areaUsuario =
    document.getElementById(
      "areaUsuario"
    );


  const areaAvaliacao =
    document.getElementById(
      "areaAvaliacao"
    );


  const nomeElemento =
    document.getElementById(
      "nomeUsuarioLogado"
    );


  const nome =
    obterNomeUsuario(
      user
    );


  /*
   * Nome do usuário.
   */

  if (nomeElemento) {

    nomeElemento.textContent =
      nome;

  }


  /*
   * Área de login.
   */

  if (areaAuth) {

    areaAuth.style.display =
      "none";

  }


  /*
   * Área específica de usuário,
   * caso exista no index.
   */

  if (areaUsuario) {

    areaUsuario.style.display =
      "block";

  }


  /*
   * Área de avaliação.
   *
   * Mantemos esta compatibilidade porque
   * o login.js também poderá ser usado futuramente
   * em páginas que tenham avaliações.
   */

  if (areaAvaliacao) {

    areaAvaliacao.style.display =
      "block";

  }

}


/* =========================================================
   USUÁRIO DESLOGADO
========================================================= */

function mostrarUsuarioDeslogado() {

  atualizarUsuarioAtual(
    null
  );

  renderizarAvatarUsuario(null);


  const areaAuth =
    document.getElementById(
      "areaAutenticacao"
    );


  const areaUsuario =
    document.getElementById(
      "areaUsuario"
    );


  const areaAvaliacao =
    document.getElementById(
      "areaAvaliacao"
    );


  if (areaAuth) {

    areaAuth.style.display =
      "block";

  }


  if (areaUsuario) {

    areaUsuario.style.display =
      "none";

  }


  if (areaAvaliacao) {

    areaAvaliacao.style.display =
      "none";

  }

}


/* =========================================================
   VERIFICAR SESSÃO
========================================================= */

async function verificarUsuario() {

  const cliente =
    obterSupabaseLogin();


  if (!cliente) {

    console.error(
      "Cliente Supabase não disponível."
    );

    mostrarUsuarioDeslogado();

    return null;

  }


  try {

    const {
      data,
      error
    } =
      await cliente.auth.getSession();


    if (error) {

      console.error(
        "Erro ao verificar usuário:",
        error
      );

      mostrarUsuarioDeslogado();

      return null;

    }


    const user =
      data?.session?.user ||
      null;


    if (user) {

      await mostrarUsuarioLogado(
        user
      );

    } else {

      mostrarUsuarioDeslogado();

    }


    return user;

  } catch (erro) {

    console.error(
      "Erro ao verificar sessão:",
      erro
    );

    mostrarUsuarioDeslogado();

    return null;

  }

}


/* =========================================================
   MODAL
========================================================= */

function abrirModalAuth(
  modo = "login"
) {

  const modal =
    document.getElementById(
      "authModal"
    );


  if (!modal) {
    return;
  }


  modal.classList.add(
    "open"
  );


  modal.setAttribute(
    "aria-hidden",
    "false"
  );


  mostrarFormularioAuth(
    modo
  );


  document.body.style.overflow =
    "hidden";

}


/* =========================================================
   FECHAR MODAL
========================================================= */

function fecharModalAuth() {

  const modal =
    document.getElementById(
      "authModal"
    );


  if (!modal) {
    return;
  }


  modal.classList.remove(
    "open"
  );


  modal.setAttribute(
    "aria-hidden",
    "true"
  );


  document.body.style.overflow =
    "";

}


/* =========================================================
   MOSTRAR FORMULÁRIO
========================================================= */

function mostrarFormularioAuth(
  modo
) {

  const login =
    document.getElementById(
      "formLogin"
    );


  const cadastro =
    document.getElementById(
      "formCadastro"
    );


  if (!login || !cadastro) {
    return;
  }


  if (
    modo === "cadastro"
  ) {

    login.style.display =
      "none";

    cadastro.style.display =
      "block";

  } else {

    login.style.display =
      "block";

    cadastro.style.display =
      "none";

  }


  /*
   * Limpa mensagens antigas
   * ao trocar de formulário.
   */

  const erroLogin =
    document.getElementById(
      "erroLogin"
    );


  const erroCadastro =
    document.getElementById(
      "erroCadastro"
    );


  if (erroLogin) {

    erroLogin.textContent =
      "";

  }


  if (erroCadastro) {

    erroCadastro.textContent =
      "";

  }

}


/* =========================================================
   CADASTRO
========================================================= */

async function cadastrarUsuario() {

  const nomeInput =
    document.getElementById(
      "cadastroNome"
    );


  const emailInput =
    document.getElementById(
      "cadastroEmail"
    );


  const senhaInput =
    document.getElementById(
      "cadastroSenha"
    );


  const confirmarInput =
    document.getElementById(
      "cadastroConfirmarSenha"
    );


  const erro =
    document.getElementById(
      "erroCadastro"
    );


  if (
    !nomeInput ||
    !emailInput ||
    !senhaInput ||
    !confirmarInput
  ) {

    console.error(
      "Campos de cadastro não encontrados."
    );

    return;

  }


  const nome =
    nomeInput.value.trim();


  const email =
    emailInput.value.trim();


  const senha =
    senhaInput.value;


  const confirmar =
    confirmarInput.value;


  /*
   * Validação do nome.
   */

  if (!nome) {

    mostrarErroAuth(
      erro,
      "Digite seu nome."
    );

    nomeInput.focus();

    return;

  }


  if (
    nome.length < 2
  ) {

    mostrarErroAuth(
      erro,
      "Digite um nome válido."
    );

    nomeInput.focus();

    return;

  }


  /*
   * Validação do e-mail.
   */

  if (!email) {

    mostrarErroAuth(
      erro,
      "Digite seu e-mail."
    );

    emailInput.focus();

    return;

  }


  /*
   * Validação da senha.
   */

  if (
    senha.length < 6
  ) {

    mostrarErroAuth(
      erro,
      "A senha precisa ter pelo menos 6 caracteres."
    );

    senhaInput.focus();

    return;

  }


  /*
   * Confirmação.
   */

  if (
    senha !== confirmar
  ) {

    mostrarErroAuth(
      erro,
      "As senhas não são iguais."
    );

    confirmarInput.focus();

    return;

  }


  mostrarErroAuth(
    erro,
    ""
  );


  const botao =
    document.getElementById(
      "botaoCadastro"
    );


  if (botao) {

    botao.disabled =
      true;

    botao.textContent =
      "Criando conta...";

  }


  const cliente =
    obterSupabaseLogin();


  if (!cliente) {

    mostrarErroAuth(
      erro,
      "Não foi possível conectar ao sistema de login."
    );


    if (botao) {

      botao.disabled =
        false;

      botao.textContent =
        "Criar conta";

    }


    return;

  }


  try {

    const {
      data,
      error
    } =
      await cliente.auth.signUp({

        email,

        password: senha,

        options: {

          data: {
            nome
          }

        }

      });


    if (error) {

      console.error(
        "Erro ao criar conta:",
        error
      );


      mostrarErroAuth(
        erro,
        traduzirErroAuth(
          error
        )
      );


      return;

    }


    /*
     * Se o Supabase retornou sessão,
     * o usuário já está autenticado.
     */

    if (
      data?.session &&
      data?.user
    ) {

      atualizarUsuarioAtual(
        data.user
      );


      fecharModalAuth();


      await mostrarUsuarioLogado(
        data.user
      );


      return;

    }


    /*
     * Caso a confirmação de e-mail esteja
     * ativada no Supabase.
     */

    mostrarErroAuth(
      erro,
      "Conta criada. Agora faça login."
    );


    mostrarFormularioAuth(
      "login"
    );


    const loginEmail =
      document.getElementById(
        "loginEmail"
      );


    if (loginEmail) {

      loginEmail.value =
        email;

    }

  } catch (erroCadastro) {

    console.error(
      "Erro inesperado no cadastro:",
      erroCadastro
    );


    mostrarErroAuth(
      erro,
      "Não foi possível criar sua conta."
    );

  } finally {

    if (botao) {

      botao.disabled =
        false;

      botao.textContent =
        "Criar conta";

    }

  }

}


/* =========================================================
   LOGIN
========================================================= */

async function fazerLogin() {

  const emailInput =
    document.getElementById(
      "loginEmail"
    );


  const senhaInput =
    document.getElementById(
      "loginSenha"
    );


  const erro =
    document.getElementById(
      "erroLogin"
    );


  if (
    !emailInput ||
    !senhaInput
  ) {

    console.error(
      "Campos de login não encontrados."
    );

    return;

  }


  const email =
    emailInput.value.trim();


  const senha =
    senhaInput.value;


  /*
   * Validação.
   */

  if (!email) {

    mostrarErroAuth(
      erro,
      "Digite seu e-mail."
    );

    emailInput.focus();

    return;

  }


  if (!senha) {

    mostrarErroAuth(
      erro,
      "Digite sua senha."
    );

    senhaInput.focus();

    return;

  }


  mostrarErroAuth(
    erro,
    ""
  );


  const botao =
    document.getElementById(
      "botaoLogin"
    );


  if (botao) {

    botao.disabled =
      true;

    botao.textContent =
      "Entrando...";

  }


  const cliente =
    obterSupabaseLogin();


  if (!cliente) {

    mostrarErroAuth(
      erro,
      "Não foi possível conectar ao sistema de login."
    );


    if (botao) {

      botao.disabled =
        false;

      botao.textContent =
        "Entrar";

    }


    return;

  }


  try {

    const {
      data,
      error
    } =
      await cliente.auth.signInWithPassword({

        email,

        password: senha

      });


    if (error) {

      console.error(
        "Erro ao entrar:",
        error
      );


      mostrarErroAuth(
        erro,
        traduzirErroAuth(
          error
        )
      );


      return;

    }


    const user =
      data?.user ||
      data?.session?.user ||
      null;


    if (!user) {

      mostrarErroAuth(
        erro,
        "Não foi possível identificar o usuário."
      );

      return;

    }


    atualizarUsuarioAtual(
      user
    );


    fecharModalAuth();


    await mostrarUsuarioLogado(
      user
    );

  } catch (erroLogin) {

    console.error(
      "Erro inesperado no login:",
      erro
    );


    mostrarErroAuth(
      erro,
      "Não foi possível entrar na conta."
    );

  } finally {

    if (botao) {

      botao.disabled =
        false;

      botao.textContent =
        "Entrar";

    }

  }

}


/* =========================================================
   LOGOUT
========================================================= */

async function sairUsuario() {

  const cliente =
    obterSupabaseLogin();


  if (!cliente) {
    return;
  }


  try {

    const {
      error
    } =
      await cliente.auth.signOut();


    if (error) {

      console.error(
        "Erro ao sair:",
        error
      );

      return;

    }


    atualizarUsuarioAtual(
      null
    );


    mostrarUsuarioDeslogado();


    /*
     * Fecha o modal caso esteja aberto.
     */

    fecharModalAuth();

  } catch (erro) {

    console.error(
      "Erro inesperado ao sair:",
      erro
    );

  }

}


/* =========================================================
   ERROS
========================================================= */

function mostrarErroAuth(
  elemento,
  mensagem
) {

  if (!elemento) {
    return;
  }


  elemento.textContent =
    mensagem || "";

}


/* =========================================================
   TRADUZIR ERROS DO SUPABASE
========================================================= */

function traduzirErroAuth(
  error
) {

  const mensagem =
    String(
      error?.message || ""
    ).toLowerCase();


  if (
    mensagem.includes(
      "user already registered"
    )
  ) {

    return "Este e-mail já possui uma conta.";

  }


  if (
    mensagem.includes(
      "email address already registered"
    )
  ) {

    return "Este e-mail já possui uma conta.";

  }


  if (
    mensagem.includes(
      "invalid login credentials"
    )
  ) {

    return "E-mail ou senha incorretos.";

  }


  if (
    mensagem.includes(
      "invalid credentials"
    )
  ) {

    return "E-mail ou senha incorretos.";

  }


  if (
    mensagem.includes(
      "password should be at least"
    )
  ) {

    return "A senha precisa ter pelo menos 6 caracteres.";

  }


  if (
    mensagem.includes(
      "email not confirmed"
    )
  ) {

    return "Seu e-mail ainda não foi confirmado.";

  }


  if (
    mensagem.includes(
      "too many requests"
    )
  ) {

    return "Muitas tentativas. Aguarde alguns instantes e tente novamente.";

  }


  return (
    error?.message ||
    "Não foi possível realizar a operação."
  );

}


/* =========================================================
   EVENTOS
========================================================= */

function configurarEventosLogin() {

  const abrirLogin =
    document.getElementById(
      "abrirLogin"
    );


  const abrirCadastro =
    document.getElementById(
      "abrirCadastro"
    );


  const fecharAuth =
    document.getElementById(
      "fecharAuth"
    );


  const trocarCadastro =
    document.getElementById(
      "trocarCadastro"
    );


  const trocarLogin =
    document.getElementById(
      "trocarLogin"
    );


  const botaoLogin =
    document.getElementById(
      "botaoLogin"
    );


  const botaoCadastro =
    document.getElementById(
      "botaoCadastro"
    );


  const botaoSair =
    document.getElementById(
      "botaoSair"
    );


  /*
   * ABRIR LOGIN
   */

  if (abrirLogin) {

    abrirLogin.addEventListener(
      "click",
      event => {

        event.preventDefault();

        abrirModalAuth(
          "login"
        );

      }
    );

  }


  /*
   * ABRIR CADASTRO
   */

  if (abrirCadastro) {

    abrirCadastro.addEventListener(
      "click",
      event => {

        event.preventDefault();

        abrirModalAuth(
          "cadastro"
        );

      }
    );

  }


  /*
   * FECHAR
   */

  if (fecharAuth) {

    fecharAuth.addEventListener(
      "click",
      fecharModalAuth
    );

  }


  /*
   * TROCAR PARA CADASTRO
   */

  if (trocarCadastro) {

    trocarCadastro.addEventListener(
      "click",
      event => {

        event.preventDefault();

        mostrarFormularioAuth(
          "cadastro"
        );

      }
    );

  }


  /*
   * TROCAR PARA LOGIN
   */

  if (trocarLogin) {

    trocarLogin.addEventListener(
      "click",
      event => {

        event.preventDefault();

        mostrarFormularioAuth(
          "login"
        );

      }
    );

  }


  /*
   * LOGIN
   */

  if (botaoLogin) {

    botaoLogin.addEventListener(
      "click",
      fazerLogin
    );

  }


  /*
   * CADASTRO
   */

  if (botaoCadastro) {

    botaoCadastro.addEventListener(
      "click",
      cadastrarUsuario
    );

  }


  /*
   * LOGOUT
   */

  if (botaoSair) {

    botaoSair.addEventListener(
      "click",
      sairUsuario
    );

  }


  /*
   * CLIQUE FORA DO MODAL
   */

  const modal =
    document.getElementById(
      "authModal"
    );


  if (modal) {

    modal.addEventListener(
      "click",
      event => {

        if (
          event.target ===
          modal
        ) {

          fecharModalAuth();

        }

      }
    );

  }


  /*
   * ESC
   */

  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
        "Escape"
      ) {

        const modal =
          document.getElementById(
            "authModal"
          );


        if (
          modal?.classList.contains(
            "open"
          )
        ) {

          fecharModalAuth();

        }

      }

    }
  );


  /*
   * ENTER NOS FORMULÁRIOS
   */

  const formLogin =
    document.getElementById(
      "formLogin"
    );


  if (formLogin) {

    formLogin.addEventListener(
      "submit",
      event => {

        event.preventDefault();

        fazerLogin();

      }
    );

  }


  const formCadastro =
    document.getElementById(
      "formCadastro"
    );


  if (formCadastro) {

    formCadastro.addEventListener(
      "submit",
      event => {

        event.preventDefault();

        cadastrarUsuario();

      }
    );

  }

}


/* =========================================================
   MONITORAR LOGIN
========================================================= */

function iniciarMonitoramentoAuth() {

  const cliente =
    obterSupabaseLogin();


  if (!cliente) {

    console.error(
      "Não foi possível iniciar o monitoramento de autenticação."
    );

    return;

  }


  cliente.auth.onAuthStateChange(
    async (
      event,
      session
    ) => {

      const user =
        session?.user ||
        null;


      atualizarUsuarioAtual(
        user
      );


      if (user) {

        await mostrarUsuarioLogado(
          user
        );

      } else {

        mostrarUsuarioDeslogado();

      }

    }
  );

}


/* =========================================================
   INICIALIZAÇÃO
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {

    configurarEventosLogin();

    await verificarUsuario();

    iniciarMonitoramentoAuth();

  }
);
