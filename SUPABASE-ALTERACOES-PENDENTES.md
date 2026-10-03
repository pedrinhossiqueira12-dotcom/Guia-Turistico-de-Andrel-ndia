# Plano Supabase — Guia Turístico de Andrelândia

**Status:** proposta para revisão; **nenhuma mutação foi executada**. A inspeção abaixo foi somente leitura em 2 de outubro de 2026. Não foram aplicados SQL/DDL, alterações de RLS, deploy de Edge Function, gravações em Storage, agendamento ou exclusões.

> **Atualização posterior — Catálogo Digital (02/10/2026):** a frase de status acima descreve somente o plano de manutenção anterior deste documento. Em execução separada e autorizada, foi aplicada a migração `catalogo_digital_20261003000000` e implantadas `catalogo-admin` v1 e `storage-cleanup` v2. O restante do plano histórico abaixo (metadados de publicação, fluxo de arquivamento anterior, etc.) não foi aplicado por esta atualização. O frontend do catálogo ainda não foi publicado; não houve Pix, execução manual da reconciliação nem exclusão física de objetos.

## 1. Projeto e fontes inspecionadas

- Repositório indicado: [Guia-Turistico-de-Andrelândia](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia).
- Projeto Supabase correspondente ao ref encontrado no site: `xdmbkflufsfqziixzpxc`, região `sa-east-1`, estado `ACTIVE_HEALTHY`.
- Fonte de Edge Function: `whatsapp-bot`, versão implantada 41. O código foi lido, mas **não foi invocado nem alterado**. Ele grava arquivos JSON diretamente na branch `main` do GitHub quando certas ações são executadas; não fiz nenhuma dessas chamadas.
- O conector informa lista de migrações vazia. Isso não prova que nunca houve mudanças manuais, apenas que não há migrações registradas por essa ferramenta.

## 2. Achados concretos da inspeção

### Banco, estados e RLS

| Área | Estado observado | Consequência para a implementação |
|---|---|---|
| `public.cadastros_comercios` | RLS ligado; 1 registro, status `aprovado`; contém estados de fluxo como `em_andamento`, `pendente`, `aprovado` e `rejeitado`; `local_id` do registro existente é nulo. Não é um catálogo completo de estabelecimentos. | Não é seguro tratá-la como tabela de todos os comércios publicados. Seu status representa o fluxo de solicitação/aprovação. O código atual tenta gravar `deletado`, mas o `CHECK` observado não permite esse valor. |
| `public.mural_cadastros` | RLS ligado; 2 registros: 1 `aprovado`, 1 `deletado`. A constraint já permite `pendente`, `aprovado`, `recusado` e `deletado`. | É a tabela de cadastro e estado dos perfis. A nomenclatura atual difere do padrão solicitado (`ativo`/`rejeitado`). |
| Catálogo de comércios | Não existe uma tabela pública de comércios publicados entre as tabelas `public` listadas. O catálogo publicado vem de `DATA/comercios.json`. | Recomendo uma tabela separada de **metadados de publicação** para persistir `status` e `destaque` de todos os IDs sem misturar catálogo com solicitações pendentes. |
| RLS de `cadastros_comercios` | As políticas de leitura/atualização administrativa usam um UUID de administrador fixado na política; o envio autenticado é condicionado ao dono. | Antes de criar política equivalente, será necessário confirmar, sem exibir o segredo, que esse administrador corresponde ao `ADMIN_USER_ID` usado pela Edge Function. |
| RLS de `mural_cadastros` | Leitura anônima condicionada a `status = 'aprovado'`; usuário pode inserir e editar o próprio perfil enquanto pendente. Existe também política de `DELETE` físico do próprio cadastro pendente. | Na padronização proposta, a leitura pública passa a exigir `ativo`; a política de `DELETE` físico do usuário é removida, pois a exclusão passa pela ação autenticada que marca `deletado`. |
| Avaliações e votos | RLS ativo; leitura pública/anônima; 6 avaliações e 2 votos no momento da consulta. | Mantêm-se as avaliações. Elas só influenciam a posição dentro do grupo destacado; não reordenam os demais. |

