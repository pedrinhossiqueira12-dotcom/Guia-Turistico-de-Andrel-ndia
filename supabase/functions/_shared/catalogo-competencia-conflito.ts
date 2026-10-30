// Código SQLSTATE de concorrência exposto pelo PostgREST nas RPCs COB-06.
// A resposta é controlada pela aplicação: nunca reutilizar o texto do erro SQL.
export const COMPETENCIA_BUSY_STATUS = 409;
export const COMPETENCIA_BUSY_CODE = "competencia_em_fechamento";
export const COMPETENCIA_BUSY_MESSAGE =
  "O fechamento deste comércio está em andamento. Aguarde alguns segundos e tente novamente.";

export function isCompetenciaBusy(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "55P03";
}
