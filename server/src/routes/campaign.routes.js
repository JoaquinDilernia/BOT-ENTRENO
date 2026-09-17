import { Router } from 'express';
import {
  listCampaigns,
  getCampaign,
  getCampaignSends,
  createCampaign,
  deleteCampaign,
  sendCampaign,
  resolveSegment,
} from '../services/campaign.service.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    res.json({ campaigns: await listCampaigns() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Previsualización del segmento antes de crear/mandar la campaña — misma
// función que usa el envío real, así el conteo que ve el agente es exacto.
router.post('/preview-segment', async (req, res) => {
  try {
    const recipients = await resolveSegment(req.body.segment ?? {});
    const whatsappOnly = recipients.filter(c => c.channel === 'whatsapp');
    res.json({
      total: recipients.length,
      whatsappCount: whatsappOnly.length,
      sample: whatsappOnly.slice(0, 10).map(c => ({ contactId: c.contactId, contactName: c.contactName })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, templateName, language, category, paramsTemplate, targetUrl, segment } = req.body;
    const campaign = await createCampaign({
      name, templateName, language, category, paramsTemplate, targetUrl, segment,
      createdBy: req.agent?.email ?? null,
    });
    res.status(201).json({ campaign });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });
    const sends = await getCampaignSends(req.params.id);
    res.json({ campaign, sends });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/send', async (req, res) => {
  try {
    // PUBLIC_BASE_URL: si no está seteada, la campaña igual se manda pero
    // sin link corto trackeable (ver campaign.service.js:sendCampaign).
    const result = await sendCampaign(req.params.id, process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') || null);
    res.json(result);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteCampaign(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
