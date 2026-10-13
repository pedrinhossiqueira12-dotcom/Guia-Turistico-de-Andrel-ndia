# COB-06 — Backup manual no Supabase Free (Windows, somente exportação)

**Situação em 12/10/2026:** o proprietário confirmou no Dashboard do projeto de produção `xdmbkflufsfqziixzpxc` a mensagem **“Free Plan does not include project backups.”** Portanto, **nenhum backup automático da plataforma está disponível**, e a COB-06 **não pode ser considerada segura para implantação** sem uma cópia manual verificada e restaurável. Não é necessário contratar Pro para preparar o processo de exportação; custos e garantias diferentes devem ser avaliados separadamente.

Fonte oficial Supabase: https://supabase.com/docs/guides/platform/backups (o Free deve realizar exportações periódicas off-site) e https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore (exportação lógica via Supabase CLI).

## Primeiro backup real exportado — recuperação ainda não comprovada

**Evidência relatada pelo proprietário em 13/10/2026:** execução manual de `-Modo Executar -DestinoSeguro 'D:\'` terminou com `EXPORTACAO_CONCLUIDA: sete arquivos SQL criados e hash SHA256 conferido.`. Os arquivos foram gerados em `D:\GuiaAndrelandiaBackupsPrivados\20261013T212912Z-34019e86`, unidade com BitLocker ativo. O script criou `roles.sql`, `schema.sql`, `data.sql`, `auth_data.sql`, `storage_metadata.sql`, `history_schema.sql`, `history_data.sql` e `manifesto.txt`. **O assistente não teve acesso ao backup real e não executou uma restauração.**

Próximo gate: verificar **localmente** que tamanho e SHA-256 de cada SQL continuam correspondendo ao `manifesto.txt`, sem exibir dados, copiar para uma segunda mídia **independente e criptografada** e ensaiar restauração em PostgreSQL 17 descartável com rede bloqueada para o exterior. O conteúdo SQL **não inclui bytes dos objetos do Storage**, código de Edge Functions, segredos de integrações ou uma captura transacional global entre os sete dumps.

**COB-06 permanece HOLD** até evidência de restauração e os demais gates do backlog. As instruções históricas abaixo mostram o procedimento utilizado para esta exportação; não tratá-las como o estado atual.

## Ferramenta de exportação manual (procedimento histórico)

Script de execução interativa para Windows:

`scripts/validacao-pagamentos/asaas-cob06-backup-free-producao.ps1`

**ATUALIZACAO OBRIGATORIA 13/10/2026:** apos concluir os preflights do D:, uma ultima revisao encontrou que o dump padrao da Supabase CLI **omite auth e storage**. A versao mais recente do script inclui explicitamente `auth_data.sql` e `storage_metadata.sql`, e valida a presenca de `COPY auth.users` e `COPY storage.objects`. **Baixe novamente a versao atualizada no GitHub antes de executar o backup real.** A copia anterior em Downloads executa cinco dumps e **NAO basta** para recuperacao dos usuarios/metadados.

Não usar conexão na linha de comando nem enviar senha, token, SQL ou ZIP para ChatGPT, GitHub, e-mail, Drive ou pasta compartilhada sem criptografia. O script mantém os arquivos fora do repositório, sob `%USERPROFILE%\GuiaAndrelandiaBackupsPrivados`, porém **são dados legíveis em disco**: a máquina precisa de proteção, acesso restrito e disco criptografado.

### Pré-requisitos locais

- Windows PowerShell, [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) e [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) instalados e executando. A CLI executa `pg_dump` dentro de contêiner; não há instalação de Docker no Supabase remoto.
- Acesso do proprietário ao Supabase e **senha atual do Postgres** da produção (informada **apenas localmente**, em prompt privado, ao CLI se requisitada). Nunca redefinir a senha em produção apenas para este ensaio sem analisar impacto nos serviços.
- Disco local criptografado (BitLocker ou equivalente), espaço suficiente e local de armazenamento de longo prazo **criptografado e separado** do computador. Sem isso, **não executar** modo Exportar/Executar.

### Trava obrigatória de criptografia (confirmada no Windows do operador)

Em 13/10/2026 o operador executou `manage-bde -status C:`. O volume C: retornou **0,0% criptografado**, `Totalmente Descriptografado`, `Proteção Desativada` e nenhum protetor de chave. Portanto, **não é permitido o backup no destino padrão C:**, mesmo tendo CLI 2.119.0 e Docker 29.8.2 funcionando (`PREFLIGHT_OK`).

