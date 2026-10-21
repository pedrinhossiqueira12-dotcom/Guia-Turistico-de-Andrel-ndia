"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {webcrypto,createHmac}=require("node:crypto");
const code=fs.readFileSync("supabase/functions/whatsapp-bot/index.ts","utf8");

// Executa je(), o despachante HTTP REAL da Edge baixada, com Request/Response
// do runtime Node; Supabase, GitHub e WhatsApp sao substituidos por simuladores.
// O teste nao abre porta, nao acessa rede e nao recebe nenhuma credencial real.
function trecho(inicio,fim){
 const i=code.indexOf(inicio),j=code.indexOf(fim,i+inicio.length);
 assert.ok(i>=0&&j>i,"Source route not found: "+inicio);
 return code.slice(i,j);
}
const functions=[
 trecho("function t(","function u("),
 trecho("async function E(","async function y("),
 trecho("async function y(","function ce("),
 trecho("async function Y(","function le("),
 trecho("async function ae(","async function _e("),
 trecho("async function we(","async function he("),
 trecho("async function Oe(","async function Ce("),
 trecho("async function Ce(","function Ie("),
 trecho("async function cob06VerificarAssinaturaWhatsapp(","async function je("),
 trecho("async function je(","Deno.serve(")
].join("\n");

function cenario(opts={}){
 const owner="00000000-0000-4000-8000-000000000099";
 const admin="4b9a0233-6b72-4573-aebd-d596c5b15e1b";
 const calls=[];
 let publicState=opts.publicState||"ativo";
 let finalState=opts.finalState||"deletado";
 let tombstone=opts.tombstone||"arquivado";
 let jsonState=opts.alreadySynced?"deletado":"ativo",putCount=0;
 let jsonImagem=opts.alreadySynced?"":"foto";
 let jsonImagens=opts.alreadySynced?[]:["foto"];
 let shaVersao=1;
 const db={
  auth:{async getUser(token){
    calls.push("auth.getUser:"+token);
    return {data:token==="owner-jwt"?{user:{id:owner}}:
     token==="admin-jwt"?{user:{id:admin}}:
     token==="other-jwt"?{user:{id:"99999999-9999-4999-8999-999999999999"}}:
     {user:null},error:null};
  }},
  from(table){
   let selected="";
   const query={
    select(fields){selected=fields;return query},
    eq(){return query},
    async maybeSingle(){
     calls.push("db.read:"+table+":"+selected);
     if(opts.dbUnavailable===table || (opts.failConfirmedRead&&table==="comercios_publicados"&&selected==="status"))
      return {data:null,error:{message:"Mock database failure"}};
     if(table==="cadastros_comercios")return {data:{local_id:"loja-mock",usuario_id:owner},error:null};
     if(table==="comercios_publicados")return {data:{local_id:"loja-mock",status:selected==="status"?finalState:publicState},error:null};
     if(table==="catalogos")return {data:opts.noCatalog?null:{comercio_id:"loja-mock",proprietario_id:owner},error:null};
     if(table==="catalogo_encerramentos_comercio")return {data:opts.noTombstone?null:{situacao:tombstone},error:null};
     throw Error("Unexpected table: "+table);
    }
   };
   return query;
  },
  async rpc(name){
   calls.push("db.rpc:"+name);
   if(opts.rpcFailure)return {data:null,error:{message:"Mock RPC failure"}};
   if(name==="catalogo_solicitar_encerramento_financeiro")
    return {data:opts.debtClear?{ok:true,situacao:"pendente_arquivamento",divida_centavos:0,pedidos_em_andamento:0}:
      {ok:true,situacao:"aguardando_quitacao",divida_centavos:500,faturas_pendentes:1},error:null};
   if(name==="catalogo_finalizar_encerramento_financeiro")
    return {data:opts.debtClear||opts.alreadyArchived?{ok:true,situacao:"arquivado",ja_arquivado:!!opts.alreadyArchived}:
      {ok:false,mensagem:"Ha debitos ou pedidos pendentes"},error:null};
   if(name==="catalogo_arquivar_sem_catalogo_admin")
    return {data:opts.noCatalogRefused?{ok:false,mensagem:"Historico financeiro encontrado"}:
      {ok:true,situacao:"arquivado",sem_catalogo:true},error:null};
   throw Error("Unexpected RPC: "+name);
  }
 };
 const ctx={g:db,R:admin,crypto:webcrypto,TextEncoder,TextDecoder,
 cob06DestinoGitHub:()=>{if(opts.invalidGithubTarget)throw Error("Destino GitHub invalido");return "qa/fixture";},
 Deno:{env:{get:n=>n==="WHATSAPP_APP_SECRET"?(opts.appSecret||""):""}},T:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,content-type"},
 F:"token-de-verificacao-local",Request,Response,URL,console:{log(){},error(){}},
 u:v=>v==null?"":String(v).trim(),
 z:async()=>{
  calls.push("github:get");
  if(opts.githubGetFailure)throw Error("GitHub GET offline");
  return {comercios:opts.githubMissing?[]:[{id:"loja-mock",nome:"Loja",
    status:jsonState,imagem:jsonImagem,imagens:[...jsonImagens],destaque:false}],sha:"mock-sha-"+shaVersao};
 },
 b:async(_path,conteudo,sha)=>{
  calls.push("github:put");
  if(opts.githubFailure)throw Error("GitHub PUT offline");
  if(opts.githubConflict){opts.githubConflict=false;shaVersao++;throw Error("GitHub SHA conflict 409");}
  if(sha!=="mock-sha-"+shaVersao)throw Error("GitHub SHA stale 409");
  const row=JSON.parse(conteudo).find(entry=>entry.id==="loja-mock");
  if(!row)throw Error("GitHub file missing target");
  jsonState=row.status;jsonImagem=row.imagem;jsonImagens=[...row.imagens];
  putCount++;shaVersao++;
  if(opts.timeoutAfterCommit){opts.timeoutAfterCommit=false;throw Error("Network timeout after GitHub commit");}
 },
 S:"DATA/comercios.json"};
 // Para os handlers nao exercitados: as funcoes precisam existir somente quando chamadas.
 for(const n of ["me","fe","he","ge","_e","ve","Se","qe","re","be","Ee","ze","Ie","Te"]){
  ctx[n]=async()=>{throw Error("Unexpected handler "+n)};
 }
 ctx.Te=async()=>{calls.push("whatsapp:accepted");return ctx.t({sucesso:true});};
 vm.createContext(ctx);
 vm.runInContext(functions+";globalThis.http=je;globalThis.safeHttp=cob06HandlerSeguro;",ctx);
 function request(acao,token,method="POST"){
  return new Request("https://edge.local/functions/v1/whatsapp-bot",{
   method,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},
   body:method==="POST"?JSON.stringify({acao,comercio_id:"loja-mock"}):undefined
  });
 }
 async function call(acao,token,method="POST"){
  const response=await ctx.http(request(acao,token,method));
  return {status:response.status,data:await response.json()};
 }
 return {call,request,raw:ctx.http,safe:ctx.safeHttp,calls,owner,admin,
  get putCount(){return putCount},get jsonState(){return jsonState},
  get jsonImage(){return jsonImagem},get jsonImages(){return [...jsonImagens]},
  get shaVersao(){return shaVersao},
  setGithubFailure(v){opts.githubFailure=v},
  setGithubGetFailure(v){opts.githubGetFailure=v},
  setFailConfirmedRead(v){opts.failConfirmedRead=v}};
}
const noWrites=c=>assert.equal(c.calls.filter(x=>x==="github:put").length,0);
test("HTTP real: destino GitHub indevido recusa encerramento antes das RPCs",async()=>{
 const c=cenario({invalidGithubTarget:true,debtClear:true});
 for(const [acao,token] of [["excluir_meu_comercio","owner-jwt"],["excluir_comercio","admin-jwt"]]){
  const r=await c.call(acao,token);
  assert.equal(r.status,503);
  assert.equal(r.data.sucesso,false);
 }
 assert.equal(c.calls.filter(x=>x.startsWith("db.rpc:")).length,0);
 assert.equal(c.calls.filter(x=>x.startsWith("github:")).length,0);
});

