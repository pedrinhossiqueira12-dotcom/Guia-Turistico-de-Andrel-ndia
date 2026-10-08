/**
 * Ferramenta de HOMOLOGAÇÃO somente Mercado Pago Payouts Sandbox.
 * Modo padrão: SIMULAÇÃO em memória sem rede / sem Supabase / sem dinheiro.
 *
 * --execute-sandbox: um único POST real para o AMBIENTE DE TESTE, com 2 flags
 * de consentimento, Access Token de TESTE, destinatário de TESTE e UUID fixo.
 * Marca o ID localmente ANTES da rede. Nunca repete POST automaticamente.
 *
 * --check-status: consulta exclusivamente GET por POP/TOP gravados.
 * Nunca grava "pago" no banco, não tem Supabase service_role e jamais
 * usa credenciais de produção. Não imprimir chaves Pix nem secrets.
 */
import {
  prepararPayoutSandbox, criarPayoutSandbox, consultarTransacaoSandbox,
  classificarTransacaoPayout, type PayoutPrepared, type PayoutTransport,
} from "../../supabase/functions/_shared/catalogo-payouts-sandbox-v2.ts";

type State = {
  schema: 1;
  runId: string;
  externalReference: string;
  transactionReference: string;
  valorCentavos: 100;
  markedBeforeNetwork: true;
  providerPayoutId?: string;
  providerTransactionId?: string;
};
const MODES = ["--dry-run", "--execute-sandbox", "--check-status"] as const;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAKE_POP="POP01KV681P6SJ38NQHWX3XK162SS";
const FAKE_TOP="TOP01KV681P6SJ38NQHWX3SF2WM22";

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function env(name: string): string {
  const value = Deno.env.get(name);
  check(!!value, "Configuração de TESTE ausente: "+name+". Nunca cole a credencial em chat ou GitHub.");
  return value;
}
function requireApprovals() {
  check(env("MP_PAYOUTS_TEST_APPROVED")==="CONFIRMO_SANDBOX",
    "Envio bloqueado: MP_PAYOUTS_TEST_APPROVED não confirma Sandbox.");
  check(env("MP_PAYOUTS_TEST_DESTINATION_APPROVED")==="DESTINO_TESTE_CONFIRMADO",
    "Destino de teste não confirmado; não realizar POST.");
}
function localStateFile(runId:string):string {
  return ".payouts-sandbox-state/"+runId.toLowerCase()+".json";
}
function checkedRunId():string {
  const id=env("MP_PAYOUTS_TEST_RUN_ID");
  check(UUID.test(id),"MP_PAYOUTS_TEST_RUN_ID precisa ser um UUID fixo para esse teste.");
  return id.toLowerCase();
}
function networkTransport():PayoutTransport {
  return (url,init)=>{
    check(url.startsWith("https://api.mercadopago.com/v1/payouts"),
      "Rede bloqueada: apenas API Payouts oficial.");
    return fetch(url,{...init,signal:AbortSignal.timeout(20000)});
  };
}
async function dryRun() {
  // IDs, token e destinatário integralmente fictícios: NENHUMA REDE.
  const prepared=prepararPayoutSandbox({
    saqueId:"123e4567-e89b-42d3-a456-426614174000",
    pixType:"EMAIL",chavePix:"qa@example.invalid",valorCentavos:100,
  });
  let posted=0, got=0;
  const transport:PayoutTransport=async(url,init)=>{
    if(init.method==="POST") {
      posted++;
      const h=new Headers(init.headers);
      check(h.get("X-test-token")==="true","Header de teste ausente.");
      check(h.get("X-Idempotency-Key")===prepared.idempotencyKey,"Idempotência incorreta.");
      check(url==="https://api.mercadopago.com/v1/payouts","URL inválida.");
      return new Response(JSON.stringify({
        id:FAKE_POP,external_reference:prepared.externalReference,
        transactions:[{id:FAKE_TOP,external_reference:prepared.transactionReference}],
      }),{status:202});
    }
    check(init.method==="GET","Método inválido.");
    got++;
    return new Response(JSON.stringify({
      id:FAKE_TOP,external_reference:prepared.transactionReference,
      status:"success",status_detail:"accredited",amount:{currency:"BRL",value:1},
    }),{status:200});
  };
  const options={testAccessToken:"FAKE_TEST_TOKEN_12345",testApproved:true,transport};
  const created=await criarPayoutSandbox(prepared,options);
  check(created.situacao==="em_processamento","HTTP 202 não deve ser recebido como pagamento.");
  const transaction=await consultarTransacaoSandbox({
    payoutId:created.payoutId,transactionId:created.transactionId,
  },options);
  const status=classificarTransacaoPayout(transaction,{
    transactionId:created.transactionId,
    externalReference:prepared.transactionReference,valorCentavos:100,
  });
  check(posted===1 && got===1 && status==="confirmado","Falha na simulação de Payouts.");
  console.log("PASS_SIMULACAO: sem rede, sem segredo, sem dinheiro e sem alterações no Supabase.");
}

