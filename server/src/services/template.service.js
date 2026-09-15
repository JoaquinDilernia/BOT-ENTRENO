import { getDb } from './firebase.service.js';
import { fetchMetaTemplateStatuses, createMetaTemplate } from './meta.service.js';

const COLLECTION = 'bot-entreno_whatsapp_templates';

export async function getAllTemplates() {
  const db = getDb();
  const snap = await db.collection(COLLECTION).orderBy('displayName').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createTemplate({ name, displayName, bodyText, language, category, params }) {
  const cleanName = name.trim();
  const cleanLanguage = language?.trim() || 'es_AR';
  const cleanParams = Array.isArray(params) ? params : [];

  // Submit to Meta for approval — errors are surfaced so the caller can inform the user
  let metaStatus = 'PENDING';
  let metaSubmitError = null;
  try {
    const result = await createMetaTemplate({
      name: cleanName,
      language: cleanLanguage,
      category: category || 'UTILITY',
      bodyText: bodyText.trim(),
      params: cleanParams,
    });
    metaStatus = result.status ?? 'PENDING';
  } catch (err) {
    const detail = err.response?.data?.error?.message ?? err.message;
    console.error('[template] Error submitting to Meta:', detail);
    metaSubmitError = detail;
    // Don't throw — still save locally so agent knows the template exists
  }

  const db = getDb();
  const doc = await db.collection(COLLECTION).add({
    name: cleanName,
    displayName: displayName.trim(),
    bodyText: bodyText.trim(),
    language: cleanLanguage,
    category: category || 'UTILITY',
    params: cleanParams,
    metaStatus,
    metaSubmitError: metaSubmitError ?? null,
    createdAt: new Date(),
  });
  const snap = await doc.get();
  return { id: snap.id, ...snap.data() };
}

export async function syncTemplateStatuses() {
  const metaTemplates = await fetchMetaTemplateStatuses();
  if (metaTemplates.length === 0) return;
  const db = getDb();
  const snap = await db.collection(COLLECTION).get();
  if (snap.empty) return;
  const batch = db.batch();
  for (const doc of snap.docs) {
    const { name, language } = doc.data();
    const metaMatch =
      metaTemplates.find(t => t.name === name && t.language === language) ??
      metaTemplates.find(t => t.name === name);
    if (metaMatch) {
      batch.update(doc.ref, { metaStatus: metaMatch.status });
    }
  }
  await batch.commit();
}

export async function deleteTemplate(id) {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).delete();
}