test("HTTP real: rejeita dono anonimo e token invalido; nao toca banco financeiro",async()=>{
 const c=cenario();
 for(const token of [undefined,"token-invalido"]){
  const r=await c.call("excluir_meu_comercio",token);
  assert.equal(r.status,401);assert.equal(r.data.sucesso,false);
 }
 assert.equal(c.calls.filter(x=>x.startsWith("db.rpc:")).length,0);noWrites(c);
});
test("HTTP real: propietario somente solicita, nao arquiva e nao altera GitHub",async()=>{
 const c=cenario();const r=await c.call("marcar_meu_comercio_deletado","owner-jwt");
 assert.equal(r.status,200);assert.equal(r.data.arquivado,false);
 assert.equal(r.data.divida_centavos,500);
 assert.ok(c.calls.includes("db.rpc:catalogo_solicitar_encerramento_financeiro"));noWrites(c);
});
test("HTTP real: usuario diferente nao exclui outro comercio",async()=>{
 const c=cenario();const r=await c.call("excluir_meu_comercio","other-jwt");
 assert.equal(r.status,403);assert.equal(r.data.sucesso,false);
 assert.equal(c.calls.filter(x=>x.startsWith("db.rpc:")).length,0);noWrites(c);
});
test("HTTP real: admin exige JWT validado e ID fixo, divida bloqueia PUT",async()=>{
 const c=cenario();
 for(const token of [undefined,"owner-jwt","other-jwt"]){
  const r=await c.call("excluir_comercio",token);
  assert.equal(r.status,403);
 }
 const adminResult=await c.call("marcar_comercio_deletado","admin-jwt");
 assert.equal(adminResult.status,409);noWrites(c);
});
test("HTTP real: sem catalogo dono solicita revisao e admin usa RPC com historico limpo",async()=>{
 const c=cenario({noCatalog:true});
 const dono=await c.call("excluir_meu_comercio","owner-jwt");
 assert.equal(dono.status,409);assert.equal(dono.data.arquivado,false);noWrites(c);
 const admin=await c.call("excluir_comercio","admin-jwt");
 assert.equal(admin.status,200);assert.equal(admin.data.arquivado,true);
 assert.equal(c.putCount,1);
 assert.ok(c.calls.includes("db.rpc:catalogo_arquivar_sem_catalogo_admin"));
 const recusado=cenario({noCatalog:true,noCatalogRefused:true});
 const r=await recusado.call("excluir_comercio","admin-jwt");
 assert.equal(r.status,409);noWrites(recusado);
});
test("HTTP real: finalizacao valida arquivamento antes do GitHub e retenta falha",async()=>{
 const c=cenario({debtClear:true,alreadyArchived:true,githubFailure:true});
 const r1=await c.call("excluir_comercio","admin-jwt");
 assert.equal(r1.status,503);assert.equal(r1.data.pendente_sincronizacao,true);
 assert.equal(c.putCount,0);assert.equal(c.jsonState,"ativo");
 c.setGithubFailure(false);
 const r2=await c.call("excluir_comercio","admin-jwt");
 assert.equal(r2.status,200);assert.equal(r2.data.arquivado,true);
 assert.equal(c.putCount,1);assert.equal(c.jsonState,"deletado");
 assert.equal(c.calls.filter(x=>x==="db.rpc:catalogo_finalizar_encerramento_financeiro").length,2);
});
test("HTTP real: despublicacao legada sem tombstone nao significa quitacao",async()=>{
 const c=cenario({publicState:"deletado",noTombstone:true});
 const r=await c.call("excluir_meu_comercio","owner-jwt");
 assert.equal(r.status,409);assert.equal(r.data.sucesso,false);noWrites(c);
});
test("HTTP real: lida com metodo invalido, JSON malformado, OPTIONS",async()=>{
 const c=cenario();
 const get=new Request("https://edge.local/functions/v1/whatsapp-bot",{method:"PATCH"});
 const r=await c.raw(get);assert.equal(r.status,405);
 const invalid=new Request("https://edge.local/functions/v1/whatsapp-bot",{method:"POST",body:"{"});
 const malformed=await c.raw(invalid);assert.equal(malformed.status,400);
 const options=new Request("https://edge.local/functions/v1/whatsapp-bot",{method:"OPTIONS"});
 assert.equal((await c.raw(options)).status,204);noWrites(c);
});

