import axios from 'axios';

const BASE_URL = 'https://api.tiendanube.com/v1';

const client = axios.create({
  baseURL: `${BASE_URL}/${process.env.TIENDANUBE_STORE_ID}`,
  headers: {
    Authentication: `bearer ${process.env.TIENDANUBE_ACCESS_TOKEN}`,
    'User-Agent': 'BOT-ENTRENO/1.0',
    'Content-Type': 'application/json',
  },
});

/**
 * TiendaNube limita a 2 req/seg por tienda, con ráfagas de hasta 40 (leaky bucket).
 * Con varios chats en simultáneo, una sola búsqueda de pedido ya dispara varias
 * requests en paralelo, así que hay que throttlear TODO lo que sale hacia esta API
 * para no comernos un 429 bajo tráfico alto. El tiempo de respuesta no es crítico
 * acá (puede tardar), lo que importa es que la request eventualmente se resuelva.
 * (Mismo patrón que BOT-ALTORANCHO — ver [[project-bots]].)
 */
class TokenBucket {
  constructor(ratePerSec, burst) {
    this.ratePerSec = ratePerSec;
    this.burst = burst;
    this.tokens = burst;
    this.lastRefill = Date.now();
  }
  _refill() {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.lastRefill) / 1000) * this.ratePerSec);
    this.lastRefill = now;
  }
  async take() {
    this._refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = ((1 - this.tokens) / this.ratePerSec) * 1000;
    await new Promise(r => setTimeout(r, waitMs));
    return this.take();
  }
}

const rateLimiter = new TokenBucket(1.8, 30); // margen debajo del límite real (2/seg, ráfaga 40)
const MAX_RETRIES = 6;

client.interceptors.request.use(async config => {
  await rateLimiter.take();
  return config;
});

client.interceptors.response.use(
  res => res,
  async error => {
    const config = error.config;
    const status = error.response?.status;
    const retryable = status === 429 || !error.response || status >= 500;
    config.__retryCount = config?.__retryCount ?? 0;

    if (!config || !retryable || config.__retryCount >= MAX_RETRIES) {
      throw error;
    }
    config.__retryCount += 1;

    const resetHeader = error.response?.headers?.['x-rate-limit-reset'];
    const waitMs = status === 429 && resetHeader
      ? Math.min(parseInt(resetHeader, 10) || 1000, 15000)
      : Math.min(1000 * config.__retryCount, 10000);

    console.warn(`[tiendanube] Retry ${config.__retryCount}/${MAX_RETRIES} tras ${status ?? error.message} en ${config.url} — esperando ${waitMs}ms`);
    await new Promise(r => setTimeout(r, waitMs));
    return client(config);
  }
);

const ORDER_FIELDS = 'id,number,status,payment_status,shipping_status,customer,products,total,shipping_tracking_url,shipping_option,shipping_pickup_type,note,created_at';

const TN_PAGE_SIZE = 200; // máximo que permite TiendaNube

/**
 * Busca un pedido por número exacto (ej: 51689) o email.
 *
 * Estrategia dual:
 * Fase 1 — q= en paralelo por los 3 estados: cubre pedidos recientes indexados.
 *           TiendaNube indexa para q= con cierto delay y solo hasta N pedidos atrás.
 * Fase 2 — Paginación directa: si fase 1 falla, calibra con el pedido más reciente
 *           y busca por página estimada ± 2 para encontrar pedidos más viejos.
 *
 * @param {string} query - Número de pedido o email
 * @returns {Promise<object|null>}
 */