Para impedir erro humano, `-Modo Executar` agora consulta **`Get-BitLockerVolume`** na unidade de destino **antes de login, criação de pasta, link ou exportação** e recusa se o volume não estiver `FullyEncrypted`, `EncryptionPercentage=100` **e** `ProtectionStatus=On`, ou se o status não puder ser verificado. Diretórios UNC ou de rede também são recusados. O modo `-Modo Verificar` continua apenas verificando as ferramentas, sem solicitar ou ativar criptografia.

Opção A: Habilitar a **Criptografia do dispositivo** em **Configurações > Privacidade e segurança > Criptografia do dispositivo**, se disponível em Windows Home/Pro; ou **Gerenciar BitLocker** nas edições Pro/Enterprise/Education. **Guardar a chave de recuperação em local independente antes de depender do disco; não enviar a chave ao chat nem guardar somente no mesmo computador.** Aguardar terminar a criptografia e verificar `manage-bde -status C:` e/ou `Get-BitLockerVolume -MountPoint C:`. Não habilitar criptografia remotamente por este script nem desativar TPM/Inicialização Segura sem avaliação técnica.

Opção B: Caso o C: não possa ser criptografado, usar uma **unidade externa D:/E: realmente criptografada com BitLocker To Go**, 100% protegida, com espaço suficiente. Exemplo **após** conferir que E: está criptografado e desbloqueado: ` .\asaas-cob06-backup-free-producao.ps1 -Modo Executar -DestinoSeguro 'E:\' `. A verificação consulta automaticamente a **unidade escolhida**. Não usar pendrive comum, pasta em nuvem, ZIP sem criptografia ou volume VeraCrypt não verificável por esse script; essas alternativas exigem implementação e auditoria separadas.

Referência Microsoft: https://support.microsoft.com/pt-br/windows/security/encryption/device-encryption-in-windows e https://learn.microsoft.com/pt-br/powershell/module/bitlocker/get-bitlockervolume. Caso a opção esteja ausente, confirmar edição do Windows por `Get-CimInstance Win32_OperatingSystem | Select-Object Caption` e recursos de segurança disponíveis, sem tentar forçar o BitLocker por comando.
### Unidade D: criptografada — verificar também os temporários do Docker

Em 13/10/2026, o operador confirmou pelo `Get-BitLockerVolume -MountPoint D:`:
`VolumeStatus=FullyEncrypted`, `EncryptionPercentage=100` e `ProtectionStatus=On`. **A unidade D: pode armazenar dumps**, desde que a chave de recuperação esteja guardada fora dela.

