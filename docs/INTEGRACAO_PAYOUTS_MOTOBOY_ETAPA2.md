# Etapa 2 — Mercado Pago Payouts (somente sandbox; sem dinheiro real)

**Status em 08/10/2026:** adaptador de integração criado e testado sem rede. **Não ativado no site, sem novas Edge Functions públicas e sem credenciais salvas.** PR #38 em rascunho.

## O que foi desenvolvido

- Adaptador servidor em supabase/functions/_shared/catalogo-payouts-sandbox-v2.ts.
- Constrói POST https://api.mercadopago.com/v1/payouts com uma transação Pix, valor convertido de **centavos inteiros**, chave Pix com tipo explícito e referência determinística originada do UUID da solicitação.
- Envia **somente em modo de teste**, exigindo testApproved=true, transporte HTTP injetado, credencial exclusiva de teste e headers X-test-token:true, X-enforce-signature:false e X-Idempotency-Key estável.
- Rejeita valores abaixo do mínimo do provedor (R$ 1), identificadores inválidos e destinatários sem chave/tipo Pix compatível.
- A criação com HTTP **202** fica em processamento; nunca registra como pago.
- Consulta GET /v1/payouts/{payout_id}/transactions/{transaction_id} e só **classifica** como confirmado quando status=success, status_detail=accredited, ID, referência, BRL e valor batem.
- Testes Deno em CI usam **fake transport e bloqueio de rede**, garantindo que não existe cobrança/transferência durante o teste.
- O módulo não está importado em nenhuma Edge Function publicada e não oferece caminho de ativação automática.

## Pré-requisitos externos (NÃO forneça tokens no chat nem no GitHub)

1. No Mercado Pago Developers > **Suas integrações**, verificar a disponibilidade/habilitação de **Payouts** para a conta que enviará os valores. O acesso ao checkout de pagamentos **não garante** habilitação de Payouts.
2. Ter aplicação/credenciais de TESTE de Payouts autorizadas. A eventual credencial MP_PAYOUTS_TEST_ACCESS_TOKEN deverá ser cadastrada **somente como segredo de backend**, sem commit e sem inclusão em HTML/JS público. O nome é proposto para a etapa 3; **ainda não existe Edge consumidora**.
3. Validar uma conta destinatária de teste e a chave Pix correspondente em ambiente de teste. O adaptador recebe pixType explícito: EMAIL, PHONE, CPF, CNPJ ou PIX_CODE; **não infere tipo por texto ambíguo**. O formulário atual armazena apenas a chave, portanto na etapa 3 deverá ganhar seleção/verificação do tipo pelo backend, sem enviar Pix por dados não verificados.
4. O valor vem exclusivamente de créditos financiados do banco, não do navegador. É necessário reservar o lote transacionalmente antes de qualquer POST e armazenar **uma mesma chave de idempotência** para retries.
5. Para produção é obrigatória **assinatura Ed25519** no corpo em X-signature e processo de cadastramento de chave pública junto ao Mercado Pago. **Isso não está implementado**, deliberadamente. Não use o adaptador sandbox para produção.

## O que falta para o saque automático (etapas 3–5)

- Registrar intent / estado reservado, enviando, aguardando_confirmacao, pago, falhou, em_analise, com locks, idempotência por lote e correlação por IDs do provedor.
- Autorizar somente backend/admin/cron com segredo e autenticação independente; não criar endpoint público de pagamentos acionável via navegador.
- Atualizar perfil do motoboy para salvar **tipo de chave** e proteger alterações quando houver uma transferência pendente.
- Processar webhook como **sinal**, mas confirmar status fazendo GET autenticado do provedor. Eventos podem chegar atrasados, repetidos ou fora de ordem. Confirmação deve comparar beneficiário, valores, moeda, IDs e referências.
- Permitir reprocessamento seguro de timeout sem criar outro payout; travar saque contra chargeback/estorno e bloqueio de lastro.
- Produção requer política de limites, monitoramento, reconciliação e homologação real de teste antes de ligar transferências.
- O status pago não pode decorrer de resposta HTTP 202, nem de solicitação criada.

