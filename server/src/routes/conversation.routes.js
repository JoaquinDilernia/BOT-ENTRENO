import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import {
  listConversations,
  listArchivedConversations,
  searchConversations,
  getConversationHistory,
  updateConversationStatus,
  updateHumanMode,
  updateAssignment,
  dispatchConversation,
  setUrgentFlag,
  markAsRead,
  appendMessage,
  getOrCreateConversation,
  addLabelToConversation,
  updateMessageStatus,
  setMessageTranscript,
} from '../services/conversation.service.js';
import {
  sendWhatsAppMessage,
  sendInstagramMessage,
  sendWhatsAppTemplate,
  sendWhatsAppMedia,
  uploadMetaMedia,
  getMetaMediaStream,
  downloadMetaMedia,
  downloadUrlMedia,
} from '../services/meta.service.js';
import { prepareWhatsAppMedia, MediaRejectedError, MAX_UPLOAD_BYTES } from '../services/media.service.js';
import { transcribeAudio } from '../services/transcription.service.js';
import { createLabel } from '../services/label.service.js';
import { getDb } from '../services/firebase.service.js';
import { generateConversationSummary } from '../services/claude.service.js';
import { toWaContactId } from '../services/phone.js';

const router = Router();
// 100 MB = tope de WhatsApp para documentos. Los topes por tipo (5 MB imagen,
// 16 MB video/audio) los aplica prepareWhatsAppMedia con un mensaje claro.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

// multer guarda originalname en latin1 — un "presupuesto_año.pdf" llegaba como
// "presupuesto_aÃ±o.pdf". Se re-decodifica como UTF-8.
function decodeOriginalName(name) {
  try { return Buffer.from(name ?? '', 'latin1').toString('utf8'); } catch { return name; }
}

function uploadSingle(field) {
  const mw = upload.single(field);
  return (req, res, next) => mw(req, res, err => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'El archivo supera los 100 MB que acepta WhatsApp.' });
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

// Se mantiene el nombre por compatibilidad con los imports existentes
// (customer.routes.js). La lógica vive en phone.js para que el webhook
// entrante y todos los envíos salientes canonicen el teléfono EXACTAMENTE
// igual — si no, se duplican las conversaciones (ver phone.js).
export function normalizeArgPhone(raw) {
  return toWaContactId(raw);
}

