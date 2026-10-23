"use strict";
// COB-06: auditoria LOCAL do pacote de nove SQLs candidatos de cobranca.
// NAO executa SQL, nao conecta banco/provedor, nao faz deploy/merge.
// Os nomes sao intencionalmente imutaveis e em ordem conhecida.
const fs = require("node:fs");
const path = require("node:path");
const {createHash} = require("node:crypto");

const ROOT = path.resolve(__dirname, "../..");
const LOCK = path.join(__dirname, "asaas-cob06-billing-only.lock.json");
const OFFICIAL = Object.freeze([
 "supabase/production-candidate/01_asaas_cobrancas_inbox_sem_saques.sql",
 "supabase/production-candidate/02_termos_encerramento_sem_saques.sql",
 "supabase/pending-migrations/20261009162000_bloquear_exclusao_debitos_e_finalizar_arquivamento.sql",
 "supabase/pending-migrations/20261009163000_impedir_reabertura_encerramento.sql",
 "supabase/pending-migrations/20261009180000_status_publicacao_publica_restrita.sql",
 "supabase/pending-migrations/20261009183000_proteger_republicacao_legada_apos_encerramento.sql",
 "supabase/pending-migrations/20261009184000_bloquear_despublicacao_legada_qualquer_status.sql",
 "supabase/pending-migrations/20261012104000_cob04_fechamento_apenas_entregas_confirmadas.sql",
 "supabase/pending-migrations/20261012163000_cob04_pagamento_somente_componentes_da_fatura.sql",
]);

function blobSha(data) {
 if(!Buffer.isBuffer(data)) throw Error("PACOTE_BLOQUEADO: bytes invalidos");
 return createHash("sha1").update("blob "+data.byteLength+"\0").update(data).digest("hex");
}

function validar(manifest,lerArquivo=fs.readFileSync){
 if(!manifest || manifest.contract!=="COB-06-billing-only" ||
    manifest.status!=="candidate-never-auto-deploy" ||
    manifest.hash_algorithm!=="git-blob-sha1" ||
    !Array.isArray(manifest.files) || manifest.files.length!==OFFICIAL.length)
  throw Error("PACOTE_BLOQUEADO: contrato incompleto ou alterado");
 for(let i=0;i<OFFICIAL.length;i++){
  const entry=manifest.files[i];
  if(!entry || Object.keys(entry).sort().join(",")!=="blob_sha1,path" ||
     entry.path!==OFFICIAL[i] || !/^[a-f0-9]{40}$/.test(entry.blob_sha1))
   throw Error("PACOTE_BLOQUEADO: caminho/ordem/sha alterado "+(i+1));
  const full=path.resolve(ROOT, entry.path);
  const expectedRoot=ROOT+path.sep;
  if(!full.startsWith(expectedRoot))
   throw Error("PACOTE_BLOQUEADO: acesso fora do repo");
  let bytes;
  try {
   bytes=lerArquivo(full);
  } catch {
   throw Error("PACOTE_BLOQUEADO: arquivo ausente "+(i+1));
  }
  if(blobSha(bytes)!==entry.blob_sha1)
   throw Error("PACOTE_BLOQUEADO: conteudo mudou, revisar clone e refixar pacote "+(i+1));
 }
 return Object.freeze({arquivos:OFFICIAL.length,modo:"SOMENTE_LEITURA",liberado_producao:false});
}

if(require.main===module){
 try {
  const m=JSON.parse(fs.readFileSync(LOCK,"utf8"));
  const r=validar(m);
  console.log("COB06_BILLING_ONLY_LOCK_OK: "+r.arquivos+" SQLs em ordem, hashes conferidos; SEM DEPLOY.");
 } catch(e){
  console.error(String(e.message || e));
  process.exitCode=1;
 }
}
module.exports={validar,blobSha,OFFICIAL,LOCK,ROOT};
