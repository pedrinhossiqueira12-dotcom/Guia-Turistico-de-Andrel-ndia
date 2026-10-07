# Atualização do catálogo e liberação de operação

## Requisitos desta atualização

- Banner do `store-hero` personalizável com uma foto escolhida na área **Editar meu comércio** da página `local`; persistência no Supabase sem depender do bot que publica os dados estáticos do perfil. Manter o estilo verde/creme e um fundo legível de segurança quando não houver imagem.
- Contatos do comprador visíveis no painel do comércio **após o aceite**, com links para ligar e WhatsApp. Antes do aceite, preservar a barreira antifraude que evita desvio da venda antes do registro da comissão.
- Card com identificação clara de **motoboy selecionado**, **oferta aguardando aceite**, **motoboy atribuído**, **coleta** e **saída para entrega**. Seleção de preferência não pode ser apresentada como uma entrega já assumida pelo motoboy.
- Os 2% remuneram entregas tanto em **Pix** quanto em **dinheiro/cartão**. A confirmação exige o código do comprador. Disponibilidade financeira exige recebimento comprovado; não existe transferência bancária automática nesta integração.
- Manter 7% na entrega, sendo 5% plataforma e 2% reserva logística; 5% na retirada/consumo local. Preservar os snapshots de pedidos antigos.
- Liberação do modelo novo para outros comércios somente conforme a autorização do proprietário da plataforma; catálogo individual continua exigindo Mercado Pago conectado, comércio ativo e ausência de bloqueio.

## Conferência externa em 07/10/2026, 00h35–00h43 (Brasília)

Fonte: projeto Supabase `xdmbkflufsfqziixzpxc`, consultas agregadas sem dados pessoais. A nova política estava restrita a `comercio-de-exemplo`; `somente_pix=false`. Monitor de confiabilidade instalado a cada 15 minutos, inativo. Fechamento mensal e fatura Pix inativos.

Há uma entrega presencial V2 concluída, três pedidos Pix V2 cancelados e **nenhum pagamento Pix V2 aprovado/conciliado**. Existem seis obrigações presenciais e uma remuneração retida, sem financiamento comprovado. Não existe fechamento mensal quitado. Portanto, a geração de QR Code não deve ser descrita como confirmação de pagamento ou recebimento de comissão.

Fonte de configuração: https://supabase.com/dashboard/project/xdmbkflufsfqziixzpxc/functions/secrets (somente nomes, não valores). Secrets presentes incluem `MP_PROD_ACCESS_TOKEN`, `MP_PROD_SELLER_ID`, `MP_PROD_WEBHOOK_SECRET`, `MARKETPLACE_CHECKOUT_ENABLED` e `OFFLINE_CHECKOUT_ENABLED`. **Não foram encontrados `FATURA_PIX_ENABLED`, `MP_PLATFORM_ACCESS_TOKEN`, `MP_PLATFORM_SELLER_ID` ou `MP_PLATFORM_WEBHOOK_SECRET`**, exigidos atualmente pela emissão de fatura. Nenhuma credencial foi copiada para este documento.

A vitrine `catalogo_publicado` utiliza `security_invoker=true` e filtra por `catalogo_private.catalogo_esta_ativo(comercio_id)`. A migração de banner deve preservar isso. A credencial GitHub informa papel administrativo no repositório, mas pushes desta sessão foram recusados por escopo da integração em etapas anteriores; o papel informado não comprova autorização efetiva de escrita do token.

## Critérios de conclusão

- [x] Banner autenticado, validação de arquivo e fallback visual implantados.
- [x] Contatos e estados de motoboy implementados com testes executáveis de isolamento e HTML seguro.
- [ ] Migração e função de banner implantadas e código publicado.
- [ ] Liberação geral e monitor conferidos após atualização.
- [ ] Conciliar um Pix real e configurar/validar emissão da fatura mensal, sem declarar testes não registrados como prova de recebimento.

## Resultado desta execução

Migração de banner `20261007040955` aplicada em produção; função `catalogo-admin` versão 47 ativa, hash igual à versão validada em staging. A leitura pública retorna 200 e uma tentativa de salvar sem sessão retorna 401. A vitrine mantém `security_invoker=true`; `anon` não ganhou permissão de atualização. O editor pode preparar um banner antes de conectar o Mercado Pago, mas isso **não ativa o catálogo**: apenas cria sua configuração inativa, e a vitrine/checkout continuam dependentes de recebedor ativo e ausência de bloqueio. Essa preparação é intencional e não altera nenhuma taxa.

Uploads novos abandonados antes do POST são descartados quando a sessão original ainda existe. Depois de iniciar a persistência, falhas de rede não justificam apagar o arquivo: o servidor pode já tê-lo vinculado ao banner. Não se apagam objetos com resultado de persistência incerto nem se amplia privilégio quando a sessão termina.

A política financeira permanece no piloto autorizado; não foi ligada a emissão da fatura nem o monitor. A liberação geral permanece pendente da resposta à verificação do Pix pago e da configuração efetiva da fatura mensal.
