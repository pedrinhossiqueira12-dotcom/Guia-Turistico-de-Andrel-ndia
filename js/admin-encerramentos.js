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
  async function preconferirPagamento(tipo,item){
    const resposta=await api({
      acao:"preconferir_pagamento_excepcional_admin",
      tipo,solicitacao_id:String(item.id||"")
    });
    const c=resposta.conferencia;
    if(!c||c.pagamento_autorizado!==false||c.requer_revalidacao_transacional!==true)
      throw new Error("Resposta de pré-conferência inesperada. Pagamento permanece bloqueado.");
    aviso(
      "Pré-conferência (NÃO autoriza Pix): saldo solicitado "+
      money(c.saldo_snapshot_centavos)+"; saldo atual "+money(c.saldo_atual_centavos)+
      "; comissões liberadas "+Number(c.creditos_disponiveis||0)+
      "; créditos individualmente conferidos "+Number(c.creditos_individuais_validos||0)+
      "; soma validada "+money(c.valor_creditos_individuais_centavos)+
      "; composição integral "+(c.composicao_creditos_integra===true?"sim":"NÃO")+
      "; SHA-256 dos créditos "+(
        /^[0-9a-f]{64}$/.test(String(c.fingerprint_creditos_sha256||""))
          ? c.fingerprint_creditos_sha256 : "não disponível")+
      "; saques em aberto "+Number(c.saques_em_aberto||0)+
      "; evidências bancárias ainda sem conciliação "+Number(c.evidencias_bancarias_para_conciliar||0)+
      "; solicitações conflitantes "+Number(c.solicitacoes_sobrepostas||0)+
      (c.sem_impedimentos_identificados===true
        ? ". Créditos conferem neste instante; a SHA-256 é somente referência para auditoria, NÃO prova de pagamento. É obrigatória nova validação transacional antes de qualquer transferência."
        : ". Há divergência ou bloqueio: NÃO movimentar valores."),c.sem_impedimentos_identificados!==true
    );
  }
  async function listarAnalisesResiduais(){
    const response=await api({acao:"listar_analises_residuais_admin"});
    const lista=$("listaAnalisesResiduais");
    lista.replaceChildren();
    const solicitacoes=Array.isArray(response.solicitacoes)?response.solicitacoes:[];
    if(!solicitacoes.length){
      const li=document.createElement("li");
      li.textContent="Nenhuma revisão de saldo residual pendente.";
      lista.appendChild(li);
      return 0;
    }
    for(const item of solicitacoes){
      const li=document.createElement("li");li.className="item";
      const titulo=document.createElement("strong");
      titulo.textContent="Solicitação "+String(item.id||"").slice(0,8)+" — "+money(item.saldo_snapshot_centavos);
      const detalhe=document.createElement("p");detalhe.className="muted";
      const status=item.status==="em_analise"?"Em análise":"Pendente";
      const data=item.solicitado_em?new Date(item.solicitado_em).toLocaleDateString("pt-BR"):"Data indisponível";
      detalhe.textContent=status+" · Motivo: "+(item.motivo==="inatividade"?"Inatividade":"Encerramento")+
        " · Recebida em "+data+" · Entregador: "+String(item.motoboy_id||"").slice(0,8);
      const justificativa=document.createElement("textarea");
      justificativa.placeholder="Justificativa obrigatória para recusar a análise (20 a 1.000 caracteres)";
      justificativa.maxLength=1000;
      justificativa.setAttribute("aria-label","Justificativa da análise "+String(item.id||""));
      const linha=document.createElement("div");linha.className="row";
      const recusar=document.createElement("button");recusar.type="button";
      recusar.textContent="Recusar análise";
      const analisar=document.createElement("button");analisar.type="button";
      analisar.textContent="Colocar em análise";
      analisar.className="secondary";
      analisar.hidden=item.status!=="pendente";
      async function revisar(novoStatus){
        const texto=justificativa.value.trim();
        if(novoStatus==="recusada"&&(texto.length<20||texto.length>1000)){
          aviso("Explique o motivo da recusa com pelo menos 20 caracteres.",true);return;
        }
        const avisoConfirmacao=novoStatus==="recusada"
          ?"Encerrar somente este pedido de revisão? A remuneração continuará devida e nenhum Pix será enviado."
          :"Marcar esta solicitação como em análise, sem alterar créditos?";
        if(!window.confirm(avisoConfirmacao))return;
        recusar.disabled=true;analisar.disabled=true;justificativa.disabled=true;
        try{
          const result=await api({
            acao:"revisar_analise_residual_admin",
            solicitacao_id:String(item.id||""),
            status_esperado:String(item.status||""),
            novo_status:novoStatus,
            justificativa:texto,
          });
          await atualizar();
          aviso(result.mensagem||"Análise atualizada.");
        }catch(error){
          aviso(error.message||"A análise não pôde ser atualizada.",true);
        }finally{
          recusar.disabled=false;analisar.disabled=false;justificativa.disabled=false;
        }
      }
      recusar.addEventListener("click",()=>revisar("recusada"));
      analisar.addEventListener("click",()=>revisar("em_analise"));
      const conferir=document.createElement("button");conferir.type="button";
      conferir.className="secondary";conferir.textContent="Conferir créditos";
      conferir.addEventListener("click",async()=>{
        conferir.disabled=true;
        try{await preconferirPagamento("residual",item);}
        catch(erro){aviso(erro.message||"Pré-conferência indisponível.",true);}
        finally{conferir.disabled=false;}
      });
      linha.append(analisar,recusar,conferir);
      li.append(titulo,detalhe,justificativa,linha);
      lista.appendChild(li);
    }
    return solicitacoes.length;
  }
  async function listarRegularizacoesSaida(){
    const response=await api({acao:"listar_regularizacoes_saida_admin"});
    const lista=$("listaRegularizacoesSaida");
    lista.replaceChildren();
    const solicitacoes=Array.isArray(response.solicitacoes)?response.solicitacoes:[];
    if(!solicitacoes.length){
      const li=document.createElement("li");
      li.textContent="Nenhuma regularização financeira aguardando conferência.";
      lista.appendChild(li);return 0;
    }
    for(const item of solicitacoes){
      const li=document.createElement("li");li.className="item";
      const titulo=document.createElement("strong");
      titulo.textContent="Regularização "+String(item.id||"").slice(0,8)+" — "+money(item.saldo_snapshot_centavos);
      const detalhe=document.createElement("p");detalhe.className="muted";
      detalhe.textContent=(item.status==="em_analise"?"Em análise":"Pendente")+
        " · Motoboy: "+String(item.motoboy_id||"").slice(0,8)+
        " · Solicitação: "+(item.motivo==="inatividade"?"Inatividade":"Encerramento")+
        " · Saldo registrado na data: "+money(item.saldo_snapshot_centavos);
      const justificativa=document.createElement("textarea");
      justificativa.placeholder="Justificativa de recusa (mínimo 20 caracteres)";
      justificativa.maxLength=1000;
      justificativa.setAttribute("aria-label","Justificativa da regularização "+String(item.id||""));
      const acoes=document.createElement("div");acoes.className="row";
      const analisar=document.createElement("button");analisar.type="button";
      analisar.className="secondary";analisar.textContent="Colocar em análise";
      analisar.hidden=item.status!=="pendente";
      const recusar=document.createElement("button");recusar.type="button";
      recusar.textContent="Recusar solicitação";
      async function revisar(novo){
        const texto=justificativa.value.trim();
        if(novo==="recusada"&&(texto.length<20||texto.length>1000)){
          aviso("A recusa exige justificativa de pelo menos 20 caracteres.",true);return;
        }
        if(!window.confirm(novo==="recusada"
          ?"Recusar apenas o pedido administrativo? Os créditos continuam registrados e não serão cancelados."
          :"Marcar regularização como em análise, sem transferir valores?"))return;
        analisar.disabled=true;recusar.disabled=true;justificativa.disabled=true;
        try{
          const result=await api({acao:"revisar_regularizacao_saida_admin",
            solicitacao_id:String(item.id||""),status_esperado:String(item.status||""),
            novo_status:novo,justificativa:texto});
          await atualizar();
          aviso(result.mensagem||"Regularização atualizada.");
        }catch(error){aviso(error.message||"Não foi possível revisar a solicitação.",true);}
        finally{analisar.disabled=false;recusar.disabled=false;justificativa.disabled=false;}
      }
      analisar.addEventListener("click",()=>revisar("em_analise"));
      recusar.addEventListener("click",()=>revisar("recusada"));
      const conferir=document.createElement("button");conferir.type="button";
      conferir.className="secondary";conferir.textContent="Conferir créditos";
      conferir.addEventListener("click",async()=>{
        conferir.disabled=true;
        try{await preconferirPagamento("saida",item);}
        catch(erro){aviso(erro.message||"Pré-conferência indisponível.",true);}
        finally{conferir.disabled=false;}
      });
      acoes.append(analisar,recusar,conferir);
      li.append(titulo,detalhe,justificativa,acoes);lista.appendChild(li);
    }
    return solicitacoes.length;
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
    const analises=await listarAnalisesResiduais();
    const saidas=await listarRegularizacoesSaida();
    aviso(solicitacoes.length+" encerramento(s), "+analises+
      " análise(s) residual(is) e "+saidas+" regularização(ões) de entregadores.");
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
