// Cobranças mensais e saques Asaas, isolados dos checkouts de pedidos Mercado Pago.
// DESLIGADO por padrão. Chaves somente em Supabase Secrets, nunca no navegador.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { decryptCourierPix } from "../_shared/catalogo-entregas-crypto-v2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const BUNDLE = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
let serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
try { const keys = BUNDLE ? JSON.parse(BUNDLE) : null; serviceKey = keys?.default || keys?.service_role || serviceKey; } catch { /* fallback */ }
const db = createClient(SUPABASE_URL, serviceKey, {auth:{persistSession:false,autoRefreshToken:false}});
const ASAAS_TOKEN = Deno.env.get("ASAAS_API_KEY") || "";
const WEBHOOK_TOKEN = Deno.env.get("ASAAS_WEBHOOK_TOKEN") || "";
// Token e flag próprios; não reutilizar o token do webhook de eventos comuns.
const WITHDRAWAL_AUTH_TOKEN = Deno.env.get("ASAAS_SAQUE_VALIDACAO_TOKEN") || "";
const WITHDRAWAL_AUTH_ON = Deno.env.get("ASAAS_SAQUE_VALIDACAO_ENABLED") === "true";
const ENCRYPTION_KEY = Deno.env.get("CATALOGO_DATA_ENCRYPTION_KEY") || Deno.env.get("MP_OAUTH_ENCRYPTION_KEY") || "";
const BILLING_ON = Deno.env.get("ASAAS_BILLING_ENABLED") === "true";
const PAYOUTS_ON = Deno.env.get("ASAAS_PAYOUTS_ENABLED") === "true";
const ENVIRONMENT = Deno.env.get("ASAAS_ENVIRONMENT") === "production" ? "production" : "sandbox";
const API_BASE = ENVIRONMENT === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
const JSON_HEADERS = {"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods":"POST,OPTIONS","Cache-Control":"no-store"};
class Failure extends Error {constructor(message:string,public status=400){super(message)}}
class SandboxTransferRejected extends Failure {}
const respond=(payload:unknown,status=200)=>new Response(JSON.stringify(payload),{status,headers:JSON_HEADERS});
const input=(x:unknown)=>x&&typeof x==="object"&&!Array.isArray(x)?x as Record<string,unknown>:{};
const value=(x:unknown,max=200)=>typeof x==="string"?x.trim().slice(0,max):"";
const money=(cents:number)=>Math.round(cents)/100;
const cents=(amount:unknown)=>typeof amount==="number"&&Number.isFinite(amount)?Math.round(amount*100):NaN;
function enabled(kind:"billing"|"payouts"){
 if(!ASAAS_TOKEN || !(kind==="billing"?BILLING_ON:PAYOUTS_ON))
   throw new Failure("Integração Asaas ainda não ativada. Nenhum dinheiro foi movimentado.",503);
}
function check(ok:unknown,msg:string,status=409):asserts ok {if(!ok)throw new Failure(msg,status);}
async function auth(req:Request){
 const token=req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token)throw new Failure("Entre na sua conta.",401);
 const {data,error}=await db.auth.getUser(token);
 if(error||!data.user)throw new Failure("Sessão inválida.",401);
 return data.user;
}
async function rpc(name:string,args:Record<string,unknown>){
 const {data,error}=await db.rpc(name,args);
 if(error){console.error("Asaas RPC",name,error.code);throw new Failure("Falha na operação financeira. Tente consultar novamente.",503);}
 check(data?.ok!==false,data?.mensagem||"Operação recusada.");
 return data;
}
async function asaas(path:string,method="GET",body?:unknown){
 // Defesa independente, na saída HTTP: esta implementação não envia saques na produção.
 if(method==="POST" && path==="/transfers"){
  if(ENVIRONMENT!=="sandbox")
   throw new Failure("Transferência Pix de produção não está liberada.",503);
  if(!WITHDRAWAL_AUTH_ON || WITHDRAWAL_AUTH_TOKEN.length<32)
   throw new Failure("Sem autorização por Webhook, saques não são permitidos.",503);
 }
 // Permitir GET de uma transferência antiga mesmo se saques novos estiverem desativados.
 // POST /transfers continua bloqueado pela flag. A baixa exige status validado do Asaas.
 if(path.startsWith("/transfers") && method==="GET"){
  if(!ASAAS_TOKEN)throw new Failure("Consulta Asaas indisponível sem credencial.",503);
 }else enabled(path.startsWith("/transfers")?"payouts":"billing");
 const response=await fetch(API_BASE+path,{
  method,headers:{"access_token":ASAAS_TOKEN,"accept":"application/json",
    "content-type":"application/json","User-Agent":"GuiaAndrelandia/1.0"},
  body:body===undefined?undefined:JSON.stringify(body),
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok){
  const details=input(result);
  const errors=Array.isArray(details.errors)?details.errors:[];
  // Registra somente códigos de erro, sem chave Pix, CPF, tokens ou detalhes de destinatário.
  const codes=errors.map((item:unknown)=>value(input(item).code,70)).filter(Boolean).slice(0,3);
  console.error("Asaas http error",{path:path.split("?")[0],status:response.status,codes});
  // Somente resposta estruturada de validação (HTTP 400) do POST Asaas Sandbox
  // é rejeição definitiva; timeout/5xx/erros não estruturados continuam em revisão.
  if(ENVIRONMENT==="sandbox" && method==="POST" && path==="/transfers"
    && response.status===400 && errors.length>0)
    throw new SandboxTransferRejected(
      "Asaas Sandbox rejeitou a transferência. Verifique a chave Pix fictícia e o saldo no Asaas; a reserva foi liberada.",422);
  throw new Failure("O provedor não confirmou a operação. Verifique o status antes de tentar novamente.",502);
 }
 return input(result);
}
function competence(s:unknown){
 const t=value(s,10);
 check(/^20\d{2}-(0[1-9]|1[0-2])$/.test(t),"Competência inválida.",400);
 return t;
}
function commerce(s:unknown){
 const t=value(s,180);
 check(/^[a-z0-9-]{1,180}$/.test(t),"Comércio inválido.",400);
 return t;
}
async function owner(uid:string,commerceId:string){
 const {data,error}=await db.from("catalogos").select("comercio_id,proprietario_id")
  .eq("comercio_id",commerceId).eq("proprietario_id",uid).maybeSingle();
 if(error||!data)throw new Failure("Você não administra este comércio.",403);
}

const TERMOS_VERSAO="2026-10-09";
const SAQUE_MINIMO_CENTAVOS=10000;
// Teto por transação conservador para contas Asaas novas; não limita o saldo acumulado.
const SAQUE_MAXIMO_PIX_CENTAVOS=500000;
async function roleScope(uid:string,papel:string,store:string,allowInactiveMotoboy=false){
 check(papel==="comercio"||papel==="motoboy","Perfil de aceite inválido.",400);
 if(papel==="comercio"){
  check(/^[a-z0-9-]{1,180}$/.test(store),"Comércio inválido.",400);
  await owner(uid,store);return store;
 }
 let query=db.from("catalogo_motoboys").select("usuario_id").eq("usuario_id",uid);
 if(!allowInactiveMotoboy)query=query.eq("ativo",true);
 const {data,error}=await query.limit(1);
 if(error)throw new Failure("Falha ao verificar autorização.",503);
 let historicoPermiteLeitura=false;
 if(!data?.length && allowInactiveMotoboy){
  // O ultimo vinculo pode ser excluido, mas a remuneracao retida/paga
  // segue ligada ao auth.users(id). Nao ativa cadastro nem permite saque.
  const {data:historico,error:historicoError}=await db.from("catalogo_remuneracoes_v2")
   .select("id").eq("motoboy_id",uid).limit(1);
  if(historicoError)throw new Failure("Falha ao verificar histórico financeiro.",503);
  historicoPermiteLeitura=Boolean(historico?.length);
 }
 check(Boolean(data?.length)||historicoPermiteLeitura,
  "Perfil de entregador não autorizado ou sem histórico financeiro.",403);
 return "";
}
async function termsStatus(uid:string,papel:string,store:string,allowInactiveMotoboy=false){
 const scope=await roleScope(uid,papel,store,allowInactiveMotoboy);
 const {data,error}=await db.from("catalogo_aceites_operacionais")
  .select("documento").eq("usuario_id",uid).eq("papel",papel)
  .eq("comercio_id",scope).eq("versao",TERMOS_VERSAO);
 if(error)throw new Failure("Falha ao consultar aceite dos termos.",503);
 const docs=new Set((data||[]).map(r=>r.documento));
 return {papel,comercio_id:scope,versao:TERMOS_VERSAO,
  termos_aceitos:docs.has("termos"),privacidade_ciente:docs.has("privacidade"),
  aceito:docs.has("termos")&&docs.has("privacidade")};
}
async function requireTerms(uid:string,papel:string,store:string,allowInactiveMotoboy=false){
 if(!(await termsStatus(uid,papel,store,allowInactiveMotoboy)).aceito)
  throw new Failure("Leia e aceite os Termos de Uso e confirme a ciência da Política de Privacidade.",428);
}
async function acceptTerms(uid:string,body:Record<string,unknown>){
 const papel=value(body.papel,15),store=papel==="comercio"?commerce(body.comercio_id):"";
 // Motoboy inativo pode renovar aceite para solicitar revisao do saldo antigo.
 // O aceite nao reativa perfil nem autoriza novas entregas/saques regulares.
 await roleScope(uid,papel,store,papel==="motoboy");
 check(body.aceito_termos===true&&body.ciente_privacidade===true,
  "Marque os dois campos para confirmar ciência.",400);
 const rows=["termos","privacidade"].map(documento=>({
  usuario_id:uid,papel,comercio_id:store,documento,versao:TERMOS_VERSAO
 }));
 const {error}=await db.from("catalogo_aceites_operacionais").upsert(rows,{
  onConflict:"usuario_id,papel,comercio_id,documento,versao",ignoreDuplicates:true
 });
 if(error)throw new Failure("Não foi possível registrar seu aceite.",503);
 return respond({success:true,...await termsStatus(uid,papel,store,papel==="motoboy")});
}
async function requestClosure(uid:string,body:Record<string,unknown>){
 const store=commerce(body.comercio_id);
 await owner(uid,store);
 const result=await rpc("catalogo_solicitar_encerramento_financeiro",{
  p_comercio:store,p_usuario:uid
 });
 return respond({success:true,...result});
}
async function invoice(uid:string,body:Record<string,unknown>){
 const store=commerce(body.comercio_id),month=competence(body.competencia);
 await owner(uid,store);
 const {data:f,error}=await db.from("catalogo_fechamentos_offline").select("*")
  .eq("comercio_id",store).eq("competencia",month+"-01").maybeSingle();
 if(error)throw new Failure("Não foi possível consultar a fatura.",503);
 let charge=null;
 if(f){
  const {data,error:e}=await db.from("catalogo_fatura_cobrancas").select("*")
    .eq("fechamento_id",f.id).maybeSingle();
  if(e)throw new Failure("Falha ao consultar cobrança.",503);
  charge=data;
 }
 return {store,month,f,charge};
}
function reference(store:string,month:string){return "fatura-"+store+"-"+month;}
function parsePix(payment:Record<string,unknown>,qr:Record<string,unknown>){
 return {code:value(qr.payload,4096),imageBase64:value(qr.encodedImage,160000),
  ticketUrl:value(payment.invoiceUrl,2048)};
}
async function verifyInvoice(paymentId:string,charge:Record<string,unknown>,store:string,month:string){
 const payment=await asaas("/payments/"+encodeURIComponent(paymentId));
 const expected=Number(charge.valor_centavos);
 check(payment.id===paymentId && payment.billingType==="PIX" &&
  payment.externalReference===reference(store,month) &&
  cents(payment.value)===expected,"Dados de cobrança divergentes. Revisão necessária.",409);
 const {data:client}=await db.from("catalogo_asaas_clientes").select("cliente_id").eq("comercio_id",store).maybeSingle();
 check(Boolean(client?.cliente_id) && client?.cliente_id===payment.customer,"Pagador da cobrança não confere.",409);
 const status=value(payment.status,50);
 let estado:"pago"|"pendente"|"estornado"|"contestado"|"cancelado"="pendente";
 if(status==="RECEIVED")estado="pago"; // CONFIRMED ainda não é saldo bancário disponível.
 else if(status==="REFUNDED")estado="estornado";
 else if(["PARTIALLY_REFUNDED","REFUND_IN_PROGRESS","CHARGEBACK_REQUESTED"].includes(status))estado="contestado";
 else if(status==="DELETED")estado="cancelado";
 const conciliado=await rpc("catalogo_confirmar_cobranca_fatura",{
  p_order_id:paymentId,p_estado:estado,p_payment_id:paymentId,
  p_valor_centavos:expected,p_detalhe:"asaas:"+status
 });
 return {payment,conciliado,estado};
}
async function loadOrCreateCustomer(store:string,body:Record<string,unknown>,email:string){
 const {data:found,error}=await db.from("catalogo_asaas_clientes").select("cliente_id").eq("comercio_id",store).maybeSingle();
 if(error)throw new Failure("Falha ao consultar cadastro Asaas.",503);
 if(found?.cliente_id)return found.cliente_id;
 const doc=value(body.documento,30).replace(/\D/g,"");
 const nome=value(body.nome_pagador,120);
 check([11,14].includes(doc.length)&&nome.length>=3,
  "Para a primeira fatura, informe nome completo ou razão social e CPF/CNPJ do pagador.",400);
 const ref="guia-comercio-"+store;
 const list=await asaas("/customers?externalReference="+encodeURIComponent(ref)+"&limit=100");
 let customer=Array.isArray(list.data)?list.data.find((c:Record<string,unknown>)=>c.externalReference===ref):null;
 if(!customer){
  customer=await asaas("/customers","POST",{
   name:nome,cpfCnpj:doc,email,externalReference:ref,notificationDisabled:true,
  });
 }
 check(Boolean(customer?.id),"Não foi possível confirmar o cadastro do pagador no Asaas.",503);
 const {error:saveError}=await db.from("catalogo_asaas_clientes")
  .upsert({comercio_id:store,cliente_id:String(customer.id)},{onConflict:"comercio_id"});
 if(saveError)throw new Failure("O cliente foi criado no provedor, mas precisa ser conciliado antes de cobrar.",503);
 return String(customer.id);
}
async function showInvoice(uid:string,body:Record<string,unknown>){
 const {f,charge}=await invoice(uid,body);
 return respond({success:true,fatura:f,cobranca_status:charge?.status||null,
  metodo_cobranca:"pix_manual",pix_automatico_disponivel:false,
  valor_centavos:f?.total_comissao_centavos||0,provedor:charge?.gateway||"asaas",
  mensagem:charge?.gateway==="mercadopago"?
    "Existe uma fatura do Mercado Pago. Ela não será migrada ou cobrada duas vezes.":undefined});
}
async function reconcileInvoice(uid:string,body:Record<string,unknown>){
 const {f,charge,store,month}=await invoice(uid,body);
 if(!charge)return respond({success:true,fatura:f,cobranca_status:null,mensagem:"Ainda não há cobrança nesta fatura."});
 if(charge.gateway!=="asaas")throw new Failure("Esta fatura pertence ao Mercado Pago. Continue pelo fluxo original.",409);
 enabled("billing");
 const proof=await verifyInvoice(String(charge.order_id),charge,store,month);
 const qr=proof.estado==="pago"?{}:await asaas("/payments/"+encodeURIComponent(String(charge.order_id))+"/pixQrCode");
 return respond({success:true,fatura:f,cobranca_status:proof.conciliado.status||proof.estado,
  valor_centavos:charge.valor_centavos,pix:parsePix(proof.payment,qr),
  mensagem:proof.estado==="pago"?"Pagamento reconhecido e fatura quitada. Créditos são disponibilizados somente quando houver remunerações elegíveis.":"Aguardando liquidação da cobrança."});
}
async function createInvoice(uid:string,body:Record<string,unknown>,email:string){
 // Regularização de obrigação já constituída não depende da aceitação
 // de novos termos; aceite continua obrigatório para iniciar novas vendas.
 const {data:method,error:methodError}=await db.from("catalogo_cobranca_preferencias")
  .select("metodo").eq("comercio_id",commerce(body.comercio_id)).maybeSingle();
 if(methodError)throw new Failure("Falha ao consultar modalidade de cobrança.",503);
 if(method?.metodo==="pix_automatico")
  throw new Failure("Pix Automático ainda não está liberado. Solicite orientação para pagamento da fatura.",503);
 enabled("billing");
 const {store,month,f,charge}=await invoice(uid,body);
 check(f&&["faturado","vencido","bloqueado"].includes(String(f.status))&&
   Number(f.total_comissao_centavos)>0,"A fatura ainda não está fechada ou já foi paga.",409);
 if(charge){
  if(charge.gateway==="asaas")return await reconcileInvoice(uid,body);
  throw new Failure("Cobrança Mercado Pago existente. Não é seguro emitir outra.",409);
 }
 const customerId=await loadOrCreateCustomer(store,body,email);
 const {data:claim,error:claimError}=await db.from("catalogo_asaas_emissoes")
  .insert({fechamento_id:f.id}).select("operacao_id").single();
 // Claim único impede duas cobranças durante chamadas concorrentes ou timeout.
 // Se já existe uma reserva, SOMENTE recuperamos via GET; nunca fazemos outro POST.
 if(claimError&&claimError.code!=="23505")
  throw new Failure("Não foi possível reservar a fatura para cobrança.",503);
 const novoClaim=!claimError&&Boolean(claim);
 const ref=reference(store,month);
 const list=await asaas("/payments?externalReference="+encodeURIComponent(ref)+"&limit=100");
 const candidates=Array.isArray(list.data)
  ? list.data.filter((p:Record<string,unknown>)=>p.externalReference===ref) : [];
 if(candidates.length>1)
  throw new Failure("Há mais de uma cobrança com a mesma referência no Asaas. Revisão manual necessária.",409);
 let payment=candidates[0]||null;
 if(!payment&&!novoClaim)
  throw new Failure("Emissão reservada e ainda não localizada no Asaas. Não é seguro emitir outro Pix automaticamente.",409);
 if(!payment){
  payment=await asaas("/payments","POST",{
   customer:customerId,billingType:"PIX",value:money(Number(f.total_comissao_centavos)),
   dueDate:value(f.vencimento_em,10)>=new Date().toISOString().slice(0,10)?
     value(f.vencimento_em,10):new Date().toISOString().slice(0,10),
   externalReference:ref,description:"Fatura Guia Andrelândia "+month,
  });
 }
 check(Boolean(payment?.id),"Cobrança sem identificador no provedor.",502);
 // Reconsulta a cobrança para validar identidade/valor antes de salvar.
 const verified=await asaas("/payments/"+encodeURIComponent(String(payment.id)));
 check(verified.customer===customerId && verified.externalReference===ref &&
  verified.billingType==="PIX" && cents(verified.value)===Number(f.total_comissao_centavos),
  "Cobrança divergente; operação reservada para revisão.",409);
 const alreadyPaid=verified.status==="RECEIVED";
 const qr=alreadyPaid?{}:await asaas("/payments/"+encodeURIComponent(String(payment.id))+"/pixQrCode");
 const pix=parsePix(verified,qr);
 if(!alreadyPaid)check(Boolean(pix.code),"Pix sem copia e cola. Consulte a cobrança no provedor.",502);
 await rpc("catalogo_asaas_registrar_fatura",{
  p_fechamento:f.id,p_payment:verified.id,p_valor:f.total_comissao_centavos,
  p_qr:pix.code,p_imagem:pix.imageBase64,p_url:pix.ticketUrl,
  p_expira:qr.expirationDate||null
 });
 if(alreadyPaid)await verifyInvoice(String(verified.id),
  {order_id:verified.id,valor_centavos:f.total_comissao_centavos},store,month);
 return respond({success:true,order_id:verified.id,fatura:f,valor_centavos:f.total_comissao_centavos,
  cobranca_status:alreadyPaid?"pago":"pendente",pix,
  mensagem:alreadyPaid?"Cobrança recuperada e pagamento conciliado.":"Pix Asaas emitido. Aguarde a confirmação do recebimento."});
}
function pixDestination(key:string){
 const cleaned=key.trim(),digits=cleaned.replace(/\D/g,"");
 if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned))return {pixAddressKey:cleaned,pixAddressKeyType:"EMAIL"};
 if(/^\d{11}$/.test(digits)&&/^\d{11}$/.test(cleaned.replace(/[.\-]/g,"")))
  return {pixAddressKey:digits,pixAddressKeyType:"CPF"};
 if(digits.length===14 && /^[\d.\-/]+$/.test(cleaned))
  return {pixAddressKey:digits,pixAddressKeyType:"CNPJ"};
 if(/^\+55\d{11}$/.test(cleaned))return {pixAddressKey:cleaned.slice(3),pixAddressKeyType:"PHONE"};
 if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleaned))
  return {pixAddressKey:cleaned,pixAddressKeyType:"EVP"};
 throw new Failure("Chave Pix inválida. Use CPF, CNPJ, e-mail, telefone com +55 ou chave aleatória.",400);
}
async function wallet(uid:string,withReconcile=false){
 // O mesmo entregador pode integrar varios comercios: um vinculo inativo
 // nao deve ocultar outro vinculo ativo. Consultas independentes de 1 linha.
 const [{data:allowed,error:e},{data:active,error:activeError}]=await Promise.all([
  db.from("catalogo_motoboys").select("usuario_id").eq("usuario_id",uid).limit(1),
  db.from("catalogo_motoboys").select("usuario_id").eq("usuario_id",uid)
   .eq("ativo",true).limit(1)
 ]);
 if(e||activeError)throw new Failure("Falha ao verificar perfil de entregador.",503);
 let titularHistorico=false;
 if(!allowed?.length){
  // Carteira de ex-entregador sem ultimo vinculo: somente autenticação +
  // remuneracoes registradas para o proprio usuario permitem acesso.
  const {data:credits,error:creditsError}=await db.from("catalogo_remuneracoes_v2")
   .select("id").eq("motoboy_id",uid).limit(1);
  if(creditsError)throw new Failure("Falha ao conferir histórico do entregador.",503);
  titularHistorico=Boolean(credits?.length);
 }
 if(!allowed?.length&&!titularHistorico)
  throw new Failure("Perfil de entregador não autorizado ou sem histórico financeiro.",403);
 const activeCourier=Boolean(active?.length);
 if(withReconcile){
  const {data:pending}=await db.from("catalogo_asaas_saques").select("id,transferencia_id")
   .eq("motoboy_id",uid).in("status",["enviado","revisao"]).not("transferencia_id","is",null).limit(5);
  for(const row of pending||[]){
   try {await reconcileTransfer(String(row.id),String(row.transferencia_id));}
   catch { /* Nunca liberar por erro de rede; o saldo continua reservado. */ }
  }
 }
 const balance=await rpc("catalogo_asaas_saldo_historico",{p_motoboy:uid});
 const pendencias=await rpc("catalogo_asaas_pendencias_historicas",{p_motoboy:uid});
 const {data:residual,error:residualError}=await db.from("catalogo_asaas_saldos_residuais")
   .select("id,status,saldo_snapshot_centavos,motivo,solicitado_em,detalhe_revisao")
   .eq("motoboy_id",uid).order("solicitado_em",{ascending:false}).limit(1).maybeSingle();
 if(residualError)throw new Failure("Consulta de saldo residual indisponível.",503);
 const {data:saida,error:saidaError}=await db.from("catalogo_asaas_regularizacoes_inativos")
   .select("id,status,saldo_snapshot_centavos,motivo,solicitado_em,justificativa")
   .eq("motoboy_id",uid).order("solicitado_em",{ascending:false}).limit(1).maybeSingle();
 if(saidaError)throw new Failure("Consulta de regularização financeira indisponível.",503);
 const {data:history,error}=await db.from("catalogo_asaas_saques")
  .select("id,status,valor_centavos,criado_em,concluido_em")
  .eq("motoboy_id",uid).order("criado_em",{ascending:false}).limit(20);
 if(error)throw new Failure("Histórico de saques indisponível.",503);
 const {data:observacoesBancarias,error:evidenceError}=await db
  .from("catalogo_asaas_transferencias_excepcionais_auditoria")
  .select("id").eq("motoboy_id",uid).limit(1);
 if(evidenceError)throw new Failure("Conciliação financeira indisponível. Saques suspensos por segurança.",503);
 const evidenciaBancariaPendente=Boolean(observacoesBancarias?.length);
 const {data:separacaoContabil,error:separacaoError}=await db
  .from("catalogo_asaas_separacoes_excepcionais")
  .select("id,tipo,valor_centavos,creditos,situacao,criado_em")
  .eq("motoboy_id",uid).maybeSingle();
 if(separacaoError)throw new Failure("Falha ao conferir créditos em reserva excepcional. Saques suspensos.",503);
 // Indicacao de interface: a trava definitiva e transacional no PostgreSQL.
 const revisaoExcepcionalAberta=Boolean(
   (residual&&["pendente","em_analise"].includes(residual.status))||
   (saida&&["pendente","em_analise"].includes(saida.status))
 );
 return respond({success:true,
   entregador_ativo:activeCourier,
   revisao_excepcional_aberta:revisaoExcepcionalAberta,
   evidencia_bancaria_pendente:evidenciaBancariaPendente,
   separacao_contabil_excepcional:separacaoContabil||null,
   saque_habilitado:activeCourier&&!revisaoExcepcionalAberta&&!evidenciaBancariaPendente&&!separacaoContabil&&ENVIRONMENT==="sandbox"&&PAYOUTS_ON&&WITHDRAWAL_AUTH_ON&&
     WITHDRAWAL_AUTH_TOKEN.length>=32&&Boolean(ASAAS_TOKEN),
   saque_minimo_centavos:SAQUE_MINIMO_CENTAVOS,
   saque_maximo_por_pix_centavos:SAQUE_MAXIMO_PIX_CENTAVOS,
   total_comissoes_disponiveis:Number(balance.creditos||0),
   saldo_disponivel_centavos:balance.disponivel_centavos||0,
   pendencias_por_comercio:Array.isArray(pendencias)?pendencias:[],
   saldo_residual:residual||null,
   regularizacao_saida:saida||null,
   saques:history||[]});
}
// Solicitação administrativa de saldo residual: não cria saque nem chama o Asaas.
async function solicitarAnaliseResidual(uid:string,body:Record<string,unknown>){
 // Inatividade do entregador nao extingue creditos nem impede sua revisao.
 await requireTerms(uid,"motoboy","",true);
 const motivo=value(body.motivo,30);
 check(motivo==="encerramento"||motivo==="inatividade",
  "Informe o motivo do pedido de análise.",400);
 const saldo=await rpc("catalogo_asaas_saldo_historico",{p_motoboy:uid});
 const amount=Number(saldo.disponivel_centavos||0);
 check(Number.isSafeInteger(amount)&&amount>0&&amount<SAQUE_MINIMO_CENTAVOS,
  "A revisão de saldo residual exige valor liberado entre R$ 0,01 e R$ 99,99.",409);
 const {data:pending,error:pendingError}=await db.from("catalogo_asaas_saldos_residuais")
   .select("id,status").eq("motoboy_id",uid).in("status",["pendente","em_analise"])
   .order("solicitado_em",{ascending:false}).limit(1).maybeSingle();
 if(pendingError)throw new Failure("Falha ao consultar solicitações de revisão.",503);
 if(pending)return respond({success:true,id:pending.id,status:pending.status,
   mensagem:"Sua análise de saldo residual já está registrada. Nenhum Pix foi enviado."});
 const {data,error}=await db.from("catalogo_asaas_saldos_residuais")
   .insert({motoboy_id:uid,saldo_snapshot_centavos:amount,motivo})
   .select("id,status").single();
 if(error?.code==="23505")
   return respond({success:true,status:"pendente",
    mensagem:"Já existe uma análise de saldo residual para sua conta. Nenhum Pix foi enviado."});
 if(error?.code==="23514")
  throw new Failure("Existe outro pedido financeiro em aberto. Aguarde a revisão ou procure a administração.",409);
 if(error||!data)throw new Failure("Não foi possível registrar seu pedido de análise.",503);
 return respond({success:true,id:data.id,status:data.status,
   mensagem:"Solicitação de análise registrada. Não é uma transferência e não altera seu saldo disponível."});
}
// Registra direito de pedir regularização, sem liberar créditos/saques.
// Só atende motoboy sem NENHUM vínculo ativo e com >=R$100 financiados.
async function solicitarRegularizacaoSaida(uid:string,body:Record<string,unknown>){
 await requireTerms(uid,"motoboy","",true);
 const motivo=value(body.motivo,30);
 check(["encerramento","inatividade"].includes(motivo),"Selecione o motivo do pedido.",400);
 const {data:active,error:activeError}=await db.from("catalogo_motoboys")
  .select("usuario_id").eq("usuario_id",uid).eq("ativo",true).limit(1);
 if(activeError)throw new Failure("Falha ao verificar situação de entrega.",503);
 check(!active?.length,"Seu perfil ainda possui vínculo ativo. Use o fluxo de saque regular quando estiver disponível.",409);
 const saldo=await rpc("catalogo_asaas_saldo_historico",{p_motoboy:uid});
 const amount=Number(saldo.disponivel_centavos||0);
 check(Number.isSafeInteger(amount)&&amount>=SAQUE_MINIMO_CENTAVOS,
  "Regularização de saída exige pelo menos R$ 100 em créditos disponíveis. Para valores menores, utilize análise residual.",409);
 const {data:pending,error:pendingError}=await db.from("catalogo_asaas_regularizacoes_inativos")
  .select("id,status").eq("motoboy_id",uid).in("status",["pendente","em_analise"])
  .limit(1).maybeSingle();
 if(pendingError)throw new Failure("Não foi possível conferir regularizações anteriores.",503);
 if(pending)return respond({success:true,id:pending.id,status:pending.status,
   mensagem:"Sua solicitação de regularização já está registrada. Nenhuma transferência foi iniciada."});
 const {data,error}=await db.from("catalogo_asaas_regularizacoes_inativos")
  .insert({motoboy_id:uid,saldo_snapshot_centavos:amount,motivo})
  .select("id,status").single();
 if(error?.code==="23505")return respond({success:true,status:"pendente",
   mensagem:"Já existe uma regularização aberta. Nenhuma transferência foi iniciada."});
 if(error?.code==="23514")
  throw new Failure("Existe uma análise residual aberta. Aguarde a revisão antes de pedir a regularização.",409);
 if(error||!data)throw new Failure("Falha ao registrar regularização financeira.",503);
 return respond({success:true,id:data.id,status:data.status,
  mensagem:"Regularização solicitada para conferência administrativa. Não é saque, Pix ou promessa de data de pagamento."});
}
// Leitura financeira do pedido de encerramento sem expor valores a terceiros.
async function consultarEncerramento(uid:string,body:Record<string,unknown>){
 const store=commerce(body.comercio_id);
 await owner(uid,store);
 const {data,error}=await db.from("catalogo_encerramentos_comercio")
   .select("situacao,divida_apurada_centavos,solicitado_em,atualizado_em")
   .eq("comercio_id",store).maybeSingle();
 if(error)throw new Failure("Não foi possível consultar seu encerramento.",503);
 return respond({success:true,encerramento:data||null});
}
async function listarEncerramentosAdmin(uid:string){
 if(uid!==ADMIN_USER_ID)throw new Failure("Acesso exclusivo do administrador.",403);
 const {data,error}=await db.from("catalogo_encerramentos_comercio")
  .select("comercio_id,situacao,divida_apurada_centavos,solicitado_em,atualizado_em")
  .neq("situacao","arquivado").order("solicitado_em",{ascending:true}).limit(100);
 if(error)throw new Failure("Não foi possível listar encerramentos.",503);
 return respond({success:true,encerramentos:data||[]});
}
async function finalizarEncerramentoAdmin(uid:string,body:Record<string,unknown>){
 if(uid!==ADMIN_USER_ID)throw new Failure("Acesso exclusivo do administrador.",403);
 check(body.confirmacao===true,"Confirme que conferiu as faturas e os pedidos.",400);
 const store=commerce(body.comercio_id);
 const result=await rpc("catalogo_finalizar_encerramento_financeiro",{
  p_comercio:store,p_admin:uid
 });
 return respond({success:true,...result});
}
async function listarAnalisesResiduais(uid:string){
 if(uid!==ADMIN_USER_ID)throw new Failure("Acesso exclusivo da administração.",403);
 const {data,error}=await db.from("catalogo_asaas_saldos_residuais")
  .select("id,motoboy_id,status,saldo_snapshot_centavos,motivo,solicitado_em")
  .in("status",["pendente","em_analise"])
  .order("solicitado_em",{ascending:true}).limit(100);
 if(error)throw new Failure("Fila de análise indisponível.",503);
 return respond({success:true,solicitacoes:data||[],
  mensagem:"Fila apenas de leitura. Nenhum repasse é iniciado por esta consulta."});
}
// Decisão administrativa SEM movimentação de créditos, saque ou transferência.
// Estados possíveis: pendente -> em_analise -> recusada; recusa também pode ser direta.
// A recusa encerra apenas a solicitação de análise, não a obrigação financeira.
async function revisarAnaliseResidual(uid:string,body:Record<string,unknown>){
 if(uid!==ADMIN_USER_ID)throw new Failure("Acesso exclusivo da administração.",403);
 const id=value(body.solicitacao_id,70);
 check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
  "Identificador da solicitação inválido.",400);
 const esperado=value(body.status_esperado,30);
 const destino=value(body.novo_status,30);
 check(["pendente","em_analise"].includes(esperado),"Atualize a fila antes de revisar.",409);
 check(destino==="recusada"||(destino==="em_analise"&&esperado==="pendente"),
  "Transição de análise não permitida.",409);
 const detalhe=typeof body.justificativa==="string"?body.justificativa.trim():"";
 check(detalhe.length<=1000,"A justificativa deve ter no máximo 1.000 caracteres.",400);
 if(destino==="recusada")
  check(detalhe.length>=20,"Explique a recusa com pelo menos 20 caracteres.",400);
 const agora=new Date().toISOString();
 const {data,error}=await db.from("catalogo_asaas_saldos_residuais")
  .update({status:destino,detalhe_revisao:detalhe||null,
    analisado_por:destino==="recusada"?uid:null,atualizado_em:agora,
    finalizado_em:destino==="recusada"?agora:null})
  .eq("id",id).eq("status",esperado)
  .select("id,status").maybeSingle();
 if(error)throw new Failure("Não foi possível registrar a revisão.",503);
 if(!data)throw new Failure("A solicitação mudou de estado. Atualize a fila antes de continuar.",409);
 return respond({success:true,solicitacao_id:data.id,status:data.status,
   mensagem:destino==="recusada"
    ?"Análise encerrada com justificativa. O saldo do entregador permanece intacto; nenhum Pix foi enviado."
    :"Solicitação marcada para análise. Nenhum crédito foi movimentado."});
}
// Revisão administrativa não cria Pix nem representa quitação.
// A recusa encerra apenas o pedido; as comissões e a dívida são preservadas.
async function listarRegularizacoesSaidaAdmin(uid:string){
 if(uid!==ADMIN_USER_ID)throw new Failure("Acesso restrito à administração.",403);
 const {data,error}=await db.from("catalogo_asaas_regularizacoes_inativos")
  .select("id,motoboy_id,saldo_snapshot_centavos,motivo,status,solicitado_em")
  .in("status",["pendente","em_analise"])
  .order("solicitado_em",{ascending:true}).limit(100);
 if(error)throw new Failure("Não foi possível listar regularizações financeiras.",503);
 return respond({success:true,solicitacoes:data||[]});
}
// Monitoramento administrativo de separacoes CONTABEIS imutaveis.
// Nenhum endpoint permite desbloquear, quitar ou enviar Pix.
async function listarSeparacoesCongeladasAdmin(uid:string){
 if(uid!==ADMIN_USER_ID)throw new Failure("Acesso restrito à administração.",403);
 const {data,error,count}=await db.from("catalogo_asaas_separacoes_excepcionais")
  .select("id,tipo,solicitacao_id,motoboy_id,valor_centavos,creditos,situacao,criado_em",
    {count:"exact"})
  .order("criado_em",{ascending:false}).limit(100);
 if(error)throw new Failure("Não foi possível consultar separações contábeis.",503);
 return respond({success:true,separacoes:data||[],total:count,
  ha_mais:count!==null&&count>100,
  mensagem:"Lista de reservas contábeis sem liquidação; nenhuma ação de desbloqueio disponível."});
}
async function diagnosticarSeparacaoCongeladaAdmin(uid:string,body:Record<string,unknown>){
 if(uid!==ADMIN_USER_ID)throw new Failure("Acesso restrito à administração.",403);
 const id=value(body.separacao_id,70);
 check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
  "Identificador da separação inválido.",400);
 const diagnostico=await rpc("catalogo_asaas_diagnosticar_separacao_excepcional",
  {p_separacao:id});
 check(diagnostico?.ok===true,"Diagnóstico contábil não disponível.",409);
 // Impossivel transformar um diagnostico em autorizacao de pagamento.
 check(diagnostico.liberacao_automatica_autorizada===false&&
   diagnostico.quitacao_automatica_autorizada===false&&
   diagnostico.pode_reutilizar_creditos===false,
   "Resposta contábil insegura. Operação bloqueada.",503);
 return respond({success:true,diagnostico,
  mensagem:"Diagnóstico somente leitura; não autoriza nenhum Pix, baixa ou desbloqueio."});
}
// Somente conferencia de valores. NUNCA autoriza ou inicia uma transferencia.
async function preconferirExcepcionalAdmin(uid:string,body:Record<string,unknown>){
 if(uid!==ADMIN_USER_ID)throw new Failure("Acesso restrito à administração.",403);
 const id=value(body.solicitacao_id,70);
 const tipo=value(body.tipo,15);
 check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
  "Identificador da solicitação inválido.",400);
 check(tipo==="residual"||tipo==="saida","Tipo de solicitação inválido.",400);
 const resultado=await rpc("catalogo_asaas_preconferir_pagamento_excepcional",{
  p_tipo:tipo,p_solicitacao:id
 });
 // Comparacao exclusivamente forense: foto gravada quando um GET bancario
 // foi observado, nao necessariamente quando o Pix foi enviado.
 const {data:foto,error:fotoError}=await db
  .from("catalogo_asaas_transferencias_excepcionais_auditoria")
  .select("creditos_fingerprint_observado_sha256,creditos_observados,valor_creditos_observados_centavos,composicao_conferida_na_observacao,fotografia_observada_em")
  .eq("tipo",tipo).eq("solicitacao_id",id).maybeSingle();
 if(fotoError)throw new Failure("Não foi possível consultar a fotografia da auditoria bancária.",503);
 const igual=Boolean(foto?.creditos_fingerprint_observado_sha256&&
  resultado?.fingerprint_creditos_sha256&&
  foto.creditos_fingerprint_observado_sha256===resultado.fingerprint_creditos_sha256);
 return respond({success:true,conferencia:resultado,
  fotografia_bancaria:foto?{...foto,fingerprint_igual_ao_atual:igual}:null,
  mensagem:"Pré-conferência somente de leitura. A fotografia bancária não atesta destinatário, pagamento ou autorização de Pix."});
}
// Auditoria do Asaas via GET, exclusivamente Sandbox. Não cria transferência,
// não atesta destinatário, não baixa créditos e não marca a análise como paga.
// Consulta compartilhada por admin e webhook. Sempre faz novo GET autenticado
// do Asaas Sandbox; nenhum status do cliente ou webhook é aceito como prova.
async function consultarERegistrarTransferenciaExcepcionalSandbox(
 tipo:string,solicitacaoId:string,transferenciaId:string
){
 if(ENVIRONMENT!=="sandbox")throw new Failure("Auditoria excepcional disponível somente no Sandbox.",403);
 if(!ASAAS_TOKEN)throw new Failure("Credencial Asaas Sandbox não configurada.",503);
 check(["residual","saida"].includes(tipo),"Tipo de solicitação inválido.",400);
 check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(solicitacaoId),
  "Identificador da solicitação inválido.",400);
 check(/^[A-Za-z0-9_-]{4,130}$/.test(transferenciaId),"Identificador de transferência inválido.",400);

 const tabela=tipo==="residual"?"catalogo_asaas_saldos_residuais":"catalogo_asaas_regularizacoes_inativos";
 const {data:solicitacao,error}=await db.from(tabela)
  .select("id,motoboy_id,saldo_snapshot_centavos,status").eq("id",solicitacaoId).maybeSingle();
 if(error||!solicitacao)throw new Failure("Solicitação financeira não encontrada.",404);

 const t=await asaas("/transfers/"+encodeURIComponent(transferenciaId));
 const externalReference="guia-exc:"+tipo+":"+solicitacaoId;
 check(t.id===transferenciaId&&t.externalReference===externalReference,
  "Referência do provedor não corresponde à solicitação.",409);
 const valor=cents(t.value);
 check(valor===Number(solicitacao.saldo_snapshot_centavos),
  "Valor da transferência diverge da solicitação. Revisão manual necessária.",409);
 const status=value(t.status,40);
 check(["PENDING","IN_BANK_PROCESSING","BLOCKED","DONE","FAILED","CANCELLED"].includes(status),
  "Estado bancário desconhecido. Registro suspenso para revisão.",409);
 return await rpc("catalogo_asaas_registrar_observacao_excepcional",{
  p_tipo:tipo,p_solicitacao:solicitacaoId,p_transferencia:transferenciaId,
  p_referencia:externalReference,p_valor_centavos:valor,p_estado:status
 });
}
async function observarTransferenciaExcepcionalSandboxAdmin(uid:string,body:Record<string,unknown>){
 if(uid!==ADMIN_USER_ID)throw new Failure("Acesso restrito à administração.",403);
 const tipo=value(body.tipo,15),solicitacaoId=value(body.solicitacao_id,70);
 const transferenciaId=value(body.transferencia_id,130);
 const evidencia=await consultarERegistrarTransferenciaExcepcionalSandbox(tipo,solicitacaoId,transferenciaId);
 return respond({success:true,observacao:evidencia,
  mensagem:"Estado consultado no Asaas Sandbox e registrado. Destinatário ainda não validado; nenhum saldo foi baixado nem Pix foi enviado."});
}
async function revisarRegularizacaoSaidaAdmin(uid:string,body:Record<string,unknown>){
 if(uid!==ADMIN_USER_ID)throw new Failure("Acesso restrito à administração.",403);
 const id=value(body.solicitacao_id,70);
 check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
  "Identificador inválido.",400);
 const esperado=value(body.status_esperado,20);
 const destino=value(body.novo_status,20);
 check(["pendente","em_analise"].includes(esperado),"Atualize a fila de solicitações.",409);
 check(destino==="recusada"||(destino==="em_analise"&&esperado==="pendente"),
  "Mudança de estado não autorizada.",409);
 const justificativa=typeof body.justificativa==="string"?body.justificativa.trim():"";
 check(justificativa.length<=1000,"Justificativa muito longa.",400);
 if(destino==="recusada")
  check(justificativa.length>=20,"Explique a recusa em pelo menos 20 caracteres.",400);
 const agora=new Date().toISOString();
 const {data,error}=await db.from("catalogo_asaas_regularizacoes_inativos")
  .update({status:destino,justificativa:justificativa||null,
    revisado_por:destino==="recusada"?uid:null,
    finalizado_em:destino==="recusada"?agora:null,
    atualizado_em:agora})
  .eq("id",id).eq("status",esperado)
  .select("id,status").maybeSingle();
 if(error)throw new Failure("Não foi possível registrar decisão administrativa.",503);
 if(!data)throw new Failure("A solicitação mudou; atualize a lista.",409);
 return respond({success:true,id:data.id,status:data.status,
  mensagem:destino==="recusada"
   ?"Revisão administrativa encerrada. Os créditos continuam registrados e nenhum pagamento foi realizado."
   :"Solicitação em análise. Nenhum crédito foi movimentado."});
}
async function reconcileTransfer(saqueId:string,transferId:string){
 const transfer=await asaas("/transfers/"+encodeURIComponent(transferId));
 check(transfer.id===transferId&&transfer.externalReference===saqueId,"Transferência de outro identificador.",409);
 const {data:row,error}=await db.from("catalogo_asaas_saques")
  .select("id,valor_centavos,transferencia_id,status,pix_destino_sha256").eq("id",saqueId).maybeSingle();
 if(error||!row||row.transferencia_id!==transferId)throw new Failure("Transferência não vinculada.",409);
 check(cents(transfer.value)===Number(row.valor_centavos),"Valor da transferência divergente. Saque em revisão.",409);
 const status=value(transfer.status,60);
 if(status==="DONE"){
  // A resposta DONE prova o estado bancario, NAO prova por si so o destino.
  // Mesmo se a chave do perfil mudou, comparar com HMAC do POST original.
  check(await destinoPixConfirmadoParaBaixa(row,transfer),
   "Asaas confirmou a transferência, mas o destino Pix não pôde ser validado. Saque permanece em revisão.",409);
  return await rpc("catalogo_asaas_atualizar_saque",
   {p_saque:saqueId,p_estado:"concluido",p_transferencia:transferId,p_mensagem:null});
 }
 if(["FAILED","CANCELLED"].includes(status))return await rpc("catalogo_asaas_atualizar_saque",
  {p_saque:saqueId,p_estado:"falhou",p_transferencia:transferId,p_mensagem:"Transferência recusada pelo Asaas"});
 return {ok:true,status:"enviado"};
}
// Consulta somente de leitura para investigar reservas sem ID Asaas.
// Habilitada exclusivamente no Sandbox e para o titular da reserva.
async function auditPendingSandboxTransfer(uid:string){
 if(ENVIRONMENT!=="sandbox")throw new Failure("Auditoria de homologação indisponível em produção.",403);
 if(!ASAAS_TOKEN)throw new Failure("Credencial Asaas Sandbox não configurada.",503);
 const {data:row,error}=await db.from("catalogo_asaas_saques")
  .select("id,motoboy_id,status,valor_centavos,transferencia_id,criado_em")
  .eq("motoboy_id",uid).eq("status","revisao").is("transferencia_id",null)
  .order("criado_em",{ascending:false}).limit(1).maybeSingle();
 if(error)throw new Failure("Não foi possível consultar a reserva.",503);
 if(!row)return respond({success:true,em_revisao:false,mensagem:"Não há reserva em revisão sem ID de transferência."});
 const created=new Date(String(row.criado_em));
 if(!Number.isFinite(created.getTime()))throw new Failure("Data da reserva inválida.",503);
 const from=new Date(created.getTime()-86400000).toISOString().slice(0,10);
 const matches:Array<{id:string,status:string,valor_centavos:number}>=[];
 let checked=0;
 for(let offset=0;offset<=4900;offset+=100){
  const path="/transfers?limit=100&offset="+offset+"&dateCreated%5Bge%5D="+from;
  const response=await fetch(API_BASE+path,{headers:{
   "access_token":ASAAS_TOKEN,"accept":"application/json","User-Agent":"GuiaAndrelandia/1.0",
  }});
  if(!response.ok)throw new Failure("Asaas não permitiu consultar o histórico de transferências ("+response.status+").",502);
  const result=input(await response.json().catch(()=>({})));
  if(!Array.isArray(result.data))throw new Failure("Lista de transferências inválida: manter reserva para revisão.",503);
  checked+=result.data.length;
  for(const entry of result.data){
   const t=input(entry);
   if(value(t.externalReference,180)===String(row.id)){
    matches.push({id:value(t.id,130),status:value(t.status,70),valor_centavos:cents(t.value)});
   }
  }
  if(result.hasMore===false)return respond({success:true,em_revisao:true,saque_id:row.id,
   valor_centavos:row.valor_centavos,consultadas:checked,listagem_completa:true,
   transferencias:matches,mensagem:matches.length?
   "Transferência localizada no Asaas. Não repetir; conciliação necessária.":
   "Nenhuma transferência correspondente encontrada no histórico consultado do Asaas Sandbox. A reserva permanece bloqueada até a revisão."});
  if(result.hasMore!==true)throw new Failure("Paginação Asaas inconclusiva. Reserva mantida.",503);
 }
 throw new Failure("Histórico Asaas extenso demais para auditoria automática. Reserva mantida.",503);
}
async function withdraw(uid:string){
 await requireTerms(uid,"motoboy","");
 // Defesa de homologação: nenhuma transferência pode partir desta função em produção,
 // mesmo se alguém ativar ASAAS_PAYOUTS_ENABLED por engano.
 if(ENVIRONMENT!=="sandbox")
  throw new Failure("Saques Asaas ainda não liberados para produção.",503);
 enabled("payouts");
 // Falha fechada: token e validação de saques devem estar ativos ANTES de
 // reservar saldo ou emitir POST /transfers no Asaas.
 if(!WITHDRAWAL_AUTH_ON || WITHDRAWAL_AUTH_TOKEN.length<32)
  throw new Failure("Autorização de saída por Webhook desabilitada. Saques suspensos.",503);
 const {data:profile,error}=await db.from("catalogo_motoboy_perfis")
  .select("chave_pix_enc,em_analise").eq("usuario_id",uid).maybeSingle();
 if(error||!profile||profile.em_analise||!profile.chave_pix_enc)throw new Failure("Cadastre sua chave Pix e confirme seu perfil.",409);
 const pix=pixDestination(await decryptCourierPix(String(profile.chave_pix_enc),ENCRYPTION_KEY,uid));
 // Criptografia e validação locais ANTES de reservar créditos. Se falharem, nenhum saldo fica bloqueado.
 const destinationHash=await pixFingerprint(pix.pixAddressKeyType,pix.pixAddressKey);
 const reserved=await rpc("catalogo_asaas_reservar_saque",{p_motoboy:uid});
 const saqueId=String(reserved.saque_id),amount=Number(reserved.valor_centavos);
 check(amount>=SAQUE_MINIMO_CENTAVOS&&amount<=SAQUE_MAXIMO_PIX_CENTAVOS,
  "Saque fora dos limites configurados: mínimo R$ 100, máximo R$ 5.000 por transferência.",409);
 // Grava o fingerprint ANTES de qualquer POST /transfers ao Asaas.
 const {data:snapshot,error:snapshotError}=await db.from("catalogo_asaas_saques")
  .update({pix_destino_sha256:destinationHash})
  .eq("id",saqueId).eq("motoboy_id",uid).eq("status","reservado")
  .is("pix_destino_sha256",null).select("id").maybeSingle();
 if(snapshotError || !snapshot){
  // Banco local recusou snapshot; nenhuma chamada externa ainda ocorreu.
  // Liberar somente esta reserva é seguro porque POST /transfers ainda não foi iniciado.
  await rpc("catalogo_asaas_atualizar_saque",{p_saque:saqueId,p_estado:"falhou",
   p_transferencia:null,p_mensagem:"Falha local antes de solicitar transferência Asaas. Nenhuma chamada externa enviada."});
  throw new Failure("Não foi possível preparar o saque. Saldo preservado para nova tentativa.",503);
 }
 let transfer:Record<string,unknown>;
 try {
  transfer=await asaas("/transfers","POST",{
   value:money(amount),pixAddressKey:pix.pixAddressKey,pixAddressKeyType:pix.pixAddressKeyType,
   description:"Comissões Guia Andrelândia",externalReference:saqueId,
  });
 } catch(e) {
  if(e instanceof SandboxTransferRejected){
   // O POST foi rejeitado pelo provedor com erro estruturado de validação.
   // Esta exceção é exclusiva do Sandbox; nenhuma transferência foi aceita.
   await rpc("catalogo_asaas_atualizar_saque",{p_saque:saqueId,p_estado:"falhou",
    p_transferencia:null,p_mensagem:"SANDBOX: POST /transfers recusado, HTTP 400 com validação estruturada. Nenhuma transferência criada."});
   throw e;
  }
  // Resultados ambíguos jamais reabrem o saldo sem conciliação.
  await rpc("catalogo_asaas_atualizar_saque",{p_saque:saqueId,p_estado:"revisao",
   p_transferencia:null,p_mensagem:"Resposta do provedor inconclusiva. Não reenviar sem conciliar."});
  throw e;
 }
 const tid=value(transfer.id,120);
 if(!tid||cents(transfer.value)!==amount||transfer.externalReference!==saqueId){
  await rpc("catalogo_asaas_atualizar_saque",{p_saque:saqueId,p_estado:"revisao",
   p_transferencia:tid||null,p_mensagem:"Resposta de transferência divergente."});
  throw new Failure("Transferência em revisão. Não solicite outro saque.",409);
 }
 await rpc("catalogo_asaas_atualizar_saque",{p_saque:saqueId,p_estado:"enviado",p_transferencia:tid,p_mensagem:null});
 // NÃO marcar como pago pela resposta do POST. Somente após GET e status DONE.
 try {await reconcileTransfer(saqueId,tid);} catch { /* Webhook / consulta futura conciliará. */ }
 return respond({success:true,saque_id:saqueId,valor_centavos:amount,
  mensagem:"Solicitação enviada ao Asaas. Consulte a carteira para acompanhar a confirmação."});
}
const ADMIN_USER_ID = "4b9a0233-6b72-4573-aebd-d596c5b15e1b";
// Consulta de titularidade PIX somente no Sandbox (Asaas limita a uma chave
// ficticia e mascara CPF/CNPJ). Resultado NUNCA aprova identidade ou saque.
// GET e executado apenas quando a chave cifrada do titular corresponde ao
// valor da chave de teste suportada pelo sandbox.
async function consultarTitularidadePixSandboxAdmin(uid:string,body:Record<string,unknown>){
 if(uid!==ADMIN_USER_ID)throw new Failure("Acesso restrito à administração.",403);
 if(ENVIRONMENT!=="sandbox")throw new Failure("Consulta de titularidade disponível somente no Sandbox.",403);
 if(!ASAAS_TOKEN)throw new Failure("Credencial Asaas Sandbox não configurada.",503);
 const tipo=value(body.tipo,12),requestId=value(body.solicitacao_id,70);
 check(tipo==="residual"||tipo==="saida","Tipo de solicitação inválido.",400);
 check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId),
  "Identificador de solicitação inválido.",400);
 const tabela=tipo==="residual"?"catalogo_asaas_saldos_residuais":"catalogo_asaas_regularizacoes_inativos";
 const {data:solicitacao,error:requestError}=await db.from(tabela)
  .select("id,motoboy_id,status").eq("id",requestId).maybeSingle();
 if(requestError||!solicitacao)throw new Failure("Solicitação financeira não encontrada.",404);
 const {data:profile,error:profileError}=await db.from("catalogo_motoboy_perfis")
  .select("chave_pix_enc,em_analise").eq("usuario_id",solicitacao.motoboy_id).maybeSingle();
 if(profileError||!profile?.chave_pix_enc)throw new Failure("Chave Pix ainda não cadastrada.",409);
 if(profile.em_analise)throw new Failure("Cadastro Pix está em análise.",409);
 const pix=pixDestination(await decryptCourierPix(String(profile.chave_pix_enc),
  ENCRYPTION_KEY,String(solicitacao.motoboy_id)));
 const hash=await pixFingerprint(pix.pixAddressKeyType,pix.pixAddressKey);

 // Nao consultar chave real de terceiro no ambiente de testes.
 if(pix.pixAddressKeyType!=="PHONE"||pix.pixAddressKey!=="47996515839")
  return respond({success:true,consulta_realizada:false,
   chave_pix_fingerprint:hash,titularidade_confirmada:false,
   pagamento_autorizado:false,
   mensagem:"Sandbox só consulta a chave fictícia 47996515839. A titularidade deste motoboy não foi verificada."});

 const result=await fetch(API_BASE+
  "/pix/addressKeys/external?type=PHONE&key=47996515839",{
   method:"GET",headers:{"access_token":ASAAS_TOKEN,"accept":"application/json",
    "User-Agent":"GuiaAndrelandia/1.0"}
  });
 if(!result.ok)throw new Failure("Consulta Pix não concluída no Asaas Sandbox. Respeite os limites de consulta.",502);
 const provider=input(await result.json().catch(()=>({})));
 // Nao divulgar, armazenar nem logar dados pessoais do titular retornados pela API.
 return respond({success:true,consulta_realizada:true,
  chave_pix_fingerprint:hash,provedor_retornou_documento:Boolean(value(provider.cpfCnpj,30)),
  titularidade_confirmada:false,pagamento_autorizado:false,
  mensagem:"Chave de teste consultada no Asaas Sandbox. CPF/CNPJ mascarado não comprova identidade nem autoriza Pix."});
}
// Somente leitura: operações em revisão não podem disparar transferências
// ou desbloquear créditos através deste endpoint administrativo.
async function listAdminPayouts(uid:string){
 if(uid!==ADMIN_USER_ID)throw new Failure("Acesso exclusivo do administrador da plataforma.",403);
 const [{data:saques,error:saquesError},{data:emissoes,error:emissoesError}] = await Promise.all([
  db.from("catalogo_asaas_saques")
   .select("id,motoboy_id,status,valor_centavos,transferencia_id,mensagem,criado_em,atualizado_em,concluido_em")
   .order("criado_em",{ascending:false}).limit(100),
  db.from("catalogo_asaas_emissoes")
   .select("fechamento_id,estado,criado_em,atualizado_em")
   .neq("estado","registrado").order("criado_em",{ascending:false}).limit(50),
 ]);
 if(saquesError||emissoesError)throw new Failure("Consulta da auditoria financeira indisponível.",503);
 return respond({success:true,saques:saques||[],emissoes_pendentes:emissoes||[]});
}
// Recuperação segura de resposta inconclusiva após POST /transfers.
// O operador SOMENTE informa um ID para CONSULTA. Não gera novo Pix.
async function reconcileAdminTransfer(uid:string,body:Record<string,unknown>){
 if(uid!==ADMIN_USER_ID)throw new Failure("Acesso exclusivo do administrador da plataforma.",403);
 const saqueId=value(body.saque_id,36),transferId=value(body.transferencia_id,130);
 check(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(saqueId)&&/^[A-Za-z0-9_-]{4,130}$/.test(transferId),
  "Informe os identificadores válidos do saque e da transferência.",400);
 const {data:row,error}=await db.from("catalogo_asaas_saques")
  .select("id,valor_centavos,transferencia_id,status,pix_destino_sha256").eq("id",saqueId).maybeSingle();
 if(error||!row)throw new Failure("Saque não encontrado.",404);
 if(["concluido","falhou"].includes(row.status))
  return respond({success:true,status:row.status,mensagem:"Saque já encerrado; nenhuma nova transferência foi criada."});
 if(row.transferencia_id&&row.transferencia_id!==transferId)
  throw new Failure("Esta reserva já está vinculada a outra transferência. Revisão manual necessária.",409);
 const transfer=await asaas("/transfers/"+encodeURIComponent(transferId));
 check(transfer.id===transferId&&transfer.externalReference===saqueId&&
  cents(transfer.value)===Number(row.valor_centavos),
  "Os dados bancários não correspondem à reserva. Operação mantida em revisão.",409);
 const status=value(transfer.status,60);
 if(status==="DONE"){
  check(await destinoPixConfirmadoParaBaixa(row,transfer),
   "Asaas confirmou a transferência, mas o destino Pix não pôde ser validado. Saque permanece em revisão.",409);
  if(row.status!=="enviado")
   await rpc("catalogo_asaas_atualizar_saque",{p_saque:saqueId,p_estado:"revisao",
     p_transferencia:transferId,p_mensagem:"Recuperado pela administração após conferência Asaas"});
  const result=await rpc("catalogo_asaas_atualizar_saque",{p_saque:saqueId,
    p_estado:"concluido",p_transferencia:transferId,p_mensagem:null});
  return respond({success:true,status:result.status,mensagem:"Transferência confirmada pelo Asaas; baixa registrada."});
 }
 if(["FAILED","CANCELLED"].includes(status)){
  const result=await rpc("catalogo_asaas_atualizar_saque",{p_saque:saqueId,
   p_estado:"falhou",p_transferencia:transferId,p_mensagem:"Falha da transferência confirmada no Asaas"});
  return respond({success:true,status:result.status,mensagem:"Falha bancária comprovada. Reserva liberada para nova solicitação."});
 }
 await rpc("catalogo_asaas_atualizar_saque",{p_saque:saqueId,
  p_estado:"revisao",p_transferencia:transferId,p_mensagem:"Transferência em processamento no Asaas"});
 return respond({success:true,status:"revisao",mensagem:"Transferência identificada, ainda não concluída. Saldo segue reservado."});
}

