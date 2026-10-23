// COB-06: preflight HTTP para NOVO lote QA, 100% Supabase simulado.
// Nao ha permissao de rede. Nenhuma chamada para Asaas, dinheiro ou escrita SQL.
const ROOT = "https://jbttwihctuibchhcyqtl.supabase.co";
const LOTE = "22222222-3333-4444-8888-bbbbbbbbbbbb";
const HISTORICO = "583d761a-ecb9-49be-b484-e43f6183971e";
const OPERACAO = "33333333-3333-4333-8333-cccccccccccc";
const LOJA = "asaas-cob06-qa-ciclo-independente";
const ADMIN = "4b9a0233-6b72-4573-aebd-d596c5b15e1b";
const REFERENCIA = "guia-acumulo-" + LOTE;
type Handler = (req: Request) => Promise<Response> | Response;
let handler: Handler | null = null;
let authCount=0, sqlReads=0, writes=0, external=0;
let clienteDivergente = false, origemInvalida = false, identidade = ADMIN;
function assert(ok: unknown, msg: string): asserts ok {
  if (!ok) throw new Error("COB06_NOVO_QA_HTTP_" + msg);
}
function json(v: unknown, status=200) {
  return new Response(JSON.stringify(v), {status,headers:{"content-type":"application/json"}});
}
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const uri = new URL(typeof input === "string" ? input :
    input instanceof URL ? input.href : input.url);
  const method = init?.method || (input instanceof Request ? input.method : "GET");
  if(uri.origin !== ROOT) {
    external++;
    throw Error("COB06_NOVO_QA_REDE_BANCARIA_PROIBIDA");
  }
  if(uri.pathname === "/auth/v1/user") {
    assert(method === "GET","Auth precisa ser GET");
    authCount++;
    return json({id:identidade,aud:"authenticated",role:"authenticated",app_metadata:{},user_metadata:{}});
  }
  if(uri.pathname === "/rest/v1/rpc/catalogo_asaas_conferir_conciliacao_acumulo") {
    assert(method === "POST" &&
      JSON.parse(String(init?.body)).p_lote === LOTE, "RPC somente leitura e lote exato");
    sqlReads++;
    return json({ok:true,integridade_contabil_ok:!origemInvalida,
      valor_fontes_centavos:560,pode_emitir_pix:false,
      pode_quitar:false,pode_liberar_motoboy:false});
  }
  assert(method === "GET","escrita SQL inesperada");
  sqlReads++;
  if(uri.pathname === "/rest/v1/catalogo_asaas_acumulo_lotes") {
    assert(uri.searchParams.get("id") === "eq."+LOTE,"lote alterado");
    return json({id:LOTE,comercio_id:LOJA,competencia_corte:"2027-04-01",
      total_centavos:560,estado:"preparado"});
  }
  if(uri.pathname === "/rest/v1/catalogo_asaas_acumulo_referencias") {
    assert(uri.searchParams.get("lote_id") === "eq."+LOTE,"referencia alterada");
    return json({lote_id:LOTE,operacao_id:OPERACAO,comercio_id:LOJA,
      referencia:REFERENCIA,valor_centavos:560,estado:"reservado",
      payment_id:null,pode_emitir_pix:false});
  }
  if(uri.pathname === "/rest/v1/catalogo_asaas_clientes") {
    assert(uri.searchParams.get("comercio_id") === "eq."+LOJA,"cliente outra loja");
    return json({cliente_id:clienteDivergente?"cliente_outra_loja":"cus_novoqa_12345"});
  }
  writes++;
  throw Error("COB06_NOVO_QA_TABELA_NAO_AUTORIZADA");
};
Deno.env.set("SUPABASE_URL",ROOT);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","token-exclusivamente-ficticio");
Deno.env.set("SUPABASE_SECRET_KEYS","");
Deno.env.set("ASAAS_ENVIRONMENT","sandbox");
Deno.env.set("ASAAS_API_KEY","");
Deno.env.set("ASAAS_COB06_STAGING_ADMIN_UID",ADMIN);
Deno.env.set("ASAAS_COB06_AUDITORIA_ISOLADA_ENABLED","true");
Deno.env.set("ASAAS_COB06_NOVO_QA_PREFLIGHT_ENABLED","true");
Deno.env.set("ASAAS_COB06_GET_ADMIN_READONLY_ENABLED","false");
Deno.env.set("ASAAS_COB06_GET_PERSISTENCIA_QA_ENABLED","false");
Deno.env.set("ASAAS_COB06_NOVO_LOTE_QA_ID",LOTE);
Deno.env.set("ASAAS_COB06_NOVO_COMERCIO_QA_ID",LOJA);
Deno.env.set("ASAAS_COB06_NOVO_CORTE_QA","2027-04-01");
Deno.env.set("ASAAS_COB06_NOVO_VALOR_QA_CENTAVOS","560");
const serveOriginal=Deno.serve;
try {
  Object.defineProperty(Deno,"serve",{configurable:true,writable:true,
    value:(fn:Handler)=>{handler=fn;return {finished:Promise.resolve(),shutdown:()=>{}};}});
  await import("../catalogo-asaas-cob06-auditoria/index.ts");
} finally {
  Object.defineProperty(Deno,"serve",{configurable:true,writable:true,value:serveOriginal});
}
assert(handler,"handler nao registrado");
async function post(lote:string) {
  const request = new Request(ROOT+"/functions/v1/catalogo-asaas-cob06-auditoria",{
    method:"POST",headers:{authorization:"Bearer jwt-ficticio",
      "content-type":"application/json"},
    body:JSON.stringify({acao:"preflight_novo_lote_qa_sem_rede_admin",lote_id:lote}),
  });
  const response=await handler!(request);
  return {http:response.status,body:await response.json() as Record<string,unknown>};
}
Deno.test("COB06 HTTP novo QA: somente livro local, todas as permissoes OFF",async()=>{
  const r=await post(LOTE);
  assert(r.http===200 && r.body.success===true &&
    r.body.identidade_local_conferida===true &&
    r.body.ausencia_get_anterior_comprovada===false &&
    r.body.nova_consulta_autorizada===false &&
    r.body.asaas_consultado===false && r.body.banco_alterado===false &&
    r.body.requer_nova_reserva_get_persistente===true &&
    r.body.pode_consultar_asaas===false &&
    r.body.pode_emitir_pix===false && r.body.pode_quitar===false &&
    r.body.pode_estornar===false && r.body.pode_liberar_motoboy===false &&
    r.body.hold_obrigatorio===true,"preflight deve apenas conferir identidade");
  assert(authCount===1 && sqlReads===4 && external===0 && writes===0,
    "somente 3 SELECT e 1 RPC readonly");
});
Deno.test("COB06 HTTP novo QA: lote historico nao chama qualquer tabela",async()=>{
  const before=sqlReads;
  const r=await post(HISTORICO);
  assert(r.http===403 && r.body.success===false &&
    sqlReads===before && external===0 && writes===0,"historico permanece isolado");
});
Deno.test("COB06 HTTP novo QA: nao-admin nao consulta lotes",async()=>{
  identidade="11111111-2222-4333-8444-555555555555";
  const before=sqlReads;
  const r=await post(LOTE);
  assert(r.http===403 && sqlReads===before && external===0 && writes===0,
    "Auth de outra pessoa nao le livros");
  identidade=ADMIN;
});
Deno.test("COB06 HTTP novo QA: cliente e integridade divergentes bloqueados",async()=>{
  clienteDivergente=true;
  let r=await post(LOTE);
  assert(r.http===503 && r.body.hold_obrigatorio===true &&
    r.body.pode_emitir_pix===false,"cliente invalido");
  clienteDivergente=false;
  origemInvalida=true;
  r=await post(LOTE);
  assert(r.http===503 && r.body.hold_obrigatorio===true &&
    r.body.pode_emitir_pix===false && external===0 && writes===0,"fontes invalidas");
});
