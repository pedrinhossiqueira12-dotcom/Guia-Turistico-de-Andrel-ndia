// Identificação pura de eventos Mercado Pago: sem rede, banco, credenciais ou efeitos.
// O identificador assinado precisa apontar para um único recurso inequívoco.
import { sanitizedProviderId } from "./catalogo-pagamentos-v2.ts";

type Row = Record<string, unknown>;

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

export function eventKind(type: string, body: Row): "payment" | "order" | null {
  const normalized = type.toLowerCase();
  if (normalized === "payment" || normalized === "payments" || normalized.startsWith("payment.")) return "payment";
  if (["order", "orders", "orders_v2"].includes(normalized) || normalized.startsWith("order.")) return "order";
  // Eventos desconhecidos não viram pagamento apenas por um status enviado pelo caller.
  if (normalized) return null;
  const resource = String(body.resource || "").toLowerCase();
  if (/\/v1\/payments\//.test(resource)) return "payment";
  if (/\/v1\/orders\//.test(resource)) return "order";
  return null;
}

export function eventId(url: URL, body: Row): string {
  const bodyData = record(body.data);
  // body.id é o ID da NOTIFICAÇÃO, não o payment_id, quando data.id existe.
  const authoritative = [url.searchParams.get("data.id"), bodyData.id]
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
  const candidates = authoritative.length
    ? authoritative
    : [url.searchParams.get("id"), body.id]
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
  const ids = candidates.map(sanitizedProviderId);
  if (!ids.length || ids.some((id) => !id || id !== ids[0])) return "";
  return ids[0];
}

export function canonicalOrderType(url: URL, body: Row): "order" | "orders_v2" {
  const type = String(url.searchParams.get("type") || body.type || "").toLowerCase();
  return type === "orders_v2" || type === "orders" ? "orders_v2" : "order";
}
