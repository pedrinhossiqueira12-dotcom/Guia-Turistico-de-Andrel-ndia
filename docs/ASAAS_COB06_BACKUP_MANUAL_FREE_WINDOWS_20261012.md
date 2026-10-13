# COB-06 — Backup manual no Supabase Free (Windows, somente exportação)

**Situação em 12/10/2026:** o proprietário confirmou no Dashboard do projeto de produção `xdmbkflufsfqziixzpxc` a mensagem **“Free Plan does not include project backups.”** Portanto, **nenhum backup automático da plataforma está disponível**, e a COB-06 **não pode ser considerada segura para implantação** sem uma cópia manual verificada e restaurável. Não é necessário contratar Pro para preparar o processo de exportação; custos e garantias diferentes devem ser avaliados separadamente.

Fonte oficial Supabase: https://supabase.com/docs/guides/platform/backups (o Free deve realizar exportações periódicas off-site) e https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore (exportação lógica via Supabase CLI).

## Ferramenta preparada, MAS NÃO executada na produção

Script de execução interativa para Windows:

`scripts/validacao-pagamentos/asaas-cob06-backup-free-producao.ps1`

Não usar conexão na linha de comando nem enviar senha, token, SQL ou ZIP para ChatGPT, GitHub, e-mail, Drive ou pasta compartilhada sem criptografia. O script mantém os arquivos fora do repositório, sob `%USERPROFILE%\GuiaAndrelandiaBackupsPrivados`, porém **são dados legíveis em disco**: a máquina precisa de proteção, acesso restrito e disco criptografado.

### Pré-requisitos locais

- Windows PowerShell, [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) e [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) instalados e executando. A CLI executa `pg_dump` dentro de contêiner; não há instalação de Docker no Supabase remoto.
- Acesso do proprietário ao Supabase e **senha atual do Postgres** da produção (informada **apenas localmente**, em prompt privado, ao CLI se requisitada). Nunca redefinir a senha em produção apenas para este ensaio sem analisar impacto nos serviços.
- Disco local criptografado (BitLocker ou equivalente), espaço suficiente e local de armazenamento de longo prazo **criptografado e separado** do computador. Sem isso, **não executar** modo Exportar/Executar.

### 1. Verificação sem conexão ao banco

Abra o PowerShell na pasta que contém a versão atual do script:

```powershell
Unblock-File .\asaas-cob06-backup-free-producao.ps1
.\asaas-cob06-backup-free-producao.ps1 -Modo Verificar
```

O resultado `PREFLIGHT_OK` verifica só se `supabase` e `docker` estão disponíveis localmente; **não é um backup**. Caso falte uma ferramenta, instalar somente pela documentação oficial. Não repetir instalação de Node/Java ou mexer no código do site.

### 2. Exportação MANUAL, somente após proteção dos dados e autorização no prompt

```powershell
.\asaas-cob06-backup-free-producao.ps1 -Modo Executar
```

O script exige que o operador digite exatamente `BACKUP-FREE-PRODUCAO`. Em seguida, realiza no diretório local isolado `supabase init`, `supabase login`, `supabase link --project-ref xdmbkflufsfqziixzpxc` e, depois, **somente** as seguintes exportações:

| Arquivo | Origem | Limite |
|---|---|---|
| `roles.sql` | `supabase db dump --linked --role-only` | Papéis/grants compatíveis com exportação da CLI, não senhas |
| `schema.sql` | `supabase db dump --linked` | Esquemas selecionados pela CLI, sem dados |
| `data.sql` | `supabase db dump --linked --data-only --use-copy -x storage.buckets_vectors -x storage.vector_indexes` | Dados de tabelas expostos à rotina de dump; **não** arquivos binários de Storage |
| `history_schema.sql` | `--schema supabase_migrations` | Estrutura do histórico de migrações |
| `history_data.sql` | `--schema supabase_migrations --data-only --use-copy` | Versões aplicadas ao banco |
| `manifesto.txt` | SHA-256, bytes, hora UTC e project ref | Não prova restauração nem recuperabilidade por si só |

Nenhum `db reset`, `db push`, `migration up`, `functions deploy`, `restore` ou DDL é executado pelo script. **Não alterar a produção para validar backup.** Se algum arquivo falhar, o script marca o conjunto como **incompleto**; nunca considerá-lo backup válido.

A CLI aplica filtros em schemas gerenciados pelo Supabase; por isso, **não presumir que todas as customizações de `auth` e `storage` estejam integralmente cobertas**. A [documentação oficial de migração](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) requer atenção separada para mudanças em schemas gerenciados, credenciais, criptografia, papéis, configurações externas e histórico de migrações.

### 3. Validação de recuperação — gate ainda aberto

1. Verificar hashes SHA-256 novamente após mover a cópia para uma unidade **criptografada e fora do computador**; guardar **duas cópias criptografadas** em locais separados, sob controle do proprietário.
2. Restaurar **somente em PostgreSQL local e descartável** com rede isolada, sem segredos produtivos ativos e sem destinos externos para `pg_cron`/`pg_net`. A versão 17 é compatível com a produção, mas detalhes de extensões/permissões precisam ser auditados antes da restauração.
3. Conferir estruturas, somatórios e quantidades agregados sem exportar informações pessoais para GitHub; comprovar a continuidade das faturas Mercado Pago e o histórico financeiro. Auth, Storage e chaves de criptografia necessitam auditoria independente.
4. Não declarar restore real validado com base apenas em `Get-FileHash`, sucesso de `db dump` ou ensaio anterior da CI sintética. Não restaurar a cópia na produção ativa.

**Storage:** o banco contém metadados de buckets/objetos, mas **não copia as fotografias/imagens e outros arquivos reais**. Planejar exportação criptografada específica dos arquivos dos buckets via API/CLI e conferir integridade por caminho/hash e controle de acesso. **Edge Functions, segredos, configurações Auth/SMTP, webhooks, domínios e integrações externas** também não são restaurados automaticamente por este SQL.

### Frequência operacional sugerida

Enquanto houver pouca movimentação, fazer exportação pelo menos semanalmente e **imediatamente antes de qualquer alteração de schema**. Quando começarem os pagamentos de comerciantes e o volume aumentar, definir backup diário automatizado/serviço contratado; uma exportação manual semanal pode perder vários dias de pedidos. O Free **não oferece PITR**, portanto não prometer ponto de recuperação recente.

### Situação da COB-06

- **Comprovado:** exportação manual é procedimento oficial suportado; script PowerShell preparado e versionado, sem acesso a segredos; ensaios com **banco sintético** do GitHub Actions já comprovaram `pg_dump`/`pg_restore` sob isolamento.
- **Pendente:** usuário executar `-Modo Verificar` localmente, confirmar proteção de disco, **realizar primeiro dump local**, verificar os cinco arquivos e manifesto, exportar Storage de forma segura e demonstrar restauração isolada do material real.
- **Bloqueado:** migrar/ativar Asaas real ou modificar/criar backup via SQL em produção antes da evidência e da autorização expressa de COB-07.

Nenhum backup da base real foi criado por ChatGPT; o script não foi executado pelo assistente.
