"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

const source=fs.readFileSync("js/login.js","utf8");
function extrair(nome){
 const inicio=source.indexOf("async function "+nome+"() {");
 assert.ok(inicio>=0,"Funcao de autenticacao nao encontrada: "+nome);
 const fim=source.indexOf("\r\n}\r\n",inicio);
 assert.ok(fim>inicio,"Fechamento da funcao nao encontrado: "+nome);
 return source.slice(inicio,fim+4);
}
const cadastro=extrair("cadastrarUsuario");
const login=extrair("fazerLogin");

function simulacao(senha){
 const erros=[],chamadas=[],fields={
  cadastroNome:{value:"Pessoa Teste",focus(){}},
  cadastroEmail:{value:"pessoa@exemplo.test",focus(){}},
  cadastroSenha:{value:senha,focus(){chamadas.push("focoSenha")}},
  cadastroConfirmarSenha:{value:senha,focus(){}},
  erroCadastro:{},
  botaoCadastro:{disabled:false,textContent:"Criar conta"},
  loginEmail:{value:""}
 };
 const contexto={
  document:{getElementById:id=>fields[id]||null},
  console:{error(){}},
  mostrarErroAuth:(_el,texto)=>erros.push(texto),
  mostrarFormularioAuth:modo=>chamadas.push("form:"+modo),
  obterSupabaseLogin:()=>({auth:{signUp:async dados=>{
   chamadas.push({tipo:"signup",dados});
   return {data:{user:null,session:null},error:null};
  }}}),
  traduzirErroAuth:e=>e.message
 };
 const executar=vm.runInNewContext("("+cadastro+")",contexto);
 return {executar,erros,chamadas,fields};
}

test("Cadastro rejeita senha nova de seis e onze caracteres antes de chamar Supabase Auth",async()=>{
 for(const senha of ["123456","12345678901"]){
  const c=simulacao(senha);
  await c.executar();
  assert.equal(c.chamadas.some(x=>x.tipo==="signup"),false);
  assert.equal(c.erros.at(-1),"Para criar uma conta, use uma senha de pelo menos 12 caracteres.");
  assert.equal(c.fields.botaoCadastro.disabled,false);
 }
});

test("Cadastro permite exatamente doze caracteres e confirma o payload antes do signUp",async()=>{
 const c=simulacao("123456789012");
 await c.executar();
 const chamados=c.chamadas.filter(x=>x.tipo==="signup");
 assert.equal(chamados.length,1);
 assert.equal(chamados[0].dados.password,"123456789012");
 assert.equal(chamados[0].dados.email,"pessoa@exemplo.test");
 assert.equal(c.fields.loginEmail.value,"pessoa@exemplo.test");
 assert.equal(c.fields.botaoCadastro.disabled,false);
});

test("A politica do novo cadastro nao altera o login dos usuarios existentes",()=>{
 assert.ok(login.includes("if (!senha)"),"Login recusa somente senha vazia no preflight");
 assert.ok(!/senha\.length\s*<\s*12/.test(login),
  "Nunca aplicar requisito de cadastro a autenticação de conta existente");
 assert.ok(cadastro.includes("senha.length < 12"));
});
