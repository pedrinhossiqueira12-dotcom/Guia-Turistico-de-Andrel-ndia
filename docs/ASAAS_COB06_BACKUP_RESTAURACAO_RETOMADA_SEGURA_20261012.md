# COB-06 — backup, restauração e retorno seguro sem perda financeira

**Atualização efetiva: 21/10/2026.** Os sete dumps SQL originais e os 128 objetos físicos Storage já foram exportados e conferidos pelo operador; o pacote `.7z` com criptografia AES-256 no disco E: foi testado mediante extração em D: criptografado. **143/143 arquivos** extraídos conferidos por SHA-256 com seus originais, com **128 objetos e 133855024 bytes de Storage**. O disco E: é um segundo disco físico que o operador confirma poder desconectar, mas ainda **não houve confirmação de desconexão e guarda em local distinto**. Foi efetuado ensaio anterior do SQL no clone isolado com rollback, mas **não** uma restauração integral de serviços externos/Edge/configurações. PR #39 Draft e COB-06 HOLD. Evidência detalhada em [ASAAS_COB06_EVIDENCIA_RECUPERACAO_ARQUIVOS_20261021.md](ASAAS_COB06_EVIDENCIA_RECUPERACAO_ARQUIVOS_20261021.md).

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
