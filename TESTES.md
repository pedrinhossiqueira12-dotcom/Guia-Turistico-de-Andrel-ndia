# Testes locais

Execute na raiz do repositório:

```bash
node --test tests/commerce-utils.test.cjs
```

A suíte cobre: categorias de hospedagem, categorias de alimentação/comércio, filtro estrito por status ativo, prioridade e ranking de destaques, estabilidade da ordem comum e isolamento das avaliações dos não destacados. Resultado nesta implementação: **6 testes aprovados**.

Todos os arquivos JavaScript em `js/` também passaram por `node --check`; os JSONs foram validados e seus IDs conferidos.

Esses testes não gravam nem consultam o Supabase. Aprovação/cadastro real, autorização RLS, sincronização do JSON e limpeza de Storage exigem integração Supabase autorizada e devem ser testados em ambiente apropriado antes da publicação.
