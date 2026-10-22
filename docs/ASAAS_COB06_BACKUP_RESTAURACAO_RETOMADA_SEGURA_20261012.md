# COB-06 — backup, restauração e retorno seguro sem perda financeira

## Revisão estática do bloqueio Vault — 22/10/2026, SEM NOVA TENTATIVA

A primeira tentativa real permanece **BLOQUEADA**; nenhuma execução, nova leitura do backup, conexão remota, manipulação de Secrets, criação de recurso ou retry foi autorizada ou realizada nesta revisão. **CI do commit documental `f8e19e2`: [39714284928](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/39714284928), 12/12 PASS**; isso não prova restauração.

- **Causa observada:** `schema-sem-cron-net.sql`, linha 44, `CREATE EXTENSION supabase_vault` falhou com `3F000` porque o schema alvo `vault` não existia no bootstrap. O [controle oficial da extensão Vault](https://github.com/supabase/vault/blob/main/supabase_vault.control.in) declara `schema = vault`; a [documentação oficial de instalação](https://github.com/supabase/vault/blob/main/README.md#installation) confirma `supabase_vault` como extensão, não mero schema. Esses arquivos públicos não comprovam a **versão/compatibilidade efetiva da extensão instalada** na imagem PostgreSQL 17.6 local.
- **Próximo preflight seguro (sem executar):** revisar controle/versão instalados localmente, owners e ACL esperados, dependências criptográficas de `pgsodium`, política de não executar funções de decriptação, e presença/ausência de `vault.secrets` nos dados de entrada por inspeção **privada, sem imprimir conteúdo**. Conferir se criação prévia do schema `vault` vazio e posterior extensão na versão compatível satisfaz o DDL sem ampliar permissões ou iniciar executor externo. **Não instalar automaticamente, não criar stubs e não remover dependências financeiras/segurança para forçar sucesso.**
- **Chave criptográfica é gate independente:** [Supabase Vault — key portability](https://supabase.com/docs/guides/database/vault#key-portability-and-migration) explica que `pg_dump` manual não leva a chave raiz necessária à leitura de segredos Vault criptografados originados em outro projeto. **Não consultar/transferir a chave raiz, Secrets, nem tentar decriptar dados reais nesta fase.** Se houver dependência de segredos históricos, manter recuperação criptográfica **NÃO COMPROVADA** e planejar custódia/reativação sob autorização distinta; não confundir extensão instalada com segredos recuperados.
- **Autorização:** a tentativa anterior foi consumida e parou no primeiro erro, conforme instruído. Qualquer nova importação em recursos locais novos exige autorização explícita, com `pg_cron`/`pg_net` neutralizados antes do bootstrap. Preservar os sete originais, todos os recursos existentes e o disco E: sem acesso. **COB-06 HOLD.**

## Tentativa SQL real autorizada — 21/10/2026, 23:54 BRT — BLOQUEADA

**Resultado: BLOQUEADA no primeiro pré-requisito de bootstrap não atendido.**
COB-06 permanece HOLD. Autorização do proprietário nesta rodada: cópias privadas
dos sete SQLs e uma tentativa local em recursos novos, sem rede, Storage físico,
Edge, dados/SQL remotos ou operações financeiras. Base limpa e sincronizada:
`7a01ec854d1ebfc1f123b7ed80ca01ca770e6072`, PR #39 aberta/Draft.
Não houve repetição das provas sintéticas, dos 143 hashes ou do clone histórico.

### Primeiro bloqueio e parada

Na cópia controlada `schema-sem-cron-net.sql`, **linha 44**, a declaração
de criação da extensão **supabase_vault**, destinada ao schema **vault**, retornou
**SQLSTATE 3F000 (schema inexistente)**. O bootstrap novo havia preparado auth,
storage e extensions; o pré-requisito vault não estava preparado.
O erro ocorreu na fase DDL, antes de qualquer carga de registros de produção.

A transação desse arquivo foi revertida por psql com `ON_ERROR_STOP` e
`--single-transaction`. A execução foi interrompida; **não se criou o schema
faltante, não se alterou a extensão e não se refez a importação**. Não foram
usadas permissões adicionais para contornar o erro.

| Arquivo/cópia | Estado desta tentativa |
| --- | --- |
| roles.sql | Executado uma vez; configurações de timeout e GRANT de parâmetro sobre papel técnico NOLOGIN preparados no banco novo. Não representa reconstrução comprovada de todos os atributos/memberships reais. |
| history_schema.sql | Executado uma vez; estrutura histórica vazia mantida no novo volume. |
| schema.sql | Original e cópia-base preservados. Derivada controlada omitiu somente duas declarações de criação de extensão: pg_cron e pg_net. Aplicação da derivada interrompida em supabase_vault, com rollback integral desse arquivo. |
| data.sql | Não executado. Fonte única de dados escolhida para a tentativa. |
| auth_data.sql | Conferido em leitura; não executado, para evitar duplicidade. |
| storage_metadata.sql | Conferido em leitura; não executado, para evitar duplicidade. Nenhum objeto físico foi acessado. |
| history_data.sql | Não executado. |

**Nenhum COPY de dados de produção foi executado.** Integridade referencial dos
registros reais, estados financeiros/MP, identidades, sequências, owners/ACL/RLS
de negócio e consistência dos dados Auth/Storage **não foram aprovados** nesta
rodada. A preparação do banco e a compatibilidade estrutural não substituem carga
e validação completas. Não classificar como restauração parcial aprovada.

### Segurança e compatibilidade comprovadas antes da carga

- D: `FullyEncrypted`, BitLocker `On`, 100%. Docker configurado em
  `D:\DockerDesktopWSL`; presença de `disk\docker_data.vhdx` e `main\ext4.vhdx`
  conferida apenas por metadados, sem montar/ler os discos ou alterar configurações.
- Sete cópias integrais em diretório novo privado de D:, fora do repositório.
  ACL protegida, somente usuário local e SYSTEM; cópias, scripts, temporários e
  logs com zero entrada inesperada de acesso. Nenhum bind privado no Docker.
- Os sete originais foram comparados byte a byte com as cópias-base após a
  tentativa: **7/7 inalterados**. Não foram repetidos hashes de 143 arquivos.
  Dumps, scripts derivados, manifestos detalhados e logs ficaram exclusivamente
  no diretório privado; nenhum desses artefatos é versionado ou enviado ao GitHub.
- Origem dos dumps: cabeçalhos PostgreSQL/pg_dump 17.6. Destino escolhido:
  PostgreSQL 17.6, imagem oficial fixada já disponível. Produção atual não foi
  consultada; não se presume sua versão atual a partir do snapshot.
- Bootstrap Auth/Storage realizado somente no banco vazio com as imagens abaixo.
  Tabelas e colunas dos 26 blocos Auth e cinco Storage confrontadas; zero coluna
  ausente/gerada indevidamente ou campo obrigatório novo sem default nesse teste.
  As duas APIs foram paradas antes da fase SQL real e não foram reiniciadas.
- Banco `network=none`, única interface lo, IPv4 sem rotas e IPv6 somente
  loopback/rejeição em lo. Auxiliares compartilharam exclusivamente seu namespace.
  Zero porta publicada, bridge/host/proxy/túnel, socket Docker ou mount privado.
  `privileged=false`, cap-drop ALL, no-new-privileges, rootfs read-only, tmpfs local,
  `restart=no`. PostgreSQL executado como postgres, Storage bootstrap como node.
- Preload vazio desde o primeiro boot, sem pg_cron/pg_net instalados ou workers
  correspondentes. Bootstrap não importou Vault/Secrets reais, jobs, SMTP,
  webhooks, Edge ou provedores. Logs do servidor configurados para não registrar
  SQL/valores de erros comuns; stderr de cliente permaneceu em log privado.
- A leitura estática não encontrou event triggers ou comandos psql nos arquivos.
  A referência a vault.decrypted_secrets foi identificada como dependência de
  função armazenada; nenhuma função financeira/decriptação foi invocada.
- Os 26 blocos Auth e cinco Storage dos auxiliares coincidem com data.sql em
  colunas, quantidade e conteúdo, comparado em memória sem imprimir linhas.
  Estratégia escolhida: data.sql uma única vez, auxiliares não executados,
  history_schema/history_data separados. Sem concatenação dos sete dumps,
  ON CONFLICT ou filtros indiscriminados de SQL.
- Neutralização por fronteiras léxicas de statements: somente duas declarações
  CREATE EXTENSION omitidas na derivada. Tokens/corpos dos statements retidos
  conferidos; nenhuma constraint, trigger, policy, RLS ou GRANT/REVOKE removido.
  A configuração de session_replication_role da cópia de dados foi identificada,
  mas **não executada**, porque a carga de dados não foi iniciada.

Antes de qualquer arquivo real, a consulta auxiliar de metadados de extensões
teve erro de operador name[]/text[] (42883). Corrigido somente o cast do verificador,
com prova de zero arquivos reais executados naquele ponto. Esse diagnóstico está
no log privado; não houve reexecução de arquivo real após a falha DDL 3F000.

### Imagens e recursos novos preservados

Sem downloads; todas iniciadas por ID imutável com `--pull=never`.

| Imagem oficial / versão | ID local = RepoDigest SHA-256 |
| --- | --- |
| public.ecr.aws/supabase/postgres:17.6.1.166 | `sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86` |
| public.ecr.aws/supabase/gotrue:v2.197.0 | `sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b` |
| public.ecr.aws/supabase/storage-api:v1.79.28 | `sha256:1f6c99d3952d78d57129802aa2ae8a80d75e327492cf24742fd0aeaf90967b96` |

Execução/label: `cob06-real-sql-20261022023846483-ff8e90` /
`guia.cob06.real-sql`. Nome = prefixo da execução + sufixo abaixo.

| Sufixo | ID completo | Estado final |
| --- | --- | --- |
| pg | `5f1af6d95c0542a1ef07c210bd363a941cee965907e26de736abf9b972feac9e` | exited / 0 |
| auth-bootstrap | `3486edcfa98e9a1d451852dfa1784b14c1f8670178c58a83d6c640a3dc58d27a` | exited / 0 |
| storage-bootstrap | `7d8b42a449e30a83db7ecd2b9dfa4e75325721ae655c6f906d9d620392bf083a` | exited / 0 |

Um volume novo: `cob06-real-sql-20261022023846483-ff8e90-pgdata`.
Todos os três contêineres parados; volume mantido. Zero recurso removido.
**38 contêineres, 18 volumes e quatro redes preexistentes preservados**; nenhum
start/exec no clone histórico ou nos ensaios anteriores. O destino conserva
somente bootstrap gerenciado e preparações que haviam sido confirmadas antes
do arquivo DDL revertido; não conserva carga de registros reais.

### Pendências e próximo passo condicionado

Revisar o bootstrap da dependência Vault e seus requisitos de schema, owner,
extensão e privilégios, sem Secrets produtivos ou executores de rede. Depois,
será necessária autorização para **nova tentativa**, pois esta foi limitada a
uma carga e parada no primeiro erro. Não retomar automaticamente o volume nem
criar outro destino para contornar essa parada.

Continuam pendentes todas as verificações de dados/ACL de origem após carga,
Auth funcional sem login em contas reais, Storage físico e Edge (estes dois
últimos fora da autorização desta rodada). Os sete dumps não fornecem por si
só prova de todos os atributos/memberships reais nem do DDL/ACL gerenciado
histórico; a comparação de colunas não fecha essa lacuna.

Registro público limitado a este runbook e à backlog. Sem nova suíte de código:
alteração documental; diff conferido. Reutilizada a [CI 12/12 da base 7a01ec8](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/39710358835),
sem reexecutar provas aceitas. **COB-06 HOLD; nenhuma autorização de implantação,
COB-07/08, cobrança, Pix, saque ou merge resulta desta preparação.**

**Atualização efetiva: 21/10/2026.** Os sete dumps SQL originais e os 128 objetos físicos Storage já foram exportados e conferidos pelo operador; o pacote `.7z` com criptografia AES-256 no disco E: foi testado mediante extração em D: criptografado. **143/143 arquivos** extraídos conferidos por SHA-256 com seus originais, com **128 objetos e 133855024 bytes de Storage**. O disco E: é um segundo disco físico. **Em 21/10/2026, o operador declarou: `Backup guardado fora do computador`.** Essa declaração é registrada como confirmação operacional de guarda externa **sob a condição de que a mídia que contém o `.7z` esteja de fato fisicamente fora do computador** (não apenas em E: ainda conectado). A confirmação é declaratória: não houve verificação física independente, nem confirmação sobre guarda separada da senha. Foi efetuado ensaio anterior do SQL no clone isolado com rollback, mas **não** uma restauração integral de serviços externos/Edge/configurações. PR #39 Draft e COB-06 HOLD. Evidência detalhada em [ASAAS_COB06_EVIDENCIA_RECUPERACAO_ARQUIVOS_20261021.md](ASAAS_COB06_EVIDENCIA_RECUPERACAO_ARQUIVOS_20261021.md).

## Recuperação funcional entre dois clusters independentes — 21/10/2026, 23:12 BRT

**Resultado: APROVADO no escopo exclusivamente sintético. COB-06 permanece HOLD.**
Base `1e0d3a91bd74b16d745f624c098279c0e041c9c5`, árvore limpa,
fetch/fast-forward sem mudanças, PR #39 aberta/Draft. As provas anteriores
48/48, 35/35, 143 hashes e nove SQLs históricos não foram reexecutadas.
Nenhum dump privado em D:/E:, clone histórico ou projeto Supabase remoto foi
aberto/usado. Nenhuma alteração de Secret/flag, operação financeira, deploy ou merge.

Runner específico: [asaas-cob06-recuperacao-dois-clusters-sinteticos.cjs](../scripts/validacao-pagamentos/asaas-cob06-recuperacao-dois-clusters-sinteticos.cjs).
Aceita somente `--execute-synthetic`, sem parâmetros para backups/recursos existentes.
A execução foi concluída em fases sobre os recursos desta rodada, após correções
do harness descritas abaixo. O script consolidado teve sintaxe/guardas conferidas;
não foi feita nova execução integral para repetir os resultados ou criar mais volumes.
Os comandos de continuação usaram IDs/labels exatos desta execução; isso não
autoriza retomar outros recursos. Nenhum relatório contém dump, senha ou token.

### Independência e isolamento demonstrados

- Execução: `cob06-2pg-20261022015521627-543e4d`.
- Dois `initdb` independentes: system identifiers origem
  `7699304938800402455` e destino
  `7699304979478794257`, diferentes e preservados nas retomadas.
- Quatro volumes novos distintos: PGDATA e arquivos da origem separados dos do
  destino. Nenhum volume montado simultaneamente pelos dois clusters; transferência
  lógica por buffers em memória no host, sem arquivos de backup no workspace.
- Ambos os PGs em `network=none`; serviços compartilham exclusivamente o namespace
  do respectivo PG, nunca o do outro cluster. Namespaces distintos comprovados.
  Somente interface `lo`, zero rotas IPv4, IPv6 apenas loopback/rejeição em `lo`.
  Origem totalmente parada antes da restauração/validação do destino.
- Sem publicação de portas, bridge/host networking, saída externa, binds privados,
  socket Docker ou proxies. `restart=no`, `privileged=false`, `cap-drop=ALL`,
  `no-new-privileges`, rootfs read-only e tmpfs local.
- Administrador PostgreSQL somente por socket local `/tmp`; conexões TCP de
  aplicação com SCRAM e senhas fictícias diferentes entre os clusters.
  Nenhum serviço recebeu superuser/CREATEROLE/CREATEDB/REPLICATION.
  `service_role` tem BYPASSRLS intencional do bootstrap; testes de usuários usam
  exclusivamente `authenticated`/anon, nunca esse papel administrativo.
- Preload vazio, extensões Cron/pg_net/Vault ausentes. Filas/workers Storage,
  transformação de imagens, lifecycle, S3 e telemetria desabilitados; sem webhooks.
  Nenhuma função financeira ou migration produtiva importada.
- Coleta final: listeners 5432/9999/3000 em 127.0.0.1, zero IPv6. Storage 5000
  respondeu no loopback na fase funcional; a última coleta ocorreu durante seu
  reinício e não listou essa porta. Não houve teste de conectividade externa.

### O que foi reconstruído e comprovado

O destino começou sem os oito papéis da allowlist. Foram reconstruídos atributos,
memberships ADMIN/INHERIT/SET e search_path sem importar hashes/senhas. Owners e
privilégios são comparados por nome, não por OID. Auth e Storage das mesmas imagens
bootstraparam schemas vazios no destino antes da importação. Seus serviços ficaram
parados na carga; históricos de migrations gerenciadas do bootstrap não foram
sobrescritos. Os SQLs de exportação são gerados exclusivamente dos fixtures novos.

| Controle | Evidência final |
| --- | --- |
| Papéis | Atributos, settings e memberships iguais entre clusters independentes; senha TCP nova no destino. Papéis fixture_owner/fixture_reader NOLOGIN; authenticator sem superuser. |
| Owners e ACL | Comparação completa de schemas, relações e funções em auth/storage/api; GRANT/REVOKE, grantors e default ACLs conferidos. Ordem dos itens de ACL de função normalizada, preservando diferença NULL/ACL vazia. |
| Funções/RLS | Definições, SECURITY INVOKER, policies, RLS/force RLS e constraints iguais. EXECUTE autorizado como authenticated; anônimo recusado. DELETE explicitamente revogado permanece recusado. |
| Integridade | Contagem de todas as tabelas gerenciadas igual (exceto históricos de migrations mantidos do bootstrap); dois registros de aplicação preservados. Zero órfãos em aplicação/usuários, identities/usuários, sessions/usuários e objects/buckets. FK rejeitou inserção órfã; triggers reativadas, constraints validadas. |
| Auth no destino | Login novo de dois usuários exportados da origem, com a mesma senha fictícia e mesmos IDs; JWTs emitidos pelo GoTrue do destino. Não se limitou a reutilizar JWT da origem. |
| PostgREST no destino | Ambos leem apenas sua linha recuperada; função retorna papel authenticated; A não altera B, não transfere owner para B; anônimo sem leitura, DELETE e EXECUTE indevidos recusados; conteúdo permanece intacto. |
| Storage independente | Um bucket privado e um arquivo fictício recuperados. Metadados por dump lógico e bytes copiados para volume próprio, igualdade dos bytes conferida em memória. A lê com JWT novo do destino; B é recusado. Não há mount de origem no serviço de destino. |
| Default ACL efetiva | Configuração global reconstruída antes da verificação. Nova função criada como fixture_owner em transação: authenticated tem EXECUTE, anon não tem; função de prova revertida. |
| Preservação/parada | 26 contêineres e 14 volumes preexistentes preservados, inclusive IDs, imagens, estado, rede e mounts. Todos os 12 contêineres novos parados; nenhum recurso removido. |

As 12 verificações funcionais finais do destino passaram. O registro técnico da
rodada consolidou **91 nomes distintos de verificações aprovadas entre as fases**,
incluindo guardas, comparações e retomadas; não são 91 cenários independentes nem
uma reexecução da suíte anterior de 48. Falhas intermediárias foram preservadas
como diagnóstico e corrigidas pontualmente; não foram reinterpretadas como PASS.

### Correções locais e limites da prova

1. Dump seletivo de `api` não transporta GRANTs externos sobre `auth`.
   Reconstruídos USAGE para fixture_owner e REFERENCES em auth.users; reimportado
   somente o schema fictício api no destino, mantendo os dados Auth/Storage.
   O runner consolidado prepara esses GRANTs antes da importação.
2. O entrypoint original da rodada tentava initdb novamente ao reiniciar.
   Os dois contêineres PG originais ficaram parados com exit 1; PGDATA preservado.
   Foram necessários dois processos PG substitutos, serviços de destino
   correspondentes e um leitor read-only dos arquivos sintéticos. Usaram os
   mesmos quatro volumes novos desta rodada; zero novos clusters/volumes nas
   retomadas. A guarda de PG_VERSION foi incorporada ao runner.
3. ACL da função tinha os mesmos itens em ordem diferente após pg_restore.
   Comparação passou a ordenar itens, mantendo privilégios/grantors e NULL.
4. Classificação da recusa RPC foi corrigida: ausência de EXECUTE pode produzir
   401/403 ou função oculta 404. A coleta explícita final foi **401 / SQLSTATE
   42501**, junto de has_function_privilege(anon)=false; RPC autenticada respondeu.
5. O fixture revogava default EXECUTE apenas no schema. Isso não remove o grant
   global a PUBLIC. Corrigida a configuração global de fixture_owner na origem,
   exportada por allowlist e reconstruída no destino. Catálogos novamente iguais
   e teste de criação de função aprovado. A conclusão vale para esse fixture;
   não foi identificada/alterada uma configuração de produção.
6. Relatórios transitórios não serão versionados separadamente; os IDs,
   resultados, limitações e diagnósticos sanitizados estão nesta seção.

Fontes oficiais: [pg_dump não inclui objetos globais como roles](https://www.postgresql.org/docs/17/app-pgdump.html),
[memberships PostgreSQL 17](https://www.postgresql.org/docs/17/sql-grant.html) e
[default privileges globais e por schema](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).
A consulta ao índice changelog Supabase retornou erro de content-type; não houve
atualização de versão. Foram reutilizadas as configurações oficiais das imagens
fixadas já verificadas na prova anterior.

### Imagens e recursos desta rodada

Sem downloads. Mesmas imagens oficiais já locais, todas com `--pull=never`:

| Serviço / versão | ID local = RepoDigest SHA-256 |
| --- | --- |
| public.ecr.aws/supabase/postgres:17.11.0.002 | `sha256:0450166354dc9c1d25f0322ac8b580774d4fb0184d2b087f6e4fe9499c66cf53` |
| public.ecr.aws/supabase/gotrue:v2.197.0 | `sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b` |
| public.ecr.aws/supabase/storage-api:v1.79.28 | `sha256:1f6c99d3952d78d57129802aa2ae8a80d75e327492cf24742fd0aeaf90967b96` |
| postgrest/postgrest:v14.18 | `sha256:c7cd7e265a85b05248abf53f4473fcec7e327c282d0bd0cf60f1551996d09fcf` |

Nome: prefixo da execução acima + `-<papel>`. Label
`guia.cob06.two-clusters=cob06-2pg-20261022015521627-543e4d`.

| Papel | ID completo | Estado / exit |
| --- | --- | --- |
| `source-pg` | `c7ee95d0e51d89ab2ff146517f8fa921d725996cbc800b4097d30a711a5193da` | exited / 1 |
| `source-auth` | `47ba6d7dc463794eb550abf3a07f0c220ff1d93ded47769371c83e210b22183c` | exited / 0 |
| `source-storage` | `60a8a5428082c9ac99fe74adbfb4888c87afb9b078ba7fc629c1c1957c36ef44` | exited / 0 |
| `target-pg` | `45192ca4f230edf966b82844c17b760afb06cad7d710dbbba23a891e58d4a8df` | exited / 1 |
| `target-auth` | `7e644f5d04b44fad911d669868dadf8009ea82eaf14272ff0ef08d10c2d1047b` | exited / 0 |
| `target-storage` | `88cddefa8f68d83fa72faa00d7392c447668f707cf1c1cb59da103c30a51a85a` | exited / 0 |
| `source-pg-recovery` | `02960de0bb144e24405333aa58fcc5162aff5e170213355c7c1cc5e70f3e871d` | exited / 0 |
| `target-pg-recovery` | `47d282c20125550cdddd7427d41e6e2e1ed1fa74c2aba5ec39fc262bfaaae1f6` | exited / 0 |
| `source-file-export` | `6fe5b10a78918ae6b560264212c4080a0257d469cda7c619d4f0440f0baa28a8` | exited / 0 |
| `target-auth-recovery` | `284c946d86e2d86fcd9ff3834ba4b2a61ce09acb8682f0c8375d9987eef6d010` | exited / 0 |
| `target-storage-recovery` | `ed32c195a6899c2b4dccf86d8687988e147b930ab4bc26f706438f4686911248` | exited / 0 |
| `target-rest` | `e7f22b0837b887db45a045e9b038b3bc991ef0d794af678f820ddc435c4f3d0a` | exited / 255 |

PostgREST registrou parada controlada; exit 255 não é resultado dos testes HTTP.
Os contêineres PG substitutos e serviços funcionais encerraram com exit 0.
Volumes preservados:

- `cob06-2pg-20261022015521627-543e4d-source-pgdata`
- `cob06-2pg-20261022015521627-543e4d-source-files`
- `cob06-2pg-20261022015521627-543e4d-target-pgdata`
- `cob06-2pg-20261022015521627-543e4d-target-files`

### Sequência documental dos sete dumps reais — NÃO EXECUTAR nesta autorização

Plano baseado somente no conhecimento já aceito; **nenhum dos sete arquivos foi
reaberto**, copiado, hasheado ou executado. Não concatenar dumps. A escolha abaixo
usa os auxiliares como fonte única de Auth/Storage e exige excluir esses mesmos
blocos do data.sql em cópia de trabalho futura autorizada. Alternativa válida
é usar data.sql como fonte única e omitir ambos os auxiliares; jamais combinar
as duas estratégias nem completar por tentativa após erro.

| Arquivo | Finalidade / ordem futura condicionada | Dependências e bloqueios |
| --- | --- | --- |
| roles.sql | 1 — reconciliar apenas comandos aprovados, após inventário dos papéis necessários | Não é bootstrap completo de roles/owners. Reconstruir atributos, memberships, GUCs e ACLs globais por inventário separado. Não importar passwords ou elevar privilégios automaticamente. GRANT/SET administrativos exigem revisão específica. |
| history_schema.sql | 2 — criar exclusivamente o schema/tabelas do histórico se ainda ausentes | Verificar colisões com bootstrap; apenas DDL histórico, nenhum conteúdo histórico vira migration a executar. |
| schema.sql | 3 — preparar DDL de negócio compatível com schemas gerenciados; reservar pós-dados para constraints/triggers/ACL conforme dependências | Auth/Storage e extensões seguras precisam existir. Revisar dependências entre funções, tipos e roles; preservar owners/RLS/GRANT/REVOKE/default ACL e histórico Mercado Pago. Sem aplicar candidatos 9/14 SQL. |
| auth_data.sql | 4 — fonte única da carga Auth, uma vez por tabela | Schema/colunas/constraints precisam corresponder à versão do snapshot. Não sobrescrever histórico de migrations gerenciadas do bootstrap sem compatibilidade comprovada. Não ligar GoTrue a dados reais antes de revisar migrations automáticas. |
| storage_metadata.sql | 5 — fonte única dos metadados Storage, uma vez por tabela | Auth e buckets/objetos/tipos compatíveis; ordem interna por FKs. Não contém os bytes. Recuperação do layout de arquivos e datas dos snapshots continua pendente. |
| data.sql | 6 — carregar somente tabelas de negócio não carregadas nas etapas 4/5 | Excluir em cópia futura autorizada os 26 blocos Auth e cinco Storage já identificados; mapear também qualquer histórico repetido. Não alterar originais nem fazer filtros regex sobre SQL arbitrário. Não usar ON CONFLICT para esconder duplicidade. |
| history_data.sql | 7 — carregar o histórico uma única vez após estrutura e dados correspondentes | history_schema existente; verificar compatibilidade do inventário. Preservar registros, sem executar statements históricos nem migrations pendentes. |

Antes da etapa 1: autorização específica delimitando arquivos/destino, mídia/senha
por vias independentes e destino cifrado verificado; dois níveis de contenção,
rede sem saída e executores inertes. Sem montar mídia off-host automaticamente.
Preparar papéis e schemas gerenciados conforme versões reais, não presumir que
as imagens sintéticas reproduzem o snapshot.

Antes de qualquer carga: preload sem Cron/pg_net/Vault; sem workers, jobs ativos,
SMTP, webhooks, Edge ou provedores reais. Não instalar Cron/pg_net para satisfazer
uma dependência. Se faltar tipo/função de extensão ou versão gerenciada compatível,
**bloquear a parte afetada**, revisar o tratamento e não reativar o executor.
Inspecionar metacomandos psql, conexões, COPY PROGRAM, event triggers, hooks,
ALTER SYSTEM e código de privilégio; nenhum SQL arbitrário se torna seguro apenas
por estar sem rede. Restaurar em sessão fixa, psql -X/ON_ERROR_STOP, sem log de dados.

A carga controlada pode inibir triggers somente no destino autorizado e em sessão
delimitada; isso também pode suspender FKs e não neutraliza event triggers ou
comandos de cliente. Reativar e conferir constraints/triggers, validar relações
órfãs e invariantes, owners, GRANT/REVOKE, funções e RLS após a carga. Não confiar
apenas em convalidated=true de constraints preexistentes. Separar pré/pós-dados
com revisão estrutural, preservando os originais; este documento não é instalador.

Antes de iniciar APIs: comparar contagens/invariantes e histórico MP sem alterar
pagamentos; recuperar bytes Storage para layout local correto e validar RLS.
Usar somente contas/tokens fictícios para testar o destino. Fontes Edge, import
maps/dependências e configurações não secretas precisam de equivalência revisada;
nenhuma Edge financeira deve ser iniciada. Não importar Secrets reais.

**Pendência sintética de independência dos clusters: atendida no escopo acima.**
Continuam abertos: compatibilidade dos schemas/roles/dados reais; mapa de carga
por tabela sem duplicidade; layout/consistência temporal de Storage; equivalência
de Edge/configurações; guarda independente da senha e rotina de novos backups.
Parar antes de qualquer acesso ou restauração de backup real. COB-06 HOLD;
COB-07/08, saques, deploy e merge seguem sem autorização.


## Compatibilidade funcional sintetica - 21/10/2026, 22:29 BRT (COB-06 HOLD)

Autorizacao expressa: stack nova exclusivamente sintetica, download oficial fixado
pelo host e containers sem internet. Base limpa e sincronizada por fast-forward:
`6974e116521e49225d551be08e0094db85bbecc9`; PR #39 aberta/Draft,
[CI da base aprovada](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/39693862227).
Nao foram repetidos os 35 testes anteriores, os 143 hashes ou o ensaio historico
dos nove SQLs. Nenhum backup privado, clone historico, Supabase remoto ou servico
financeiro foi acessado. Nenhuma configuracao Docker foi alterada.

### Imagens oficiais e reproducibilidade

Somente PostgREST foi baixado pelo Engine no host. Demais imagens reutilizadas do
cache; containers criados por ID imutavel com `--pull=never`.
Os valores abaixo sao tanto IDs locais como RepoDigests observados (prefixar o
repositorio sem tag com `@` para referencia por digest).

| Servico | Repositorio/versao | SHA-256 |
| --- | --- | --- |
| `PostgreSQL` | `public.ecr.aws/supabase/postgres:17.11.0.002` | `sha256:0450166354dc9c1d25f0322ac8b580774d4fb0184d2b087f6e4fe9499c66cf53` |
| `GoTrue` | `public.ecr.aws/supabase/gotrue:v2.197.0` | `sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b` |
| `PostgREST` | `postgrest/postgrest:v14.18` | `sha256:c7cd7e265a85b05248abf53f4473fcec7e327c282d0bd0cf60f1551996d09fcf` |
| `Storage API / helper` | `public.ecr.aws/supabase/storage-api:v1.79.28` | `sha256:1f6c99d3952d78d57129802aa2ae8a80d75e327492cf24742fd0aeaf90967b96` |

Fontes oficiais consultadas: [compose Supabase](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml),
[imagem PostgREST e requisito PG >=13](https://docs.postgrest.org/en/v14/explanations/install.html),
[configuracao PostgREST](https://docs.postgrest.org/en/v14/references/configuration.html),
[Storage v1.79.28](https://github.com/supabase/storage/tree/v1.79.28) e seu
[Dockerfile](https://github.com/supabase/storage/blob/v1.79.28/Dockerfile).
O compose consultado indica PostgREST v14.18/GoTrue v2.197.0; Storage foi mantido
na versao oficial ja disponivel v1.79.28, nao atualizado para a versao do compose.
A compatibilidade desta combinacao foi demonstrada abaixo; nao ha garantia de
paridade com os schemas/versoes do snapshot real. Edge Runtime nao e necessario
para esses testes; nao foi baixado ou iniciado. Nenhuma dependencia npm foi baixada.

### Prova final: 48/48 PASS

Runner restrito: [asaas-cob06-compatibilidade-sintetica-local.cjs](../scripts/validacao-pagamentos/asaas-cob06-compatibilidade-sintetica-local.cjs).
Exige `--execute-synthetic`, cria nomes novos com label `guia.cob06.compat` e
para somente seus containers em `finally`. Nao executar novamente automaticamente.

| Grupo | Resultado comprovado |
| --- | --- |
| Docker/rede | PG network=none; todos os auxiliares no namespace exato do novo PG. Somente lo com 127.0.0.1/::1; zero rotas IPv4, IPv6 apenas loopback/rejeicao em lo. Sem bridge, interfaces externas, portas publicadas, binds, socket Docker ou volumes antigos. Sem tentativa de conexao externa. |
| Processo/mounts | restart=no, privileged=false, cap-drop ALL, no-new-privileges, rootfs somente leitura e /tmp tmpfs. Somente volumes novos listados abaixo. Copiador montou sua origem sintetica read-only. |
| Listeners | 127.0.0.1 nas portas 5432 PG, 9999 Auth, 3000 REST, 5000 Storage, 5002 Storage recuperado; zero listener IPv6. Portas nao publicadas. |
| Bootstrap | initdb direto em PGDATA novo; GoTrue e Storage executaram suas migrations gerenciadas neste banco vazio. Auth admin dono de auth; Storage admin dono de storage; sem superuser nos papeis de aplicacao. DB_INSTALL_ROLES=false evita bootstrap Storage que concede postgres ao authenticator. |
| Auth + REST | Dois usuarios ficticios distintos; login/JWT aceito como authenticated. Inserts proprios A/B aceitos. A nao le/altera linhas B; insert com owner B recusado; linha B permanece intacta. Anon nao le dados privados nem insere; RPC confirma anon/authenticated. JWT com assinatura adulterada recusado 401. |
| Storage | Bucket privado e dois arquivos ficticios; upload/leitura autorizados A/B. B nao le arquivo A nem grava no caminho A. Endpoint publico nao permite leitura anonima de bucket privado. Dois metadados confirmados. |
| Recuperacao sintetica | pg_dump -Fc do banco criado pelo runner, mantido em memoria, restaurado em nova DB synthetic_recovered no mesmo cluster novo. Dois usuarios e dois objetos presentes; RLS de api.private_notes preservada. Arquivos copiados para OUTRO volume novo; segunda Storage API le ambos os arquivos recuperados com JWT original e recusa leitura cruzada. |
| Executores inertes | Preload vazio; extensoes pg_cron, pg_net e supabase_vault ausentes. Sem funcoes financeiras/importacao de SQL privado. Fila/worker Storage, S3, lifecycle, transformacao e telemetria explicitamente desabilitados; sem webhook configurado. |

A recuperacao testa conteudo e ACL/RLS sinteticos. Nao testa recuperacao de roles
em cluster independente (papeis mantidos no mesmo cluster), login Auth contra a
DB recuperada, MFA, SMTP, Edge, snapshots reais nao atomicos, conversao do layout
Storage de exports reais ou compatibilidade de historicos gerenciados antigos.
Os tokens, senhas e DSNs ficticios nao estao neste documento. Os relatorios do
runner contem somente IDs/metadados/resultados; nao armazenam dump nem tokens.

### Recursos novos preservados e parados

Execucao final: `cob06-compat-20261022012945133-e33d24`.
Todos os containers abaixo foram parados; nao houve remocao ou criacao de rede.

| Papel | ID completo | Estado/exit |
| --- | --- | --- |
| `pg` | `1215a7c26686df97a5fe26fd99ab30d60db71a25e33c30e08982b9a6180722a9` | exited / 0 |
| `probe` | `6df561e63670d56cef2ae06f6a50ca17f2352f08d51deac371fae7a26befa87c` | exited / 0 |
| `auth` | `723fa119230e9e0ec3e9afb725a303eb9859d722c621ff78f04016fab5ef472e` | exited / 0 |
| `rest` | `87a2549c0385e75b5fc6bac8b101510c58243e11e82b62c521817244066a1ce5` | exited / 255 |
| `storage` | `3ca960c924f0504646e5beacdb1551a8ccd25a58bf293618f43a65a7d0e8de7a` | exited / 0 |
| `file-copy` | `68c127abb4042f100ebb894c5d054dc86ec03628d6d88f48b05fb7649801335b` | exited / 0 |
| `storage-recovered` | `93864f9f03b5e67d6f4fb768f73baaa381bca2cbed46f0add616f3b9c05e6169` | exited / 0 |

Nome de cada container: prefixo da execucao final + `-<papel>`.
Volumes novos finais:

- `cob06-compat-20261022012945133-e33d24-pgdata`
- `cob06-compat-20261022012945133-e33d24-files`
- `cob06-compat-20261022012945133-e33d24-files-recovered`

Tentativas intermediarias preservadas:

- `cob06-compat-20261022012839565-dab5b6`: `pg` ID `d049759ff2398d98ab0fc96d395bb931fbf413f7c142d081816e8c3a8e6490e7`. Volumes: `cob06-compat-20261022012839565-dab5b6-pgdata`, `cob06-compat-20261022012839565-dab5b6-files`. Todos parados.
- `cob06-compat-20261022012854878-129ff3`: `pg` ID `e58bb3ad57bc52ec2c623d1b5df5059aef6065711c20c5c2ef0da5830aae45c4`; `probe` ID `4c5aa85aa1172b6d780c8273ab826407273268ae94d4bde48577b6284a3ddffe`; `auth` ID `432bdb1ec11fb07879253c2efb073126f5177b2564c9bad742fa884a501a63ef`. Volumes: `cob06-compat-20261022012854878-129ff3-pgdata`, `cob06-compat-20261022012854878-129ff3-files`. Todos parados.

Total desta rodada: **11 containers e 7 volumes novos**, sem remover recursos.
A primeira tentativa parou por cast text/uuid incorreto no bootstrap sintetico;
a segunda, porque as migrations Auth precisavam ser proprietarias de auth.uid/role.
Corrigidos apenas os objetos do bootstrap no runner. Nenhum privilegio elevado
foi concedido aos servicos. Execucao final sem falhas. PostgREST registrou SIGTERM
na parada controlada e retornou 255; nao houve falha durante seus testes HTTP.
Os outros containers finais encerraram com exit 0.

Conferencia posterior somente por metadados: **12/12 containers e 4/4 volumes do
ensaio anterior presentes**, IDs/imagens/redes dos containers preservados e todos
parados. Nenhum start/exec nesses recursos ou no clone historico.
VHDX: reutilizada a confirmacao anterior de `D:\DockerDesktopWSL\disk\docker_data.vhdx`
no D: cifrado; nao houve nova leitura/montagem do disco nem alteracao da localizacao.

### Bloqueios e proxima fase

A ausencia da imagem PostgREST e o funcionamento sintetico do Storage deixam de
ser bloqueios. Continuam pendentes: mapeamento das versoes/migrations reais de
Auth e Storage; estrategia para importar SQL combinado OU auxiliares sem duplicar
COPY; papeis/ACL reais; conversao dos bytes Storage exportados para backend local;
equivalencia de fontes Edge implantadas/dependencias/configuracoes nao secretas;
consistencia temporal dos snapshots; senha recuperavel em meio independente e
rotina de backups futuros. Esta prova nao autoriza corrigir tais itens com dados reais.

Procedimento minimo futuro: obter autorizacao especifica que delimite arquivos,
destino e operacoes; verificar isolamento e destino cifrado novamente ANTES da
entrada; preparar schemas gerenciados conforme versoes reais, papeis e extensoes
inertes; inspecionar neutralizacao de Cron/pg_net/hooks/comandos de restauracao;
importar uma unica selecao nao duplicada; recuperar metadados e bytes com RLS;
validar Auth/REST/Storage e historico Mercado Pago sem rede. Edge apenas com
fontes/dependencias fixadas e configuracoes ficticias. Parar tudo ao terminar.
**PARADO antes de abrir/copiar/restaurar backup real. COB-06 permanece HOLD;
COB-07, COB-08, saques, deploy e merge nao autorizados.**

## Ensaio de isolamento sintético autorizado — APROVADO NO ESCOPO (21/10/2026)

Autorização expressa do proprietário nesta sessão: criar e testar somente recursos
Docker novos e dados sintéticos, sem rede externa, portas publicadas, downloads,
backups ou restauração real. Git conferido, fetch/fast-forward seguro sem mudanças:
HEAD de partida `f9b169fdcec4bb154dd9a009586a110b485f3eae`, árvore limpa; PR #39
aberta/Draft, [CI desse HEAD 39691862706 success](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/39691862706).
Essa autorização supera apenas o gate sintético do preflight abaixo; **não libera
entrada de dados reais, restauração, downloads nem operações remotas**.

Runner local: `scripts/validacao-pagamentos/asaas-cob06-isolamento-sintetico-local.cjs`.
Exige argumento explícito `--execute-synthetic`; não executar novamente por
iniciativa própria, pois cria novos recursos. Usa IDs SHA-256 já locais,
`--pull=never`, nomes exclusivos e labels do ensaio, nenhum bind mount, nenhuma
remoção ou chamada Supabase. O PG usa `initdb`/`postgres` diretamente como usuário
`postgres`, sem entrypoint de bootstrap Supabase e com preload vazio desde o boot.
Os auxiliares compartilham somente o namespace `none` do PG novo.

### Evidência positiva final

Execução `cob06-sint-20261021232651130-2d81f7`: **35/35 verificações PASS**, zero
falha no conjunto final. [Evidência técnica sanitizada e IDs completos](COB06_ISOLAMENTO_SINTETICO_20261021.json)
inclui as quatro tentativas, configurações finais, imagens, rotas e resultados.

| Controle/serviço | Resultado comprovado |
| --- | --- |
| Rede | Única interface `lo`, apenas `127.0.0.1` e `::1`; tabela IPv4 sem rotas. IPv6 contém loopback e entradas de rejeição em `lo`, sem interface/rota externa utilizável. Nenhum teste contra endereço ou serviço real. |
| Restrições Docker | PG `network=none`; auxiliares `container:<ID-PG-novo>`. Todos sem portas publicadas, `privileged=false`, `restart=no`, capabilities removidas, `no-new-privileges` e rootfs somente leitura. Só PGDATA novo montado, mais tmpfs local; nenhum backup/socket Docker/perfil do host. |
| Listeners internos | PostgreSQL 5432, GoTrue 9999, Mailpit 8025/1025 somente em `127.0.0.1`; zero listener IPv6. Sem conexão ao host ou ponte de rede. |
| PostgreSQL 17.11 | `shared_preload_libraries` vazio; zero extensões e workers Cron/pg_net; tabela fictícia criada e um registro gravado/lido. TCP entre o helper novo e PG respondeu no loopback compartilhado. Não há dados ou funções financeiras nesse banco. |
| GoTrue v2.197.0 | `/health` válido; duas contas fictícias distintas, signup 200/200, login 200, refresh 200, logout 204. Claims JWT locais conferidas; não é teste de conta real, MFA, paridade Auth histórica ou validade de JWT após logout. |
| Mailpit v1.31.3 | API interna HTTP 200. Porta SMTP 1025 observada em loopback; não foi enviada mensagem real nem comprovado envio SMTP ponta a ponta. Version check desabilitado. |
| Storage/PostgREST/Edge | **Não executados**: PostgREST e runtime Edge ausentes no cache. A imagem Storage API foi usada somente como runtime Node do helper, com entrypoint substituído; isso não comprova funcionamento do serviço Storage. Nenhum download ou alternativa insegura. |

### VHDX e recursos preservados

Confirmados sem alteração: `CustomWslDistroDir=D:\DockerDesktopWSL`, registro WSL
`docker-desktop` em `D:\DockerDesktopWSL\main`, arquivos Docker
`D:\DockerDesktopWSL\disk\docker_data.vhdx` (8176795648 bytes na leitura) e
`D:\DockerDesktopWSL\main\ext4.vhdx` (117440512 bytes). D: permanece BitLocker
FullyEncrypted/On/100%. Prova por configurações, registro e metadados de arquivos;
nenhum VHDX foi montado ou teve conteúdo lido. Não foi alterado Docker Desktop.

Conjunto final, **todos parados ao término**:

| Nome (prefixo `cob06-sint-20261021232651130-2d81f7-`) | ID curto | Papel |
| --- | --- | --- |
| `pg` | `cdb5eae6f37b` | Banco novo, volume `cob06-sint-20261021232651130-2d81f7-pgdata` |
| `probe` | `e6d7e8bb6dee` | Harness Node, sem mounts |
| `mail` | `3cc7f5783c78` | Capturador SMTP local, sem mounts |
| `auth` | `ac9b2f265fba` | GoTrue com configuração e contas sintéticas, sem mounts |

No total foram criados **12 contêineres e 4 volumes nomeados novos**, contando
diagnóstico e tentativas intermediárias. Todos preservados, sem remoção; nenhum
está running/restarting/paused (um helper não iniciado ficou `created`). Nenhuma
rede Docker foi criada. Grupos anteriores: `cob06-sint-20261021232236578-02acae`,
`cob06-sint-20261021232349683-552053` e `cob06-sint-20261021232417847-466023`.
Seus IDs, volumes e estados constam no JSON; não foram usados recursos históricos.
O helper final terminou com exit 137 após o timeout controlado de parada; os três
serviços terminaram com exit 0. A evidência de funcionamento foi coletada antes
da parada; não confundir esse exit do helper com falha de serviço ou OOM.

### Falhas intermediárias e limites

- Primeira verificação `postgres_ready` falhou porque psql procurava outro socket;
  logs sintéticos confirmaram PG pronto em `/tmp` e `127.0.0.1`. Checker corrigido
  para TCP explícito, sem reduzir isolamento.
- Segunda verificação comparava namespace por nome; Docker armazena `container:`
  seguido do ID. Comparação corrigida para o ID exato do PG novo.
- GoTrue inicialmente recusou migração com 42501 em `public`. Bootstrap passou
  a definir `search_path=auth,public` no papel Auth novo, proprietário de `auth`;
  não foi concedido CREATE em `public` nem privilégio de superusuário.
- Uma retomada apenas dos recursos sintéticos daquela tentativa foi interrompida
  porque o comando repetia initdb sobre PGDATA existente. Corrigido para inicializar
  apenas diretório novo; conjunto final criado separado. Nenhum dado real envolvido.
- Após a coleta, o runner ganhou recusa explícita de colisão de nome de volume e
  SIGTERM no helper; são guardas adicionais, não uma nova execução dos serviços.
  Sintaxe Node e diff conferidos. Não houve nova suíte financeira: código produtivo,
  SQLs congelados e locks não mudaram. Nenhum teste/hashes histórico foi repetido.

**Próximos bloqueios:** faltam imagens/dependências PostgREST e runtime Edge,
compatibilidade dos schemas Auth/Storage com o snapshot real, mapeamento de bytes
Storage e equivalência das fontes/configurações publicadas. A prova de rede vale
para esta composição sintética; novos serviços ou mounts exigem nova conferência.
Não iniciar as imagens ausentes nem transferir backups para os volumes deste teste.

**Parada obrigatória antes dos backups:** próxima autorização proposta é somente
revisar em leitura as cópias locais de trabalho SQL em D: que o operador indicar,
para fechar o plano de entrada/compatibilidade, sem restaurar nem reconectar E:.
A restauração real e eventual aquisição de imagens exigem liberações próprias.
**COB-06 permanece aberta/HOLD.** Nenhum Supabase remoto, banco/provedor financeiro,
Secret/flag remoto, deploy, merge ou backup privado foi acessado.

## Preflight anterior — plano preparado em 21/10/2026, antes do ensaio sintético

Esta seção é a orientação atual para o próximo ensaio. Registros datados abaixo
permanecem históricos; não reabrem os 143 hashes, o ensaio dos nove SQLs ou a
declaração de guarda externa já recebida. Base sincronizada por fast-forward:
`c61daee408c375ba9c7b6b6c07507cffd9a0dc74`, árvore limpa, PR #39 aberta/Draft,
[CI 39691216165 success](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/39691216165).
**Escopo desta rodada: inspeção de metadados Docker/BitLocker e plano documental.**
Não foi executado SQL, aberto backup privado, acessado conteúdo de volume,
reconectada mídia, criado contêiner/rede/volume ou iniciado serviço/restauração.

### Ambiente observado em leitura

| Item | Evidência atual e consequência |
| --- | --- |
| Engine | Docker Desktop Linux, cliente/servidor **29.8.2**, contexto local `desktop-linux`, named pipe local. A consulta inicial sem elevação foi negada; leitura com permissão local funcionou. Não é indisponibilidade do engine. |
| Clone histórico | `guia-postgres-offline-20261014` ativo/healthy; `network=none`, portas `{}`, `restart=no`, `privileged=false`; volume `guia_pg_clone_offline_20261014`, driver local, montado RW no PGDATA. **Preservar e não usar como destino do novo ensaio.** Nenhum `docker exec`/SQL foi feito nele. |
| Contêineres antigos de restauração | `guia-restore-postgres-20261014` e `guia-restore-teste-20261013` parados; rede none, sem portas ou mounts reportados. Não iniciar/reutilizar nem apagar. |
| Rede de nome loopback | `guia-restore-loopback-20261014`: bridge, **internal=false**, zero contêineres conectados. Nome não comprova bloqueio de saída; **não reutilizar** no teste funcional. |
| Imagens locais | PostgreSQL Supabase **17.6.1.166** e **17.11.0.002**, GoTrue **v2.197.0**, Storage API **v1.79.28**, Mailpit **v1.31.3**, Kong **2.8.1** e Realtime **v2.140.3**. PostgREST e runtime Edge não apareceram no cache consultado. Presença não comprova compatibilidade com o snapshot. |
| Cifragem | D: `FullyEncrypted`, proteção `On`, **100%**. `DockerRootDir=/var/lib/docker` é caminho Linux, não prova localização atual do VHDX Windows. Antes de dados privados, confirmar em leitura que o disk image location efetivo continua no D: cifrado, conforme configuração histórica. Não mover disco nem alterar Docker neste preflight. |

Digests locais observados, para identificação posterior sem `latest`:

- PG 17.11.0.002: `sha256:0450166354dc9c1d25f0322ac8b580774d4fb0184d2b087f6e4fe9499c66cf53`.
- GoTrue v2.197.0: `sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b`.
- Storage API v1.79.28: `sha256:1f6c99d3952d78d57129802aa2ae8a80d75e327492cf24742fd0aeaf90967b96`.

### Isolamento exigido ANTES de qualquer dado privado

1. Reservar nomes novos de contêineres e volumes exclusivos do ensaio, sem
   reaproveitar PGDATA/Storage/volumes históricos. Workspace privado fora do Git,
   em D: cifrado; nenhum bind de diretório amplo, socket Docker, perfil do usuário,
   mídia off-host ou pasta de backup no serviço. A futura entrada será uma cópia
   de trabalho específica autorizada, somente leitura, nunca os originais RW.
2. Proposta: banco novo com `network=none`, sem portas publicadas, sem privilégio
   elevado e `restart=no`. Auth, PostgREST, Storage, capturador SMTP e harness
   compartilharão apenas seu namespace via `network=container:<banco-novo>`;
   URLs internas em `127.0.0.1`, portas distintas, sem bridge/host/segunda rede,
   proxy, túnel ou socket de host. Harness HTTP executado nesse namespace,
   controlado por `docker exec`; não exige publicar portas para o navegador.
3. Demonstrar primeiro, **com dados sintéticos e autorização de criação local**,
   interfaces/rotas sem saída IPv4/IPv6, ausência de portas e mounts indevidos e
   comunicação entre os serviços locais. Não testar conectividade em bancos ou
   APIs reais. Imagens/dependências devem estar fixadas e preparadas antes de
   ingressarem dados; se faltarem, parar em vez de conectar o contêiner à Internet.
4. Não executar `supabase start/reset` nesta raiz: `supabase/config.toml` identifica
   projeto real. O builder nativo da CI é referência de isolamento **sintético**,
   não restaurador de backup. Não executar os scripts antigos de preflight:
   eles abrem dumps e repetem verificação de hashes, fora da autorização atual.

Base técnica: [rede none](https://docs.docker.com/engine/network/drivers/none/)
cria somente loopback; [namespace compartilhado](https://docs.docker.com/engine/network/#container-networks)
permite comunicação local dos serviços. O comportamento desta composição ainda
precisa da prova sintética; não foi criado nem testado neste preflight.

### Bloquear executores antes da importação

- Inicializar PGDATA vazio com configuração local revisada, sem copiar
  `postgresql.conf`, `postgresql.auto.conf`, Vault ou credenciais do ambiente real.
  Excluir `pg_cron` e `pg_net` de `shared_preload_libraries` desde o primeiro boot;
  não iniciar seus workers, cron do SO ou serviços de limpeza/replicação externa.
  Se a imagem precisar dessas bibliotecas para bootstrap, **parar e revisar**:
  desabilitar depois de restaurar é tarde. `cron.launch_active_jobs=off` é defesa
  complementar quando aplicável, não substitui isolamento nem revisão do boot.
- Na futura análise autorizada da **cópia** lógica, separar comandos de agendamento,
  filas HTTP, foreign servers/subscriptions, hooks de Auth e gatilhos que chamam
  rede. Não importar jobs ativos, filas pendentes de envio, Vault/Secrets ou
  executores externos. Registrar omissões e dependências sem imprimir comandos
  privados. Não substituir funções financeiras/RLS por stubs para declarar sucesso.
- Usar carga de dados controlada para impedir disparo de triggers durante COPY;
  qualquer suspensão temporária é exclusiva da sessão de importação revisada.
  Depois, restaurar estado original dos triggers e validar FKs/RLS/ACL antes de
  liberar os serviços. Não deixar `session_replication_role=replica` nos testes.
  SQL arbitrário, metacomandos psql/shell ou `COPY PROGRAM` exigem revisão; um
  scanner por regex não constitui aprovação para executar o dump.
- Nenhum webhook público/worker Edge/assinatura de provedor será registrado ou
  iniciado. SMTP somente capturador local; OAuth/SMS/telefone e hooks externos
  desligados **na configuração descartável**. Chaves JWT/senhas locais novas,
  sem tokens produtivos. Credenciais cifradas do histórico são dados sensíveis
  inertes, nunca instaladas como configuração de serviço.

Referência: [pg_cron: preload e launch_active_jobs](https://github.com/citusdata/pg_cron#extension-settings).
Rede bloqueada impede saída; executores neutralizados também evitam mutação
automática do histórico dentro do próprio banco.

### Sequência mínima proposta, somente após autorização operacional

| Passo | Ação futura e critério de aprovação |
| --- | --- |
| 1 — Preparação sintética | Fechar versões/imagens, esquema gerenciado de bootstrap e desenho do namespace; provar isolamento com banco vazio. Nenhuma mídia externa necessária. Não incluir Studio/Realtime/gateway completo se não forem necessários ao teste. |
| 2 — Entrada autorizada | Operador indica cópias de trabalho SQL/Storage já existentes em D: e autoriza sua leitura. Não reconectar a cópia off-host nem repetir 143 hashes. Sem cópia local disponível, pausar e pedir decisão específica sobre a fonte. |
| 3 — Banco lógico | Em volumes novos, bootstrap compatível de `auth`/`storage` e papéis; esquema de negócio, dados e histórico de migrations conforme dependências revisadas, com parada no primeiro erro. Preservar owners, memberships, GRANT/REVOKE, policies, RLS, views e triggers; não aplicar `roles.sql` cegamente nem descartar ACL como no dump sintético CI. Usar `psql -X`/`ON_ERROR_STOP` e logs privados protegidos. |
| 4 — Dados sem duplicidade | Reusar a constatação já aceita de que Auth/Storage aparecem em `data.sql` e nos auxiliares: montar mapa de origem por tabela, importar cada tabela uma vez, sem concatenar os sete arquivos. `history_schema/data` são histórico, não licença para executar migrations pendentes. Não aplicar os nove ou 14 SQLs candidatos neste ensaio de recuperação. |
| 5 — Integridade | No novo destino, verificar FKs/sequências, políticas/ACL, objetos esperados e histórico MP por contagens/digests privados antes/depois da ativação dos serviços. Usar as evidências aceitas como referência, sem reexecutar o clone histórico. Não emitir, conciliar ou atualizar pagamentos. Datas SQL 13/10 e Storage 20/10 continuam snapshots não atômicos. |
| 6 — Auth funcional | Fixar versão compatível do GoTrue e revisar migrações automáticas antes de ligá-lo ao banco restaurado. Criar duas contas **sintéticas** no destino pela API Auth; provar login, refresh/logout e JWT local. Não resetar senha, entrar em conta histórica ou reutilizar sessões/chaves reais. Provar acesso de A/B/anon via PostgREST e papéis efetivos, sem superusuário/service_role para afirmar RLS. |
| 7 — Storage | Restaurar metadados e policies preservados. Backend de arquivos usa volume novo, nunca caminho original. Exercitar dois usuários sintéticos, upload/leitura autorizada e recusa ao outro/anon em bucket privado. Mapeamento dos 128 bytes históricos para o layout físico exigido pela versão Storage API precisa de procedimento revisado; metadata ou cópia direta de pastas não prova download funcional. Se isso faltar, registrar recuperação de metadata apenas, sem atestar Storage completo. |
| 8 — Edge/configuração | Reconstituir fontes e imports a partir de commit fixo, com versões, `verify_jwt`, contratos de rota e inventário de nomes de variáveis já documentado. Divergência da branch frente aos bundles publicados permanece explícita. Testar com provedores locais/mocks e egress bloqueado; não baixar fontes publicadas, executar deploy ou recuperar Secrets nesta autorização. Dependências remotas devem ser pré-empacotadas/cacheadas. |
| 9 — Encerramento | Registrar somente códigos, versões, contagens agregadas e resultados; logs/dumps/tokens permanecem privados. Parar serviços do novo ensaio após coleta; remoção posterior somente dos recursos novos explicitamente identificados. Clone histórico e backup off-host permanecem intocados. Sem retorno automático de flags, DNS ou jobs. |

O bootstrap local de schemas gerenciados, a compatibilidade das versões e o
mapeamento físico Storage ainda não estão aprovados. A documentação de
[backup/restore Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
exige atenção separada às customizações de `auth`/`storage`; o ensaio não pode
inferir equivalência desses serviços apenas do PostgreSQL restaurado.

Configurações **não secretas** a recuperar em manifesto separado de valores:
versões dos serviços, rotas, `verify_jwt`, schemas expostos, parâmetros Auth,
templates/redirecionamentos esperados, limites de Storage, policies e dependências
Edge. No clone, destinos públicos são substituídos por loopback; SMTP e integrações
reais ficam desligados. Para Secrets, registrar apenas nome/responsável e custódia,
usando o [inventário existente](ASAAS_COB06_INVENTARIO_VARIAVEIS_EDGE_20261021.md).
Não copiar o `config.toml` produtivo ou arquivos `.env` para o destino.

### Bloqueios efetivos e próxima decisão

- Falta autorização específica para criar o ambiente sintético e, separadamente,
  ler as cópias locais indicadas pelo operador e restaurar nelas um destino novo.
  A autorização deste preflight **não permite iniciar essas fases**.
- Confirmar localização/cifragem efetiva do VHDX Docker antes de dados privados;
  fechar imagens faltantes e bootstrap compatível de DB/Auth/Storage/PostgREST/
  runtime Edge. Não instalar nada nem mudar o Docker silenciosamente.
- Isolamento da composição proposta e neutralização do bootstrap/workers ainda
  exigem prova sintética; metadados do clone histórico não aprovam o novo destino.
- Mapeamento físico Storage e equivalência das fontes Edge/configurações
  publicadas continuam pendentes. Não solicitar senha ou Secrets pelo chat.
  Custódia separada da senha e backup periódico são gates do runbook, sem exigir
  reconexão da mídia ou repetição das evidências aceitas agora.

**Próxima etapa executável mediante autorização:** fechar composição mínima e
provar isolamento **sem backups**, com serviços/dados sintéticos. Só após esse
gate e autorização de acesso às cópias locais será possível revisar a entrada
e realizar a restauração funcional. Não foi necessário código novo nesta rodada;
qualquer futuro runner deverá ser descrito/revisado antes de implementação.
**Resultado: plano preparado; restauração não executada; COB-06 permanece HOLD.**

## Inventário real consultado (somente leitura)

| Ambiente | Referência Supabase | PostgreSQL | Migrações registradas |
|---|---|---|---|
| Produção | `xdmbkflufsfqziixzpxc` | 17.6 | **29**; última `20261008120906` |
| Staging | `jbttwihctuibchhcyqtl` | diferente histórico | **42**; última `20261012162056` |

Na última leitura remota documentada, a produção **não** tem as seis tabelas de cobrança/termos listadas no gate COB-06, nem os quatro gatilhos de encerramento. Não há Edge `catalogo-asaas-financeiro` produtiva. **Não** copiar histórico de migrações do STAGING para produção, nem executar SQL genérico de `pending-migrations` em lote. A fonte da Edge legada `whatsapp-bot` v90 foi recuperada em 14/10 e incorporada à PR com correções candidatas posteriores; a fonte da branch diverge da versão publicada. A recuperação da fonte está comprovada, mas não equivale a aprovação para substituí-la em produção. Não houve nova consulta remota nesta revisão documental.

## Alerta comprovado: restauração física pode disparar jobs produtivos

**Inventário REAL somente leitura em 12/10/2026**, pelo gate `scripts/validacao-pagamentos/asaas-cob06-clone-preflight-readonly.sql`:

| Dado | PROD | STAGING |
|---|---|---|
| PostgreSQL | 17.6 | 17.11 |
| Migrações registradas | 29 | 42 |
| Extensões `pg_cron` e `pg_net` | presentes | presentes |
| Cron jobs ativos | **3** | **2** |
| Inbox Asaas instalado | não | sim |

Na produção, as três rotinas ativas são `andrelandia-storage-retention-dry-run` (de hora em hora), `andrelandia-fechamento-offline-diario` (diária) e `catalogo-entregas-v2-monitor` (a cada 15 minutos). Nenhum texto de `cron.job.command`, credencial, token, URL privada ou conteúdo do Vault foi extraído. Essa auditoria não executou nem desabilitou qualquer job.

**Não acionar ingenuamente o botão Restore to a New Project como teste de segurança.** A [documentação oficial do Supabase](https://supabase.com/docs/guides/platform/clone-project) adverte que restaurações físicas copiam extensões e os `pg_cron`/`pg_net` restaurados **começam a executar imediatamente**, sem uma etapa garantida de pausa. Também podem copiar a chave raiz de criptografia e registros de autenticação; exigem controle de acesso, segregação de rede, revisão de destino e aprovação prévia. Esse recurso cria **novo projeto tarifável** e requer plano elegível; nenhum projeto/branch foi criado aqui.

**Gate obrigatório antes de restaurar a produção em isolamento:** demonstrar que o ambiente de destino não conseguirá executar jobs externos, chamar serviços reais, disparar webhooks, limpar storage produtivo ou usar credenciais da produção. Quando não for possível garantir isolamento **antes** do primeiro job, **NÃO executar clone físico**; optar por dump/restore lógico controlado (sem `cron`/`vault` sensíveis e com dados sanitizados), validado por especialista. O dump lógico pode deixar de preservar segredo criptografado, Auth ou extensões específicas e precisa de revisão de equivalência; não chamá-lo clone perfeito.

A [documentação oficial de backups](https://supabase.com/docs/guides/platform/backups) informa backups diários para projetos Pro, Team e Enterprise, com retenção de 7/14/até 30 dias, respectivamente; Free não tem essa mesma garantia de backup automático, sendo recomendável exportação própria. **O proprietário confirmou no Dashboard que o projeto está no Free e que não há backups automáticos disponibilizados**. O bloqueio deixou de ser dúvida: precisamos de **backup lógico próprio**, armazenado fora do computador e testado. Foi preparado o documento `docs/ASAAS_COB06_BACKUP_MANUAL_FREE_WINDOWS_20261012.md` e o script PowerShell `scripts/validacao-pagamentos/asaas-cob06-backup-free-producao.ps1` com modo padrão de preflight (sem conexão) e modo Executar opt-in (somente leitura, cinco dumps SQL + checksums). Isso **não** faz backup de fotografias reais no Storage, Edge Functions, segredos, configurações de autenticação/SMTP ou P﻿ITR; todos esses itens exigem solução e ensaio próprios. Para consultar a informação de plano no futuro, visitar `https://supabase.com/dashboard/project/xdmbkflufsfqziixzpxc/database/backups` e identificar tipo, data/hora do último ponto restaurável e retenção; não clicar em Restore sem o plano de isolamento.
## Ensaio de restauração que roda na CI

No job `All financial migrations except remote scheduling (disposable PostgreSQL)` de `.github/workflows/database-tests.yml`, a etapa **COB-06 selective billing and safeguards on local production-like clone (no payouts)** usa exclusivamente o serviço local PostgreSQL 17, sem `DATABASE_URL`, `PGSERVICE` ou credenciais externas.

1. Criar `catalogo_cob06_ci` a partir do baseline sintético do repositório e inserir uma fatura e cobrança fictícias Mercado Pago `pago`, R$7.
2. Fazer **antes da mudança** `pg_dump -Fc --no-owner --no-acl` usando o **binário PG17 dentro do contêiner**, gerar checksum SHA-256 de um arquivo temporário local e recusar dump vazio.
3. Aplicar as **9 fontes seletivas** COB-06 no clone, validar gates de tabelas/RPCs/RLS/gatilhos e que **não** existem tabelas/funções de saque. Confirmar a fatura MP intacta.
4. Restaurar aquele arquivo **pré-migração** para um segundo banco descartável `catalogo_cob06_restore_ci`, via `pg_restore --exit-on-error --no-owner --no-acl`. Confirmar valor/status/gateway e contagem da cobrança MP, que tabelas Asaas **não** existiam antes do pacote, e que a constraint de gateway era somente Mercado Pago.
5. Descartar bancos e dump temporários. **Nenhum artefato do dump** deve ir ao GitHub/à conversa.

**Limite da evidência:** o ensaio demonstra que o procedimento de recuperação de um banco **sintético** funciona no PostgreSQL da CI; não comprova integridade, disponibilidade ou restauração de backups reais do Supabase produção, nem que o clone reproduz as diferenças operacionais atuais.

## Procedimento futuro pré-COB-07 — exige autorização separada

1. Definir responsável, janela de manutenção, critérios de interrupção e modo de impedir **novas emissões e operações** sem perder capacidade de receber e reconciliar webhooks já emitidos. Manter `ASAAS_BILLING_ENABLED=false`, `ASAAS_PRODUCTION_BILLING_APPROVED=false`, `ASAAS_PAYOUTS_ENABLED=false` e `ASAAS_SAQUE_VALIDACAO_ENABLED=false`. Não reutilizar secrets Sandbox.
2. No Supabase de produção, verificar **efetivamente** plano e recursos de backup (backup diário, PITR ou mecanismo contratado), o último ponto recuperável, retenção, criptografia, dono do acesso e capacidade de restaurar em **projeto isolado**. **Sem essa evidência real e sem teste de restauração produtiva em ambiente isolado, gate continua HOLD.**
3. Capturar inventário de 29 versões `supabase_migrations.schema_migrations`, funções e gatilhos; registrar snapshot técnico dos registros MP (agregados e hashes, sem CPF/e-mail/chaves). Nunca baixar ou versionar dump com dados pessoais em CI pública.
4. Restaurar cópia autorizada do **ambiente de produção** em clone segregado, verificar extensão Postgres, schemas `auth`/`storage`, permissões/RLS, no-login roles e cenários com loja devedora, fechamento MP pago e concorrência. Aplicar pacote seletivo de nove etapas no clone, comparar integridade e testar reversão sem perdas.
5. Só após homologação: planejar migrações forward-only sob flags desativadas; executar gates SQL antes/depois, ensaiar webhook autenticado sem emissão Pix real, registrar decisão operacional. Se falhar qualquer passo, **parar**.

## Retorno seguro quando já existem operações reais

- **Antes de habilitar cobrança produtiva:** desligar exposição da UI e manter flags de cobrança/saque desligadas; schemas novos e tabelas vazias podem continuar inertes até correção posterior. Reverter *deploy de UI/Edge* à versão anterior auditada se necessário, desde que webhooks legados permaneçam acessíveis.
- **Depois de gerar faturas reais:** não restaurar automaticamente backup antigo sobre produção ativa (apaga pedidos, faturas e pagamentos posteriores), não rodar `DROP TABLE`, não apagar webhooks nem marcar pagamentos/repasse como pendentes por SQL. Primeiro bloquear novas emissões, preservar e conciliar operações emitidas; planejar correção forward-only e reconciliação com Asaas.
- **Incidente grave / corrupção de banco:** decisão humana documentada, janela e restauração para novo projeto ou PITR conforme ferramenta de backup contratada, comparação de eventos externos Asaas/MP e replay seguro somente depois de identificar discrepâncias. Não executar restore destrutivo sem autorização específica e plano de corte.
- **Saques:** permanecem fora do escopo, desativados mesmo em eventual lançamento de cobranças.

## Confirmação do operador recebida em 21/10/2026 — guarda externa

O operador afirmou explicitamente **“Backup guardado fora do computador”**, após confirmar que a cópia criptografada no disco E: já havia sido criada e validada. Registrar como **declaração de guarda off-host**, não como novo backup, novo teste de senha, hash ou restauração. Considera-se atendido o requisito de separação física **se** o disco E: foi removido e guardado separadamente, ou se uma cópia cifrada equivalente foi transferida para mídia externa retirada. Se E: continuar conectado ao mesmo PC sem cópia externa, a declaração deverá ser retificada e o requisito continua pendente. Não solicitar acesso ao HD, à senha ou aos arquivos privados.

**Ainda pendentes:** localização segura da senha por via independente (não informada), estratégia de backups periódicos depois do snapshot de 20/10, e recuperação funcional DB/Auth/Storage/Edge/configurações em ambiente realmente isolado. **COB-06 permanece HOLD.**

## Próxima ação do operador: comprovação física de guarda fora do computador

**PENDENTE — não assinar aceite com base apenas na existência do E:.**
Já foram aprovados AES-256/extração e 143/143 hashes; não repetir checksums, dumps ou ensaios SQL. Em 21/10/2026 a cópia cifrada `E:\\GuiaAndrelandia-Backup-20261020.7z` estava em um segundo disco SATA, não em armazenamento off-host comprovado.

1. **Antes de remover o HD:** confirmar fisicamente qual dispositivo é o E:, se contém outros dados/serviços necessários e se há escritas em andamento. Se for um HD SATA interno, encerrar programas e **desligar totalmente o Windows** antes de desconectar seus cabos. Não desconectar o SATA com o computador ligado. Se o disco atender a serviços ativos ou a identificação for incerta, **não o desconectar**; transferir uma cópia do arquivo `.7z` para outra mídia removível confiável, com o computador ligado, e ejetá-la pelo sistema depois da cópia.
2. Guardar a mídia desconectada em local separado do computador, preferivelmente fora do imóvel. O arquivo `.7z` deve permanecer cifrado; nenhum SQL, documento ou objeto Storage em claro deve ser copiado para a mídia off-host. Guardar a senha em meio independente e recuperável, sem registrá-la no GitHub, chat ou backup ao qual ela abre acesso. Não apagar os originais criptografados no D: até comprovar procedimento completo.
3. **Evidência mínima sem exposição de dados:** o operador confirma apenas `MIDIA_OFF_HOST_GUARDADA=SIM`, `SENHA_DISPONIVEL_SEPARADAMENTE=SIM`, tipo da mídia e data de guarda. Não enviar fotografia contendo etiqueta, serial, partições, nomes pessoais ou qualquer senha. Registrar `PENDENTE` até essa confirmação; confirmação verbal não comprova ensaio funcional de recuperação.
4. A cópia congelada em 20/10 é **ponto de recuperação histórico**, não backup contínuo para novos pedidos; antes do go-live estabelecer rotina de novos backups SQL + Storage com retenção/off-host, consistência temporal e validações periódicas sem expor dados no CI.

**Gate independente ainda aberto:** restauração funcional de DB/Auth/Storage/Edge/configurações em destino sem acesso a rede, jobs ou provedores reais, conforme condições de segurança já documentadas. O ensaio SQL anterior e a contagem dos arquivos não substituem esse teste. Nunca usar clone físico do Supabase que possa iniciar Cron/Vault antes do isolamento. Qualquer execução real dessa restauração requer autorização operacional própria e plano de isolamento aprovado.

## Itens para aceite da COB-06

**Checklist reconciliado em 21/10/2026 com as evidências posteriores deste documento e da backlog.** Itens marcados comprovam somente o escopo indicado; não encerram a COB-06. A [CI do HEAD `65d7583`, run 39644316130](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/39644316130), foi conferida com **12/12 jobs aprovados**, sem necessidade de reexecução.

- [x] Plano e teste de dump/recover de **clone sintético** no GitHub Actions, com cobrança MP preservada e ausência de estruturas de saque no pacote seletivo.
- [x] Aplicação e reversão das nove fontes no **clone do dump real**, incluindo guardas funcionais e arquivamento sem catálogo; evidências aceitas de 15/10. Não repetir o ensaio do operador.
- [x] Recuperação dos arquivos SQL/Storage criptografados: 143/143 SHA-256; comparação offline de 128 objetos com metadata do clone. Snapshots SQL e Storage não são atômicos.
- [x] Fonte `whatsapp-bot` recuperada/versionada e testes HTTP com Auth, banco e GitHub fictícios, incluindo dívida, autorização, assinatura e recuperação de falha de sincronização. Não são chamadas ao serviço publicado.
- [x] Pacote de revisão de cobrança com nove SQL, guardas de rotas produtivas, privilégios, painéis, filtros da vitrine, termos e privacidade; CI cobre o ZIP e adulterações. Isto não substitui revisão independente nem validação jurídica.
- [ ] Comprovar guarda off-host da cópia externa criptografada e recuperação funcional completa de Auth/Storage/Edge/configurações. Não solicitar repetição dos hashes, extração ou restore SQL já aprovados; não acessar backups privados automaticamente.
- [ ] Aprovar em revisão independente o corte seletivo, assinaturas/privilégios, diferenças frente às versões publicadas e requisitos de configuração do ambiente. A compatibilidade SQL local aceita não prova equivalência integral dos serviços.
- [ ] Homologar operacionalmente a cobrança acumulada em cenário legítimo independente, com prova bancária e conciliação, sob autorização específica. O lote QA histórico permanece bloqueado; CI simulada não substitui esse gate.
- [ ] Aprovar responsáveis, janela, monitoramento, contingência, condições comerciais/cadastrais e revisão jurídica; somente então obter autorização específica COB-07. Implantação, Secrets/flags e primeira fatura real continuam fora da autorização atual.

**Resultado da revisão local:** nenhuma nova falha de código ou lacuna de teste executável foi identificada nos itens acima. Encerrar esta rodada após registrar a reconciliação documental; os itens abertos exigem revisão independente, participação do operador ou homologação/autorização operacional. Os inventários remotos datados abaixo são históricos e não foram reconsultados.

**Nenhuma alteração realizada no Supabase de produção como parte deste procedimento.**


## 15/10/2026 — teste real de DDL do pacote COB-06 no clone offline (APROVADO)

- **15/10/2026 — COB-06: PACOTE MÍNIMO DE 9 SQL APROVADO NO CLONE DO DUMP REAL, COM ROLLBACK.** Operador executou `asaas-cob06-ensaio-clone-offline.ps1` na versão do commit `cfff9cc3a93aed59e842b9d13079e445ecf43965`, usando somente o container isolado `guia-postgres-offline-20261014` (`--network none`). Saída: preflight `38|3|128|29|ausente`, **9/9 fontes validadas**, `Codigo de saida SQL: 0`, **5 avisos NOTICE** não fatais, marcadores de auditoria e `ROLLBACK` conferidos pelo script, e pós-rollback `38|3|128|29|ausente`. Verificação cobriu a aplicação SQL das estruturas/RLS/RPCs/triggers exigidos e ausência de componentes de saque nessa transação. Logs completos apenas no D: local, não publicados. **Escopo da prova:** DDL do pacote aplicável à cópia real e reversão confirmada; NÃO é implantação produtiva, não comprova execução de operações comerciais HTTP, concorrência, emissão Asaas real, nem integridade de bytes Storage ou backup independente. Etapa COB-06 **permanece aberta/HOLD** por guardas funcionais no clone real e demais gates de segurança, revisão da Edge legada e backup off-host criptografado. **Nenhum deploy, merge ou alteração no Supabase hospedado.**

**A pendência de comprovar que os 9 SQL podem ser aplicados e revertidos sobre o esquema restaurado foi satisfeita.** As pendências de recuperação integral/segunda mídia e decisão de go-live continuam abertas. Não confundir esta prova com um teste de recuperação integral de objetos Storage, credenciais, serviços e pipelines externos.


## 21/10/2026 — inventário de Edge Functions para plano de recuperação (somente leitura)

**Projeto PRODUÇÃO:** `xdmbkflufsfqziixzpxc`. Leitura dos metadados publicados via Supabase e verificação das pastas no GitHub, exclusivamente na branch Draft `feat/asaas-faturas-saques-seguros`. Resultado: **14 funções ACTIVE e 14/14 caminhos `index.ts` presentes no repositório da PR**. Isto **NÃO** prova equivalência do código publicado ao código da branch, tampouco restauração de variáveis de ambiente, bindings, permissões, import maps ou serviços externos.

| Função PROD | Versão ativa | verify_jwt (gateway) | Fonte candidata encontrada na PR #39 |
|---|---:|---|---|
| `whatsapp-bot` | 90 | `false` | `supabase/functions/whatsapp-bot/index.ts` |
| `storage-cleanup` | 50 | `false` | `supabase/functions/storage-cleanup/index.ts` |
| `catalogo-admin` | 52 | `false` | `supabase/functions/catalogo-admin/index.ts` |
| `noticias-admin` | 50 | `true` | `supabase/functions/noticias-admin/index.ts` |
| `catalogo-pix-sandbox` | 45 | `false` | `supabase/functions/catalogo-pix-sandbox/index.ts` |
| `catalogo-pix-producao` | 52 | `false` | `supabase/functions/catalogo-pix-producao/index.ts` |
| `conta-usuario` | 32 | `true` | `supabase/functions/conta-usuario/index.ts` |
| `mercadopago-oauth-callback` | 36 | `false` | `supabase/functions/mercadopago-oauth-callback/index.ts` |
| `catalogo-pedido-pix` | 34 | `false` | `supabase/functions/catalogo-pedido-pix/index.ts` |
| `mercadopago-marketplace-webhook` | 36 | `false` | `supabase/functions/mercadopago-marketplace-webhook/index.ts` |
| `catalogo-pedidos-offline-admin` | 31 | `false` | `supabase/functions/catalogo-pedidos-offline-admin/index.ts` |
| `catalogo-pedido-offline` | 44 | `false` | `supabase/functions/catalogo-pedido-offline/index.ts` |
| `catalogo-entregas` | 8 | `false` | `supabase/functions/catalogo-entregas/index.ts` |
| `catalogo-fatura-pix` | 9 | `false` | `supabase/functions/catalogo-fatura-pix/index.ts` |

**Atenção:** `verify_jwt=false` reflete somente a configuração de gateway e **não conclui** que a rota é pública sem proteção de aplicação; checar token próprio/HMAC/autorização para cada handler antes de reconstruir. A `whatsapp-bot` da branch já incorpora endurecimentos candidatos e **não é cópia binária da v90 efetivamente publicada**. O `ezbr_sha256` retornado pelo Supabase refere-se ao bundle implantado, não ao texto isolado de `index.ts`; não tentar equiparar estes hashes diretamente. Em caso de incidente, recuperar a versão efetivamente publicada antes de substituir qualquer endpoint.

**Projeto STAGING:** `jbttwihctuibchhcyqtl`, com 12 funções ACTIVE no momento da leitura, incluindo `catalogo-asaas-financeiro` **v89** e `catalogo-asaas-cob06-auditoria` **v48**. **Nenhuma** função `catalogo-asaas-financeiro` encontra-se publicada na PRODUÇÃO. Não copiar funções, segredos ou banco do STAGING sobre a produção.

**Cron PROD (leitura SQL somente de `jobname` e `active` em 21/10):** 3 jobs ativos: `andrelandia-fechamento-offline-diario`, `andrelandia-storage-retention-dry-run`, `catalogo-entregas-v2-monitor`. Os comandos desses jobs, URL/tokens do Vault e secrets **não foram lidos nem versionados**. Impedir qualquer execução acidental desses jobs e requisições externas durante a restauração de um clone.

### Separação objetiva dos itens de recuperação

- **Comprovado:** backup físico SQL/Storage, extração do `.7z`, comparação SHA-256 de **143 arquivos**, presença de fontes de **14/14** funções no branch da PR e metadados publicados (nome, versão, `verify_jwt`); ensaio SQL anterior em Postgres local isolado sem rede com rollback.
- **Pendente off-host:** operador efetivamente desconectar e guardar E: em local fisicamente separado, com senha recuperável guardada por via independente. Não marcar como feito apenas porque o disco é removível.
- **Pendente clone funcional:** em ambiente sem rede e sem cron executável, reconstruir Auth/storage/RLS/grants e executar testes representativos de rotas, jobs simulados e consistência de pedidos/faturas, incluindo vínculo temporal entre dump SQL 13/10 e export Storage 20/10. Não transformar ensaio de arquivo em promessa de restabelecimento total.
- **Pendente configurações operacionais:** registrar **somente nomes, presença e responsáveis**, sem conteúdo dos Secrets, para Edge/Vault e integrações Asaas/MP/WhatsApp, Auth, SMTP, domínios, DNS, webhooks, cron e regras de deploy. Credenciais têm de ser reconfiguradas pelo proprietário em projeto isolado quando autorizado.
- **Pendente equivalência de deploy:** obter de forma autenticada os bundles/fontes implantados, confirmar dependências e mapear divergências frente à branch. **Não** fazer deploy da PR #39 para substituir funções PROD como forma de recuperação.

**Resultado:** inventário de recuperação de Edge e Cron registrado sem tocar produção; COB-06 permanece HOLD e nenhuma autorização de cobrança, saque ou merge é inferida.

**21/10/2026 — inventário de nomes de variáveis por função preparado:** a inspeção do código `index.ts` das 14 funções PROD na branch, mais das Edge Asaas candidatas do STAGING, gerou [inventário de nomes de configurações não sensíveis](ASAAS_COB06_INVENTARIO_VARIAVEIS_EDGE_20261021.md), commit `9016a76e9726fff5ddfa17b6ebc38e63296aa79d`. O inventário não contém valores nem indica presença dos Secrets no runtime; não substitui verificação do código realmente implantado, do Dashboard de cada projeto, nem ensaio de restauração funcional. Nenhuma configuração remota foi alterada.



### Comparação metadata SQL x bytes Storage restaurados — APROVADA no clone offline (21/10)

Criado [verificador local somente leitura](../scripts/validacao-pagamentos/asaas-cob06-comparar-storage-clone-offline-readonly.ps1) no PR #39, commit `c6af9fa60569fa2ff36b2de481fb222519708f40`. Ele exige o contêiner já conhecido `guia-postgres-offline-20261014` com rede `none`, volume e imagem previamente identificados, e lê **somente** os pares `bucket_id/name` e tamanhos de `storage.objects` restaurados no clone de 13/10. No host compara, em memória, o conjunto de chaves e tamanhos com os 128 arquivos Storage de 20/10 já extraídos em D: cifrado. Reprova falta, extra, diretório redirecionado ou tamanho divergente, sem mostrar nomes de objeto. **EXECUTADO E APROVADO pelo operador em 21/10/2026.** Após inicializar o Docker Desktop, o contêiner original `guia-postgres-offline-20261014` estava em `Exited (0)`. O operador verificou o isolamento do contêiner antes de iniciá-lo: `ISOLAMENTO_OK: sem rede, sem portas e volume correto.` Em seguida, o PowerShell retornou `COB06_METADATA_STORAGE_CLONE_COMPATIVEL: 128/128 arquivos, 5 buckets, 133855024 bytes, 128 tamanhos de metadata conferidos.` O teste confrontou somente o banco restaurado local e os arquivos extraídos do backup, sem rede, sem escrita e sem acesso à produção.

Limite: ainda que passe, os snapshots têm datas diferentes e esse confronto não comprova atomicidade nem reconstituição completa dos serviços. Não restituir flags, cron ou funções produtivas com base nele.
