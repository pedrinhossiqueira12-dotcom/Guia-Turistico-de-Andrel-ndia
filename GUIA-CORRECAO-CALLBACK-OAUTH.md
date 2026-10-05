# Correção do callback OAuth Mercado Pago

A correção atualiza o callback para responder com HTML UTF-8 explícito, cabeçalhos de segurança, redirect protegido e uma tela intermediária mais legível. A página de recebimentos também mostra o resultado da conexão e remove `code` e `state` da barra de endereço depois do retorno.

## Aplicar no Windows

Na pasta do repositório, mantenha a branch `main` atualizada e aplique o patch:

```powershell
Copy-Item "$HOME\Downloads\guia-andrelandia-oauth-callback-fix.patch" .
git apply --check .\guia-andrelandia-oauth-callback-fix.patch
git apply .\guia-andrelandia-oauth-callback-fix.patch
git switch -c fix-callback-oauth
```

Se a branch já existir:

```powershell
git switch fix-callback-oauth
```

Valide:

```powershell
node --test tests/*.test.js tests/*.test.mjs tests/*.test.cjs
git diff --check
```

## Publicar

Depois de abrir e mesclar o Pull Request:

```powershell
git switch main
git pull origin main
npx supabase functions deploy mercadopago-oauth-callback --no-verify-jwt
```

O Cloudflare Pages publicará automaticamente o JavaScript atualizado quando o PR for mesclado.

## Novo teste OAuth

Não reutilize uma URL antiga contendo `code` e `state`: o código OAuth é de uso único e expira. Depois do deploy, volte ao catálogo, clique novamente em **Conectar conta Mercado Pago** e autorize outra vez.

O resultado esperado é uma página com caracteres acentuados corretos e a mensagem **Conta Mercado Pago conectada com sucesso. Você será redirecionado.** Depois do retorno, a tela deve mostrar **Conta Mercado Pago conectada**.
