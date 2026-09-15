import crypto from 'crypto';
import admin from 'firebase-admin';
import { getDb } from './firebase.service.js';
import { listCustomers } from './customer.service.js';
import { getOrCreateConversation, appendMessage, updateMessageStatus } from './conversation.service.js';
import { sendWhatsAppTemplate } from './meta.service.js';
import { toWaContactId } from './phone.js';

const CAMPAIGNS = 'bot-entreno_campaigns';
const SENDS = 'bot-entreno_campaign_sends';
const LINKS = 'bot-entreno_short_links';

const SEND_THROTTLE_MS = 250; // ritmo prudente por defecto para no pegarle al rate-limit de Meta

function inc(n) { return admin.firestore.FieldValue.increment(n); }

// ─────────────────────────── Links cortos (clicks) ─────────────────────────

function makeShortCode() {
  return crypto.randomBytes(4).toString('hex'); // 8 chars, suficiente para el volumen de una difusión
}

async function createShortLink({ targetUrl, campaignId, contactId }) {
  const db = getDb();
  const code = makeShortCode();
  await db.collection(LINKS).doc(code).set({
    code, targetUrl, campaignId, contactId, createdAt: new Date(), clickCount: 0, firstClickedAt: null,
  });
  return code;
}

export async function resolveShortLink(code) {
  const db = getDb();
  const doc = await db.collection(LINKS).doc(code).get();
  return doc.exists ? doc.data() : null;
}

export async function registerClick(code) {
  const db = getDb();
  const linkRef = db.collection(LINKS).doc(code);
  const link = await linkRef.get();
  if (!link.exists) return null;
  const data = link.data();
  const isFirst = !data.firstClickedAt;
  await linkRef.update({
    clickCount: (data.clickCount ?? 0) + 1,
    ...(isFirst && { firstClickedAt: new Date() }),
  });
  // Sólo el primer click de cada destinatario cuenta para la estadística de
  // la campaña (evita que alguien reabriendo el link infle "clickeados").
  if (isFirst && data.campaignId && data.contactId) {
    await markSendClicked(data.campaignId, data.contactId);
  }
  return data;
}

// ─────────────────────────── Envíos (una fila por destinatario) ───────────

function sendDocId(campaignId, contactId) {
  return `${campaignId}__${contactId}`;
}

async function markSendClicked(campaignId, contactId) {
  const db = getDb();
  const ref = db.collection(SENDS).doc(sendDocId(campaignId, contactId));
  const doc = await ref.get();
  if (!doc.exists || doc.data().clickedAt) return;
  await ref.update({ clickedAt: new Date() });
  await db.collection(CAMPAIGNS).doc(campaignId).update({ 'stats.clicked': inc(1) });
}

/** Llamado desde el webhook de status de Meta (delivered/read/error), además
    de la actualización normal de la conversación — un waMsgId de campaña no
    está en ninguna conversación en particular indexable por contactId como
    las respuestas 1 a 1, así que acá sí hace falta una query por campo. */
export async function updateCampaignSendStatusByWaMsgId(waMsgId, status) {
  const db = getDb();
  const snap = await db.collection(SENDS).where('waMsgId', '==', waMsgId).limit(1).get();
  if (snap.empty) return;
  const ref = snap.docs[0].ref;
  const current = snap.docs[0].data();
  const RANK = { sent: 1, delivered: 2, read: 3 };
  if (status !== 'error' && (RANK[status] ?? 0) < (RANK[current.status] ?? 0)) return;
  const update = { status };
  if (status === 'delivered' && !current.deliveredAt) update.deliveredAt = new Date();
  if (status === 'read' && !current.readAt) update.readAt = new Date();
  await ref.update(update);
  if (['delivered', 'read', 'error'].includes(status) && current.status !== status) {
    const statKey = status === 'error' ? 'failed' : status;
    await db.collection(CAMPAIGNS).doc(current.campaignId).update({ [`stats.${statKey}`]: inc(1) });
  }
}

// ─────────────────────────── Campañas ──────────────────────────────────────

function mapCampaignDoc(doc) {
  return { id: doc.id, ...doc.data() };
}

export async function listCampaigns() {
  const db = getDb();
  const snap = await db.collection(CAMPAIGNS).orderBy('createdAt', 'desc').limit(100).get();
  return snap.docs.map(mapCampaignDoc);
}

export async function getCampaign(id) {
  const db = getDb();
  const doc = await db.collection(CAMPAIGNS).doc(id).get();
  return doc.exists ? mapCampaignDoc(doc) : null;
}

export async function getCampaignSends(campaignId) {
  const db = getDb();
  const snap = await db.collection(SENDS).where('campaignId', '==', campaignId).get();
  return snap.docs.map(d => d.data());
}

/** Resuelve cuántos/quiénes matchean un segmento — usado tanto para la
    previsualización como para el envío real, así el conteo que ve el agente
    antes de mandar es exactamente la lista que va a recibir el mensaje. */
export async function resolveSegment(segment = {}) {
  return listCustomers({ q: segment.q, channel: segment.channel, tags: segment.tags });
}

