# TODO — Catálogo Digital

> **Estado em 03/10/2026:** PR #4 está mesclado em `main` (`0a069f4`); `catalogo-admin` v2 e `storage-cleanup` v2 continuam ativas. A migração aprovada de Notícias/Eventos e auditoria privada de pagamentos **foi aplicada**: `conteudos_editoriais`, `catalogo_pagamentos`, RLS e bucket `noticias-eventos` foram verificados. `noticias-admin` v2 foi implantada com `verify_jwt=true` e teste anônimo retornou 403. O site editorial segue somente em branch local/prévia, **não publicado na main**. `catalogo-pix-sandbox` e qualquer função produtiva **não foram implantadas**; nenhum secret do Mercado Pago foi configurado, nenhuma chamada à API de pagamento foi feita, nenhuma assinatura foi ativada e nenhum arquivo do Storage foi apagado. Deno 2.9.7 está disponível para checagem.

## 1. Vitrine dinâmica pública e integração ao perfil

- [x] Uma página dinâmica para todos os comércios (`pages/catalogo.html?id=...`), sem páginas HTML individuais por loja.
- [x] No perfil: botão público somente com catálogo ativo; proprietário autenticado recebe acesso de gestão ou contratação conforme o estado.
- [x] A vitrine identifica o comércio, valida publicação e assinatura, carrega categorias/produtos e inclui nome, imagem, descrição, endereço, contato e retorno ao perfil.
- [x] Produtos mostram foto (ou imagem neutra), nome, descrição, preço, categoria e disponibilidade. Catálogo inativo/bloqueado não revela produtos.
- [x] Comércio não ativo/deletado não passa pela autorização pública do catálogo.

## 2. Assinatura premium — sem cobrança nesta etapa

- [x] Tabela `catalogo_assinaturas` criada com estados `pendente`, `ativa`, `cancelada` e `expirada`, metadados de cobrança e datas.
- [x] Apenas assinatura ativa, dentro da validade, e comércio publicado ativo liberam a vitrine. A confirmação de pagamento não é gravável pelo navegador.
- [x] A página comercial não mostra ações premium a visitantes; após confirmação server-side da propriedade, oferece somente o checkout privado sandbox, que não ativa a vitrine.
- [x] Definir os preços (mensal R$ 59,90; anual R$ 599,90) e escolher Mercado Pago para teste sandbox; manter os valores fora da página pública.
- [ ] Implementar, em etapa separada, cobrança de produção, webhooks de produção, renovação manual e ativação server-side após autorização própria.
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
- [x] Edge Functions `catalogo-admin` v2 e `storage-cleanup` v2 implantadas; função de limpeza não foi invocada manualmente.
- [x] A suíte anterior 31/31 passou sobre `main` pós-PR #4; a suíte ampliada 48/48 passou na branch editorial. Deno check/lint de `noticias-admin` e `catalogo-pix-sandbox` foram executados localmente; sem chamadas à API de pagamentos.
- [x] Preparar frontend editorial em branch própria e prévia HTTP; confirmar resposta 200 no preview público, 404 em slug inexistente e 403 na função editorial sem autenticação.
- [ ] Enviar PR após revisão final: `git push` da branch aprovada recebeu HTTP 403 (permissão negada ao repositório), portanto o PR **não foi criado**. Entregar patch para aplicação manual ou aguardar que o usuário reautorize o acesso do GitHub a esse repositório; não contornar 403. O merge/publicação do frontend não foi feito; build/destino `dist` e Deploy Hook do Cloudflare Pages ainda precisam de configuração pelo proprietário.
- [ ] Após publicação, testar login/ownership, catálogo ativo, pedidos WhatsApp e retenção com dados reais de teste, sem cobrança.
- [x] Definir preços e Mercado Pago para o sandbox; preços não são exibidos na página pública.
- [ ] Definir e revisar separadamente credenciais, fluxo de produção, política de renovação/estorno e autorização antes de qualquer pagamento real.


## 7. Integração Mercado Pago — sandbox (03/10/2026)

