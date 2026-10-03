# Plano — Catálogo Digital

## Objetivo e limites

Implementar no site estático existente uma vitrine única e dinâmica por comércio, painel do proprietário, página de contratação, categorias, produtos, carrinho, checkout e envio do pedido ao WhatsApp do próprio comércio. O pedido não será gravado no banco. O catálogo só será público quando a assinatura estiver `ativa` e o comércio continuar com status `ativo`.

**Cobrança:** não foi escolhido valor nem provedor Pix. Nesta entrega não haverá cobrança, confirmação simulada que libere catálogo, webhook de pagamento ou chave de provedor no navegador. A página de contratação explicará o recurso e manterá a ativação indisponível, avisando que nenhum Pix foi gerado. O backend deixará o status de assinatura controlado apenas no servidor; uma etapa futura implementará e validará o provedor antes de liberar catálogos.

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

- Definir preço, ciclo da assinatura e provedor Pix antes de habilitar cobrança ou transição para `ativa`.
- Manter qualquer remoção física de fotos bloqueada até revisão do relatório dry-run e autorização separada.
- Nenhum pedido será armazenado no banco nesta primeira versão.


## Estado da execução — 02/10/2026

- A migração `catalogo_digital_20261003000000` foi aplicada no projeto Supabase `xdmbkflufsfqziixzpxc`; as quatro tabelas, RLS, view pública, bucket e constraint da fila foram confirmados por leitura.
- `catalogo-admin` está ativa na versão 1 com JWT obrigatório; `storage-cleanup` está ativa na versão 2 com a autenticação própria existente e `dry_run` mantido. Nenhuma limpeza foi invocada manualmente.
- O frontend segue no patch local; não houve push/merge no GitHub nem publicação no Cloudflare Pages. A publicação fica para confirmação separada.
- O banco está sem linhas de catálogo, assinatura, categoria ou produto. Nenhuma cobrança/Pix foi criada e nenhuma imagem foi removida.
- Em comércios sem WhatsApp/telefone válido, a vitrine permanece apenas para consulta e o checkout é desabilitado; essa condição foi observada em 47 dos 139 registros da base local analisada.
