// Carrito armado por el bot: TiendaNube acepta un link que carga varias
// variantes de una en el carrito del cliente —
// https://tienda/cart-link/<variante>-<cantidad>,<variante>-<cantidad>
// (probado en entreno.com.ar el 2026-10-23: carga todo y el cliente calcula
// el envío con su CP como en cualquier compra). El bot nunca escribe el link
// a mano: pasa variantes y cantidades por la tool armar_carrito y acá se
// validan contra TiendaNube antes de devolverlo.

const MAX_QTY = 20;

const nameOf = p => (typeof p.name === 'string' ? p.name : (p.name?.es ?? p.name?.en ?? Object.values(p.name ?? {})[0] ?? 'Producto'));
const variantLabel = v => (v.values ?? []).map(val => val?.es ?? val?.en ?? Object.values(val ?? {})[0]).filter(Boolean).join(' / ');

export function hasStock(variant) {
  return variant.stock_management === false || variant.stock === null || variant.stock === undefined || variant.stock > 0;
}

/**
 * @param {string} storeUrl - origen de la tienda, ej "https://www.entreno.com.ar"
 * @param {Array<{ variantId: number, quantity: number }>} items
 */
export function buildCartLink(storeUrl, items) {
  const base = String(storeUrl).replace(/\/+$/, '');
  return `${base}/cart-link/${items.map(i => `${i.variantId}-${i.quantity}`).join(',')}`;
}

/**
 * Valida los ítems que pidió el bot contra TiendaNube y arma el link.
 * Si algún ítem no sirve (no existe, no está publicado, sin stock) no arma
 * nada y devuelve el motivo, para que el bot lo resuelva con el cliente en
 * vez de mandar un carrito incompleto.
 *
 * @param {Array<{ producto_id: number, variante_id: number, cantidad: number }>} rawItems
 * @param {(productId: number) => Promise<object|null>} getProduct
 * @returns {Promise<{ link: string, detalle: string[] } | { error: string }>}
 */
export async function createCartLink(rawItems, getProduct) {
  if (!Array.isArray(rawItems) || !rawItems.length) return { error: 'No hay productos para armar el carrito.' };

  // Misma variante pedida dos veces → se suman las cantidades.
  const merged = new Map();
  for (const it of rawItems) {
    const productId = Number(it?.producto_id);
    const variantId = Number(it?.variante_id);
    const quantity = Math.trunc(Number(it?.cantidad ?? 1));
    if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(variantId) || variantId <= 0) {
      return { error: 'Cada producto necesita producto_id y variante_id numéricos, tal como los devuelve buscar_productos.' };
    }
    if (!(quantity >= 1)) return { error: `Cantidad inválida para la variante ${variantId}.` };
    const prev = merged.get(variantId);
    merged.set(variantId, { productId, variantId, quantity: (prev?.quantity ?? 0) + quantity });
  }

  const products = new Map();
  const detalle = [];
  const problemas = [];
  let storeUrl = null;

  for (const item of merged.values()) {
    if (item.quantity > MAX_QTY) { problemas.push(`Cantidad muy alta (${item.quantity}) para la variante ${item.variantId}; máximo ${MAX_QTY}.`); continue; }
    if (!products.has(item.productId)) products.set(item.productId, await getProduct(item.productId));
    const product = products.get(item.productId);
    if (!product || product.published === false) { problemas.push(`El producto ${item.productId} no existe o no está publicado.`); continue; }
    const variant = (product.variants ?? []).find(v => Number(v.id) === item.variantId);
    const label = `${nameOf(product)}${variant && variantLabel(variant) ? ` (${variantLabel(variant)})` : ''}`;
    if (!variant) { problemas.push(`La variante ${item.variantId} no pertenece a ${nameOf(product)}.`); continue; }
    if (!hasStock(variant)) { problemas.push(`${label}: sin stock.`); continue; }
    if (variant.stock_management !== false && typeof variant.stock === 'number' && variant.stock < item.quantity) {
      problemas.push(`${label}: no hay stock para ${item.quantity} unidades.`); continue;
    }
    if (!storeUrl && product.canonical_url) storeUrl = new URL(product.canonical_url).origin;
    detalle.push(`${item.quantity} x ${label}`);
  }

  if (problemas.length) return { error: `No se armó el carrito: ${problemas.join(' ')}` };
  if (!storeUrl) return { error: 'No se pudo obtener la URL de la tienda.' };
  return { link: buildCartLink(storeUrl, [...merged.values()]), detalle };
}
