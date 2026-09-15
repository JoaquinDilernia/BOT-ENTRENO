import { Router } from 'express';
import { requireAtLeastAtencionCliente } from '../middleware/requireAuth.js';
import {
  getAllProjects, getProjectById, createProject, updateProject, deleteProject,
} from '../services/project.service.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    res.json({ projects: await getAllProjects() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const project = await getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireAtLeastAtencionCliente, async (req, res) => {
  const { nombre, empresa, descripcion, estado, contactos } = req.body;
  if (!nombre?.trim() || !empresa?.trim()) return res.status(400).json({ error: 'nombre y empresa son requeridos' });
  try {
    const project = await createProject({
      nombre: nombre.trim(),
      empresa: empresa.trim(),
      descripcion: descripcion ?? '',
      estado: estado || 'activo',
      contactos: contactos ?? [],
    });
    res.status(201).json({ project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireAtLeastAtencionCliente, async (req, res) => {
  try {
    const project = await updateProject(req.params.id, req.body);
    res.json({ project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAtLeastAtencionCliente, async (req, res) => {
  try {
    await deleteProject(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