test("HTTP WhatsApp: sem segredo HMAC retorna 503, sem disparar processamento",async()=>{
 const c=cenario();const body=JSON.stringify({object:"whatsapp_business_account",entry:[]});
 const r=await c.raw(new Request("https://edge.local/functions/v1/whatsapp-bot",{
  method:"POST",headers:{"Content-Type":"application/json"},body}));
 assert.equal(r.status,503);assert.ok(!c.calls.includes("whatsapp:accepted"));noWrites(c);
});
test("HTTP WhatsApp: sem assinatura, formato invalido e assinatura incorreta sao 401",async()=>{
 const c=cenario({appSecret:"segredo-local-de-teste"});
 const body=JSON.stringify({object:"whatsapp_business_account",entry:[]});
 for(const signature of ["","md5=abc","sha256="+"0".repeat(64)]){
  const r=await c.raw(new Request("https://edge.local/functions/v1/whatsapp-bot",{
   method:"POST",headers:{"Content-Type":"application/json",...(signature?{"X-Hub-Signature-256":signature}:{})},body}));
  assert.equal(r.status,401);
 }
 assert.ok(!c.calls.includes("whatsapp:accepted"));noWrites(c);
});
test("HTTP WhatsApp: bytes assinados aceitos, alteração de um byte recusada",async()=>{
 const secret="segredo-local-de-teste",c=cenario({appSecret:secret});
 const body=JSON.stringify({object:"whatsapp_business_account",entry:[]});
 const signature="sha256="+createHmac("sha256",secret).update(Buffer.from(body)).digest("hex");
 const signed=await c.raw(new Request("https://edge.local/functions/v1/whatsapp-bot",{
  method:"POST",headers:{"Content-Type":"application/json","X-Hub-Signature-256":signature},body}));
 assert.equal(signed.status,200);assert.equal(c.calls.filter(x=>x==="whatsapp:accepted").length,1);
 const changed=await c.raw(new Request("https://edge.local/functions/v1/whatsapp-bot",{
  method:"POST",headers:{"Content-Type":"application/json","X-Hub-Signature-256":signature},
  body:body.replace("entry", "Entry")}));
 assert.equal(changed.status,401);
 assert.equal(c.calls.filter(x=>x==="whatsapp:accepted").length,1);
 noWrites(c);
});
test("HTTP WhatsApp: GET de verificacao exige token; payload nao eh registrado nos logs",async()=>{
 const c=cenario();
 const url="https://edge.local/functions/v1/whatsapp-bot?";
 let r=await c.raw(new Request(url+"hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123"));
 assert.equal(r.status,403);
 r=await c.raw(new Request(url+"hub.mode=subscribe&hub.verify_token=token-de-verificacao-local&hub.challenge=123"));
 assert.equal(r.status,200);assert.equal(await r.text(),"123");
 assert.ok(!code.includes('console.log("Webhook WhatsApp recebido:",JSON.stringify(e))'));
});

