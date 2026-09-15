import { Router } from 'express';
import { requireAdmin } from '../middleware/requireAuth.js';
import {
  getAllAreas, createArea, updateArea, deleteArea,
} from '../services/area.service.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    res.json({ areas: await getAllAreas() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, description, active } = req.body;
    if (!name || !description) return res.status(400).json({ error: 'name y description son requeridos' });
    res.status(201).json(await createArea({ name, description, active }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    res.json(await updateArea(req.params.id, req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await deleteArea(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
