# COB-06 — acumulação de comissões abaixo de R$ 5 (decisão aprovada)

**Decisão do proprietário em 15/10/2026.** Escopo restrito à COB-06 da backlog financeira da PR #39. **Estado: regra aprovada; reserva contábil transacional no candidato SQL e pré-validação testadas em PostgreSQL descartável. Emissão Pix, conciliação intercompetências de pagamento/estorno, homologação e liberação continuam pendentes.** Este documento não autoriza alteração em produção, emissão Pix, saque ou merge.

## Regra aprovada

Uma fatura mensal de comissões inferior a **500 centavos** não deve ser cobrada isoladamente no Asaas, aumentada artificialmente até o mínimo, cancelada nem marcada como paga. A dívida continua devida, e os valores de meses posteriores do **mesmo comércio** podem ser somados até atingir pelo menos R$ 5. A composição deve identificar cada competência, pedido, comissão de plataforma e remuneração de motoboy elegível. A cobrança consolidada deve ser única e idempotente.

Exemplo: outubro com R$ 1 e novembro com R$ 4 geram cobrança total de R$ 5, mantendo a origem de R$ 1 e de R$ 4. Outro exemplo: R$ 2 + R$ 2 + R$ 1 em três competências gera uma cobrança total de R$ 5, não três cobranças.

**Encerramento antecipado:** se o comércio solicitar encerramento ainda com menos de R$ 5, suspender novos pedidos, manter a dívida e encaminhar à regularização separada e comprovada; não arquivar definitivamente, inventar pagamento ou extinguir créditos do motoboy.

## Avanço implementado na PR Draft (sem ativação)

- **Ledger de agrupamento privado:** `supabase/production-candidate/03_cob06_acumulo_intercompetencias_preparacao.sql` (commit `9133a344`, ajuste SQL `dfb0806f`) cria `catalogo_asaas_acumulo_lotes` e `catalogo_asaas_acumulo_fontes`. `fechamento_id` é chave primária nas fontes (uma origem não pode pertencer a dois lotes), e `(comercio_id,competencia_corte)` é único nos lotes. As duas tabelas têm RLS e não concedem escrita nem à `service_role`: **nenhum agrupamento real é criado ou emitido por esta versão**.
- **Pré-validação somente leitura:** `catalogo_asaas_previsualizar_acumulo(text,date)` é executável só pela `service_role`; consulta até uma competência, exclui faturas pagas, emitidas, com reserva bancária ou já agrupadas, e compara a soma de `catalogo_fatura_componentes_v2` com cada fechamento. Retorna `pronto_para_preparar=false` quando falta qualquer snapshot, além do resumo financeiro. Não cadastra clientes, cria reserva, chama o Asaas nem quita créditos.
- **Prova automatizada inicial:** `supabase/tests/isolated/asaas-cob06-acumulo-preview-rollback.sql` roda no `catalogo_cob06_ci` da GitHub Actions, após o pacote original das nove fontes, testa cenário R$1+R$4 ainda sem snapshots e exige **negação**, unicidade de vínculos e ausência de resíduos após `ROLLBACK`. O teste estático Node `tests/asaas-cob06-acumulo-r5-preparacao.test.cjs` impede ligações prematuras com emissão de Pix. **Isto não é teste de cobrança real nem prova de agrupamento completo.**
- **Isolamento do pacote original:** a décima fonte é um candidato **separado e inerte**, executado apenas após as nove fontes em PostgreSQL descartável na CI. Não foi anexada ao pacote de produção congelado nem ao runner manual do clone real.

## Reserva do livro implementada (sem integração bancária)

A rotina `catalogo_asaas_reservar_acumulo(text,date)` foi acrescentada apenas ao candidato `03_cob06_acumulo_intercompetencias_preparacao.sql`: usa trava consultiva da mesma loja, `SELECT ... FOR UPDATE` sobre competências elegíveis, compara soma de componentes e fechamento e registra lote e fontes numa única transação. Se ainda não atingir R$5, faltar snapshot ou houver reserva/cobrança anterior, não emite Pix nem inventa quitação. O mesmo corte reaproveita o lote já reservado; uma fonte é única entre lotes.

Triggers candidatos bloqueiam INSERT de cobrança/emissão individual em fontes agrupadas e alterações posteriores de valores/competência do fechamento ou seus componentes. A função é `service_role` exclusiva e a Edge **ainda não a chama**. Nenhum `/payments` foi enviado, nenhum crédito de motoboy foi liberado e não existe função que transforme esses lotes em cobrança bancária.

