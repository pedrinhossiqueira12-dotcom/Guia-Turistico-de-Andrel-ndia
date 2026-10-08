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
