# Implementação local — Guia Turístico de Andrelândia

**Base:** commit `db7bef1` do repositório fornecido. As alterações estão somente no clone da sandbox; não foram enviadas ao GitHub nem ao Supabase.

## Entregue no código local

- `cadastros.html` fica dedicado a cadastro de comércio. Foram removidos a opção “Sugerir alteração”, os campos e os handlers associados; o formulário de novo cadastro preserva o fluxo de insert existente e envia `status: pendente`.
- `DATA/comercios.json` é a fonte unificada local. Os dados de hospedagem foram incorporados por categoria; `DATA/hospedagem.json` deixou de ser consumido e foi removido do patch. Hotel, Pousada, Aluguel e categorias futuras entram em “Onde ficar”. O registro demonstrativo `Pousada Exemplo` ficou como `pendente`, fora das listas públicas.
- `js/comercio-utils.js` centraliza categorias, filtro estrito `status === ativo` e ordenação. As seções “Onde comer”, “Comércios locais” e “Onde ficar” mantêm seus filtros separados; páginas de detalhe e buscas também ocultam inativos.
- Destaques aparecem antes dos comuns e recebem selo. Os comuns mantêm sua ordem original e não são reordenados pelas avaliações. Os destacados usam média bayesiana com volume de avaliações e desempates estáveis.
- O painel local mostra status/histórico, permite alternar destaque e solicita arquivamento lógico. Ações novas (`marcar_*_deletado`) falham de forma segura até o backend compatível ser implantado; o frontend não chama os endpoints antigos que hoje removem itens do JSON.
- O mural aceita temporariamente status legado `aprovado`/`recusado` e novo `ativo`/`rejeitado`, para a versão web poder ser publicada antes da migração do banco sem interromper perfis existentes.
- Os botões administrativos restauram o rótulo se o backend falhar; o fluxo do proprietário só redireciona quando a Edge Function retorna `sucesso: true`, exibindo erro legível caso contrário.
- Como `index.js` e o painel leem o catálogo do JSON, o plano de backend agora exige atualizar o valor canônico no Supabase e sincronizar o snapshot JSON, com resultado parcial explícito e reconciliação antes de declarar sucesso.

## Validação local

- `node --test tests/commerce-utils.test.cjs`: **6 testes aprovados, 0 falhas**.
- `node --check` em todos os arquivos `js/*.js`: passou.
- JSON de comércio e pessoas: parse válido. `git diff --check`: sem erros de whitespace.
- A cópia local tem 139 registros de comércio (138 ativos e 1 pendente; todos com destaque inicialmente falso). Esses números pertencem ao working tree local, não ao JSON remoto nem ao Supabase.

## Situação Supabase e próximo gate

A inspeção real do projeto foi feita somente em leitura e está registrada em [SUPABASE-ALTERACOES-PENDENTES.md](SUPABASE-ALTERACOES-PENDENTES.md). Foi encontrado que não existe tabela de catálogo de comércios publicados; `cadastros_comercios` é o fluxo de solicitações. A Edge Function `whatsapp-bot` v41 usa ações antigas que removem itens dos JSONs e não pode ser chamada em produção para teste.

O usuário aprovou condicionalmente o plano: **publicar o frontend primeiro**; depois, aplicar DDL/RLS e deploy da Edge Function conforme descrito. Ao arquivar, remover referências às fotos e iniciar retenção de 7 dias. A purga física definitiva continua sem autorização e exigirá confirmação separada após revisão de relatório dry-run.

**Nenhuma alteração de banco/RLS, deploy, agendamento, escrita no GitHub ou exclusão de Storage foi feita.** O frontend ainda não foi publicado. Antes do backend, as ações novas do frontend são fail-closed; por isso, não usar controles de arquivamento/destaque até que a Edge Function compatível seja implantada.
