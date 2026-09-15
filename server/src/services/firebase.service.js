import admin from 'firebase-admin';

let db = null;

export function initFirebase() {
  if (admin.apps.length) return;

  const { FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL } = process.env;

  if (!FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
    console.warn('[firebase] Sin credenciales de service account — Firestore no disponible');
    return;
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      clientEmail: FIREBASE_CLIENT_EMAIL,
    }),
  });

  db = admin.firestore();
  console.log('[firebase] Firestore conectado');
}

export function getDb() {
  if (!db) throw new Error('Firestore no disponible — completá FIREBASE_PRIVATE_KEY y FIREBASE_CLIENT_EMAIL en .env');
  return db;
}
