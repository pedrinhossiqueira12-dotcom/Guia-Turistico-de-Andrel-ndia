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
    const foto=resposta.fotografia_bancaria||null;
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
      "; créditos em separação contábil sem baixa "+Number(c.separacoes_contabeis_sem_liquidacao||0)+
      (foto
        ? "; foto do GET bancário: "+
          (foto.composicao_conferida_na_observacao===true?"composição validada no registro":"composição NÃO validada")+
          "; comparação com créditos atuais: "+
          (foto.fingerprint_igual_ao_atual===true?"igual (não comprova Pix)":"DIVERGENTE OU AUSENTE — revisão obrigatória")+
          "; saldo registrado "+money(foto.valor_creditos_observados_centavos)
        : "; nenhuma fotografia de observação bancária registrada")+
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
  async function listarSeparacoesExcepcionais(){
    const response=await api({acao:"listar_separacoes_congeladas_admin"});
    const lista=$("listaSeparacoesExcepcionais");
    lista.replaceChildren();
    const separacoes=Array.isArray(response.separacoes)?response.separacoes:[];
    if(!separacoes.length){
      const item=document.createElement("li");
      item.textContent="Nenhuma separação contábil congelada identificada.";
      lista.appendChild(item);
    }
    for(const item of separacoes){
      const li=document.createElement("li");li.className="item";
      const title=document.createElement("strong");
      title.textContent="Créditos NÃO pagos · "+money(item.valor_centavos)+
        " · "+Number(item.creditos||0)+" comissão(ões)";
      const detail=document.createElement("p");detail.className="muted";
      detail.textContent=(item.tipo==="saida"?"Saída de entregador":"Saldo residual")+
        " · Titular "+String(item.motoboy_id||"").slice(0,8)+
        " · Separação "+String(item.id||"").slice(0,8)+
        " · Congelada em "+(item.criado_em?
          new Date(item.criado_em).toLocaleDateString("pt-BR"):"data indisponível");
      const btn=document.createElement("button");
      btn.type="button";btn.className="secondary";
      btn.textContent="Diagnosticar sem desbloquear";
      btn.addEventListener("click",async()=>{
        btn.disabled=true;
        try{
          const result=await api({acao:"diagnosticar_separacao_congelada_admin",
            separacao_id:String(item.id||"")});
          const d=result.diagnostico;
          if(d?.liberacao_automatica_autorizada!==false||
            d?.quitacao_automatica_autorizada!==false||
            d?.pode_reutilizar_creditos!==false)
            throw new Error("Diagnóstico inesperado. Saldo permanece bloqueado.");
          aviso("Diagnóstico SOMENTE LEITURA: "+
            money(d.saldo_separado_centavos)+" congelados, "+
            Number(d.quantidade_encontrada||0)+" de "+
            Number(d.quantidade_esperada||0)+" créditos localizados; "+
            (d.composicao_inalterada_e_financiada===true?
              "composição contábil conferida":"COMPOSIÇÃO DIVERGENTE — analisar")+
            "; créditos inválidos/revertidos "+
            Number(d.creditos_financeiramente_invalidos||0)+
            "; transferências bancárias observadas "+
            Number(d.observacoes_bancarias_total||0)+
            "; estados DONE observados "+Number(d.observacoes_done||0)+
            "; saque regular em aberto "+Number(d.saques_comuns_abertos||0)+
            ". Nenhum Pix criado, nenhuma baixa, nenhum desbloqueio. "+
            String(d.aviso||"Requer conciliação bancária independente."),
            d.composicao_inalterada_e_financiada!==true||
            Number(d.observacoes_bancarias_total||0)>0);
        }catch(erro){aviso(erro.message||"Diagnóstico indisponível; manter HOLD.",true);}
        finally{btn.disabled=false;}
      });
      const confronto=document.createElement("button");confronto.type="button";
      confronto.className="secondary";
      confronto.textContent="Conferir evidências bancárias (somente leitura)";
      const situacaoConfronto=document.createElement("p");
      situacaoConfronto.className="muted";
      situacaoConfronto.textContent="Sem consulta ainda. A ausência de Pix não está comprovada.";
      confronto.addEventListener("click",async()=>{
        confronto.disabled=true;
        try{
          const res=await api({acao:"matriz_conciliacao_escrow_admin",
            separacao_id:String(item.id||"")});
          const m=res.matriz;
          if(m?.evidencia_suficiente_para_liquidar!==false||
            m?.evidencia_suficiente_para_liberar!==false||
            m?.pagamento_autorizado!==false||
            m?.baixa_realizada!==false||
            m?.movimenta_dinheiro!==false)
            throw new Error("Matriz financeira insegura. Manter HOLD.");
          situacaoConfronto.textContent="HOLD OBRIGATÓRIO — "+
            Number(m.transferencias_observadas||0)+" transferência(s) associada(s), "+
            Number(m.observacoes_de_estado||0)+" estado(s) registrado(s), "+
            Number(m.transferencias_com_done||0)+" DONE, "+
            Number(m.transferencias_com_done_e_falha||0)+" estado(s) contraditório(s), "+
            Number(m.transferencias_com_retorno_a_processamento||0)+
            " retorno(s) a processamento após estado final, "+
            Number(m.transferencias_com_ordem_temporal_ambigua||0)+
            " sequência(s) de horários bancários ambíguos no resumo antigo, "+
            Number(m.consultas_get?.consultas_get_registradas||0)+
            " GET(s) individuais preservados, "+
            Number(m.consultas_get?.consultas_com_mesmo_estado_consecutivo||0)+
            " consulta(s) consecutiva(s) repetindo o mesmo estado, "+
            Number(m.consultas_get?.consultas_com_retorno_a_processamento||0)+
            " retorno(s) ao processamento nos GETs individuais, "+
            Number(m.consultas_get?.consultas_com_horarios_iguais||0)+
            " empate(s) de horário nos GETs individuais, "+
            "último GET individual (sem prova bancária final): "+
            String(m.consultas_get?.ultimo_get_observado_nao_conclusivo||"sem registro")+", "+
            "histórico anterior à nova auditoria NÃO comprovado, "+
            "último estado observado (não conclusivo): "+
            String(m.ultimo_estado_observado_sem_valor_de_prova||"não disponível")+", "+
            Number(m.transferencias_tambem_vinculadas_a_saques_comuns||0)+
            " transferência(s) também usada(s) em saque comum, "+
            Number(m.fotografias_creditos_incompletas_ou_divergentes||0)+
            " fotografia(s) incompleta(s), "+
            Number(m.contagem_sinais_de_conflito||0)+" indício(s) de divergência. "+
            String(m.alerta||"Destinatário original não comprovado.")+
            " Nenhum crédito liberado, nenhuma baixa e nenhum Pix criado.";
          aviso(situacaoConfronto.textContent,Number(m.contagem_sinais_de_conflito||0)>0);
        }catch(e){
          situacaoConfronto.textContent="Matriz indisponível; manter reserva congelada.";
          aviso(e.message||"Conciliação não disponível. Manter HOLD.",true);
        }finally{confronto.disabled=false;}
      });
      const area=document.createElement("details");
      const cab=document.createElement("summary");cab.textContent="Dossiê de conciliação (sem Pix)";
      const orientacao=document.createElement("p");orientacao.className="muted";
      orientacao.textContent="Não inclua dados pessoais, chave Pix, CPF ou conta bancária.";
      const tipo=document.createElement("select");
      for(const [val,label] of [
       ["verificacao_banco","Verificação bancária"],
       ["verificacao_destinatario","Verificação do destinatário"],
       ["comprovante_externo","Comprovante externo"],
       ["contestacao","Contestação"],
       ["divergencia","Divergência"],
       ["parecer_pendente","Parecer pendente"]]){
        const opt=document.createElement("option");opt.value=val;opt.textContent=label;tipo.appendChild(opt);
      }
      const nota=document.createElement("textarea");nota.maxLength=1000;
      nota.placeholder="Descrição da ocorrência (mínimo de 30 caracteres)";
      const hash=document.createElement("input");hash.maxLength=64;
      hash.placeholder="SHA-256 do documento, obrigatório para comprovante externo";
      const gravar=document.createElement("button");gravar.type="button";
      gravar.textContent="Registrar ocorrência (não paga)";
      const consultar=document.createElement("button");consultar.type="button";
      consultar.className="secondary";consultar.textContent="Ver histórico";
      const registros=document.createElement("ul");
      const seloIntegridade=document.createElement("p");seloIntegridade.className="muted";
      seloIntegridade.textContent="Integridade ainda não verificada. Nenhum pagamento é permitido.";
      let chaveAtual=null,assinaturaAtual=null,dossieComprometido=false;
      async function consultarDossie(){
        dossieComprometido=true;
        const res=await api({acao:"listar_dossie_escrow_admin",separacao_id:String(item.id||"")});
        registros.replaceChildren();
        const verificador=res.integridade||null;
        dossieComprometido=verificador?.ok!==true||
          verificador?.integridade_valida!==true||
          verificador?.liberacao_autorizada!==false||
          verificador?.pagamento_autorizado!==false;
        seloIntegridade.textContent=dossieComprometido
          ? "ALERTA: HISTÓRICO INCONSISTENTE OU INDISPONÍVEL. Não acrescentar registros nem liberar créditos. Primeira sequência sob suspeita: "+
            String(verificador?.primeira_sequencia_incorreta??"desconhecida")
          : "Cadeia SHA-256 local verificada ("+Number(verificador.numero_eventos||0)+
            " eventos). Hash final: "+String(verificador.hash_final_registrado_sha256||"sem eventos")+
            ". NÃO é prova bancária nem autorização de Pix; não há âncora externa.";
        gravar.disabled=dossieComprometido;
        for(const e of res.eventos||[]){
          const linha=document.createElement("li");
          linha.textContent="#"+e.seq+" · "+e.categoria+" · "+e.descricao+
            (e.documento_sha256?" · SHA-256: "+e.documento_sha256:"");
          registros.appendChild(linha);
        }
        if(res.ha_mais){
          const linha=document.createElement("li");
          linha.textContent="Histórico parcial; registros anteriores permanecem armazenados.";
          registros.appendChild(linha);
        }
      }
      gravar.addEventListener("click",async()=>{
        if(dossieComprometido){aviso("Dossiê inconsistente: novas ocorrências bloqueadas.",true);return;}
        const descricao=nota.value.trim(),documento=hash.value.trim().toLowerCase();
        if(descricao.length<30||descricao.length>1000||
          (documento&&!/^[a-f0-9]{64}$/.test(documento))||
          (tipo.value==="comprovante_externo"&&!documento)){
          aviso("Verifique o texto (30 a 1000 caracteres) e o SHA-256 do comprovante.",true);return;
        }
        const assinatura=JSON.stringify([item.id,tipo.value,descricao,documento]);
        if(assinatura!==assinaturaAtual){chaveAtual=crypto.randomUUID();assinaturaAtual=assinatura;}
        gravar.disabled=true;
        try{
          const resultado=await api({acao:"registrar_dossie_escrow_admin",
           separacao_id:String(item.id||""),chave_idempotencia:chaveAtual,
           categoria:tipo.value,descricao,documento_sha256:documento||null});
          aviso(resultado.mensagem||"Ocorrência registrada sem quitação.");
          chaveAtual=null;assinaturaAtual=null;nota.value="";hash.value="";
          await consultarDossie();
        }catch(e){aviso(e.message||"Registro não confirmado; repetição segura preservada.",true);}
        finally{gravar.disabled=dossieComprometido;}
      });
      consultar.addEventListener("click",async()=>{
        consultar.disabled=true;
        try{await consultarDossie();}
        catch(e){aviso(e.message||"Histórico indisponível.",true);}
        finally{consultar.disabled=false;}
      });
      const exportar=document.createElement("button");exportar.type="button";
      exportar.className="secondary";
      exportar.textContent="Exportar âncora SHA-256 (JSON)";
      exportar.addEventListener("click",async()=>{
        exportar.disabled=true;
        try{
          const dados=await api({acao:"exportar_ancora_dossie_admin",
            separacao_id:String(item.id||"")});
          const manifesto=dados.manifesto||null;
          if(manifesto?.ok!==true||manifesto.formato!=="GAESCROW1"||
            manifesto.cadeia_verificada_localmente!==true||
            manifesto.ancora_externa_efetuada!==false||
            manifesto.pagamento_autorizado!==false||
            manifesto.liberacao_autorizada!==false||
            manifesto.baixa_realizada!==false)
            throw new Error("Manifesto inesperado; exportação recusada.");
          const arquivo=new Blob([JSON.stringify(manifesto,null,2)],
            {type:"application/json;charset=utf-8"});
          const url=URL.createObjectURL(arquivo);
          const link=document.createElement("a");
          link.href=url;
          link.download="guia-escrow-"+String(item.id||"").toLowerCase()+
            "-"+new Date().toISOString().replace(/[:.]/g,"-")+".json";
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(()=>URL.revokeObjectURL(url),1000);
          aviso("Manifesto gerado. Guarde o JSON em local seguro, fora do Supabase, "+
            "e compare cópias futuras com scripts/verificar-ancora-escrow.cjs. "+
            "O arquivo contém identificadores financeiros e NÃO é prova de Pix.");
        }catch(e){aviso(e.message||"Não foi possível exportar âncora. Manter saldo bloqueado.",true);}
        finally{exportar.disabled=false;}
      });
      area.append(cab,orientacao,seloIntegridade,tipo,nota,hash,gravar,consultar,exportar,registros);
      li.append(title,detail,btn,confronto,situacaoConfronto,area);lista.appendChild(li);
    }
    if(response.ha_mais===true){
      const avisoLimite=document.createElement("li");
      avisoLimite.className="muted";
      avisoLimite.textContent="Mostrando apenas as 100 separações mais recentes de "+
        Number(response.total||0)+". O restante permanece armazenado e bloqueado; consulte relatório completo antes de conciliar.";
      lista.appendChild(avisoLimite);
    }
    return Number(response.total??separacoes.length);
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
    const separacoes=await listarSeparacoesExcepcionais();
    aviso(solicitacoes.length+" encerramento(s), "+analises+
      " análise(s) residual(is), "+saidas+" regularização(ões) e "+
      separacoes+" separação(ões) contábil(is) congelada(s), SEM Pix.");
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