### Edge Function e comportamento atual

- `whatsapp-bot` está ativa e aparece com `verify_jwt = false`, compatível com o endpoint de webhook do WhatsApp. O código implementa verificação explícita do JWT e do administrador para as ações administrativas e confere o proprietário nas ações de usuário. A proposta mantém essa configuração global e preserva essas verificações.
- Ações já existentes: `excluir_comercio`, `excluir_mural`, `excluir_meu_comercio` e `excluir_meu_mural`. Não existe ação de destaque no código implantado.
- As rotinas atuais de exclusão removem o item do JSON do GitHub com `splice`. Depois tentam marcar o registro no Supabase como `deletado`. Para comércios, isso conflita com a constraint de `cadastros_comercios`; no fluxo do proprietário há resposta de erro depois da remoção do JSON. Para perfis, o status `deletado` é permitido no banco, mas o item também é removido do JSON, então o histórico do painel que usa esse snapshot pode se perder.
- O código de aprovação/edição grava em `DATA/comercios.json` ou `DATA/pessoas.json` na branch `main`. Não invocar a função em produção para testes: uma chamada válida pode alterar o site/repositório.
- O patch local usa ações explícitas `marcar_*_deletado`, ainda inexistentes no backend implantado. Mantê-las evita que o novo frontend invoque, antes do deploy, os endpoints legados `excluir_*`, que hoje removem itens fisicamente do JSON. A próxima Edge Function adicionará as ações `marcar_*_deletado` e converterá também os aliases legados `excluir_*` para arquivamento lógico. `atualizar_destaque_comercio` também será uma ação nova.

### Storage e automação

- Buckets encontrados: `cadastros` e `mural-imagens`; ambos estão marcados como públicos, sem limite de tamanho nem lista de MIME types configurados.
- Inventário agregado: 68 objetos — 63 em `cadastros` e 5 em `mural-imagens`. Não foi feita comparação objeto a objeto com as referências, portanto **ainda não existe relatório de órfãos**.
- RLS de `storage.objects` inclui leitura pública de `mural-imagens`, exclusão de arquivos da própria pasta de usuário nesse bucket e upload autenticado no bucket `cadastros`. Não foi encontrada rotina de remoção de Storage no código da Edge Function.
- Não foi encontrada a relação `cron.job` nem a extensão `pg_cron`; também não foram encontrados triggers de aplicação nas tabelas `public` (as triggers listadas pertencem à manutenção interna do Storage). Portanto, a limpeza agendada ainda não está configurada.

### Avisos existentes do Supabase