test("HTTP real: excecao inesperada nao revela detalhes internos ao solicitante",async()=>{
  const c=cenario();
  const req=new Request("https://edge.local/functions/v1/whatsapp-bot",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({acao:"cadastro_web",dado_privado:"NAO_EXIBIR"})
  });
  const r=await c.safe(req);
  assert.equal(r.status,500);
  const body=await r.json();
  assert.equal(body.sucesso,false);
  assert.equal(body.erro,"Erro interno da Edge Function.");
  assert.deepEqual(Object.keys(body).sort(),["erro","sucesso"]);
  assert.ok(!JSON.stringify(body).includes("Unexpected handler"));
  assert.ok(!JSON.stringify(body).includes("NAO_EXIBIR"));
  noWrites(c);
});

test("HTTP recuperação: falha GitHub GET depois de RPC confirmada permite repetição",async()=>{
 const c=cenario({debtClear:true,githubGetFailure:true});
 const first=await c.call("excluir_comercio","admin-jwt");
 assert.equal(first.status,503);
 assert.equal(first.data.arquivado,true);
 assert.equal(first.data.pendente_sincronizacao,true);
 assert.equal(c.putCount,0);
 c.setGithubGetFailure(false);
 const again=await c.call("excluir_comercio","admin-jwt");
 assert.equal(again.status,200);
 assert.equal(c.putCount,1);
 assert.equal(c.jsonState,"deletado");
 assert.equal(c.jsonImage,"");
 assert.deepEqual(c.jsonImages,[]);
});
test("HTTP recuperação: timeout depois do PUT confirmado não grava duas vezes",async()=>{
 const c=cenario({debtClear:true,timeoutAfterCommit:true});
 const first=await c.call("excluir_comercio","admin-jwt");
 assert.equal(first.status,503);
 assert.equal(first.data.pendente_sincronizacao,true);
 assert.equal(c.putCount,1);
 assert.equal(c.jsonState,"deletado");
 const second=await c.call("excluir_comercio","admin-jwt");
 assert.equal(second.status,200);
 assert.equal(c.putCount,1);
 assert.equal(c.calls.filter(x=>x==="github:put").length,1);
});
test("HTTP recuperação: conflito SHA GitHub permite releitura e escrita no novo SHA",async()=>{
 const c=cenario({debtClear:true,githubConflict:true});
 const first=await c.call("excluir_comercio","admin-jwt");
 assert.equal(first.status,503);
 assert.equal(first.data.pendente_sincronizacao,true);
 assert.equal(c.putCount,0);
 assert.equal(c.shaVersao,2);
 const next=await c.call("excluir_comercio","admin-jwt");
 assert.equal(next.status,200);
 assert.equal(c.putCount,1);
 assert.equal(c.shaVersao,3);
});
test("HTTP recuperação: vitrine já sincronizada retorna 200 sem PUT redundante",async()=>{
 const c=cenario({debtClear:true,alreadySynced:true});
 const r=await c.call("excluir_comercio","admin-jwt");
 assert.equal(r.status,200);
 assert.equal(r.data.arquivado,true);
 assert.equal(c.putCount,0);
 assert.equal(c.calls.filter(x=>x==="github:get").length,1);
});
test("HTTP recuperação: arquivo sem comércio nunca cria cadastro substituto",async()=>{
 const c=cenario({debtClear:true,githubMissing:true});
 const r=await c.call("excluir_comercio","admin-jwt");
 assert.equal(r.status,503);
 assert.equal(r.data.pendente_sincronizacao,true);
 noWrites(c);
});
test("HTTP recuperação: falha de confirmação SQL impede consulta e escrita GitHub",async()=>{
 const c=cenario({debtClear:true,failConfirmedRead:true});
 const first=await c.call("excluir_comercio","admin-jwt");
 assert.equal(first.status,503);
 assert.equal(first.data.pendente_sincronizacao,true);
 assert.equal(c.calls.filter(x=>x.startsWith("github:")).length,0);
 c.setFailConfirmedRead(false);
 const second=await c.call("excluir_comercio","admin-jwt");
 assert.equal(second.status,200);
 assert.equal(c.putCount,1);
});
test("HTTP recuperação: erro da RPC financeira nunca tenta atualizar vitrine",async()=>{
 const c=cenario({debtClear:true,rpcFailure:true});
 const result=await c.call("excluir_comercio","admin-jwt");
 assert.equal(result.status,503);
 assert.equal(result.data.arquivado,false);
 assert.equal(c.calls.filter(x=>x.startsWith("github:")).length,0);
});
