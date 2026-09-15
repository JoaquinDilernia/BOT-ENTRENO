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
import { getOrCreateCustomer, buildCustomerContext } from './customer.service.js';
import { getAllLabels, createLabel } from './label.service.js';
import { getActiveAreas } from './area.service.js';
import { findProjectByPhone } from './project.service.js';
import { createTicket } from './ticket.service.js';
import { getDb } from './firebase.service.js';
import { toWaContactId } from './phone.js';

const URGENCY_KEYWORDS = [
  /urgente/i, /urgencia/i, /reclamo/i, /estafa/i, /fraude/i,
  /muy enojad/i, /indignado/i, /hablar con una persona/i, /quiero hablar/i,
];

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

function parseTicketMarker(text) {
  const match = text.match(/\[CREAR_TICKET:\s*(\{[\s\S]*\})\s*\]/i);
  if (!match) return { shouldCreateTicket: false, ticketParams: null, cleanText: text };
  let ticketParams = null;
  try {
    ticketParams = JSON.parse(match[1]);
  } catch (err) {
    console.error('[bot] CREAR_TICKET con JSON inválido, se descarta:', err.message, '—', match[1]);
    ticketParams = null;
  }
  // Sweep de seguridad: si el parseo falló o el marcador quedó parcialmente
  // capturado, nunca dejar que texto tipo "[CREAR_TICKET:...]" le llegue al
  // cliente por WhatsApp.
  const cleanText = text.replace(match[0], '').replace(/\[CREAR_TICKET[\s\S]*?\]/gi, '').trim();
  return { shouldCreateTicket: !!ticketParams, ticketParams, cleanText };
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

  const customerContext = buildCustomerContext(customer);

  console.log(`[bot] Llamando a Claude para ${from}`);
  let botReply;
  try {
    botReply = await generateBotResponse(text ?? '', history, {
      knowledgeBase,
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
  const { shouldCreateTicket, ticketParams, cleanText: textAfterTicket } = parseTicketMarker(textAfterClose);
  const { labels: botLabels, newLabels: botNewLabels, cleanText: textAfterLabels } = parseLabelMarkers(textAfterTicket);
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

  if (shouldCreateTicket && ticketParams) {
    try {
      const project = await findProjectByPhone(from).catch(() => null);
      // Si el mensaje que disparó el ticket era una imagen, se adjunta esa.
      // Si no, se busca la última imagen que el cliente mandó en el
      // historial reciente (el historial cargado al principio del turno
      // todavía no incluye el mensaje actual, así que no hay doble conteo).
      // Solo se busca en los últimos mensajes del historial — no en toda la
      // conversación — para no adjuntar una imagen vieja y no relacionada al
      // ticket (p.ej. una captura de pantalla de hace meses sobre otro tema).
      const recentHistory = history.slice(-6);
      const lastImageMsg = [...recentHistory].reverse().find(m => m.role === 'user' && m.mediaType === 'image' && m.mediaId);
      const imageMediaId = (type === 'image' && mediaId) ? mediaId : (lastImageMsg?.mediaId ?? null);

      const ticket = await createTicket({
        titulo: ticketParams.titulo || 'Ticket sin título',
        descripcion: ticketParams.descripcion || '',
        proyectoId: project?.id ?? null,
        contactId: from,
        prioridad: ['baja', 'media', 'alta', 'urgente'].includes(ticketParams.prioridad) ? ticketParams.prioridad : 'media',
        imagenes: imageMediaId ? [{ mediaId: imageMediaId, mimeType: 'image/jpeg' }] : [],
        createdBy: 'bot',
      });
      console.log(`[bot] Ticket ${ticket.id} creado para ${from}${project ? ` (proyecto: ${project.nombre})` : ' (sin proyecto vinculado)'}`);

      const confirmMsg = `✅ Ticket #${ticket.id.slice(0, 6)} creado — en breve el equipo te contacta.`;
      await appendMessage(from, { role: 'assistant', content: confirmMsg });
      if (channel === 'whatsapp') await sendWhatsAppMessage(from, confirmMsg).catch(() => {});
      else if (channel === 'instagram') await sendInstagramMessage(from, confirmMsg).catch(() => {});
    } catch (err) {
      console.error('[bot] Error creando ticket:', err.message);
      const failMsg = 'Che, tuvimos un problema técnico registrando tu ticket. Ya le avisamos al equipo, en breve te contactamos para solucionarlo.';
      await appendMessage(from, { role: 'assistant', content: failMsg }).catch(() => {});
      await setUrgentFlag(from, true).catch(() => {});
      if (channel === 'whatsapp') await sendWhatsAppMessage(from, failMsg).catch(() => {});
      else if (channel === 'instagram') await sendInstagramMessage(from, failMsg).catch(() => {});
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
