# COB-06 — backup, restauração e retorno seguro sem perda financeira

**Atualização:** 13/10/2026. **Estado:** usuário executou o primeiro **backup lógico SQL real de produção no plano Free**, exportando sete arquivos e manifesto SHA-256 para **D: protegido por BitLocker** (`20261013T212912Z-34019e86`); terminal retornou `EXPORTACAO_CONCLUIDA`. **Verificação independente dos hashes ainda não realizada pelo operador; backup não restaurado, não abrange bytes físicos do Storage, Edge Functions, segredos nem assegura consistência transacional entre dumps.** Restore em ambiente isolado permanece HOLD; PR #39 continua Draft. Nenhuma migração, alteração de banco, cobrança ou saque real autorizados.

## Inventário real consultado (somente leitura)

| Ambiente | Referência Supabase | PostgreSQL | Migrações registradas |
|---|---|---|---|
| Produção | `xdmbkflufsfqziixzpxc` | 17.6 | **29**; última `20261008120906` |
| Staging | `jbttwihctuibchhcyqtl` | diferente histórico | **42**; última `20261012162056` |

A produção **não** tem as seis tabelas de cobrança/termos listadas no gate COB-06, nem os quatro gatilhos de encerramento. Não há Edge `catalogo-asaas-financeiro` produtiva. **Não** copiar histórico de migrações do STAGING para produção, nem executar SQL genérico de `pending-migrations` em lote. A Edge legada `whatsapp-bot` v90 está implantada e sua origem GitHub exata ainda não foi recuperada para revisão.

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

## Itens para aceite da COB-06

- [x] Plano e teste de dump/recover de **clone sintético** no GitHub Actions; o workflow [38295567490](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/38295567490) terminou **success (12/12 jobs)**, incluindo a etapa COB-06 de snapshot e restauração em banco descartável.
- [x] Manifesto seletivo e gates read-only no STAGING / diagnóstico PROD.
- [x] Teste em clone sintético com fatura antiga MP e bloqueio de exclusão de devedor.
- [ ] Confirmar backup **real** de produção / retenção / PITR com operador e ensaiar restauração em isolamento aprovado.
- [ ] Aprovar equivalência e adaptar o pacote seletivo ao esquema efetivo de produção.
- [ ] Auditar e versionar fonte da Edge `whatsapp-bot` v90 para compatibilidade; testar HTTP e edição de JSON com dados fictícios.
- [ ] Auditar demais rotas da Edge financeira mista e privilégios; preparar pacote de UI limitado à cobrança.
- [ ] Definir critérios de operação, intervenção e monitoramento, com aprovação explícita futura COB-07.

**Nenhuma alteração realizada no Supabase de produção como parte deste procedimento.**


## 15/10/2026 — teste real de DDL do pacote COB-06 no clone offline (APROVADO)

- **15/10/2026 — COB-06: PACOTE MÍNIMO DE 9 SQL APROVADO NO CLONE DO DUMP REAL, COM ROLLBACK.** Operador executou `asaas-cob06-ensaio-clone-offline.ps1` na versão do commit `cfff9cc3a93aed59e842b9d13079e445ecf43965`, usando somente o container isolado `guia-postgres-offline-20261014` (`--network none`). Saída: preflight `38|3|128|29|ausente`, **9/9 fontes validadas**, `Codigo de saida SQL: 0`, **5 avisos NOTICE** não fatais, marcadores de auditoria e `ROLLBACK` conferidos pelo script, e pós-rollback `38|3|128|29|ausente`. Verificação cobriu a aplicação SQL das estruturas/RLS/RPCs/triggers exigidos e ausência de componentes de saque nessa transação. Logs completos apenas no D: local, não publicados. **Escopo da prova:** DDL do pacote aplicável à cópia real e reversão confirmada; NÃO é implantação produtiva, não comprova execução de operações comerciais HTTP, concorrência, emissão Asaas real, nem integridade de bytes Storage ou backup independente. Etapa COB-06 **permanece aberta/HOLD** por guardas funcionais no clone real e demais gates de segurança, revisão da Edge legada e backup off-host criptografado. **Nenhum deploy, merge ou alteração no Supabase hospedado.**

**A pendência de comprovar que os 9 SQL podem ser aplicados e revertidos sobre o esquema restaurado foi satisfeita.** As pendências de recuperação integral/segunda mídia e decisão de go-live continuam abertas. Não confundir esta prova com um teste de recuperação integral de objetos Storage, credenciais, serviços e pipelines externos.
