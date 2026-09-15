import { Router } from 'express';
import {
  getAllKnowledgeItems,
  createKnowledgeItem,
  updateKnowledgeItem,
  deleteKnowledgeItem,
} from '../services/knowledge.service.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const items = await getAllKnowledgeItems();
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, content, category, order, active } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'title y content son requeridos' });

    const item = await createKnowledgeItem({ title, content, category, order, active });
    res.status(201).json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    await updateKnowledgeItem(req.params.id, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteKnowledgeItem(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
