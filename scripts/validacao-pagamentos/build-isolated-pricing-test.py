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
assert "CREATE OR REPLACE FUNCTION public.catalogo_fluxo_precificar(" in function
assert function.count(chr(36) * 2) == 2, "Delimitadores inesperados na RPC extraida"
assert fixture.count("DO $$") == 1
bootstrap, assertions = fixture.split("DO $$", 1)
Path("/tmp/catalogo-precificacao-ci.sql").write_text(
    bootstrap + "\n" + function + "\nDO $$" + assertions
)
print("SQL de integracao montado com a funcao real da migracao.")

# Extrai as duas restricoes reais da mesma migracao, sem replicar suas regras.
fixture_constraints = Path("supabase/tests/isolated/constraints-financeiro-postgres.sql").read_text()
statements = []
for table, constraint in (
    ("catalogo_pedidos", "catalogo_pedidos_taxas_v2_check"),
    ("catalogo_comissoes_offline", "catalogo_comissoes_offline_v2_snapshot_check"),
):
    prefix = f"ALTER TABLE public.{table}"
    marker = f"ADD CONSTRAINT {constraint} CHECK ("
    candidates = [
        statement.strip() + ";"
        for statement in migration.split(";")
        if prefix in statement and marker in statement
    ]
    assert len(candidates) == 1, f"Restricao nao encontrada ou ambigua: {constraint}"
    statement = candidates[0]
    statement = statement[statement.index(prefix):]
    assert statement.count("ADD CONSTRAINT") == 1, f"Restricao extraida com estrutura inesperada: {constraint}"
    assert statement.rstrip().endswith(";"), f"Restricao sem terminador: {constraint}"
    statements.append(statement)
assert fixture_constraints.count("-- __CONSTRAINTS_FROM_REAL_MIGRATION__") == 1
Path("/tmp/catalogo-constraints-ci.sql").write_text(
    fixture_constraints.replace("-- __CONSTRAINTS_FROM_REAL_MIGRATION__", "\n".join(statements))
)
print("CHECKs reais de pedidos e comissoes offline preparados para banco isolado.")
