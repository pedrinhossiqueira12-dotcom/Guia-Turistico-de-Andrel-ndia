"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync("supabase/functions/whatsapp-bot/index.ts","utf8");

function func(nome,proximo){
 const a=source.indexOf("async function "+nome+"(");
 const b=source.indexOf("async function "+proximo+"(",a+15);
 assert.ok(a>=0&&b>a,"funcao "+nome+" presente");
 return source.slice(a,b);
}
const handlers=[func("ae","_e"),func("we","he"),func("Oe","Ce")].join("\n");

function cenario(op={}){
 const uid="00000000-0000-4000-8000-000000000099";
 const chamadas=[], vitrine=[{id:"loja-teste",nome:"Loja",status:"ativo",imagem:"foto",imagens:["foto"]}];
 let writes=0;
 const db={
   from(tab){let cols="";
     const q={select(c){cols=c;return q},eq(){return q},async maybeSingle(){
       chamadas.push("read:"+tab+":"+cols);
       if(op.falha===tab)return {data:null,error:{message:"erro DB"}};
       if(tab==="comercios_publicados")return {data:{local_id:"loja-teste",status:cols==="status"?(op.statusFinal||"deletado"):(op.statusInicial||"ativo")},error:null};
       if(tab==="catalogo_encerramentos_comercio")return {data:op.tombstone===null?null:{situacao:op.tombstone||"arquivado"},error:null};
       if(tab==="catalogos")return {data:op.semCatalogo?null:{comercio_id:"loja-teste",proprietario_id:op.donoErrado?"outro":uid},error:null};
       throw Error("tabela inesperada "+tab);
     }};
     return q;
   },
   async rpc(nome){
     chamadas.push("rpc:"+nome);
     if(op.falha===nome)return {data:null,error:{message:"RPC indisponivel"}};
     if(nome==="catalogo_solicitar_encerramento_financeiro")
       return {data:op.solicitacao||{ok:true,situacao:"aguardando_quitacao",divida_centavos:500,faturas_pendentes:1},error:null};
     if(nome==="catalogo_finalizar_encerramento_financeiro")
       return {data:op.finalizacao||{ok:false,mensagem:"Divida em aberto"},error:null};
     if(nome==="catalogo_arquivar_sem_catalogo_admin")
       return {data:op.recusaSemCatalogo||{ok:true,situacao:"arquivado",sem_catalogo:true},error:null};
     throw Error("RPC inesperada");
   }
 };
 const contexto={g:db,I:op.tokenGitHubAusente?"":"token-ficticio-inerte",cob06DestinoGitHub:()=>{
   if(op.alvoGitHubInvalido)throw Error("Alvo QA indevido");
   return "qa/fixture";
 },u:x=>String(x??"").trim(),
   Y:async()=>({cadastro:{local_id:"loja-teste",usuario_id:uid},erro:null}),
   E:async r=>r.user?{id:r.user}:null,y:async r=>r.admin?{id:r.admin}:null,
   t:(body,status=200)=>({body,status}),
   z:async()=>{chamadas.push("github:get");return {comercios:JSON.parse(JSON.stringify(vitrine)),sha:"sha-mock"}},
   b:async(_file,conteudo)=>{chamadas.push("github:put");if(op.falhaGithub)throw Error("GitHub indisponivel");writes++;vitrine.splice(0,1,...JSON.parse(conteudo))},
   S:"DATA/comercios.json",console};
 vm.createContext(contexto);
 vm.runInContext(handlers+";globalThis.rotas={ae,we,Oe}",contexto);
 return {...contexto.rotas,uid,chamadas,vitrine,writes:()=>writes};
}
const semGithub=c=>assert.equal(c.chamadas.filter(x=>x.startsWith("github:")).length,0);

test("COB-06: token GitHub ausente impede arquivamento antes da RPC, dono ainda solicita",async()=>{
 const dono=cenario({tokenGitHubAusente:true});
 const pedido=await dono.Oe({user:dono.uid},{comercio_id:"loja-teste"});
 assert.equal(pedido.status,200);
 assert.ok(dono.chamadas.includes("rpc:catalogo_solicitar_encerramento_financeiro"));
 semGithub(dono);
 const admin=cenario({tokenGitHubAusente:true,finalizacao:{ok:true,situacao:"arquivado"}});
 const resposta=await admin.we({admin:admin.uid},{comercio_id:"loja-teste"});
 assert.equal(resposta.status,503);
 assert.equal(resposta.body.sucesso,false);
 assert.equal(admin.chamadas.filter(v=>v.startsWith("rpc:")).length,0);
 semGithub(admin);
});