A GitHub Actions aplica primeiro o pacote congelado de nove SQL em `catalogo_cob06_ci`, depois somente neste banco descartável aplica o SQL candidato 03 e executa os ensaios dentro de `BEGIN/ROLLBACK`. Os cenários sintéticos são **R$1+R$4** e **R$2+R$2+R$1**, além de fonte duplicada, reserva repetida, exclusão/alteração de snapshot, emissão individual proibida e histórico Mercado Pago pago intacto. A primeira CI corrigida passou no cenário R$1+R$4 (run `38777198026`, job de SQL PASS); aprovação dos cenários ampliados depende do run mais recente. **Isto não substitui restauração de backup de produção nem prova de pagamento.**

## Preflight contábil intercompetências, sem baixa bancária

O candidato **`supabase/production-candidate/04_cob06_conciliacao_preflight_inerte.sql`** (commit `86c31d8`) implementa `catalogo_asaas_conferir_conciliacao_acumulo(uuid)`, RPC **somente leitura** e executável apenas por `service_role`. Confere cada origem do lote contra sua fatura, competência, comércio, status, soma das parcelas e quantidade de pedidos, comparando cada parcela com a comissão e o pedido de entrega física confirmado. Se faltarem comissão, snapshot, confirmação de entrega ou qualquer valor, retorna `integridade_contabil_ok=false` e contabiliza as parcelas inválidas. Nunca aceita origem com cobrança ou emissão bancária individual já registrada.

**Mesmo quando a contabilidade confere, esta versão sempre devolve `pode_emitir_pix=false`, `pode_quitar=false`, `pode_estornar=false` e `pode_liberar_motoboy=false`.** A comprovação bancária Asaas vinculada ao lote ainda não foi projetada/validada como fonte confiável. Não há função de mutação do estado financeiro, POST Pix, webhook de lote ou alterações em repasses.

**Prova CI (15/10/2026):** run [38779330385](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/38779330385), job PostgreSQL **PASS**, incluindo `COB06_CONCILIACAO_ORIGENS_INCOMPLETAS_BLOQUEADAS_SEM_CREDITO_OK` dentro de `ROLLBACK` para os lotes R$1+R$4 e R$2+R$2+R$1; teste Node também aprovado (**830/830**). Esse teste prova a **recusa segura de origens incompletas**, não a conclusão de uma quitação real. A CI global do run pode ainda depender de jobs de infraestrutura.

## Referência bancária única — reserva interna sem pagamento

O candidato isolado `supabase/production-candidate/05_cob06_referencia_bancaria_inerte.sql` cria `catalogo_asaas_acumulo_referencias`: **uma referência determinística por lote** (`guia-acumulo-<uuid>`), UUID de operação estável, valor exato do lote e índice único para impedir outra intenção pendente do mesmo comércio. Usa **RLS**, SELECT exclusivamente para `service_role` e trigger que recusa qualquer UPDATE ou DELETE. `payment_id` é obrigatoriamente **NULL** e `pode_emitir_pix` obrigatoriamente **FALSE**, inclusive com acesso SQL: não existe integração com /payments.

A RPC `catalogo_asaas_reservar_referencia_acumulo(uuid)` é exclusiva da `service_role`. Trava lote e comércio, exige preflight contábil positivo do candidato 04 e recusa fontes incompletas; chamadas repetidas retornam exatamente a operação/referência já registrada. **Nem mesmo uma intenção bem formada pode emitir Pix ou marcar fatura como paga.** Após falha de comunicação futura, o procedimento seguro será reconciliar a referência por consulta bancária verificada (GET) antes de cogitar nova emissão; nenhuma nova tentativa POST automática existe.

**Evidência CI:** job PostgreSQL [38781300590](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/38781300590) aprovado, com marcador `COB06_REFERENCIA_UNICA_IDEMPOTENTE_SEM_PIX_OK`, lote R$1+R$4 com componentes sintéticos válidos, recusa do lote incompleto, tentativa concorrente da mesma loja, recusa de mutação da referência, preservação da cobrança Mercado Pago paga e `ROLLBACK`. O job Node também passou. O teste é **exclusivamente local/sintético**, não há identificador de pagamento real nem cliente Asaas associado ao lote.

