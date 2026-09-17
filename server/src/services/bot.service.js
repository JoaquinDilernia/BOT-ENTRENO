import { generateBotResponse } from './claude.service.js';
import { getKnowledgeBasePrompt } from './knowledge.service.js';
import {
  getOrCreateConversation,
  appendMessage,
  getConversationHistory,
  updateConversationStatus,
  updateHumanMode,
  updateAssignment,
  dispatchConversation,
  setUrgentFlag,
  addLabelToConversation,
} from './conversation.service.js';
import { sendWhatsAppMessage, sendInstagramMessage, downloadMediaAsBase64 } from './meta.service.js';
import { getOrCreateCustomer, buildCustomerContext, linkCustomerFromOrder } from './customer.service.js';
import { getAllLabels, createLabel } from './label.service.js';
import { getActiveAreas } from './area.service.js';
import { getDb } from './firebase.service.js';
import { toWaContactId } from './phone.js';
import { findOrder, findOrdersByEmail, formatOrderStatus, searchProducts, formatStockInfo, formatProductsSummary } from './tiendanube.service.js';

const URGENCY_KEYWORDS = [
  /urgente/i, /urgencia/i, /reclamo/i, /estafa/i, /fraude/i,
  /muy enojad/i, /indignado/i, /hablar con una persona/i, /quiero hablar/i,
];

// Captura números de pedido de Tienda Nube. A diferencia de BOT-ALTORANCHO
// (que tiene Odoo con prefijos S/TN), Entreno es pura tienda online: todo
// pedido es un número puro. El número puede venir con o sin "#" y en
// cualquier parte del mensaje (ver [[project-bots]] por el patrón original).
const ORDER_REF_TOKEN = /#?(\d{3,})\b/;
const ORDER_BARE_NUMBER = /^#?(\d{3,})$/;
const ORDER_KEYWORD = /\b(pedido|orden|compra|n[uú]mero)\b/i;
const ORDER_INTENT_NO_NUMBER_PATTERNS = [
  /tracking/i,
  /donde\s*(está|esta)\s*(mi|el)\s*pedido/i,
  /estado\s*(de|del)\s*(mi|el)?\s*pedido/i,
  /cuándo\s*(llega|llega)/i,
  /mi\s+compra\b/i,
  /compr[eé]\s+(?:algo|un|una|el|la)\b/i,
];

const STOCK_PATTERNS = [
  /\bstock\b/i,
  /\bdisponib/i,
  /tienen\s+\w+/i,
  /hay\s+(?:algún|alguna|algun|alguna)\b/i,
  /\bqueda\b|\bquedan\b/i,
  // Precio — se resuelve con la misma búsqueda a TiendaNube que stock,
  // porque formatStockInfo/formatProductsSummary ya incluyen el precio.
  /\bprecio/i,
  /\bcuesta\b|\bcuestan\b/i,
  /\bsale\b|\bsalen\b/i,
  /\bvale\b|\bvalen\b/i,
  /cu[aá]nto\s+(?:sale|cuesta|vale|est[aá])/i,
];

const PRODUCT_INFO_PATTERNS = [
  /\bsabor(es)?\b/i,
  /\bpresentaci[oó]n\b/i,
  /\bcomposici[oó]n\b/i,
  /\bingrediente/i,
  /\bc[oó]mo\s+se\s+toma\b/i,
  /\bpara\s+qu[eé]\s+sirve\b/i,
  /\bficha t[eé]cnica\b/i,
  /\bmarca\b/i,
];

// La búsqueda `q=` de TiendaNube matchea contra el nombre del producto, no
// hace fuzzy/semántico — se filtran preguntas/muletillas comunes para
// quedarnos con lo que probablemente sea el nombre del producto.
const QUERY_STOPWORDS = new Set([
  'hola', 'buenas', 'buen', 'buenos', 'dia', 'día', 'dias', 'días', 'tardes', 'noches',
  'de', 'del', 'que', 'qué', 'es', 'son', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'tiene', 'tienen', 'viene', 'vienen', 'se', 'o', 'hay', 'y', 'con', 'para', 'como',
  'cuál', 'cual', 'cuáles', 'cuales', 'cuanto', 'cuánto', 'sabor', 'sabores',
  'porfavor', 'favor', 'por', 'me', 'podes', 'podés', 'puedes', 'decir', 'decime',
  'saber', 'queria', 'quería', 'quiero', 'consulta', 'pregunta', 'gustaria', 'gustaría',
]);
function cleanProductQuery(text) {
  const words = (text ?? '')
    .replace(/[¿?¡!.,]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !QUERY_STOPWORDS.has(w.toLowerCase()));
  const cleaned = words.join(' ').trim();
  return cleaned || text;
}

