import { Router } from 'express';
import { getDb } from '../services/firebase.service.js';
import { requireAtLeastAtencionCliente } from '../middleware/requireAuth.js';

const router = Router();
const CONFIG_DOC = 'bot_config';

router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('bot-entreno_config').doc(CONFIG_DOC).get();
    const config = doc.exists ? doc.data() : getDefaultConfig();
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', requireAtLeastAtencionCliente, async (req, res) => {
  try {
    const db = getDb();
    await db.collection('bot-entreno_config').doc(CONFIG_DOC).set(
      { ...req.body, updatedAt: new Date() },
      { merge: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getDefaultConfig() {
  return {
    businessName: 'Entreno',
    botName: 'Entreno',
    botPersonality: `Sos el asistente virtual de Entreno (entreno.com.ar), tienda online de suplementos deportivos, nutrición y indumentaria fitness con más de 40 marcas.\nTenés una onda cercana y motivadora, como alguien del equipo que también entrena — pero sin exagerar la jerga fitness ni sonar forzado. Vas al grano.\nUsás español rioplatense (vos, dale, etc.) con calidez y profesionalismo. Nunca sonás robótico ni genérico.\nSi no sabés algo, lo decís honestamente y ofrecés derivar a la persona correcta.\nNunca inventás información sobre productos, precios, stock, pedidos, envíos o marcas — solo usás los datos que tenés.\nCuando aplique, mencioná espontáneamente que hay envío gratis a partir de $85.000 y hasta 3 cuotas sin interés.`,
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
  };
}

export default router;
