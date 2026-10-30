// Registro y seguimiento de los carritos que arma el bot (tool armar_carrito):
// cada carrito se guarda como 'pending' y reconcileBotCarts() lo pasa a
// 'purchased' cuando aparece la venta en TiendaNube (cartAttribution.js), o a
// 'expired' cuando pasa la ventana sin compra. Al detectar la venta le deja
// una nota interna al pedido para que se vea en el admin de TiendaNube.
import admin from 'firebase-admin';
import { getDb } from './firebase.service.js';
import { getPaidOrdersSince, setOrderOwnerNote } from './tiendanube.service.js';
import { assignCartOrders, isCartExpired, buildOwnerNote, CART_ATTRIBUTION_DAYS } from './cartAttribution.js';

const COLLECTION = 'bot-entreno_bot_carts';

export async function recordBotCart({ contactId, link, items, total }) {
  const ref = await getDb().collection(COLLECTION).add({
    contactId, link, items, total,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

let running = null;
let lastRunAt = 0;

/**
 * Cruza los carritos pendientes con los pedidos pagados. No corre dos a la
 * vez, y con `maxAgeMs` no vuelve a correr si ya corrió hace menos que eso
 * (para la pantalla de estadísticas).
 */
export function reconcileBotCarts({ maxAgeMs = 0 } = {}) {
  if (running) return running;
  if (maxAgeMs && Date.now() - lastRunAt < maxAgeMs) return Promise.resolve(null);
  running = doReconcile().finally(() => { running = null; lastRunAt = Date.now(); });
  return running;
}

async function doReconcile() {
  const snap = await getDb().collection(COLLECTION).where('status', '==', 'pending').get();
  if (snap.empty) return { pending: 0, purchased: 0, expired: 0 };

  const carts = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() })).filter(c => c.createdAt);
  if (!carts.length) return { pending: snap.size, purchased: 0, expired: 0 };
  const oldest = new Date(Math.min(...carts.map(c => c.createdAt.toDate().getTime())));
  const orders = await getPaidOrdersSince(oldest);
  // Pedidos que ya quedaron atribuidos a otro carrito: no se vuelven a contar.
  const claimedSnap = await getDb().collection(COLLECTION)
    .where('orderCreatedAt', '>=', oldest).get();
  const claimed = new Set(claimedSnap.docs.map(d => String(d.data().orderId)));
  const assigned = assignCartOrders(carts, orders, claimed);

  let purchased = 0, expired = 0;
  const now = new Date();
  for (const cart of carts) {
    const order = assigned.get(cart.id);
    if (order) {
      await cart.ref.update({
        status: 'purchased',
        orderId: order.id,
        orderNumber: order.number,
        orderTotal: Number(order.total) || 0,
        orderCreatedAt: new Date(order.created_at),
        purchasedDetectedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      purchased++;
      const note = buildOwnerNote(order.owner_note, cart);
      if (note) {
        await setOrderOwnerNote(order.id, note)
          .then(() => { order.owner_note = note; })
          .catch(err => console.error(`[botCart] No se pudo poner la nota al pedido #${order.number}:`, err.response?.data ?? err.message));
      }
    } else if (isCartExpired(cart, now)) {
      await cart.ref.update({ status: 'expired' });
      expired++;
    }
  }
  if (purchased || expired) console.log(`[botCart] Carritos: ${purchased} vendidos, ${expired} vencidos (de ${carts.length} pendientes)`);
  return { pending: carts.length - purchased - expired, purchased, expired };
}

/**
 * Resumen de carritos creados en [start, end].
 * @returns {Promise<{ created, purchased, pending, expired, conversionPct, salesTotal, cartsTotal, windowDays, carts }>}
 */
export async function getBotCartStats(start, end) {
  const snap = await getDb().collection(COLLECTION)
    .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(start))
    .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(end))
    .get();
  const carts = snap.docs
    .map(d => {
      const c = d.data();
      return {
        id: d.id,
        contactId: c.contactId,
        createdAt: c.createdAt?.toDate().toISOString() ?? null,
        status: c.status,
        total: c.total ?? 0,
        items: (c.items ?? []).map(i => ({ name: i.name, quantity: i.quantity })),
        orderId: c.orderId ?? null,
        orderNumber: c.orderNumber ?? null,
        orderTotal: c.orderTotal ?? null,
      };
    })
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  const count = s => carts.filter(c => c.status === s).length;
  // Un pedido cuenta una sola vez aunque haya carritos viejos atribuidos al mismo.
  const sales = new Map();
  for (const c of carts) if (c.status === 'purchased') sales.set(String(c.orderId ?? c.orderNumber), c.orderTotal ?? 0);
  const purchased = sales.size;
  return {
    created: carts.length,
    purchased,
    pending: count('pending'),
    expired: count('expired'),
    conversionPct: carts.length ? Math.round((purchased / carts.length) * 100) : 0,
    salesTotal: [...sales.values()].reduce((s, t) => s + t, 0),
    cartsTotal: carts.reduce((s, c) => s + c.total, 0),
    windowDays: CART_ATTRIBUTION_DAYS,
    carts,
  };
}
