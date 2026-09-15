// Fusiona las conversaciones (y clientes) que quedaron partidas en dos
// documentos por el mismo teléfono escrito distinto — ej. `549114979026`
// (creado al mandar una plantilla) y `54114979026` (creado cuando el cliente
// respondió). Agrupa por el teléfono canónico (phone.js) y mergea cada grupo
// en un único documento.
//
// Uso:
//   node scripts/merge-split-chats.mjs            # dry-run: solo muestra qué haría
//   node scripts/merge-split-chats.mjs --apply    # aplica los cambios
//
// El dry-run NO escribe nada. Con --apply: mergea los mensajes (ordenados por
// fecha, sin duplicados), combina los metadatos de forma conservadora y borra
// los documentos sobrantes.

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import { toWaContactId } from '../src/services/phone.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');
const CONV_COLLECTION = 'bot-entreno_conversations';
const CUST_COLLECTION = 'bot-entreno_customers';

const { FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL } = process.env;
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: FIREBASE_CLIENT_EMAIL,
  }),
});
const db = admin.firestore();

function tsMs(ts) {
  if (!ts) return 0;
  if (typeof ts._seconds === 'number') return ts._seconds * 1000;
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  const d = new Date(ts);
  return isNaN(d) ? 0 : d.getTime();
}

// Clave de deduplicación de un mensaje: el id de WhatsApp si lo tiene, si no
// el msgId local, y como último recurso (mensajes viejos sin ningún id)
// rol+contenido+segundo — con segundo en vez de minuto para no colapsar por
// error dos mensajes distintos con el mismo texto escritos con poca diferencia.
function msgKey(m) {
  if (m.waMsgId) return `wa:${m.waMsgId}`;
  if (m.msgId) return `id:${m.msgId}`;
  return `x:${m.role}:${m.content ?? ''}:${Math.round(tsMs(m.timestamp) / 1000)}`;
}

function mergeMessages(docs) {
  const seen = new Map();
  for (const d of docs) {
    for (const m of d.data.messages ?? []) {
      const k = msgKey(m);
      if (!seen.has(k)) seen.set(k, m);
    }
  }
  return [...seen.values()].sort((a, b) => tsMs(a.timestamp) - tsMs(b.timestamp)).slice(-200);
}

const STATUS_PRIORITY = { escalated: 4, bot: 3, resolved: 2, bot_archived: 1 };
function pickStatus(vals) {
  return vals
    .filter(Boolean)
    .sort((a, b) => (STATUS_PRIORITY[b] ?? 0) - (STATUS_PRIORITY[a] ?? 0))[0] ?? 'bot';
}

function mergeConversation(canonicalId, docs) {
  // Documento "base": el que ya tiene el id canónico, o el de más mensajes.
  const base =
    docs.find(d => d.id === canonicalId) ??
    [...docs].sort((a, b) => (b.data.messages?.length ?? 0) - (a.data.messages?.length ?? 0))[0];

  const all = docs.map(d => d.data);
  const merged = {
    ...base.data,
    contactId: canonicalId,
    messages: mergeMessages(docs),
    contactName: all.map(d => d.contactName).find(Boolean) ?? null,
    channel: all.map(d => d.channel).find(Boolean) ?? 'whatsapp',
    status: pickStatus(all.map(d => d.status)),
    humanMode: all.some(d => d.humanMode === true),
    urgent: all.some(d => d.urgent === true),
    critical: all.some(d => d.critical === true),
    assignedTo: all.map(d => d.assignedTo).find(Boolean) ?? null,
    unread: all.reduce((s, d) => s + (d.unread ?? 0), 0),
    labels: [...new Set(all.flatMap(d => d.labels ?? []))],
    consecutiveClientMessages: Math.max(...all.map(d => d.consecutiveClientMessages ?? 0)),
    createdAt: all.map(d => d.createdAt).filter(Boolean).sort((a, b) => tsMs(a) - tsMs(b))[0] ?? new Date(),
    updatedAt: all.map(d => d.updatedAt).filter(Boolean).sort((a, b) => tsMs(b) - tsMs(a))[0] ?? new Date(),
  };
  return { base, merged };
}