// Returns true if current Argentina time is within business hours
export function isWithinBusinessHours(botConfig = {}) {
  const tz = 'America/Argentina/Buenos_Aires';
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  const day = now.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeMin = hour * 60 + minute;

  const startH = botConfig.businessHoursStart ?? 9;
  const endH   = botConfig.businessHoursEnd   ?? 18;
  const days   = botConfig.businessDays        ?? [1, 2, 3, 4, 5]; // lun-vie

  return days.includes(day) && timeMin >= startH * 60 && timeMin < endH * 60;
}

function buildEscalationMessage(areaName, botConfig = {}) {
  const within = isWithinBusinessHours(botConfig);
  const startH = botConfig.businessHoursStart ?? 9;
  const endH   = botConfig.businessHoursEnd   ?? 18;
  const hoursStr = `${startH}:00 a ${endH}:00hs, lunes a viernes`;
  const label = areaName ? `*${areaName}*` : 'nuestro equipo';

  if (within) {
    return `Tu consulta fue derivada a ${label} 👋\n\nUn agente va a atenderte en breve. Por favor aguardá unos minutos.\n\n🕐 Horario de atención: ${hoursStr}.`;
  } else {
    return `Tu consulta fue derivada a ${label} 👋\n\nEn este momento estamos fuera del horario de atención (${hoursStr}). Tu mensaje fue registrado y un agente te va a responder cuando retomemos.\n\n¡Gracias por tu paciencia!`;
  }
}

function parseEscalationMarker(text, areas = []) {
  const markers = areas.map(a => ({
    re: new RegExp(`\\[ESCALAR_${a.id.toUpperCase()}\\]`, 'i'),
    assignTo: a.id,
  }));
  // Fallback genérico — no fuerza un área por defecto, queda sin asignar
  // hasta que un agente lo tome manualmente.
  markers.push({ re: /\[ESCALAR\]/i, assignTo: null });

  for (const { re, assignTo } of markers) {
    if (!re.test(text)) continue;
    const withoutLine = text.replace(/^[^\n]*\[ESCALAR[^\]]*\][^\n]*\n?/mi, '').trim();
    const cleanText = withoutLine || text.replace(re, '').trim();
    return { shouldEscalate: true, assignTo, cleanText };
  }
  return { shouldEscalate: false, assignTo: null, cleanText: text };
}

function parseCloseMarker(text) {
  if (/\[CERRAR\]/i.test(text)) {
    return { shouldClose: true, cleanText: text.replace(/\[CERRAR\]\s*/i, '').trim() };
  }
  return { shouldClose: false, cleanText: text };
}

function parseLabelMarkers(text) {
  const labels = [...text.matchAll(/\[LABEL:([^\]]+)\]/gi)].map(m => m[1].trim());
  const newLabels = [...text.matchAll(/\[NEW_LABEL:([^\]]+)\]/gi)].map(m => m[1].trim());
  const cleanText = text.replace(/\[(NEW_)?LABEL:[^\]]+\]/gi, '').trim();
  return { labels, newLabels, cleanText };
}

// Claude escribe negrita en Markdown estándar (**texto**), pero WhatsApp
// solo reconoce un asterisco de cada lado (*texto*) — con doble asterisco
// el cliente ve los asteriscos literales en vez de texto en negrita.
function toWhatsAppBold(text) {
  return text.replace(/\*\*(.+?)\*\*/g, '*$1*');
}

// WhatsApp suele mandar mensajes de un mismo contacto en ráfagas de a
// segundos (varias burbujas separadas). Cada una llega como un webhook HTTP
// independiente y Express los procesa en paralelo, así que sin esta cola
// dos mensajes casi simultáneos disparan dos llamadas a Claude en paralelo
// con el mismo historial de partida. Serializamos por contactId.
const contactLocks = new Map();

