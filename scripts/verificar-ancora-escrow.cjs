#!/usr/bin/env node
"use strict";
/*
 * Verificação OFFLINE de manifesto financeiro GAESCROW1.
 * Uso:
 *   node scripts/verificar-ancora-escrow.cjs atual.json
 *   node scripts/verificar-ancora-escrow.cjs atual.json anterior.json
 *
 * O arquivo ANTERIOR deve ter sido conservado fora do Supabase.
 * Isto não é prova bancária, assinatura digital, nem verificação do
 * conteúdo de notas pessoais: audita âncora e continuidade entre cópias.
 */
const fs=require("node:fs");
const crypto=require("node:crypto");

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const sha256=value=>crypto.createHash("sha256").update(value,"utf8").digest("hex");
const fail=message=>{throw new Error(message);};
function validInteger(value,minimum,name){
 if(!Number.isSafeInteger(value)||value<minimum)fail("Número inválido em "+name);
 return String(value);
}
function validate(m){
 if(!m||typeof m!=="object"||Array.isArray(m))fail("JSON não é objeto");
 if(m.ok!==true||m.formato!=="GAESCROW1")fail("Manifesto não reconhecido");
 for(const k of ["separacao_id","solicitacao_id","motoboy_id"]){
  if(typeof m[k]!=="string"||!UUID.test(m[k]))fail("Identificador inválido: "+k);
 }
 if(!["residual","saida"].includes(m.tipo))fail("Tipo inválido");
 for(const k of ["fingerprint_creditos_sha256","hash_final_dossie_sha256","hash_ancora_sha256"]){
  if(typeof m[k]!=="string"||!SHA.test(m[k]))fail("Hash inválido: "+k);
 }
 if(m.pagamento_autorizado!==false||m.liberacao_autorizada!==false||
  m.baixa_realizada!==false||m.ancora_externa_efetuada!==false||
  m.cadeia_verificada_localmente!==true)fail("Campo de segurança do manifesto inesperado");
 const valor=validInteger(m.valor_centavos,1,"valor_centavos");
 const credits=validInteger(m.creditos,1,"creditos");
 const total=validInteger(m.eventos_total,0,"eventos_total");
 const banco=validInteger(m.observacoes_bancarias_total,0,"observacoes_bancarias_total");
 const done=validInteger(m.observacoes_done,0,"observacoes_done");
 if(m.observacoes_done>m.observacoes_bancarias_total)fail("DONE excede observações");
 if(typeof m.creditos_atuais_integros!=="boolean")fail("Integridade financeira inválida");
 if(!Array.isArray(m.eventos_hashes)||m.eventos_hashes.length!==m.eventos_total)
  fail("Lista de eventos incompleta");
 let prev="0".repeat(64);
 for(let i=0;i<m.eventos_hashes.length;i++){
  const e=m.eventos_hashes[i];
  if(!e||typeof e!=="object"||Array.isArray(e)||
    !Number.isSafeInteger(e.seq)||e.seq!==i+1||
    typeof e.hash_anterior_sha256!=="string"||!SHA.test(e.hash_anterior_sha256)||
    typeof e.evento_sha256!=="string"||!SHA.test(e.evento_sha256)||
    e.hash_anterior_sha256!==prev)fail("Encadeamento inválido no evento "+(i+1));
  prev=e.evento_sha256;
 }
 if(prev!==m.hash_final_dossie_sha256)fail("Hash final não corresponde à cadeia");
 const canon=[
  "GAESCROW1",m.separacao_id,m.tipo,m.solicitacao_id,m.motoboy_id,
  valor,credits,m.fingerprint_creditos_sha256,total,
  m.hash_final_dossie_sha256,String(m.creditos_atuais_integros),banco,done
 ].join("|");
 if(sha256(canon)!==m.hash_ancora_sha256)fail("SHA-256 da âncora divergente");
 return {hash:m.hash_ancora_sha256,eventos:m.eventos_total,valor:m.valor_centavos};
}
function read(file){
 const content=fs.readFileSync(file,"utf8");
 const json=JSON.parse(content);
 return {file,json,...validate(json)};
}
function compare(now,old){
 const a=now.json||now,b=old.json||old;
 for(const k of ["separacao_id","tipo","solicitacao_id","motoboy_id",
  "valor_centavos","creditos","fingerprint_creditos_sha256"]){
  if(a[k]!==b[k])fail("Cadastro original da reserva divergiu: "+k);
 }
 if(a.eventos_total<b.eventos_total)fail("Histórico encurtou: sumiram eventos anteriormente arquivados");
 for(let i=0;i<b.eventos_hashes.length;i++){
  const x=a.eventos_hashes[i],y=b.eventos_hashes[i];
  if(!x||x.seq!==y.seq||
    x.evento_sha256!==y.evento_sha256||
    x.hash_anterior_sha256!==y.hash_anterior_sha256)
   fail("Evento "+(i+1)+" difere da cópia arquivada");
 }
 const newEvents=a.eventos_total-b.eventos_total;
 const contextChanged=a.creditos_atuais_integros!==b.creditos_atuais_integros||
   a.observacoes_bancarias_total!==b.observacoes_bancarias_total||
   a.observacoes_done!==b.observacoes_done;
 return {novos_eventos:newEvents,contexto_financeiro_mudou:contextChanged};
}
function main(args){
 if(args.length<1||args.length>2)fail("Uso: node verificar-ancora-escrow.cjs atual.json [anterior.json]");
 const now=read(args[0]);
 process.stdout.write("Manifesto GAESCROW1 íntegro: "+now.eventos+
   " evento(s), âncora SHA-256 "+now.hash+"\n");
 if(args.length===2){
  const old=read(args[1]);const diff=compare(now,old);
  process.stdout.write("Continuidade com cópia anterior confirmada; "+
   diff.novos_eventos+" novo(s) evento(s).\n");
  if(diff.contexto_financeiro_mudou)
   process.stdout.write("ALERTA: contexto financeiro ou observações bancárias mudaram. Requer revisão.\n");
 }
 process.stdout.write("AVISO: somente continuidade de hashes, não prova Pix ou identidade.\n");
}
if(require.main===module){
 try{main(process.argv.slice(2));}
 catch(err){process.stderr.write("ERRO: "+err.message+"\n");process.exitCode=1;}
}
module.exports={validate,compare,sha256};
