import { Router } from 'express';
import { requireAtLeastAtencionCliente } from '../middleware/requireAuth.js';
import { getAllTemplates, createTemplate, deleteTemplate, syncTemplateStatuses } from '../services/template.service.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    res.json(await getAllTemplates());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sync', requireAtLeastAtencionCliente, async (req, res) => {
  try {
    await syncTemplateStatuses();
    res.json(await getAllTemplates());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireAtLeastAtencionCliente, async (req, res) => {
  const { name, displayName, bodyText, language, category, params } = req.body;
  if (!name?.trim() || !bodyText?.trim()) return res.status(400).json({ error: 'name y bodyText requeridos' });
  try {
    const template = await createTemplate({ name, displayName: displayName || name, bodyText, language, category, params });
    // 201 always (saved to Firestore); include metaSubmitError so frontend can warn the user
    res.status(201).json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAtLeastAtencionCliente, async (req, res) => {
  try {
    await deleteTemplate(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
