/* =========================================================
   ANDRELÂNDIA — GUIA TURÍSTICO

   LOCAL.JS

   RESPONSABILIDADES:
   - Carregar local
   - Galeria
   - Mapa
   - Google Maps
   - Instagram
   - WhatsApp
   - Avaliações
   - Comentários

   AUTENTICAÇÃO:
   - NÃO fica mais neste arquivo.
   - Utiliza o login.js compartilhado.
========================================================= */


/* =========================================================
   SUPABASE COMPARTILHADO
========================================================= */

/*
 * O login.js é carregado antes deste arquivo.
 *
 * Ele disponibiliza:
 *
 * window.supabaseLoginClient
 *
 * Dessa forma, index.html e local.html utilizam
 * o mesmo cliente Supabase.
 */

const supabaseClient =
  window.supabaseLoginClient;


/* =========================================================
   VARIÁVEIS
========================================================= */

const params =
  new URLSearchParams(
    window.location.search
  );

const idLocal =
  params.get("id");

let localAtual = null;

let mapaLocal = null;

let notaSelecionada = 0;

let avaliacaoAtual = null;


/* =========================================================
   VOLTAR
========================================================= */

function voltarPagina() {

  if (
    document.referrer &&
    document.referrer.includes(
      window.location.hostname
    )
  ) {

    history.back();

    return;

  }

  window.location.href =
    "../index.html";

}


/* =========================================================
   SEGURANÇA
========================================================= */

function escaparHTML(valor) {

  if (
    valor === null ||
    valor === undefined
  ) {

    return "";

  }

  return String(valor)

    .replace(
      /&/g,
      "&amp;"
    )

    .replace(
      /</g,
      "&lt;"
    )

    .replace(
      />/g,
      "&gt;"
    )

    .replace(
      /"/g,
      "&quot;"
    )

    .replace(
      /'/g,
      "&#039;"
    );

}


/* =========================================================
   CAMINHO DAS IMAGENS
========================================================= */

function corrigirCaminhoImagem(
  caminho
) {

  if (!caminho) {

    return "";

  }

  caminho =
    String(caminho).trim();


  if (
    caminho.startsWith("http://") ||
    caminho.startsWith("https://") ||
    caminho.startsWith("data:")
  ) {

    return caminho;

  }


  if (
    caminho.startsWith("/")
  ) {

    return caminho;

  }


  if (
    caminho.startsWith("./img/")
  ) {

    return (
      "../" +
      caminho.substring(2)
    );

  }


  if (
    caminho.startsWith("img/")
  ) {

    return (
      "../" +
      caminho
    );

  }


  return caminho;

}


/* =========================================================
   CARREGAR LOCAL
========================================================= */

async function carregarLocal() {

  if (!idLocal) {

    mostrarErro(
      "Local não informado."
    );

    return;

  }


  try {

    const [
      locaisResponse,
      comerciosResponse,
      hospedagemResponse
    ] = await Promise.all([

      fetch(
        "../DATA/locais.json"
      ),

      fetch(
        "../DATA/comercios.json"
      ),

      fetch(
        "../DATA/hospedagem.json"
      )

    ]);


    if (
      !locaisResponse.ok
    ) {

      throw new Error(
        "Não foi possível carregar locais.json"
      );

    }


    if (
      !comerciosResponse.ok
    ) {

      throw new Error(
        "Não foi possível carregar comercios.json"
      );

    }


    if (
      !hospedagemResponse.ok
    ) {

      throw new Error(
        "Não foi possível carregar hospedagem.json"
      );

    }


    const locais =
      await locaisResponse.json();


    const comercios =
      await comerciosResponse.json();


    const hospedagens =
      await hospedagemResponse.json();


    const todos = [

      ...(
        Array.isArray(locais)
          ? locais
          : []
      ),

      ...(
        Array.isArray(comercios)
          ? comercios
          : []
      ),

      ...(
        Array.isArray(hospedagens)
          ? hospedagens
          : []
      )

    ];


    localAtual =
      todos.find(
        item =>
          String(item.id) ===
          String(idLocal)
      );


    if (!localAtual) {

      console.error(
        "ID não encontrado:",
        idLocal
      );

      mostrarErro(
        "Local não encontrado."
      );

      return;

    }


    console.log(
      "Local carregado:",
      localAtual
    );


    preencherPagina(
      localAtual
    );


    await carregarAvaliacoes();

    /*
     * O login.js é responsável por verificar
     * a sessão do usuário.
     *
     * Aqui verificamos apenas a avaliação
     * específica desse usuário.
     */

    await verificarAvaliacaoUsuario();


  } catch (erro) {

    console.error(
      "Erro ao carregar local:",
      erro
    );

    mostrarErro(
      "Não foi possível carregar as informações deste lugar."
    );

  }

}


