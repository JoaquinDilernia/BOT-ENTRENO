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
    botName: 'Asistente',
    botPersonality: `Respondés de forma amigable, natural y cercana — como lo haría una persona real del equipo.\nUsás un tono cálido y profesional. Nunca robótico ni genérico.\nEscribís en español rioplatense (vos, che, etc.) con claridad.\nSi no sabés algo, lo decís honestamente y ofrecés derivar a una persona.\nNunca inventás información sobre servicios, precios, plazos, procesos o links — solo usás los datos que te den. Si algo no está en la información que tenés, lo decís honestamente en vez de inventar o suponer.`,
    welcomeMessage: '¡Hola! Soy el asistente virtual de [NOMBRE DEL NEGOCIO] 👋 ¿En qué puedo ayudarte?',
    offHoursMessage: 'Hola! En este momento estamos fuera de horario, pero te respondemos a la brevedad.',
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