// O hash corresponde ao destino usado no POST, mesmo que a chave do perfil mude depois.
// Não registrar a chave Pix em texto, logs ou auditoria.
async function sha256Hex(source:string){
 const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(source)));
 return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
function canonicalPix(type:string,key:string){
 const t=type.trim().toUpperCase(),raw=key.trim();
 if(t==="EMAIL")return raw.toLowerCase();
 if(t==="CPF"||t==="CNPJ"||t==="PHONE")return raw.replace(/\D/g,"");
 if(t==="EVP")return raw.toLowerCase();
 return "";
}
async function pixFingerprint(type:string,key:string){
 const canon=canonicalPix(type,key);
 if(!canon)throw new Failure("Destino Pix inválido.",400);
 // HMAC impede recuperar CPF, telefone ou e-mail por busca de hashes.
 // A mesma chave privada de cifragem serve de raiz, separada por domínio de uso.
 if(!/^[a-f0-9]{64}$/i.test(ENCRYPTION_KEY))
  throw new Failure("Chave de proteção financeira não configurada.",503);
 const raw=Uint8Array.from(ENCRYPTION_KEY.match(/.{2}/g)!,x=>parseInt(x,16));
 const keyBytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array([...raw,...new TextEncoder().encode("saque-asaas-pix-hmac-v1")])));
 const hmac=await crypto.subtle.importKey("raw",keyBytes,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const signature=new Uint8Array(await crypto.subtle.sign("HMAC",hmac,new TextEncoder().encode("guia-asaas-pix-v1:"+type.toUpperCase()+":"+canon)));
 return Array.from(signature,b=>b.toString(16).padStart(2,"0")).join("");
}
async function pixDestinationsMatch(fingerprint:string,transfers:Record<string,unknown>[]){
 if(!/^[a-f0-9]{64}$/.test(fingerprint))return false;
 let checked=0;
 for(const transfer of transfers){
  const bank=input(transfer.bankAccount);
  const vals=[value(transfer.pixAddressKey,254),value(bank.pixAddressKey,254)].filter(Boolean);
  const unique=[...new Set(vals)];
  // GET e webhook precisam, ambos, identificar o mesmo destino.
  // Sem prova independente do destinatário, recusamos a autorização.
  if(unique.length===0)return false;
  for(const key of unique){
   checked++;
   let match=false;
   // No payload da Asaas a chave aparece em bankAccount.pixAddressKey
   // sem informar necessariamente pixAddressKeyType.
   for(const t of ["CPF","CNPJ","EMAIL","PHONE","EVP"]){
    if((await pixFingerprint(t,key))===fingerprint){match=true;break;}
   }
   if(!match)return false;
  }
 }
 return checked>0;
}
// Revalidação obrigatoria antes de baixa, inclusive por webhook/admin.
// Banco reportar DONE sem revelar chave de destino nao basta. Não confundir
// correspondencia de chave com verificação de titularidade CPF/CNPJ.
async function destinoPixConfirmadoParaBaixa(
 saque:Record<string,unknown>,transfer:Record<string,unknown>
){
 const hash=value(saque.pix_destino_sha256,64);
 if(!/^[a-f0-9]{64}$/.test(hash))return false;
 if(value(transfer.operationType,12)!=="PIX")return false;
 return await pixDestinationsMatch(hash,[transfer]);
}
async function equalSecret(actual:string,expected:string){
 if(expected.length<32||actual.length<32||actual.length>255)return false;
 const [a,b]=await Promise.all([sha256Hex(actual),sha256Hex(expected)]);
 let diff=0;
 for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}
