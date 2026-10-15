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


## Auditoria da fonte recuperada — 14/10/2026 (sem deploy)

- **RECUPERAÇÃO CONCLUÍDA.** Operador executou `supabase functions download whatsapp-bot --project-ref xdmbkflufsfqziixzpxc --use-api` com código 0; recebeu `index.ts` (33.499 bytes, SHA-256 `E679CECA2EA3DEB6DB936E50A063AED075F67F50BEC08F8D974118F7DD5C47A8`) e `storage-path-utils.mjs` (1.604 bytes, SHA-256 `2FA65A228B453AC6A4969098B6496E6756BCF1E91366D4ECD2834A784A6991D0`). Esses hashes identificam **fontes baixadas**, não o hash do bundle implantado. Triagem automatizada de padrões de secrets: 0 alertas, **não prova ausência completa de segredos**. Fontes originais permanecem no computador do operador; **não foram publicadas no repositório**.
- **Achado P0 — arquivamento sem pré-verificação financeira na Edge legada:** as ações `excluir_comercio`, `marcar_comercio_deletado` e `marcar_meu_comercio_deletado` usam um único caminho interno (também acessível por `excluir_meu_comercio`). O admin é validado por JWT Auth e `ADMIN_USER_ID`, o proprietário via `cadastros_comercios.usuario_id`, mas **não há consulta às faturas/comissões/pedidos, nem chamada à RPC de encerramento financeiro**, antes de `comercios_publicados.status='deletado'`. O código em seguida limpa referências de fotos no cadastro, executa PUT no `DATA/comercios.json` da branch `main` do GitHub e enfileira limpeza Storage. Nos ambientes sem triggers financeiras, dívida ou pedido pendente não impedem o fluxo.
- **Evidência reproduzida em laboratório Node/VM com Supabase/GitHub simulados (sem rede, sem dados reais, sem transações):** proprietário autenticado e administrador autenticado, loja fictícia devedora e banco mock que permite UPDATE; ambas as rotas retornaram HTTP 200/`sucesso=true`, gravaram status `deletado`, fizeram 1 PUT simulado no GitHub e **0 consultas financeiras**. Este ensaio comprova o comportamento do código sob mocks, **não prova que o banco PROD atual aceite a operação**. Inventário real de 12/10 indicava ausência dos quatro triggers no PROD; revalidar metadados antes de eventual corte.
- **Achado P1 — consistência parcial:** o status de publicação é atualizado antes de editar cadastro e GitHub; a função de reversão `ee` não verifica `error`, e as reversões são operações distintas, sem transação PostgreSQL/GitHub. Falhas concorrentes ou de rede podem deixar status/fotos/JSON fora de sincronia. O código usa `deletado`, enquanto a RPC candidata de encerramento usa `arquivado`; revisar compatibilidade e decisão única em banco antes de sincronizar a vitrine.
- **Achado P1 — limpeza de fotos:** `parseStorageObjectReference` aceita URL externa de **qualquer hostname** contendo `/storage/v1/object/` e decodifica `%2F` dentro de segmentos, permitindo nomes com `../` embutido. O caminho legado enfileira referências na `storage_cleanup_queue` por ausência de outras referências, **sem comprovar propriedade do objeto**. Risco potencial de enfileiramento indevido de fotos; não equivale a prova de exclusão física, que depende do worker de retenção. Teste local do parser confirmou ambos os casos, sem chamar Storage real.
- **Achado secundário — WhatsApp:** GET confere `hub.verify_token`, mas o POST do webhook com `object='whatsapp_business_account'` não verifica `X-Hub-Signature-256`; também registra o payload completo em logs. Endurecer essa rota antes de promover a Edge (integridade do remetente e minimização de dados pessoais).
- **Controles preservados:** autenticação via `auth.getUser`, comparação explícita do admin fixo e checagem de proprietário foram identificadas; não há evidência de bypass JWT nessas rotas. Tokens de Supabase/GitHub/WhatsApp são lidos de variáveis de ambiente; não foram encontrados tokens literais pelo scanner utilizado.

### Correção mínima planejada para COB-06, sem aplicação automática

1. **Bloquear no banco** a despublicação, exclusão física e republicação devedora com os triggers/RPCs do pacote candidato já previsto, testados em clone real **sob transações com ROLLBACK**; nenhuma confiança isolada em validação HTTP. Não fazer nova migration fora do pacote sem defeito comprovado.
2. No fluxo da Edge, separar **pedido do proprietário** (RPC de solicitação, suspender catálogo e informar pendências) de **finalização administrativa** (RPC transacional restrita a `service_role`, com identidade verificada, revalidação de todas as dívidas/pedidos, status idempotente e trilha). Só atualizar `DATA/comercios.json`/fotos **após decisão segura confirmada**; nunca marcar `sucesso=true` se GitHub ou banco ficarem inconsistentes. Não usar compensação que reverta proteção financeira nem retirar dados do histórico.
3. Restringir referências Storage à origem Supabase esperada e a objetos associados ao comércio, rejeitar nomes ambíguos/segmentos codificados, revisar worker e verificar que eventual enfileiramento não causa exclusão indevida.
4. Testes offline e no clone cobrindo loja com dívida, pedidos abertos, admin/proprietário/outro usuário, concorrência, recusa SQLSTATE 23514, falha de GitHub e rollback, duplicidade e fotos de terceiros. **Não executar POST contra a Edge PROD nem PUT contra GitHub main no ensaio.**
5. Recuperação da fonte **não** conclui COB-06: manter `PR #39 Draft/HOLD` até backup off-host criptografado, testes do pacote real, revisão de rotas e autorização específica de release; sem deploy, produção, Asaas Pix ou saque.



## Correcao da Edge em branch Draft (14/10 BRT / 15/10 UTC) — sem deploy

