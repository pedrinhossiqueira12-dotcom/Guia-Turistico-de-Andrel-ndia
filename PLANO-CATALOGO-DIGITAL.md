# Plano — Catálogo Digital

## Objetivo e limites

Implementar no site estático existente uma vitrine única e dinâmica por comércio, painel do proprietário, página de contratação, categorias, produtos, carrinho, checkout e envio do pedido ao WhatsApp do próprio comércio. O pedido não será gravado no banco. O catálogo só será público quando a assinatura estiver `ativa` e o comércio continuar com status `ativo`.

**Cobrança:** foram definidos R$ 59,90 por mês e R$ 599,90 por ano, com Mercado Pago. A fase atual é exclusivamente sandbox: não usa credenciais reais, não exibe preços na página pública de contratação, não cria cobrança de produção e nunca muda assinatura para `ativa`. No Mercado Pago, Pix exige que o cliente pague manualmente cada renovação; não é débito automático. O sandbox valida apenas a emissão/consulta de uma order de teste e sua confirmação isolada.

**Retenção:** fotos substituídas ou desreferenciadas serão encaminhadas à fila e respeitarão a janela já definida de sete dias. A rotina continuará somente em dry-run; nenhuma exclusão física do Storage será habilitada nesta implementação.

## Abordagem

- Manter HTML/CSS/JavaScript sem framework e sem etapa de build, compatível com GitHub/Cloudflare Pages.
- Reutilizar o cliente Supabase e a sessão definidos em `js/login.js`; páginas administrativas validarão sessão e propriedade do comércio.
- Usar as tabelas `catalogos` (configuração e vínculo verificado com o proprietário), `catalogo_assinaturas` (estado e metadados de contratação), `catalogo_categorias` e `catalogo_produtos`. O navegador não poderá inserir ou atualizar status de pagamento.
- Criar verificação server-side do proprietário para vincular comércio autenticado; proteger leitura pública com status publicado + assinatura ativa e escrita com RLS por proprietário.
- Guardar fotos públicas de produtos no bucket `catalogos`, em pastas por ID público/produto, com uploads autenticados restritos ao proprietário. Fotos serão comprimidas no navegador, limitadas a 5 MiB e a formatos de imagem permitidos; usar `img/sem-foto.png` quando ausentes.
- O carrinho ficará no navegador, separado por comércio. O checkout apresentará resumo, cliente, forma de entrega/retirada, pagamento e observações; o site não processará pagamentos dos produtos.
- Montar uma mensagem legível e codificada com `encodeURIComponent` e abrir `https://wa.me/` usando exclusivamente o WhatsApp/telefone do comércio no JSON publicado.
- Se o comércio não tiver número válido, manter a vitrine consultável, ocultar a sacola/desabilitar adição e exibir aviso; testar `whatsapp` e, como alternativa, `telefone`, sem redirecionar o pedido a outro número.
- Soft-delete de categoria/produto. Ao excluir/substituir foto, limpar a referência no registro e iniciar a fila de retenção somente se o objeto não continuar referenciado; não executar purga.

## Estrutura do projeto

- `pages/local.html` + `js/local.js`: exibir links de catálogo somente a visitantes quando ativo e ao proprietário autenticado os botões de gestão/contratação.
- `pages/catalogo.html`, `js/catalogo.js`, `styles/catalogo.css`: página pública dinâmica, categorias, produtos, carrinho e checkout.
- `pages/catalogo-admin.html`, `js/catalogo-admin.js`, `styles/catalogo-admin.css`: gestão autenticada de produtos/categorias e configurações de pedido.
- `pages/catalogo-venda.html`, `js/catalogo-venda.js`, `styles/catalogo-venda.css`: apresentação premium e estado de contratação sem cobrança real.
- `supabase/migrations/`: DDL, índices, RLS, bucket e políticas do catálogo; ampliar a fila para o bucket novo.
- `supabase/functions/catalogo-admin/`: validação server-side de sessão e propriedade, sem ativação de assinatura.
- `pages/catalogo-pix-teste.html` + `js/catalogo-pix-teste.js`: rota sem link público, restrita ao proprietário validado, usada apenas para visualizar o fluxo de teste mensal/anual.
- `supabase/functions/catalogo-pix-sandbox/`: emissão/consulta Orders API com credenciais de vendedor de teste, validação do seller ID, HMAC de webhook e atualização somente de metadados de teste; nunca ativa uma assinatura.
- `supabase/functions/storage-cleanup/`: manter a reconciliação em dry-run e incluir imagens referenciadas pelos produtos.
- `tests/`: testes de utilidades do catálogo, carrinho, formatação do pedido e tratamento de imagens.

## Design

