# Entregas v2 — requisitos e estado

- [x] Taxa sobre produtos: entrega 7% (5% plataforma e reserva de 2% motoboy); retirada/consumo 5%; manter Pix e também dinheiro/cartão presencial conforme opções do comércio. Não cobrar assinatura para ativar catálogo.
- [x] Registrar obrigação no aceite, manter a comissão se não houver código, transformar cancelamento posterior em ocorrência e não apagar automaticamente a fase de entrega.
- [x] Ocultar contato/identidade antes do aceite no novo fluxo e impedir exposição pela tela auxiliar de atribuições.
- [x] Página separada do motoboy, sem gestão de produtos ou fatura; disponibilidade, ofertas com acesso autorizado, atribuição exclusiva, coleta/saída, confirmação, histórico, saldo e chave Pix protegida.
- [x] Código usado por motoboy atribuído/autorizado, nunca pelo comprador; tentativas limitadas e consumidas de forma transacional; sem repetição de remuneração.
- [x] Reserva/remuneração de 2% só disponível com lastro comprovado; fatura presencial diferencia obrigação, recebimento e remuneração, sem simular transferência.
- [x] Índice considera responsabilidades comprovadas, exclui causas externas e permite revisão; monitor nativo instalado mas inativo.
- [x] Administração isolada para ocorrências, provas de repasse e pendências de estorno/chargeback; crédito retido ou em revisão não pode receber novo repasse.
- [x] Comprador mantém comprovante consultável, perde botão de código após conclusão, não possui botão de remoção acidental e pode continuar pelo WhatsApp sem pular o registro exigido.
- [x] Validação: 300 testes aprovados, typecheck dos seis endpoints, quatro disputas PostgreSQL multissessão em staging, cleanup e verificações de acesso.
- [x] Backend implantado em staging e produção com migrações alinhadas; política nova desativada para não cobrar antes da prova real.
- [ ] Pix real de baixo valor e split/webhook conferidos no Mercado Pago, pago manualmente pelo usuário.
- [ ] Piloto presencial/fatura e liberação produtiva posterior às provas financeiras; sem ativação global silenciosa.

O código completo acompanha a entrega. Os dois itens abertos são validações/ativação financeira, não testes locais ocultamente ignorados.
