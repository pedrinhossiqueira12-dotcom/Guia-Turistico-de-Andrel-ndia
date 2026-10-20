import { ambienteAsaasCompativelComProjeto as valido } from
  "../_shared/catalogo-asaas-ambiente-projeto.ts";

const prod = "https://xdmbkflufsfqziixzpxc.supabase.co";
const staging = "https://jbttwihctuibchhcyqtl.supabase.co";
function assert(condicao: unknown, mensagem: string) {
  if (!condicao) throw Error("COB06_GATE_AMBIENTE: " + mensagem);
}

Deno.test("COB06: projeto PROD so aceita declaracao explicita production", () => {
  assert(valido(prod, "production"), "producao configurada deve passar");
  for (const v of [undefined, "", "sandbox", "Production", "production ", "ci", "staging"]) {
    assert(!valido(prod, v), "projeto PROD deve rejeitar: " + String(v));
  }
});

Deno.test("COB06: projeto STAGING so aceita sandbox expresso", () => {
  assert(valido(staging, "sandbox"), "staging nao pode requerer chave produtiva");
  for (const v of [undefined, "", "production", "SANDBOX", "sandbox "]) {
    assert(!valido(staging, v), "STAGING deve rejeitar: " + String(v));
  }
});

Deno.test("COB06: host malicioso e dominios nao auditados nunca passam", () => {
  const invalidos = [
    "", "nao-uma-url", "https://xdmbkflufsfqziixzpxc.supabase.co.evil.invalid",
    "https://jbttwihctuibchhcyqtl.supabase.co.evil.invalid",
    "https://outro-projeto.supabase.co", "https://supabase.producao-exemplo.com",
    "https://evil.invalid@xdmbkflufsfqziixzpxc.supabase.co",
    "http://xdmbkflufsfqziixzpxc.supabase.co",
    "https://xdmbkflufsfqziixzpxc.supabase.co:8443",
    "https://xdmbkflufsfqziixzpxc.supabase.co?chave=1",
  ];
  for (const origem of invalidos) {
    assert(!valido(origem, "production"), "URL nao autorizada: " + origem);
  }
});

Deno.test("COB06: mocks locais podem testar SOMENTE sandbox", () => {
  for (const origem of ["http://localhost:54321", "http://127.0.0.1:54321",
    "https://supabase.invalid"]) {
    assert(valido(origem, "sandbox"), "mock local deve funcionar em sandbox");
    assert(!valido(origem, "production"), "mock nao pode simular PROD por acidente");
  }
});

Deno.test("COB06: caminhos extras ou segredos na URL nao sao aceitos", () => {
  for (const origem of [
    prod + "/auth/v1", prod + "/rest/v1", prod + "#token",
    staging + "?apikey=teste", staging + "/functions/v1"
  ]) {
    assert(!valido(origem, "production") && !valido(origem, "sandbox"),
      "URL nao pode conter endpoint, segredo ou fragmento");
  }
});