test("COB-06: GitHub indevido bloqueia somente arquivamento administrativo",async()=>{
 const dono=cenario({alvoGitHubInvalido:true});
 const pedido=await dono.Oe({user:dono.uid},{comercio_id:"loja-teste"});
 assert.equal(pedido.status,200,"dono apenas solicita; nao publica vitrine");
 assert.ok(dono.chamadas.includes("rpc:catalogo_solicitar_encerramento_financeiro"));
 semGithub(dono);
 const admin=cenario({alvoGitHubInvalido:true});
 const fim=await admin.we({admin:admin.uid},{comercio_id:"loja-teste"});
 assert.equal(fim.status,503);
 assert.equal(fim.body.sucesso,false);
 assert.equal(admin.chamadas.filter(x=>x.startsWith("rpc:")).length,0);
 semGithub(admin);
});

test("COB-06: dono apenas solicita encerramento de loja devedora, sem retirar fotos",async()=>{
 const c=cenario();
 const r=await c.Oe({user:c.uid},{comercio_id:"loja-teste"});
 assert.equal(r.status,200);assert.equal(r.body.arquivado,false);
 assert.equal(r.body.situacao,"aguardando_quitacao");assert.equal(r.body.divida_centavos,500);
 assert.ok(c.chamadas.includes("rpc:catalogo_solicitar_encerramento_financeiro"));
 semGithub(c);assert.equal(c.vitrine[0].imagem,"foto");
});

test("COB-06: recusa financeira do dono e do admin impede GitHub",async()=>{
 const dono=cenario({solicitacao:{ok:false,mensagem:"sem titularidade"}});
 assert.equal((await dono.Oe({user:dono.uid},{comercio_id:"loja-teste"})).status,409);semGithub(dono);
 const admin=cenario();
 assert.equal((await admin.we({admin:admin.uid},{comercio_id:"loja-teste"})).status,409);semGithub(admin);
});

test("COB-06: admin so publica apos finalizacao financeira validada",async()=>{
 const c=cenario({finalizacao:{ok:true,situacao:"arquivado"}});
 const r=await c.we({admin:c.uid},{comercio_id:"loja-teste"});
 assert.equal(r.status,200);assert.equal(r.body.sucesso,true);assert.equal(c.writes(),1);
 assert.equal(c.vitrine[0].status,"deletado");assert.equal(c.vitrine[0].imagem,"");
 assert.ok(c.chamadas.indexOf("rpc:catalogo_finalizar_encerramento_financeiro")<c.chamadas.indexOf("github:put"));
 assert.equal((await c.we({admin:c.uid},{comercio_id:"loja-teste"})).status,200);
 assert.equal(c.writes(),1);
});

test("COB-06: GitHub fora do ar retorna pendencia sem rollback financeiro",async()=>{
 const c=cenario({finalizacao:{ok:true,situacao:"arquivado"},falhaGithub:true});
 const r=await c.we({admin:c.uid},{comercio_id:"loja-teste"});
 assert.equal(r.status,503);assert.equal(r.body.sucesso,false);
 assert.equal(r.body.pendente_sincronizacao,true);assert.equal(r.body.arquivado,true);
 assert.equal(c.writes(),0);
});

test("COB-06: RPC indisponivel e status DB divergente negam finalizacao",async()=>{
 for(const cfg of [
   {falha:"catalogo_finalizar_encerramento_financeiro"},
   {finalizacao:{ok:true,situacao:"arquivado"},statusFinal:"ativo"}
 ]){
   const c=cenario(cfg),r=await c.we({admin:c.uid},{comercio_id:"loja-teste"});
   assert.ok(r.status>=400);assert.equal(r.body.sucesso,false);semGithub(c);
 }
});

test("COB-06: dono terceiro, titular divergente e admin sem token sao negados",async()=>{
 const c=cenario(),r=await c.Oe({user:"intruso"},{comercio_id:"loja-teste"});
 assert.equal(r.status,403);semGithub(c);
 const d=cenario({donoErrado:true});
 assert.equal((await d.Oe({user:d.uid},{comercio_id:"loja-teste"})).status,403);semGithub(d);
 const a=cenario();
 assert.equal((await a.we({},{comercio_id:"loja-teste"})).status,403);semGithub(a);
});