/* =========================================================
   PREENCHER PÁGINA
========================================================= */

function preencherPagina(item) {

  document.title =
    `${item.nome || "Local"} — Guia Turístico de Andrelândia`;


  const nomeElemento =
    document.getElementById(
      "nomeLocal"
    );


  if (nomeElemento) {

    nomeElemento.textContent =
      item.nome || "Local";

  }


  const categoriaElemento =
    document.getElementById(
      "categoriaLocal"
    );


  if (categoriaElemento) {

    categoriaElemento.textContent =
      item.categoria || "LOCAL";

  }


  const descricao =
    item.descricao ||
    item.historia ||
    "Conheça este lugar em Andrelândia.";


  const descricaoElemento =
    document.getElementById(
      "descricaoLocal"
    );


  if (descricaoElemento) {

    descricaoElemento.textContent =
      descricao;

  }


  const historiaElemento =
    document.getElementById(
      "historiaLocal"
    );


  if (historiaElemento) {

    if (item.historia) {

      historiaElemento.textContent =
        item.historia;

    } else {

      if (
        historiaElemento.parentElement
      ) {

        historiaElemento.parentElement.style.display =
          "none";

      }

    }

  }


  const curiosidadesElemento =
    document.getElementById(
      "curiosidadesLocal"
    );


  if (curiosidadesElemento) {

    if (item.curiosidades) {

      curiosidadesElemento.textContent =
        item.curiosidades;

    } else {

      if (
        curiosidadesElemento.parentElement
      ) {

        curiosidadesElemento.parentElement.style.display =
          "none";

      }

    }

  }


  const horarioElemento =
    document.getElementById(
      "horarioLocal"
    );


  if (horarioElemento) {

    horarioElemento.innerHTML =
      formatarHorario(
        item.horario
      );

  }


  const enderecoElemento =
    document.getElementById(
      "enderecoLocal"
    );


  if (enderecoElemento) {

    enderecoElemento.textContent =
      item.endereco ||
      item.endereço ||
      "Endereço não informado";

  }


  const entradaElemento =
    document.getElementById(
      "entradaLocal"
    );


  if (entradaElemento) {

    entradaElemento.textContent =
      item.entrada ||
      "Não informado";

  }


  const telefoneElemento =
    document.getElementById(
      "telefoneLocal"
    );


  if (telefoneElemento) {

    if (item.telefone) {

      telefoneElemento.textContent =
        item.telefone;

    } else {

      if (
        telefoneElemento.parentElement
      ) {

        telefoneElemento.parentElement.style.display =
          "none";

      }

    }

  }


  const siteElemento =
    document.getElementById(
      "siteLocal"
    );


  if (siteElemento) {

    if (item.site) {

      siteElemento.href =
        item.site;

      siteElemento.style.display =
        "flex";

    } else {

      siteElemento.style.display =
        "none";

    }

  }


configurarInstagram(item);
configurarWhatsApp(item);
configurarGaleria(item);
configurarMapa(item);
configurarGoogleMaps(item);
configurarSugestaoAlteracao();
}

function configurarSugestaoAlteracao() {
const botao =
document.getElementById(
"botaoSugerirAlteracao"
);

if (!botao || !idLocal) {
return;
}

botao.href =
`../pages/cadastros.html?tipo=alteracao&local=${encodeURIComponent(idLocal)}`;
}

/* =========================================================
   HORÁRIO
========================================================= */

function formatarHorario(
  horario
) {

  if (!horario) {

    return "Horário não informado";

  }


  if (
    typeof horario === "string"
  ) {

    return escaparHTML(
      horario
    );

  }


  if (
    typeof horario === "object"
  ) {

    return Object.entries(
      horario
    )

      .map(
        ([dia, hora]) => {

          return `

            <div>

              <strong>
                ${escaparHTML(dia)}:
              </strong>

              ${escaparHTML(hora)}

            </div>

          `;

        }
      )

      .join("");

  }


  return "Horário não informado";

}


