"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

const source=fs.readFileSync("supabase/functions/whatsapp-bot/index.ts","utf8");
const start=source.indexOf("function cob06DestinoGitHub(){");
const end=source.indexOf("async function z(){",start);
assert.ok(start>=0&&end>start,"Guarda GitHub precisa estar presente nas funcoes reais");
const funcoes=source.slice(start,end);
const staging="https://jbttwihctuibchhcyqtl.supabase.co";
const producao="https://xdmbkflufsfqziixzpxc.supabase.co";

function cenario({branch="",url=staging,autorizacao=""}={}){
  const chamadas=[];
  const contexto={
    B:branch,te:url,I:"token-ficticio",H:"repo-ficticio",M:"repositorio-ficticio",
    Deno:{env:{get:n=>n==="COB06_GITHUB_WRITE_MAIN"?autorizacao:undefined}},
    ce:v=>Buffer.from(v,"base64").toString("utf8"),
    ue:v=>Buffer.from(v,"utf8").toString("base64"),
    console:{error(){}},
    fetch:async(endereco,opts)=>{
      chamadas.push({endereco,method:opts.method,body:opts.body?JSON.parse(opts.body):null});
      return {ok:true,json:async()=>({sha:"sha-ficticio",content:Buffer.from("[]").toString("base64")})};
    }
  };
  vm.createContext(contexto);
  vm.runInContext(funcoes+";this.funcoes={K,b}",contexto);
  return {chamadas,...contexto.funcoes};
}

test("COB-06: destino ausente, main no STAGING e refs ambíguas falham sem rede",async()=>{
  for(const conf of [
    {},{branch:"main",autorizacao:"AUTORIZADO_PARA_PRODUCAO"},
    {branch:"qa/../../main"},{branch:"release/main"},
    {branch:"qa/"}
  ]){
    const c=cenario(conf);
    await assert.rejects(c.K("DATA/comercios.json"),/Destino GitHub|main bloqueada|Escrita no main/);
    await assert.rejects(c.b("DATA/comercios.json","[]","sha","teste"),/Destino GitHub|main bloqueada|Escrita no main/);
    assert.equal(c.chamadas.length,0,"Nenhum GET/PUT chega a sair");
  }
});

test("COB-06: producao sem liberacao especifica nao escreve no main",async()=>{
  const c=cenario({branch:"main",url:producao});
  await assert.rejects(c.K("DATA/comercios.json"),/Escrita no main bloqueada/);
  await assert.rejects(c.b("DATA/comercios.json","[]","sha","teste"),/Escrita no main bloqueada/);
  assert.equal(c.chamadas.length,0);
});

test("COB-06: branch QA e recusada em producao e em origem desconhecida",async()=>{
  for(const url of [producao,"https://ambiente-invalido.example"]){
    const c=cenario({branch:"qa/cob06-isolado",url,autorizacao:"AUTORIZADO_PARA_PRODUCAO"});
    await assert.rejects(c.K("DATA/comercios.json"),/Branch QA permitida somente no STAGING/);
    await assert.rejects(c.b("DATA/comercios.json","[]","sha","teste"),/Branch QA permitida somente no STAGING/);
    assert.equal(c.chamadas.length,0,"Destino QA indevido nao gera rede");
  }
});

test("COB-06: leitura e escrita QA apontam apenas para branch isolada",async()=>{
  const c=cenario({branch:"qa/cob06-isolado"});
  const lido=await c.K("DATA/comercios.json");
  assert.equal(lido.sha,"sha-ficticio");
  assert.equal(c.chamadas.length,1);
  assert.ok(c.chamadas[0].endereco.endsWith("?ref=qa/cob06-isolado"));
  await c.b("DATA/comercios.json","[]","sha-ficticio","homologacao");
  assert.equal(c.chamadas.length,2);
  assert.equal(c.chamadas[1].method,"PUT");
  assert.equal(c.chamadas[1].body.branch,"qa/cob06-isolado");
  assert.equal(c.chamadas[1].body.sha,"sha-ficticio");
  assert.ok(!c.chamadas.some(x=>x.endereco.endsWith("?ref=main")||x.body?.branch==="main"));
});

test("COB-06: main requer projeto produtivo e flag de release juntos (somente mock)",async()=>{
  const c=cenario({branch:"main",url:producao,autorizacao:"AUTORIZADO_PARA_PRODUCAO"});
  await c.b("DATA/comercios.json","[]","sha-ficticio","homologacao-somente-mock");
  assert.equal(c.chamadas.length,1);
  assert.equal(c.chamadas[0].body.branch,"main");
  // fetch e mock local: nenhuma requisicao ou mutacao externa e executada.
});
