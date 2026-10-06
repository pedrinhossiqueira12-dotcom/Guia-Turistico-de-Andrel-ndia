# Área de entregas — plano de implementação

## Escopo autorizado

Página separada para motoboys, lista de pedidos e confirmação por código, preservando a gestão de catálogo atual. Remover a ação de apagar o código manualmente, ocultar código após conclusão e corrigir o envio pelo WhatsApp. Não gerar APK nesta etapa; a interface será responsiva e usará a API autenticada reaproveitável numa aplicação futura.

## Acesso mínimo

- Motoboy usa conta própria do Supabase, nunca credenciais do comerciante.
- Proprietário autoriza o e-mail de uma conta já cadastrada e verificada para o seu comércio.
- Cada pedido de entrega presencial é atribuído explicitamente a um motoboy ativo. Ele só pode listar/confirmar os próprios pedidos atribuídos.
- Motoboy não acessa endpoints de produtos, configurações de catálogo, faturas, extratos, OAuth ou gestão de entregadores.
- Suspensão é por comércio e impede leitura/baixa naquela loja, inclusive com sessão já aberta.
- O proprietário mantém todas as funções existentes. Um link leva à página separada para autorizar entregadores e atribuir pedidos.
- A baixa do motoboy só é habilitada com pedido pronto, código correto e conferência presencial de entrega/recebimento. A transação revalida atribuição e vínculo, controla cinco tentativas e comissão única.

## Estrutura

`pages/motoboy.html`, `js/motoboy.js`, `styles/motoboy.css`: painel mobile de entregas, login e confirmação. `pages/entregadores-admin.html` e script correspondente: gestão exclusiva do proprietário. `catalogo-entregas`: Edge Function com autenticação própria para API do painel e ações de gestão separadas. Migração SQL: vínculos, atribuições, auditoria e RPCs restritas ao backend. Checkout público: token forte de consulta que só permite ler o estado de um pedido; não autoriza confirmação.

## Design — extensão do sistema atual

Estética editorial já existente no Guia, sem reformulação. Verde institucional #194138 e verde profundo #091d1c para confiança, papel #f5f3ef e superfícies brancas para clareza, terracota #bd6b4d para detalhes. Georgia nos títulos e Roboto/Arial nos textos. Hierarquia enxuta, cartões de pedido em fluxo vertical, botões grandes para uso no celular e estados claros de acesso/carregamento/vazio. Reutilizar bordas arredondadas, topbar e componentes existentes. Transições curtas de até 180ms e respeito a `prefers-reduced-motion`; sem animação decorativa. Voz direta: “Minhas entregas” e “Peça o código após entregar”. Nenhum ativo visual novo é necessário: reutilizar estilos e marca existentes.

## Limites e infraestrutura

Hospedagem atual Cloudflare Pages e banco Supabase preservados. O diagnóstico gerenciado do WebDev informa ausência de projeto ativo: não inicializar outro site ou mudar hospedagem; usar verificadores locais e testes executáveis. O GitHub recusou escrita na etapa anterior; não contornar essa permissão. Preparar instalação local verificada caso a autorização continue insuficiente. Pix e automação financeira não fazem parte destas alterações.

## Resultado

175 testes passaram (sem falhas ou testes ignorados na execução com PGlite). Migração real 20261006184332 aplicada e Edge Functions catalogo-entregas v1/catalogo-pedido-offline v36 ativas. Bloqueios sem JWT e sem prova de consulta foram verificados via HTTP. O painel do proprietário existente não perdeu funcionalidades. O frontend não foi publicado automaticamente: foi preparado um pacote de instalação protegido por hashes e backup, pois a gravação no GitHub foi recusada na etapa anterior. Logout local segue a expiração padrão dos tokens Supabase; revogar o vínculo/atribuição no banco impede novas operações de motoboy independentemente da sessão.