/* =========================================================
   INSTAGRAM
========================================================= */

function configurarInstagram(
  item
) {

  const link =
    document.getElementById(
      "instagramLocal"
    );


  const nome =
    document.getElementById(
      "instagramNome"
    );


  if (!link) {

    return;

  }


  const instagram =
    String(
      item.instagram || ""
    ).trim();


  if (!instagram) {

    link.style.display =
      "none";

    return;

  }


  let url =
    instagram;


  /*
   * Aceita:
   *
   * https://www.instagram.com/vagaolanches_/
   *
   * ou:
   *
   * vagaolanches_
   */

  if (
    !/^https?:\/\//i.test(
      url
    )
  ) {

    url =
      `https://www.instagram.com/${url.replace(/^@/, "")}/`;

  }


  if (nome) {

    nome.textContent =
      "Instagram";

  }


  link.href =
    url;

  link.target =
    "_blank";

  link.rel =
    "noopener noreferrer";

  link.style.display =
    "flex";

}


/* =========================================================
   WHATSAPP
========================================================= */

function configurarWhatsApp(
  item
) {

  const link =
    document.getElementById(
      "whatsappLocal"
    );


  const nome =
    document.getElementById(
      "whatsappNome"
    );


  if (!link) {

    return;

  }


  const telefone =
    item.telefone ||
    item.whatsapp ||
    "";


  if (
    !String(telefone).trim()
  ) {

    link.style.display =
      "none";

    return;

  }


  let numero =
    String(telefone)
      .replace(
        /\D/g,
        ""
      );


  if (!numero) {

    link.style.display =
      "none";

    return;

  }


  if (
    !numero.startsWith("55")
  ) {

    numero =
      "55" + numero;

  }


  if (nome) {

    nome.textContent =
      "WhatsApp";

  }


  link.href =
    `https://wa.me/${numero}`;

  link.target =
    "_blank";

  link.rel =
    "noopener noreferrer";

  link.style.display =
    "flex";

}


/* =========================================================
   GALERIA
========================================================= */

