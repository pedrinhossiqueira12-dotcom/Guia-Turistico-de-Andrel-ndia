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

A CI anterior do HEAD de retomada, run `39655863768`, foi conferida: 12/12 PASS.
Ela valida o código anterior e a instalação sintética já existente dos cinco
candidatos; não valida retroativamente o novo perfil. A CI deste corte deverá
validar também os dois perfis, adulteração, ordem e reprodutibilidade do ZIP.
Não repetir o ensaio aceito do operador nem acessar backup/clone privado.

Permanecem pendentes revisão independente, equivalência com definições reais,
recuperação funcional/off-host e homologação operacional delimitada. O lote QA
histórico não recebe novo GET/reserva nem prova reconstruída. Acúmulo, saques e
Pix Automático continuam HOLD. COB-06 não encerrada; COB-07/08 não autorizadas.
