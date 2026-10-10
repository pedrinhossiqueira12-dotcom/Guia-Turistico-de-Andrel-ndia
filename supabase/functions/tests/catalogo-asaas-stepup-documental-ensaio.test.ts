// Somente Deno offline, sem --allow-net/--allow-env e sem banco de dados.
import {
  SimuladorStepUpDocumental,
  type IntencaoDocumentalEmEnsaio,
  type PortaDeAutenticacaoFalsa,
  type SessaoAferidaEmEnsaio,
} from "../_shared/catalogo-asaas-stepup-documental-ensaio.ts";

function assert(v: unknown, m: string): asserts v { if (!v) throw new Error(m); }

const reviewer = "11111111-1111-4111-8111-111111111111";
const sameOwnerOther = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
const sessionOther = "44444444-4444-4444-8444-444444444444";
const factor = "55555555-5555-4555-8555-555555555555";
const factorOther = "66666666-6666-4666-8666-666666666666";
const escrow = "77777777-7777-4777-8777-777777777777";
const nonce = "88888888-8888-4888-8888-888888888888";
const challengeId = "99999999-9999-4999-8999-999999999999";
const NOW = 1_800_000_000_000;
const identity: SessaoAferidaEmEnsaio = {
  userId: reviewer, sessionId: session, factorId: null,
  role: "authenticated", aal: "aal1", anonymous: false,
};
const after: SessaoAferidaEmEnsaio = { ...identity, aal: "aal2", factorId: factor };
function intent(): IntencaoDocumentalEmEnsaio {
  return {
    nonce, userId: reviewer, sessionId: session, factorId: factor,
    separationId: escrow, evidenceHash: "a".repeat(64),
    purpose: "consulta_documental_ensaio", expiresAt: NOW + 300_000, consumed: false,
  };
}
function assertHold(value: Record<string, unknown>) {
  for (const key of [
    "desafio_mfa_real_comprovado", "parecer_financeiro_autorizado",
    "pagamento_autorizado", "liberacao_autorizada",
    "baixa_realizada", "movimenta_dinheiro"
  ]) assert(value[key] === false, "Nenhum simulador autoriza " + key);
  assert(value.status_operacional === "HOLD_OBRIGATORIO", "HOLD foi removido");
}
function fake(options: {
  after?: SessaoAferidaEmEnsaio | null;
  before?: SessaoAferidaEmEnsaio | null;
  issueError?: boolean;
  verifyError?: boolean;
  onVerify?: () => void;
} = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const auth: PortaDeAutenticacaoFalsa = {
    async autenticarToken(token) {
      calls.push({ action:"auth", token });
      return token === "before" ? (options.before === undefined ? identity : options.before)
        : token === "after" ? (options.after === undefined ? after : options.after)
        : null;
    },
    async criarDesafio(args) {
      calls.push({action:"challenge", ...args});
      if (options.issueError) throw new Error("offline mock failure");
      return { id: challengeId };
    },
    async verificarDesafio(args) {
      calls.push({action:"verify", ...args});
      options.onVerify?.();
      if (options.verifyError || args.otp !== "123456") throw new Error("invalid MFA");
      return {accessToken:"after"};
    },
  };
  return {auth,calls};
}
function sim(provider: PortaDeAutenticacaoFalsa, now: ()=>number = ()=>NOW) {
  return new SimuladorStepUpDocumental(provider,now,"isolated-ci");
}