test("COB-06: quatro acoes legadas mantidas; exclusao nao modifica Storage",()=>{
 for(const acao of ["excluir_comercio","marcar_comercio_deletado","excluir_meu_comercio","marcar_meu_comercio_deletado"])
   assert.ok(source.includes('"'+acao+'"'),acao);
 const trecho=func("ae","_e");
 assert.ok(trecho.includes("catalogo_solicitar_encerramento_financeiro"));
 assert.ok(trecho.includes("catalogo_finalizar_encerramento_financeiro"));
 assert.ok(!trecho.includes("storage_cleanup_queue"));
 assert.ok(!trecho.includes('update({status:"deletado"'));
});

test("COB-06: falha GitHub apos finalizacao com status deletado admite nova tentativa segura",async()=>{
 const op={statusInicial:"deletado",statusFinal:"deletado",
   finalizacao:{ok:true,situacao:"arquivado",ja_arquivado:true},falhaGithub:true};
 const c=cenario(op);
 const falha=await c.we({admin:c.uid},{comercio_id:"loja-teste"});
 assert.equal(falha.status,503);
 assert.equal(falha.body.pendente_sincronizacao,true);
 assert.equal(c.writes(),0);
 assert.equal(c.vitrine[0].status,"ativo","PUT falhado nao persiste mutacao local na vitrine simulada");
 op.falhaGithub=false;
 const sucesso=await c.we({admin:c.uid},{comercio_id:"loja-teste"});
 assert.equal(sucesso.status,200);assert.equal(sucesso.body.sucesso,true);
 assert.equal(c.writes(),1);assert.equal(c.vitrine[0].status,"deletado");
 assert.equal(c.chamadas.filter(x=>x==="rpc:catalogo_finalizar_encerramento_financeiro").length,2);
});

test("COB-06: dono nunca confunde despublicacao legada com encerramento financeiro",async()=>{
 const anormal=cenario({statusInicial:"deletado",tombstone:null});
 const r=await anormal.Oe({user:anormal.uid},{comercio_id:"loja-teste"});
 assert.equal(r.status,409);assert.equal(r.body.sucesso,false);semGithub(anormal);
 const quitado=cenario({statusInicial:"deletado",tombstone:"arquivado"});
 const ok=await quitado.Oe({user:quitado.uid},{comercio_id:"loja-teste"});
 assert.equal(ok.status,200);assert.equal(ok.body.ja_arquivado,true);semGithub(quitado);
 const terceiro=cenario({statusInicial:"deletado",donoErrado:true});
 const forbidden=await terceiro.Oe({user:terceiro.uid},{comercio_id:"loja-teste"});
 assert.equal(forbidden.status,403);semGithub(terceiro);
 assert.ok(!terceiro.chamadas.some(x=>x.includes("catalogo_encerramentos_comercio")));
});

test("COB-06: sem catalogo, somente administrador com RPC financeira pode ocultar",async()=>{
 const c=cenario({semCatalogo:true});
 const dono=await c.Oe({user:c.uid},{comercio_id:"loja-teste"});
 assert.equal(dono.status,409);assert.equal(dono.body.arquivado,false);semGithub(c);
 const admin=await c.we({admin:c.uid},{comercio_id:"loja-teste"});
 assert.equal(admin.status,200);assert.equal(admin.body.arquivado,true);assert.equal(c.writes(),1);
 assert.ok(c.chamadas.includes("rpc:catalogo_arquivar_sem_catalogo_admin"));
 assert.ok(!c.chamadas.includes("rpc:catalogo_finalizar_encerramento_financeiro"));
 const negado=cenario({semCatalogo:true,recusaSemCatalogo:{ok:false,mensagem:"Historico encontrado"}});
 const r=await negado.we({admin:negado.uid},{comercio_id:"loja-teste"});
 assert.equal(r.status,409);semGithub(negado);
 const erro=cenario({semCatalogo:true,falha:"catalogo_arquivar_sem_catalogo_admin"});
 assert.equal((await erro.we({admin:erro.uid},{comercio_id:"loja-teste"})).status,503);
 semGithub(erro);
});