const WITHDRAWAL_RESPONSE_HEADERS={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const approveResponse=(status:"APPROVED"|"REFUSED",reason?:string)=>new Response(
 JSON.stringify(status==="APPROVED"?{status}:{status,refuseReason:reason||"Operação não autorizada"}),
 {status:200,headers:WITHDRAWAL_RESPONSE_HEADERS});
async function authorizeWithdrawal(request:Request){
 // PROTEÇÃO: homologação exclusivamente Sandbox, com opt-in e token diferente do webhook de eventos.
 if(ENVIRONMENT!=="sandbox" || !WITHDRAWAL_AUTH_ON || !ASAAS_TOKEN ||
    WITHDRAWAL_AUTH_TOKEN.length<32)
  return approveResponse("REFUSED","Validação de saída indisponível no ambiente.");
 const actual=request.headers.get("asaas-access-token")||"";
 if(!(await equalSecret(actual,WITHDRAWAL_AUTH_TOKEN)))
   return new Response(JSON.stringify({error:"unauthorized"}),{status:401,headers:WITHDRAWAL_RESPONSE_HEADERS});
 // Permite homologar token e recusa de operações com as transferências desativadas.
 if(!PAYOUTS_ON)return approveResponse("REFUSED","Saques desativados até concluir a homologação.");
 const raw=await request.text();
 if(raw.length>32768)return approveResponse("REFUSED","Payload de validação fora do limite.");
 let body:Record<string,unknown>;
 try{body=input(JSON.parse(raw));}
 catch{return approveResponse("REFUSED","JSON inválido.");}
 if(body.type!=="TRANSFER")return approveResponse("REFUSED","Apenas transferências Pix do Guia são autorizadas.");
 const incoming=input(body.transfer);
 const id=value(incoming.id,120),payloadRef=value(incoming.externalReference,80);
 // O exemplo do Asaas não obriga externalReference no POST do Webhook.
 // A referência canônica vem da reserva previamente vinculada ao ID bancário.
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
  return approveResponse("REFUSED","Transferência não identificada.");
 const {data:saque,error:lookupError}=await db.from("catalogo_asaas_saques")
   .select("id,motoboy_id,status,valor_centavos,transferencia_id,pix_destino_sha256")
   .eq("transferencia_id",id).maybeSingle();
 if(lookupError)throw new Failure("Erro ao verificar reserva.",503);
 if(!saque || saque.transferencia_id!==id ||
    (payloadRef && payloadRef!==saque.id))return approveResponse("REFUSED","Transferência desconhecida.");
 const ref=String(saque.id);

 // Nenhuma decisão APPROVED é irrevogável: até o replay do webhook deve
 // considerar holds posteriores, composição dos créditos e estado do saque.
 // Se a consulta falha, a autorização falha fechada, sem executar POST/Pix.
 const {data:revalidacao,error:revalidacaoError}=await db.rpc(
  "catalogo_asaas_validar_reserva_saque",{p_saque:ref});
 if(revalidacaoError || revalidacao?.ok!==true)
  return approveResponse("REFUSED","Não foi possível revalidar a reserva financeira.");
 if(revalidacao.elegivel!==true)
  return approveResponse("REFUSED","Reserva suspensa ou créditos não elegíveis para autorização.");

 const {data:existing,error:existingError}=await db.from("catalogo_asaas_validacoes_saque")
   .select("decisao,motivo").eq("saque_id",ref).eq("transferencia_id",id).maybeSingle();
 if(existingError)throw new Failure("Erro ao recuperar autorização.",503);
 if(existing)return approveResponse(existing.decisao==="APPROVED"?"APPROVED":"REFUSED",existing.motivo||undefined);
 let decision:"APPROVED"|"REFUSED"="REFUSED",reason="Transferência não elegível.";
 const localAmount=Number(saque.valor_centavos);
 if(saque.status==="enviado" && Number.isSafeInteger(localAmount)&&localAmount>0 &&
    /^[a-f0-9]{64}$/.test(value(saque.pix_destino_sha256,64)) &&
    cents(incoming.value)===localAmount && value(incoming.operationType,12)==="PIX"){
  // Confere por API autenticada para não confiar apenas nos dados do webhook.
  const remote=await asaas("/transfers/"+encodeURIComponent(id));
  if(remote.id===id && remote.externalReference===ref &&
    cents(remote.value)===localAmount && value(remote.operationType,12)==="PIX" &&
    !["DONE","FAILED","CANCELLED"].includes(value(remote.status,60)) &&
    await pixDestinationsMatch(String(saque.pix_destino_sha256),[incoming,remote])){
   // RPC faz COUNT/SUM/BOOL_AND no PostgreSQL e retorna UM objeto JSON.
   // Não aplica limite de 1000 linhas do PostgREST, mesmo com vários meses acumulados.
   const [profile,links,composicao]=await Promise.all([
    db.from("catalogo_motoboy_perfis").select("apto,em_analise").eq("usuario_id",saque.motoboy_id).maybeSingle(),
    db.from("catalogo_motoboys").select("usuario_id").eq("usuario_id",saque.motoboy_id).eq("ativo",true).limit(1),
    db.rpc("catalogo_asaas_validar_reserva_saque",{p_saque:ref})
   ]);
   if(profile.error||links.error||composicao.error||composicao.data?.ok!==true)
    throw new Failure("Falha de validação financeira da reserva.",503);
   const prova=input(composicao.data);
   const elegivel=prova.elegivel===true &&
     Number.isSafeInteger(Number(prova.quantidade)) && Number(prova.quantidade)>0 &&
     Number(prova.valor_centavos)===localAmount;
   if(profile.data?.apto===true && profile.data?.em_analise===false &&
      (links.data||[]).length>0 && elegivel){
    decision="APPROVED";reason="Saque conciliado com reserva e destino Pix.";
   }else reason="Conta do motoboy ou créditos não elegíveis.";
  }else reason="Identidade, valor, estado ou destino Pix divergente.";
 }else reason="Reserva não habilitada, valor divergente ou operação não Pix.";
 const {error:insertError}=await db.from("catalogo_asaas_validacoes_saque")
   .insert({saque_id:ref,transferencia_id:id,decisao:decision,motivo:reason});
 if(insertError && insertError.code!=="23505")throw new Failure("Falha ao registrar auditoria.",503);
 if(insertError?.code==="23505"){
  const {data:stored,error:e}=await db.from("catalogo_asaas_validacoes_saque")
    .select("decisao,motivo").eq("saque_id",ref).eq("transferencia_id",id).maybeSingle();
  if(e||!stored)throw new Failure("Falha ao conferir decisão duplicada.",503);
  return approveResponse(stored.decisao==="APPROVED"?"APPROVED":"REFUSED",stored.motivo||undefined);
 }
 console.info("Asaas saque validado",{saque_id:ref,decision});
 return approveResponse(decision,reason);
}

async function webhook(request:Request){
 if(!WEBHOOK_TOKEN)throw new Failure("Webhook não configurado.",503);
 const actual=request.headers.get("asaas-access-token")||"";
 check(actual.length===WEBHOOK_TOKEN.length&&actual===WEBHOOK_TOKEN,"Webhook não autorizado.",401);
 const body=input(await request.json().catch(()=>({})));
 const event=value(body.event,80),id=value(body.id,180),resource=input(body.payment||body.transfer);
 if(!id||!event||!resource.id)throw new Failure("Evento inválido.",400);
 const {data:prior}=await db.from("catalogo_asaas_webhook_eventos").select("id").eq("id",id).maybeSingle();
 if(prior)return respond({success:true,duplicado:true});
 if(event.startsWith("PAYMENT_")){
  const paymentId=value(resource.id,150);
  const {data:charge}=await db.from("catalogo_fatura_cobrancas").select("*")
    .eq("gateway","asaas").eq("order_id",paymentId).maybeSingle();
  if(!charge)return respond({success:true,ignorado:true}); // pedido fora do escopo da plataforma
  await verifyInvoice(paymentId,charge,String(charge.comercio_id),String(charge.competencia).slice(0,7));
 } else if(event.startsWith("TRANSFER_")){
  const transferId=value(resource.id,150);
  const {data:saque}=await db.from("catalogo_asaas_saques")
   .select("id").eq("transferencia_id",transferId).maybeSingle();
  if(saque){
   await reconcileTransfer(String(saque.id),transferId);
  } else {
   // Sem saque normal: observar apenas referencias excepcionais no Sandbox.
   // Nunca usar diretamente o estado relatado no webhook.
   const ref=value(resource.externalReference,180);
   const match=/^guia-exc:(residual|saida):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(ref);
   if(ENVIRONMENT!=="sandbox"||!match)
    return respond({success:true,ignorado:true});
   await consultarERegistrarTransferenciaExcepcionalSandbox(match[1],match[2],transferId);
  }
 } else return respond({success:true,ignorado:true});
 const {error}=await db.from("catalogo_asaas_webhook_eventos")
  .insert({id,evento:event,recurso_id:value(resource.id,180)});
 if(error&&error.code!=="23505")throw new Failure("Não foi possível registrar evento financeiro.",503);
 return respond({success:true});
}
Deno.serve(async (request:Request)=>{
 if(request.method==="OPTIONS")return new Response("ok",{headers:JSON_HEADERS});
 if(request.method!=="POST")return respond({success:false,mensagem:"Use POST"},405);
 try {
  const pathname=new URL(request.url).pathname;
  if(pathname.endsWith("/saque-autorizacao"))return await authorizeWithdrawal(request);
  if(pathname.endsWith("/webhook"))return await webhook(request);
  const user=await auth(request);
  const body=input(await request.json().catch(()=>({})));
  switch(value(body.acao,60)){
   case "consultar_termos":return respond({success:true,...await termsStatus(user.id,value(body.papel,15),
     value(body.papel,15)==="comercio"?commerce(body.comercio_id):"",
     value(body.papel,15)==="motoboy")});
   case "aceitar_termos":return await acceptTerms(user.id,body);
   case "solicitar_encerramento":return await requestClosure(user.id,body);
   case "consultar_encerramento":return await consultarEncerramento(user.id,body);
   case "listar_encerramentos_admin":return await listarEncerramentosAdmin(user.id);
   case "finalizar_encerramento_admin":return await finalizarEncerramentoAdmin(user.id,body);
   case "obter_fatura":return await showInvoice(user.id,body);
   case "criar_cobranca":return await createInvoice(user.id,body,user.email||"");
   case "consultar_cobranca":return await reconcileInvoice(user.id,body);
   case "consultar_carteira":return await wallet(user.id,true);
   case "solicitar_analise_residual":return await solicitarAnaliseResidual(user.id,body);
   case "solicitar_regularizacao_saida":return await solicitarRegularizacaoSaida(user.id,body);
   case "listar_analises_residuais_admin":return await listarAnalisesResiduais(user.id);
   case "listar_regularizacoes_saida_admin":return await listarRegularizacoesSaidaAdmin(user.id);
   case "revisar_regularizacao_saida_admin":return await revisarRegularizacaoSaidaAdmin(user.id,body);
   case "preconferir_pagamento_excepcional_admin":return await preconferirExcepcionalAdmin(user.id,body);
   case "listar_separacoes_congeladas_admin":return await listarSeparacoesCongeladasAdmin(user.id);
   case "diagnosticar_separacao_congelada_admin":return await diagnosticarSeparacaoCongeladaAdmin(user.id,body);
   case "consultar_titularidade_pix_sandbox_admin":return await consultarTitularidadePixSandboxAdmin(user.id,body);
   case "observar_transferencia_excepcional_sandbox_admin":return await observarTransferenciaExcepcionalSandboxAdmin(user.id,body);
   case "revisar_analise_residual_admin":return await revisarAnaliseResidual(user.id,body);
   case "solicitar_saque":return await withdraw(user.id);
   case "auditar_saque_sandbox":return await auditPendingSandboxTransfer(user.id);
   case "listar_saques_admin":return await listAdminPayouts(user.id);
   case "conciliar_saque_admin":return await reconcileAdminTransfer(user.id,body);
   default:throw new Failure("Ação inválida.",400);
  }
 }catch(e){
  if(e instanceof Failure)return respond({success:false,mensagem:e.message},e.status);
  console.error("Asaas edge",{type:(e as Error).name});
  return respond({success:false,mensagem:"Falha financeira. Verifique o histórico antes de tentar outra operação."},503);
 }
});