- **Movimento:** editorial regional contemporâneo, com referências à hospitalidade e ao comércio local; sem aparência genérica de marketplace.
- **Princípios:** foco no produto e no preço; linguagem acolhedora; segurança visível; prioridade para uso no celular.
- **Filosofia de cores:** manter o verde institucional `#194138`, fundo quente `#f5f3ef` e cartões brancos; usar terracota discreta para preço/ações e verde profundo para confiança e confirmações.
- **Paradigma de layout:** cabeçalho compacto do estabelecimento, navegação de categorias horizontal e vitrine em cartões responsivos; carrinho permanece acessível em uma barra inferior no celular.
- **Elementos de assinatura:** faixa verde com nome do comércio; chips de categoria; resumo de compra com total sempre visível.
- **Interação:** adicionar/remover sem recarregar; feedback textual acessível; estados vazios e erros explicados em português; confirmação final antes de abrir o WhatsApp.
- **Animação:** transições curtas de 140–200 ms para quantidade, carrinho e menus; sem animações contínuas, respeitando `prefers-reduced-motion`.
- **Tipografia:** sistema sem serifa para leitura e controles; serifada de sistema (`Georgia`) apenas em títulos de destaque, evitando download de fontes.
- **Essência da marca:** “A vitrine digital do comércio de Andrelândia, da escolha ao pedido direto no WhatsApp.” Personalidade: acolhedora, confiável e prática.
- **Tom de voz:** claro, direto e local. Exemplos: “Escolha com calma. Seu pedido vai direto para o comércio.” / “Nenhum pagamento foi feito pelo site; combine o pagamento com a loja.”
- **Marca e assinatura:** reutilizar a marca institucional existente; nos novos componentes, usar um símbolo simples de sacola com folha como apoio visual, sem substituir o logotipo do Guia.
- **Cor proprietária:** verde Andrelândia `#194138`.

## Restrições pendentes

- Antes de cobrança real ou transição para `ativa`, revisar separadamente o provedor/conta de produção, preços, renovação manual, webhooks, política de cancelamento/estorno e autorização explícita.
- Manter qualquer remoção física de fotos bloqueada até revisão do relatório dry-run e autorização separada.
- Nenhum pedido será armazenado no banco nesta primeira versão.

## Decisão de sandbox — 03/10/2026

- Preços definidos pelo proprietário do Guia: `mensal = R$ 59,90`; `anual = R$ 599,90`.
- Provedor escolhido para o teste: Mercado Pago Checkout API via Orders (`Pix`), usando conta e Access Token de vendedor de teste. A documentação atual do Mercado Pago informa que Pix recorrente requer uma ação manual de pagamento em cada período.
- A validação de webhook usa HMAC-SHA256 e `x-request-id`, `data.id` e timestamp. A order é consultada de volta na API antes de aceitar seu estado.
- O endpoint de teste exige `MP_MODE=sandbox` e o ID do vendedor de teste configurado; verifica `/users/me` antes de criar orders e falha fechado se token e conta não corresponderem.
- A resposta paga de sandbox será gravada apenas em `metadata` da assinatura pendente (`sandbox_status`); `status` e `pago_em` permanecem inalterados. Portanto, teste algum pode tornar a vitrine pública.
- O HTML de sandbox fica em rota sem link público e só revela os planos depois de sessão e propriedade confirmadas. A contratação pública permanece sem preços visíveis até uma autorização própria.


## Estado da execução — 02/10/2026

- A migração `catalogo_digital_20261003000000` foi aplicada no projeto Supabase `xdmbkflufsfqziixzpxc`; as quatro tabelas, RLS, view pública, bucket e constraint da fila foram confirmados por leitura.
- `catalogo-admin` está ativa na versão 1 com JWT obrigatório; `storage-cleanup` está ativa na versão 2 com a autenticação própria existente e `dry_run` mantido. Nenhuma limpeza foi invocada manualmente.
- O frontend segue no patch local; não houve push/merge no GitHub nem publicação no Cloudflare Pages. A publicação fica para confirmação separada.
- O banco está sem linhas de catálogo, assinatura, categoria ou produto. Nenhuma cobrança/Pix foi criada e nenhuma imagem foi removida.
- Em comércios sem WhatsApp/telefone válido, a vitrine permanece apenas para consulta e o checkout é desabilitado; essa condição foi observada em 47 dos 139 registros da base local analisada.


## Estado do teste Mercado Pago — 03/10/2026

- A implementação está isolada na branch local `feature/mercadopago-pix-sandbox`; a rota não é referenciada pelo perfil nem pela venda pública.
- Foram executados 24 testes locais, compilação TypeScript estrita e verificações de segurança estática. Nenhum secret foi recebido ou configurado; nenhuma chamada à API Mercado Pago, cobrança, deploy de função ou publicação ocorreu.
- Próximo requisito do teste: o proprietário configurar os secrets de **conta de teste** no Supabase; somente depois poderá ser considerada a implantação da função sandbox, com nova verificação do escopo. Não usar credenciais de produção.
