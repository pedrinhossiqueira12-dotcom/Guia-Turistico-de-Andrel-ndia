# TODO — Catálogo Digital

> **Estado em 02/10/2026:** migração `catalogo_digital_20261003000000` aplicada no Supabase `xdmbkflufsfqziixzpxc`; Edge Functions `catalogo-admin` v1 (`verify_jwt=true`) e `storage-cleanup` v2 (`verify_jwt=false`, token próprio validado no banco) estão ativas. RLS, bucket, view e fila foram conferidos. Código de frontend preparado localmente e testes passaram (10/10); **ainda não foi enviado ao GitHub nem publicado no Cloudflare Pages**. Não há linhas de catálogo/assinatura/produtos, nenhum Pix/cobrança foi criado e nenhuma rotina de limpeza foi executada nesta implantação. Nenhum objeto do Storage foi apagado.

## 1. Vitrine dinâmica pública e integração ao perfil

- [x] Uma página dinâmica para todos os comércios (`pages/catalogo.html?id=...`), sem páginas HTML individuais por loja.
- [x] No perfil: botão público somente com catálogo ativo; proprietário autenticado recebe acesso de gestão ou contratação conforme o estado.
- [x] A vitrine identifica o comércio, valida publicação e assinatura, carrega categorias/produtos e inclui nome, imagem, descrição, endereço, contato e retorno ao perfil.
- [x] Produtos mostram foto (ou imagem neutra), nome, descrição, preço, categoria e disponibilidade. Catálogo inativo/bloqueado não revela produtos.
- [x] Comércio não ativo/deletado não passa pela autorização pública do catálogo.

## 2. Assinatura premium — sem cobrança nesta etapa

- [x] Tabela `catalogo_assinaturas` criada com estados `pendente`, `ativa`, `cancelada` e `expirada`, metadados de cobrança e datas.
- [x] Apenas assinatura ativa, dentro da validade, e comércio publicado ativo liberam a vitrine. A confirmação de pagamento não é gravável pelo navegador.
- [x] Página de venda explica o recurso e oferece ação demonstrativa, sem gerar cobrança nem ativar o catálogo.
- [ ] Definir preço, período e provedor Pix; integrar cobrança/webhook autenticado, idempotência e ativação server-side em etapa futura.
- [ ] Nenhum catálogo está ativo ainda; após publicar o frontend, testar o fluxo com um comércio e assinatura de teste autorizada.

## 3. Administração de categorias e produtos

- [x] Painel autenticado `pages/catalogo-admin.html`; a Edge Function verifica identidade e vínculo aprovado entre usuário e comércio. Alterar `comercio_id` não transfere propriedade.
- [x] CRUD de produtos e categorias, preço, descrição, disponibilidade, ordem, imagem e configurações de modalidade/pagamento.
- [x] Produto/categoria são arquivados logicamente; RLS não concede DELETE ao navegador. Categoria com produtos vinculados exige resolução antes do arquivamento.
- [x] Proprietário só edita com assinatura ativa; administração central pode corrigir dados e bloquear/liberar por endpoint autorizado.
- [x] Apenas o clique de solicitação demonstrativa cria a configuração pendente; uma consulta de proprietário não gera gravação lateral.

## 4. Fotos e retenção

- [x] Bucket público de leitura `catalogos` criado; upload autenticado é limitado ao comércio do proprietário, MIME JPG/PNG/WebP e 5 MiB.
- [x] Interface comprime/valida fotos, salva caminhos sob `catalogos/{comercio}/{produto}/...` e usa a imagem neutra quando não há foto.
- [x] A função de reconciliação inclui fotos de produtos e permite o bucket `catalogos` na fila de retenção.
- [x] Janela de sete dias permanece em dry-run/manual review; **nenhuma exclusão física de Storage foi habilitada nem executada**.
- [ ] Revisar futuramente relatório de órfãos e pedir autorização específica antes de qualquer purga permanente.

## 5. Carrinho, checkout e pedido por WhatsApp

- [x] Carrinho local por comércio, sem cadastro do cliente, com adicionar, quantidade, remoção e total em centavos.
- [x] Checkout coleta os dados necessários, ajustando endereço à modalidade; mostra resumo e pede confirmação explícita.
- [x] Mensagem “Pedido — Guia Turístico de Andrelândia” inclui itens, valores, cliente, entrega/retirada, pagamento e observações; abre o WhatsApp/telefone do próprio comércio.
- [x] Pedido não é gravado no banco e o site não processa pagamentos dos produtos.
- [x] Se não existir WhatsApp/telefone válido, a vitrine continua consultável, mas a sacola e o envio ficam desabilitados com aviso. Na base atual, 47 de 139 comércios não têm número válido para esse fluxo; nesses casos é preciso corrigir o contato antes de aceitar pedidos.

## 6. Publicação e verificações restantes

- [x] Migração, RLS, bucket, view e fila aplicados e verificados no projeto Supabase.
- [x] Edge Functions `catalogo-admin` v1 e `storage-cleanup` v2 implantadas; função de limpeza não foi invocada manualmente.
- [x] Testes automatizados 10/10, compilação TypeScript estrita, sintaxe JavaScript, parser SQL, IDs/links HTML e patch aplicável ao `main` verificados.
- [ ] Enviar o patch para o GitHub e publicar o frontend no Cloudflare Pages; essa publicação pública não foi autorizada nesta etapa.
- [ ] Após publicação, testar login/ownership, catálogo ativo, pedidos WhatsApp e retenção com dados reais de teste, sem cobrança.
- [ ] Definir preço/provedor Pix e só então ativar pagamentos reais mediante revisão própria.
