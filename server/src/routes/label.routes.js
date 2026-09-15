import { Router } from 'express';
import { getAllLabels, createLabel, deleteLabel } from '../services/label.service.js';
import { addLabelToConversation, removeLabelFromConversation } from '../services/conversation.service.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    res.json(await getAllLabels());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { name, color } = req.body;
  if (!name || !color) return res.status(400).json({ error: 'name y color requeridos' });
  try {
    res.status(201).json(await createLabel(name, color));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteLabel(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/conversations/:contactId', async (req, res) => {
  const { contactId } = req.params;
  const { action, label } = req.body;
  if (!label || !['add', 'remove'].includes(action)) {
    return res.status(400).json({ error: 'action (add|remove) y label requeridos' });
  }
  try {
    if (action === 'add') await addLabelToConversation(contactId, label);
    else await removeLabelFromConversation(contactId, label);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
