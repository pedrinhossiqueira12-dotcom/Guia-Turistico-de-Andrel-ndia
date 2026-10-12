# COB-06 — recuperar código implantado da Edge legada (somente download)

**12/10/2026 — PENDENTE, não executar deploy.** A produção usa Supabase `xdmbkflufsfqziixzpxc`, função **`whatsapp-bot` v90, ACTIVE**, `verify_jwt=false` no gateway (o código precisa validar JWT/permissões de cada rota). Metadados de integridade reportados pelo Supabase: `ezbr_sha256=3e40d463c06d975af6ea3ce91c4a41133380f35507ec8af0688a1f28324a6ca7`. Esse hash é do bundle de deploy e **não deve ser comparado ingenuamente com SHA256 do index.ts baixado**.

**Bloqueio atual:** `Supabase.get_edge_function` retornou `Failed to retrieve function bundle` em várias tentativas, embora `Supabase.list_edge_functions` prove que a versão 90 está ativa. O caminho versionado `supabase/functions/whatsapp-bot/index.ts` não existe na PR #39. **Não inventar uma nova implementação nem fazer deploy substitutivo.**

## Método oficial 1: Dashboard, somente leitura

1. Acesse https://supabase.com/dashboard/project/xdmbkflufsfqziixzpxc/functions e abra **whatsapp-bot**.
2. Confirme nome **whatsapp-bot**, versão **90** (se aparecer) e selecione **Download** no canto superior direito da página da função.
3. Guarde o arquivo **localmente em diretório isolado**, não no repositório público. Nunca clique em Deploy, Save, Delete nem migre função por engano.
4. Antes de enviar conteúdo para revisão/GitHub, inspecione possíveis secrets hardcoded (access tokens, API keys, strings de conexão, senha, credenciais de terceiros). **Não cole segredos no chat**. Pode compartilhar apenas código sem segredos; URLs públicas do Supabase e publishable keys não são equivalentes a tokens privados.

## Método oficial 2: Supabase CLI, somente download

Em máquina com **Supabase CLI instalado e login autenticado** (é diferente da chave de pagamento Asaas):

```powershell
mkdir "$HOME\Downloads\cob06-whatsapp-auditoria" -ErrorAction SilentlyContinue
cd "$HOME\Downloads\cob06-whatsapp-auditoria"
supabase login
supabase functions download whatsapp-bot --project-ref xdmbkflufsfqziixzpxc --use-api
```

O modo `--use-api` pede ao Supabase que faça a descompactação do código no servidor, sem Docker local. Se houver erro de bundle também no CLI, **não tentar `deploy`**; usar Download pelo Dashboard ou solicitar ao suporte Supabase a recuperação de fonte da versão 90. A CLI pode não incluir `deno.json` ou import maps; recuperar dependências antes de validar/reimplantar.

## Homologação necessária após obter fonte

- Registrar hash **SHA256 do arquivo fonte obtido** (não confundir com hash do bundle), versão do deploy e hora da captura; guardar cópia original imutável.
- Revisar três ações de encerramento `marcar_meu_comercio_deletado`, `marcar_comercio_deletado` e `excluir_comercio`; verificar titular/admin JWT e bloqueio de dívida **antes de atualizar JSON público, fotos ou publicação**.
- Simular as rotas HTTP com a versão capturada, mocks Supabase e GitHub sem rede real e banco descartável; testar casos dívida/sem dívida/concorrência e falha parcial de GitHub.
- Verificar que a função não responde com sucesso de exclusão quando o banco rejeita a mudança, e que rollback local não altera pagamentos.
- Só depois de revisar qualquer segredo, integrar código à PR Draft e comparar contrato com a função v90, sem deploy. Autorizar eventual substituição produtiva **separadamente** na COB-07.

Documentação oficial: https://supabase.com/docs/guides/functions/quickstart-dashboard (Download pelo painel) e https://supabase.com/docs/reference/cli/supabase-functions-download (`functions download --use-api`).

**Nenhuma alteração na Edge publicada é feita por este procedimento.**