async function protectedOptions():Promise<{
  runId:string;token:string;transport:PayoutTransport;
}> {
  requireApprovals();
  const runId=checkedRunId();
  const token=env("MP_PAYOUTS_TEST_ACCESS_TOKEN");
  check(token.length>=12,"Credencial de TESTE inválida.");
  return {runId,token,transport:networkTransport()};
}
function preparedForRecipient(runId:string):PayoutPrepared {
  const pixType=env("MP_PAYOUTS_TEST_PIX_TYPE");
  const pixKey=env("MP_PAYOUTS_TEST_PIX_KEY");
  // R$ 1,00 fixos. Nenhum pedido real ou conta de motoboy da produção.
  return prepararPayoutSandbox({
    saqueId:runId,pixType:pixType as "EMAIL",chavePix:pixKey,
    valorCentavos:100,
  });
}
function maskedReport(input:Record<string,unknown>) {
  // Sem token, chave, CPF, endereço ou corpo bruto da API.
  console.log(JSON.stringify(input));
}
async function executeSandbox() {
  const {runId,token,transport}=await protectedOptions();
  const prepared=preparedForRecipient(runId);
  await Deno.mkdir(".payouts-sandbox-state",{recursive:true});
  const state:State={
    schema:1,runId,externalReference:prepared.externalReference,
    transactionReference:prepared.transactionReference,
    valorCentavos:100,markedBeforeNetwork:true,
  };
  const path=localStateFile(runId);
  let file:Deno.FsFile;
  try { file=await Deno.open(path,{write:true,createNew:true,mode:0o600}); }
  catch { throw new Error("Execução com o mesmo UUID já marcada. Não repetir POST; usar --check-status ou investigar no Mercado Pago."); }
  try { await file.write(new TextEncoder().encode(JSON.stringify(state))); }
  finally {file.close();}
  try {
    const created=await criarPayoutSandbox(prepared,{
      testAccessToken:token,testApproved:true,transport,
    });
    const updated:State={...state,
      providerPayoutId:created.payoutId,
      providerTransactionId:created.transactionId,
    };
    await Deno.writeTextFile(path,JSON.stringify(updated));
    maskedReport({modo:"sandbox",resultado:"aceito_para_processamento_nao_pago",
      idPayout:created.payoutId,idTransacao:created.transactionId,
      proximo:"--check-status com o mesmo MP_PAYOUTS_TEST_RUN_ID"});
  } catch(_error) {
    // Se o POST aconteceu e houve timeout, ele pode ter sido processado.
    // Intenção local fica marcada para inspeção. NUNCA repetir aqui.
    maskedReport({modo:"sandbox",resultado:"INDETERMINADO",
      referencia:prepared.externalReference,
      proximo:"Investigar referência no provedor; não repetir POST"});
    Deno.exitCode=2;
  }
}
async function checkStatus() {
  const {runId,token,transport}=await protectedOptions();
  let stored:State;
  try {stored=JSON.parse(await Deno.readTextFile(localStateFile(runId))) as State;}
  catch {throw new Error("Não foi encontrado registro de envio. GET bloqueado.");}
  check(stored.schema===1 && stored.runId===runId &&
    stored.markedBeforeNetwork===true && stored.valorCentavos===100 &&
    stored.externalReference==="saque_"+runId.replaceAll("-",""),
    "Registro de teste não confiável.");
  check(!!stored.providerPayoutId && !!stored.providerTransactionId,
    "Resultado do POST é incerto: sem IDs POP/TOP, investigar referência no Mercado Pago, não reenviar.");
  const transaction=await consultarTransacaoSandbox({
    payoutId:stored.providerPayoutId,transactionId:stored.providerTransactionId,
  },{testAccessToken:token,testApproved:true,transport});
  const classification=classificarTransacaoPayout(transaction,{
    transactionId:stored.providerTransactionId,
    externalReference:stored.transactionReference,valorCentavos:100,
  });
  maskedReport({modo:"sandbox_consulta_somente_leitura",
    idPayout:stored.providerPayoutId,idTransacao:stored.providerTransactionId,
    classificacao:classification,alterouBanco:false,executouNovoPix:false});
}
async function main() {
  const arg=Deno.args.length===0?"--dry-run":Deno.args[0];
  check(Deno.args.length<=1 && MODES.includes(arg as typeof MODES[number]),
    "Use apenas --dry-run, --execute-sandbox ou --check-status.");
  if(arg==="--dry-run") return await dryRun();
  if(arg==="--execute-sandbox") return await executeSandbox();
  return await checkStatus();
}
if(import.meta.main){
  try { await main(); }
  catch(e){
    // NUNCA imprimir corpo da API, chave Pix ou credencial.
    console.error(e instanceof Error?e.message:"Pré-requisito de homologação indisponível.");
    Deno.exitCode=1;
  }
}