export async function findOrder(query) {
  const num = String(query.trim());

  if (num.includes('@')) {
    try {
      const { data } = await client.get('/orders', {
        params: { q: num, fields: ORDER_FIELDS, per_page: 5 },
      });
      return data?.[0] ?? null;
    } catch (err) {
      console.error('[tiendanube] Error buscando por email:', err.message);
      return null;
    }
  }

  // --- Fase 1: búsqueda por q= (rápida, cubre pedidos recientes) ---
  try {
    const [r1, r2, r3] = await Promise.all([
      client.get('/orders', { params: { q: num, fields: ORDER_FIELDS, per_page: 50 } }),
      client.get('/orders', { params: { q: num, fields: ORDER_FIELDS, per_page: 50, status: 'closed' } }),
      client.get('/orders', { params: { q: num, fields: ORDER_FIELDS, per_page: 50, status: 'cancelled' } }),
    ]);

    const seen = new Set();
    const allOrders = [...(r1.data ?? []), ...(r2.data ?? []), ...(r3.data ?? [])]
      .filter(o => !seen.has(o.id) && seen.add(o.id));

    const qMatch = allOrders.find(o => String(o.number) === num)
      ?? allOrders.find(o => String(o.id) === num)
      ?? null;

    if (qMatch) {
      console.log(`[tiendanube] findOrder #${num}: encontrado via q= (id:${qMatch.id}, status:${qMatch.status})`);
      return qMatch;
    }
  } catch { /* continuar a fase 2 */ }

  // --- Fase 2: paginación directa para pedidos más viejos ---
  const targetNum = parseInt(num, 10);
  if (isNaN(targetNum)) return null;

  try {
    // Calibrar con el pedido más reciente para estimar la página
    const { data: calibData } = await client.get('/orders', {
      params: { per_page: 1, fields: 'number' },
    });
    const latestNum = calibData?.[0]?.number;

    if (!latestNum || targetNum > latestNum) {
      console.log(`[tiendanube] findOrder #${num}: número no existe (último: #${latestNum})`);
      return null;
    }

    if (targetNum === latestNum) {
      // Era el primer pedido, calibración ya lo trajo
      const { data: exact } = await client.get('/orders', { params: { per_page: 1, fields: ORDER_FIELDS } });
      return exact?.[0] ?? null;
    }

    // Estimación: pedidos ordenados de más nuevo a más viejo en páginas de TN_PAGE_SIZE
    // Página 1 = los TN_PAGE_SIZE más recientes, página 2 = los siguientes, etc.
    const diff = latestNum - targetNum;
    const estimatedPage = Math.max(1, Math.ceil(diff / TN_PAGE_SIZE));

    // Buscar en página estimada ± 3 en paralelo (incluyendo página 1 para pedidos recientes)
    const pages = [estimatedPage - 1, estimatedPage, estimatedPage + 1, estimatedPage + 2, estimatedPage + 3]
      .filter(p => p >= 1);

    console.log(`[tiendanube] findOrder #${num}: q= sin resultados, buscando via paginación (último:#${latestNum}, diff:${diff}, páginas:${pages.join(',')})`);

    const pageResults = await Promise.all(
      pages.map(p =>
        client.get('/orders', { params: { page: p, per_page: TN_PAGE_SIZE, fields: ORDER_FIELDS } })
          .then(r => r.data ?? [])
          .catch(err => {
            console.error(`[tiendanube] findOrder #${num}: falló la página ${p} tras reintentos:`, err.message);
            return [];
          })
      )
    );

    const pageSeen = new Set();
    const pageOrders = pageResults.flat()
      .filter(o => !pageSeen.has(o.id) && pageSeen.add(o.id));

    const pageMatch = pageOrders.find(o => o.number === targetNum) ?? null;

    if (pageMatch) {
      console.log(`[tiendanube] findOrder #${num}: encontrado via paginación (id:${pageMatch.id}, status:${pageMatch.status})`);
    } else if (pageOrders.length) {
      const nums = pageOrders.map(o => o.number);
      console.log(`[tiendanube] findOrder #${num}: no encontrado. Rango paginado: #${Math.min(...nums)}-#${Math.max(...nums)}`);
    } else {
      console.log(`[tiendanube] findOrder #${num}: paginación devolvió vacío`);
    }

    return pageMatch;
  } catch (err) {
    console.error('[tiendanube] findOrder fase2 error:', err.message, err.response?.status);
    return null;
  }
}

/**
 * Busca todos los pedidos de un cliente por email.
 * @param {string} email
 * @returns {Promise<Array>}
 */
export async function findOrdersByEmail(email) {
  try {
    const fields = 'id,number,status,payment_status,shipping_status,customer,products,total,created_at,shipping_tracking_url,shipping_option,shipping_pickup_type';
    const { data } = await client.get('/orders', { params: { q: email, fields, per_page: 5, sort_by: 'created_at', sort_direction: 'desc' } });
    return data ?? [];
  } catch (err) {
    console.error('[tiendanube] Error buscando pedidos por email:', err.message);
    return [];
  }
}

/**
 * Obtiene detalles de un pedido por ID interno.
 * @param {string|number} orderId
 * @returns {Promise<object|null>}
 */
export async function getOrderById(orderId) {
  try {
    const { data } = await client.get(`/orders/${orderId}`);
    return data;
  } catch (err) {
    console.error('[tiendanube] Error obteniendo pedido:', err.message);
    return null;
  }
}

/**
 * Busca productos por nombre o categoría. Trae también `variants` (incluye
 * stock y precio por variante — a diferencia de BOT-ALTORANCHO, Entreno no
 * tiene un sistema externo de stock (Odoo), así que el stock se lee
 * directamente de acá.
 *
 * NOTA: 'price'/'stock' NO son campos válidos a nivel producto en este
 * endpoint (TiendaNube devuelve 422) — solo existen dentro de cada
 * variants[] entry (ver incidente BOT-ALTORANCHO 2026-09-01, [[project-bots]]).
 * @param {string} query
 * @returns {Promise<Array>}
 */
export async function searchProducts(query) {
  try {
    const { data } = await client.get('/products', {
      params: { q: query, published: true, fields: 'id,name,description,images,variants' },
    });
    return data ?? [];
  } catch (err) {
    console.error('[tiendanube] Error buscando productos:', err.message);
    return [];
  }
}

