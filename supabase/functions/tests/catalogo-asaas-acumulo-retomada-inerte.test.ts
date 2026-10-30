import { retomarPreparacaoAcumuloInerte } from "../_shared/catalogo-asaas-acumulo-retomada-inerte.ts";

const id = "22222222-3333-4444-8888-aaaaaaaaaaaa";
const operacaoId = "77777777-7777-4777-8777-777777777777";
const lote = { id, comercio_id:"asaas-cob02", competencia_corte:"2040-04-01",
  total_centavos:500, estado:"preparado" };
const origens = [
  {competencia:"2040-03-01",valor_centavos:100,origem_consistente:true},
  {competencia:"2040-04-01",valor_centavos:400,origem_consistente:true},
];
const conferencia = { ok:true, integridade_contabil_ok:true,
  comercio_id:"asaas-cob02",lote_id:id,estado:"preparado",
  valor_fontes_centavos:500,valor_lote_centavos:500,quantidade_fontes:2,
  pode_emitir_pix:false,pode_quitar:false,pode_estornar:false,
  pode_liberar_motoboy:false,origens };
const referencia = {ok:true,lote_id:id,referencia:"guia-acumulo-"+id,
  operacao_id:operacaoId,valor_centavos:500,estado:"reservado",payment_id:null,
  pode_emitir_pix:false,ja_reservada:false};

function assert(ok:unknown,why:string){if(!ok)throw Error(why);}
async function hold(fn:()=>Promise<unknown>,codigo:string){
  let error="";
  try{await fn();}catch(e){error=String(e);}
  assert(error.includes("COB06_HOLD_"+codigo),"esperado "+codigo+" mas veio "+error);
}

Deno.test("COB06 retomada: duas chamadas reaproveitam lote e mesma referencia sem banco externo",async()=>{
  let leituras=0,reservas=0;
  const conferir=async()=>{leituras++;return conferencia;};
  const reservar=async()=>{reservas++;return {...referencia,ja_reservada:reservas>1};};
  const primeiro=await retomarPreparacaoAcumuloInerte(lote,"2040-04-01",conferir,reservar);
  const segundo=await retomarPreparacaoAcumuloInerte(lote,"2040-04-01",conferir,reservar);
  assert(leituras===2&&reservas===2&&primeiro.referencia===segundo.referencia&&
    primeiro.referencia_ja_reservada===false&&segundo.referencia_ja_reservada===true&&
    primeiro.recuperacao_de_lote_existente===true&&segundo.hold_obrigatorio===true&&
    segundo.pode_emitir_pix===false&&segundo.pode_quitar===false&&
    segundo.pode_liberar_motoboy===false,"retomada idempotente sem Pix");
});

Deno.test("COB06 retomada: ACK perdido apos reserva nao cria segunda referencia",async()=>{
  let reservas=0;
  const reservar=async()=>{
    reservas++;
    if(reservas===1)throw Error("resposta SQL perdida apos gravar");
    return {...referencia,ja_reservada:true};
  };
  let falhou=false;
  try{await retomarPreparacaoAcumuloInerte(lote,"2040-04-01",async()=>conferencia,reservar);}
  catch{falhou=true;}
  assert(falhou,"primeira resposta perdida nao pode confirmar sucesso");
  const retomado=await retomarPreparacaoAcumuloInerte(lote,"2040-04-01",async()=>conferencia,reservar);
  assert(reservas===2&&retomado.referencia_ja_reservada===true&&
    retomado.referencia===referencia.referencia&&retomado.hold_obrigatorio===true,
    "mesma referencia apos falha ambigua");
});

Deno.test("COB06 retomada: lote errado, ambiente financeiro inesperado e mes divergente param antes de RPC",async()=>{
  let chamadas=0;
  const mock=async()=>{chamadas++;throw Error("nao chamar");};
  for(const [atual,corte,codigo] of [
    [{...lote,id:"invalido"},"2040-04-01","LOTE_INVALIDO"],
    [{...lote,comercio_id:"outro"},"2040-04-01","LOTE_NAO_PREPARADO"],
    [{...lote,estado:"pago"},"2040-04-01","LOTE_NAO_PREPARADO"],
    [lote,"2040-05-01","LOTE_NAO_PREPARADO"],
    [{...lote,total_centavos:499},"2040-04-01","VALOR_INVALIDO"],
  ] as const){
    await hold(()=>retomarPreparacaoAcumuloInerte(atual,corte,mock,mock),codigo);
  }
  assert(chamadas===0,"sem consultas ou mutacoes para lote invalido");
});

Deno.test("COB06 retomada: origens incompletas ou divergentes nunca reservam referencia",async()=>{
  let reservas=0;
  const reservar=async()=>{reservas++;return referencia;};
  const casos=[
    {...conferencia,integridade_contabil_ok:false},
    {...conferencia,valor_fontes_centavos:499},
    {...conferencia,pode_emitir_pix:true},
    {...conferencia,origens:[origens[0]]},
    {...conferencia,origens:[origens[0],{...origens[1],origem_consistente:false}]},
    {...conferencia,origens:[origens[0],{...origens[1],competencia:"2040-03-01"}]},
    {...conferencia,origens:[origens[0],{...origens[1],valor_centavos:401}]},
  ];
  for(const preflight of casos){
    const codigo=preflight===casos[4]?"FONTE_INVALIDA":
      preflight===casos[5]||preflight===casos[6]?"ACUMULO_INVALIDO":"ORIGENS_DIVERGENTES";
    await hold(()=>retomarPreparacaoAcumuloInerte(lote,"2040-04-01",
      async()=>preflight,reservar),codigo);
  }
  assert(reservas===0,"nenhuma referencia criada sem integridade");
});

Deno.test("COB06 retomada: referencia alterada ou liberacao inesperada fica HOLD",async()=>{
  for(const ref of [
    {...referencia,payment_id:"pay_indevido"},
    {...referencia,pode_emitir_pix:true},
    {...referencia,referencia:"outra"},
    {...referencia,valor_centavos:501},
    {...referencia,estado:"emitido"},
  ]){
    await hold(()=>retomarPreparacaoAcumuloInerte(lote,"2040-04-01",
      async()=>conferencia,async()=>ref),"REFERENCIA_DIVERGENTE");
  }
});