export function processIncomingMessage(msg) {
  // Canonicalizar el teléfono ni bien entra. Meta manda el "from" de los
  // números argentinos a veces con el 9 de celular y a veces sin él; si no
  // lo normalizamos acá, la respuesta del cliente cae en un documento de
  // conversación distinto al de la plantilla que le mandamos y se ve como
  // dos chats separados. Solo aplica a WhatsApp — el "from" de Instagram
  // es un ID de usuario, no un teléfono.
  if (msg.channel === 'whatsapp' && msg.from) {
    const canonical = toWaContactId(msg.from);
    if (canonical) msg = { ...msg, from: canonical };
  }
  const contactId = msg.from;
  const previous = contactLocks.get(contactId) ?? Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => processIncomingMessageInternal(msg))
    .finally(() => {
      if (contactLocks.get(contactId) === current) contactLocks.delete(contactId);
    });
  contactLocks.set(contactId, current);
  return current;
}

const REPLY_PREVIEW_MAX = 80;

function resolveReplyTo(history, replyToWaMsgId) {
  if (!replyToWaMsgId) return null;
  const original = history.find(m => m.waMsgId === replyToWaMsgId);
  if (!original) return null;
  const content = original.content ?? '';
  const preview = content.length > REPLY_PREVIEW_MAX
    ? `${content.slice(0, REPLY_PREVIEW_MAX)}…`
    : content;
  return { preview, role: original.role };
}