**Importante:** o **Docker Desktop normalmente armazena sua máquina virtual Linux no C:** — segundo a [documentação oficial Docker WSL 2](https://docs.docker.com/desktop/features/wsl/), por padrão em `%LOCALAPPDATA%\Docker\wsl`. O processo `supabase db dump` usa um contêiner PostgreSQL; o fato de o arquivo SQL final estar em D: **não garante** que toda a execução e seus dados temporários não deixem vestígios no C: descriptografado.

**Antes de qualquer exportação real:** abrir **Docker Desktop > Settings > Resources > Advanced > Disk image location** e verificar onde estão os dados. Caso a imagem do Docker permaneça em C:, mudar a localização **pelo próprio Docker Desktop** para uma pasta em D:, por exemplo `D:\DockerData`, e clicar em Apply. **Não mover arquivos .vhdx manualmente**: isso pode quebrar o Docker. Se a opção não estiver disponível ou a migração falhar, interromper o procedimento até uma alternativa segura ser analisada. Não presumir que esse ajuste proteja outros softwares ou tokens locais; a Supabase CLI também pode armazenar credenciais de login no perfil Windows (C:), que devem ser protegidas separadamente.

O script foi atualizado para colocar a pasta de trabalho e `TEMP`, `TMP` e `TMPDIR` **do processo de backup** em D: protegido e restaurar esses ambientes ao terminar; **isso não move automaticamente a VM do Docker nem suas credenciais**.

**Nova verificação segura sem rede e sem exportação, após baixar a versão mais recente do script:**

```powershell
cd "$HOME\Downloads"
.\asaas-cob06-backup-free-producao.ps1 -Modo Verificar -DestinoSeguro 'D:\'
```

O comando `-Modo Verificar` valida ferramentas e o estado BitLocker do destino **sem conectar ao banco**. Exigir a mensagem `DESTINO_SEGURO: unidade D: criptografada, 100%, protecao ativa.`, mas não confundi-la com confirmação do armazenamento interno do Docker.

**Não executar `-Modo Executar` antes de comprovar local de dados Docker protegido e o armazenamento independente da chave de recuperação.**

### 1. Verificação sem conexão ao banco

Abra o PowerShell na pasta que contém a versão atual do script:

```powershell
Unblock-File .\asaas-cob06-backup-free-producao.ps1
.\asaas-cob06-backup-free-producao.ps1 -Modo Verificar
```

O resultado `PREFLIGHT_OK` verifica só se `supabase` e `docker` estão disponíveis localmente; **não é um backup**. Caso falte uma ferramenta, instalar somente pela documentação oficial. Não repetir instalação de Node/Java ou mexer no código do site.

### 2. Exportação MANUAL, somente após proteção dos dados e autorização no prompt

**No Windows deste operador, C: não é criptografado. Sempre informar D: como destino!**

```powershell
.\asaas-cob06-backup-free-producao.ps1 -Modo Executar -DestinoSeguro 'D:\'
```

O script exige que o operador digite exatamente `BACKUP-FREE-PRODUCAO`. Após confirmar BitLocker ativo na unidade de destino escolhida, realiza no diretório local isolado `supabase init`, `supabase login`, `supabase link --project-ref xdmbkflufsfqziixzpxc` e, depois, **somente** as seguintes exportações:

| Arquivo | Origem | Limite |
|---|---|---|
| `roles.sql` | `supabase db dump --linked --role-only` | Papéis/grants compatíveis com exportação da CLI, não senhas |
| `schema.sql` | `supabase db dump --linked` | Esquemas selecionados pela CLI, sem dados |
| `data.sql` | `supabase db dump --linked --data-only --use-copy -x storage.buckets_vectors -x storage.vector_indexes` | Dados de tabelas expostos à rotina de dump; **não** arquivos binários de Storage |
| `auth_data.sql` | `--schema auth --data-only --use-copy` | Dados gerenciados, incluindo `auth.users` (credenciais hash e dados de autenticação são extremamente sensíveis); a restauração requer procedimento compatível com o Supabase e testes específicos |
| `storage_metadata.sql` | `--schema storage --data-only --use-copy` com exclusões de tabelas vetoriais | Metadados como `storage.objects` e buckets, **não** os bytes de fotos/arquivos armazenados no serviço de Storage |
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

## Revisão de cobertura de dados gerenciados (13/10/2026)

Documentação oficial: https://supabase.com/docs/reference/cli/supabase-db-dump — o `supabase db dump` sem `--schema` exclui `auth` e `storage` por padrão. Com `--schema auth` e `--schema storage`, são gerados arquivos **separados somente com dados** desses esquemas, para fins de futura recuperação sob controle. O script exige a presença das instruções `COPY auth.users` e `COPY storage.objects`, para não declarar sucesso se a CLI silenciosamente os deixar de fora. Se essa checagem falhar, tratar como **exportação incompleta** e não prosseguir com a implantação. Os schemas gerenciados e suas personalizações (gatilhos e RLS criados pelo usuário) ainda requerem atenção no teste de restauração, conforme https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore.

**Limites:** (a) são sete dumps sequenciais, **não** uma captura transacional consistente entre arquivos; (b) nenhum dump inclui os bytes dos arquivos do Storage; (c) restauração de dados de autenticação e Storage em instância nova **não está testada e não deve ser realizada automaticamente**; (d) nenhuma cópia externa independente do computador foi confirmada ainda. `EXPORTACAO_CONCLUIDA` **não significa** backup integral restaurável. Tratar `auth_data.sql` como segredo altamente sensível; não enviar ao chat, repositório ou serviço não criptografado.

A Supabase CLI prefere Windows Credential Manager para tokens; sem cofre nativo, pode criar `~/.supabase/access-token` em texto puro: https://supabase.com/docs/reference/cli/introduction. Antes de executar, confirmar que **nenhum token em texto puro** está presente no C: com `Test-Path "$HOME\.supabase\access-token"` (não abrir/copiar conteúdo); caso positivo, bloquear a exportação até revisar o armazenamento de credenciais. A opção `supabase login` deve usar o cofre nativo no Windows; nunca colar chave no chat.
