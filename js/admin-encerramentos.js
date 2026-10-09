/* Guia Andrelândia — revisão administrativa de encerramentos. Nenhum pagamento é disparado aqui. */
(() => {
  "use strict";
  const URL_SUPABASE="https://xdmbkflufsfqziixzpxc.supabase.co";
  const CHAVE_PUBLICA="sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  const $=id=>document.getElementById(id);
  const client=window.supabaseLoginClient||window.supabase?.createClient(URL_SUPABASE,CHAVE_PUBLICA);
  const money=n=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(n||0)/100);
  function aviso(message,erro=false){
    $("mensagem").textContent=message;
    $("mensagem").style.color=erro?"#a4332a":"";
  }
  async function api(body){
    if(!client)throw new Error("Serviço de autenticação indisponível.");
    const {data,error}=await client.functions.invoke("catalogo-asaas-financeiro",{body});
    if(error||data?.success!==true)throw new Error(data?.mensagem||error?.message||"Operação não autorizada.");
    return data;
  }
  async function atualizar(){
    aviso("Carregando solicitações…");
    const response=await api({acao:"listar_encerramentos_admin"});
    const lista=$("listaEncerramentos");
    lista.replaceChildren();
    const solicitacoes=Array.isArray(response.encerramentos)?response.encerramentos:[];
    if(!solicitacoes.length){
      const vazio=document.createElement("li");
      vazio.textContent="Nenhum encerramento aguardando análise.";
      lista.appendChild(vazio);
    }
    for(const item of solicitacoes){
      const li=document.createElement("li");li.className="item";
      const title=document.createElement("strong");title.textContent=String(item.comercio_id||"Comércio");
      const detail=document.createElement("p");detail.className="muted";
      const status=item.situacao==="aguardando_quitacao"?"Aguardando quitação":"Pendente de arquivamento";
      detail.textContent=status+" · Dívida apurada na solicitação: "+money(item.divida_apurada_centavos);
      const btn=document.createElement("button");btn.type="button";btn.textContent="Conferir e arquivar";
      btn.addEventListener("click",async()=>{
        if(!window.confirm("Conferir agora todas as faturas e pedidos deste comércio e arquivar somente se tudo estiver quitado?"))return;
        btn.disabled=true;aviso("Revalidando pendências no servidor…");
        try{
          const result=await api({acao:"finalizar_encerramento_admin",
            comercio_id:String(item.comercio_id||""),confirmacao:true});
          aviso(result.mensagem||"Arquivamento confirmado.");
          await atualizar();
        }catch(error){aviso(error.message||"Arquivamento recusado.",true);}
        finally{btn.disabled=false;}
      });
      li.append(title,detail,btn);lista.appendChild(li);
    }
    aviso(solicitacoes.length+" solicitação(ões) para conferir.");
  }
  async function iniciar(){
    if(!client){aviso("Supabase indisponível.",true);return;}
    const {data}=await client.auth.getSession();
    const active=Boolean(data?.session);
    $("loginContainer").hidden=active;$("painel").hidden=!active;
    if(active)try{await atualizar();}catch(error){
      $("painel").hidden=true;$("loginContainer").hidden=false;
      aviso(error.message||"Acesso administrativo negado.",true);
    }
  }
  $("loginForm")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const {error}=await client.auth.signInWithPassword({
      email:$("loginEmail").value.trim(),password:$("loginPassword").value
    });
    $("loginPassword").value="";
    if(error){aviso(error.message||"Credenciais inválidas.",true);return;}
    await iniciar();
  });
  $("atualizar")?.addEventListener("click",()=>atualizar().catch(e=>aviso(e.message,true)));
  $("sair")?.addEventListener("click",async()=>{await client?.auth.signOut({scope:"local"});await iniciar();});
  iniciar();
})();
