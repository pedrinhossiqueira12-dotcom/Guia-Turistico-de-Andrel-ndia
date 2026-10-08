/**
 * Validação de formato de chave Pix tipada, antes de persistir criptografada.
 * Não comprova existência, titularidade ou resolução DICT da chave.
 * Nenhuma chamada de rede e nenhuma exposição no cliente.
 */
export const TIPOS_CHAVE_PIX_V2 = ["EMAIL", "PHONE", "CPF", "CNPJ", "PIX_CODE"] as const;
export type TipoChavePixV2 = typeof TIPOS_CHAVE_PIX_V2[number];

export function ehTipoChavePixV2(value: unknown): value is TipoChavePixV2 {
  return typeof value === "string" &&
    (TIPOS_CHAVE_PIX_V2 as readonly string[]).includes(value);
}

function digitosVerificadoresCpf(chave: string): boolean {
  if (!/^[0-9]{11}$/.test(chave) || /^(\d)\1{10}$/.test(chave)) return false;
  const calc=(length: number): number => {
    const total=Array.from(chave.slice(0,length),(c,i)=>Number(c)*(length+1-i))
      .reduce((a,b)=>a+b,0);
    const digito=(total*10)%11;
    return digito===10?0:digito;
  };
  return calc(9)===Number(chave[9]) && calc(10)===Number(chave[10]);
}
function digitosVerificadoresCnpj(chave: string): boolean {
  if (!/^[0-9]{14}$/.test(chave) || /^(\d)\1{13}$/.test(chave)) return false;
  const digit=(length:number):number=>{
    const weights=length===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];
    const sum=weights.reduce((a,n,i)=>a+n*Number(chave[i]),0);
    const remainder=sum%11;
    return remainder<2?0:11-remainder;
  };
  return digit(12)===Number(chave[12])&&digit(13)===Number(chave[13]);
}
export function validarChavePixTipadaV2(tipo: unknown, value: unknown): value is string {
  if (!ehTipoChavePixV2(tipo) || typeof value!=="string" ||
      value!==value.trim() || value.length<3 || value.length>120) return false;
  switch(tipo){
    case "EMAIL":return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case "PHONE":return /^\+55[1-9][0-9]{9,10}$/.test(value);
    case "CPF":return digitosVerificadoresCpf(value);
    case "CNPJ":return digitosVerificadoresCnpj(value);
    case "PIX_CODE":return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
  }
}