**Próximos gates:** desenhar e testar observação de ID de pagamento remoto a partir de GET verificado com referência, cliente, valor, estado e idempotência; webhook/reconciliação e liquidação/estorno de todos os componentes das competências; remuneração do motoboy elegível; prova E2E Sandbox/STAGING; recuperação de dados e autorização de produção. Não substituir o CHECK `payment_id IS NULL` nem liberar emissão antes desses gates.

## Observação bancária verificada por GET — sem baixa e sem Pix

O SQL candidato `supabase/production-candidate/06_cob06_observacao_bancaria_sem_baixa.sql` cria o livro privado, append-only, `catalogo_asaas_acumulo_observacoes`: um lote por payment ID e um payment ID por lote, com cliente, referência, valor exato e **status da primeira observação**. O RPC `catalogo_asaas_registrar_observacao_acumulo` é restrito à `service_role`, revalida o cliente cadastrado, total, referência imutável e integridade das fontes e recusa replay divergente. **O SQL sozinho não pode provar a autenticidade de argumentos apresentados como "GET": isso exige backend autenticado consultando o Asaas.** Nem a tabela nem a RPC alteram estados pagos, estornos, créditos ou saques.

O módulo candidato não publicado `supabase/functions/_shared/catalogo-asaas-acumulo-get-verificado-inerte.ts` implementa essa verificação *no backend* antes da tentativa de registrar a observação: ID do pagamento, referência exata `guia-acumulo-<lote UUID>`, customer ID da loja, modalidade `PIX`, conversão de centavos sem arredondamento e status remoto reconhecido. Falha de GET, valor divergente, status desconhecido ou ACK SQL diferente de `pode_quitar=false` e `pode_liberar_motoboy=false` mantém HOLD. **O módulo ainda não é importado pela Edge pública nem há GET real executado pelo servidor**: os testes injetam respostas remotas simuladas, sem chamadas HTTP reais, para comprovar somente o contrato de segurança.

Evidência CI [38783258331](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/38783258331): PostgreSQL descartável passou com `COB06_OBSERVACAO_GET_SIMULADO_IMUTAVEL_SEM_BAIXA_OK` e `ROLLBACK`, rejeição de cliente/valor/referência divergentes, replay divergente e tentativa de UPDATE/DELETE; **832/832 testes Node PASS** e **115/115 testes Deno PASS** (cinco cenários GET novos). Nenhuma alteração de produção/STAGING nem de dados existentes.

**Pendentes:** integração efetiva somente GET ao Asaas pelo backend sob permissão de auditoria, vinculação de estado remoto por eventos independentes, transição contábil paga/estornada/contestada de **todas** as competências e cada componente, financiamento do motoboy, histórico/dívida de encerramento, E2E Sandbox/STAGING, backup e corte autorizados. Não retirar os bloqueios atuais e não promover candidatos 03–06 ao pacote de produção.

## Contrato técnico que precisa ser implementado e testado

### Preparação administrativa integrada — candidato da PR (17/10/2026)

A Edge `catalogo-asaas-financeiro` contém a ação candidata
`preparar_acumulo_sandbox_admin`, exclusivamente para a loja fictícia
`asaas-cob02`, com sessão administrativa validada, ambiente `sandbox` e a
flag independente `ASAAS_COB06_PREPARACAO_ADMIN_ENABLED=true`. A flag é
**OFF por padrão** e não foi configurada em nenhum projeto nesta etapa.

A ação encadeia pré-visualização, reserva contábil, conferência de origens e
reserva de referência imutável. Nunca chama Asaas, não cria cobrança e devolve
`pode_emitir_pix=false`, `pode_quitar=false`, `pode_liberar_motoboy=false` e
`hold_obrigatorio=true`. Uma falha após a reserva exige consultar o estado
existente; não se recupera criando um segundo lote ou emitindo Pix.

Os três contratos Node em `tests/catalogo-asaas-acumulo-preparacao-admin.test.cjs`
verificam a identidade administrativa, ambiente e loja QA, sequência das RPCs e
ausência de chamada bancária. **Nenhum deploy, ativação de flag ou pagamento foi
feito**. Essa preparação não substitui GET bancário independente, autorização
durável de tentativa, liquidação/estorno multicompetências ou homologação E2E.

#### Retomada idempotente da preparação — candidato (17/10/2026)

