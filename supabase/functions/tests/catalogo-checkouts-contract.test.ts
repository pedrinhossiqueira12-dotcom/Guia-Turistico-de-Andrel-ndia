// Contratos estaticos dos dois checkouts: ambos devem usar a mesma RPC do banco.
// Estes testes nao acessam Supabase, Mercado Pago ou dados de clientes.
const pixPath = new URL("../catalogo-pedido-pix/index.ts", import.meta.url);
const offlinePath = new URL("../catalogo-pedido-offline/index.ts", import.meta.url);

Deno.test("Pix usa a precificacao central antes de criar o pedido", async () => {
  const source = await Deno.readTextFile(pixPath);
  if (!source.includes('admin.rpc("catalogo_fluxo_precificar"')) {
    throw new Error("Checkout Pix nao utiliza a RPC central de precificacao");
  }
  if (!source.includes("snapshotForOrder(subtotal, modalidade, comercioId)")) {
    throw new Error("Checkout Pix nao usa o snapshot central no pedido");
  }
});

Deno.test("Offline usa a mesma RPC e preserva o snapshot no pedido", async () => {
  const source = await Deno.readTextFile(offlinePath);
  if (!source.includes('admin.rpc("catalogo_fluxo_precificar"')) {
    throw new Error("Checkout offline nao utiliza a RPC central de precificacao");
  }
  if (!source.includes("priceOrder(")) {
    throw new Error("Checkout offline nao consulta o snapshot central");
  }
});

Deno.test("Cancelamento do comprador exige token e transacao no banco", async () => {
  const source=await Deno.readTextFile(offlinePath);
  for(const contract of [
    'STATUS_TOKEN_RE.test(token)',
    'catalogo_cancelar_comprador_v2',
    'p_status_token_hash: tokenHash',
    'await enforceRateLimit',
  ]) {
    if(!source.includes(contract)) throw new Error(`Contrato de cancelamento ausente: ${contract}`);
  }
});

Deno.test("Confirmacao de entrega exige autenticacao e RPC transacional", async () => {
  const delivery=await Deno.readTextFile(new URL("../catalogo-entregas/index.ts",import.meta.url));
  const admin=await Deno.readTextFile(new URL("../catalogo-pedidos-offline-admin/index.ts",import.meta.url));
  for(const contract of ['db.auth.getUser(token)','catalogo_confirmar_entrega_motoboy','p_codigo_hash: codeHash','membership','assigned']) {
    if(!delivery.includes(contract)) throw new Error(`Contrato de entrega ausente: ${contract}`);
  }
  for(const contract of ['db.auth.getUser(token)','catalogo_confirmar_entrega_autenticada','p_codigo_hash: codeHash']) {
    if(!admin.includes(contract)) throw new Error(`Contrato do painel ausente: ${contract}`);
  }
});
