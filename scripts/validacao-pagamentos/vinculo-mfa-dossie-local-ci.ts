/**
 * #42 — Vinculo PRE-CHALLENGE de identidade/versao de dossie, SOMENTE CI LOCAL.
 *
 * Nenhum armazenamento duravel, JWT assinado validado por esta classe, papel real,
 * Auth remoto, dinheiro, RPC, HTTP ou decisao financeira. A fonte dos dados
 * e o ensaio GoTrue local; NUNCA importar em Edge, browser ou producao.
 * registrarResultado recebe relato de um harness de teste, nao prova
 * autenticacao por si so. Nao transformar "duas_confirmacoes_locais" em GRANT.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const MAX_MS=120000;
type Snapshot={
  decisaoId:string;separacaoId:string;fingerprint:string;dossieHash:string;
  beneficiarioId:string;autoresEvidencia:string[];
};
type Credencial={
  revisorId:string;sessaoId:string;fatorId:string;
  decisaoId:string;separacaoId:string;fingerprint:string;dossieHash:string;
};
type Registro=Credencial&{
  nonce:string;challengeId:string|null;estado:"reservado"|"desafio"|"consumido";
  reservadoEm:number;
};
type Observacao=Credencial&{
  challengeId:string;aal:string;usuarioAuthId:string;factorAuthId:string;
  sessaoAuthId:string;autenticacaoLocalGoTrueConfirmada:boolean;
};
const resposta=(ok:boolean,motivo:string,extra:Record<string,unknown>={})=>Object.freeze({
  ok,motivo,...extra,
  status_operacional:"HOLD_OBRIGATORIO" as const,
  credenciamento_formal_comprovado:false as const,
  dois_revisores_reais_autorizados:false as const,
  aprovacao_financeira:false as const,
  pagamento_autorizado:false as const,
  liberacao_autorizada:false as const,
  baixa_realizada:false as const,
  movimenta_dinheiro:false as const,
  pode_enviar_pix:false as const,
});
function id(s:string):boolean{return typeof s==="string"&&UUID.test(s);}
function igualSnapshot(s:Snapshot,r:Credencial):boolean{
 return r.decisaoId===s.decisaoId&&r.separacaoId===s.separacaoId
  &&r.fingerprint===s.fingerprint&&r.dossieHash===s.dossieHash;
}
export class VinculoMfaDossieLocalCI {
 private readonly registros=new Map<string,Registro>();
 private readonly nonceIndex=new Map<string,string>();
 private readonly desafios=new Set<string>();
 private readonly confirmados=new Set<string>();
 private readonly snapshot:Readonly<Snapshot>;
 constructor(s:Snapshot,private readonly agora:()=>number,ambiente:"ci-local-descartavel"){
  if(ambiente!=="ci-local-descartavel"||typeof agora!=="function"||
   !id(s.decisaoId)||!id(s.separacaoId)||!id(s.beneficiarioId)||
   !HASH.test(s.fingerprint)||!HASH.test(s.dossieHash)||
   !Array.isArray(s.autoresEvidencia)||!s.autoresEvidencia.every(id)||
   new Set(s.autoresEvidencia).size!==s.autoresEvidencia.length)
   throw Error("snapshot_ci_invalido");
  this.snapshot=Object.freeze({...s,autoresEvidencia:Object.freeze([...s.autoresEvidencia])}) as Snapshot;
 }
 preparar(p:Credencial){
  const now=this.agora();
  if(!Number.isSafeInteger(now)||!id(p.revisorId)||!id(p.sessaoId)||
   !id(p.fatorId)||!igualSnapshot(this.snapshot,p)||
   p.revisorId===this.snapshot.beneficiarioId||
   this.snapshot.autoresEvidencia.includes(p.revisorId)||
   this.registros.has(p.revisorId)||this.registros.size>=2)
   return resposta(false,"preparacao_ci_recusada");
  const nonce=crypto.randomUUID();
  const frozen:Registro={...p,nonce,challengeId:null,estado:"reservado",reservadoEm:now};
  this.registros.set(p.revisorId,frozen);this.nonceIndex.set(nonce,p.revisorId);
  // nonce so retorna para a propria fixture local, nunca via HTTP.
  return resposta(true,"nonce_privado_ci_registrado",{nonce});
 }
 vincularChallenge(nonce:string,challengeId:string){
  const owner=this.nonceIndex.get(nonce);
  const r=owner?this.registros.get(owner):null;
  const now=this.agora();
  if(!r||r.estado!=="reservado"||!id(challengeId)||
   this.desafios.has(challengeId)||!Number.isSafeInteger(now)||
   now<r.reservadoEm||now>=r.reservadoEm+MAX_MS)
   return resposta(false,"challenge_ci_invalido_ou_repetido");
  r.challengeId=challengeId;r.estado="desafio";
  this.desafios.add(challengeId);
  return resposta(true,"challenge_ci_vinculado_sem_mfa");
 }
 registrarResultado(nonce:string,e:Observacao){
  const owner=this.nonceIndex.get(nonce);
  const r=owner?this.registros.get(owner):null;
  const now=this.agora();
  if(!r||r.estado!=="desafio")
   return resposta(false,"tentativa_inexistente_ou_replay");
  // Fail-closed: todo resultado de confirmacao CONSOME a tentativa,
  // inclusive claims erradas. Nunca permitir "tentar ate encaixar".
  r.estado="consumido";
  if(!Number.isSafeInteger(now)||now<r.reservadoEm||
   now>=r.reservadoEm+MAX_MS||!r.challengeId||
   !igualSnapshot(this.snapshot,e)||!igualSnapshot(this.snapshot,r)||
   e.revisorId!==r.revisorId||e.sessaoId!==r.sessaoId||
   e.fatorId!==r.fatorId||e.challengeId!==r.challengeId||
   e.usuarioAuthId!==r.revisorId||e.sessaoAuthId!==r.sessaoId||
   e.factorAuthId!==r.fatorId||e.aal!=="aal2"||
   e.autenticacaoLocalGoTrueConfirmada!==true)
   return resposta(false,"vinculo_identidade_desafio_ou_versao_divergente");
  this.confirmados.add(r.revisorId);
  return resposta(true,"observacao_local_vinculada_sem_autoridade_financeira");
 }
 diagnosticar(v:{decisaoId:string;separacaoId:string;fingerprint:string;dossieHash:string}){
  const versao=igualSnapshot(this.snapshot,{
   ...v,revisorId:"",sessaoId:"",fatorId:""
  });
  return resposta(true,"diagnostico_ci_somente_documental",{
   revisores_distintos_vinculados_na_versao:versao?this.confirmados.size:0,
   duas_observacoes_locais_vinculadas:versao&&this.confirmados.size===2,
   autenticacao_real_de_revisores_formais_comprovada:false,
  });
 }
}
