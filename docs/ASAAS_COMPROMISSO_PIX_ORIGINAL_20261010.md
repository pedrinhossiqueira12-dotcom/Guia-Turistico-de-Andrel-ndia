# Compromisso HMAC de destino Pix antes do saque — etapa #41

**Data:** 10/10/2026. **PR #39:** Draft, sem merge ou implantação de produção.  
**Escopo exato:** saques *regulares futuros* do motoboy, não reservas contábeis excepcionais.  
**Não autoriza pagamento, baixa, liberação de crédito, Pix Automático nem alteração em produção.**

## Contexto e garantia limitada

A Edge `catalogo-asaas-financeiro` já calcula `pix_destino_sha256` com
HMAC-SHA256 de chave Pix e tipo canônico, baseado em segredo privado, e grava o
compromisso na reserva `catalogo_asaas_saques` antes de chamar `POST /v3/transfers`.
O HMAC não revela CPF/telefone/e-mail, desde que o segredo permaneça secreto.

A migration pendente `20261010004000_proteger_compromisso_pix_saque_antes_post.sql`
reforça esse fluxo no PostgreSQL:

- HMAC inicialmente **NULL** ao criar o saque; não permitir preencher no INSERT.
- A primeira gravação ocorre com status `reservado`, sem ID bancário e sem
  baixa, enquanto o titular e o valor da reserva permanecem os mesmos.
- O banco atribui automaticamente `pix_destino_registrado_em` no primeiro
  snapshot. Replays de mesmo HMAC não modificam o timestamp.
- Alterar, apagar ou retroativamente carimbar o HMAC é recusado, inclusive
  depois de `enviado`/`concluido`.
- Não permitir avançar `reservado → enviado` nem vincular um ID de banco
  a uma reserva nova sem HMAC carimbado previamente; não permitir gravação do
  HMAC e envio/associação bancária na mesma alteração.
- Prova local somente leitura `catalogo_asaas_diagnosticar_compromisso_pix_saque(uuid)`
  permitida exclusivamente a `service_role`, não expondo o hash em si.

**Esse carimbo é o momento do registro no banco do Guia, não o momento em que
o banco Asaas executou uma transferência.** Um HMAC único é compromisso
criptográfico local, mas NÃO comprova titularidade do beneficiário, que
a conta bancária pertence ao motoboy, nem que Pix realmente chegou.

## Registros antigos e reservas excepcionais

- Os HMACs que existiam **antes** da migration mantêm o campo novo de carimbo
  nulo. Não fabricar datas retroativas ou elevar sua classificação probatória.
- Mesmo saques antigos com `pix_destino_sha256` preenchido não passam a ter
  prova de pré-envio verificável por esta migration.
- A tabela `catalogo_asaas_separacoes_excepcionais` **não tem** compromisso
  pré-Pix do destinatário. Uma consulta bancária ou chave Pix atual do perfil
  não substitui esse compromisso.
- Uma transferência externa pode ter ocorrido sem ter sido vista pelo Guia.
  A ausência de ID local, de eventos ou de GET não é evidência de ausência de Pix.

## Critérios para conciliação futura

1. Preservar vínculo da solicitação, titular, valor e compromisso do destino
   **antes** de criar nova transferência, sob revisão independente.
2. Confrontar dados do `GET /v3/transfers/{id}`, eventuais webhooks idempotentes,
   comprovante bancário e beneficiário original; não basear decisão apenas
   em `DONE` ou em CPF mascarado do Sandbox.
3. Confirmar autorização contratual/regulatória do provedor antes de permitir
   envio a terceiros em produção.
4. Nenhum desbloqueio de escrow excepcional será implementado nesta fase.
5. Exigir revisão de SQL, RLS, funções `SECURITY DEFINER`, testes com
   `BEGIN/ROLLBACK`, CI totalmente verde e autorização humana separada para
   eventual migração de baixa/quitação.

## Testes e arquivos

- `tests/catalogo-asaas-compromisso-pix-imutavel.test.cjs` (contratos).
- `supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql`:
  ensaio de crédito fictício sem Pix, primeiro snapshot, repetição, tentativa
  de troca/remoção, criação com hash pré-preenchido, tentativa de associar
  transferência sem HMAC e proibição de envio com hash gravado no mesmo comando.
- As alterações ficam na branch até CI e revisão; **não publicar** secrets nem
  exportar evidências financeiras no repositório público.

Fontes: [Asaas — enviar Pix para outra instituição](https://docs.asaas.com/docs/transferencia-para-contas-de-outra-instituicao-pix-ted),
[Asaas — recuperar transferência](https://docs.asaas.com/reference/recuperar-uma-unica-transferencia),
[Asaas — eventos de transferência](https://docs.asaas.com/docs/webhook-para-transferencias).
