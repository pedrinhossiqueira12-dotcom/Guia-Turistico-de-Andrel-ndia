# Testes locais

Execute na raiz do repositório:

```bash
node --test tests/*.test.cjs tests/*.test.mjs
```
A suíte cobre: categorias de hospedagem, categorias de alimentação/comércio, filtro estrito por status ativo, prioridade e ranking de destaques, estabilidade da ordem comum, isolamento das avaliações dos não destacados, catálogo publicado, autorização de proprietário, código e token de entrega offline, confirmação única, auditoria de pedidos, comissão de 5%, fechamento mensal e automação desligada, bloqueio por inadimplência, rate limit, allowlist do comércio de teste, editorial, cobrança Pix da fatura e Mercado Pago (sandbox e produção). Resultado nesta implementação: **118 testes aprovados, 0 falhas**.

Todos os arquivos JavaScript em `js/` também passaram por `node --check`; os JSONs foram validados e seus IDs conferidos.

Esses testes não gravam nem consultam o Supabase. Aprovação/cadastro real, autorização RLS, sincronização do JSON e limpeza de Storage exigem integração Supabase autorizada e devem ser testados em ambiente apropriado antes da publicação.

## Testes de banco (migrations e funções)

Os testes acima são estáticos: leem o texto dos arquivos e não executam SQL. Foi justamente por isso que um defeito real na confirmação de entrega offline passou pelas revisões anteriores. Para validar os corpos PL/pgSQL existe o harness `scripts/validacao-pagamentos/`:

```bash
bash scripts/validacao-pagamentos/rodar.sh
```

Ele cria dois bancos PostgreSQL descartáveis, aplica as migrations do bloco de pagamentos presenciais, executa cinco cenários funcionais (confirmação de entrega, automação desligada, fechamento com total estável e auditoria, ciclo completo da cobrança Pix da fatura e preservação de bloqueio administrativo) e demonstra que a confirmação offline falhava antes de `20261005170000_catalogo_correcao_confirmacao_offline.sql`. Requer um PostgreSQL local; nenhuma conexão com o Supabase é feita.
