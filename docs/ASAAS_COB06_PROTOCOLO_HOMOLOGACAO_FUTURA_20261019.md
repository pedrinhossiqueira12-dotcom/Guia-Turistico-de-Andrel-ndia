# COB-06 — protocolo de decisão para homologação bancária futura (19/10/2026)

**Situação:** proposta de procedimento, somente documentação na PR #39 (Draft). **Não constitui autorização operacional.**

## Base já comprovada
- Lote histórico `583d761a-ecb9-49be-b484-e43f6183971e`: um GET Asaas Sandbox foi autorizado e executado em 19/10; resposta relatada: `nenhuma_cobranca_localizada`, `payment_id=null`, `evidencia_get_persistida=false`.
- Resultado negativo não é prova de ausência global de cobrança nem permissão de emissão de Pix.
- Versão da Edge STAGING verificada anteriormente: `catalogo-asaas-cob06-auditoria` v48, com guarda incondicional de POST e `verify_jwt=true`. Antes de qualquer janela futura deve ser conferida novamente.
- As flags foram declaradas desligadas pelo operador; o valor dos secrets não foi diretamente verificado.
- Correções locais da PR: claim transacional durável antes do GET; recusa explícita do lote histórico no STAGING; transporte com até **um** GET HTTP efetivo por execução e rejeição de detalhe como segundo GET.
- A CI do commit `382b775a143f834b7955702906dc6bd211a2c105` concluiu com 12/12 jobs aprovados. Isso **não** homologa Asaas remoto.

## Regra absoluta para o lote histórico
1. Não repetir GET, não criar claim retroativo, não registrar digest reconstruído e não gerar uma nova tentativa para contornar o bloqueio.
2. Manter `HOLD_OBRIGATORIO`; `pode_emitir_pix`, `pode_quitar`, `pode_estornar`, `pode_liberar_motoboy` e `pode_sacar` permanecem falsos.
3. Se precisar investigar o ocorrido, registrar como pendência de conciliação **sem afirmar ausência de débito externo**. Evidência externa deve ter origem e data verificáveis.

## Critérios para uma janela nova e legítima (sem executar)
- Exigir uma necessidade funcional QA **independente**, documentada e identificada pelo operador. É proibido abrir outro lote apenas para repetir a consulta do histórico ou escapar de unicidade.
- Solicitar autorização expressa e separada para: (a) instalar SQL de QA; (b) publicar a Edge de auditoria somente no STAGING; (c) habilitar temporariamente flags de leitura; (d) efetuar **um** GET Sandbox para um lote QA novo e explicitamente nomeado.
- Registrar antecipadamente o identificador do projeto STAGING, lote, referência externa única, valor em centavos, identidade da reserva, commit/artefato da Edge, versão efetiva, responsável, janela e plano de restauração. Nunca registrar segredo ou token.
- Fazer preflight de leitura: confirmar alvo `STAGING`, `verify_jwt=true`, perfil administrativo, ausência de POST habilitado, histórico do lote, ausência de GET/claim prévio e integridade das RPCs. Qualquer divergência = abortar.
- Efetuar claim único **antes** da rede, por transação e identidade exata do lote. Se o claim negar, falhar ou ficar ambíguo, não chamar Asaas. Não desfazer claim automaticamente após timeout.
- No máximo um GET remoto da listagem por execução. Se resposta for positiva, parcial, fora do contrato, status HTTP inesperado, timeout, erro de persistência ou requerer GET detalhe: **HOLD**, sem segunda chamada.
- Se GET negativo completo for obtido, persistir **somente** dados mínimos e hash dos bytes originais no mesmo fluxo confiável; tratar a confirmação da RPC como trilha local, **não** como prova bancária independente nem autorização para criar cobrança.
- No encerramento, restaurar Edge de bloqueio, desligar as flags de leitura, conferir contagens/estados em somente leitura e registrar os hashes/versões e os atos realmente executados. Se a restauração falhar, bloquear a operação e escalar para o administrador; não afirmar conclusão.

## Matriz de decisão

| Condição observada | Tratamento seguro |
|---|---|
| Lote histórico de 19/10 | Recusar antes do GET; HOLD |
| Sem autorização nova | Não alterar STAGING; HOLD |
| Claim já existe ou incerto | Não repetir GET; HOLD |
| GET identifica cobrança | Não consultar detalhe nessa execução; HOLD, revisão humana |
| GET vazio, íntegro, mas recibo não persistido | HOLD; não repetir automaticamente |
| GET vazio com digest persistido | HOLD; mera trilha local, sem Pix |
| Falha/timeout/conexão interrompida | HOLD; marcar resultado inconclusivo |
| Divergência banco local × provedor | HOLD; apuração independente |

## Critérios de conclusão
A etapa de **auditoria QA** só pode ser marcada concluída para um caso novo se houver autorização, isolamento, claim anterior, observação íntegra persistida e rollback operacional comprovado. Mesmo assim o **COB-06 financeiro** segue aberto até prova externa confiável, confirmação de titularidade/destino, reconciliação e aprovação separada do caminho POST.

**Não executar nesta entrega:** SQL ou Edge remotos, GET real, POST Asaas, emissão Pix, quitação, baixa, saque, estorno, liberação de motoboy, alteração de secrets, merge ou deploy de produção.
