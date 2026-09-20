import axios from 'axios';

// Integración con Mercado Libre — arranca como esqueleto el 2026-09-20.
// Deja la forma que va a esperar bot.service.js (mismo rol que
// tiendanube.service.js: responder stock/precio/pedidos por WhatsApp) y el
// webhook de notificaciones (preguntas de publicaciones). Las funciones que
// pegan contra la API real están marcadas con TODO — la idea es que esto
// termine resuelto por un MCP de Mercado Libre; este archivo es el lugar
// donde conectarlo, o donde completar los requests a mano si se hace antes.
//
// Documentación de referencia (Mercado Libre developers):
// - OAuth: POST https://api.mercadolibre.com/oauth/token (authorization_code
//   la primera vez, refresh_token después)
// - Preguntas: GET/POST /questions — topic "questions" en el webhook
// - Pedidos: GET /orders/{id}, /orders/search — topic "orders_v2"
// - Publicaciones/stock: GET /items/{id}, /users/{id}/items/search

const BASE_URL = 'https://api.mercadolibre.com';

const {
  MERCADOLIBRE_CLIENT_ID,
  MERCADOLIBRE_CLIENT_SECRET,
  MERCADOLIBRE_REFRESH_TOKEN,
  MERCADOLIBRE_SELLER_ID,
} = process.env;

export function isConfigured() {
  return Boolean(
    MERCADOLIBRE_CLIENT_ID && MERCADOLIBRE_CLIENT_SECRET &&
    MERCADOLIBRE_REFRESH_TOKEN && MERCADOLIBRE_SELLER_ID
  );
}

// Cache en memoria del access token — vive ~6hs, se refresca solo con el
// refresh_token cuando falta poco o ya venció. Mismo criterio de cache por
// tiempo que enrichCustomerFromTiendaNube en customer.service.js.
let _token = { value: null, expiresAt: 0 };

async function getAccessToken() {
  if (!isConfigured()) {
    throw new Error('Mercado Libre no está configurado (faltan MERCADOLIBRE_* en .env)');
  }
  if (_token.value && Date.now() < _token.expiresAt - 60_000) {
    return _token.value;
  }
  const { data } = await axios.post(`${BASE_URL}/oauth/token`, {
    grant_type: 'refresh_token',
    client_id: MERCADOLIBRE_CLIENT_ID,
    client_secret: MERCADOLIBRE_CLIENT_SECRET,
    refresh_token: MERCADOLIBRE_REFRESH_TOKEN,
  });
  _token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  // ML puede rotar el refresh_token en cada renovación. Si esto empieza a
  // fallar con invalid_grant, loguear data.refresh_token acá y actualizar la
  // env var a mano — o mover el token a Firestore (bot-entreno_config) para
  // no depender de un redeploy manual cada vez que rota.
  return _token.value;
}

async function authedGet(path, config = {}) {
  const token = await getAccessToken();
  const { data } = await axios.get(`${BASE_URL}${path}`, {
    ...config,
    headers: { ...(config.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  return data;
}

async function authedPost(path, body, config = {}) {
  const token = await getAccessToken();
  const { data } = await axios.post(`${BASE_URL}${path}`, body, {
    ...config,
    headers: { ...(config.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  return data;
}

// ─────────────────────────── Productos / stock (para WhatsApp) ────────────
// Mismo rol que searchProducts/formatStockInfo en tiendanube.service.js:
// bot.service.js los llama para responder consultas de stock/precio.

export async function searchProducts(query) {
  // TODO: GET /users/{MERCADOLIBRE_SELLER_ID}/items/search?q=... trae sólo
  // IDs de publicaciones — después hay que pedir el detalle en batch con
  // GET /items?ids=... (hasta 20 por request). Usar authedGet() de acá arriba.
  throw new Error('mercadolibre.service.searchProducts: todavía no implementado');
}

export function formatStockInfo(item) {
  // TODO: mismo formato de salida (string) que tiendanube.service.js
  // formatStockInfo, para que bot.service.js pueda tratar ambas fuentes
  // igual sin ramificar la lógica de armado de la respuesta.
  throw new Error('mercadolibre.service.formatStockInfo: todavía no implementado');
}

// ─────────────────────────── Pedidos ───────────────────────────────────────

export async function findOrder(orderId) {
  // TODO: GET /orders/{id} con authedGet()
  throw new Error('mercadolibre.service.findOrder: todavía no implementado');
}

export function formatOrderStatus(order) {
  // TODO: mismo formato de salida que tiendanube.service.js formatOrderStatus.
  throw new Error('mercadolibre.service.formatOrderStatus: todavía no implementado');
}

// ─────────────────────────── Preguntas y Respuestas ────────────────────────
// Flujo separado de WhatsApp: Mercado Libre avisa por webhook (topic
// "questions") cuando alguien pregunta en una publicación, y hay que
// contestar con POST /answers. handleNotification() de acá abajo es la
// entrada llamada desde mercadolibre-webhook.routes.js.

export async function getQuestion(questionId) {
  // TODO: GET /questions/{id} con authedGet()
  throw new Error('mercadolibre.service.getQuestion: todavía no implementado');
}

export async function answerQuestion(questionId, text) {
  // TODO: POST /answers { question_id, text } con authedPost()
  throw new Error('mercadolibre.service.answerQuestion: todavía no implementado');
}

// ─────────────────────────── Webhook (notificaciones) ──────────────────────

export async function handleNotification(notification) {
  // ML manda { topic, resource, user_id, application_id, sent, attempts }.
  // Responder 200 rápido es responsabilidad de la ruta (ver
  // mercadolibre-webhook.routes.js) — acá sólo se procesa.
  const topic = notification?.topic;
  console.log('[mercadolibre] Notificación recibida:', topic, notification?.resource);

  switch (topic) {
    case 'questions':
      // TODO: getQuestion(id) -> generar la respuesta (¿reusar
      // claude.service.js con el contexto del producto, como ya se hace
      // para WhatsApp?) -> answerQuestion(id, texto).
      break;
    case 'orders_v2':
      // TODO: decidir si esto pega contra customer.service.js igual que
      // linkCustomerFromOrder en Tienda Nube, o si por ahora sólo importa
      // para el panel (Contactos/Difusiones) y no para el bot de WhatsApp.
      break;
    default:
      console.log('[mercadolibre] Topic sin manejar todavía:', topic);
  }
}
