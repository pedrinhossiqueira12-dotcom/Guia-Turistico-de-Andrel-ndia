#!/usr/bin/env bash
# Executa as migrations do bloco de pagamentos presenciais em um PostgreSQL
# descartável e roda os cenários funcionais. Uso: bash rodar.sh
#
# Requer um PostgreSQL local acessível pelo usuário atual ou por `sudo -u postgres`.
# Nenhuma conexão com o Supabase é feita; nenhum dado real é tocado.
set -uo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$BASE_DIR/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
DB="guia_pagamentos_teste"
chmod 755 "$TMP_DIR"

MIGRATIONS=(
  "20261005120000_catalogo_pagamentos_offline.sql"
  "20261005123000_catalogo_pedidos_offline_auditoria.sql"
  "20261005150000_catalogo_fechamento_automatico.sql"
  "20261005160000_catalogo_fatura_pix.sql"
  "20261005170000_catalogo_correcao_confirmacao_offline.sql"
)

cp "$BASE_DIR"/*.sql "$TMP_DIR/"
for migration in "${MIGRATIONS[@]}"; do cp "$REPO_DIR/supabase/migrations/$migration" "$TMP_DIR/"; done
chmod 644 "$TMP_DIR"/*.sql

if [ "$(id -un)" = "postgres" ]; then
  PSQL=(psql)
else
  PSQL=(sudo -u postgres psql)
fi

"${PSQL[@]}" -qc "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1
"${PSQL[@]}" -qc "CREATE DATABASE $DB;" >/dev/null

aplicar() {
  if "${PSQL[@]}" -q -d "$DB" -v ON_ERROR_STOP=1 -f "$TMP_DIR/$1" >/dev/null 2>&1; then
    echo "ok       $1"
  else
    echo "FALHOU   $1"
    "${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -f "$TMP_DIR/$1" 2>&1 | tail -5
    exit 1
  fi
}

aplicar 00-bootstrap.sql
for migration in "${MIGRATIONS[@]}"; do aplicar "$migration"; done
aplicar 10-setup.sql

echo
echo "--- suíte funcional ---"
"${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -f "$TMP_DIR/30-funcional.sql" 2>&1 | grep -E "NOTICE|ERROR" | sed 's/^psql:[^ ]*: //'

echo
echo "--- comportamento antes da correção 20261005170000 (demonstração) ---"
ANTES="guia_pagamentos_antes"
"${PSQL[@]}" -qc "DROP DATABASE IF EXISTS $ANTES;" >/dev/null 2>&1
"${PSQL[@]}" -qc "CREATE DATABASE $ANTES;" >/dev/null
for arquivo in 00-bootstrap.sql 20261005120000_catalogo_pagamentos_offline.sql 20261005123000_catalogo_pedidos_offline_auditoria.sql 10-setup.sql; do
  "${PSQL[@]}" -q -d "$ANTES" -v ON_ERROR_STOP=1 -f "$TMP_DIR/$arquivo" >/dev/null 2>&1
done
"${PSQL[@]}" -d "$ANTES" -c "SELECT * FROM public.catalogo_confirmar_pedido_offline('hash-token-B','hash-codigo-B','Entregador');" 2>&1 | grep -E "ERROR|DETAIL" | head -3

"${PSQL[@]}" -qc "DROP DATABASE IF EXISTS $ANTES;" >/dev/null 2>&1
"${PSQL[@]}" -qc "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1
rm -rf "$TMP_DIR"
echo
echo "validação concluída"
