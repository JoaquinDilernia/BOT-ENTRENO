import { Router } from 'express';
import { getAllQuickReplies, createQuickReply, deleteQuickReply } from '../services/quickreply.service.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    res.json(await getAllQuickReplies());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { shortcut, title, text } = req.body;
  if (!shortcut?.trim() || !text?.trim()) return res.status(400).json({ error: 'shortcut y text requeridos' });
  try {
    res.status(201).json(await createQuickReply(shortcut, title ?? shortcut, text));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteQuickReply(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
