import { Router } from 'express';
import { handleNotification } from '../services/mercadolibre.service.js';

const router = Router();

// Mercado Libre pega acá cuando pasa algo en la cuenta vinculada (preguntas
// de publicaciones, pedidos, etc.). Exige responder 200 rápido — el resto se
// procesa después, sin bloquear la respuesta (mismo criterio que
// webhook.routes.js para los webhooks de Meta).
router.post('/', async (req, res) => {
  res.sendStatus(200);
  try {
    await handleNotification(req.body);
  } catch (err) {
    console.error('[mercadolibre] Error procesando notificación:', err.message);
  }
});

// Por las dudas: algunas integraciones de ML validan la URL del webhook con
// un GET antes de guardarla en la app.
router.get('/', (req, res) => res.sendStatus(200));

export default router;
