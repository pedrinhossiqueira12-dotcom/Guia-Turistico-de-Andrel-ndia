# Entrega — marketplace antifraude v2

Estado verificado em 6 de outubro de 2026. O código foi testado e os serviços foram implantados. **A política financeira nova permanece desligada até o piloto real com Mercado Pago.** Esta distinção é intencional: aprovação de testes de software não significa que dinheiro foi recebido ou transferido.

**Frontend pendente de publicação:** o GitHub recusou o push com HTTP 403 mesmo com a conta conectada. O pacote inclui arquivos completos e instalador PowerShell com backup e validação. Publique pela credencial de escrita do computador do usuário; nenhum push foi repetido para contornar a permissão. O Supabase já está atualizado e não deve ser reimplantado pelo instalador.

## Regras confirmadas

- Entrega: taxa total de 7% sobre o subtotal dos produtos, composta por 5% da plataforma e 2% de reserva para o motoboy.
- Retirada e consumo local: 5%, sem criar remuneração de entregador.
- Pix pelo site e dinheiro/cartão na entrega continuam previstos. As modalidades também dependem das opções habilitadas pelo comércio.
- Componentes são calculados em centavos e arredondados separadamente. O snapshot do pedido congela valores e versão; pedidos antigos não são reprecificados.
- Não existe mensalidade para ativar o catálogo. A fatura mensal cobra a taxa das vendas presenciais, não uma assinatura.

## Proteções implementadas

1. O aceite do comércio registra a obrigação financeira. Omitir o código depois do aceite não elimina a taxa.
2. No fluxo novo, identidade, telefone, endereço completo e observações do comprador ficam ocultos ao comércio antes do aceite. A gestão auxiliar de atribuição também não entrega contatos. O banco nega acesso direto às tabelas de pedidos a `anon` e `authenticated`.
3. Cancelamento depois do aceite vira ocorrência revisável, preservando comissão, fase física e auditoria. Desistência do motoboy depois da coleta não devolve silenciosamente a oferta à rede.
4. Comprador não confirma entrega. O motoboy precisa estar autorizado, ter a atribuição correta, registrar coleta/saída e informar código válido. Na baixa presencial, confirma também o recebimento do pagamento.
5. Os 2% não viram transferência automática: aparecem como reserva/remuneração, e só ficam disponíveis quando há código confirmado e financiamento comprovado pela taxa Pix ou pela conciliação integral da fatura presencial.
6. Chaves Pix e comprovantes recuperáveis são cifrados. Sem chave válida, checkout presencial falha antes de criar pedido sem recuperação de código.
7. Repetições e disputas são tratadas por transações, locks e referências únicas. Refund/chargeback congela ou estorna crédito não pago; se já houve repasse, preserva o histórico e cria pendência visível, sem inventar devolução bancária.
8. A administração registra apenas prova de transferência já realizada. Esta implantação não fez pagamento, repasse ou reembolso real.

## Páginas

- Comércio: `/pages/catalogo-admin?id=ID_DO_COMERCIO` — produtos, pedidos e fatura permanecem separados do motoboy.
- Gestão de entregadores: `/pages/entregadores-admin?id=ID_DO_COMERCIO`.
- Motoboy: `/pages/motoboy` — disponibilidade, ofertas permitidas, atribuições, coleta, confirmação, extrato e histórico.
- Administrador da plataforma: `/pages/entregas-operacao` — ocorrências, créditos financiados, provas de repasse e pendências financeiras. Não oferece repasse de crédito retido ou em revisão.
- Comprador: `/pages/catalogo?id=ID_DO_COMERCIO` — comprovante, consulta/cancelamento permitido e WhatsApp; não possui botão de apagar o código. O botão de código é ocultado após a conclusão recebida do servidor.

## Implantação e validação

Produção Supabase: `xdmbkflufsfqziixzpxc`. Staging: `jbttwihctuibchhcyqtl`.

Migrações de produção:

