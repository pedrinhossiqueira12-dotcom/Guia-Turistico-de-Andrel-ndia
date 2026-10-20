// COB-06 billing-only: vinculo explicito entre projeto Supabase e ambiente Asaas.
// Nenhum default implícito "sandbox" pode desligar as protecoes de producao.
// Funcao pura para testar sem segredos, banco ou rede.
const PRODUCAO_SUPABASE = "xdmbkflufsfqziixzpxc.supabase.co";
const STAGING_SUPABASE = "jbttwihctuibchhcyqtl.supabase.co";

export function ambienteAsaasCompativelComProjeto(
  supabaseUrl: string, ambienteDeclarado: string | undefined,
): boolean {
  if (ambienteDeclarado !== "production" && ambienteDeclarado !== "sandbox")
    return false;
  if (typeof supabaseUrl !== "string" || !supabaseUrl) return false;
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    return false;
  }
  // Bloquear credenciais, proxy e URL inesperada, sem depender da flag financeira.
  if (url.username || url.password || url.search || url.hash) return false;
  const host = url.hostname.toLowerCase();
  if (host === PRODUCAO_SUPABASE)
    return url.protocol === "https:" && !url.port && ambienteDeclarado === "production";
  if (host === STAGING_SUPABASE)
    return url.protocol === "https:" && !url.port && ambienteDeclarado === "sandbox";
  // Hosts locais/invalid reservados aos ensaios offline: jamais Asaas producao.
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".invalid"))
    return ambienteDeclarado === "sandbox";
  return false; // Dominio novo exige auditoria, nao assume ambiente.
}
