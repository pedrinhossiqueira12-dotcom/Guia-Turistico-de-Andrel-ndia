# COB-06 — novo corte seletivo de revisão: 9 + 5 SQL

Base de retomada: `6c29bf35410dcc6c93719c534cf13cb406b8b06e`, PR #39 Draft.
**CANDIDATO / HOLD. Revisão local autorizada; instalação não autorizada.**
As cinco correções já implementadas não foram reescritas. O perfil padrão do
empacotador continua `original-9`; o novo perfil explícito é `audit-14`.

## Identidade e ordem

Os passos 1–9 são exatamente os arquivos, na ordem e com os blobs do
`asaas-cob06-billing-only.lock.json`. Nenhum SQL ou hash original foi alterado.
O lock adicional `asaas-cob06-auditoria-review.lock.json` vincula por SHA-256
os bytes desse lock original e congela separadamente os cinco novos blobs.
O manifesto do ZIP lista a ordem completa e SHA-256 de cada fonte incluída.

| Passo | Candidato em `supabase/production-candidate/` | Dependência e efeito revisado |
| --- | --- | --- |
| 10 | `cob06-auditoria-01-pendencias.sql` | Substitui apuração de encerramento após as guardas originais; inclui saldo fora de snapshot sem mudar fatura paga. |
| 11 | `cob06-auditoria-02-emissao.sql` | Exige journal Asaas do passo 1 e registrador MP do baseline; reserva comum, identidade bancária e snapshot imutáveis. |
| 12 | `cob06-auditoria-03-inadimplencia.sql` | Envolve conciliador resultante do passo 9; reconta obrigações com locks loja → fechamento → cobrança. |
| 13 | `cob06-auditoria-04-vitrine.sql` | Envolve os dois finalizadores do passo 3; journal privado na transação, fila até ACK autenticado após GitHub. |
| 14 | `cob06-auditoria-05-andamento.sql` | Exige RPCs V2 de operação/entrega do baseline; marco de suspensão e continuidade restrita a aceite anterior comprovado. |

É uma ordem de revisão, sem executor SQL. Cada arquivo conserva seus próprios
limites transacionais. O corte não é atômico como conjunto; eventual falha entre
arquivos exige diagnóstico da instalação parcial antes de qualquer continuação.
Os candidatos com `RENAME`/`CREATE FUNCTION`, novas tabelas, colunas e triggers
**não são reaplicáveis indiscriminadamente**. Não substituir funções renomeadas
por aliases arbitrários para fazer o pacote passar.

## Dependências de runtime incluídas

Além das fontes do perfil original, o novo perfil inclui:

- `catalogo-fatura-pix/index.ts` e `fatura-utils.mjs`: reserva MP antes do POST e
  consulta histórica no provedor original; nenhuma emissão com fallback.
- `catalogo-pedidos-offline-admin/index.ts` e seus imports locais: permite que
  o SQL decida continuidade de pedidos anteriores à suspensão.
- Os dois locks e os documentos desta revisão e das cinco correções.

As fontes já incluídas `catalogo-asaas-financeiro`, `whatsapp-bot`,
`js/catalogo-admin.js` e `js/admin-encerramentos.js` cobrem consulta por gateway,
ACK da vitrine, fila pendente e isolamento da sessão do painel suspenso.
Imports locais são resolvidos recursivamente com allowlist, e os arquivos têm
hash no manifesto. Dependências npm permanecem nas versões declaradas nas fontes;
o ZIP não é bundle autossuficiente de execução. As Edge e UI são fontes completas
para comparação seletiva: presença no ZIP não autoriza substituir código publicado.
Não foram incluídos entrypoints de saque, QA ou SQL de acúmulo/baixa CI-only.
Helpers mistos já importados pela Edge permanecem sujeitos às guardas existentes;
não interpretar inclusão transitiva como liberação de funcionalidades.

## Revisão antes de futura instalação autorizada

Comparar no ambiente correto, em janela autorizada, definições, assinaturas,
owners, `search_path`, ACL e sobrecargas das funções substituídas/renomeadas:

- P1: `catalogo_private.catalogo_pendencias_encerramento(text)`.
- P2: `public.catalogo_registrar_cobranca_fatura(uuid,text,integer,text,text,text,timestamptz,text)`.
- P3: `public.catalogo_confirmar_cobranca_fatura(text,text,text,integer,text)`.
- P4: `public.catalogo_finalizar_encerramento_financeiro(text,uuid)` e
  `public.catalogo_arquivar_sem_catalogo_admin(text,uuid)`.