async function processIncomingMessageInternal(msg) {
  const { channel, from, text, type, mediaId, mediaUrl, contactName, messageId, replyToWaMsgId } = msg;

  let conversation, history, knowledgeBase, customer, availableLabels, configDoc, areas;
  try {
    [conversation, history, knowledgeBase, customer, availableLabels, configDoc, areas] = await Promise.all([
      getOrCreateConversation(from, channel, contactName),
      getConversationHistory(from),
      getKnowledgeBasePrompt().catch(() => ''),
      getOrCreateCustomer(from, channel, contactName),
      getAllLabels().catch(() => []),
      getDb().collection('bot-entreno_config').doc('bot_config').get().catch(() => ({ exists: false, data: () => ({}) })),
      getActiveAreas().catch(() => []),
    ]);
  } catch (err) {
    console.error('[bot] Error cargando contexto para', from, err.message);
    return;
  }
  const botConfig = configDoc.exists ? configDoc.data() : {};
  console.log(`[bot] Contexto cargado para ${from} — humanMode: ${conversation.humanMode}, status: ${conversation.status}`);
  const replyTo = resolveReplyTo(history, replyToWaMsgId);

  // Auto-reopen archived/resolved conversations when a new message arrives → always goes to bot
  const isArchived = ['resolved', 'bot_archived'].includes(conversation.status)
    || conversation.status === 'urgent'; // legacy urgent status
  if (isArchived) {
    const previousStatus = conversation.status;
    await Promise.all([
      updateConversationStatus(from, 'bot'),
      updateHumanMode(from, false),
      updateAssignment(from, null),
    ]);
    conversation.status = 'bot';
    conversation.humanMode = false;
    conversation.assignedTo = null;
    console.log(`[bot] Conversación ${from} reabierta automáticamente desde '${previousStatus}'`);
  }

  if (conversation.humanMode) {
    const SAVEABLE_MEDIA = { image: true, audio: true, video: true, document: true, sticker: true };
    if (SAVEABLE_MEDIA[type]) {
      const contentMap = {
        image:    text?.trim() ? `[Imagen] ${text}` : '[Imagen recibida]',
        audio:    '[Audio recibido]',
        video:    '[Video recibido]',
        document: '[Archivo recibido]',
        sticker:  '[Sticker]',
      };
      await appendMessage(from, {
        role: 'user',
        content: contentMap[type],
        mediaType: type,
        mediaId: mediaId ?? null,
        contactName,
        messageId,
        ...(replyTo && { replyTo }),
      });
    } else if (text?.trim()) {
      await appendMessage(from, { role: 'user', content: text, contactName, messageId, ...(replyTo && { replyTo }) });
    }
    console.log(`[bot] humanMode activo para ${from} — bot silenciado`);
    return;
  }

  // --- Non-text type handling ---
  if (type === 'audio') {
    const prevAudios = history.filter(m => m.role === 'user' && m.mediaType === 'audio').length;
    const audioUserMsg = '[Audio recibido]';
    await appendMessage(from, { role: 'user', content: audioUserMsg, mediaType: 'audio', mediaId: mediaId ?? null, contactName, messageId, ...(replyTo && { replyTo }) });

    let reply;
    if (prevAudios >= 1) {
      reply = 'Entiendo que preferís los audios — lamentablemente no puedo escucharlos. ¿Querés que te pase con un agente que pueda ayudarte mejor?';
      await setUrgentFlag(from, true);
    } else {
      reply = 'Hola! Recibí tu audio pero no puedo escucharlo 🎙️ ¿Podés contarme por escrito en qué te ayudo?';
    }
    await appendMessage(from, { role: 'assistant', content: reply });
    if (channel === 'whatsapp') await sendWhatsAppMessage(from, reply);
    else if (channel === 'instagram') await sendInstagramMessage(from, reply);
    return;
  }

  if (type === 'video' || type === 'sticker') {
    if (!text?.trim()) return;
  }

  if (type === 'document') {
    const reply = 'Recibí un archivo, pero no puedo procesarlo directamente. ¿Podés contarme por escrito en qué te ayudo?';
    // mediaId se guardaba acá antes — sin él, el archivo (ej: un PDF) quedaba
    // imposible de ver o descargar después desde el panel.
    await appendMessage(from, { role: 'user', content: '[Archivo recibido]', mediaType: 'document', mediaId: mediaId ?? null, contactName, messageId, ...(replyTo && { replyTo }) });
    await appendMessage(from, { role: 'assistant', content: reply });
    if (channel === 'whatsapp') await sendWhatsAppMessage(from, reply);
    else if (channel === 'instagram') await sendInstagramMessage(from, reply);
    return;
  }

  // --- Image: download and pass to Claude ---
  let imageData = null;
  if (type === 'image') {
    if (mediaId) {
      imageData = await downloadMediaAsBase64(mediaId).catch(() => null);
    } else if (mediaUrl) {
      try {
        const axios = (await import('axios')).default;
        const { data: buffer } = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
        imageData = { base64: Buffer.from(buffer).toString('base64'), mimeType: 'image/jpeg' };
      } catch { /* continue without image */ }
    }
    const userContent = text?.trim() ? `[Imagen] ${text}` : '[Imagen recibida]';
    await appendMessage(from, { role: 'user', content: userContent, mediaType: 'image', mediaId: mediaId ?? null, contactName, messageId, ...(replyTo && { replyTo }) });
  } else {
    if (!text?.trim()) return;
    await appendMessage(from, { role: 'user', content: text, contactName, messageId, ...(replyTo && { replyTo }) });
  }

  // Detect urgency keywords and flag (as urgent flag, not status change)
  const isUrgent = text && URGENCY_KEYWORDS.some(re => re.test(text));
  if (isUrgent && !conversation.urgent) {
    setUrgentFlag(from, true).catch(() => {});
  }

  const [orderContext, stockInfo, productInfo] = await Promise.all([
    resolveOrderContext(text ?? '', customer, conversation),
    resolveStockContext(text ?? ''),
    resolveProductInfoContext(text ?? ''),
  ]);
  const customerContext = buildCustomerContext(customer);

  if (orderContext.tnCustomer) {
    linkCustomerFromOrder(from, orderContext.tnCustomer).catch(err =>
      console.error('[bot] linkCustomerFromOrder error:', err.message)
    );
  }
  if (orderContext.orderRef) {
    getDb().collection('bot-entreno_conversations').doc(from)
      .update({ lastOrderRef: orderContext.orderRef })
      .catch(() => {});
  }

  console.log(`[bot] Llamando a Claude para ${from}`);
  let botReply;
  try {
    botReply = await generateBotResponse(text ?? '', history, {
      knowledgeBase,
      orderInfo: orderContext.orderInfo,
      orderRef: orderContext.orderRef,
      stockInfo,
      productInfo,
      customerContext,
      availableLabels: availableLabels.map(l => l.name),
      botConfig,
      imageData,
      areas,
    });
  } catch (err) {
    console.error(`[bot] Claude falló definitivamente para ${from} tras reintentos:`, err.message);
    const fallbackMsg = 'Estamos con un poquito de demora en este momento, ¡ya te contestamos! 🙏';
    await appendMessage(from, { role: 'assistant', content: fallbackMsg });
    await setUrgentFlag(from, true).catch(() => {});
    if (channel === 'whatsapp') await sendWhatsAppMessage(from, fallbackMsg).catch(() => {});
    else if (channel === 'instagram') await sendInstagramMessage(from, fallbackMsg).catch(() => {});
    return;
  }
  console.log(`[bot] Claude respondió (${botReply.length} chars) para ${from}`);

  const { shouldEscalate, assignTo, cleanText: textAfterEscalation } = parseEscalationMarker(botReply, areas);
  const { shouldClose, cleanText: textAfterClose } = parseCloseMarker(textAfterEscalation);
  const { labels: botLabels, newLabels: botNewLabels, cleanText: textAfterLabels } = parseLabelMarkers(textAfterClose);
  const cleanText = toWhatsAppBold(textAfterLabels);

  await appendMessage(from, { role: 'assistant', content: cleanText });

  if (botNewLabels.length > 0) {
    await Promise.all(botNewLabels.map(l => createLabel(l, '#6b7280').then(() => addLabelToConversation(from, l))));
    console.log(`[bot] Nuevas labels creadas y aplicadas a ${from}:`, botNewLabels);
  }
  if (botLabels.length > 0) {
    await Promise.all(botLabels.map(l => addLabelToConversation(from, l)));
    console.log(`[bot] Labels aplicadas a ${from}:`, botLabels);
  }

  if (channel === 'whatsapp') {
    if (!cleanText.trim()) {
      console.warn(`[bot] cleanText vacío para ${from} — no se envía a WPP`);
    } else {
      try {
        console.log(`[bot] Enviando WPP a ${from}: ${cleanText.substring(0, 60)}`);
        await sendWhatsAppMessage(from, cleanText);
        console.log(`[bot] WPP enviado OK a ${from}`);
      } catch (sendErr) {
        console.error(`[bot] ERROR enviando WPP a ${from}:`, sendErr.response?.data ?? sendErr.message);
      }
    }
  } else if (channel === 'instagram') {
    if (cleanText.trim()) {
      try {
        await sendInstagramMessage(from, cleanText);
      } catch (sendErr) {
        console.error(`[bot] ERROR enviando IG a ${from}:`, sendErr.response?.data ?? sendErr.message);
      }
    }
  }

  if (shouldEscalate) {
    await dispatchConversation(from, {
      status: 'escalated',
      humanMode: true,
      assignedTo: assignTo ?? null,
    });
    console.log(`[bot] Escalando ${from} → área: ${assignTo ?? 'sin asignar'}`);

    const areaName = areas.find(a => a.id === assignTo)?.name ?? null;
    const escalationMsg = buildEscalationMessage(areaName, botConfig);
    try {
      await appendMessage(from, { role: 'assistant', content: escalationMsg });
      if (channel === 'whatsapp') await sendWhatsAppMessage(from, escalationMsg);
      else if (channel === 'instagram') await sendInstagramMessage(from, escalationMsg);
    } catch (err) {
      console.error('[bot] Error enviando mensaje de escalación:', err.message);
    }
  } else if (shouldClose) {
    await updateConversationStatus(from, 'resolved');
    console.log(`[bot] Conversación ${from} resuelta por el bot`);
  }
}