- Fonte recuperada **incorporada somente a PR #39** em `supabase/functions/whatsapp-bot/index.ts` e `storage-path-utils.mjs`, commits `9566e599` e `a1534f56`. Nenhuma funcao implantada foi alterada. Os originais locais do operador permanecem intactos.
- A rota compartilhada de exclusao legada foi substituida por **duas etapas com RPC do banco**: dono autenticado e titular do catalogo chama `catalogo_solicitar_encerramento_financeiro` (retorna diagnostico de dividas/pedidos e **nao arquiva**); somente admin autenticado chama `catalogo_finalizar_encerramento_financeiro` e confirma que a publicacao ficou `arquivado` antes de publicar o estado oculto em `DATA/comercios.json`. Recusas ou RPC ausente retornam 409/503, **sem PUT no GitHub**. Comerciante sem catalogo recebe HOLD ate haver procedimento seguro especifico, sem fallback ao UPDATE antigo.
- A operacao **nao remove fotos do Storage nem do cadastro interno** e nao alimenta fila de limpeza: URLs sao removidas somente da vitrine JSON apos sucesso financeiro. Falha no PUT GitHub gera resposta **503, `pendente_sincronizacao=true`**, mantendo a decisao bancaria e permitindo tentativa idempotente posterior; nunca executa reversao SQL insegura.
- Testes em `tests/asaas-cob06-whatsapp-encerramento.test.cjs` (commit `77ff524a`) exercitam rotas de proprietario, admin, divida, falha de RPC, catalogo ausente, terceiro, status divergente, PUT GitHub interrompido e repeticao idempotente, com mock de banco e GitHub e **sem rede**. CI run [38671772569](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/38671772569) (attempt 2): **12/12 jobs PASS** apos uma unica repeticao de jobs bloqueados por limite externo de imagens PostgreSQL; job Node **801/801 testes PASS**, incluindo os 7 casos COB-06; job Deno de validacao de importacoes/source recuperada **PASS** apos adicao de `// @ts-nocheck` por a fonte de producao ser JavaScript minificado originalmente sem tipos TypeScript (nao tratar isso como prova estatica da logica). Fonte nao recebeu deployment.
- **Evidencia limitada:** testes Node mock nao equivalem a E2E da Edge contra um PostgreSQL real com pacote seletivo; nao houve teste de POST contra a funcao PROD, migracao PROD, limpeza real, nem sincronizacao verdadeira com GitHub. Faltam validar guardas com clone real, proteger webhook WhatsApp POST com assinatura, auditar caminhos de fotos e garantir copia off-host criptografada. **COB-06 aberta / PR Draft / PROD inalterado.**

## 15/10/2026 — retentativa após finalização no banco

Após o ensaio funcional aprovado com publicação técnica `deletado` e tombstone `arquivado`, foi identificada uma lacuna na Edge candidata da PR: o retorno antecipado para `status='deletado'` ignorava falha prévia de sincronização com `DATA/comercios.json`. A correção preserva o bloqueio financeiro e permite reexecutar a finalização administrativa idempotente para reconciliar a vitrine. O proprietário só recebe confirmação de finalização após leitura do tombstone e validação da titularidade do catálogo. Testes Node com Supabase/GitHub simulados foram acrescentados; nenhuma chamada foi feita à produção. A validação de execução HTTP real e a preparação segura de release continuam pendentes.


## 15/10/2026 — COB-06: HTTP e autenticidade do webhook na branch Draft (sem deploy)

- Teste `tests/asaas-cob06-whatsapp-http-real-handler.test.cjs` executou o **dispatcher HTTP `je()` real** com `Request` e `Response` do runtime Node e serviços simulados. Validou proprietario/autenticacao, admin/ID fixo, bloqueio por divida e comercio sem catalogo, falha e repeticao idempotente do PUT GitHub, JSON incorreto, metodo e OPTIONS. Não é requisição enviada ao endpoint publicado nem servidor Supabase real.
- Implementação na Edge candidata `0e842a7b`: WhatsApp `object=whatsapp_business_account` requer header `X-Hub-Signature-256` valido (HMAC-SHA256 do corpo exato em bytes), via `crypto.subtle.verify`; `WHATSAPP_APP_SECRET` deve ser configurado futuramente **como secret da função**, não no repositório/cliente nem confundido com `WHATSAPP_VERIFY_TOKEN` do handshake GET. Recusa se não houver secret (503) ou assinatura válida (401). Não registra payload pessoal completo em log. POST de ações administrativas conserva verificação JWT via `auth.getUser` e ID/titularidade.
- Testes HTTP offline usam chave **fictícia**, corpo adulterado, header inválido, nenhum header e secret ausente; todos recusados como esperado, exceto o corpo autenticamente assinado. CI Node [38677375062](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/38677375062): **822/822 PASS**. Ambiente publicado intacto.
- Gates restantes COB-06: revisão de fluxo para comércios sem catálogo (atualmente HOLD por design), verificação de integração HTTP em ambiente isolado representativo, proteção de objeto/Storage em rotas legadas não financeiras, segunda cópia criptografada off-host, configuração segura dos secrets e autorização explícita de release. Nenhuma decisão de merge/deploy neste documento.

- **15/10/2026 — CI completa do pacote HTTP/HMAC: 12/12 jobs PASS** no run [38677375062](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/38677375062), attempt 2. Primeira tentativa teve **11/12**, com falha externa `toomanyrequests: Data limit exceeded` ao iniciar PostgreSQL no Docker; única reexecução do job falho foi suficiente, sem mudanças de código. Testes Node **822/822 PASS**. Este aceite de CI **não autoriza deploy PROD**; COB-06 segue aberta pelos gates funcionais/operacionais ainda pendentes.