## Documentação oficial consultada

- https://www.mercadopago.com.br/developers/pt/docs/payouts/overview
- https://www.mercadopago.com.br/developers/pt/docs/payouts/integration-configuration/money-transfers
- https://www.mercadopago.com.br/developers/pt/docs/payouts/integration-test
- https://www.mercadopago.com.br/developers/pt/docs/payouts/notifications
- https://www.mercadopago.com.br/developers/pt/docs/payouts/go-to-production


## Etapa 3A — reserva bancária implementada no PR (sem publicação)

A migration ainda NÃO aplicada em produção, 20261008150000_solicitacao_saque_mensal_motoboy.sql, foi ampliada com:

- Tabela restrita catalogo_payout_intents_v2: exatamente **uma intenção por solicitação**, ID de idempotência e referência externa únicos, snapshot da chave Pix protegido por AES-GCM (sem chave em texto), estado e timestamp da tentativa.
- RPC privada catalogo_reservar_payout_v2(uuid,text): somente service_role, trava a solicitação, perfil e créditos no banco; só reserva se TODOS os valores e o lastro coincidirem. **Mínimo de R$ 1,00 por payout**, mesmo que a solicitação de ganhos possa ser inferior.
- RPC privada catalogo_marcar_envio_payout_v2(uuid): primeira tentativa vira em_envio, com contador 1. Uma segunda tentativa recebe 409; a próxima integração deverá consultar primeiro o provedor, NÃO repetir um POST de resultado indeterminado.
- Trigger catalogo_bloquear_repasse_reservado_v2: bloqueia registrar status pago manualmente em créditos com payout reservado.
- Trigger catalogo_revisar_payout_apos_estorno_v2: muda intenção em curso para em_analise ao ocorrer estorno/chargeback.
- Teste PostgreSQL real em SAVEPOINT/ROLLBACK, com dados fictícios: reserva com R$ 12,34, idempotência, bloqueio de segundo envio, bloqueio de baixa manual e retenção em estorno. Nada é persistido ao término.

**Bloqueios intencionais:** estas RPCs não enviam Pix, não registram status pago e NÃO estão chamadas por Edge Functions públicas. O tipo Pix é passado somente pelo backend privilegiado e ainda precisará ser confirmado pelo motoboy em campo tipado; hoje a UI não o coleta. Tampouco há conciliação final de sucesso autorizado: o bloqueio contra baixa dupla impede dar baixa nesses créditos até que seja construído o fluxo transacional de confirmação do provedor.

A rotina de reserva ainda precisa de revisão final, homologação sandbox e controle de credenciais antes de liberar qualquer operação real. Não fazer merge do PR #38 para produção por considerar estes testes equivalentes a repasse de dinheiro.



## Etapa 3B — conciliação bancária e orquestração Sandbox (sem publicação)

