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
const ENCRYPTION_KEY = Deno.env.get("CATALOGO_DATA_ENCRYPTION_KEY") || Deno.env.get("MP_OAUTH_ENCRYPTION_KEY") || "";
const BILLING_ON = Deno.env.get("ASAAS_BILLING_ENABLED") === "true";
const PAYOUTS_ON = Deno.env.get("ASAAS_PAYOUTS_ENABLED") === "true";
const ENVIRONMENT = Deno.env.get("ASAAS_ENVIRONMENT") === "production" ? "production" : "sandbox";
const API_BASE = ENVIRONMENT === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
const JSON_HEADERS = {"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods":"POST,OPTIONS","Cache-Control":"no-store"};
class Failure extends Error {constructor(message:string,public status=400){super(message)}}
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
 enabled(path.startsWith("/transfers")?"payouts":"billing");
 const response=await fetch(API_BASE+path,{
  method,headers:{"access_token":ASAAS_TOKEN,"accept":"application/json",
    "content-type":"application/json","User-Agent":"GuiaAndrelandia/1.0"},
  body:body===undefined?undefined:JSON.stringify(body),
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok){
  console.error("Asaas http error",{path:path.split("?")[0],status:response.status});
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
 const {data:allowed,error:e}=await db.from("catalogo_motoboys").select("usuario_id")
  .eq("usuario_id",uid).eq("ativo",true).limit(1);
 if(e||!allowed?.length)throw new Failure("Perfil de entregador não autorizado.",403);
 if(withReconcile){
  const {data:pending}=await db.from("catalogo_asaas_saques").select("id,transferencia_id")
   .eq("motoboy_id",uid).in("status",["enviado","revisao"]).not("transferencia_id","is",null).limit(5);
  if(PAYOUTS_ON)for(const row of pending||[]){
   try {await reconcileTransfer(String(row.id),String(row.transferencia_id));}
   catch { /* Nunca liberar por erro de rede; o saldo continua reservado. */ }
  }
 }
 const balance=await rpc("catalogo_asaas_saldo_sacavel",{p_motoboy:uid});
 const {data:history,error}=await db.from("catalogo_asaas_saques")
  .select("id,status,valor_centavos,criado_em,concluido_em")
  .eq("motoboy_id",uid).order("criado_em",{ascending:false}).limit(20);
 if(error)throw new Failure("Histórico de saques indisponível.",503);
 return respond({success:true,saque_habilitado:PAYOUTS_ON&&Boolean(ASAAS_TOKEN),
   saldo_disponivel_centavos:balance.disponivel_centavos||0,
   saques:history||[]});
}
async function reconcileTransfer(saqueId:string,transferId:string){
 const transfer=await asaas("/transfers/"+encodeURIComponent(transferId));
 check(transfer.id===transferId&&transfer.externalReference===saqueId,"Transferência de outro identificador.",409);
 const {data:row,error}=await db.from("catalogo_asaas_saques")
  .select("id,valor_centavos,transferencia_id,status").eq("id",saqueId).maybeSingle();
 if(error||!row||row.transferencia_id!==transferId)throw new Failure("Transferência não vinculada.",409);
 check(cents(transfer.value)===Number(row.valor_centavos),"Valor da transferência divergente. Saque em revisão.",409);
 const status=value(transfer.status,60);
 if(status==="DONE")return await rpc("catalogo_asaas_atualizar_saque",
  {p_saque:saqueId,p_estado:"concluido",p_transferencia:transferId,p_mensagem:null});
 if(["FAILED","CANCELLED"].includes(status))return await rpc("catalogo_asaas_atualizar_saque",
  {p_saque:saqueId,p_estado:"falhou",p_transferencia:transferId,p_mensagem:"Transferência recusada pelo Asaas"});
 return {ok:true,status:"enviado"};
}
async function withdraw(uid:string){
 enabled("payouts");
 const {data:profile,error}=await db.from("catalogo_motoboy_perfis")
  .select("chave_pix_enc,em_analise").eq("usuario_id",uid).maybeSingle();
 if(error||!profile||profile.em_analise||!profile.chave_pix_enc)throw new Failure("Cadastre sua chave Pix e confirme seu perfil.",409);
 const pix=pixDestination(await decryptCourierPix(String(profile.chave_pix_enc),ENCRYPTION_KEY,uid));
 const reserved=await rpc("catalogo_asaas_reservar_saque",{p_motoboy:uid});
 const saqueId=String(reserved.saque_id),amount=Number(reserved.valor_centavos);
 let transfer:Record<string,unknown>;
 try {
  transfer=await asaas("/transfers","POST",{
   value:money(amount),pixAddressKey:pix.pixAddressKey,pixAddressKeyType:pix.pixAddressKeyType,
   description:"Comissões Guia Andrelândia",externalReference:saqueId,
  });
 } catch(e) {
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
 return respond({success:true,saque_id:saqueId,
  mensagem:"Solicitação enviada ao Asaas. Consulte a carteira para acompanhar a confirmação."});
}
const ADMIN_USER_ID = "4b9a0233-6b72-4573-aebd-d596c5b15e1b";
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
  .select("id,valor_centavos,transferencia_id,status").eq("id",saqueId).maybeSingle();
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
  if(!saque)return respond({success:true,ignorado:true});
  await reconcileTransfer(String(saque.id),transferId);
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
  if(new URL(request.url).pathname.endsWith("/webhook"))return await webhook(request);
  const user=await auth(request);
  const body=input(await request.json().catch(()=>({})));
  switch(value(body.acao,60)){
   case "obter_fatura":return await showInvoice(user.id,body);
   case "criar_cobranca":return await createInvoice(user.id,body,user.email||"");
   case "consultar_cobranca":return await reconcileInvoice(user.id,body);
   case "consultar_carteira":return await wallet(user.id,true);
   case "solicitar_saque":return await withdraw(user.id);
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
