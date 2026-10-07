# Plano — entregas, incentivo e antifraude

## Direção

Implementar a proposta autorizada, sem prometer eliminação de fraude em pagamentos externos. Separar pagamento, aceite, transporte, cancelamento e remuneração. Modelo financeiro novo desligado até resolver as decisões pendentes e validar. Pedidos existentes conservam a taxa pactuada. Nenhuma transferência real automática.

## Organização

- `supabase/migrations/*_catalogo_entregas_v2.sql`: snapshots financeiros, reservas, aceite atômico, fases da entrega, ocorrências, índice, remuneração e permissões.
- `supabase/functions/catalogo-entregas`: roteador autenticado de entregadores/gestão/admin.
- `supabase/functions/catalogo-pedidos-offline-admin`: gestão de pedidos e extratos existentes.
- `supabase/functions/catalogo-pedido-pix` e webhook marketplace: pagamento real do provedor e conciliação, independentes do código.
- `supabase/functions/catalogo-pedido-offline`: pedido presencial, consulta privada de estado e cancelamento pelo comprador.
- `js/pages/styles`: catálogo/gestão, entregadores, motoboy e operação administrativa.
- `tests/catalogo-v2-*`: contratos de endpoints, interfaces e PostgreSQL real isolado.
- `docs/CONTRATO_ENTREGAS_V2.md`: contrato comum dos módulos e decisões financeiras.

## Visual

Manter o design existente: verde profundo, tons neutros, tipografia e botões do site, cartões responsivos e feedback acessível. Reutilizar componentes/CSS atuais, sem rebranding ou imagens decorativas. Painel do motoboy continua isolado de produtos/faturas.

## Resultados requeridos

- [ ] Taxa 5% plataforma + 2% logística com snapshots em centavos, sem aumento retroativo.
- [ ] Remuneração única após código válido, saldo a receber distinto de pagamento realizado e histórico.
- [ ] Aceite do motoboy atômico, estados reserva/coleta/em entrega/entregue e auditoria.
- [ ] Disponibilidade opt-in e ofertas limitadas aos vínculos do comércio; atendimento multicomércio.
- [ ] Atribuição na linha do pedido do catalogo-admin e oferta automática ao marcar pronto, salvo preferência prévia.
- [ ] Remover atribuição de entregadores-admin sem remover cadastro/suspensão de vínculos.
- [ ] Cancelamento do comprador com duas etapas e guarda no banco que recusa após aceite.
- [ ] Cancelamentos pós aceite/coleta viram ocorrência analisável, sem eliminar automaticamente comissão ou simular estorno.
- [ ] Confiabilidade baseada em histórico verificável, sem culpa automática por cancelamentos do cliente/comércio; análise revisável.
- [ ] Proteção contra vazamento de PII de compradores em ofertas, acesso a outros comércios/usuários e identidade falsificada.
- [ ] QR Code Pix e webhook usando integração documentada e idempotência, preservando suporte aos registros antigos.
- [ ] Operação administrativa para revisão e registro de repasse comprovado, sem executar transferência.
- [ ] Suíte integrada, fonte completa, documentação de instalação/ativação e validação controlada.

## Pendências materiais

Confirmar somente Pix vs manutenção de pagamentos presenciais; taxa em retirada/consumo; se 7% sem entregador, destino dos 2%. Não interpretar silêncio como aprovação nem habilitar cobranças futuras sem essas definições. Repasses bancários reais exigem ação e confirmação do operador, fora dos testes.