- [x] Registrar os preços definidos: mensal R$ 59,90 e anual R$ 599,90; manter ambos fora da página pública de contratação.
- [x] Confirmar que Pix Mercado Pago é um pagamento manual por período, não débito automático recorrente.
- [x] Criar rota privada e não indexada para testar os dois ciclos; o link aparece somente após confirmação server-side do proprietário.
- [x] Criar utilitários/testes de HMAC, valores em centavos, validação da order e bloqueio de `live_mode`.
- [x] Projetar a função para confirmar proprietário por `local_id`, checar `/users/me` contra o vendedor de teste, exigir `MP_MODE=sandbox` e enviar `X-Idempotency-Key`.
- [x] Manter confirmação sandbox somente em `metadata.sandbox`; não atualizar `status`, `pago_em` nem `expira_em`.
- [ ] Configurar no Supabase apenas token/ID/chave de webhook de conta de teste; segredos não devem ser enviados por mensagem.
- [ ] Publicar uma PR isolada após teste estático e revisão; não mesclar/publicar sem autorização específica.
- [ ] Com credenciais de teste, validar QR, polling e webhook; confirmar que a assinatura continua pendente e a vitrine fechada.
- [ ] Implementar cobrança de produção somente após autorização própria. Não reutilizar esta função sandbox para liberar catálogos reais.

## 8. Requisitos aprovados — novos recursos

- [ ] **Proprietário do comércio:** mostrar os controles de gerenciamento quando o usuário estiver vendo a página de um comércio que ele mesmo criou; validar corretamente se a conta conectada é proprietária; não mostrar os controles a não proprietários; aplicar a regra a comércios existentes e novos, usando a mesma lógica dos botões **Editar meu comércio** e **Excluir meu comércio**. A correção `catalogo-admin` v2 foi implantada; aguardar confirmação de Ctrl+F5 no perfil.
- [ ] **Pagamento definitivo Mercado Pago:** implementar cobrança futura dos recursos pagos (assinaturas e serviços dos estabelecimentos); produzir guia passo a passo de conta vendedora, credenciais/chaves de acesso, ambiente de produção, URLs, webhooks, Supabase, estados aprovado/pendente/recusado, vínculo ao comércio/usuário, testes antes do lançamento e separação entre frontend e Edge Functions. Nunca expor credenciais privadas no código público; manter produção desligada até teste e aprovação final.
- [ ] **Hero Notícias/Eventos:** transformar o Hero atual em sequência de notícias/eventos; a imagem atual deve deslizar para um lado e a próxima entrar pelo oposto, de forma suave e contínua, em desktop e celular, sem simplesmente usar fade.
- [ ] **CTA dinâmico do Hero:** cada publicação poderá configurar imagem, título, texto, link e texto próprio do botão; ao trocar o destaque, o botão também muda automaticamente o texto e o destino para a publicação exibida.
- [ ] **Página pública de Notícias/Eventos:** criar página própria, separada de `index.html`, para listar todos os itens publicados; permitir abrir cada notícia/evento, visualizar imagens, título e conteúdo completo, consultar dados adicionais de evento quando existirem e navegar de volta às outras áreas; seguir a identidade visual existente do Guia.
- [ ] **Painel administrativo editorial:** permitir ao administrador criar, editar e excluir uma notícia/evento; alterar título, descrição/conteúdo, imagem principal e imagens adicionais; definir link e texto do botão do Hero; escolher exibição no Hero, ordem e estado de publicação.
- [ ] **Fonte única e atualização automática:** usar uma única fonte de dados; salvar edição no banco; a publicação aparece na página de Notícias/Eventos e, quando marcada para destaque, no Hero; o texto/destino do botão vêm da própria publicação; alterações refletem no site público sem recadastrar o conteúdo.
- [ ] **Design e responsividade:** manter cores, tipografia, cards, bordas/sombras, espaçamento, botões, navegação e estilo geral atuais; a área não deve parecer um sistema separado e deve funcionar em celular, tablet e desktop.

## 9. Aprovação e limites vigentes

- [x] Em 03/10/2026 o usuário aprovou exatamente o plano de criar `public.conteudos_editoriais` (leitura pública apenas do publicado), `public.catalogo_pagamentos` (RLS privada) e bucket `noticias-eventos` (leitura pública, upload admin, até 5 MiB), com exclusão lógica e retenção em dry-run.
- [x] Aplicar a migração aprovada após testes locais: RLS de leitura apenas de publicações, tabela privada de auditoria e bucket de imagens com upload admin foram verificados. Nenhum RLS anterior do Catálogo foi alterado, nenhuma purga foi executada e nenhuma cobrança real foi ativada.
- [ ] Para o sandbox, o usuário configura somente secrets `MP_TEST_*` no dashboard Supabase; segredos não devem ser enviados por mensagem. Depois, implantar/testar somente `catalogo-pix-sandbox` e confirmar que uma order aprovada no sandbox mantém assinatura pendente e vitrine fechada.

