# Guia simples: publicar a migração do marketplace por Pull Request

Este guia publica **somente a etapa já validada** da migração. Ela adapta a área visual e prepara o banco, mas não ativa cobranças reais nem altera o Supabase de produção.

## O que esta etapa faz

- substitui a comunicação de mensalidade/anuidade por recebimentos por pedido;
- prepara tabelas de recebedores, pedidos e itens;
- calcula 5% sobre os produtos;
- mantém a entrega fora da comissão;
- adiciona consulta segura do status do recebedor;
- mantém o pagamento antigo e o histórico preservados;
- não publica OAuth funcional ainda;
- não cria cobrança real.

## Antes de começar

Você vai precisar de:

- sua conta do GitHub;
- acesso ao repositório `pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia`;
- Git instalado no computador, caso use o terminal;
- nenhum segredo ou token enviado por mensagem.

**Não resete o Supabase e não apague migrations antigas.**

## Opção recomendada: aplicar pelo terminal

### 1. Baixe o patch

Baixe o arquivo `guia-andrelandia-marketplace.patch` e coloque-o em uma pasta fácil de encontrar, como Downloads.

### 2. Abra o terminal nessa pasta

No Windows, abra PowerShell. No macOS/Linux, abra Terminal.

### 3. Clone o repositório

```bash
git clone https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia.git
cd Guia-Turistico-de-Andrel-ndia
```

Se você já tiver o repositório no computador, entre na pasta dele e não faça o clone novamente.

### 4. Crie uma branch para a mudança

```bash
git checkout -b marketplace-comissao-pix
```

Uma branch é uma cópia de trabalho separada. Ela permite revisar tudo sem alterar a branch principal.

### 5. Copie o patch para a pasta do projeto

No Windows PowerShell, supondo que o arquivo esteja em Downloads:

```powershell
Copy-Item "$HOME\Downloads\guia-andrelandia-marketplace.patch" .
```

No macOS/Linux:

```bash
cp ~/Downloads/guia-andrelandia-marketplace.patch .
```

### 6. Confira se o patch é compatível

```bash
git apply --check guia-andrelandia-marketplace.patch
```

Se não aparecer nenhuma mensagem, está tudo certo.

Se aparecer erro, **pare e não force a aplicação**. Envie a mensagem de erro para análise.

### 7. Aplique o patch

```bash
git apply guia-andrelandia-marketplace.patch
```

### 8. Rode os testes

Se o projeto já tiver Node.js instalado:

```bash
node --test tests/*.test.js tests/*.test.mjs tests/*.test.cjs
```

O resultado esperado nesta etapa é:

```text
66 tests
66 pass
0 fail
```

### 9. Veja o que foi alterado

```bash
git status
git diff --stat
git diff --check
```

Você deve ver arquivos relacionados a:

- área de recebimentos;
- pedidos marketplace;
- comissão;
- testes;
- migration do Supabase.

### 10. Faça o commit

```bash
git add .
git commit -m "Prepara marketplace Pix com comissão de 5%"
```

### 11. Envie a branch para o GitHub

```bash
git push -u origin marketplace-comissao-pix
```

### 12. Abra o Pull Request

Depois do `git push`, o GitHub normalmente mostra um botão **Compare & pull request**.

Clique nele e preencha:

**Título:**

```text
Prepara marketplace Pix com comissão de 5%
```

**Descrição:**

```markdown
## O que foi feito

- adapta a área de assinatura para recebimentos por pedido;
- prepara recebedores Mercado Pago;
- adiciona pedidos e itens com snapshot;
- calcula 5% somente sobre produtos;
- mantém entrega fora da comissão;
- preserva histórico de assinaturas e pagamentos antigos;
- mantém cobrança real desligada.

## Validação

- 66 testes aprovados
- 0 falhas
- sintaxe JavaScript aprovada
- git diff --check aprovado
- nenhum segredo incluído
- nenhuma alteração feita no Supabase de produção

## Ainda não incluído

- OAuth funcional;
- criação real do Pix de pedido;
- webhook de pedidos;
- ativação do checkout de produção.
```

Clique em **Create pull request**.

## O que fazer depois de abrir o PR

1. Não clique em Merge imediatamente.
2. Confira os arquivos alterados.
3. Veja se os testes automáticos do GitHub passaram.
4. Se aparecer algum erro, copie a mensagem completa.
5. Só depois da revisão o PR poderá ser mesclado na branch principal.

## Depois do merge

O Cloudflare Pages normalmente detecta a alteração da branch principal e inicia uma nova publicação automaticamente.

Confira no painel do Cloudflare Pages:

1. abra o projeto do site;
2. entre em **Deployments**;
3. aguarde o deploy terminar;
4. abra o endereço publicado;
5. teste a página do proprietário;
6. confirme que mensal/anual não aparece mais como nova contratação.

## Migration do Supabase

A migration está no repositório, mas **não aplique manualmente ainda** sem revisar o ambiente e o processo de deploy do Supabase.

Quando for o momento de aplicar:

1. faça backup/export do banco;
2. confirme que está no projeto de produção correto;
3. aplique apenas a migration nova;
4. confira se as três tabelas foram criadas;
5. não use reset;
6. não apague migrations antigas.

A migration nova é:

```text
supabase/migrations/20261004223000_catalogo_marketplace_pedidos.sql
```

## Secrets do Supabase

Ainda não configure secrets OAuth nesta etapa. Quando o callback OAuth estiver implementado, os secrets serão adicionados pelo painel do Supabase, nunca no GitHub:

```text
MP_OAUTH_CLIENT_ID
MP_OAUTH_REDIRECT_URI
MP_OAUTH_CLIENT_SECRET
MP_WEBHOOK_SECRET
```

Os valores reais não devem ser colocados neste patch, em arquivos públicos ou em mensagens.

## Como desfazer a branch antes do merge

Se você aplicou o patch e quiser voltar ao estado anterior, sem ter feito commit:

```bash
git restore .
git clean -fd
```

Atenção: `git clean -fd` remove arquivos não rastreados. Use apenas se tiver certeza de que não há outros arquivos importantes na pasta.

Se já fez o commit, mas ainda não enviou:

```bash
git reset --hard HEAD~1
```

Se a branch já foi enviada ao GitHub, é melhor fechar o PR em vez de forçar alterações.
