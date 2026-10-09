"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("js/local.js", "utf8");
const begin = source.indexOf("async function carregarLocal() {");
const end = source.indexOf("function mostrarLocalIndisponivel(", begin);
assert.ok(begin >= 0 && end > begin, "A função original de carregamento deve existir");
const script = source.slice(begin, end) + "\nthis.executarCarregamento = carregarLocal;";

async function executar(cenario={}) {
  const mensagens = [];
  const acoes = [];
  const consultas = [];
  const locais = cenario.locais ?? [];
  const comercios = cenario.comercios ?? [{ id: "loja-ci", nome: "Loja de teste", status: "ativo" }];
  const cliente = cenario.semCliente ? null : {
    rpc: async (nome, params) => {
      consultas.push({ nome, ids: params.p_ids });
      if (cenario.excecao) throw new Error("Falha no banco");
      return { data: Object.hasOwn(cenario, "resposta") ? cenario.resposta : [{local_id:"loja-ci",status:"ativo"}],
        error: cenario.erro ?? null };
    },
  };
  const sandbox = {
    idLocal: cenario.id ?? "loja-ci",
    localAtual: null,
    fetch: async path => ({
      ok: true,
      json: async () => path.includes("locais.json") ? locais : comercios,
    }),
    obterSupabaseClient: () => cliente,
    mostrarLocalIndisponivel: msg => mensagens.push(msg),
    preencherPagina: () => acoes.push("pagina"),
    carregarAvaliacoes: async () => acoes.push("avaliacoes"),
    verificarAvaliacaoUsuario: async () => acoes.push("avaliacao-usuario"),
    verificarProprietarioComercio: async () => acoes.push("proprietario"),
    console: {log(){},warn(){},error(){}},
  };
  vm.runInNewContext(script, sandbox);
  await sandbox.executarCarregamento();
  return { mensagens, acoes, consultas, local: sandbox.localAtual };
}

test("a RPC bloqueia uma loja arquivada mesmo que o JSON esteja ativo", async () => {
  const r = await executar({ resposta: [{local_id:"loja-ci",status:"arquivado"}] });
  assert.equal(r.local, null);
  assert.equal(r.acoes.length, 0);
  assert.match(r.mensagens[0], /despublicado/);
  assert.equal(r.consultas[0].nome, "catalogo_status_publicacao");
  assert.deepEqual(Array.from(r.consultas[0].ids), ["loja-ci"]);
});

test("a RPC permite loja ativa; fluxo normal continua com avaliações e proprietário", async () => {
  const r = await executar();
  assert.equal(r.mensagens.length, 0);
  assert.equal(r.local.id, "loja-ci");
  assert.deepEqual(r.acoes, ["pagina","avaliacoes","avaliacao-usuario","proprietario"]);
});

test("comércio editorial sem publicação no banco continua visível quando a consulta confirma ausência", async () => {
  const r = await executar({ resposta: [] });
  assert.equal(r.mensagens.length, 0);
  assert.equal(r.local.id, "loja-ci");
});

test("indisponibilidade de banco, falta de cliente, resposta inválida e exceção falham fechadas", async () => {
  for(const scenario of [
    {semCliente:true},
    {erro:{code:"42501"}, resposta:[]},
    {resposta:null},
    {resposta:{status:"ativo"}},
    {excecao:true},
  ]) {
    const r = await executar(scenario);
    assert.equal(r.local, null);
    assert.equal(r.acoes.length, 0);
    assert.equal(r.mensagens.length, 1);
  }
});

test("status editorial inativo não reaparece se a RPC disser ativo", async () => {
  const r = await executar({comercios:[{id:"loja-ci",status:"deletado"}]});
  assert.equal(r.local,null);
  assert.match(r.mensagens[0], /não está disponível publicamente/);
});

test("ponto turístico não é bloqueado por falta de consulta comercial", async () => {
  const r = await executar({
    id:"cristo-ci",semCliente:true,
    locais:[{id:"cristo-ci",nome:"Mirante de teste"}],
    comercios:[]
  });
  assert.equal(r.local.id,"cristo-ci");
  assert.equal(r.consultas.length,0);
  assert.equal(r.mensagens.length,0);
});