## 10. Evidência da implementação editorial nesta branch

- [x] Home com Hero editorial horizontal sem fade, CTA por publicação, pausa/foco/touch e movimento reduzido; páginas pública e administrativa com identidade visual do Guia.
- [x] Fonte canônica `conteudos_editoriais`, Edge Function admin com verificação JWT/UID, upload controlado, exclusão lógica, URL/HTML escapados; fonte anônima só lê publicado.
- [x] Build estático consulta apenas publicados, gera HTML por slug com canonical/OG/Twitter, sitemap sem slugs retirados, `robots.txt` e fallback de foto otimizado.
- [x] 48 testes de unidade/regressão, checagem Deno e build com tabela vazia; prévia em 8766, sem notícia fictícia cadastrada no Supabase.
- [ ] Configurar Cloudflare Pages para executar build e secret de Deploy Hook; o conector Cloudflare foi oferecido nesta sessão e permaneceu desabilitado, então esses passos ficam manuais. A integração real com login admin no navegador e criação de uma publicação legítima ainda dependem da conta do proprietário.
- [ ] O evento legado Festival de Inverno ainda não foi importado: a capa referida em `DATA/eventos.json` não existe no repositório e faltam data/local confirmados.

## 11. Fechamento automático e cobrança Pix da fatura (05/10/2026)

Detalhes em `FECHAMENTO-E-FATURA-PIX.md`. Tudo preparado localmente e **desligado**; nada aplicado no Supabase.

- [x] Aplicar o patch do fechamento automático (`20261005150000`) na branch de trabalho e validar com testes.
- [x] Tornar o agendamento `pg_cron` defensivo: sem a extensão, a migration registra aviso e não aborta.
- [x] Registrar auditoria de cada execução automática em `catalogo_automacao_execucoes` (origem, competência, fechamentos, bloqueios, erro).
- [x] Corrigir o cálculo do fechamento: o total não encolhe quando a comissão passa para `bloqueado`/`paga`, o vencimento já gravado é preservado e estados terminais não são rebaixados por recálculo.
- [x] Implementar a cobrança Pix da fatura: tabelas, RPCs transacionais, Edge Function, webhook com HMAC e bloco “Pix da fatura” no painel do comércio.
- [ ] Aplicar as migrations `20261005150000`, `20261005160000` e `20261005170000` no Supabase, uma por vez, e conferir o resultado.
- [ ] Habilitar `pg_cron` no projeto antes de aplicar, para o agendamento ser criado de imediato.
- [ ] Implantar `catalogo-fatura-pix` e configurar `MP_PLATFORM_ACCESS_TOKEN`, `MP_PLATFORM_SELLER_ID`, `MP_PLATFORM_WEBHOOK_SECRET` e `FATURA_PIX_ENABLED=false`.
- [ ] Cadastrar a URL de webhook de Orders da fatura no painel do Mercado Pago.
- [ ] Testar em faturas controladas: valor divergente, confirmação repetida, cancelamento, quitação e estorno.
- [ ] Definir a política de divergência de valor e o alinhamento do desbloqueio do painel administrativo antigo.
- [ ] Só então avaliar `FATURA_PIX_ENABLED=true` e `fatura_pix_ativo=true`, com autorização explícita.

### Defeito encontrado e corrigido nesta entrega

- [x] `catalogo_confirmar_pedido_offline` falhava em toda confirmação válida: o `INSERT` da comissão usava `ON CONFLICT (pedido_id)`, ambíguo com o parâmetro de saída `pedido_id`, e o PostgreSQL abortava com `column reference "pedido_id" is ambiguous`. Corrigido em `20261005170000` com `ON CONFLICT ON CONSTRAINT catalogo_comissoes_offline_pedido_id_key`, sem mudar o contrato da Edge Function. **Aplicar antes de ligar `OFFLINE_CHECKOUT_ENABLED`.**
- [ ] Adicionar teste funcional de banco (hoje os testes do fluxo offline são estáticos, lendo o texto dos arquivos): o defeito acima passou por eles.