function customerRichness(d) {
  // Cuánta info "cara de recuperar" tiene el doc: pedidos de TN, notas del
  // equipo, vínculo con el cliente de TN, historial de compras.
  return (d.tnCustomerId ? 100 : 0)
    + (d.agentNotes ? 50 : 0)
    + (Array.isArray(d.tnOrders) ? d.tnOrders.length : 0)
    + (d.email ? 5 : 0);
}

function mergeCustomer(canonicalId, docs) {
  const all = docs.map(d => d.data);
  // Base = el doc con más info (pedidos TN / notas), no el primero que
  // devolvió Firestore — así no se pierde el historial de compras ni las
  // notas si el fragmento vino primero.
  const base = [...all].sort((a, b) => customerRichness(b) - customerRichness(a))[0];
  return {
    ...base,
    contactId: canonicalId,
    contactName: all.map(d => d.contactName).find(Boolean) ?? null,
    email: all.map(d => d.email).find(Boolean) ?? null,
    tags: [...new Set(all.flatMap(d => d.tags ?? []))],
    agentNotes: all.map(d => d.agentNotes).find(Boolean) ?? '',
    createdAt: all.map(d => d.createdAt).filter(Boolean).sort((a, b) => tsMs(a) - tsMs(b))[0] ?? new Date(),
    updatedAt: new Date(),
  };
}

async function loadGroups(collection) {
  const snap = await db.collection(collection).get();
  const groups = new Map(); // canonicalId -> [{ id, data }]
  snap.forEach(doc => {
    const data = doc.data();
    // Solo agrupamos WhatsApp; Instagram usa otro tipo de id.
    const isWa = (data.channel ?? 'whatsapp') === 'whatsapp' && /^\d+$/.test(doc.id);
    const canonical = isWa ? (toWaContactId(doc.id) ?? doc.id) : doc.id;
    if (!groups.has(canonical)) groups.set(canonical, []);
    groups.get(canonical).push({ id: doc.id, data });
  });
  return [...groups.entries()].filter(([, docs]) => docs.length > 1);
}

async function run() {
  console.log(`\n=== merge-split-chats — ${APPLY ? 'APPLY (escribe)' : 'DRY-RUN (no escribe nada)'} ===\n`);

  const convGroups = await loadGroups(CONV_COLLECTION);
  console.log(`Conversaciones partidas: ${convGroups.length} grupo(s)\n`);

  for (const [canonicalId, docs] of convGroups) {
    const { base, merged } = mergeConversation(canonicalId, docs);
    const losers = docs.filter(d => d.id !== canonicalId);
    console.log(`• ${canonicalId}`);
    for (const d of docs) {
      const tag = d.id === base.id ? ' (base)' : '';
      console.log(`    ${d.id}${tag} — ${d.data.messages?.length ?? 0} msgs, status=${d.data.status}, assignedTo=${d.data.assignedTo ?? '-'}`);
    }
    console.log(`    => ${merged.messages.length} msgs, status=${merged.status}, humanMode=${merged.humanMode}, assignedTo=${merged.assignedTo ?? '-'}`);

    if (APPLY) {
      // Primero borramos los sobrantes (cualquier id != canónico), después
      // escribimos el documento canónico ya mergeado.
      for (const l of losers) await db.collection(CONV_COLLECTION).doc(l.id).delete();
      await db.collection(CONV_COLLECTION).doc(canonicalId).set(merged);
      console.log('    ✔ aplicado');
    }
    console.log('');
  }

  const custGroups = await loadGroups(CUST_COLLECTION);
  console.log(`\nClientes partidos: ${custGroups.length} grupo(s)\n`);
  for (const [canonicalId, docs] of custGroups) {
    const merged = mergeCustomer(canonicalId, docs);
    const losers = docs.filter(d => d.id !== canonicalId);
    const detail = docs.map(d => `${d.id}[${customerRichness(d.data)}r${Array.isArray(d.data.tnOrders) ? '/' + d.data.tnOrders.length + 'ped' : ''}]`).join(' + ');
    console.log(`• ${canonicalId}  <=  ${detail}  => ${customerRichness(merged)}r`);
    if (APPLY) {
      await db.collection(CUST_COLLECTION).doc(canonicalId).set(merged);
      for (const l of losers) await db.collection(CUST_COLLECTION).doc(l.id).delete();
      console.log('    ✔ aplicado');
    }
  }

  console.log(`\n${APPLY ? 'Listo.' : 'Dry-run terminado. Volvé a correr con --apply para aplicar.'}\n`);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