Se o primeiro preparo sofreu timeout após gravar o lote, a pré-visualização
normal pode deixar de enxergar as fontes já reservadas. Foi acrescentada a
ação `retomar_preparacao_acumulo_sandbox_admin`, sob a **mesma flag
administrativa OFF**, somente para `asaas-cob02` no Sandbox. Ela localiza o
lote existente pela loja e competência de corte, exige estado `preparado`,
reconfere todas as fontes/competências/componentes e usa a RPC idempotente de
referência já existente. **Não cria segundo lote**, não repete reserva de
origens, não procura autorização bancária e não envia cobrança. A operação
retorna HOLD e campos financeiros sempre `false`, inclusive em nova execução.

O ensaio Deno simula perda da resposta SQL após reservar uma referência e
confirma que a retomada recupera a **mesma** referência. A ação requer os
candidatos SQL 03–05 previamente instalados; **não está publicada nem ativada
em STAGING ou produção**. Após retomada validada, a auditoria GET separada
pode inspecionar a referência sem autorizar emissão.

### Auditoria de duplicidade por GET — candidato da PR (17/10/2026)

Adicionada à Edge a ação `auditar_duplicidade_acumulo_sandbox_admin`, com
flag própria `ASAAS_COB06_DUPLICIDADE_ADMIN_ENABLED=true`, **OFF por padrão**,
além do gate `ASAAS_COB06_GET_ADMIN_READONLY_ENABLED`. Exige sessão do
administrador, ambiente Sandbox e lote pertencente à loja fictícia
`asaas-cob02`. Obtém referência, cliente e valor exclusivamente do banco,
confere as origens e consulta o Asaas apenas por **GET**.

O adaptador exige a contagem total explícita e coerente na listagem do Asaas;
resposta incompleta, duplicada, erro ou divergência no GET por ID é **HOLD**.
Se a lista vier integralmente vazia, o retorno significa apenas *nenhum
pagamento localizado nesta consulta*. **Não é prova definitiva de ausência nem
autorização para emitir, repetir POST ou baixar valores**: o gate transacional
da tentativa em SQL 13 ainda é CI-only e não está conectado à Edge.

As provas Deno usam um provedor fictício com falha, ausência, duplicidade e
pagamento existente; os contratos Node conferem os bloqueios na rota.
**Nenhuma flag foi ligada e nenhum GET externo, POST Pix, deploy ou alteração
em STAGING/produção foi executado nesta etapa.**

### Concorrência real do gate CI-only — prova adicional (17/10/2026)

Um novo ensaio de duas conexões PostgreSQL foi anexado ao final da CI COB-06,
**depois** das verificações de rollback, restauração de backup e preservação da
fatura Mercado Pago já paga. No banco sintético `catalogo_cob06_ci`, uma
fixture prepara R$1+R$4 com componentes, entrega comprovada e referência
imutável; a primeira transação registra o recibo do SQL candidato 13 e segura
a trava da loja enquanto a segunda aguarda no PostgreSQL. A validação exige
**uma única tentativa** e segunda resposta `nova_tentativa=false`, mesmo após
o COMMIT; o recibo não pode ser alterado ou usado para repetir POST.

A fixture é persistida somente no clone descartável imediatamente antes de
sua destruição pela CI. O gate 13 permanece **CI-only**, não há conexão com
a Edge de emissão e nenhuma autorização bancária foi criada. A prova mede
concorrência real de transações e idempotência do banco; timeout HTTP real,
GET Asaas em STAGING e conciliação ponta a ponta ainda precisam de homologação.

#### Prova integrada GET + gate persistente — CI descartável (17/10/2026)

O ensaio `catalogo-asaas-acumulo-pre-post-postgres-ci.test.ts` conecta o
coordenador Deno `conciliarAntesDePixAcumuloCandidatoSomenteCi` à função **real**
`catalogo_private.catalogo_asaas_autorizar_tentativa_emissao_ci` via `psql`,
após a fixture de R$1+R$4 e a prova de concorrência. Ele obtém identidade,
referência e valor do livro PostgreSQL descartável, não do navegador. O Asaas
é simulado por `fetch` injetado e o Deno é executado **sem permissão de rede**.

Os contratos obrigatórios são: pagamento encontrado e verificado por GET não
chama o gate; GET vazio após tentativa persistida retorna reconciliação manual
e não permite novo POST; GET duplicado ou indisponível não aciona o gate; o
recibo permanece único e inalterado, não há registro de emissão e a cobrança
Mercado Pago histórica já paga continua íntegra. **O teste não envia Pix**.
Executa apenas no clone `catalogo_cob06_ci` com PostgreSQL local, credenciais
fictícias de CI e nega alvos remotos; o SQL 13 continua impossível de aplicar
em STAGING/produção. Uma prova E2E real do Asaas Sandbox, implantação e
autorização de emissão ainda são etapas separadas e pendentes.

