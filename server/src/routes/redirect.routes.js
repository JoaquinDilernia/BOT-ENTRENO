import { Router } from 'express';
import { resolveShortLink, registerClick } from '../services/campaign.service.js';

// Ruta PÚBLICA (sin requireAuth) — la clickea el destinatario final de una
// difusión desde WhatsApp, no un agente logueado en el panel.
const router = Router();

router.get('/:code', async (req, res) => {
  try {
    const link = await resolveShortLink(req.params.code);
    if (!link) return res.status(404).send('Link no encontrado o vencido.');
    await registerClick(req.params.code).catch(err => console.error('[redirect] Error registrando click:', err.message));
    res.redirect(302, link.targetUrl);
  } catch (err) {
    res.status(500).send('Error procesando el link.');
  }
});

export default router;