// ---- Media proxy (must be before /:contactId routes) ----
router.get('/media/:mediaId', async (req, res) => {
  try {
    await getMetaMediaStream(req.params.mediaId, res, req.query.name ? String(req.query.name).slice(0, 200) : null);
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { channel, status, assignedTo } = req.query;
    // operador sees conversations assigned to one of their areas (bot escalation) OR directly to their email
    const assignedToFilter = req.agent.role === 'operador'
      ? [...(req.agent.areaIds ?? []), req.agent.email].filter(Boolean)
      : (assignedTo ?? undefined);
    const conversations = await listConversations({ channel, status, assignedTo: assignedToFilter });
    res.json({ conversations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Start new conversation (must be before /:contactId routes) ----
router.post('/start', async (req, res) => {
  try {
    const { phone, contactName, templateName, language, params = [], createdBy } = req.body;
    if (!phone?.trim() || !templateName?.trim()) {
      return res.status(400).json({ error: 'phone y templateName requeridos' });
    }
    const normalizedPhone = normalizeArgPhone(phone);
    if (!normalizedPhone || normalizedPhone.length < 10 || normalizedPhone.length > 15) {
      return res.status(400).json({ error: `Número de teléfono inválido: "${normalizedPhone}". Usá formato internacional, ej: 5491112345678` });
    }

    await getOrCreateConversation(normalizedPhone, 'whatsapp', contactName?.trim() || null);

    const msgId = crypto.randomUUID();
    const templateText = params.filter(Boolean).length > 0
      ? `[Plantilla: ${templateName}] ${params.join(' | ')}`
      : `[Plantilla: ${templateName}]`;

    // Save with 'sending' status before attempting send
    await appendMessage(normalizedPhone, { role: 'admin', content: templateText, msgId, msgStatus: 'sending', sentBy: req.agent.email });

    let sendError = null;
    let waMsgId = null;
    try {
      waMsgId = await sendWhatsAppTemplate(normalizedPhone, templateName, language || 'es_AR', params);
    } catch (sendErr) {
      // Extract the real Meta error message, not the axios wrapper
      const metaMsg = sendErr.response?.data?.error?.message;
      const metaCode = sendErr.response?.data?.error?.code;
      sendError = metaMsg
        ? `Meta error ${metaCode ?? ''}: ${metaMsg}`
        : sendErr.message;
      console.error('[start] Error enviando template:', sendError);
    }

    await updateMessageStatus(normalizedPhone, msgId, sendError ? 'error' : 'sent', waMsgId).catch(() => {});

    if (sendError) {
      return res.status(502).json({ error: `No se pudo enviar la plantilla: ${sendError}` });
    }

    if (createdBy) {
      await dispatchConversation(normalizedPhone, { status: 'escalated', humanMode: true, assignedTo: createdBy });
      await createLabel('Chat creado', '#3b82f6').catch(() => {});
      await addLabelToConversation(normalizedPhone, 'Chat creado');
    }

    const db = getDb();
    const updated = await db.collection('bot-entreno_conversations').doc(normalizedPhone).get();
    res.status(201).json({ id: updated.id, ...updated.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Búsqueda global: sin límite de 200, sin filtro de área, incluye archivadas.
// Debe ir antes de las rutas /:contactId/* para no colisionar con ellas.
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q || String(q).trim().length < 2) {
      return res.json({ conversations: [] });
    }
    const conversations = await searchConversations(q);
    res.json({ conversations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tacho de archivados: todo el historial resolved/bot_archived, sin límite ni
// restricción de área. Debe ir antes de las rutas /:contactId/* para
// no colisionar con ellas.
router.get('/archived', async (req, res) => {
  try {
    const conversations = await listArchivedConversations();
    res.json({ conversations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:contactId/messages', async (req, res) => {
  try {
    const messages = await getConversationHistory(req.params.contactId);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:contactId/status', async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['bot', 'escalated', 'bot_archived', 'resolved'];
    if (!valid.includes(status)) {
      return res.status(400).json({ error: `Status inválido. Valores permitidos: ${valid.join(', ')}` });
    }
    await updateConversationStatus(req.params.contactId, status);
    if (status === 'resolved' || status === 'bot_archived') {
      await updateHumanMode(req.params.contactId, false);
    }
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:contactId/dispatch', async (req, res) => {
  try {
    const { action, agentId } = req.body;

    const patches = {
      to_bot:       { status: 'bot',          humanMode: false, assignedTo: null, urgent: false },
      bot_archive:  { status: 'bot_archived', humanMode: false, assignedTo: null, urgent: false },
      resolved:     { status: 'resolved',     humanMode: false },
      set_urgent:   { urgent: true },
      unset_urgent: { urgent: false },
    };

    // take_over: assign to the requesting agent
    if (action === 'take_over') {
      if (!agentId) return res.status(400).json({ error: 'agentId requerido para take_over' });
      const patch = { status: 'escalated', humanMode: true, assignedTo: agentId };
      await dispatchConversation(req.params.contactId, patch);
      return res.json({ ok: true, ...patch });
    }

    // assign_to: escalate to a specific agent's email, or to an area id
    if (action === 'assign_to') {
      const { assignedTo: target } = req.body;
      if (!target) return res.status(400).json({ error: 'assignedTo requerido' });
      const patch = { status: 'escalated', humanMode: true, assignedTo: target };
      await dispatchConversation(req.params.contactId, patch);
      return res.json({ ok: true, ...patch });
    }

    const patch = patches[action];
    if (!patch) return res.status(400).json({ error: 'Acción inválida' });
    await dispatchConversation(req.params.contactId, patch);
    res.json({ ok: true, ...patch });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:contactId/mode', async (req, res) => {
  try {
    const { humanMode } = req.body;
    await updateHumanMode(req.params.contactId, humanMode);
    res.json({ ok: true, humanMode: !!humanMode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:contactId/assign', async (req, res) => {
  try {
    const { assignedTo } = req.body;
    if (assignedTo !== null && typeof assignedTo !== 'string') {
      return res.status(400).json({ error: 'assignedTo debe ser un string (email o id de área) o null' });
    }
    await updateAssignment(req.params.contactId, assignedTo ?? null);
    res.json({ ok: true, assignedTo: assignedTo ?? null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:contactId/read', async (req, res) => {
  try {
    await markAsRead(req.params.contactId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Meta error codes that indicate the 24h customer service window has expired
const WA_WINDOW_EXPIRED_CODES = new Set([131047, 131026, 132000, 130429]);

function isWindowExpiredError(sendErr) {
  const code = sendErr.response?.data?.error?.code;
  const msg = sendErr.response?.data?.error?.message ?? '';
  return WA_WINDOW_EXPIRED_CODES.has(code) || msg.toLowerCase().includes('window');
}

// `replyTo` (opcional): { waMsgId, role, preview } de un mensaje anterior que
// el agente eligió citar desde el panel — mismo shape que ya arma
// `resolveReplyTo()` en bot.service.js para las citas entrantes, así el
// front no necesita distinguir cómo se armó.
function sanitizeReplyTo(replyTo) {
  if (!replyTo?.waMsgId || typeof replyTo.waMsgId !== 'string') return null;
  return {
    waMsgId: replyTo.waMsgId,
    role: replyTo.role ?? null,
    preview: String(replyTo.preview ?? '').slice(0, 120),
  };
}

router.post('/:contactId/reply', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { message } = req.body;
    const replyTo = sanitizeReplyTo(req.body.replyTo);

    if (!message?.trim()) {
      return res.status(400).json({ error: 'Mensaje vacío' });
    }

    const db = getDb();
    const doc = await db.collection('bot-entreno_conversations').doc(contactId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Conversación no encontrada' });

    const { channel, status } = doc.data();

    // Si la conversación estaba archivada/resuelta, un agente escribiéndole
    // directo la reabre — si no, queda invisible en Archivados mientras la
    // charla sigue (ver docs/superpowers/specs/2026-08-11-fix-reapertura-archivados-design.md)
    if (status === 'resolved' || status === 'bot_archived') {
      await dispatchConversation(contactId, { status: 'escalated', humanMode: true, assignedTo: req.agent.email });
    }

    // Generate a local message ID for tracking delivery status
    const msgId = crypto.randomUUID();

    // Save message immediately with 'sending' status
    await appendMessage(contactId, {
      role: 'admin', content: message.trim(), msgId, msgStatus: 'sending', sentBy: req.agent.email,
      ...(replyTo && { replyTo: { role: replyTo.role, preview: replyTo.preview } }),
    });

    let sendError = null;
    let waMsgId = null;
    let windowExpired = false;
    try {
      if (channel === 'whatsapp') {
        waMsgId = await sendWhatsAppMessage(contactId, message.trim(), replyTo?.waMsgId ?? null);
      } else if (channel === 'instagram') {
        await sendInstagramMessage(contactId, message.trim());
      }
    } catch (sendErr) {
      windowExpired = channel === 'whatsapp' && isWindowExpiredError(sendErr);
      const detail = sendErr.response?.data ?? sendErr.message;
      console.error('[reply] Error enviando por canal:', JSON.stringify(detail));
      sendError = typeof detail === 'object' ? JSON.stringify(detail) : detail;
    }

    // Update message delivery status
    await updateMessageStatus(contactId, msgId, sendError ? 'error' : 'sent', waMsgId).catch(() => {});

    if (sendError) {
      return res.status(502).json({
        error: windowExpired
          ? 'La ventana de WhatsApp de 24hs expiró. Necesitás enviar una plantilla aprobada para retomar la conversación.'
          : `Guardado en panel pero falló el envío: ${sendError}`,
        windowExpired,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send an approved template to an existing conversation (to reopen the 24h window)
router.post('/:contactId/send-template', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { templateName, language, params = [] } = req.body;

    if (!templateName?.trim()) {
      return res.status(400).json({ error: 'templateName requerido' });
    }

    const db = getDb();
    const doc = await db.collection('bot-entreno_conversations').doc(contactId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Conversación no encontrada' });

    const { channel } = doc.data();
    if (channel !== 'whatsapp') {
      return res.status(400).json({ error: 'Las plantillas de reactivación solo funcionan en WhatsApp' });
    }

    const msgId = crypto.randomUUID();
    const templateText = params.filter(Boolean).length > 0
      ? `[Plantilla: ${templateName}] ${params.join(' | ')}`
      : `[Plantilla: ${templateName}]`;

    await appendMessage(contactId, { role: 'admin', content: templateText, msgId, msgStatus: 'sending', sentBy: req.agent.email });

    let sendError = null;
    let waMsgId = null;
    try {
      waMsgId = await sendWhatsAppTemplate(contactId, templateName, language || 'es_AR', params);
    } catch (sendErr) {
      const detail = sendErr.response?.data ?? sendErr.message;
      console.error('[send-template] Error:', JSON.stringify(detail));
      sendError = typeof detail === 'object' ? JSON.stringify(detail) : detail;
    }

    await updateMessageStatus(contactId, msgId, sendError ? 'error' : 'sent', waMsgId).catch(() => {});

    if (sendError) {
      return res.status(502).json({ error: `No se pudo enviar la plantilla: ${sendError}` });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const MEDIA_LABELS = { audio: '[Audio enviado]', video: '[Video enviado]', image: '[Imagen enviada]' };

function mediaLabel(mediaType, fileName, caption) {
  const base = mediaType === 'document' ? `[Archivo: ${fileName}]` : (MEDIA_LABELS[mediaType] ?? '[Archivo enviado]');
  return caption ? `${base} ${caption}` : base;
}

function describeSendError(sendErr) {
  const detail = sendErr.response?.data ?? sendErr.message;
  return typeof detail === 'object' ? JSON.stringify(detail) : detail;
}

/**
 * Sube un archivo a Meta y lo manda a un contacto de WhatsApp. Devuelve los
 * campos de mensaje a guardar en el panel. Tira MediaRejectedError si el
 * archivo no se puede mandar (formato/tamaño) — en ese caso no se guarda nada.
 */
async function sendWhatsAppFile(contactId, { buffer, mimetype, originalname, isVoiceNote = false, caption = '', replyToWaMsgId = null }) {
  const prepared = await prepareWhatsAppMedia({ buffer, mimetype, originalname, isVoiceNote });
  const metaMediaId = await uploadMetaMedia(prepared.buffer, prepared.mimeType, prepared.fileName);
  const waMsgId = metaMediaId
    ? await sendWhatsAppMedia(contactId, metaMediaId, prepared.mimeType, prepared.fileName, replyToWaMsgId, { type: prepared.waType, caption })
    : null;
  return {
    // Una imagen pesada viaja como documento pero en el panel se sigue viendo como foto.
    mediaType: prepared.waType === 'document' && prepared.mimeType.startsWith('image/') ? 'image' : prepared.waType,
    mediaId: metaMediaId ?? null,
    fileName: prepared.fileName,
    mimeType: prepared.mimeType,
    fileSize: prepared.buffer.length,
    waMsgId,
  };
}

router.post('/:contactId/media', uploadSingle('file'), async (req, res) => {
  try {
    const { contactId } = req.params;
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    const db = getDb();
    const doc = await db.collection('bot-entreno_conversations').doc(contactId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Conversación no encontrada' });
    const { channel, status } = doc.data();

    // Antes un archivo a Instagram se guardaba como "enviado" sin mandarse
    // nunca — la API de IG sólo acepta adjuntos por URL pública.
    if (channel !== 'whatsapp') {
      return res.status(400).json({ error: 'Por ahora los archivos sólo se pueden mandar por WhatsApp. En Instagram mandá el texto o un link.' });
    }

    const originalname = decodeOriginalName(req.file.originalname);
    const caption = String(req.body.caption ?? '').trim().slice(0, 1000);
    const isVoiceNote = req.body.voiceNote === '1';
    let replyTo = null;
    try { replyTo = sanitizeReplyTo(JSON.parse(req.body.replyTo ?? 'null')); } catch { /* ignora JSON inválido */ }

    const msgId = crypto.randomUUID();
    let sendError = null;
    let windowExpired = false;
    let sent = null;
    try {
      sent = await sendWhatsAppFile(contactId, {
        buffer: req.file.buffer, mimetype: req.file.mimetype, originalname, isVoiceNote, caption,
        replyToWaMsgId: replyTo?.waMsgId ?? null,
      });
    } catch (sendErr) {
      if (sendErr instanceof MediaRejectedError) return res.status(400).json({ error: sendErr.message });
      windowExpired = isWindowExpiredError(sendErr);
      sendError = describeSendError(sendErr);
      console.error('[media] Error enviando media:', sendError);
    }

    // Mismo criterio que en /reply: mandar un archivo a una conversación
    // archivada la reabre, en vez de dejarla invisible en Archivados.
    if (status === 'resolved' || status === 'bot_archived') {
      await dispatchConversation(contactId, { status: 'escalated', humanMode: true, assignedTo: req.agent.email });
    }

    const fallbackType = req.file.mimetype.startsWith('audio/') ? 'audio'
      : req.file.mimetype.startsWith('video/') ? 'video'
      : req.file.mimetype.startsWith('image/') ? 'image'
      : 'document';
    const mediaType = sent?.mediaType ?? fallbackType;
    const fileName = sent?.fileName ?? originalname;

    await appendMessage(contactId, {
      role: 'admin',
      content: mediaLabel(mediaType, fileName, caption),
      mediaType,
      mediaId: sent?.mediaId ?? null,
      fileName,
      ...(sent?.mimeType && { mimeType: sent.mimeType }),
      ...(sent?.fileSize && { fileSize: sent.fileSize }),
      msgId,
      msgStatus: sendError ? 'error' : 'sent',
      sentBy: req.agent.email,
      ...(sent?.waMsgId && { waMsgId: sent.waMsgId }),
      ...(replyTo && { replyTo: { role: replyTo.role, preview: replyTo.preview } }),
    });

    if (sendError) {
      return res.status(502).json({
        error: windowExpired
          ? 'La ventana de WhatsApp de 24hs expiró. Necesitás enviar una plantilla aprobada para retomar la conversación.'
          : `Guardado en panel pero falló el envío: ${sendError}`,
        windowExpired,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Reenviar mensajes (como "Reenviar" de WhatsApp) ----
// body: { messages: [{ content, mediaType, mediaId, mediaUrl, fileName, mimeType }], targets: [contactId] }
// Se reenvía el contenido que manda el panel (el agente ya puede escribir
// cualquier texto con /reply, así que no hay nada que validar contra el
// origen). Los archivos se bajan de Meta y se vuelven a subir: los mediaId de
// mensajes ENTRANTES no se pueden reusar para enviar.
const FORWARD_MAX_MESSAGES = 30;
const FORWARD_MAX_TARGETS = 10;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const OUT_OF_WINDOW_MSG = 'Fuera de la ventana de 24 hs — hay que mandarle una plantilla primero';

// "[Imagen] hola" / "[Archivo: x.pdf] mirá esto" → "hola" / "mirá esto"
function captionFromContent(content) {
  const m = /^\[[^\]]*\]\s*([\s\S]*)$/.exec(content ?? '');
  return m ? m[1].trim() : (content ?? '').trim();
}

function tsMs(ts) {
  if (!ts) return 0;
  if (ts._seconds) return ts._seconds * 1000;
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  const d = new Date(ts);
  return isNaN(d) ? 0 : d.getTime();
}

router.post('/forward', async (req, res) => {
  try {
    const messages = Array.isArray(req.body.messages) ? req.body.messages.slice(0, FORWARD_MAX_MESSAGES) : [];
    const targets = [...new Set(Array.isArray(req.body.targets) ? req.body.targets.filter(t => typeof t === 'string') : [])]
      .slice(0, FORWARD_MAX_TARGETS);
    if (!messages.length || !targets.length) return res.status(400).json({ error: 'Elegí al menos un mensaje y un destinatario' });

    // Bajar cada archivo una sola vez aunque vaya a varios destinatarios.
    const fileCache = new Map();
    function getFile(m) {
      const key = m.mediaId ?? m.mediaUrl;
      if (!fileCache.has(key)) {
        fileCache.set(key, (async () => {
          const { buffer, mimeType } = m.mediaId ? await downloadMetaMedia(m.mediaId) : await downloadUrlMedia(m.mediaUrl);
          const mimetype = m.mimeType ?? mimeType;
          const ext = mimetype.split('/')[1]?.split(';')[0] ?? 'bin';
          return { buffer, mimetype, originalname: m.fileName ?? `${m.mediaType ?? 'archivo'}.${ext}` };
        })());
      }
      return fileCache.get(key);
    }

    const db = getDb();
    const results = [];
    for (const contactId of targets) {
      const doc = await db.collection('bot-entreno_conversations').doc(contactId).get();
      if (!doc.exists) { results.push({ contactId, ok: false, error: 'Conversación no encontrada' }); continue; }
      const { channel, status, lastClientMessageAt, contactName } = doc.data();
      const name = contactName || contactId;

      if (channel === 'whatsapp' && (!lastClientMessageAt || Date.now() - tsMs(lastClientMessageAt) > WINDOW_MS)) {
        results.push({ contactId, name, ok: false, error: OUT_OF_WINDOW_MSG });
        continue;
      }

      let sentCount = 0;
      let firstError = null;
      for (const m of messages) {
        const hasMedia = !!(m.mediaId || m.mediaUrl) && !!m.mediaType;
        const text = hasMedia ? captionFromContent(m.content) : String(m.content ?? '').trim();
        if (!hasMedia && !text) continue;
        const msgId = crypto.randomUUID();
        try {
          if (hasMedia) {
            if (channel !== 'whatsapp') throw new MediaRejectedError('Por este canal sólo se puede reenviar texto');
            const isAudio = m.mediaType === 'audio';
            const file = await getFile(m);
            const sent = await sendWhatsAppFile(contactId, { ...file, isVoiceNote: isAudio, caption: isAudio ? '' : text });
            await appendMessage(contactId, {
              role: 'admin', content: mediaLabel(sent.mediaType, sent.fileName, isAudio ? '' : text),
              mediaType: sent.mediaType, mediaId: sent.mediaId, fileName: sent.fileName, mimeType: sent.mimeType, fileSize: sent.fileSize,
              msgId, msgStatus: 'sent', sentBy: req.agent.email, forwarded: true,
              ...(sent.waMsgId && { waMsgId: sent.waMsgId }),
            });
          } else {
            const waMsgId = channel === 'whatsapp'
              ? await sendWhatsAppMessage(contactId, text)
              : channel === 'instagram'
                ? await sendInstagramMessage(contactId, text)
                : null; // otros canales (ej. chat web): el mensaje queda en el historial
            await appendMessage(contactId, {
              role: 'admin', content: text, msgId, msgStatus: 'sent', sentBy: req.agent.email, forwarded: true,
              ...(channel === 'whatsapp' && waMsgId && { waMsgId }),
            });
          }
          sentCount++;
        } catch (err) {
          const msg = err instanceof MediaRejectedError
            ? err.message
            : (channel === 'whatsapp' && isWindowExpiredError(err))
              ? OUT_OF_WINDOW_MSG
              : describeSendError(err);
          console.error(`[forward] Error reenviando a ${contactId}:`, msg);
          firstError ??= msg;
        }
      }

      if (sentCount > 0 && (status === 'resolved' || status === 'bot_archived')) {
        await dispatchConversation(contactId, { status: 'escalated', humanMode: true, assignedTo: req.agent.email });
      }
      results.push({ contactId, name, ok: !firstError, sent: sentCount, ...(firstError && { error: firstError }) });
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:contactId/media/:mediaId/transcribe', async (req, res) => {
  try {
    const { contactId, mediaId } = req.params;
    const { buffer, mimeType } = await downloadMetaMedia(mediaId);
    const transcript = await transcribeAudio(buffer, mimeType);
    await setMessageTranscript(contactId, mediaId, transcript);
    res.json({ transcript });
  } catch (err) {
    const detail = err.response?.data ?? err.message;
    console.error('[transcribe] Error:', JSON.stringify(detail));
    res.status(502).json({ error: typeof detail === 'object' ? JSON.stringify(detail) : detail });
  }
});

router.get('/:contactId/summary', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('bot-entreno_conversations').doc(req.params.contactId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json({ summary: doc.data().aiSummary ?? null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:contactId/summary', async (req, res) => {
  try {
    const { contactId } = req.params;
    const db = getDb();
    const [doc, messages] = await Promise.all([
      db.collection('bot-entreno_conversations').doc(contactId).get(),
      getConversationHistory(contactId),
    ]);
    if (!doc.exists) return res.status(404).json({ error: 'Conversación no encontrada' });
    const convData = doc.data();
    const metrics = calcConvMetrics(messages, convData);
    const text = await generateConversationSummary(messages);
    const summary = { text, generatedAt: new Date(), metrics };
    await db.collection('bot-entreno_conversations').doc(contactId).update({ aiSummary: summary });
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function calcConvMetrics(messages, convData) {
  const responseTimes = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== 'user') continue;
    const userTs = tsToMs(messages[i].timestamp);
    if (!userTs) continue;
    for (let j = i + 1; j < messages.length; j++) {
      if (messages[j].role === 'user') break;
      const replyTs = tsToMs(messages[j].timestamp);
      if (replyTs && replyTs > userTs) { responseTimes.push(replyTs - userTs); break; }
    }
  }
  const avgMs = responseTimes.length
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : null;
  return {
    totalMessages: messages.length,
    userMessages: messages.filter(m => m.role === 'user').length,
    botMessages: messages.filter(m => m.role === 'assistant').length,
    agentMessages: messages.filter(m => m.role === 'admin').length,
    assignedTo: convData.assignedTo ?? null,
    escalated: !!(convData.humanMode || convData.status === 'escalated'),
    avgResponseTimeSec: avgMs ? Math.round(avgMs / 1000) : null,
  };
}

function tsToMs(ts) {
  if (!ts) return null;
  if (ts._seconds) return ts._seconds * 1000;
  const d = new Date(ts);
  return isNaN(d) ? null : d.getTime();
}

export default router;