### Auditoria de baixa por competência — relatório administrativo candidato (17/10/2026)

Adicionada a ação `auditar_baixa_multicompetencia_sandbox_admin` à Edge
`catalogo-asaas-financeiro`, com flag específica
`ASAAS_COB06_BAIXA_AUDITORIA_ADMIN_ENABLED=true` **OFF por padrão**. Exige
sessão administrativa, `ASAAS_COB06_GET_ADMIN_READONLY_ENABLED`, ambiente
Sandbox e lote da loja QA `asaas-cob02`. O único dado financeiro aceito do
navegador é o identificador do lote; referência, ID bancário, cliente e valor
são obtidos do livro privado.

A ação combina as RPCs **somente leitura** 08/09 (diário e projeção de baixa)
com GET Asaas autenticado por ID. Valida a divisão das origens por competências,
seus valores exatos e as parcelas de plataforma/logística, sem aceitar fontes
repetidas, soma divergente ou permissão positiva nas RPCs. Retorna estados e
valores por competência para inspeção administrativa, mas **sempre**
`pode_emitir_pix=false`, `pode_quitar=false`, `pode_estornar=false`,
`pode_liberar_motoboy=false` e `hold_obrigatorio=true`.

Os testes HTTP isolados simulam R$1+R$4, `RECEIVED`, `REFUNDED`, origem
alterada, RPC inesperadamente autorizadora, observação ausente e acesso de
usuário não administrador. **Não há INSERT/UPDATE financeiro, registro de
evento, POST bancário ou saque** nessa rota. Os SQL 08/09 seguem candidatos
não aplicados em STAGING/produção e o relatório não autoriza liberação.

1. Registrar vínculo durável e único entre fechamento(s) de origem e cobrança consolidada de destino, sem modificar os totais históricos originais; impedir que uma competência já emitida/paga/reservada seja acumulada novamente.
2. Usar bloqueio transacional por comércio e conferir todas as fontes para prevenir dois agrupamentos concorrentes ou dois POSTs Pix após timeout. Cada cobrança deve ter referência externa imutável.
3. Preservar os snapshots `catalogo_fatura_componentes_v2` e demonstrar que a soma das parcelas financeiras vinculadas corresponde exatamente à cobrança. Não usar apenas a soma de `total_comissao_centavos` sem vínculos.
4. Ao conciliar pagamento Asaas, alterar **somente** fechamentos, comissões, remunerações e lançamentos financeiros vinculados, mesmo que sejam de meses diferentes. Nunca liberar 2% do motoboy antes de financiamento e entrega comprovados.
5. Estorno/contestação precisa reverter ou reter **exatamente** o mesmo grupo, com histórico e idempotência. Conferência de dívida e bloqueio de exclusão deve evitar contar duas vezes fechamento original e consolidação.
6. A interface deve mostrar o valor acumulado, meses de origem e estado da cobrança, sem tratar o saldo em espera como pago ou perdoado. A política de faturamento mensal continua vigente, mesmo com emissão bancária diferida.

## Gate seguro em vigor

A Edge `catalogo-asaas-financeiro/index.ts` atualmente retorna HTTP 409 para fechamento inferior a 500 centavos, **antes** de criar cliente, reservar emissão ou emitir Pix. Essa proteção **deve permanecer** até que o mecanismo intercompetências, a conciliação e os testes estejam concluídos. `catalogo_asaas_registrar_fatura` e `catalogo_confirmar_cobranca_fatura` pressupõem vínculo a um fechamento/competência: alterar só o valor da Edge quebra a consistência contábil.

**Aceite exigido antes de liberar no código:** R$1 + R$4; R$2 + R$2 + R$1; valores ainda inferiores ao mínimo; exatamente R$5; cobranças antigas existentes; alteração concorrente; duas tentativas simultâneas; timeout do provedor; webhook duplicado; estorno e contestação; fechamento do comércio com dívida residual; idempotência em clone PostgreSQL isolado com ROLLBACK; e E2E em STAGING. Não utilizar quitações manuais em SQL para simular pagamentos reais.

**Não fazer deploy**, nem mudar o pacote seletivo congelado de nove SQL, até completar a revisão COB-06 e obter autorização específica.