export async function createCampaign({ name, templateName, language, category, paramsTemplate, targetUrl, segment, createdBy }) {
  if (!name?.trim() || !templateName?.trim()) {
    const e = new Error('name y templateName son requeridos');
    e.status = 400;
    throw e;
  }
  const db = getDb();
  const doc = {
    name: name.trim(),
    templateName: templateName.trim(),
    language: language || 'es_AR',
    category: category ?? null,
    paramsTemplate: Array.isArray(paramsTemplate) ? paramsTemplate : [],
    targetUrl: targetUrl?.trim() || null,
    segment: { q: segment?.q ?? null, channel: segment?.channel ?? null, tags: segment?.tags ?? [] },
    status: 'draft',
    createdBy: createdBy ?? null,
    createdAt: new Date(),
    sentAt: null,
    stats: { total: 0, sent: 0, failed: 0, delivered: 0, read: 0, clicked: 0 },
  };
  const ref = await db.collection(CAMPAIGNS).add(doc);
  return { id: ref.id, ...doc };
}

export async function deleteCampaign(id) {
  const db = getDb();
  await db.collection(CAMPAIGNS).doc(id).delete();
  const snap = await db.collection(SENDS).where('campaignId', '==', id).get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  if (!snap.empty) await batch.commit();
}

function interpolate(template, contact, link) {
  return (template ?? '')
    .replace(/\{\{\s*nombre\s*\}\}/gi, contact.contactName || 'Cliente')
    .replace(/\{\{\s*link\s*\}\}/gi, link ?? '');
}

/**
 * Dispara el envío real — recorre el segmento, uno por uno, con el mismo
 * criterio que `sendBulkOrders()` en BOT-ALTORANCHO (la única difusión que
 * ya existía en el código): registra el mensaje en la conversación del
 * cliente (para que quede visible en el panel normal, con sus tildes), lo
 * manda por WhatsApp, y guarda un resultado por destinatario en `SENDS`.
 * No usa `await Promise.all` a propósito — un throttle secuencial es más
 * lento pero mucho más difícil que dispare el rate-limit de Meta que un
 * fan-out de cientos de requests en paralelo.
 */
export async function sendCampaign(campaignId, publicBaseUrl) {
  const db = getDb();
  const campaign = await getCampaign(campaignId);
  if (!campaign) { const e = new Error('Campaña no encontrada'); e.status = 404; throw e; }
  if (campaign.status !== 'draft') { const e = new Error('Esta campaña ya se envió'); e.status = 409; throw e; }

  const recipients = (await resolveSegment(campaign.segment)).filter(c => c.channel === 'whatsapp');

  await db.collection(CAMPAIGNS).doc(campaignId).update({
    status: 'sending',
    sentAt: new Date(),
    'stats.total': recipients.length,
  });

  // Se dispara en segundo plano — el request HTTP que crea/manda la campaña
  // no espera a que termine de mandarle a todos (puede ser una lista larga).
  (async () => {
    for (const contact of recipients) {
      // El id del cliente ya debería estar canónico, pero lo forzamos igual:
      // si la difusión crea la conversación con un formato distinto al que
      // usa el webhook entrante, la respuesta del cliente cae en otro chat.
      contact.contactId = toWaContactId(contact.contactId) ?? contact.contactId;
      const sendId = sendDocId(campaignId, contact.contactId);
      try {
        let shortCode = null;
        let link = campaign.targetUrl;
        if (campaign.targetUrl && publicBaseUrl) {
          shortCode = await createShortLink({ targetUrl: campaign.targetUrl, campaignId, contactId: contact.contactId });
          link = `${publicBaseUrl}/r/${shortCode}`;
        }
        const params = campaign.paramsTemplate.map(tpl => interpolate(tpl, contact, link));

        await getOrCreateConversation(contact.contactId, 'whatsapp', contact.contactName);
        const msgId = crypto.randomUUID();
        const templateText = params.filter(Boolean).length > 0
          ? `[Difusión: ${campaign.templateName}] ${params.join(' | ')}`
          : `[Difusión: ${campaign.templateName}]`;
        await appendMessage(contact.contactId, { role: 'admin', content: templateText, msgId, msgStatus: 'sending', sentBy: campaign.createdBy });

        let sendError = null;
        let waMsgId = null;
        try {
          waMsgId = await sendWhatsAppTemplate(contact.contactId, campaign.templateName, campaign.language, params);
        } catch (err) {
          sendError = err.response?.data?.error?.message ?? err.message;
        }
        await updateMessageStatus(contact.contactId, msgId, sendError ? 'error' : 'sent', waMsgId).catch(() => {});

        await db.collection(SENDS).doc(sendId).set({
          campaignId, contactId: contact.contactId, contactName: contact.contactName ?? null,
          waMsgId: waMsgId ?? null, shortCode,
          status: sendError ? 'error' : 'sent',
          error: sendError ?? null,
          sentAt: new Date(), deliveredAt: null, readAt: null, clickedAt: null,
        });
        await db.collection(CAMPAIGNS).doc(campaignId).update({
          [sendError ? 'stats.failed' : 'stats.sent']: inc(1),
        });
      } catch (err) {
        console.error(`[campaign] Error mandándole a ${contact.contactId}:`, err.message);
        await db.collection(SENDS).doc(sendId).set({
          campaignId, contactId: contact.contactId, contactName: contact.contactName ?? null,
          waMsgId: null, shortCode: null, status: 'error', error: err.message,
          sentAt: new Date(), deliveredAt: null, readAt: null, clickedAt: null,
        }, { merge: true });
        await db.collection(CAMPAIGNS).doc(campaignId).update({ 'stats.failed': inc(1) });
      }
      await new Promise(r => setTimeout(r, SEND_THROTTLE_MS));
    }
    await db.collection(CAMPAIGNS).doc(campaignId).update({ status: 'sent' });
  })().catch(err => console.error('[campaign] Error en el envío en background:', err));

  return { ok: true, total: recipients.length };
}