- P5: `public.catalogo_operar_pedido_v2(uuid,text,uuid,text,uuid,text)`,
  `public.catalogo_confirmar_entrega_autenticada(uuid,text,uuid,text,text)` e
  `public.catalogo_confirmar_entrega_motoboy(uuid,text,uuid,text)`.

Conferir ausência prévia dos nomes internos `*_pre_auditoria`, `*_pre_vitrine`
e `*_pre_suspensao`, objetos novos e eventual instalação parcial. Os nomes
internos devem continuar sem EXECUTE para PUBLIC/anon/authenticated/service_role;
RPCs externas novas permanecem service_role-only. RLS do journal não concede
escrita direta. A identidade administrativa deve ser validada pela sessão real
na Edge; não copiar usuários entre ambientes nem publicar dados de Auth.

Suspensões históricas sem marco confiável ficam HOLD para revisão do operador;
não preencher datas retroativas. Sem rollback destrutivo: desativação operacional
e recuperação precisam preservar reservas, dívidas, snapshots, aceites e journal.
Não reaplicar as nove fontes sobre ambiente que já as recebeu. A ordem integral
serve ao baseline ainda sem o corte; instalações divergentes exigem plano próprio.

## Verificação e limites

Comandos somente offline, a partir da raiz (Python 3.9+):

```text
node scripts/validacao-pagamentos/asaas-cob06-validar-billing-only.cjs
python scripts/validacao-pagamentos/asaas-cob06-empacotar-release-offline.py --profile audit-14 --check
python scripts/validacao-pagamentos/asaas-cob06-empacotar-release-offline.py --profile audit-14 --build <arquivo-local.zip>
python scripts/validacao-pagamentos/asaas-cob06-empacotar-release-offline.py --profile audit-14 --verify <arquivo-local.zip>
python -m unittest discover -s tests -p test_asaas_cob06_release_bundle.py
```

**CI do corte `audit-14` confirmada em 21/10/2026:** commit
[`e7ca504`](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/commit/e7ca5044d6732d3c3eebb97e7b5031887e4c1894),
[Actions 39671658148](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/39671658148),
**12/12 jobs PASS**. O workflow precisou corrigir a indentação de duas etapas
do perfil audit-14; o código financeiro e os SQLs não foram alterados nesse commit.
O job de pacote offline executou **11 testes Python PASS**, verificou os perfis
original-9 e audit-14, gerou ambos ZIPs e publicou artefatos distintos de revisão.
SHA-256 do ZIP audit-14 **exclusivamente desse run**:
`1ee3c8c163a3abfe7fc871ebdca2f22f6d55da1b002abab8fd8e1afc2ee820be`.
Ele contém 14 SQLs, 31 fontes complementares e não faz deploy.
SHA-256 do ZIP original-9 desse run:
`1bf2cc7a137fa6b75917ed9f739d439bb12e3b31a201a163f16c257652c9263e`.
Uma alteração documental posterior pode produzir ZIP de hash diferente;
essa prova não valida o ambiente remoto nem autoriza instalar SQL.
Não repetir o ensaio aceito do operador nem acessar backup/clone privado.

Permanecem pendentes revisão independente, equivalência com definições reais,
recuperação funcional/off-host e homologação operacional delimitada. O lote QA
histórico não recebe novo GET/reserva nem prova reconstruída. Acúmulo, saques e
Pix Automático continuam HOLD. COB-06 não encerrada; COB-07/08 não autorizadas.

## Revisão local adicional do corte completo — 21/10/2026

Retomada sincronizada por fast-forward em `82286e0e1c0203209d9dcdef56136949fa1a0a7b`,
árvore limpa; PR #39 aberta/Draft. A CI desse HEAD, [run 39682624521](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/39682624521),
teve **12/12 jobs success**, conferidos individualmente. Revisados os cinco SQLs
forward-only, os dois locks, o empacotador e a montagem do clone no workflow.
Não houve novo defeito de runtime demonstrado nesta revisão. Nenhum dos 14 SQLs
ou dos dois locks foi modificado. Esta revisão técnica local não substitui a
comparação com definições publicadas nem constitui aprovação operacional externa.