- Segurança: proteção contra senhas vazadas está desativada. [Documentação Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Performance: 9 políticas RLS foram sinalizadas por reavaliar chamadas de `auth.*` por linha; a recomendação do advisor é encapsular a chamada como `(select auth.uid())`. [Documentação](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select).
- Performance: 6 índices aparecem como não usados no período observado. Nenhum desses avisos será alterado por este plano.

## 3. Plano de implementação proposto

### Etapa 0 — coordenar publicação, sem mudar produção

1. Finalizar localmente o patch web; manter as novas ações de arquivamento em modo fail-closed até o backend compatível existir.
2. Rodar testes e revisar o diff. O patch local atual não foi enviado ao GitHub e nenhuma publicação do site está incluída nesta autorização.
3. **Não mudar o backend de produção antes que o site público que filtra `status` esteja publicado.** A versão atual do site pode ignorar `deletado`; ativar a exclusão lógica no backend antes do filtro público criaria inconsistência visível.

### Etapa 1 — esquema e dados de comércios publicados

Criar `public.comercios_publicados`, uma tabela pequena de metadados por ID público (`local_id` como chave), sem duplicar nome, descrição ou fotos do catálogo. Colunas propostas:

- `local_id text PRIMARY KEY`;
- `status text NOT NULL CHECK (status IN ('pendente','ativo','rejeitado','deletado'))`;
- `destaque boolean NOT NULL DEFAULT false`;
- `criado_em`, `atualizado_em`, `deletado_em` (`timestamptz`);
- `atualizado_por uuid` referenciando o administrador autenticado, quando aplicável.

Ativar RLS. Permitir leitura pública somente de linhas `ativo`; permitir ao administrador ler todos os estados e alterar `status`/`destaque`; não permitir `INSERT`, `UPDATE` ou `DELETE` por usuário comum. A Edge Function continua validando administrador no servidor e nunca expõe a chave privilegiada ao navegador. Nenhuma exclusão física de linha será usada.

Popular a tabela a partir dos IDs do catálogo publicado revisado, preservando o estado pendente de qualquer rascunho. O working tree local, após a implementação web, contém 139 registros (138 `ativo`, 1 `pendente`, todos com destaque inicialmente falso); esses números são **da cópia local**, não uma leitura do GitHub remoto nem do banco. Antes do seed, comparar a lista de IDs com a versão que será publicada para não inserir exemplo/rascunho por engano.

`cadastros_comercios` permanece como fluxo de solicitação (inclusive o estado de conversa `em_andamento`); não será usado como catálogo completo nem receberá `deletado` para simular a exclusão de um comércio publicado. O único registro atual aprovado sem `local_id` será ligado ao ID público pelo mesmo fallback de slug já usado pela Edge Function, e essa associação será verificada antes do rollout.

### Etapa 2 — status de perfis e RLS

1. Em `mural_cadastros`, migrar `aprovado → ativo` e `recusado → rejeitado`; manter `pendente` e `deletado`. Atualizar a constraint para aceitar exatamente `pendente`, `ativo`, `rejeitado`, `deletado`.
2. Atualizar as políticas de leitura pública/própria para `ativo`, preservando a edição do próprio perfil enquanto `pendente`.
3. Remover a política que permite `DELETE` físico direto do próprio cadastro pendente. A ação autenticada existente passa a marcar `deletado`, verificando proprietário ou administrador.
4. Atualizar em conjunto Edge Function, `mural.js`, `pessoa.js` e painel administrativo para não deixar consumidores usando `aprovado`/`recusado` após a migração.

### Etapa 3 — Edge Function e contratos

1. Adicionar as ações `marcar_comercio_deletado`, `marcar_mural_deletado`, `marcar_meu_comercio_deletado` e `marcar_meu_mural_deletado`. Preservar os contratos legados `excluir_comercio`, `excluir_mural`, `excluir_meu_comercio` e `excluir_meu_mural` como aliases seguros. Todas devem atualizar estado e preservar o registro/linha no histórico; nenhuma deve remover itens com `splice`.
2. Comércios: atualizar `comercios_publicados.status` para `deletado`; manter a entrada no JSON com esse status. A exclusão de proprietário só pode atingir seu próprio comércio e não pode ativar ou editar registros de terceiros.
3. Perfis: atualizar `mural_cadastros.status` e a entrada correspondente de `pessoas.json` para `deletado`; o painel administrativo mantém o histórico.
4. Aprovação de perfil grava `ativo`; aprovação de comércio cria/ativa metadados com `destaque = false`; aprovação/rejeição de solicitações continua usando o fluxo atual.
5. Adicionar `atualizar_destaque_comercio`, restrita ao administrador, validando ID e booleano. `comercios_publicados` será a fonte canônica de `status`/`destaque`; a Edge Function também atualizará o campo correspondente em `DATA/comercios.json`, porque o index e o painel administrativo leem esse JSON. Só informar sucesso depois de confirmar as duas atualizações; se uma delas falhar, reportar explicitamente o estado de cada lado e permitir reconciliação/retry antes de declarar a alteração concluída. A edição normal não poderá alterar `status` ou `destaque` por campos arbitrários enviados pelo navegador.
6. O mesmo contrato de sincronização vale para arquivamento e aprovação: Supabase e JSON precisam refletir o mesmo estado; no arquivamento, fotos são desreferenciadas em ambos. A Edge Function atualiza arquivos na branch `main`; não executar ações válidas de escrita em produção como teste. Usar mocks/testes ou ambiente de teste, e manter feedback claro para falha/estado parcial.

### Etapa 4 — Storage órfão e retenção

Criar `public.storage_cleanup_queue` com chave única `(bucket_id, object_name)` e campos `first_unreferenced_at`, `last_checked_at`, `attempts` e `last_error`; RLS ligada e sem acesso público. Criar uma Edge Function separada `storage-cleanup`, com JWT obrigatório para invocação agendada e credenciais apenas no servidor.

Ao arquivar, a Edge Function remove as referências às fotos no JSON e nos campos correspondentes do cadastro, preserva os demais dados históricos e verifica se cada objeto ainda é usado por outro registro. Para cada objeto realmente sem referência, insere imediatamente uma linha na fila com `first_unreferenced_at` igual ao instante em que deixou de ser referenciado. A varredura horária também reconcilia objetos em `DATA/comercios.json`, `DATA/pessoas.json`, `cadastros_comercios` e `mural_cadastros`: considera somente URLs/caminhos dos buckets do projeto, ignora arquivos externos/locais, remove da fila o que voltou a ser referenciado e faz uma última verificação após 7 dias corridos. Qualquer exclusão aprovada será feita pelo Storage API, nunca com `DELETE` SQL em `storage.objects`.

**Escolha aprovada pelo usuário:** ao arquivar comércio ou perfil, remover as referências às fotos do JSON publicado e dos campos correspondentes no Supabase; manter os demais dados e o registro histórico. Os objetos tornam-se candidatos à fila apenas quando nenhuma outra entrada ativa/pendente/rejeitada ainda os referencia. A janela de 7 dias começa na primeira varredura que confirma a ausência; reutilização durante o período cancela a exclusão programada.

Como `pg_cron` não está presente, será necessário habilitar/configurar o mecanismo de agendamento do Supabase (`pg_cron`/`pg_net` ou recurso agendado equivalente). A execução inicial será **dry-run**, com relatório dos caminhos candidatos e sem remover arquivos. A ativação da exclusão física de imagens exige confirmação separada, após revisão desse relatório. Frequência proposta: uma execução por hora.

## 4. Ordem segura de rollout

1. Finalizar e validar o patch local; alinhar os nomes das ações existentes.
2. Publicar primeiro o frontend que filtra apenas `ativo` e mantém histórico no painel. Não foi feito push/PR ao GitHub.
3. Só após a compatibilidade do site estar garantida, aplicar a migração/RLS e seed revisados; publicar versão nova de `whatsapp-bot` preservando `verify_jwt = false` pelo webhook e suas validações internas.
4. Implantar `storage-cleanup` em dry-run e revisar o relatório de órfãos.
5. **Não ativar purga permanente de Storage sem uma nova confirmação explícita.**

## 5. Autorização e gates restantes

O usuário aprovou condicionalmente este plano: **publicar primeiro o frontend; depois aplicar DDL/RLS/seed e deploy conforme descrito; ao arquivar, remover as referências às fotos e colocá-las na retenção de 7 dias; não ativar a purga permanente**. Ainda não foi feita nenhuma escrita remota. O deploy/DDL em produção só ocorrerá depois de confirmado que a versão compatível do frontend está publicada. O frontend não foi enviado ao GitHub nesta sessão.

A exclusão física automática de objetos do Storage continua bloqueada e exigirá uma confirmação explícita separada, após o relatório dry-run dos caminhos candidatos. A escolha de remover referências ao arquivar não constitui autorização para executar essa purga.

## Fontes

- Repositório do site: https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia
- Projeto Supabase consultado por operações MCP somente leitura: ref `xdmbkflufsfqziixzpxc`.
- Definições lidas: tabelas/colunas e constraints, `pg_policies`, buckets, agregados de status, triggers, migrations, advisors e código da Edge Function `whatsapp-bot` v41. Nenhum conteúdo secreto foi incluído neste documento.
