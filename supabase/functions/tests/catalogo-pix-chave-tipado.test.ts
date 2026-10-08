import { ehTipoChavePixV2, validarChavePixTipadaV2 } from "../_shared/catalogo-pix-chave-v2.ts";

function check(ok:unknown,why:string): asserts ok { if(!ok) throw new Error(why); }

Deno.test("chave Pix exige tipo explícito e comprimento seguro",()=>{
  check(!ehTipoChavePixV2(null),"NULL não pode ser tipo");
  check(!ehTipoChavePixV2("pix"),"Não aceitar apelido não mapeado");
  for(const x of ["EMAIL","PHONE","CPF","CNPJ","PIX_CODE"])
    check(ehTipoChavePixV2(x),"Tipo oficial não suportado: "+x);
  check(!validarChavePixTipadaV2(null,"motoboy@example.invalid"),"Aceitou tipo vazio");
  check(!validarChavePixTipadaV2("EMAIL",null),"Aceitou chave vazia");
  check(!validarChavePixTipadaV2("EMAIL"," motoboy@example.invalid"),"Aceitou espaço");
});
Deno.test("email e telefone exigem formato compatível com Pix",()=>{
  check(validarChavePixTipadaV2("EMAIL","entrega@example.invalid"),"E-mail válido");
  check(!validarChavePixTipadaV2("PHONE","entrega@example.invalid"),"Tipo divergente");
  check(validarChavePixTipadaV2("PHONE","+5511999999999"),"Telefone E.164 BR");
  check(!validarChavePixTipadaV2("PHONE","11999999999"),"Telefone sem +55");
});
Deno.test("CPF e CNPJ precisam de dígitos verificadores válidos",()=>{
  check(validarChavePixTipadaV2("CPF","52998224725"),"CPF de teste com checksum");
  check(!validarChavePixTipadaV2("CPF","52998224724"),"CPF checksum inválido");
  check(!validarChavePixTipadaV2("CPF","11111111111"),"CPF repetido");
  check(validarChavePixTipadaV2("CNPJ","11222333000181"),"CNPJ de teste com checksum");
  check(!validarChavePixTipadaV2("CNPJ","11222333000182"),"CNPJ checksum inválido");
  check(!validarChavePixTipadaV2("CNPJ","00000000000000"),"CNPJ repetido");
});
Deno.test("chave aleatória aceita só UUID",()=>{
  check(validarChavePixTipadaV2("PIX_CODE","123e4567-e89b-12d3-a456-426614174000"),"UUID");
  check(!validarChavePixTipadaV2("PIX_CODE","not-uuid"),"UUID inválido");
  check(!validarChavePixTipadaV2("PIX_CODE","123e4567e89b12d3a456426614174000"),"UUID sem hífens");
});