Deno.test("MFA mock: challenge interno e token revalidado na mesma sessao nunca liberam Pix",async()=>{
 const {auth,calls}=fake(); const s=sim(auth);
 const issued=await s.iniciar(intent(),"before");
 assert(issued.ok && issued.tentativa, "Intencao nao gerou tentativa");
 assertHold(issued);
 const verified=await s.confirmar(issued.tentativa,"before","123456");
 assert(verified.ok && verified.protocolo_mock_validado,"Caminho feliz MOCK negado");
 assertHold(verified);
 assert(calls.some(c=>c.action==="challenge"&&c.factorId===factor),"Desafio errado");
 assert(calls.some(c=>c.action==="verify"&&c.challengeId===challengeId&&c.factorId===factor),"ID nao veio do servidor");
 assert(calls.filter(c=>c.action==="auth"&&c.token==="after").length===1,"Resposta do Auth nao foi revalidada");
 const replay=await s.confirmar(issued.tentativa,"before","123456");
 assert(!replay.ok && replay.motivo==="tentativa_indisponivel_ou_consumida","Replay aceito");
 assertHold(replay);
});
Deno.test("nenhum inicio aceita intencao expirada, consumida ou hash invalido",async()=>{
 const {auth,calls}=fake(),s=sim(auth);
 for(const change of [
  { consumed:true },{ expiresAt:NOW-1 },{ evidenceHash:"not-a-sha" },
  { purpose:"pagamento" as IntencaoDocumentalEmEnsaio["purpose"] },
  {nonce:"client_nonce_not_uuid"}, { factorId:"attacker factor" }
 ]) {
  const result=await s.iniciar({...intent(),...change},"before");
  assert(!result.ok,"Intencao invalida aceita "+JSON.stringify(change));
  assertHold(result);
 }
 assert(calls.length===0,"Requisicao invalida acionou o falso Auth");
});
Deno.test("pessoa, sessao, fator ou anonimato errados sao recusados antes do challenge",async()=>{
 for(const variant of [
  {userId:sameOwnerOther},{sessionId:sessionOther},
  {factorId:factorOther},{anonymous:true}
 ]) {
  const {auth,calls}=fake({before:{...identity,...variant}});
  const res=await sim(auth).iniciar(intent(),"before");
  assert(!res.ok&&res.motivo==="sessao_ou_fator_divergente","Confusao entre principals");
  assertHold(res);
  assert(!calls.some(c=>c.action==="challenge"),"Challenge a terceiro realizado");
 }
});
Deno.test("mesmo nonce nao emite desafio simultaneo ou duplicado",async()=>{
 const {auth,calls}=fake();const s=sim(auth);
 const [a,b]=await Promise.all([s.iniciar(intent(),"before"),s.iniciar(intent(),"before")]);
 assert(Number(a.ok)+Number(b.ok)===1,"Nonce gerou dois challenges");
 assert(calls.filter(c=>c.action==="challenge").length===1,"Dois challenges do mesmo nonce");
 assertHold(a);assertHold(b);
});
Deno.test("tentativa nao aceita OTP invalido e nao transmite segredo ao verificador",async()=>{
 const {auth,calls}=fake();const s=sim(auth), issued=await s.iniciar(intent(),"before");
 const res=await s.confirmar(issued.tentativa!,"before","a12345");
 assert(!res.ok&&res.motivo==="formato_otp_invalido","OTP nao numerico");
 assertHold(res);
 assert(!calls.some(c=>c.action==="verify"),"Formato invalido chegou ao Auth fake");
});
Deno.test("segunda sessao nao consome desafio destinado a primeira",async()=>{
 const {auth}=fake({before:{...identity,sessionId:sessionOther}});
 const s=sim(auth);const a=await s.iniciar(intent(),"before");
 assert(!a.ok,"Nao pode iniciar em outra sessao");
 const {auth:good}=fake();
 const s2=sim(good);const issued=await s2.iniciar(intent(),"before");
 const wrongToken=await s2.confirmar(issued.tentativa!,"another-session","123456");
 assert(!wrongToken.ok,"Outra sessao consumiu desafio");assertHold(wrongToken);
 const replay=await s2.confirmar(issued.tentativa!,"before","123456");
 assert(!replay.ok,"Tentativa recusada nao pode ser recuperada");
});
Deno.test("Auth mock nao confirma user, sessao ou fator diferente do original",async()=>{
 for(const change of [
  {userId:sameOwnerOther},{sessionId:sessionOther},
  {factorId:factorOther},{aal:"aal1" as const},{anonymous:true}
 ]) {
  const {auth}=fake({after:{...after,...change}}),s=sim(auth);
  const issued=await s.iniciar(intent(),"before");
  const result=await s.confirmar(issued.tentativa!,"before","123456");
  assert(!result.ok&&result.motivo==="resposta_auth_sem_mesma_sessao_aal2",
    "Auth aceitou identidade trocada "+JSON.stringify(change));
  assertHold(result);
 }
});
Deno.test("MFA errado e erro de provedor sao negativos e consomem tentativa",async()=>{
 for(const options of [{verifyError:true},{issueError:true}]){
  const {auth}=fake(options),s=sim(auth);
  const created=await s.iniciar(intent(),"before");
  if(options.issueError){assert(!created.ok,"Erro challenge nao propagado como falha");continue;}
  const fail=await s.confirmar(created.tentativa!,"before","123456");
  assert(!fail.ok,"Falha verify não negada");assertHold(fail);
  const retry=await s.confirmar(created.tentativa!,"before","123456");
  assert(!retry.ok,"Brute-force reusou challenge");
 }
});
Deno.test("expiracao de challenge impede verificar mesmo com token de sessao valido",async()=>{
 let clock=NOW;const {auth}=fake(),s=sim(auth,()=>clock);
 const issued=await s.iniciar(intent(),"before");
 clock+=121_000;
 const res=await s.confirmar(issued.tentativa!,"before","123456");
 assert(!res.ok&&res.motivo==="desafio_ou_intencao_expirada","Challenge vencido foi aceito");
 assertHold(res);
});
Deno.test("duas verificacoes concorrentes nao verificam OTP em duplicidade",async()=>{
 const {auth,calls}=fake(),s=sim(auth);
 const issued=await s.iniciar(intent(),"before");
 const [a,b]=await Promise.all([
  s.confirmar(issued.tentativa!,"before","123456"),
  s.confirmar(issued.tentativa!,"before","123456")
 ]);
 assert(Number(a.ok)+Number(b.ok)===1,"Duas chamadas verificaram o mesmo challenge");
 assert(calls.filter(c=>c.action==="verify").length===1,"Auth recebeu duas verificacoes");
 assertHold(a);assertHold(b);
});