/**
 * Busca un cliente por teléfono en Tienda Nube.
 * @param {string} phone
 * @returns {Promise<object|null>}
 */
export async function findCustomerByPhone(phone) {
  try {
    const { data } = await client.get('/customers', {
      params: { q: phone, fields: 'id,name,email,phone' },
    });
    return data?.[0] ?? null;
  } catch (err) {
    console.error('[tiendanube] Error buscando cliente por teléfono:', err.message);
    return null;
  }
}

/**
 * Obtiene los últimos pedidos de un cliente por su ID de TN.
 * @param {number} customerId
 * @returns {Promise<Array>}
 */
export async function getCustomerOrders(customerId) {
  try {
    const { data } = await client.get('/orders', {
      params: {
        customer_ids: customerId,
        fields: 'id,number,status,payment_status,shipping_status,created_at,total,products',
        sort_by: 'created_at',
        sort_direction: 'desc',
        per_page: 10,
      },
    });
    return data ?? [];
  } catch (err) {
    console.error('[tiendanube] Error obteniendo pedidos del cliente:', err.message);
    return [];
  }
}

/**
 * Obtiene info general de la tienda.
 * @returns {Promise<object|null>}
 */
export async function getStoreInfo() {
  try {
    const { data } = await client.get('/store');
    return data;
  } catch (err) {
    console.error('[tiendanube] Error obteniendo info tienda:', err.message);
    return null;
  }
}

const LOW_STOCK_THRESHOLD = 3;

/**
 * Formatea la disponibilidad de un producto a partir de sus variantes de
 * TiendaNube. `stock: null` en TiendaNube significa "sin control de stock"
 * (stock ilimitado), no "sin stock".
 * @param {object} product - resultado crudo de searchProducts()
 * @returns {string|null}
 */
export function formatStockInfo(product) {
  if (!product) return null;
  const name = typeof product.name === 'string' ? product.name
    : (product.name?.es ?? product.name?.en ?? Object.values(product.name ?? {})[0] ?? 'Producto');
  const variants = product.variants ?? [];
  if (!variants.length) return null;

  const lines = variants.map(v => {
    const label = (v.values ?? []).map(val => val?.es ?? val?.en ?? Object.values(val ?? {})[0]).filter(Boolean).join(' / ') || 'Único';
    if (v.stock_management === false || v.stock === null || v.stock === undefined) {
      return `- ${label}: Disponible`;
    }
    if (v.stock <= 0) return `- ${label}: Sin stock`;
    if (v.stock < LOW_STOCK_THRESHOLD) return `- ${label}: Quedan pocas unidades`;
    return `- ${label}: Disponible`;
  }).join('\n');

  return `Producto: ${name}\nDisponibilidad:\n${lines}\nEl cliente también puede confirmar el stock actualizado en la página del producto en entreno.com.ar.`;
}

/**
 * Formatea el estado de un pedido en texto legible.
 * @param {object} order
 * @returns {string}
 */
function isPickupOrder(order) {
  return order.shipping_pickup_type === 'pickup' || order.shipping_pickup_type === 'ship_to_store';
}

export function formatOrderStatus(order) {
  if (!order) return null;

  const statusMap = {
    open: 'abierto',
    closed: 'completado',
    cancelled: 'cancelado',
  };

  const paymentMap = {
    pending: 'pendiente de pago',
    authorized: 'autorizado',
    paid: 'pagado',
    voided: 'anulado',
    refunded: 'reembolsado',
    abandoned: 'abandonado',
  };

  const shippingMap = {
    unpacked: 'pendiente de preparación',
    unshipped: 'preparado / listo',
    fulfilling: 'en preparación',
    shipped: 'enviado',
    delivered: 'entregado',
    undelivered: 'no entregado',
    returned: 'devuelto',
  };

  const pickup = isPickupOrder(order);

  return {
    numero: order.number,
    estado: statusMap[order.status] ?? order.status,
    pago: paymentMap[order.payment_status] ?? order.payment_status,
    tipoEntrega: pickup ? 'retiro' : 'envío a domicilio',
    envio: shippingMap[order.shipping_status] ?? order.shipping_status,
    tracking: order.shipping_tracking_url ?? null,
    total: order.total,
    cliente: order.customer?.name ?? 'Cliente',
    productos: (order.products ?? []).map(p => {
      const name = typeof p.name === 'string' ? p.name
        : (p.name?.es ?? p.name?.en ?? Object.values(p.name ?? {})[0] ?? 'Producto');
      const variants = (p.variant_values ?? []).join(' / ');
      const label = variants ? `${name} (${variants})` : name;
      return `${label} x${p.quantity ?? 1}`;
    }).join(', ') || null,
    fecha: order.created_at ? new Date(order.created_at).toLocaleDateString('es-AR') : null,
    metodoEnvio: order.shipping_option ?? null,
    nota: order.note ?? null,
  };
}
