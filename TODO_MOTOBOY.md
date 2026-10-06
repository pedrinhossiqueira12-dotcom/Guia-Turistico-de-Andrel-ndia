# Resultados esperados

Implementação validada com 175 testes locais. Backend implantado em produção. A publicação do frontend ainda depende do instalador e do push pelo usuário.


- [x] O painel de código fica numa página separada do catálogo admin, com a lista dos pedidos e confirmação do código, acessível somente a motoboys autorizados para os pedidos atribuídos. A conta do motoboy não libera criação/edição de produtos, fatura do mês ou outras funções administrativas. O catálogo admin mantém suas funcionalidades atuais.
- [x] O proprietário consegue autorizar contas verificadas de motoboys, suspender o vínculo e atribuir/reatribuir pedidos do próprio comércio. Não existem permissões automáticas no cadastro nem compartilhamento de senha.
- [x] O design da página segue o mesmo estilo do resto do site e funciona no celular, preparado como frontend para futura aplicação APK, sem produzir APK nesta etapa.
- [x] O botão “Remover deste dispositivo”, ao lado de “Ver código do pedido”, é removido para evitar exclusão acidental do código.
- [x] O botão de ver código desaparece quando o servidor confirma a conclusão do pedido. Erros de conexão ou consulta não apagam um código ainda válido. Respostas antigas não apagam um pedido mais recente.
- [x] O botão “Continuar pelo WhatsApp” funciona antes/depois do registro quando existe contexto válido do pedido, sem bloqueio de popup, sem duplicar pedidos e sem incluir código secreto ou token de consulta na mensagem ao comércio.

- [ ] Publicar os arquivos do frontend na main e aguardar o Cloudflare Pages; gravação remota recusada na etapa anterior.