function configurarGaleria(item) {

const principal =
document.getElementById(
"fotoPrincipal"
);

const miniaturas =
document.getElementById(
"miniaturas"
);

if (
!principal ||
!miniaturas
) {
return;
}

let fotos = [];

/*

=========================================================
IMAGEM PRINCIPAL DO COMÉRCIO
=========================================================


Comercios.json utiliza:


"imagem": "https://..."
*/

if (item.imagem) {

const imagem =
  corrigirCaminhoImagem(
    item.imagem
  );

if (
  imagem &&
  !fotos.includes(imagem)
) {
  fotos.push(
    imagem
  );
}

}

/*

=========================================================
ARRAY DE IMAGENS DO COMÉRCIO
=========================================================


Comercios.json também utiliza:


"imagens": [
"https://..."
]
*/

if (
Array.isArray(
item.imagens
)
) {

item.imagens.forEach(
  foto => {

    const caminho =
      corrigirCaminhoImagem(
        foto
      );

    if (
      caminho &&
      !fotos.includes(
        caminho
      )
    ) {
      fotos.push(
        caminho
      );
    }

  }
);

}

/*

=========================================================
IMAGEM DO SUPABASE STORAGE
=========================================================


Compatibilidade com cadastros que ainda possuam:


"imagem_url": "https://..."
*/

if (item.imagem_url) {

const imagemUrl =
  corrigirCaminhoImagem(
    item.imagem_url
  );

if (
  imagemUrl &&
  !fotos.includes(
    imagemUrl
  )
) {
  fotos.push(
    imagemUrl
  );
}

}

/*

=========================================================
CAPA
=========================================================


Utilizado pelos locais tradicionais.
*/

if (item.capa) {

const capa =
  corrigirCaminhoImagem(
    item.capa
  );

if (
  capa &&
  !fotos.includes(
    capa
  )
) {
  fotos.push(
    capa
  );
}

}

/*

=========================================================
GALERIA
=========================================================
*/

if (
Array.isArray(
item.galeria
)
) {

item.galeria.forEach(
  foto => {

    const caminho =
      corrigirCaminhoImagem(
        foto
      );

    if (
      caminho &&
      !fotos.includes(
        caminho
      )
    ) {
      fotos.push(
        caminho
      );
    }

  }
);

}

/*

=========================================================
FOTOS
=========================================================
*/

if (
Array.isArray(
item.fotos
)
) {

item.fotos.forEach(
  foto => {

    const caminho =
      corrigirCaminhoImagem(
        foto
      );

    if (
      caminho &&
      !fotos.includes(
        caminho
      )
    ) {
      fotos.push(
        caminho
      );
    }

  }
);

}

/*

=========================================================
SEM FOTOS
=========================================================
*/

if (
fotos.length === 0
) {

principal.style.display =
  "none";

miniaturas.innerHTML = `
  <div class="empty-comments">
    Nenhuma foto disponível.
  </div>
`;

return;

}

/*

=========================================================
FOTO PRINCIPAL
=========================================================
*/

principal.style.display =
"";

principal.src =
fotos[0];

principal.alt =
item.nome ||
"Foto do local";

principal.onerror =
() => {

  console.error(
    "Erro ao carregar imagem:",
    principal.src
  );

};

/*

=========================================================
MINIATURAS
=========================================================
*/

miniaturas.innerHTML =
"";

fotos.forEach(
(
foto,
index
) => {

  const button =
    document.createElement(
      "button"
    );

  button.type =
    "button";

  button.className =
    "thumbnail";

  if (
    index === 0
  ) {

    button.classList.add(
      "active"
    );

  }

  const imagem =
    document.createElement(
      "img"
    );

  imagem.src =
    foto;

  imagem.alt =
    `Foto ${index + 1}`;

  imagem.onerror =
    () => {

      console.error(
        "Erro ao carregar miniatura:",
        foto
      );

    };

  button.appendChild(
    imagem
  );

  button.addEventListener(
    "click",
    () => {

      principal.src =
        foto;

      document
        .querySelectorAll(
          ".thumbnail"
        )
        .forEach(
          item =>
            item.classList.remove(
              "active"
            )
        );

      button.classList.add(
        "active"
      );

    }
  );

  miniaturas.appendChild(
    button
  );

}

);
}
/* =========================================================
   MAPA
========================================================= */

function configurarMapa(
  item
) {

  const latitude =
    Number(
      item.latitude
    );


  const longitude =
    Number(
      item.longitude
    );


  const elementoMapa =
    document.getElementById(
      "localMap"
    );


  if (!elementoMapa) {

    return;

  }


  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {

    elementoMapa.innerHTML = `

      <div style="
        height:100%;
        display:grid;
        place-items:center;
        padding:20px;
        color:#777;
        text-align:center;
      ">

        Localização deste lugar ainda não cadastrada.

      </div>

    `;

    return;

  }


  if (mapaLocal) {

    mapaLocal.remove();

  }


  mapaLocal =
    L.map(
      "localMap",
      {
        zoomControl: true,
        scrollWheelZoom: false,
        maxZoom: 22
      }
    )
    .setView(
      [
        latitude,
        longitude
      ],
      18
    );


  L.tileLayer(
    "https://{s}.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {

      subdomains: [
        "server",
        "services"
      ],

      maxNativeZoom: 19,

      maxZoom: 22,

      attribution:
        "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"

    }
  )
  .addTo(
    mapaLocal
  );


  const marcador =
    L.marker(
      [
        latitude,
        longitude
      ]
    )
    .addTo(
      mapaLocal
    );


  marcador.bindPopup(
    `<strong>${escaparHTML(item.nome || "Local")}</strong>`
  );


  marcador.openPopup();

}


/* =========================================================
   GOOGLE MAPS
========================================================= */

