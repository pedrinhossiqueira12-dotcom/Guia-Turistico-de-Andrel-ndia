BEGIN;

-- Mantém o avatar usado no perfil no momento em que a avaliação é publicada.
-- Avaliações antigas continuam válidas e usam o avatar padrão quando a coluna estiver vazia.
ALTER TABLE public.avaliacoes
  ADD COLUMN IF NOT EXISTS avatar_url text;

COMMIT;
