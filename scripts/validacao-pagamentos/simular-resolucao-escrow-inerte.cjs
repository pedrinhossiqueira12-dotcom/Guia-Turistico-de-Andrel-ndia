"use strict";

// Laboratorio #43. NUNCA importar em uma Edge de pagamentos nem chamar
// o resultado de comprovante bancario ou autorizacao. Funcao pura, sem I/O.
const ESTADOS_FUTUROS=Object.freeze([
 "revisao","contestacao","pago_comprovado","liberado_sem_pagamento"
]);
const ESTADOS_BANCO=new Set([
 "PENDING","IN_BANK_PROCESSING","BLOCKED","DONE","FAILED","CANCELLED"
]);
const LIMITE_CENTAVOS=BigInt(Number.MAX_SAFE_INTEGER);
const CENTAVOS_SAQUE_MINIMO=10000;
const CENTAVOS_TETO_POR_PIX=500000;

function centavosValidos(valor){
 return typeof valor==="number"&&Number.isSafeInteger(valor)&&valor>0;
}
function diagnosticarResolucaoEscrowInerte(entrada){
 const origem=entrada&&typeof entrada==="object"&&!Array.isArray(entrada)?entrada:{};
 const reserva=origem.separacao&&typeof origem.separacao==="object"&&
  !Array.isArray(origem.separacao)?origem.separacao:{};
 const creditos=Array.isArray(origem.creditos)?origem.creditos:null;
 const eventos=Array.isArray(origem.observacoes_bancarias)?
  origem.observacoes_bancarias:null;
 const alertas=new Set();
 if(reserva.situacao!=="congelada")alertas.add("reserva_nao_congelada");
 if(!centavosValidos(reserva.valor_centavos))
  alertas.add("valor_da_reserva_invalido");
 if(!creditos)alertas.add("amostra_de_creditos_invalida");
 else if(creditos.length===0)alertas.add("reserva_sem_creditos_na_amostra");
 const IDs=new Set(),competencias=new Set();
 let total=0n;
 for(const credito of creditos||[]){
  if(!credito||typeof credito!=="object"||Array.isArray(credito)){
   alertas.add("credito_malformado");continue;
  }
  const id=credito.remuneracao_id;
  if(typeof id!=="string"||!id||id.trim()!==id){
   alertas.add("credito_sem_identificador");
  }else if(IDs.has(id)){
   alertas.add("credito_duplicado");
  }else IDs.add(id);
  const competencia=credito.competencia;
  if(typeof competencia!=="string"||
   !/^20\d{2}-(0[1-9]|1[0-2])$/.test(competencia))
   alertas.add("competencia_invalida");
  else competencias.add(competencia);
  if(!centavosValidos(credito.valor_centavos)){
   alertas.add("valor_de_credito_invalido");
  }else total+=BigInt(credito.valor_centavos);
 }
 if(total>LIMITE_CENTAVOS)alertas.add("soma_fora_da_precisao_segura");
 if(!centavosValidos(reserva.valor_centavos)||
  total!==BigInt(centavosValidos(reserva.valor_centavos)?reserva.valor_centavos:0))
  alertas.add("soma_diferente_da_reserva");
 const totalInformado=origem.contagem_creditos_no_livro;
 if(!Number.isSafeInteger(totalInformado)||totalInformado<0)
  alertas.add("contagem_do_livro_nao_informada");
 else if(!creditos||totalInformado!==creditos.length)
  alertas.add("contagem_da_amostra_divergente");
 if(!eventos)alertas.add("observacoes_bancarias_invalidas");
 const estados=new Set();
 for(const evento of eventos||[]){
  const estado=evento&&typeof evento==="object"&&!Array.isArray(evento)?
   evento.estado_banco:null;
  if(typeof estado!=="string"||!ESTADOS_BANCO.has(estado))
   alertas.add("estado_bancario_invalido");
  else estados.add(estado);
 }
 const conflitoEstados=estados.has("DONE")&&
  (estados.has("FAILED")||estados.has("CANCELLED"));
 if(conflitoEstados)alertas.add("estados_bancarios_contraditorios");
 if([...estados].some(x=>x==="PENDING"||x==="IN_BANK_PROCESSING"||x==="BLOCKED"))
  alertas.add("processamento_bancario_observado");
 if(estados.has("DONE"))
  alertas.add("done_observado_nao_comprova_destino");
 if(estados.size===0)
  alertas.add("sem_observacao_nao_prova_ausencia_pix");
 const composicaoConsistente=creditos!==null&&creditos.length>0&&
  !["credito_malformado","credito_sem_identificador","credito_duplicado",
    "competencia_invalida","valor_de_credito_invalido","soma_fora_da_precisao_segura",
    "soma_diferente_da_reserva","contagem_da_amostra_divergente",
    "contagem_do_livro_nao_informada","reserva_nao_congelada",
    "valor_da_reserva_invalido"].some(x=>alertas.has(x));
 return Object.freeze({
  modo:"ENSAIO_OFFLINE_SOMENTE_LEITURA",
  status_operacional:"HOLD_OBRIGATORIO",
  classificacao_documental:conflitoEstados?"contestacao":"revisao",
  estados_futuros_modelados:ESTADOS_FUTUROS,
  creditos_examinados:creditos?creditos.length:0,
  competencias_examinadas:competencias.size,
  soma_centavos_na_amostra:total>LIMITE_CENTAVOS?null:Number(total),
  composicao_conferida_somente_na_amostra:composicaoConsistente,
  abaixo_minimo_saque_na_amostra:total>0n&&total<BigInt(CENTAVOS_SAQUE_MINIMO),
  acima_teto_pix_unitario_na_amostra:total>BigInt(CENTAVOS_TETO_POR_PIX),
  alertas:Object.freeze([...alertas].sort()),
  // A contagem declarada pode vir de uma amostra. Sem prova externa e
  // locks de banco nada aqui confirma completude, liquida ou libera valor.
  cobertura_integral_do_livro_comprovada:false,
  beneficiario_original_confirmado:false,
  ausencia_pix_anterior_comprovada:false,
  revisores_fortes_independentes_confirmados:false,
  aprovado_em_transacao:false,
  pagamento_autorizado:false,
  liberacao_autorizada:false,
  baixa_realizada:false,
  movimenta_dinheiro:false
 });
}
module.exports={diagnosticarResolucaoEscrowInerte};
