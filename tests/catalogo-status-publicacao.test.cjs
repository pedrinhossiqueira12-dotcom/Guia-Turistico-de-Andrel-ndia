"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const read = (path) => fs.readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
const index = read("js/index.js");
const local = read("js/local.js");
const sql = read("supabase/pending-migrations/20261009180000_status_publicacao_publica_restrita.sql");

function criarFiltro(client) {
  const inicio = index.indexOf("async function filtrarPublicacoesEncerradas(comercios) {");
  const fim = index.indexOf("async function carregarDados()", inicio);
  assert.ok(inicio >= 0 && fim > inicio, "A função real de filtragem precisa existir");
  const sandbox = { supabaseClient: client, console: { warn() {} } };
  vm.runInNewContext(index.slice(inicio, fim) + "\nthis.filtro = filtrarPublicacoesEncerradas;", sandbox);
  return sandbox.filtro;
}

const comercios = [
  { id: "loja-ativa", status: "ativo" },
  { id: "loja-arquivada", status: "ativo" },
  { id: "loja-so-no-json", status: "ativo" },
];

function clienteComResposta(fn) {
  return { rpc: async (nome, parametros) => {
    assert.equal(nome, "catalogo_status_publicacao");
    return fn(parametros.p_ids);
  }};
}

test("publicação arquivada prevalece sobre JSON desatualizado; cadastro editorial sem registro permanece", async () => {
  const filtro = criarFiltro(clienteComResposta(async () => ({
    data: [
      { local_id: "loja-ativa", status: "ativo" },
      { local_id: "loja-arquivada", status: "arquivado" },
    ],
    error: null,
  })));
  const resultado = await filtro(comercios);
  assert.deepEqual(Array.from(resultado, (item) => item.id), ["loja-ativa", "loja-so-no-json"]);
});

test("sem cliente, erro do RPC ou resposta inesperada: não exibe lojas possivelmente arquivadas", async () => {
  assert.deepEqual(Array.from(await criarFiltro(null)(comercios)), []);
  const erro = criarFiltro(clienteComResposta(async () => ({data: null, error: {code: "42501"}})));
  assert.deepEqual(Array.from(await erro(comercios)), []);
  const nulo = criarFiltro(clienteComResposta(async () => ({data: null, error: null})));
  assert.deepEqual(Array.from(await nulo(comercios)), []);
  const excecao = criarFiltro(clienteComResposta(async () => {throw new Error("offline");}));
  assert.deepEqual(Array.from(await excecao(comercios)), []);
});

test("mais de 100 estabelecimentos consultam lotes completos, sem truncar status", async () => {
  const chamadas = [];
  const grandes = Array.from({ length: 205 }, (_, i) => ({ id: "loja-" + i, status: "ativo" }));
  const filtro = criarFiltro(clienteComResposta(async (ids) => {
    chamadas.push(Array.from(ids));
    return {data: ids.filter(id => id.endsWith("-204")).map(local_id => ({local_id,status:"arquivado"})),error:null};
  }));
  const resposta = await filtro(grandes);
  assert.equal(resposta.length, 204);
  assert.equal(resposta.some(x => x.id === "loja-204"), false);
  assert.deepEqual(chamadas.map(x=>x.length), [100,100,5]);
});

test("se algum lote falhar, nenhuma parte da vitrine passa sem verificação", async () => {
  let chamadas = 0;
  const filtro = criarFiltro(clienteComResposta(async () => {
    chamadas += 1;
    return chamadas === 2 ? {data: null,error: {code:"network"}} : {data: [],error:null};
  }));
  const resposta = await filtro(Array.from({length:101},(_,i)=>({id:"loja-"+i,status:"ativo"})));
  assert.equal(resposta.length,0);
  assert.equal(chamadas,2);
});

test("página individual não ignora erros ou respostas RPC inválidas", () => {
  assert.match(local, /\.rpc\("catalogo_status_publicacao",\s*\{ p_ids:/);
  assert.match(local, /erroPublicacao \|\| !Array\.isArray\(publicacoes\)/);
  assert.match(local, /Este estabelecimento foi despublicado do Guia/);
  assert.doesNotMatch(local, /\.from\("comercios_publicados"\)/);
});

test("RPC publica apenas ID e status, sem SELECT direto na tabela; respeita tombstone de arquivamento", () => {
  assert.match(sql, /RETURNS TABLE\(local_id text, status text\)/);
  assert.match(sql, /SECURITY DEFINER SET search_path=''/);
  assert.match(sql, /cardinality\(p_ids\) > 100/);
  assert.match(sql, /LEFT JOIN public\.catalogo_encerramentos_comercio/);
  assert.match(sql, /e\.situacao = 'arquivado'/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.catalogo_status_publicacao\(text\[\]\) FROM PUBLIC,anon,authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.catalogo_status_publicacao\(text\[\]\) TO anon,authenticated/);
  assert.doesNotMatch(sql, /GRANT\s+SELECT\s+ON\s+(TABLE\s+)?public\.comercios_publicados/i);
});
