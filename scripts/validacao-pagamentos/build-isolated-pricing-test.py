"""Monta SQL de teste a partir da funcao real versionada, sem conectar a producao."""
from pathlib import Path

migration = Path("supabase/migrations/20261007213000_arredondamento_taxa_total_7.sql").read_text()
fixture = Path("supabase/tests/isolated/precificacao-postgres.sql").read_text()
signature = "CREATE OR REPLACE FUNCTION public.catalogo_fluxo_precificar("
assert migration.count(signature) == 1, "Assinatura da RPC nao encontrada ou ambigua"
start = migration.index(signature)
end = migration.index("$$;", start) + len("$$;")
function = migration[start:end]
assert "v_plataforma := round(p_subtotal_centavos::numeric * 0.07)::integer - v_motoboy" in function
assert fixture.count("DO $$") == 1
bootstrap, assertions = fixture.split("DO $$", 1)
Path("/tmp/catalogo-precificacao-ci.sql").write_text(
    bootstrap + "\n" + function + "\nDO $$" + assertions
)
print("SQL de integracao montado com a funcao real da migracao.")