- `20261007010434_catalogo_entregas_v2.sql`.
- `20261007010439_catalogo_monitor_entregas_v2.sql`.

Seis funções publicadas: `catalogo-entregas`, `catalogo-pedidos-offline-admin`, `catalogo-pedido-offline`, `catalogo-pedido-pix`, `mercadopago-marketplace-webhook`, `catalogo-fatura-pix`.

Evidências:

- **300 testes automatizados aprovados, zero falhas e zero testes ignorados**, incluindo SQL funcional em PostgreSQL/PGlite, endpoints com identidade validada, interface, criptografia, fatura e webhook.
- Typecheck Deno aprovado para os seis endpoints.
- Quatro disputas em PostgreSQL de staging com sessões distintas e locks observados: disputa de atribuição, cancelamento versus aceite, dois registros do mesmo repasse, e repasse versus refund. Fixtures removidas e contagens restauradas; staging terminou com zero pedidos e zero repasses.
- Probes HTTP em staging: rotas privadas recusam sessão ausente; confirmação pública retorna 410; pedido inválido retorna 400.
- Permissões reais de produção verificadas: anon não lê remunerações nem executa operação administrativa; authenticated não pode chamar diretamente a RPC e forjar identidade de motoboy; tabelas de pedidos não oferecem SELECT direto.
- `catalogo_fluxo_config.ativo=false`, `somente_pix=false`, `monitor_confiabilidade_ativo=false` confirmados em produção.
- Monitor nativo instalado para cada 15 minutos, **inativo**, usando `cron.alter_job`, sem modificar privilégios de tabelas protegidas. Não chama Manus e não confirma entregas automaticamente.

Reprodução local: Node.js 22+, `npm ci`, `npm test`, `npm run check:edge`. O staging tem bootstrap e roteiro multissessão em `scripts/entregas-v2`; não use o bootstrap em produção. Nenhum secret é incluído no pacote ou no repositório.

## O que falta para liberar a taxa nova

1. Selecionar uma loja de teste e limitar `comercios_piloto` a essa loja durante a validação. A ativação global não foi realizada nesta entrega.
2. Fazer um pedido Pix real de baixo valor, pago pelo usuário, e conferir no Mercado Pago recebedor, total, taxa efetivamente retida e webhook. Conferir também que os 2% não são contabilizados como transferência já executada.
3. Repetir a sequência presencial: criar, aceitar, disponibilizar, motoboy aceitar/coletar/sair, confirmar código e recebimento. Demonstrar que a comissão persiste mesmo sem código ou com solicitação de cancelamento posterior.
4. Validar emissão/consulta da fatura de taxa presencial com as credenciais da plataforma, flag de emissão e configuração de webhook correspondente. A emissão exige `FATURA_PIX_ENABLED=true`, `MP_PLATFORM_ACCESS_TOKEN`, `MP_PLATFORM_SELLER_ID`, `MP_PLATFORM_WEBHOOK_SECRET`. O backend reconsulta a cobrança no provedor, inclusive quando já estava marcada como paga. O monitor de confiabilidade não substitui a automação de fechamento mensal.
5. Só após essas provas, liberar a política para as lojas pretendidas e habilitar o monitor nativo. Preservar `somente_pix=false`, conforme a escolha do usuário.

**Não houve teste de pagamento real nem confirmação de split efetivamente recebido nesta implantação. Não declarar a operação financeira como validada apenas pelos testes de software.**

## Riscos residuais

Dinheiro/cartão fora do site continua sujeito à inadimplência do comércio: registrar a dívida não é receber dinheiro. Ocultar contatos e vincular comissão ao aceite dificulta o desvio, mas não impede uma negociação externa entre pessoas que já se conhecem. O código comprova a confirmação operacional; sozinho não é prova bancária. Reclamações não devem punir automaticamente o entregador: o índice diferencia responsabilidades comprovadas de causas externas. Exigir MFA para administradores, acompanhar logs, backups, alertas, webhook e filas de pendência continua recomendado.
