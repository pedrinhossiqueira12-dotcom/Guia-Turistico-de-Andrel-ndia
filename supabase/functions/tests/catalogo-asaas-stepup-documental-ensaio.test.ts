// Somente Deno offline, sem --allow-net/--allow-env e sem banco de dados.
import {
  SimuladorStepUpDocumental,
  type IntencaoDocumentalEmEnsaio,
  type PortaDeAutenticacaoFalsa,
  type SessaoAferidaEmEnsaio,
  type PortaReservaCompartilhadaMfaEmEnsaio,
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
  factorEligible?: boolean;
  factorError?: boolean;
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
    async verificarFatorTotpAal1(args) {
      calls.push({action:"preflight_factor",...args});
      if (options.factorError) throw new Error("private Auth factor lookup offline");
      return options.factorEligible !== false
        && args.userId === reviewer && args.sessionId === session
        && args.factorId === factor;
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


Deno.test("preflight do fator bloqueia challenge AAL1 sem TOTP verificado do usuario",async()=>{
 for(const options of [{factorEligible:false},{factorError:true}]) {
  const {auth,calls}=fake(options);
  const res=await sim(auth).iniciar(intent(),"before");
  assert(!res.ok &&
    (res.motivo==="fator_totp_nao_elegivel" ||
     res.motivo==="checagem_fator_totp_indisponivel"),
    "challenge emitido sem confirmar titular do TOTP "+JSON.stringify(options));
  assert(!calls.some(c=>c.action==="challenge"),"provider challenge invoked despite factor denial");
  assert(calls.filter(c=>c.action==="preflight_factor").length===1,
    "private factor ownership lookup not consulted");
  assertHold(res);
 }
});
Deno.test("preflight do fator usa somente identidade assinada e factor da intencao",async()=>{
 const {auth,calls}=fake();
 const res=await sim(auth).iniciar(intent(),"before");
 assert(res.ok,"legitimate factor ownership guard blocked fixture");
 const record=calls.find(c=>c.action==="preflight_factor");
 assert(record?.userId===reviewer && record.sessionId===session
  && record.factorId===factor,
  "wrong identity used to check factor ownership");
 assert(calls.some(c=>c.action==="challenge"),
  "challenge never called after private factor ownership accepted");
 assertHold(res);
});

Deno.test("race: autenticarToken pendente NAO permite dupla reserva do mesmo nonce",async()=>{
 const {auth,calls}=fake();
 let liberar!:()=>void;
 const gate=new Promise<void>(resolve=>{liberar=resolve});
 const original=auth.autenticarToken.bind(auth);
 auth.autenticarToken=async(token,fase)=>{
  await gate;
  return original(token,fase);
 };
 const flow=sim(auth);
 const primeira=flow.iniciar(intent(),"before");
 const duplicada=await flow.iniciar(intent(),"before");
 assert(!duplicada.ok && duplicada.motivo==="intencao_ja_vinculada",
  "segundo begin entrou enquanto primeiro aguardava Auth");
 assertHold(duplicada);
 liberar();
 const resultado=await primeira;
 assert(resultado.ok,"primeira reserva legitima nao concluiu");
 assert(calls.filter(c=>c.action==="challenge").length===1,
  "duplo desafio escapou da reserva antes de Auth");
 assertHold(resultado);
});

Deno.test("race: consulta TOTP suspensa nao deixa emitir dois desafios para nonce",async()=>{
 const {auth,calls}=fake();
 let liberar!:()=>void;
 const gate=new Promise<void>(resolve=>{liberar=resolve});
 const original=auth.verificarFatorTotpAal1.bind(auth);
 auth.verificarFatorTotpAal1=async args=>{
  await gate;
  return original(args);
 };
 const flow=sim(auth);
 const primeira=flow.iniciar(intent(),"before");
 const duplicada=await flow.iniciar(intent(),"before");
 assert(!duplicada.ok && duplicada.motivo==="intencao_ja_vinculada",
  "segundo begin entrou enquanto o backend checava TOTP");
 assert(calls.filter(c=>c.action==="challenge").length===0,
  "challenge emitido antes de concluir consulta privada TOTP");
 liberar();
 const resultado=await primeira;
 assert(resultado.ok,"consulta de fator legitima falhou");
 assert(calls.filter(c=>c.action==="challenge").length===1,
  "duplo desafio por nonce apos espera de fator");
 assertHold(resultado);assertHold(duplicada);
});

Deno.test("nonce reservado falha fechado depois de Auth recusado, sem reuso silencioso",async()=>{
 const {auth,calls}=fake({before:null});
 const flow=sim(auth);
 const first=await flow.iniciar(intent(),"before");
 assert(!first.ok && first.motivo==="sessao_ou_fator_divergente",
  "token invalido aceito");
 const second=await flow.iniciar(intent(),"before");
 assert(!second.ok && second.motivo==="intencao_ja_vinculada",
  "nonce negado voltou a ser reutilizado");
 assert(calls.filter(c=>c.action==="challenge").length===0,
  "Auth recusado emitiu challenge");
 assertHold(first);assertHold(second);
});

Deno.test("demora no preflight TOTP expira nonce sem requisitar challenge",async()=>{
 let clock=NOW;
 const {auth,calls}=fake();
 const original=auth.verificarFatorTotpAal1.bind(auth);
 auth.verificarFatorTotpAal1=async args=>{
  clock+=121_000;
  return original(args);
 };
 const flow=sim(auth,()=>clock);
 const result=await flow.iniciar(intent(),"before");
 assert(!result.ok && result.motivo==="desafio_ou_intencao_expirada",
  "nonce venceu durante preflight mas challenge foi criado");
 assert(calls.filter(c=>c.action==="challenge").length===0,
  "challenge tardio foi enviado ao provider");
 assertHold(result);
});

Deno.test("confirmacao: Auth lento deixa challenge vencer sem enviar OTP",async()=>{
 let clock=NOW;
 const {auth,calls}=fake();
 const original=auth.autenticarToken.bind(auth);
 auth.autenticarToken=async (token,fase)=>{
  if(token==="before" && fase==="inicio" && calls.some(c=>c.action==="challenge")) {
   clock+=121_000;
  }
  return original(token,fase);
 };
 const flow=sim(auth,()=>clock);
 const issued=await flow.iniciar(intent(),"before");
 assert(issued.ok && issued.tentativa,"challenge mock inicial falhou");
 const result=await flow.confirmar(issued.tentativa!,"before","123456");
 assert(!result.ok && result.motivo==="desafio_ou_intencao_expirada",
  "challenge expirado durante reautenticacao nao foi bloqueado");
 assert(calls.filter(c=>c.action==="verify").length===0,
  "OTP nao deveria ser enviado apos expirar durante await Auth");
 const retry=await flow.confirmar(issued.tentativa!,"before","123456");
 assert(!retry.ok,"tentativa expirada nao pode voltar");
 assertHold(result);assertHold(retry);
});


// Duas instancias de CI compartilham este lock sintetico; em backend real
// teria de ser implementado com Postgres e politica transacional auditada.
function gateCompartilhado(): {
  gate: PortaReservaCompartilhadaMfaEmEnsaio;
  chamadasInicio: Array<Record<string, unknown>>;
  chamadasRegistro: Array<Record<string, unknown>>;
  chamadasVerificacao: Array<Record<string, unknown>>;
} {
  const inicios = new Set<string>();
  const desafios = new Map<string, Record<string, unknown>>();
  const verificacoes = new Set<string>();
  const chamadasInicio: Array<Record<string, unknown>> = [];
  const chamadasRegistro: Array<Record<string, unknown>> = [];
  const chamadasVerificacao: Array<Record<string, unknown>> = [];
  const gate: PortaReservaCompartilhadaMfaEmEnsaio = {
    async reservarInicio(args) {
      chamadasInicio.push({...args});
      if (inicios.has(args.nonce)) return false;
      // A reserva acontece SINCRONAMENTE antes do yield de IO simulado.
      inicios.add(args.nonce);
      await Promise.resolve();
      return true;
    },
    async registrarDesafio(args) {
      chamadasRegistro.push({...args});
      // So aceita nonce previamente reservado e ID nunca utilizado,
      // inclusive em uma intencao diferente do mesmo revisor.
      if (!inicios.has(args.nonce) || desafios.has(args.challengeId)) return false;
      desafios.set(args.challengeId,{...args});
      await Promise.resolve();
      return true;
    },
    async reservarVerificacao(args) {
      chamadasVerificacao.push({...args});
      const registro=desafios.get(args.challengeId);
      if (!registro || verificacoes.has(args.challengeId)) return false;
      for(const chave of ["nonce","tentativa","challengeId","userId","sessionId", "factorId", "separationId", "evidenceHash", "expiresAt"])
        if (registro[chave]!==args[chave as keyof typeof args]) return false;
      verificacoes.add(args.challengeId);
      await Promise.resolve();
      return true;
    },
  };
  return {gate, chamadasInicio, chamadasRegistro, chamadasVerificacao};
}

Deno.test("duas instancias com gate comum nao criam dois challenges do mesmo nonce", async()=>{
  const {auth,calls}=fake();
  const {gate,chamadasInicio,chamadasRegistro,chamadasVerificacao}=gateCompartilhado();
  const a=new SimuladorStepUpDocumental(auth,()=>NOW,"isolated-ci",gate);
  const b=new SimuladorStepUpDocumental(auth,()=>NOW,"isolated-ci",gate);
  const [r1,r2]=await Promise.all([a.iniciar(intent(),"before"),b.iniciar(intent(),"before")]);
  assert(Number(r1.ok)+Number(r2.ok)===1,"dois processos venceram reserva global");
  assert(calls.filter(c=>c.action==="challenge").length===1,"dois challenges emitidos");
  assert(chamadasInicio.length===2,"gate nao consultado por ambas instancias");
  for(const entry of chamadasInicio) {
    assert(entry.userId===reviewer && entry.sessionId===session
      && entry.factorId===factor && entry.separationId===escrow
      && entry.evidenceHash==="a".repeat(64),"contexto da operacao adulterado");
    assert(!("otp" in entry) && !("bearerToken" in entry)
      && !("accessToken" in entry),"segredo enviado ao gate");
  }
  const winner=r1.ok ? {flow:a,result:r1} : {flow:b,result:r2};
  const accepted=await winner.flow.confirmar(winner.result.tentativa!,"before","123456");
  assert(accepted.ok,"gate impediu fluxo valido de laboratorio");
  assert(chamadasRegistro.length===1,"challenge nao foi fixado no gate compartilhado");
  assert(chamadasRegistro[0].nonce===nonce && chamadasRegistro[0].challengeId===challengeId
    && chamadasRegistro[0].userId===reviewer && chamadasRegistro[0].sessionId===session
    && chamadasRegistro[0].factorId===factor && chamadasRegistro[0].evidenceHash==="a".repeat(64),
    "challenge nao corresponde ao snapshot original");
  assert(!("otp" in chamadasRegistro[0])&&! ("bearerToken" in chamadasRegistro[0]),
    "segredos no armazenamento do challenge");
  assert(chamadasVerificacao.length===1,"gate de verificacao nao foi usado");
  assert(chamadasVerificacao[0].challengeId===challengeId
    && chamadasVerificacao[0].nonce===nonce,"challenge/nonce errados no consumo global");
  assert(!("otp" in chamadasVerificacao[0])
    && !("bearerToken" in chamadasVerificacao[0]),"OTP chegou ao gate");
  assertHold(r1);assertHold(r2);assertHold(accepted);
});

Deno.test("reservas compartilhadas negadas ou indisponiveis falham fechado",async()=>{
  for(const kind of ["negado","erro"] as const) {
    const {auth,calls}=fake();
    const gate:PortaReservaCompartilhadaMfaEmEnsaio={
      async reservarInicio() {
        if(kind==="erro")throw Error("db offline");
        return false;
      },
      async registrarDesafio(){throw Error("nao deve chegar aqui");},
      async reservarVerificacao(){throw Error("nao deve chegar aqui");},
    };
    const flow=new SimuladorStepUpDocumental(auth,()=>NOW,"isolated-ci",gate);
    const denied=await flow.iniciar(intent(),"before");
    assert(!denied.ok && denied.motivo===(kind==="erro"
      ?"reserva_compartilhada_inicio_indisponivel"
      :"reserva_compartilhada_inicio_duplicada"),"gate permitiu iniciar");
    assert(calls.length===0,"rede/OTP chamados apos erro da reserva inicial");
    const retry=await flow.iniciar(intent(),"before");
    assert(!retry.ok && retry.motivo==="intencao_ja_vinculada",
      "erro da reserva reutilizou nonce local");
    assertHold(denied);assertHold(retry);
  }
});

Deno.test("mesmo challenge usado em outro nonce nao verifica duas operacoes",async()=>{
  const {auth,calls}=fake();
  const {gate}=gateCompartilhado();
  const a=new SimuladorStepUpDocumental(auth,()=>NOW,"isolated-ci",gate);
  const b=new SimuladorStepUpDocumental(auth,()=>NOW,"isolated-ci",gate);
  const alternateNonce="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
  const [r1,r2]=await Promise.all([
    a.iniciar(intent(),"before"),
    b.iniciar({...intent(),nonce:alternateNonce},"before"),
  ]);
  assert(Number(r1.ok)+Number(r2.ok)===1,
    "desafio retornado pelo Auth foi vinculado a dois nonces distintos");
  assert(calls.filter(c=>c.action==="challenge").length===2,
    "a fixture nao chegou a criar dois challenges identicos");
  const winner=r1.ok ? {flow:a,result:r1} : {flow:b,result:r2};
  const loser=r1.ok ? r2 : r1;
  assert(!loser.ok && loser.motivo==="desafio_ja_vinculado_ou_invalido",
    "duplicate challenge ID exposed before storage confirmation");
  const verified=await winner.flow.confirmar(winner.result.tentativa!,"before","123456");
  assert(verified.ok,"vencedor legitimo recusado");
  assert(calls.filter(c=>c.action==="verify").length===1,
    "mesmo challenge enviou dois OTP ao fake Auth");
  assertHold(r1);assertHold(r2);assertHold(verified);
});

Deno.test("gate de consumo indisponivel ou lento nunca envia OTP",async()=>{
  for(const kind of ["false","throw","expira"] as const) {
    let clock=NOW;
    const {auth,calls}=fake();
    const gate:PortaReservaCompartilhadaMfaEmEnsaio={
      async reservarInicio(){return true;},
      async registrarDesafio(){return true;},
      async reservarVerificacao(){
        if(kind==="throw")throw Error("shared DB offline");
        if(kind==="expira"){clock+=121_000;return true;}
        return false;
      },
    };
    const flow=new SimuladorStepUpDocumental(auth,()=>clock,"isolated-ci",gate);
    const issued=await flow.iniciar(intent(),"before");
    assert(issued.ok&&issued.tentativa,"nao iniciou challenge falso");
    const denied=await flow.confirmar(issued.tentativa!,"before","123456");
    assert(!denied.ok,"verificacao aceita apos gate recusado/expirado");
    assert(calls.filter(c=>c.action==="verify").length===0,
      "OTP foi enviado sem reserva global concluida");
    const replay=await flow.confirmar(issued.tentativa!,"before","123456");
    assert(!replay.ok,"tentativa rejeitada foi reaberta");
    assertHold(denied);assertHold(replay);
  }
});


Deno.test("snapshot imutavel impede trocar operacao durante reserva compartilhada async",async()=>{
  const {auth,calls}=fake();
  let soltar!:()=>void;
  let entrou!:()=>void;
  const aguardando=new Promise<void>(resolve=>{soltar=resolve});
  const iniciouGate=new Promise<void>(resolve=>{entrou=resolve});
  let entrada: Record<string, unknown>|null=null;
  let confirmacao: Record<string, unknown>|null=null;
  const gate:PortaReservaCompartilhadaMfaEmEnsaio={
    async reservarInicio(args) {
      entrada={...args};
      entrou();
      await aguardando;
      return true;
    },
    async registrarDesafio(args) {
      return args.nonce===nonce && args.evidenceHash==="a".repeat(64);
    },
    async reservarVerificacao(args) {
      confirmacao={...args};
      return true;
    },
  };
  const original=intent();
  const flow=new SimuladorStepUpDocumental(auth,()=>NOW,"isolated-ci",gate);
  const inicio=flow.iniciar(original,"before");
  await iniciouGate;
  // Ataque TOCTOU: mutar o mesmo objeto enquanto a porta aguarda o banco.
  original.nonce="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
  original.userId=sameOwnerOther;
  original.sessionId=sessionOther;
  original.factorId=factorOther;
  original.separationId=sameOwnerOther;
  original.evidenceHash="b".repeat(64);
  original.expiresAt=NOW-1;
  original.consumed=true;
  soltar();
  const issued=await inicio;
  assert(issued.ok && issued.tentativa,
    "snapshot original nao foi preservado apos a mutacao do chamador");
  assert(calls.filter(c=>c.action==="challenge").length===1
    && calls.some(c=>c.action==="challenge" && c.factorId===factor),
    "challenge escapou com fator substituido durante o IO");
  const checked=await flow.confirmar(issued.tentativa!,"before","123456");
  assert(checked.ok,"verificacao deveria seguir identidade original congelada");
  assert(entrada?.nonce===nonce && entrada?.userId===reviewer
    && entrada?.factorId===factor && entrada?.evidenceHash==="a".repeat(64),
    "a reserva recebeu dados trocados");
  assert(confirmacao?.nonce===nonce && confirmacao?.userId===reviewer
    && confirmacao?.sessionId===session && confirmacao?.factorId===factor
    && confirmacao?.separationId===escrow
    && confirmacao?.evidenceHash==="a".repeat(64),
    "consumo recebeu campos adulterados apos a espera");
  assertHold(issued);assertHold(checked);
});


Deno.test("desafio emitido sem persistencia compartilhada nao gera tentativa utilizavel",async()=>{
  for(const mode of ["rejeitado","erro","expirou"] as const) {
    let clock=NOW;
    const {auth,calls}=fake();
    let attempts=0;
    const gate:PortaReservaCompartilhadaMfaEmEnsaio={
      async reservarInicio(){return true;},
      async registrarDesafio(args) {
        attempts++;
        assert(args.nonce===nonce && args.challengeId===challengeId
          && args.evidenceHash==="a".repeat(64)
          && args.separationId===escrow,"snapshot divergente ao registrar");
        assert(!("otp" in args)&&!("bearerToken" in args)
          &&!("refreshToken" in args),"segredo armazenado no challenge");
        if(mode==="erro")throw Error("db offline");
        if(mode==="expirou"){clock+=121_000;return true;}
        return false;
      },
      async reservarVerificacao(){throw Error("nao deve consumir tentativa recusada");},
    };
    const flow=new SimuladorStepUpDocumental(auth,()=>clock,"isolated-ci",gate);
    const opened=await flow.iniciar(intent(),"before");
    assert(!opened.ok && !opened.tentativa,"tentativa divulgada sem registro confirmado");
    assert(opened.motivo===(mode==="rejeitado"?"desafio_ja_vinculado_ou_invalido":
      mode==="erro"?"registro_compartilhado_desafio_indisponivel":
      "desafio_ou_intencao_expirada"),"reserva externa nao falhou fechado");
    assert(attempts===1,"registro nao chamado uma vez");
    assert(calls.filter(c=>c.action==="challenge").length===1,
      "fixture deveria simular challenge Auth ja emitido");
    assert(calls.filter(c=>c.action==="verify").length===0,
      "OTP chegou ao Auth sem registro do challenge");
    assertHold(opened);
  }
});
