// @ts-nocheck
// Fonte recuperada do bundle produtivo da Supabase CLI sem anotacoes TS.
// A seguranca do fluxo COB-06 e validada por testes Node/VM e SQL; nao implantar esta branch.
import{createClient as se}from"npm:@supabase/supabase-js@2";import{parseStorageObjectReference as U}from"./storage-path-utils.mjs";const te=Deno.env.get("SUPABASE_URL")??"",x=Deno.env.get("SUPABASE_SECRET_KEYS"),ie=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",R=Deno.env.get("ADMIN_USER_ID")??"",I=Deno.env.get("GITHUB_TOKEN")??"",H="pedrinhossiqueira12-dotcom",M="Guia-Turistico-de-Andrel-ndia",B=(Deno.env.get("COB06_GITHUB_BRANCH")??"").trim(),S="DATA/comercios.json",O="DATA/pessoas.json",G=Deno.env.get("WHATSAPP_TOKEN"),k=Deno.env.get("WHATSAPP_PHONE_NUMBER_ID"),F=Deno.env.get("WHATSAPP_VERIFY_TOKEN"),ne=Deno.env.get("WHATSAPP_API_VERSION")??"v21.0";let P="";try{if(x){const e=JSON.parse(x);P=e?.default||e?.service_role||""}}catch(e){console.error("Erro ao interpretar SUPABASE_SECRET_KEYS:",e)}P||(P=ie);const g=se(te,P,{auth:{persistSession:!1,autoRefreshToken:!1}}),T={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, GET, OPTIONS"};function t(e,a=200){
  // Os handlers legados incluem "detalhe: erro.message" e, em alguns casos,
  // "erro: erro.message". Nunca enviar SQL, credenciais ou resposta GitHub
  // ao navegador quando uma operacao interna falhar.
  let resposta=e;
  if(a>=500&&e&&typeof e==="object"){
    resposta={...e};
    delete resposta.detalhe;
    if(typeof resposta.erro==="string"&&resposta.erro!=="Erro interno da Edge Function.")
      resposta.erro="Falha temporaria. Tente novamente ou contate o suporte.";
  }
  return new Response(JSON.stringify(resposta),{status:a,headers:{...T,"Content-Type":"application/json; charset=utf-8"}});
}function u(e){return e==null?"":String(e).trim()}function J(e){return u(e).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")||"perfil"}function W(e){return J(e)}function N(e){return J(e)}function V(e){return u(e).toLowerCase()}function q(e){if(e==null||e==="")return null;const a=Number(String(e).replace(",",".").trim());return Number.isFinite(a)?a:null}function D(e){const a=[];if(Array.isArray(e?.imagens))for(const s of e.imagens){const i=u(s);i&&!a.includes(i)&&a.push(i)}const r=u(e?.imagem_url);r&&!a.includes(r)&&a.unshift(r);const o=u(e?.imagem);if(o){const s=a.indexOf(o);s>0&&a.splice(s,1),a.includes(o)||a.unshift(o)}return a.slice(0,4)}function j(e){const a=[];if(Array.isArray(e?.imagens))for(const o of e.imagens){const s=u(o);s&&!a.includes(s)&&a.push(s)}const r=u(e?.imagem);return r&&!a.includes(r)&&a.unshift(r),a.slice(0,4)}async function E(e){const a=e.headers.get("Authorization");if(!a)return null;const r=a.replace(/^Bearer\s+/i,"").trim();if(!r)return null;const{data:o,error:s}=await g.auth.getUser(r);return s||!o?.user?(console.error("Erro ao autenticar usu\xE1rio:",s),null):o.user}async function y(e){if(!R)return null;const a=await E(e);return!a||a.id!==R?null:a}function ce(e){const a=String(e).replace(/\s/g,""),r=atob(a),o=new Uint8Array(r.length);for(let s=0;s<r.length;s++)o[s]=r.charCodeAt(s);return new TextDecoder("utf-8").decode(o)}function ue(e){const a=new TextEncoder().encode(e);let r="";const o=32768;for(let s=0;s<a.length;s+=o)r+=String.fromCharCode(...a.subarray(s,Math.min(s+o,a.length)));return btoa(r)}function cob06DestinoGitHub(){if(!/^(?:main|qa\/[a-z0-9][a-z0-9._-]{0,60})$/.test(B))throw new Error("Destino GitHub COB-06 ausente ou nao isolado: configure COB06_GITHUB_BRANCH=qa/nome-do-ensaio.");if(B!=="main"&&te!=="https://jbttwihctuibchhcyqtl.supabase.co")throw new Error("Branch QA permitida somente no STAGING.");if(B==="main"&&(te!=="https://xdmbkflufsfqziixzpxc.supabase.co"||Deno.env.get("COB06_GITHUB_WRITE_MAIN")!=="AUTORIZADO_PARA_PRODUCAO"))throw new Error("Escrita no main bloqueada: exige projeto produtivo e liberacao especifica.");return B}async function K(e){const branch=cob06DestinoGitHub();if(!I)throw new Error("GITHUB_TOKEN n\xE3o configurado.");const a=`https://api.github.com/repos/${H}/${M}/contents/${e}?ref=${branch}`,r=await fetch(a,{method:"GET",headers:{Authorization:`Bearer ${I}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"Andrelandia-Guia-Turistico"}}),o=await r.json();if(!r.ok)throw console.error("Erro GitHub GET:",o),new Error(o?.message||`N\xE3o foi poss\xEDvel obter ${e}.`);let s="";try{s=ce(o.content)}catch(n){throw console.error("Erro ao decodificar GitHub:",n),new Error(`N\xE3o foi poss\xEDvel decodificar ${e}.`)}let i;try{i=JSON.parse(s)}catch(n){throw console.error("JSON inv\xE1lido:",n),new Error(`${e} possui JSON inv\xE1lido.`)}if(!Array.isArray(i))throw new Error(`${e} n\xE3o cont\xE9m um array.`);return{sha:o.sha,dados:i}}async function b(e,a,r,o){const branch=cob06DestinoGitHub();if(!I)throw new Error("GITHUB_TOKEN n\xE3o configurado.");const s=`https://api.github.com/repos/${H}/${M}/contents/${e}`,i=await fetch(s,{method:"PUT",headers:{Authorization:`Bearer ${I}`,Accept:"application/vnd.github+json","Content-Type":"application/json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"Andrelandia-Guia-Turistico"},body:JSON.stringify({message:o,content:ue(a),sha:r,branch:branch})}),n=await i.json();if(!i.ok)throw console.error("Erro GitHub PUT:",n),new Error(n?.message||"N\xE3o foi poss\xEDvel atualizar o GitHub.");return n}async function z(){const e=await K(S);return{sha:e.sha,comercios:e.dados}}async function C(){const e=await K(O);return{sha:e.sha,pessoas:e.dados}}function L(e){const a=u(e?.nome);if(!a)throw new Error("O com\xE9rcio precisa possuir um nome.");const r=u(e?.local_id)||u(e?.id_publico)||W(a),o=D(e);return{id:r,nome:a,categoria:u(e?.categoria),descricao:u(e?.descricao),historia:u(e?.historia),curiosidades:u(e?.curiosidades),endereco:u(e?.endereco),horario:u(e?.horario),entrada:u(e?.entrada),telefone:u(e?.telefone)||u(e?.whatsapp),whatsapp:u(e?.whatsapp),instagram:u(e?.instagram),site:u(e?.site),latitude:q(e?.latitude),longitude:q(e?.longitude),imagem:o[0]||"",imagens:o,status:"ativo",destaque:!1}}async function de(e){const a=L(e);a.status="ativo",a.destaque=!1;const r=await z(),o=r.comercios.findIndex(m=>String(m?.id)===String(a.id)),s=o>=0?r.comercios[o]:null;o>=0?r.comercios[o]={...r.comercios[o],...a}:r.comercios.push(a);const i=new Date().toISOString(),{data:n,error:d}=await g.from("comercios_publicados").select("local_id,status,destaque,deletado_em,atualizado_em,atualizado_por").eq("local_id",a.id).maybeSingle();if(d)throw new Error(`N\xE3o foi poss\xEDvel preparar o status do com\xE9rcio: ${d.message}`);const{error:c}=await g.from("comercios_publicados").upsert({local_id:a.id,status:"ativo",destaque:!1,deletado_em:null,atualizado_em:i,atualizado_por:null},{onConflict:"local_id"});if(c)throw new Error(`N\xE3o foi poss\xEDvel gravar os metadados do com\xE9rcio: ${c.message}`);try{await b(S,JSON.stringify(r.comercios,null,2)+`\n`,r.sha,`Publicar com\xE9rcio: ${a.nome}`)}catch(m){throw n?await g.from("comercios_publicados").update({status:n.status,destaque:n.destaque,deletado_em:n.deletado_em,atualizado_em:n.atualizado_em,atualizado_por:n.atualizado_por}).eq("local_id",a.id):await g.from("comercios_publicados").update({status:"pendente",destaque:!1,deletado_em:null,atualizado_em:i,atualizado_por:null}).eq("local_id",a.id),o>=0&&(r.comercios[o]=s),m}return a}async function Y(e){let a=await g.from("cadastros_comercios").select("*").eq("local_id",e).maybeSingle();return a.error&&console.error("Erro buscando com\xE9rcio por local_id:",a.error),a.data?{cadastro:a.data,erro:null}:(a=await g.from("cadastros_comercios").select("*").eq("id",e).maybeSingle(),a.error?{cadastro:null,erro:a.error}:{cadastro:a.data,erro:null})}function le(e,a,r){const o=[r,a?.local_id,a?.id_publico,a?.slug,a?.comercio_id,W(u(a?.nome))].map(V).filter(Boolean),s=[...new Set(o)];console.log("IDs candidatos para localizar com\xE9rcio:",s);const i=e.findIndex(n=>{const d=V(n?.id);return d&&s.includes(d)});return i>=0?console.log("Com\xE9rcio localizado no JSON:",{indice:i,id:e[i]?.id,nome:e[i]?.nome}):console.error("Com\xE9rcio n\xE3o localizado no JSON.",{comercioId:r,cadastroId:a?.id,localId:a?.local_id,idPublico:a?.id_publico,slug:a?.slug,nome:a?.nome}),i}async function X(e){const{data:a,error:r}=await g.from("cadastros_comercios").select("*").eq("id",e).maybeSingle();return r?{resposta:t({sucesso:!1,erro:"Erro ao consultar cadastro.",detalhe:r.message},500)}:a?a.status!=="pendente"?{resposta:t({sucesso:!1,erro:`Cadastro n\xE3o est\xE1 pendente. Status atual: ${a.status}`},400)}:{cadastro:a}:{resposta:t({sucesso:!1,erro:"Cadastro n\xE3o encontrado."},404)}}async function me(e,a){const r=await y(e);if(!r)return t({sucesso:!1,erro:"Acesso administrativo negado."},403);const o=u(a?.cadastro_id);if(!o)return t({sucesso:!1,erro:"cadastro_id n\xE3o informado."},400);const s=await X(o);if(s.resposta)return s.resposta;let i;try{i=L(s.cadastro)}catch(n){return t({sucesso:!1,erro:n.message},400)}return t({sucesso:!0,teste:!0,publicado:!1,mensagem:"Teste de aprova\xE7\xE3o conclu\xEDdo. Nada foi publicado.",administrador:r.id,cadastro:{id:s.cadastro.id,nome:s.cadastro.nome,status:s.cadastro.status},comercio:i})}async function fe(e,a){const r=await y(e);if(!r)return t({sucesso:!1,erro:"Acesso administrativo negado."},403);const o=u(a?.cadastro_id);if(!o)return t({sucesso:!1,erro:"cadastro_id n\xE3o informado."},400);const s=await X(o);if(s.resposta)return s.resposta;let i;try{i=await de(s.cadastro)}catch(d){return t({sucesso:!1,publicado:!1,erro:d.message},500)}const{error:n}=await g.from("cadastros_comercios").update({status:"aprovado",revisado_por:r.id,revisado_em:new Date().toISOString(),motivo_rejeicao:null}).eq("id",o);return n?t({sucesso:!1,publicado:!0,erro:"O com\xE9rcio foi publicado no GitHub, mas houve erro ao atualizar o cadastro no Supabase.",detalhe:n.message,comercio:i},500):t({sucesso:!0,publicado:!0,mensagem:"Cadastro aprovado e com\xE9rcio publicado com sucesso.",comercio:i})}async function ge(e,a){if(!await y(e))return t({sucesso:!1,erro:"Acesso administrativo negado."},403);const o=u(a?.comercio_id),s=a?.comercio;if(!o)return t({sucesso:!1,erro:"comercio_id n\xE3o informado."},400);if(!s||typeof s!="object")return t({sucesso:!1,erro:"Dados do com\xE9rcio n\xE3o informados."},400);const i=await z(),n=i.comercios.findIndex(l=>l?.id===o);if(n===-1)return t({sucesso:!1,erro:"Com\xE9rcio n\xE3o encontrado no DATA/comercios.json."},404);const d=i.comercios[n],c={...d,...s,id:d.id},{data:m,error:f}=await g.from("comercios_publicados").select("status,destaque").eq("local_id",d.id).maybeSingle();if(f)return t({sucesso:!1,erro:f.message},500);m&&(c.status=m.status,c.destaque=m.destaque);const p=["nome","categoria","descricao","historia","curiosidades","endereco","horario","entrada","telefone","whatsapp","instagram","site","imagem"];for(const l of p)c[l]=u(c[l]);c.latitude=q(c.latitude),c.longitude=q(c.longitude),c.imagens=D(c),c.imagem=c.imagens[0]||"",i.comercios[n]=c;try{await b(S,JSON.stringify(i.comercios,null,2)+`\n`,i.sha,`Editar com\xE9rcio: ${c.nome}`)}catch(l){return t({sucesso:!1,erro:l.message},500)}return t({sucesso:!0,mensagem:"Com\xE9rcio atualizado com sucesso.",comercio:c})}function $(...e){const a=new Map;for(const r of e){if(!r||typeof r!="object")continue;const o=[];for(const s of["imagem","imagem_url"])typeof r[s]=="string"&&o.push(r[s]);Array.isArray(r.imagens)&&o.push(...r.imagens);for(const s of o){const i=U(s);i&&a.set(`${i.bucket_id}/${i.object_name}`,i)}}return[...a.values()]}async function Q(e,a){const r=[];for(let s=0;;s+=1e3){const{data:i,error:n}=await g.from(e).select(a).range(s,s+1e3-1);if(n)throw new Error(`Falha ao ler ${e}: ${n.message}`);if(r.push(...i||[]),!i||i.length<1e3)break}return r}async function pe(){const[e,a,r,o]=await Promise.all([z(),C(),Q("cadastros_comercios","imagem_url,imagens,status"),Q("mural_cadastros","imagem,imagens,status")]),s=new Set,i=n=>{if(String(n?.status||"").trim().toLowerCase()!=="deletado")for(const d of $(n))s.add(`${d.bucket_id}/${d.object_name}`)};for(const n of e.comercios||[])i(n);for(const n of a.pessoas||[])i(n);for(const n of r)i(n);for(const n of o)i(n);return s}async function Z(e){const a=new Map;for(const i of e||[]){const n=typeof i=="string"?U(i):i;!n?.bucket_id||!n?.object_name||a.set(`${n.bucket_id}/${n.object_name}`,n)}if(!a.size)return{queued:0,stillReferenced:0};const r=await pe(),o=[...a.entries()].filter(([i])=>!r.has(i)).map(([,i])=>({bucket_id:i.bucket_id,object_name:i.object_name}));if(!o.length)return{queued:0,stillReferenced:a.size};const{error:s}=await g.from("storage_cleanup_queue").upsert(o,{onConflict:"bucket_id,object_name",ignoreDuplicates:!0});if(s)throw new Error(`Falha ao registrar fotos para reten\xE7\xE3o: ${s.message}`);return{queued:o.length,stillReferenced:a.size-o.length}}async function ee(e){await g.from("comercios_publicados").update({status:e.status,destaque:e.destaque,deletado_em:e.deletado_em,atualizado_em:e.atualizado_em,atualizado_por:e.atualizado_por}).eq("local_id",e.local_id)}// COB-06: entrada unica e segura para exclusoes de estabelecimentos.
// Proprietario somente solicita encerramento; admin somente conclui via RPC no banco.
// O banco deve ter as migracoes seletivas de cobranca e as guardas transacionais.
async function ae(e, a, administrador) {
  // Somente o administrador sincroniza GitHub; nao impedir que o dono
  // solicite encerramento, pois essa operacao nao escreve na vitrine.
  if (administrador) {
    try {
      cob06DestinoGitHub();
      if (!I) throw new Error("Credencial GitHub nao configurada.");
    } catch {
      return t({sucesso:false,arquivado:false,
        erro:"Destino GitHub nao autorizado para este ambiente. HOLD."},503);
    }
  }
  const busca = await Y(e);
  if (busca.erro) return t({sucesso:false,erro:"Falha ao verificar titularidade."},503);
  const cadastro = busca.cadastro;
  if (!administrador && (!cadastro || cadastro.usuario_id !== a)) {
    return t({sucesso:false,erro:"Voce nao e o proprietario deste comercio."},403);
  }
  const id = u(cadastro?.local_id) || e;
  const publicacao = await g.from("comercios_publicados")
    .select("local_id,status").eq("local_id",id).maybeSingle();
  if (publicacao.error) return t({sucesso:false,erro:"Falha ao consultar publicacao."},503);
  if (!publicacao.data) return t({sucesso:false,erro:"Comercio nao encontrado."},404);
  // Nao retornar sucesso antecipadamente para status=deletado.
  // A RPC financeira pode ter sido confirmada enquanto o PUT GitHub falhou:
  // o administrador precisa poder tentar novamente a sincronizacao da vitrine.
  const catalogo = await g.from("catalogos")
    .select("comercio_id,proprietario_id").eq("comercio_id",id).maybeSingle();
  if (catalogo.error) return t({sucesso:false,erro:"Falha ao verificar catalogo financeiro."},503);
  // Proprietario sem catalogo: revisao por administrador autenticado.
  // O admin somente usa a RPC transacional e fail-closed especifica,
  // nunca UPDATE direto legado.
  if (!catalogo.data && !administrador) {
    return t({sucesso:false,arquivado:false,
      erro:"Comercio sem catalogo financeiro: solicite revisao administrativa para exclusao segura."},409);
  }
  if (!administrador) {
    if (catalogo.data.proprietario_id !== a) {
      return t({sucesso:false,erro:"Titularidade do catalogo divergente."},403);
    }
    // Dono recebe confirmacao somente quando o tombstone financeiro existir.
    // Status legado 'deletado' isolado nao prova quitacao ou arquivamento.
    if (publicacao.data.status === "deletado") {
      const encerrado = await g.from("catalogo_encerramentos_comercio")
        .select("situacao").eq("comercio_id",id).maybeSingle();
      if (encerrado.error) return t({sucesso:false,erro:"Falha ao verificar o encerramento financeiro."},503);
      if (encerrado.data?.situacao === "arquivado")
        return t({sucesso:true,arquivado:true,ja_arquivado:true});
      return t({sucesso:false,arquivado:false,
        erro:"Comercio retirado da publicacao sem encerramento financeiro confirmado; revisao administrativa necessaria."},409);
    }
    const pedido = await g.rpc("catalogo_solicitar_encerramento_financeiro",{
      p_comercio:id,p_usuario:a
    });
    if (pedido.error) return t({sucesso:false,arquivado:false,erro:"Nao foi possivel solicitar encerramento financeiro."},503);
    if (pedido.data?.ok !== true) return t({sucesso:false,arquivado:false,erro:pedido.data?.mensagem || "Encerramento recusado."},409);
    return t({sucesso:true,arquivado:false,situacao:pedido.data.situacao,
      divida_centavos:pedido.data.divida_centavos,
      faturas_pendentes:pedido.data.faturas_pendentes,
      pedidos_em_andamento:pedido.data.pedidos_em_andamento,
      mensagem:pedido.data.mensagem || "Encerramento registrado. Arquivamento depende de confirmacao administrativa."});
  }
  const semCatalogo = !catalogo.data;
  const fim = await g.rpc(semCatalogo?
    "catalogo_arquivar_sem_catalogo_admin":"catalogo_finalizar_encerramento_financeiro",{
    p_comercio:id,p_admin:a
  });
  if (fim.error) return t({sucesso:false,arquivado:false,erro:"Nao foi possivel validar o arquivamento no banco."},503);
  if (fim.data?.ok !== true || fim.data?.situacao !== "arquivado" ||
      (semCatalogo && fim.data?.sem_catalogo !== true)) {
    return t({sucesso:false,arquivado:false,erro:fim.data?.mensagem || "Finalizacao nao autorizada."},409);
  }
  // A decisao financeira ja foi confirmada no banco. O GitHub e uma vitrine
  // externa: em falhas, nunca reverter a finalizacao nem reportar sucesso falso.
  const confirmado = await g.from("comercios_publicados")
    .select("status").eq("local_id",id).maybeSingle();
  if (confirmado.error || !["arquivado","deletado"].includes(confirmado.data?.status)) {
    return t({sucesso:false,arquivado:true,pendente_sincronizacao:true,
      erro:"Finalizacao registrada, mas a publicacao ainda nao foi confirmada."},503);
  }
  try {
    const repositorio = await z();
    const indice = repositorio.comercios.findIndex(c => String(c?.id) === String(id));
    if (indice < 0) return t({sucesso:false,arquivado:true,pendente_sincronizacao:true,
      erro:"Arquivamento financeiro confirmado; vitrine publica requer reconciliacao."},503);
    const atual = repositorio.comercios[indice];
    if (atual.status !== "deletado" || atual.destaque || atual.imagem || (atual.imagens?.length ?? 0) > 0) {
      repositorio.comercios[indice] = {...atual,status:"deletado",destaque:false,imagem:"",imagens:[]};
      await b(S,JSON.stringify(repositorio.comercios,null,2)+String.fromCharCode(10),repositorio.sha,
        "Arquivar comercio apos quitacao: "+atual.nome);
    }
  } catch (_erro) {
    return t({sucesso:false,arquivado:true,pendente_sincronizacao:true,
      erro:"Arquivamento financeiro registrado; falha ao atualizar a vitrine publica. Repetir sincronizacao."},503);
  }
  // Somente apos confirmar GitHub. Falha de ACK mantem a fila para retry,
  // sem desfazer a decisao financeira e sem repetir pagamento.
  const sincronizado=await g.rpc("catalogo_confirmar_vitrine_admin",{p_comercio:id,p_admin:a});
  if(sincronizado.error||sincronizado.data?.ok!==true)
    return t({sucesso:false,arquivado:true,pendente_sincronizacao:true,
      erro:"Vitrine atualizada; confirmacao local pendente. Repetir sincronizacao."},503);
  // As referencias originais permanecem no cadastro/Storage. A limpeza fisica
  // dependera de uma rotina independente que comprove propriedade dos objetos.
  return t({sucesso:true,arquivado:true,mensagem:"Comercio arquivado com historico preservado."});
}
async function _e(e,a){const r=await y(e);if(!r)return t({sucesso:!1,erro:"Acesso administrativo negado."},403);const o=u(a?.comercio_id);if(!o||typeof a?.destaque!="boolean")return t({sucesso:!1,erro:"Informe comercio_id e destaque (boolean)."},400);const{data:s,error:i}=await g.from("comercios_publicados").select("local_id,status,destaque").eq("local_id",o).maybeSingle();if(i)return t({sucesso:!1,erro:i.message},500);if(!s)return t({sucesso:!1,erro:"Com\xE9rcio n\xE3o encontrado."},404);if(s.status!=="ativo")return t({sucesso:!1,erro:"Somente com\xE9rcios ativos podem receber destaque."},400);if(s.destaque===a.destaque)return t({sucesso:!0,destaque:s.destaque,mensagem:"O destaque j\xE1 estava nesse estado."});const n=await z(),d=n.comercios.findIndex(l=>String(l?.id)===o);if(d<0)return t({sucesso:!1,erro:"Com\xE9rcio n\xE3o encontrado em DATA/comercios.json."},404);if(String(n.comercios[d]?.status||"").toLowerCase()!=="ativo")return t({sucesso:!1,erro:"O registro p\xFAblico n\xE3o est\xE1 ativo."},409);const c=s.destaque,m=new Date().toISOString();n.comercios[d]={...n.comercios[d],destaque:a.destaque};const{data:f,error:p}=await g.from("comercios_publicados").update({destaque:a.destaque,atualizado_em:m,atualizado_por:r.id}).eq("local_id",o).eq("status","ativo").select("local_id").maybeSingle();if(p||!f)return t({sucesso:!1,erro:p?.message||"O status do com\xE9rcio mudou durante a opera\xE7\xE3o; recarregue e tente novamente."},p?500:409);try{await b(S,JSON.stringify(n.comercios,null,2)+`\n`,n.sha,`${a.destaque?"Destacar":"Remover destaque de"} com\xE9rcio: ${n.comercios[d].nome}`)}catch(l){return await g.from("comercios_publicados").update({destaque:c,atualizado_em:new Date().toISOString(),atualizado_por:r.id}).eq("local_id",o),t({sucesso:!1,erro:l.message},500)}return t({sucesso:!0,destaque:a.destaque,mensagem:"Destaque atualizado."})}async function we(e,a){const r=await y(e);if(!r)return t({sucesso:!1,erro:"Acesso administrativo negado."},403);const o=u(a?.comercio_id);return o?await ae(o,r.id,!0):t({sucesso:!1,erro:"comercio_id n\xE3o informado."},400)}async function he(e,a){const r=await y(e);if(!r)return t({sucesso:!1,erro:"Acesso administrativo negado."},403);const o=u(a?.cadastro_id),s=u(a?.motivo);if(!o)return t({sucesso:!1,erro:"cadastro_id n\xE3o informado."},400);const{data:i,error:n}=await g.from("cadastros_comercios").select("id,status,local_id,motivo_rejeicao,revisado_por,revisado_em").eq("id",o).maybeSingle();if(n)return t({sucesso:!1,erro:n.message},500);if(!i)return t({sucesso:!1,erro:"Cadastro n\xE3o encontrado."},404);if(i.status!=="pendente")return t({sucesso:!1,erro:`Cadastro n\xE3o est\xE1 pendente. Status atual: ${i.status}`},400);let d=null;if(i.local_id){const{data:m,error:f}=await g.from("comercios_publicados").select("local_id,status,destaque,deletado_em,atualizado_em,atualizado_por").eq("local_id",i.local_id).maybeSingle();if(f)return t({sucesso:!1,erro:f.message},500);if(d=m,m&&!["pendente","rejeitado"].includes(m.status))return t({sucesso:!1,erro:"O ID p\xFAblico j\xE1 est\xE1 ativo ou arquivado; n\xE3o \xE9 poss\xEDvel rejeitar este cadastro como pendente."},409)}const{error:c}=await g.from("cadastros_comercios").update({status:"rejeitado",motivo_rejeicao:s||null,revisado_por:r.id,revisado_em:new Date().toISOString()}).eq("id",o);if(c)return t({sucesso:!1,erro:c.message},500);if(i.local_id){const{error:m}=await g.from("comercios_publicados").upsert({local_id:i.local_id,status:"rejeitado",destaque:!1,deletado_em:null,atualizado_em:new Date().toISOString(),atualizado_por:r.id},{onConflict:"local_id"});if(m){const{error:f}=await g.from("cadastros_comercios").update({status:i.status,motivo_rejeicao:i.motivo_rejeicao??null,revisado_por:i.revisado_por??null,revisado_em:i.revisado_em??null}).eq("id",o);return f&&console.error("Falha ao reverter rejei\xE7\xE3o ap\xF3s erro nos metadados:",f.message),d&&await g.from("comercios_publicados").update(d).eq("local_id",i.local_id),t({sucesso:!1,erro:`Cadastro n\xE3o rejeitado: falha ao sincronizar metadados (${m.message}).`},500)}}return t({sucesso:!0,mensagem:"Cadastro rejeitado com sucesso."})}function Ae(e){const a=u(e?.nome);if(!a)throw new Error("A pessoa precisa possuir um nome.");const r=u(e?.id)||u(e?.pessoa_id)||u(e?.id_publico)||N(a),o=j(e);return{id:r,nome:a,categoria:u(e?.categoria),descricao:u(e?.descricao),sobre:u(e?.sobre),instagram:u(e?.instagram),imagem:o[0]||"",imagens:o,status:"ativo"}}async function ye(e){const a=Ae(e),r=await C(),o=r.pessoas.findIndex(s=>s?.id===a.id);return o>=0?r.pessoas[o]={...r.pessoas[o],...a}:r.pessoas.push(a),await b(O,JSON.stringify(r.pessoas,null,2)+`\n`,r.sha,`Publicar pessoa no mural: ${a.nome}`),a}async function oe(e){const{data:a,error:r}=await g.from("mural_cadastros").select("*").eq("id",e).maybeSingle();return r?{cadastro:null,erro:r.message,status:500}:a?{cadastro:a,erro:null,status:200}:{cadastro:null,erro:"Cadastro do mural n\xE3o encontrado.",status:404}}async function be(e,a){const r=await E(e);if(!r)return t({sucesso:!1,erro:"Voc\xEA precisa estar conectado para criar um perfil."},401);const o=a?.cadastro;if(!o||typeof o!="object")return t({sucesso:!1,erro:"Dados do perfil n\xE3o informados."},400);const{data:s,error:i}=await g.from("mural_cadastros").select("id").eq("usuario_id",r.id).in("status",["pendente","aprovado","ativo"]);if(i)return t({sucesso:!1,erro:"N\xE3o foi poss\xEDvel verificar seus perfis.",detalhe:i.message},500);if((s?.length??0)>=3)return t({sucesso:!1,limite:!0,erro:"Voc\xEA j\xE1 possui o limite de 3 perfis ativos no Mural."},400);const n=u(o.nome);if(!n)return t({sucesso:!1,erro:"Informe o nome do perfil."},400);let d=u(o.id)||u(o.pessoa_id)||u(o.id_publico)||N(n);const c=u(o.imagem),m=j(o);let f=2;for(;;){const{data:h}=await g.from("mural_cadastros").select("id").eq("id",d).maybeSingle();if(!h)break;d=`${N(n)}-${f}`,f++}const p={id:d,usuario_id:r.id,nome:n,categoria:u(o.categoria),descricao:u(o.descricao),sobre:u(o.sobre),instagram:u(o.instagram),imagem:m[0]||c||"",imagens:m,status:"pendente",motivo_recusa:null,criado_em:new Date().toISOString(),atualizado_em:new Date().toISOString()},{data:l,error:_}=await g.from("mural_cadastros").insert(p).select().single();return _?(console.error("Erro ao criar mural:",_),t({sucesso:!1,erro:"N\xE3o foi poss\xEDvel enviar o perfil para an\xE1lise.",detalhe:_.message},500)):t({sucesso:!0,mensagem:"Perfil enviado para an\xE1lise.",cadastro:l})}async function ve(e,a){if(!await y(e))return t({sucesso:!1,erro:"Acesso administrativo negado."},403);const o=u(a?.cadastro_id);if(!o)return t({sucesso:!1,erro:"cadastro_id n\xE3o informado."},400);const s=await oe(o);if(s.erro)return t({sucesso:!1,erro:s.erro},s.status);const i=s.cadastro;if(i.status!=="pendente")return t({sucesso:!1,erro:`Cadastro do mural n\xE3o est\xE1 pendente. Status atual: ${i.status}`},400);let n;try{n=await ye(i)}catch(m){return t({sucesso:!1,publicado:!1,erro:m.message},500)}const{data:d,error:c}=await g.from("mural_cadastros").update({status:"ativo",motivo_recusa:null,atualizado_em:new Date().toISOString()}).eq("id",o).select().maybeSingle();return c?t({sucesso:!1,publicado:!0,erro:"A pessoa foi publicada no GitHub, mas o cadastro n\xE3o p\xF4de ser atualizado no Supabase.",detalhe:c.message,pessoa:n},500):t({sucesso:!0,publicado:!0,mensagem:"Cadastro do mural aprovado e publicado com sucesso.",pessoa:n,cadastro:d})}async function Se(e,a){if(!await y(e))return t({sucesso:!1,erro:"Acesso administrativo negado."},403);const o=u(a?.cadastro_id),s=u(a?.motivo);if(!o)return t({sucesso:!1,erro:"cadastro_id n\xE3o informado."},400);const i=await oe(o);if(i.erro)return t({sucesso:!1,erro:i.erro},i.status);const{error:n}=await g.from("mural_cadastros").update({status:"rejeitado",motivo_recusa:s||null,atualizado_em:new Date().toISOString()}).eq("id",o);return n?t({sucesso:!1,erro:n.message},500):t({sucesso:!0,mensagem:"Cadastro do mural rejeitado com sucesso."})}async function qe(e,a){if(!await y(e))return t({sucesso:!1,erro:"Acesso administrativo negado."},403);const o=u(a?.pessoa_id),s=a?.pessoa;if(!o)return t({sucesso:!1,erro:"pessoa_id n\xE3o informado."},400);if(!s||typeof s!="object")return t({sucesso:!1,erro:"Dados da pessoa n\xE3o informados."},400);const i=await C(),n=i.pessoas.findIndex(f=>f?.id===o);if(n===-1)return t({sucesso:!1,erro:"Pessoa n\xE3o encontrada em DATA/pessoas.json."},404);const d=i.pessoas[n],c={...d,...s,id:d.id},m=["nome","categoria","descricao","sobre","instagram","imagem"];for(const f of m)c[f]=u(c[f]);c.imagens=j(c),c.imagem=c.imagens[0]||"",i.pessoas[n]=c;try{await b(O,JSON.stringify(i.pessoas,null,2)+`\n`,i.sha,`Editar pessoa do mural: ${c.nome}`)}catch(f){return t({sucesso:!1,erro:f.message},500)}return await g.from("mural_cadastros").update({nome:c.nome,categoria:c.categoria,descricao:c.descricao,sobre:c.sobre,instagram:c.instagram,imagem:c.imagem,imagens:c.imagens,atualizado_em:new Date().toISOString()}).eq("id",o),t({sucesso:!0,mensagem:"Pessoa do mural atualizada com sucesso.",pessoa:c})}async function re(e,a){const r=await E(e);if(!r)return t({sucesso:!1,erro:"Usu\xE1rio n\xE3o autenticado."},401);const o=u(a?.pessoa_id);if(!o)return t({sucesso:!1,erro:"pessoa_id n\xE3o informado."},400);const{data:s,error:i}=await g.from("mural_cadastros").select("*").eq("id",o).maybeSingle();if(i)return t({sucesso:!1,erro:"Erro ao localizar o perfil.",detalhe:i.message},500);if(!s)return t({sucesso:!1,erro:"Cadastro do mural n\xE3o encontrado."},404);if(!(r.id===R)&&s.usuario_id!==r.id)return t({sucesso:!1,erro:"Voc\xEA n\xE3o tem permiss\xE3o para arquivar este perfil."},403);if(s.status==="deletado")return t({sucesso:!0,arquivado:!0,ja_arquivado:!0,mensagem:"O perfil j\xE1 est\xE1 arquivado."});const d=await C(),c=d.pessoas.findIndex(w=>String(w?.id)===o);if(c<0)return t({sucesso:!1,erro:"Perfil n\xE3o encontrado em DATA/pessoas.json."},404);const m=d.pessoas[c],f=$(m,s),p=new Date().toISOString();d.pessoas[c]={...m,status:"deletado",imagem:"",imagens:[]};const{data:l,error:_}=await g.from("mural_cadastros").update({status:"deletado",imagem:"",imagens:[],atualizado_em:p}).eq("id",o).eq("usuario_id",s.usuario_id).select().maybeSingle();if(_||!l)return t({sucesso:!1,erro:_?.message||"O cadastro foi alterado por outra sess\xE3o; recarregue e tente novamente."},409);try{await b(O,JSON.stringify(d.pessoas,null,2)+`\n`,d.sha,`Arquivar perfil do mural: ${m.nome}`)}catch(w){return await g.from("mural_cadastros").update({status:s.status,imagem:s.imagem??"",imagens:s.imagens??[],atualizado_em:s.atualizado_em}).eq("id",o).eq("usuario_id",s.usuario_id),t({sucesso:!1,erro:w.message},500)}let h=0,v=null;try{h=(await Z(f)).queued}catch(w){v="O perfil foi arquivado; a rotina de reconcilia\xE7\xE3o tentar\xE1 registrar as fotos na fila.",console.error("Falha ao enfileirar fotos do perfil arquivado:",w.message)}return t({sucesso:!0,arquivado:!0,fotos_na_fila:h,aviso:v,mensagem:"Perfil arquivado; as fotos permanecem armazenadas durante a reten\xE7\xE3o.",cadastro:l})}async function Ee(e,a){const r=await E(e);if(!r)return t({sucesso:!1,erro:"Usu\xE1rio n\xE3o autenticado."},401);const o=u(a?.pessoa_id),s=a?.pessoa;if(!o)return t({sucesso:!1,erro:"pessoa_id n\xE3o informado."},400);if(!s||typeof s!="object")return t({sucesso:!1,erro:"Dados da pessoa n\xE3o informados."},400);const{data:i,error:n}=await g.from("mural_cadastros").select("*").eq("id",o).maybeSingle();if(n)return t({sucesso:!1,erro:n.message},500);if(!i)return t({sucesso:!1,erro:"Perfil n\xE3o encontrado."},404);if(i.usuario_id!==r.id)return t({sucesso:!1,erro:"Voc\xEA n\xE3o \xE9 o propriet\xE1rio deste perfil."},403);if(!["aprovado","ativo"].includes(i.status))return t({sucesso:!1,erro:"Somente perfis publicados podem ser editados por seus propriet\xE1rios."},400);const d=await C(),c=d.pessoas.findIndex(_=>_?.id===o);if(c===-1)return t({sucesso:!1,erro:"Perfil n\xE3o encontrado em DATA/pessoas.json."},404);const m=d.pessoas[c],f={...m,nome:u(s.nome??m.nome),categoria:u(s.categoria??m.categoria),descricao:u(s.descricao??m.descricao),sobre:u(s.sobre??m.sobre),instagram:u(s.instagram??m.instagram),id:m.id};f.imagens=j({...m,...s,imagem:s.imagem??m.imagem,imagens:s.imagens??m.imagens}),f.imagem=f.imagens[0]||"",d.pessoas[c]=f;try{await b(O,JSON.stringify(d.pessoas,null,2)+`\n`,d.sha,`Editar meu perfil no mural: ${f.nome}`)}catch(_){return t({sucesso:!1,erro:_.message},500)}const{data:p,error:l}=await g.from("mural_cadastros").update({nome:f.nome,categoria:f.categoria,descricao:f.descricao,sobre:f.sobre,instagram:f.instagram,imagem:f.imagem,imagens:f.imagens,atualizado_em:new Date().toISOString()}).eq("id",o).eq("usuario_id",r.id).select().maybeSingle();return l?t({sucesso:!1,atualizado:!0,erro:"O perfil foi atualizado no site, mas houve erro ao atualizar o cadastro no Supabase.",detalhe:l.message},500):t({sucesso:!0,mensagem:"Seu perfil foi atualizado com sucesso.",pessoa:f,cadastro:p})}async function ze(e,a){const r=await E(e);if(!r)return t({sucesso:!1,erro:"Usu\xE1rio n\xE3o autenticado."},401);const o=u(a?.comercio_id),s=a?.comercio;if(!o)return t({sucesso:!1,erro:"comercio_id n\xE3o informado."},400);if(!s||typeof s!="object")return t({sucesso:!1,erro:"Dados do com\xE9rcio n\xE3o informados."},400);const i=await Y(o);if(i.erro)return t({sucesso:!1,erro:i.erro.message},500);const n=i.cadastro;if(!n)return t({sucesso:!1,erro:"Cadastro do com\xE9rcio n\xE3o encontrado."},404);if(n.usuario_id!==r.id)return t({sucesso:!1,erro:"Voc\xEA n\xE3o \xE9 o propriet\xE1rio deste com\xE9rcio."},403);if(n.status!=="aprovado")return t({sucesso:!1,erro:"Somente com\xE9rcios publicados podem ser editados pelo propriet\xE1rio."},400);const d=await z(),c=le(d.comercios,n,o);if(c===-1)return t({sucesso:!1,erro:"Com\xE9rcio n\xE3o encontrado em DATA/comercios.json.",detalhes:{comercio_id:o,cadastro_id:n.id,local_id:n.local_id,id_publico:n.id_publico,nome:n.nome}},404);const m=d.comercios[c],{data:f,error:p}=await g.from("comercios_publicados").select("status,destaque").eq("local_id",d.comercios[c].id).maybeSingle();if(p)return t({sucesso:!1,erro:p.message},500);if(!f||f.status!=="ativo")return t({sucesso:!1,erro:"Somente com\xE9rcios ativos podem ser editados pelo propriet\xE1rio."},400);const l={...m,...s,id:m.id};l.status=f.status,l.destaque=f.destaque;const _=["nome","categoria","descricao","historia","curiosidades","endereco","horario","entrada","telefone","whatsapp","instagram","site","imagem"];for(const w of _)l[w]=u(l[w]);l.latitude=q(l.latitude),l.longitude=q(l.longitude),l.imagens=D(l),l.imagem=l.imagens[0]||"",d.comercios[c]=l;try{await b(S,JSON.stringify(d.comercios,null,2)+`\n`,d.sha,`Editar meu com\xE9rcio: ${l.nome}`)}catch(w){return t({sucesso:!1,erro:w.message},500)}const{data:h,error:v}=await g.from("cadastros_comercios").update({nome:l.nome,categoria:l.categoria,descricao:l.descricao,endereco:l.endereco,horario:l.horario,telefone_usuario:l.telefone||l.whatsapp,whatsapp:l.whatsapp,instagram:l.instagram,latitude:l.latitude,longitude:l.longitude,imagem_url:l.imagem,imagens:l.imagens,atualizado_em:new Date().toISOString()}).eq("id",n.id).eq("usuario_id",r.id).select().maybeSingle();return v?t({sucesso:!1,atualizado:!0,erro:"O com\xE9rcio foi atualizado no site, mas houve erro ao atualizar o cadastro no Supabase.",detalhe:v.message},500):t({sucesso:!0,mensagem:"Seu com\xE9rcio foi atualizado com sucesso.",comercio:l,cadastro:h})}async function Oe(e,a){const r=await E(e);if(!r)return t({sucesso:!1,erro:"Usu\xE1rio n\xE3o autenticado."},401);const o=u(a?.comercio_id);return o?await ae(o,r.id,!1):t({sucesso:!1,erro:"comercio_id n\xE3o informado."},400)}async function Ce(e,a){const r=u(a?.acao);switch(r){case"testar_aprovacao":return await me(e,a);case"aprovar_cadastro":return await fe(e,a);case"rejeitar_cadastro":return await he(e,a);case"editar_comercio":return await ge(e,a);case"atualizar_destaque_comercio":return await _e(e,a);case"marcar_comercio_deletado":case"excluir_comercio":return await we(e,a);case"aprovar_mural":return await ve(e,a);case"rejeitar_mural":return await Se(e,a);case"editar_mural":return await qe(e,a);case"marcar_mural_deletado":case"excluir_mural":return await re(e,a);default:return t({sucesso:!1,erro:"A\xE7\xE3o administrativa inv\xE1lida.",acao:r},400)}}function Ie(e){const a=e?.cadastro;return!a||typeof a!="object"?t({sucesso:!1,erro:"Dados do cadastro n\xE3o informados."},400):t({sucesso:!0,mensagem:"Cadastro recebido."})}async function Pe(e,a){if(!G||!k)return console.log("WhatsApp n\xE3o configurado."),null;const r=`https://graph.facebook.com/${ne}/${k}/messages`,o=await fetch(r,{method:"POST",headers:{Authorization:`Bearer ${G}`,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:e,type:"text",text:{body:a}})}),s=await o.json();if(!o.ok)throw console.error("Erro WhatsApp:",s),new Error("Erro ao enviar mensagem pelo WhatsApp.");return s}async function Te(e){console.log("Webhook WhatsApp recebido: assinatura validada, sem registrar o payload.");const a=e?.entry;if(!Array.isArray(a))return t({sucesso:!0});for(const r of a){const o=r?.changes;if(Array.isArray(o))for(const s of o){const i=s?.value?.messages;if(Array.isArray(i))for(const n of i){const d=n?.from;if(!d||n?.type!=="text")continue;const c=u(n?.text?.body).toLowerCase();if(!c)continue;let m=`Ol\xE1! \u{1F44B}\n\nEste atendimento est\xE1 temporariamente indispon\xEDvel.\n\nVoc\xEA pode realizar seu cadastro diretamente pelo site do Andrel\xE2ndia \u2014 Guia Tur\xEDstico.`;(c==="oi"||c==="ol\xE1"||c==="ola")&&(m=`Ol\xE1! \u{1F44B}\n\nVoc\xEA est\xE1 falando com o Andrel\xE2ndia \u2014 Guia Tur\xEDstico.\n\nNo momento, o cadastro de com\xE9rcio pode ser realizado diretamente pelo site.`);try{await Pe(d,m)}catch(f){console.error("Erro ao responder WhatsApp:",f)}}}}return t({sucesso:!0})}// COB-06: Meta WhatsApp assina os BYTES exatos do POST com App Secret.
// A chave de verificacao GET e distinta do WHATSAPP_APP_SECRET utilizado aqui.
async function cob06VerificarAssinaturaWhatsapp(requisicao,corpoBruto) {
  const segredo=Deno.env.get("WHATSAPP_APP_SECRET")??"";
  if (!segredo) return {ok:false,codigo:503};
  const header=requisicao.headers.get("X-Hub-Signature-256")??"";
  if (!/^sha256=[a-f0-9]{64}$/i.test(header)) return {ok:false,codigo:401};
  const hex=header.slice(7);
  const assinatura=new Uint8Array(32);
  for (let i=0;i<32;i++) assinatura[i]=Number.parseInt(hex.slice(2*i,2*i+2),16);
  const chave=await crypto.subtle.importKey("raw",new TextEncoder().encode(segredo),
    {name:"HMAC",hash:"SHA-256"},false,["verify"]);
  const valido=await crypto.subtle.verify("HMAC",chave,assinatura,corpoBruto);
  return valido?{ok:true}:{ok:false,codigo:401};
}
async function cob06LerPostLimitado(requisicao){
  const MAX_BYTES=256*1024;
  const declarado=requisicao.headers.get("content-length");
  if(declarado!==null&&(!/^[0-9]+$/.test(declarado)||
      !Number.isSafeInteger(Number(declarado))))
    return {ok:false,status:400,erro:"Tamanho de requisicao invalido."};
  if(declarado!==null&&Number(declarado)>MAX_BYTES)
    return {ok:false,status:413,erro:"Requisicao excede limite seguro."};
  if(!requisicao.body)
    return {ok:false,status:400,erro:"Corpo ausente."};
  const leitor=requisicao.body.getReader(),partes=[];
  let total=0,finalizado=false;
  try{
    while(true){
      const parte=await leitor.read();
      if(parte.done){finalizado=true;break;}
      total+=parte.value.byteLength;
      if(total>MAX_BYTES)
        return {ok:false,status:413,erro:"Requisicao excede limite seguro."};
      partes.push(parte.value);
    }
  }catch{
    return {ok:false,status:400,erro:"Falha ao ler requisicao."};
  }finally{
    if(!finalizado)await leitor.cancel().catch(()=>{});
    leitor.releaseLock();
  }
  if(declarado!==null&&total!==Number(declarado))
    return {ok:false,status:400,erro:"Tamanho declarado divergente."};
  const bytes=new Uint8Array(total);
  let posicao=0;
  for(const parte of partes){bytes.set(parte,posicao);posicao+=parte.byteLength;}
  try{
    const dados=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
    return {ok:true,bytes,dados};
  }catch{
    return {ok:false,status:400,erro:"JSON invalido."};
  }
}
// Antiabuso no backend, por identidade confirmada no Auth (nao IP de header).
// A rota cadastro_web so responde confirmacao; Meta e validada por HMAC e nao
// participa do limitador de formularios autenticados.
async function cob06LimitarMutacaoPublica(requisicao,dados){
  const acao=dados?.acao;
  const politica=acao==="criar_mural"?{limite:5,janela:3600}:
    ["editar_meu_mural","editar_meu_comercio"].includes(acao)?{limite:20,janela:60}:null;
  if(!politica)return null;
  const usuario=await E(requisicao);
  if(!usuario?.id)
    return t({sucesso:false,erro:"Autenticacao necessaria."},401);
  const chaveBruta="whatsapp-bot:acao:"+acao+":usuario:"+usuario.id;
  const resumo=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(chaveBruta));
  const chave=Array.from(new Uint8Array(resumo),valor=>valor.toString(16).padStart(2,"0")).join("");
  const {data,error}=await g.rpc("catalogo_offline_consumir_limite",{
    p_chave_hash:chave,p_limite:politica.limite,p_janela_segundos:politica.janela
  });
  if(error||data!==true)
    return t({sucesso:false,erro:error?
      "Nao foi possivel verificar o limite de requisicoes.":
      "Muitas tentativas. Aguarde para tentar novamente."},error?503:429);
  return null;
}
async function je(e){
  const metodo=e.method;
  if(metodo==="OPTIONS") return new Response(null,{status:204,headers:T});
  if(metodo==="GET"){
    const params=new URL(e.url).searchParams;
    const mode=params.get("hub.mode"),token=params.get("hub.verify_token"),desafio=params.get("hub.challenge");
    if(mode!==null){
      if(mode==="subscribe" && F && token===F)
        return new Response(desafio||"",{status:200,headers:{...T,"Content-Type":"text/plain"}});
      return new Response("Verificacao recusada.",{status:403,headers:{...T,"Content-Type":"text/plain"}});
    }
    return new Response("Webhook ativo.",{status:200,headers:{...T,"Content-Type":"text/plain"}});
  }
  if(metodo!=="POST") return t({sucesso:false,erro:"Metodo nao permitido."},405);
  // Limite efetivo em bytes durante streaming, mesmo sem Content-Length.
  // Preserva bytes brutos para HMAC Meta (nao faz stringify nem normaliza Unicode).
  const recebido=await cob06LerPostLimitado(e);
  if(!recebido.ok)return t({sucesso:false,erro:recebido.erro},recebido.status);
  const corpoBruto=recebido.bytes,dados=recebido.dados;
  const bloqueio=await cob06LimitarMutacaoPublica(e,dados);
  if(bloqueio)return bloqueio;
  if(dados?.object==="whatsapp_business_account"){
    let verificado;
    try{verificado=await cob06VerificarAssinaturaWhatsapp(e,corpoBruto);}
    catch(_err){return t({sucesso:false,erro:"Validacao de assinatura indisponivel."},503);}
    if(!verificado.ok){
      return t({sucesso:false,erro:verificado.codigo===503?
        "Webhook WhatsApp indisponivel: segredo de verificacao nao configurado.":
        "Assinatura WhatsApp invalida."},verificado.codigo);
    }
    return await Te(dados);
  }
  return dados?.acao==="criar_mural"?await be(e,dados):
    dados?.acao==="editar_meu_mural"?await Ee(e,dados):
    ["excluir_meu_mural","marcar_meu_mural_deletado"].includes(dados?.acao)?await re(e,dados):
    dados?.acao==="editar_meu_comercio"?await ze(e,dados):
    ["excluir_meu_comercio","marcar_meu_comercio_deletado"].includes(dados?.acao)?await Oe(e,dados):
    ["testar_aprovacao","aprovar_cadastro","rejeitar_cadastro","editar_comercio",
     "atualizar_destaque_comercio","marcar_comercio_deletado","excluir_comercio",
     "aprovar_mural","rejeitar_mural","editar_mural","marcar_mural_deletado","excluir_mural"].includes(dados?.acao)?
       await Ce(e,dados):
    dados?.acao==="cadastro_web"?Ie(dados):
       t({sucesso:true,mensagem:"Requisicao recebida."});
}
// COB-06: erros inesperados nunca retornam mensagens internas ao cliente.
// Diagnostico permanece nos logs privados da Edge, sem vazar detalhes HTTP.
async function cob06HandlerSeguro(req){
  try { return await je(req); }
  catch (erro) {
    console.error("Erro nao tratado na Edge Function:",erro);
    return t({sucesso:false,erro:"Erro interno da Edge Function."},500);
  }
}
Deno.serve(cob06HandlerSeguro);
