// Atribución de ventas a los carritos que arma el bot (lógica pura, sin
// Firestore ni TiendaNube).
//
// El cart-link no deja rastro en el pedido (la API de TiendaNube no expone
// UTM ni origen), así que un carrito cuenta como VENDIDO si dentro de
// CART_ATTRIBUTION_DAYS desde que se armó, el mismo teléfono de WhatsApp
// tiene un pedido PAGADO con al menos una de las variantes del carrito.
// Es atribución por coincidencia — si compra con otro teléfono no se cuenta.
import { toWaContactId } from './phone.js';

export const CART_ATTRIBUTION_DAYS = 7;
const DAY_MS = 86400000;

export const CART_UTM = { utm_source: 'whatsapp', utm_medium: 'bot', utm_campaign: 'carrito_bot' };

/** Suma las UTM del bot al link (para Analytics / estadísticas de TiendaNube). */
export function withCartUtm(link) {
  const u = new URL(link);
  for (const [k, v] of Object.entries(CART_UTM)) u.searchParams.set(k, v);
  return u.toString();
}

function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (v._seconds) return new Date(v._seconds * 1000);
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

/** Teléfonos canónicos (formato contactId de WhatsApp) que figuran en el pedido. */
export function orderPhones(order) {
  const raw = [order.customer?.phone, order.contact_phone, order.billing_phone, order.shipping_address?.phone];
  return new Set(raw.map(p => (p ? toWaContactId(String(p)) : null)).filter(Boolean));
}

/**
 * Pedido de TiendaNube que completa el carrito, o null.
 * @param {{ contactId: string, createdAt: any, items: Array<{ variantId: number }> }} cart
 * @param {Array<object>} orders - pedidos crudos de TiendaNube
 */
export function findCartOrder(cart, orders) {
  const created = toDate(cart.createdAt);
  if (!created) return null;
  const until = created.getTime() + CART_ATTRIBUTION_DAYS * DAY_MS;
  const variants = new Set((cart.items ?? []).map(i => Number(i.variantId)));

  const candidates = orders.filter(o => {
    if (o.payment_status !== 'paid') return false;
    const at = toDate(o.created_at)?.getTime();
    if (!at || at < created.getTime() || at > until) return false;
    if (!orderPhones(o).has(cart.contactId)) return false;
    return (o.products ?? []).some(p => variants.has(Number(p.variant_id)));
  });
  candidates.sort((a, b) => toDate(a.created_at) - toDate(b.created_at));
  return candidates[0] ?? null;
}

/**
 * Asigna los pedidos a los carritos sin repetir: si el cliente armó varios
 * carritos y compró una vez, la venta es del último carrito antes de la compra
 * (si no, el mismo pedido se sumaba una vez por carrito).
 * @param {Array<{ id: string }>} carts
 * @param {Array<object>} orders - pedidos crudos de TiendaNube
 * @param {Set<string>} claimed - ids de pedidos que ya tiene otro carrito
 * @returns {Map<string, object>} id del carrito → pedido
 */
export function assignCartOrders(carts, orders, claimed = new Set()) {
  const taken = new Set([...claimed].map(String));
  const result = new Map();
  const newestFirst = [...carts].sort((a, b) => (toDate(b.createdAt) ?? 0) - (toDate(a.createdAt) ?? 0));
  for (const cart of newestFirst) {
    const order = findCartOrder(cart, orders.filter(o => !taken.has(String(o.id))));
    if (!order) continue;
    taken.add(String(order.id));
    result.set(cart.id, order);
  }
  return result;
}

/**
 * Junta en una fila los carritos que el mismo cliente rearmó (le pidió al bot
 * cambios antes de comprar): cada carrito se suma al anterior del mismo
 * contacto si está dentro de la ventana y ese grupo todavía no compró. La fila
 * junta los productos de todos (a veces el bot arma un carrito por producto),
 * la venta si la hubo y `rebuilt` = cuántas veces se armó.
 * @param {Array<{ id, contactId, createdAt, status, orderId?, orderCreatedAt? }>} carts
 */
export function groupCartRebuilds(carts) {
  const time = v => toDate(v)?.getTime() ?? 0;
  const groups = [];
  const open = new Map(); // contactId → grupo abierto
  for (const cart of [...carts].sort((a, b) => time(a.createdAt) - time(b.createdAt))) {
    const g = open.get(cart.contactId);
    const closed = !g
      || time(cart.createdAt) - time(g.last.createdAt) > CART_ATTRIBUTION_DAYS * DAY_MS
      || (g.sale && time(g.sale.orderCreatedAt) <= time(cart.createdAt))
      || (g.sale && cart.status === 'purchased' && String(cart.orderId) !== String(g.sale.orderId));
    if (closed) {
      const fresh = { last: cart, sale: null, count: 0, items: new Map() };
      groups.push(fresh);
      open.set(cart.contactId, fresh);
    }
    const cur = open.get(cart.contactId);
    cur.last = cart;
    cur.count++;
    // Mismo producto en dos versiones: vale la cantidad de la más nueva.
    for (const it of cart.items ?? []) cur.items.set(it.name, it);
    if (cart.status === 'purchased' && !cur.sale) cur.sale = cart;
  }
  return groups.map(({ last, sale, count, items }) => ({
    ...last,
    items: [...items.values()],
    total: count > 1 ? [...items.values()].reduce((s, i) => s + (i.unitPrice ?? 0) * (i.quantity ?? 0), 0) : last.total,
    status: sale ? 'purchased' : last.status,
    orderId: sale?.orderId ?? null,
    orderNumber: sale?.orderNumber ?? null,
    orderTotal: sale?.orderTotal ?? null,
    rebuilt: count,
  }));
}

/** El carrito ya no puede atribuirse a ninguna venta. */
export function isCartExpired(cart, now = new Date()) {
  const created = toDate(cart.createdAt);
  return !!created && now.getTime() - created.getTime() > CART_ATTRIBUTION_DAYS * DAY_MS;
}

export const OWNER_NOTE_MARK = 'Venta generada por el bot de WhatsApp';

/** Nota interna para el pedido; respeta lo que ya tenga y no la duplica. */
export function buildOwnerNote(existing, cart) {
  const prev = (existing ?? '').trim();
  if (prev.includes(OWNER_NOTE_MARK)) return null;
  const d = toDate(cart.createdAt);
  const fecha = d ? d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '';
  const line = `${OWNER_NOTE_MARK} (carrito armado el ${fecha}).`;
  return prev ? `${prev}\n${line}` : line;
}
