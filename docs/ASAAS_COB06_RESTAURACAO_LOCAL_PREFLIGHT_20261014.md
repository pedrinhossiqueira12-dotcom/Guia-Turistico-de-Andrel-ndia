# COB-06 — Triagem local do dump real antes de restaurar

**Estado 14/10/2026:** o operador exportou sete arquivos SQL do Supabase PROD para o BitLocker D: e executou o verificador de sete tamanhos/hashes com resposta `INTEGRIDADE_LOCAL_OK`. A cópia **ainda não foi restaurada** e **não existe segunda cópia externa comprovada**. O operador decidiu continuar com o ensaio local, ciente de que **isso não protege contra falha/perda do mesmo equipamento**.

## Passo atual: triagem do DDL, somente leitura

Baixar o script `scripts/validacao-pagamentos/asaas-cob06-restauracao-preflight-local.ps1` no Windows `$HOME\Downloads` **sem alterar o arquivo de backup original**. Na mesma pasta Downloads deve estar `asaas-cob06-verificar-integridade-local.ps1` previamente aprovado pelo operador. Executar:

```powershell
cd "$HOME\Downloads"
.\asaas-cob06-restauracao-preflight-local.ps1
```

O comando **não** chama Supabase, Asaas, Mercado Pago, `psql`, `docker run` nem executa SQL. Ele valida BitLocker D:, confere manifesto e os sete SQL pelo verificador existente, consulta a Docker Engine e se a imagem `public.ecr.aws/supabase/postgres:17.6.1.166` já está no cache. Faz leitura **local e em fluxo, sem imprimir as linhas** dos dumps de esquema/papéis para identificar referências a Cron, pg_net/HTTP/dblink, Vault e instruções `COPY FROM PROGRAM`/shell. Não envia arquivos para GitHub, ChatGPT, nuvem, CI ou rede. Imprime apenas tamanho total aproximado, disponibilidade do Docker, booleanos de categorias e estado `RESTAURACAO_NAO_EXECUTADA`.

**Importante:** o classificador de texto **não prova** a ausência de comandos perigosos ou rotinas executáveis: funções SQL podem estar em texto alternativo ou invocadas indiretamente; esquemas Supabase gerenciados `auth/storage` não estão totalmente cobertos pelos dumps. Seus resultados servirão somente para decidir, depois, o projeto de restauração descartável; **não autorizar automaticamente execução de SQL**. Não reproduzir conteúdo de `roles.sql`, `auth_data.sql`, `storage_metadata.sql`, segredos, logs de banco ou conteúdo do manifesto.

## Regras para o teste de restauração (etapa seguinte, AINDA NÃO EXECUTADA)

1. Contêiner PostgreSQL 17 local e efêmero no Docker Desktop com armazenamento somente no BitLocker D:, `--network none`, **sem portas publicadas**, sem acesso a `docker.sock`, `--privileged`, volumes do sistema ou credenciais remotas. O backup original deve ser montado apenas **read-only**; nenhum comando que modifique o projeto Supabase externo.
2. Neutralizar execução de rotinas e extensões de agendamento e acesso externo antes de importar DDL. DDL que contenha referências a `cron`, `pg_net`, `vault` ou execuções shell exige auditoria e bloqueia autorização automática; rede desativada é proteção necessária, mas não suficiente.
3. Não utilizar `Restore to a new project`, Supabase CLI `db reset` ou `db push` em ambientes vinculados e não iniciar `supabase start` sobre o projeto real. Restaurar apenas em banco descartável sem conexão externa, com log de erros protegido em D: (erros `COPY` podem expor dados pessoais). Não publicar outputs/SQL na CI nem compartilhá-los no chat.
4. Checar `roles/schema/data`, histórico de migrações e `auth/storage` conforme capacidades do PostgreSQL/Supabase local. `schema.sql` pode depender de schemas/plataforma e extensões específicos do Supabase. Não contornar erros silenciosamente e não declarar restaurabilidade total se houver falhas ou objetos faltantes.
5. Após comprovação de restore seguro, guardar uma **segunda cópia independente e criptografada, fora do computador**. O teste local não satisfaz o gate de redundância; bytes físicos dos arquivos Supabase Storage, Edge Functions e secrets também permanecem fora dos SQL.

Fontes oficiais: [Docker — rede none](https://docs.docker.com/engine/network/drivers/none/), [PostgreSQL — SQL dump/psql ON_ERROR_STOP](https://www.postgresql.org/docs/current/backup-dump.html), [Supabase — backup/restore CLI e schemas gerenciados](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

**Gate:** COB-06 = HOLD. Não habilitar Asaas produção, saques ou migrações com esta evidência preliminar.