function configurarGoogleMaps(
  item
) {

  const latitude =
    Number(
      item.latitude
    );


  const longitude =
    Number(
      item.longitude
    );


  const botao =
    document.getElementById(
      "comoChegar"
    );


  if (!botao) {

    return;

  }


  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {

    botao.style.display =
      "none";

    return;

  }


  const destino =
    `${latitude},${longitude}`;


  botao.href =
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)}`;


  botao.target =
    "_blank";


  botao.rel =
    "noopener noreferrer";

}


/* =========================================================
   FOTO EM TELA CHEIA
========================================================= */

function abrirFotoTelaCheia() {

  const principal =
    document.getElementById(
      "fotoPrincipal"
    );


  const viewer =
    document.getElementById(
      "photoViewer"
    );


  const viewerImage =
    document.getElementById(
      "viewerImage"
    );


  if (
    !principal ||
    !viewer ||
    !viewerImage ||
    !principal.src
  ) {

    return;

  }


  viewerImage.src =
    principal.src;


  viewer.classList.add(
    "open"
  );


  document.body.style.overflow =
    "hidden";

}


function fecharFotoTelaCheia() {

  const viewer =
    document.getElementById(
      "photoViewer"
    );


  if (!viewer) {

    return;

  }


  viewer.classList.remove(
    "open"
  );


  document.body.style.overflow =
    "";

}


document.addEventListener(
  "keydown",
  event => {

    if (
      event.key ===
      "Escape"
    ) {

      fecharFotoTelaCheia();

    }

  }
);


/* =========================================================
   ESTRELAS
========================================================= */

function atualizarEstrelas(
  quantidade
) {

  const botoes =
    document.querySelectorAll(
      ".star-button"
    );


  botoes.forEach(
    botao => {

      const valor =
        Number(
          botao.dataset.rating
        );


      const imagem =
        botao.querySelector(
          "img"
        );


      if (!imagem) {

        return;

      }


      if (
        valor <= quantidade
      ) {

        imagem.src =
          "../img/icones/estrela.png";

      } else {

        imagem.src =
          "../img/icones/estrela2.png";

      }

    }
  );

}


/* =========================================================
   ESTRELAS DA MÉDIA
========================================================= */

function criarEstrelasMedia(
  media
) {

  const container =
    document.getElementById(
      "estrelasMedia"
    );


  if (!container) {

    return;

  }


  container.innerHTML =
    "";


  for (
    let i = 1;
    i <= 5;
    i++
  ) {

    const imagem =
      document.createElement(
        "img"
      );


    imagem.className =
      "rating-star";


    imagem.src =
      i <= Math.round(media)
        ? "../img/icones/estrela.png"
        : "../img/icones/estrela2.png";


    imagem.alt =
      "";


    container.appendChild(
      imagem
    );

  }

}


/* =========================================================
   USUÁRIO ATUAL
========================================================= */

/*
 * IMPORTANTE:
 *
 * O usuário agora pertence ao login.js.
 *
 * Não existe mais uma segunda variável de usuário
 * dentro do local.js.
 */

function obterUsuarioAtual() {

  return (
    window.usuarioAtualSupabase ||
    null
  );

}


/* =========================================================
   VERIFICAR AVALIAÇÃO DO USUÁRIO
========================================================= */

async function verificarAvaliacaoUsuario() {

  const user =
    obterUsuarioAtual();


  if (
    !user ||
    !idLocal
  ) {

    return;

  }


  const {
    data,
    error
  } =
    await supabaseClient

      .from("avaliacoes")

      .select(
        "id, nota, comentario"
      )

      .eq(
        "local_id",
        idLocal
      )

      .eq(
        "usuario_id",
        user.id
      )

      .maybeSingle();


  if (error) {

    console.error(
      "Erro ao verificar avaliação:",
      error
    );

    return;

  }


  avaliacaoAtual =
    data || null;


  if (data) {

    notaSelecionada =
      data.nota;


    atualizarEstrelas(
      data.nota
    );


    const texto =
      document.getElementById(
        "textoComentario"
      );


    if (texto) {

      texto.value =
        data.comentario || "";

    }


    const botao =
      document.getElementById(
        "publicarComentario"
      );


    if (botao) {

      botao.textContent =
        "Atualizar avaliação";

    }

  } else {

    notaSelecionada =
      0;


    atualizarEstrelas(
      0
    );

  }

}


/* =========================================================
   CARREGAR AVALIAÇÕES
========================================================= */

async function carregarAvaliacoes() {

  const lista =
    document.getElementById(
      "listaComentarios"
    );


  if (
    !lista ||
    !idLocal
  ) {

    return;

  }


  const {
    data,
    error
  } =
    await supabaseClient

      .from("avaliacoes")

      .select(
        "id, local_id, usuario_id, nome_usuario, nota, comentario, criado_em"
      )

      .eq(
        "local_id",
        idLocal
      )

      .order(
        "criado_em",
        {
          ascending: false
        }
      );


  if (error) {

    console.error(
      "Erro ao carregar avaliações:",
      error
    );


    lista.innerHTML = `

      <div class="empty-comments">
        Não foi possível carregar as avaliações.
      </div>

    `;

    return;

  }


  atualizarResumoAvaliacoes(
    data || []
  );


  lista.innerHTML =
    "";


  if (
    !data ||
    data.length === 0
  ) {

    lista.innerHTML = `

      <div class="empty-comments">
        Ainda não há avaliações.
        Seja o primeiro a avaliar!
      </div>

    `;

    return;

  }


  data.forEach(
    avaliacao => {

      const elemento =
        document.createElement(
          "div"
        );


      elemento.className =
        "comment";


      const dataFormatada =
        formatarData(
          avaliacao.criado_em
        );


      const estrelas =
        criarHTMLestrelas(
          avaliacao.nota
        );


      elemento.innerHTML = `

        <div class="comment-header">

          <strong>
            ${escaparHTML(
              avaliacao.nome_usuario
            )}
          </strong>

          <span>
            ${escaparHTML(
              dataFormatada
            )}
          </span>

        </div>


        <div class="comment-stars">
          ${estrelas}
        </div>


        <p>
          ${escaparHTML(
            avaliacao.comentario
          )}
        </p>

      `;


      const usuarioAtual =
        obterUsuarioAtual();


      if (
        usuarioAtual &&
        usuarioAtual.id ===
        avaliacao.usuario_id
      ) {

        const acoes =
          document.createElement(
            "div"
          );


        acoes.className =
          "comment-actions";


        const editar =
          document.createElement(
            "button"
          );


        editar.type =
          "button";

        editar.className =
          "delete-comment";

        editar.textContent =
          "Editar";


        editar.addEventListener(
          "click",
          () => {

            editarAvaliacao(
              avaliacao
            );

          }
        );


        const excluir =
          document.createElement(
            "button"
          );


        excluir.type =
          "button";

        excluir.className =
          "delete-comment";

        excluir.textContent =
          "Excluir";


        excluir.addEventListener(
          "click",
          () => {

            excluirAvaliacao(
              avaliacao.id
            );

          }
        );


        acoes.appendChild(
          editar
        );


        acoes.appendChild(
          excluir
        );


        elemento.appendChild(
          acoes
        );

      }


      lista.appendChild(
        elemento
      );

    }
  );

}


/* =========================================================
   RESUMO
========================================================= */

function atualizarResumoAvaliacoes(
  avaliacoes
) {

  const mediaElemento =
    document.getElementById(
      "mediaAvaliacoes"
    );


  const quantidadeElemento =
    document.getElementById(
      "quantidadeAvaliacoes"
    );


  const quantidade =
    avaliacoes.length;


  let media =
    0;


  if (
    quantidade > 0
  ) {

    const soma =
      avaliacoes.reduce(
        (
          total,
          item
        ) =>

          total +
          Number(
            item.nota || 0
          ),

        0
      );


    media =
      soma / quantidade;

  }


  if (mediaElemento) {

    mediaElemento.textContent =
      media
        .toFixed(1)
        .replace(
          ".",
          ","
        );

  }


  if (
    quantidadeElemento
  ) {

    quantidadeElemento.textContent =

      quantidade === 0

        ? "Nenhuma avaliação"

        : quantidade === 1

          ? "1 avaliação"

          : `${quantidade} avaliações`;

  }


  criarEstrelasMedia(
    media
  );

}


/* =========================================================
   CRIAR ESTRELAS HTML
========================================================= */

function criarHTMLestrelas(
  nota
) {

  let html =
    "";


  for (
    let i = 1;
    i <= 5;
    i++
  ) {

    html += `

      <img
        class="comment-star"
        src="${
          i <= nota
            ? "../img/icones/estrela.png"
            : "../img/icones/estrela2.png"
        }"
        alt=""
      >

    `;

  }


  return html;

}


/* =========================================================
   DATA
========================================================= */

function formatarData(
  valor
) {

  if (!valor) {

    return "";

  }


  const data =
    new Date(
      valor
    );


  if (
    Number.isNaN(
      data.getTime()
    )
  ) {

    return "";

  }


  return data.toLocaleDateString(
    "pt-BR"
  );

}


/* =========================================================
   PUBLICAR / ATUALIZAR
========================================================= */

async function publicarComentario() {

  const textoInput =
    document.getElementById(
      "textoComentario"
    );


  if (
    !textoInput ||
    !idLocal
  ) {

    return;

  }


  const texto =
    textoInput.value.trim();


  if (
    notaSelecionada < 1 ||
    notaSelecionada > 5
  ) {

    alert(
      "Escolha uma nota de 1 a 5 estrelas."
    );

    return;

  }


  if (!texto) {

    alert(
      "Escreva um comentário."
    );

    textoInput.focus();

    return;

  }


  if (
    texto.length > 500
  ) {

    alert(
      "O comentário pode ter no máximo 500 caracteres."
    );

    return;

  }


  /*
   * Usuário vem do login.js.
   */

  const user =
    obterUsuarioAtual();


  if (!user) {

    abrirModalAuth(
      "login"
    );

    return;

  }


  const nome =
    user.user_metadata?.nome ||
    user.email?.split("@")[0] ||
    "Usuário";


  const botao =
    document.getElementById(
      "publicarComentario"
    );


  if (botao) {

    botao.disabled =
      true;

    botao.textContent =
      avaliacaoAtual
        ? "Atualizando..."
        : "Publicando...";

  }


  let resultado;


  if (
    avaliacaoAtual
  ) {

    resultado =
      await supabaseClient

        .from("avaliacoes")

        .update({

          nota:
            notaSelecionada,

          comentario:
            texto,

          nome_usuario:
            nome

        })

        .eq(
          "id",
          avaliacaoAtual.id
        )

        .eq(
          "usuario_id",
          user.id
        );

  } else {

    resultado =
      await supabaseClient

        .from("avaliacoes")

        .insert({

          local_id:
            idLocal,

          usuario_id:
            user.id,

          nome_usuario:
            nome,

          nota:
            notaSelecionada,

          comentario:
            texto

        });

  }


  if (botao) {

    botao.disabled =
      false;

    botao.textContent =
      avaliacaoAtual
        ? "Atualizar avaliação"
        : "Publicar avaliação";

  }


  if (
    resultado.error
  ) {

    console.error(
      "Erro ao salvar avaliação:",
      resultado.error
    );


    alert(
      "Não foi possível salvar sua avaliação."
    );

    return;

  }


  alert(
    avaliacaoAtual
      ? "Sua avaliação foi atualizada!"
      : "Sua avaliação foi publicada!"
  );


  textoInput.value =
    "";


  notaSelecionada =
    0;


  avaliacaoAtual =
    null;


  atualizarEstrelas(
    0
  );


  if (botao) {

    botao.textContent =
      "Publicar avaliação";

  }


  await carregarAvaliacoes();

  await verificarAvaliacaoUsuario();

}


/* =========================================================
   EDITAR
========================================================= */

function editarAvaliacao(
  avaliacao
) {

  const area =
    document.getElementById(
      "areaAvaliacao"
    );


  if (area) {

    area.scrollIntoView({

      behavior:
        "smooth",

      block:
        "center"

    });

  }


  notaSelecionada =
    avaliacao.nota;


  atualizarEstrelas(
    avaliacao.nota
  );


  const texto =
    document.getElementById(
      "textoComentario"
    );


  if (texto) {

    texto.value =
      avaliacao.comentario;


    texto.focus();

  }


  avaliacaoAtual =
    avaliacao;


  const botao =
    document.getElementById(
      "publicarComentario"
    );


  if (botao) {

    botao.textContent =
      "Atualizar avaliação";

  }

}


/* =========================================================
   EXCLUIR
========================================================= */

async function excluirAvaliacao(
  id
) {

  const confirmar =
    window.confirm(
      "Deseja realmente excluir sua avaliação?"
    );


  if (!confirmar) {

    return;

  }


  const user =
    obterUsuarioAtual();


  if (!user) {

    abrirModalAuth(
      "login"
    );

    return;

  }


  const {
    error
  } =
    await supabaseClient

      .from("avaliacoes")

      .delete()

      .eq(
        "id",
        id
      )

      .eq(
        "usuario_id",
        user.id
      );


  if (error) {

    console.error(
      "Erro ao excluir avaliação:",
      error
    );


    alert(
      "Não foi possível excluir a avaliação."
    );

    return;

  }


  avaliacaoAtual =
    null;


  notaSelecionada =
    0;


  atualizarEstrelas(
    0
  );


  const texto =
    document.getElementById(
      "textoComentario"
    );


  if (texto) {

    texto.value =
      "";

  }


  await carregarAvaliacoes();

}


/* =========================================================
   ERRO
========================================================= */

function mostrarErro(
  mensagem
) {

  const pagina =
    document.querySelector(
      ".local-page"
    );


  if (!pagina) {

    return;

  }


  pagina.innerHTML = `

    <div style="
      min-height:100vh;
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      padding:30px;
      text-align:center;
    ">

      <h1 style="
        color:#091D1C;
        font-family:Georgia,serif;
      ">

        Ops!

      </h1>


      <p style="
        color:#666;
        line-height:1.6;
      ">

        ${escaparHTML(
          mensagem
        )}

      </p>


      <a
        href="../index.html"
        style="
          margin-top:15px;
          padding:12px 20px;
          background:#091D1C;
          color:#fff;
          border-radius:9px;
          font-weight:bold;
        "
      >

        Voltar ao início

      </a>

    </div>

  `;

}


/* =========================================================
   EVENTOS DA PÁGINA
========================================================= */

function configurarEventos() {

  const botaoPublicar =
    document.getElementById(
      "publicarComentario"
    );


  /*
   * PUBLICAR AVALIAÇÃO
   */

  if (botaoPublicar) {

    botaoPublicar.addEventListener(
      "click",
      publicarComentario
    );

  }


  /*
   * ESTRELAS
   */

  document
    .querySelectorAll(
      ".star-button"
    )
    .forEach(
      botao => {

        botao.addEventListener(
          "click",
          () => {

            notaSelecionada =
              Number(
                botao.dataset.rating
              );


            atualizarEstrelas(
              notaSelecionada
            );

          }
        );


        botao.addEventListener(
          "mouseenter",
          () => {

            atualizarEstrelas(
              Number(
                botao.dataset.rating
              )
            );

          }
        );

      }
    );


  /*
   * VOLTAR DAS ESTRELAS
   */

  const seletor =
    document.getElementById(
      "seletorEstrelas"
    );


  if (seletor) {

    seletor.addEventListener(
      "mouseleave",
      () => {

        atualizarEstrelas(
          notaSelecionada
        );

      }
    );

  }


  /*
   * FOTO PRINCIPAL
   */

  const fotoPrincipal =
    document.getElementById(
      "fotoPrincipal"
    );


  if (fotoPrincipal) {

    fotoPrincipal.addEventListener(
      "click",
      abrirFotoTelaCheia
    );

  }


  /*
   * FECHAR VISUALIZADOR
   */

  const photoViewer =
    document.getElementById(
      "photoViewer"
    );


  if (photoViewer) {

    photoViewer.addEventListener(
      "click",
      event => {

        if (
          event.target ===
          photoViewer
        ) {

          fecharFotoTelaCheia();

        }

      }
    );

  }

}


/* =========================================================
   MONITORAR ALTERAÇÃO DE LOGIN
========================================================= */

/*
 * O login.js é o responsável pelo Supabase Auth.
 *
 * Aqui não criamos outro onAuthStateChange.
 *
 * Apenas atualizamos a avaliação quando o estado
 * do usuário mudar.
 */

if (
  supabaseClient &&
  supabaseClient.auth
) {

  supabaseClient.auth.onAuthStateChange(
    async (
      event,
      session
    ) => {

      /*
       * O login.js já atualiza:
       *
       * window.usuarioAtualSupabase
       */

      if (
        session?.user
      ) {

        await verificarAvaliacaoUsuario();

        /*
         * Recarrega os comentários para que
         * apareçam os botões Editar/Excluir
         * do usuário recém-logado.
         */

        await carregarAvaliacoes();

      } else {

        avaliacaoAtual =
          null;

        notaSelecionada =
          0;

        atualizarEstrelas(
          0
        );

        await carregarAvaliacoes();

      }

    }
  );

}


/* =========================================================
   INICIAR
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {

    configurarEventos();

    await carregarLocal();

  }
);
