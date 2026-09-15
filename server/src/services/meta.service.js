import axios from 'axios';
import crypto from 'crypto';

const META_API_URL = 'https://graph.facebook.com/v20.0';

const SEND_MAX_RETRIES = 3;
// Solo reintentamos casos donde es seguro asumir que el mensaje NUNCA llegó
// a Meta: la conexión ni se estableció (DNS/conexión rechazada), o Meta
// respondió con un error propio (5xx) o rate-limit (429) — nunca en un
// timeout ambiguo, para evitar mandar el mismo mensaje dos veces.
const SAFE_RETRY_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);
const SAFE_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

async function postWithSafeRetry(url, data, config) {
  let lastErr;
  for (let attempt = 1; attempt <= SEND_MAX_RETRIES; attempt++) {
    try {
      return await axios.post(url, data, config);
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const retryable = SAFE_RETRY_STATUSES.has(status) || (!err.response && SAFE_RETRY_CODES.has(err.code));
      if (!retryable || attempt === SEND_MAX_RETRIES) throw err;
      const waitMs = Math.min(1000 * attempt, 4000);
      console.warn(`[meta] Envío a ${url} intento ${attempt}/${SEND_MAX_RETRIES} falló (${status ?? err.code}) — reintentando en ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

export function verifyWebhookSignature(rawBody, signature) {
  if (!signature || !process.env.META_APP_SECRET) return false;

  const expected = `sha256=${crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(rawBody)
    .digest('hex')}`;

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Returns WA message ID on success, null if tokens not configured.
// `replyToWaMsgId`: si se pasa, el mensaje aparece como respuesta citada
// (context.message_id) en WhatsApp — misma función nativa de "responder" que
// ya se lee de los mensajes entrantes, ahora también disponible al enviar.
export async function sendWhatsAppMessage(to, text, replyToWaMsgId = null) {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_PHONE_NUMBER_ID) {
    console.log('[meta] sendWhatsAppMessage skipped — tokens not configured');
    return null;
  }
  const { data } = await postWithSafeRetry(
    `${META_API_URL}/${process.env.META_PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
      ...(replyToWaMsgId && { context: { message_id: replyToWaMsgId } }),
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return data.messages?.[0]?.id ?? null;
}

export async function sendInstagramMessage(recipientId, text) {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_IG_PAGE_ID) {
    console.log('[meta] sendInstagramMessage skipped — tokens not configured');
    return null;
  }
  const { data } = await postWithSafeRetry(
    `${META_API_URL}/${process.env.META_IG_PAGE_ID}/messages`,
    {
      recipient: { id: recipientId },
      message: { text },
      messaging_type: 'RESPONSE',
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return data.message_id ?? null;
}

export async function downloadMediaAsBase64(mediaId) {
  if (!process.env.META_ACCESS_TOKEN) return null;
  try {
    const { data: info } = await axios.get(`${META_API_URL}/${mediaId}`, {
      headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
    });
    const { data: buffer } = await axios.get(info.url, {
      headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
      responseType: 'arraybuffer',
    });
    return {
      base64: Buffer.from(buffer).toString('base64'),
      mimeType: info.mime_type ?? 'image/jpeg',
    };
  } catch (err) {
    console.error('[meta] Error descargando media:', err.message);
    return null;
  }
}

export async function sendWhatsAppTemplate(to, templateName, language = 'es_AR', params = []) {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_PHONE_NUMBER_ID) {
    console.log('[meta] sendWhatsAppTemplate skipped — tokens not configured');
    return null;
  }
  const template = {
    name: templateName,
    language: { code: language },
  };
  if (params.length > 0) {
    template.components = [
      {
        type: 'body',
        parameters: params.map(p => ({ type: 'text', text: p })),
      },
    ];
  }
  const { data } = await axios.post(
    `${META_API_URL}/${process.env.META_PHONE_NUMBER_ID}/messages`,
    { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template', template },
    { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
  );
  return data.messages?.[0]?.id ?? null;
}

export async function uploadMetaMedia(buffer, mimeType) {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_PHONE_NUMBER_ID) return null;
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([buffer], { type: mimeType }), 'upload');
  const { data } = await axios.post(
    `${META_API_URL}/${process.env.META_PHONE_NUMBER_ID}/media`,
    form,
    { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` } }
  );
  return data.id;
}

// Mapea un MIME type al tipo de mensaje que espera la API de WhatsApp.
// Cualquier archivo que no sea audio/video/imagen (PDFs, Word, etc.) es 'document' —
// enviarlo como 'image' hace que Meta acepte el request pero el cliente nunca reciba el archivo.
export function resolveMetaMediaType(mimeType) {
  if (mimeType?.startsWith('audio/')) return 'audio';
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType?.startsWith('image/')) return 'image';
  return 'document';
}

// Returns WA message ID on success, null if tokens not configured (mismo
// contrato que sendWhatsAppMessage — antes no devolvía nada, así que un
// archivo/audio enviado nunca podía recibir tildes de entregado/leído ni
// ser citado más adelante).
export async function sendWhatsAppMedia(to, mediaId, mimeType, fileName = null, replyToWaMsgId = null) {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_PHONE_NUMBER_ID) return null;
  const type = resolveMetaMediaType(mimeType);
  const mediaObject = type === 'document' && fileName ? { id: mediaId, filename: fileName } : { id: mediaId };
  const { data } = await axios.post(
    `${META_API_URL}/${process.env.META_PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type,
      [type]: mediaObject,
      ...(replyToWaMsgId && { context: { message_id: replyToWaMsgId } }),
    },
    { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
  );
  return data.messages?.[0]?.id ?? null;
}

async function fetchMetaMediaInfo(mediaId) {
  const { data: info } = await axios.get(`${META_API_URL}/${mediaId}`, {
    headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
  });
  return info; // { url, mime_type, ... }
}

export async function getMetaMediaStream(mediaId, res) {
  if (!process.env.META_ACCESS_TOKEN) throw new Error('No META_ACCESS_TOKEN');
  const info = await fetchMetaMediaInfo(mediaId);
  const response = await axios.get(info.url, {
    headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
    responseType: 'stream',
  });
  res.setHeader('Content-Type', info.mime_type || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  response.data.pipe(res);
}

export async function downloadMetaMedia(mediaId) {
  if (!process.env.META_ACCESS_TOKEN) throw new Error('No META_ACCESS_TOKEN');
  const info = await fetchMetaMediaInfo(mediaId);
  const response = await axios.get(info.url, {
    headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
    responseType: 'arraybuffer',
  });
  return { buffer: Buffer.from(response.data), mimeType: info.mime_type || 'application/octet-stream' };
}

export async function createMetaTemplate({ name, language, category, bodyText, params = [] }) {
  const wabaId = process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID;
  const token  = process.env.META_ACCESS_TOKEN;
  if (!wabaId || !token) {
    throw new Error('META_WHATSAPP_BUSINESS_ACCOUNT_ID o META_ACCESS_TOKEN no configurados');
  }
  const bodyComponent = { type: 'BODY', text: bodyText };
  if (params.length > 0) {
    // Meta requires example values for every variable in the template
    bodyComponent.example = { body_text: [params.map((_, i) => `ejemplo${i + 1}`)] };
  }
  const { data } = await axios.post(
    `${META_API_URL}/${wabaId}/message_templates`,
    { name, language, category, components: [bodyComponent] },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return data; // { id, status, ... }
}

export async function fetchMetaTemplateStatuses() {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID) return [];
  try {
    const { data } = await axios.get(
      `${META_API_URL}/${process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`,
      {
        headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
        params: { fields: 'name,status,language', limit: 100 },
      }
    );
    return data.data ?? [];
  } catch (err) {
    console.error('[meta] fetchMetaTemplateStatuses error:', err.response?.data ?? err.message);
    return [];
  }
}

export function parseWhatsAppMessage(webhookBody) {
  try {
    const entry = webhookBody.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value?.messages?.[0]) return null;

    const msg = value.messages[0];
    const contactName = value.contacts?.[0]?.profile?.name ?? 'Cliente';
    const replyToWaMsgId = msg.context?.id ?? null;

    if (msg.type === 'interactive') {
      const reply = msg.interactive?.list_reply ?? msg.interactive?.button_reply;
      return {
        channel: 'whatsapp',
        from: msg.from,
        messageId: msg.id,
        text: reply?.title ?? '',
        type: 'interactive',
        interactiveId: reply?.id ?? null,
        mediaId: null,
        timestamp: msg.timestamp,
        contactName,
        replyToWaMsgId,
      };
    }

    const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker'];
    const mediaId = MEDIA_TYPES.includes(msg.type) ? msg[msg.type]?.id : null;
    const caption = MEDIA_TYPES.includes(msg.type) ? (msg[msg.type]?.caption ?? '') : '';

    return {
      channel: 'whatsapp',
      from: msg.from,
      messageId: msg.id,
      text: msg.text?.body ?? caption,
      type: msg.type,
      mediaId,
      timestamp: msg.timestamp,
      contactName,
      replyToWaMsgId,
    };
  } catch {
    return null;
  }
}

// Parses WA delivery status updates from webhook
export function parseWhatsAppStatusUpdate(webhookBody) {
  try {
    const entry = webhookBody.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    if (!value?.statuses?.[0]) return null;
    const s = value.statuses[0];
    return {
      waMsgId: s.id,
      status: s.status, // 'sent', 'delivered', 'read', 'failed'
      recipientId: s.recipient_id,
      timestamp: s.timestamp,
      errors: s.errors ?? [],
    };
  } catch {
    return null;
  }
}

export function parseInstagramMessage(webhookBody) {
  try {
    const entry = webhookBody.entry?.[0];
    const messaging = entry?.messaging?.[0];

    if (!messaging?.message) return null;

    const attachments = messaging.message.attachments ?? [];
    const imageAttachment = attachments.find(a => a.type === 'image');

    return {
      channel: 'instagram',
      from: messaging.sender.id,
      messageId: messaging.message.mid,
      text: messaging.message.text ?? '',
      type: imageAttachment ? 'image' : (attachments.length ? attachments[0].type : 'text'),
      mediaUrl: imageAttachment?.payload?.url ?? null,
      timestamp: messaging.timestamp,
      contactName: 'Cliente',
    };
  } catch {
    return null;
  }
}
