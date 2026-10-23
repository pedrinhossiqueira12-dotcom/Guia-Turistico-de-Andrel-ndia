# Homologação da cobrança mensal Pix — Asaas Sandbox

**Ambiente permitido:** Supabase `jbttwihctuibchhcyqtl`, Asaas **Sandbox**.
**Proibido:** alterar o projeto produtivo `xdmbkflufsfqziixzpxc`, transferir dinheiro real, forçar pagamentos no SQL, inserir créditos fictícios ou habilitar Money Out em produção.

## Resultado do preflight em 11/10/2026
- Migração incremental da inbox de webhooks aplicada em STAGING; 14/14 requisitos de esquema.
- Inbox preservou 4 eventos concluídos, sem pendências.
- Edge financeira v40 publicada no Sandbox antes dos commits deste diagnóstico; novas alterações exigem CI verde e novo deploy exclusivo STAGING.
- Existem **duas faturas Asaas pagas e nenhuma fatura aberta elegível** na consulta inicial. Sem cobrança pendente, ainda não foi possível homologar um novo pagamento ponta a ponta.
- O ID `ADMIN_USER_ID` da produção **não existe** em `auth.users` do STAGING. Não copiar credenciais produtivas e não contornar autenticação.

## Pré-condições antes do ensaio funcional
1. Criar normalmente **uma conta de administrador de teste** no Supabase STAGING, usando Auth do projeto de testes. Não conceder acesso para usuário arbitrário.
2. Um operador autorizado define no **Secrets do projeto de testes**, e somente ali, `ASAAS_SANDBOX_ADMIN_USER_ID` com o UUID exato da conta de QA. Se vazio, inválido ou não coincidente, o diagnóstico retorna HTTP 403. Não usar o ID do admin de produção.
3. Abrir `pages/entregas-operacao.html?asaas-sandbox=1` em um preview da branch de homologação; fazer login com **credenciais de teste**. Esse modo utiliza projeto STAGING e chave pública de testes, sem reaproveitar sessão produtiva. A consulta é SOMENTE leitura.
4. Criar no catálogo de testes um pedido/entrega de teste legítimos, consolidar comissões e **fechar normalmente a competência mensal** para gerar uma fatura em estado `faturado`, `vencido` ou `bloqueado` e valor positivo. Não mudar diretamente `catalogo_fechamentos_offline`, `catalogo_remuneracoes_v2` ou `catalogo_fatura_cobrancas` pelo editor SQL para fabricar saldo.
5. Executar “Verificar faturas de teste” no painel: **`pronta_para_emissao`** significa apenas que não há cobrança nem claim local. Não é prova de conta Asaas liberada ou de webhook funcional. **`emissao_reservada_para_conciliacao`** significa HOLD: nunca reemitir para tentar contornar.

## Confirmação simulada pelo próprio painel (sem expor chave Asaas)
- A ação de **simular pagamento** só aparece em faturas já fechadas, com cobrança Asaas local ainda pendente/vencida. Não cria fatura nem cliente.
- Administrador autorizado no projeto de testes configura os segredos `ASAAS_SANDBOX_ADMIN_USER_ID` e **`ASAAS_SANDBOX_QA_CONFIRM_ENABLED=true`**, além de `ASAAS_ENVIRONMENT=sandbox` e `ASAAS_BILLING_ENABLED=true` com credencial **Asaas Sandbox**. A configuração não é feita automaticamente. A chave Asaas permanece exclusivamente na Edge Function, nunca no HTML ou JavaScript.
- A rota administrativa `confirmar_fatura_sandbox_admin` recebe **somente o UUID de um fechamento**; a Edge confirma os vínculos no banco e faz GET da cobrança Asaas com ID, tipo Pix, pagador, referência, valor e estado idênticos. Somente então chama o endpoint oficial `POST /sandbox/payment/{id}/confirm`.
- A confirmação depende de **clique e confirmação humana** no painel. Se a cobrança já estiver `CONFIRMED` ou `RECEIVED`, a ação retorna o estado sem outro POST. Cancelamentos, estornos, contestação, divergência e produção são rejeitados. Não transforma `CONFIRMED` em `pago` nem registra pagamento por SQL: o evento deve passar pelo webhook autêntico.
- Depois do clique, verificar no painel o recebimento do evento, sua reconciliação e a mudança para `pago` apenas se o provedor retornar `RECEIVED`. **Sem o webhook não considerar E2E homologado**. Tokens não devem aparecer em screenshots ou logs.

## Roteiro do teste real no provedor Sandbox
1. Acessar a loja como seu proprietário de teste e aceitar os termos. No catálogo administrativo, consultar a fatura da competência fechada.
2. Solicitar **uma** emissão Pix pela ação existente `criar_cobranca`. Anotar o ID de cobrança Asaas retornado, a competência e o valor. Conferir QR/copia-e-cola e valor com a cobrança do provedor. Não realizar Pix real.
3. Repetir a consulta, sem emitir cobrança nova; conferir um único pagamento do Asaas para a referência `fatura-<comercio>-<AAAA-MM>` e uma única cobrança local.
4. **Confirmar a cobrança no próprio painel Asaas Sandbox** ou, com credencial de Sandbox protegida exclusivamente na estação do operador, utilizar o endpoint oficial `POST https://api-sandbox.asaas.com/v3/sandbox/payment/{id}/confirm`. A API faz **simulação**, sem dinheiro real. Nunca adaptar a URL para produção ou colar a chave API em chats, arquivos ou commits.
5. Verificar entrega do evento `PAYMENT_RECEIVED` (ou status bancário equivalente) ao endpoint `/functions/v1/catalogo-asaas-financeiro/webhook`. O evento precisa ser persistido **antes** do HTTP 200 e processado com GET autenticado ao Asaas. Verificar `catalogo_asaas_webhook_eventos.estado`, reprocessamento e inexistência de erros.
6. Consultar a fatura; somente status remoto `RECEIVED` autenticado pode levar a `pago`. Verificar exatamente **uma** quitação. `CONFIRMED` e pagamentos contestados não liberam crédito. Testar repetição do webhook.
7. Verificar as remunerações elegíveis do motoboy e os saldos **sem enviar saques**. Uma confirmação de cobrança não autoriza transferência bancária ou disponibilidade fictícia.
8. Em ensaio separado, testar status contestado/estornado, erro de comunicação e timeout, impedindo novo QR quando a cobrança não é pagável. Não reproduzir chargeback de terceiro real.

## Critério de liberação
- Anotar evidências de IDs fictícios/sanitizados, valor, data, resposta do Asaas, webhook, estado no PostgreSQL e ausência de POST duplicado.
- **CI verde + esquema STAGING apto + simulação Sandbox com provas e autenticação real + revisão humana**. Se faltar qualquer um, manter HOLD. Produção requer autorização expressa e separada do proprietário, adequação cadastral/contratual e avaliação operacional.
- **Saques Pix produtivos permanecem bloqueados**, inclusive se as cobranças mensais forem futuramente habilitadas.

Documentação oficial:
- https://docs.asaas.com/reference/confirmar-pagamento
- https://docs.asaas.com/docs/como-adicionar-dinheiro-para-testes
