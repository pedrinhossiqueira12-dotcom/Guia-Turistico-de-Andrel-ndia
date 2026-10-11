"use strict";

// Laboratorio #43. Contrato de RECUPERACAO quando o resultado de um envio
// Pix e desconhecido. Nao importar na Edge nem usar como prova bancária.
// NENHUM estado aqui autoriza um segundo POST, saque, baixa ou liberacao.
const TIPOS=new Set([
 "INTENCAO_REGISTRADA","ENVIO_INICIADO","RESPOSTA_PERDIDA",
 "HTTP_ERRO","HTTP_ACEITO","GET_PENDING","GET_DONE",
 "GET_FAILED","GET_CANCELLED","REENVIO_SOLICITADO"
]);
const GET=new Set(["GET_PENDING","GET_DONE","GET_FAILED","GET_CANCELLED"]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
function isRecord(x){return x!==null&&typeof x==="object"&&!Array.isArray(x);}
function validoId(x){return typeof x==="string"&&UUID.test(x);}
function centavos(x){return typeof x==="number"&&Number.isSafeInteger(x)&&x>0;}

function diagnosticarEnvioPixIncertoInerte(entrada){
 const x=isRecord(entrada)?entrada:{};
 const op=isRecord(x.operacao)?x.operacao:{};
 const historico=Array.isArray(x.eventos)?x.eventos:null;
 const alertas=new Set();
 if(!validoId(op.separacao_id)||!validoId(op.solicitacao_id)||
    !validoId(op.tentativa_id)||
    (op.tipo!=="saida"&&op.tipo!=="residual")||
    typeof op.referencia_externa!=="string"||
    op.referencia_externa!==("guia-exc:"+op.tipo+":"+op.solicitacao_id)||
    !centavos(op.valor_centavos)||!SHA.test(op.fingerprint_sha256))
  alertas.add("identidade_ou_valor_de_operacao_invalido");
 if(!historico)alertas.add("historico_de_eventos_ausente");
 else if(!historico.length)alertas.add("historico_vazio");
 const ids=new Map(),types=new Set();
 let ultimo=0;
 for(const raw of historico||[]){
  if(!isRecord(raw)){alertas.add("evento_malformado");continue;}
  const {evento_id,sequencia,tipo,tentativa_id,referencia_externa,valor_centavos}=raw;
  if(!validoId(evento_id)||!Number.isSafeInteger(sequencia)||sequencia<1||
    typeof tipo!=="string"||!TIPOS.has(tipo)){
   alertas.add("evento_malformado");continue;
  }
  if(ids.has(evento_id)){
   // Mesmo reenvio nunca e aceito como nova prova cronologica.
   alertas.add("identificador_de_evento_reutilizado");
   if(ids.get(evento_id)!==JSON.stringify(raw))
    alertas.add("replay_com_conteudo_contraditorio");
  }else ids.set(evento_id,JSON.stringify(raw));
  if(sequencia!==ultimo+1)alertas.add("sequencia_incompleta_ou_fora_de_ordem");
  ultimo=sequencia;
  if(tentativa_id!==op.tentativa_id||
   referencia_externa!==op.referencia_externa||
   !centavos(valor_centavos)||valor_centavos!==op.valor_centavos)
   alertas.add("identidade_bancaria_observada_divergente");
  types.add(tipo);
 }
 if(historico?.length&&historico[0]?.tipo!=="INTENCAO_REGISTRADA")
  alertas.add("intencao_inicial_ausente");
 const envioIniciado=types.has("ENVIO_INICIADO");
 const semResultado=types.has("RESPOSTA_PERDIDA")||types.has("HTTP_ERRO");
 const feito=types.has("GET_DONE");
 const falhou=types.has("GET_FAILED")||types.has("GET_CANCELLED");
 const statusAceito=types.has("HTTP_ACEITO");
 if((envioIniciado||semResultado||statusAceito||[...GET].some(t=>types.has(t)))&&
  !types.has("INTENCAO_REGISTRADA"))
  alertas.add("observacao_sem_intencao");
 if((semResultado||statusAceito||[...GET].some(t=>types.has(t)))&&!envioIniciado)
  alertas.add("resultado_sem_marco_de_envio");
 if(feito&&falhou)alertas.add("observacoes_bancarias_contraditorias");
 if(types.has("REENVIO_SOLICITADO"))alertas.add("reenvio_post_solicitado_bloqueado");
 if(semResultado)alertas.add("resultado_de_envio_incerto");
 if(statusAceito)alertas.add("http_aceito_nao_prova_liquidacao");
 if(feito)alertas.add("get_done_nao_prova_beneficiario_original");
 if(falhou)alertas.add("get_falha_nao_prova_ausencia_de_pix");
 if(types.has("GET_PENDING"))alertas.add("get_revela_processamento_possivel");
 if(!envioIniciado)alertas.add("sem_marco_local_nao_prova_que_nao_houve_pix");
 if(envioIniciado)alertas.add("envio_iniciado_nao_pode_ser_reenviado");

 const inconsistente=[...alertas].some(a=>[
  "identidade_ou_valor_de_operacao_invalido","historico_de_eventos_ausente",
  "evento_malformado","identificador_de_evento_reutilizado",
  "replay_com_conteudo_contraditorio","sequencia_incompleta_ou_fora_de_ordem",
  "identidade_bancaria_observada_divergente","intencao_inicial_ausente",
  "observacao_sem_intencao","resultado_sem_marco_de_envio"
 ].includes(a));
 const classificacao=inconsistente?"historico_inconsistente":
  feito&&falhou?"observacoes_contraditorias":
  feito?"done_nao_comprovado_independentemente":
  envioIniciado||semResultado||statusAceito?
   "envio_potencialmente_efetivado":
  "sem_prova_suficiente_de_envio_ou_ausencia";
 return Object.freeze({
  modo:"LABORATORIO_SEM_REDE",
  classificacao_documental:classificacao,
  status_operacional:"HOLD_OBRIGATORIO",
  eventos_examinados:historico?historico.length:0,
  eventos_unicos:ids.size,
  houve_marco_de_envio_no_livro_local:envioIniciado,
  existe_observacao_done_local:feito,
  resultado_de_envio_desconhecido:semResultado,
  necessita_apuracao_bancaria_independente:true,
  ausencia_pix_anterior_comprovada:false,
  beneficiario_original_confirmado:false,
  liquidacao_comprovada_independentemente:false,
  revisores_mfa_independentes_confirmados:false,
  pode_reenviar_post:false,
  pode_criar_novo_saque:false,
  pagamento_autorizado:false,
  liberacao_autorizada:false,
  baixa_realizada:false,
  movimenta_dinheiro:false,
  alertas:Object.freeze([...alertas].sort())
 });
}
module.exports={diagnosticarEnvioPixIncertoInerte};
