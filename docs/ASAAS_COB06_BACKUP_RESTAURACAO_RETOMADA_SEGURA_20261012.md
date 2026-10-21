# COB-06 — backup, restauração e retorno seguro sem perda financeira

**Atualização efetiva: 21/10/2026.** Os sete dumps SQL originais e os 128 objetos físicos Storage já foram exportados e conferidos pelo operador; o pacote `.7z` com criptografia AES-256 no disco E: foi testado mediante extração em D: criptografado. **143/143 arquivos** extraídos conferidos por SHA-256 com seus originais, com **128 objetos e 133855024 bytes de Storage**. O disco E: é um segundo disco físico. **Em 21/10/2026, o operador declarou: `Backup guardado fora do computador`.** Essa declaração é registrada como confirmação operacional de guarda externa **sob a condição de que a mídia que contém o `.7z` esteja de fato fisicamente fora do computador** (não apenas em E: ainda conectado). A confirmação é declaratória: não houve verificação física independente, nem confirmação sobre guarda separada da senha. Foi efetuado ensaio anterior do SQL no clone isolado com rollback, mas **não** uma restauração integral de serviços externos/Edge/configurações. PR #39 Draft e COB-06 HOLD. Evidência detalhada em [ASAAS_COB06_EVIDENCIA_RECUPERACAO_ARQUIVOS_20261021.md](ASAAS_COB06_EVIDENCIA_RECUPERACAO_ARQUIVOS_20261021.md).

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