async function resolveStockContext(text) {
  if (!text || !STOCK_PATTERNS.some(re => re.test(text))) return null;

  try {
    const products = await searchProducts(cleanProductQuery(text));
    if (!products?.length) return null;
    // Consulta puntual a un solo producto vs. consulta amplia por categoría/
    // marca (ej. "qué whey protein tenés") que matchea varios — en ese caso
    // se le pasa a Claude el precio+stock de todos, no solo el primero.
    const info = products.length === 1 ? formatStockInfo(products[0]) : formatProductsSummary(products);
    if (!info) return null;
    return `${info}\n\nEl cliente también puede confirmar precio y stock actualizado en la página del producto en entreno.com.ar.`;
  } catch (err) {
    console.error('[bot] resolveStockContext error:', err.message);
    return null;
  }
}

// Quita el <link> de Google Fonts y las etiquetas HTML que TiendaNube guarda
// en la descripción del producto, dejando texto plano legible para el prompt.
function stripProductDescriptionHtml(html) {
  return html
    .replace(/<link[^>]*>/gi, '')
    .replace(/<\/?(p|div|li|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

async function resolveProductInfoContext(text) {
  if (!text || !PRODUCT_INFO_PATTERNS.some(re => re.test(text))) return null;

  try {
    const products = await searchProducts(cleanProductQuery(text));
    if (!products?.length) return null;
    const p = products[0];

    const name = typeof p.name === 'string' ? p.name : (p.name?.es ?? p.name?.en ?? Object.values(p.name ?? {})[0] ?? 'Producto');
    const rawDesc = p.description?.es ?? p.description?.en ?? Object.values(p.description ?? {})[0] ?? '';
    const cleanDesc = rawDesc ? stripProductDescriptionHtml(rawDesc) : '';
    if (!cleanDesc) return null;

    return `Producto: ${name}\n${cleanDesc}`;
  } catch (err) {
    console.error('[bot] resolveProductInfoContext error:', err.message);
    return null;
  }
}

/**
 * Resuelve si el mensaje hace referencia a un pedido y lo busca en Tienda
 * Nube. Versión simplificada de la de BOT-ALTORANCHO (ver [[project-bots]]):
 * Entreno no tiene Odoo ni locales físicos, así que todo pedido se busca
 * ÚNICA Y EXCLUSIVAMENTE en TiendaNube, por número o por email.
 */
async function resolveOrderContext(text, customer, conversation = {}) {
  const trimmed = text.trim();

  if (trimmed.includes('@')) {
    const tnOrders = await findOrdersByEmail(trimmed);
    if (tnOrders.length) {
      const summary = tnOrders.map(o => formatOrderStatus(o)).filter(Boolean);
      return { orderInfo: summary, tnCustomer: tnOrders[0]?.customer ?? null };
    }
    return { orderInfo: null, tnCustomer: null };
  }

  // Mensaje es directamente el número (con o sin "#"), ej: bot preguntó
  // "¿número de pedido?" y el cliente contesta solo "20610" o "#20610".
  const bareMatch = trimmed.match(ORDER_BARE_NUMBER);

  // Palabra clave de pedido en cualquier parte del mensaje + número en
  // cualquier parte del mensaje (no hace falta que estén pegados).
  const hasKeyword = ORDER_KEYWORD.test(trimmed);
  const tokenMatch = trimmed.match(ORDER_REF_TOKEN);

  const orderRef = bareMatch?.[1] ?? (hasKeyword && tokenMatch ? tokenMatch[1] : null);

  if (orderRef) {
    const result = await searchOrderByRef(orderRef, customer?.tnEmail);
    return { ...result, orderRef };
  }

  // Hay intención de consultar un pedido/compra pero sin número — priorizar
  // la última orden mencionada en esta conversación, luego la del perfil.
  const hasIntentWithoutNumber = hasKeyword || ORDER_INTENT_NO_NUMBER_PATTERNS.some(re => re.test(trimmed));
  if (hasIntentWithoutNumber) {
    const fallbackRef = conversation.lastOrderRef ?? String(customer?.tnOrders?.[0]?.number ?? '');
    if (fallbackRef) {
      console.log(`[bot] Sin número en mensaje, usando orden del contexto: #${fallbackRef}`);
      const result = await searchOrderByRef(fallbackRef, customer?.tnEmail);
      return { ...result, orderRef: fallbackRef };
    }
    return { orderInfo: null, tnCustomer: null };
  }

  return { orderInfo: null, tnCustomer: null };
}

async function searchOrderByRef(orderRef, email = null) {
  const tnOrder = await findOrder(orderRef);

  if (tnOrder) {
    console.log(`[bot] Pedido #${orderRef} encontrado en TiendaNube (TN id: ${tnOrder.id})`);
    return { orderInfo: formatOrderStatus(tnOrder), tnCustomer: tnOrder.customer ?? null };
  }

  // Último recurso: si ya sabemos el email del cliente en esta conversación,
  // reintentar por email — cubre pedidos 'open' que q= no indexa y que la
  // paginación por número puede fallar en encontrar bajo tráfico alto.
  if (email) {
    console.log(`[bot] Pedido #${orderRef} no encontrado, reintentando por email conocido (${email})`);
    const emailOrders = await findOrdersByEmail(email);
    const match = emailOrders.find(o => String(o.number) === orderRef);
    if (match) {
      console.log(`[bot] Pedido #${orderRef} encontrado vía email conocido`);
      return { orderInfo: formatOrderStatus(match), tnCustomer: match.customer ?? null };
    }
  }

  return { orderInfo: null, tnCustomer: null };
}