- A mesma migration do PR adiciona auditoria em catalogo_repasses_v2: origem_registro=admin_manual com registrado_por obrigatório ou origem_registro=payout_provedor com registrado_por NULL. Isso evita atribuir ao administrador transferências efetivadas pelo sistema.
- Intenções possuem repasse_id, confirmado_em e ultima_consulta_em.
- RPC privada catalogo_registrar_criacao_payout_v2(uuid,text,text) recebe IDs POP/TOP da resposta 202, armazena os IDs e mantém aguardando_confirmacao; IDs repetidos iguais são idempotentes e divergências retornam 409.
- RPC privada catalogo_conciliar_payout_v2(uuid,text,text,text,text,bigint,text,text) confere IDs, duas referências, valor, estados e lastro. Pendente nunca gera repasse; erro não comprovado vai para análise; somente success/accredited recebido pelo backend a partir de GET autenticado aciona baixa.
- Com sucesso confirmado e lastro íntegro, a RPC cria **um** repasse com prova do provedor e autoria de sistema, atualiza a intenção, os créditos e os lançamentos financeiros **na mesma transação**. A confirmação repetida retorna idempotente=true e não cria outro repasse.
- A trigger que bloqueia baixa manual agora aceita status pago apenas para a intenção confirmada e vinculada ao **mesmo** repasse criado pelo fluxo do provedor. Tentativas concorrentes sem essa confirmação continuam bloqueadas.
- Módulo interno catalogo-payouts-worker-sandbox-v2.ts (não importado em rotas públicas) encadeia a marcação de tentativa, a criação de payout e o registro dos IDs, ou consulta o GET e invoca a RPC de conciliação, sempre com transporte injetado e autorização de teste.
- Em timeout depois de marcar envio, o processo **não repete o POST**. Sem IDs do provedor para GET, fica pendente de busca por referência e investigação administrativa; não é seguro assumir nem falha nem sucesso.
- Testes com respostas simuladas, Postgres descartável e rollback: HTTP 202 ≠ pago; GET pending ≠ pago; prova divergente ≠ pago; sucesso autenticado simulado → baixa atômica, histórico íntegro; confirmação repetida → mesmo repasse.
- **Não foi feita verificação HTTP de um Payouts real**. Os fatos success/accredited nos testes são sintéticos. O backend de produção que obterá a prova deve ser mantido com credencial service_role isolada e conexão segura, nunca exposto ao navegador.
- **Não foi ativado em produção**: falta configuração do tipo da chave Pix no perfil, API Payouts habilitada para esta conta, credenciais e assinatura de produção, assinatura/revisão de webhooks, teste sandbox real, observabilidade e validação operacional.

### Alerta de segurança

A RPC financeira aceita fatos recebidos por um serviço com service_role. Ela não faz uma consulta independente ao Mercado Pago por SQL, portanto a sua segurança depende de o worker privado executar o GET e comparar os fatos antes de chamá-la. O código do worker é uma biblioteca não implantada, não um servidor de pagamentos ativo. **Não publicar uma rota que simplesmente retransmita parâmetros do usuário a essa RPC.**



## Etapa 3C — tipo da chave Pix e bloqueio de alterações

- O motoboy agora seleciona explicitamente o tipo (CPF, CNPJ, EMAIL, PHONE ou PIX_CODE) no painel. O cliente manda apenas os campos permitidos e a Edge identifica a conta pelo JWT autenticado; IDs do cliente não escolhem a conta a alterar.
- O backend confirma **sintaxe/formato**, incluindo dígitos verificadores para CPF/CNPJ, telefone internacional com +55, e-mail e UUID para chave aleatória. Isso NÃO comprova titularidade nem que a chave exista no DICT: a verificação do beneficiário exige homologação/consulta de provedor.
- A chave segue cifrada em AES-GCM e o novo campo chave_pix_tipo é salvo apenas junto com ela, pela RPC privada catalogo_salvar_chave_pix_tipado_v2. O perfil antigo continua com chave cifrada, mas tipo nulo; deve ser atualizado pelo próprio motoboy antes de solicitar saque.
- A reserva financeira exige que o tipo do perfil corresponda ao tipo da intenção. O banco recusa alterações/remoções de tipo ou chave durante payout reservado, em_envio, aguardando_confirmacao ou em_analise.
- A leitura autenticada do extrato devolve o tipo escolhido. Logout, troca de conta e limpeza de sessão apagam chave e tipo da interface.
- A validação do Payouts Sandbox usa o mesmo módulo de validação; testes Deno/SQL/Node abrangem formato e isolamento.
- **Permanece desativado:** nenhuma Edge pública tem rota de saque automático; não há credenciais de Payouts, verificação de titularidade no provedor, homologação Sandbox real ou assinatura Ed25519 de produção. Não realizar merge e deploy financeiro ainda.

