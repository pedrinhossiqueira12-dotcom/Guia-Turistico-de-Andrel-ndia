# Referências técnicas do Catálogo Digital

- Supabase, tabelas e dados: https://supabase.com/docs/guides/database/tables — referência para criação e relações entre tabelas.
- Supabase, segurança de views: https://supabase.com/docs/guides/database/views — views podem ser executadas com permissões do chamador; a implementação usa `security_invoker=true` para manter RLS.
- Supabase, RLS e funções `SECURITY DEFINER`: https://supabase.com/docs/guides/database/postgres/row-level-security — as funções de autorização ficam no schema interno `catalogo_private`, com `search_path` vazio e nomes de objetos qualificados.
- Supabase Storage, controle de acesso: https://supabase.com/docs/guides/storage/security/access-control — uploads dependem de políticas RLS em `storage.objects`; a política do bucket novo restringe escrita ao proprietário.
- Supabase Storage, funções auxiliares: https://supabase.com/docs/guides/storage/schema/helper-functions — `storage.foldername()` e `storage.extension()` validam pasta e formato.

Nenhuma imagem de busca externa foi importada para parecer produto de um comércio. As fotos da vitrine serão fornecidas pelos proprietários; sem foto, será usada a imagem neutra já existente no projeto.