| Fronteira | Dependência efetiva e conclusão da leitura |
| --- | --- |
| Passos 1–9 | Permanecem na ordem do lock original. Fornecem journal Asaas, aceites/encerramento, proteção de dívida, status público e conciliação por componentes. O passo 9 é a implementação que o passo 12 renomeia. |
| Passo 10 / P1 | Lê fechamentos, comissões, pedidos e componentes V2 do baseline; substitui helper privado utilizado pelas guardas de encerramento. Não necessita tabelas de acúmulo nem reescreve snapshot pago. |
| Passo 11 / P2 | Depende do journal do passo 1 e do registrador MP anterior; triggers compartilham reserva e congelam identidade/snapshot. O runtime MP deve reservar antes do POST e conservar consulta do gateway histórico. Reserva permanente não recebe retry automático. |
| Passo 12 / P3 | Chama a implementação do passo 9 por nome interno revogado; serializa loja → fechamento → cobrança, reconta obrigações e conserva bloqueios administrativos. A prova concorrente já existente continua no PostgreSQL descartável da CI. |
| Passo 13 / P4 | Envolve finalizadores do passo 3; journal privado é gravado na mesma transação. Edge autenticada confirma ACK somente após GitHub. A fila não autoriza pagamento nem permite escrita direta no journal. |
| Passo 14 / P5 | Envolve três RPCs do baseline V2; trigger protege novos pedidos/aceites. Continuidade exige aceite anterior ao marco confiável e preserva verificações de titular, motoboy e código nas implementações internas. Histórico sem marco permanece HOLD. |
| Rate limit da Edge | `catalogo_offline_consumir_limite(text,integer,integer)` pertence ao baseline (`20261005130000_catalogo_offline_rate_limit.sql`), não é criada pelos 14 SQLs. Verificar sua presença/ACL no destino antes de publicar a Edge; ausência deve continuar falhando fechada. |
| Runtime e serviços | Imports locais do ZIP são resolvidos pelo empacotador; versões npm continuam declaradas nas fontes. GitHub, Auth, webhook/worker, Secrets e hospedagem não são instalados pelo ZIP. SQLs de baixa/acúmulo CI-only e entrypoints de saques continuam excluídos. |

**Cobertura integrada nova:** `tests/cob06-audit14-seguranca-integrada.test.cjs`
usa o harness PGlite existente, sem filesystem de banco, rede ou credenciais.
Aplica os **14 arquivos exatos dos locks**, sobre migrations reais do harness e
tabela sintética de publicação, com cobrança MP paga preexistente de 700 centavos.
Confere preservação de todas as colunas dessa cobrança antes/depois, ausência de
tabelas de saque/acúmulo, sete nomes internos sem EXECUTE de clientes/backend e
recusa efetiva **SQLSTATE 42501** de dez RPCs para cada papel `anon`/`authenticated`,
mesmo passando o UUID administrativo fictício. Como `service_role`, nega chamada
interna e INSERT no journal, recusa administrador/titular alheios e executa
solicitação → arquivamento → fila pendente → ACK pela API SQL autorizada.
O ACK é sintético: não representa escrita real no GitHub.

**Resultado local:** teste integrado PASS; suíte `npm.cmd test` **998/998 PASS**;
verificador das nove fontes `COB06_BILLING_ONLY_LOCK_OK`; diff sem erro de espaços.
O uso de `npm.cmd` evita a política local que bloqueia o wrapper `npm.ps1`, sem
alterar essa política. Python não está instalado neste Windows (somente aliases
WindowsApps); os testes/ZIP Python dependem do job existente da CI.
PGlite não comprova corrida de conexões, Auth/JWT real, PostgREST, Storage ou
paridade com o banco publicado. Não foi repetido o ensaio aceito do operador.

**Próxima etapa operacional, ainda não autorizada:** confrontar este corte com
assinaturas, definições, owners, search_path, ACL e objetos reais, detectar
instalação parcial e comparar fontes Edge/UI antes de elaborar a instalação
específica do destino. Os gates antigos de readiness/segurança cobrem o corte
original; passar neles sozinho não aprova os cinco candidatos adicionais.
Permanecem abertos recuperação funcional/off-host, política Auth/MFA administrativa,
cabeçalhos de hospedagem, configuração efetiva dos webhooks/worker e homologação
financeira delimitada. Não pedir repetição das provas SQL/Storage já aceitas.
Nenhuma consulta PROD/STAGING, GET bancário, deploy, flag/Secret, Pix ou merge foi
executado. Lote histórico intocado; COB-06 continua aberta/HOLD.
