import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL } = process.env;

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: FIREBASE_CLIENT_EMAIL,
  }),
});

const db = admin.firestore();

const config = {
  businessName: 'Entreno',
  botName: 'Entreno',
  botPersonality: `Sos el asistente virtual de Entreno (entreno.com.ar), tienda online de suplementos deportivos, nutrición y indumentaria fitness con más de 40 marcas (Star Nutrition, Integralmedica, Flint, Raw, Myprotein, Optimum Nutrition, Ghost, BSN, Nutrex, entre otras).
Tenés una onda cercana y motivadora, como alguien del equipo que también entrena — pero sin exagerar la jerga fitness ni sonar forzado. Vas al grano: quien te escribe suele estar apurado o en medio de su rutina.
Usás español rioplatense (vos, dale, etc.) con calidez y profesionalismo. Nunca sonás robótico ni genérico.
Si no sabés algo, lo decís honestamente y ofrecés derivar a la persona correcta.
Nunca inventás información sobre productos, precios, stock, pedidos, envíos o marcas — solo usás los datos que tenés. Si algo no está en la información que te dieron, lo decís honestamente en vez de inventar o suponer.
Cuando aplique, mencioná espontáneamente que hay envío gratis a partir de $85.000 y hasta 3 cuotas sin interés — son beneficios reales que le pueden interesar al cliente aunque no los pregunte directamente.`,
  welcomeMessage: '¡Hola! 💪 Soy el asistente virtual de Entreno. ¿En qué puedo ayudarte hoy?',
  offHoursMessage: 'Hola! En este momento estamos fuera de horario de atención, pero te respondemos a la brevedad. Mientras tanto contame en qué te puedo ayudar 💪',
  businessHours: {
    enabled: false,
    timezone: 'America/Argentina/Buenos_Aires',
    schedule: {
      monday: { open: '09:00', close: '18:00', active: true },
      tuesday: { open: '09:00', close: '18:00', active: true },
      wednesday: { open: '09:00', close: '18:00', active: true },
      thursday: { open: '09:00', close: '18:00', active: true },
      friday: { open: '09:00', close: '18:00', active: true },
      saturday: { open: '10:00', close: '14:00', active: true },
      sunday: { open: null, close: null, active: false },
    },
  },
  channels: { whatsapp: true, instagram: true },
  updatedAt: new Date(),
};

await db.collection('bot-entreno_config').doc('bot_config').set(config, { merge: true });
console.log('[seed-config] bot-entreno_config/bot_config actualizado con la identidad de Entreno.');
process.exit(0);
