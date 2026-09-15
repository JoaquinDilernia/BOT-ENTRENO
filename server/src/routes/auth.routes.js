import { Router } from 'express';
import {
  validateCredentials, generateToken, updateProfile,
  createUser, listUsers, deleteUser, updateUser,
} from '../services/auth.service.js';
import { requireAuth, requireAdmin, requireAtLeastAtencionCliente } from '../middleware/requireAuth.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const agent = await validateCredentials(email, password);
    if (!agent) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    const token = generateToken(agent);
    res.json({ token, agent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ agent: req.agent });
});

router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { name, currentPassword, newPassword } = req.body;
    if (newPassword) {
      const valid = await validateCredentials(req.agent.email, currentPassword);
      if (!valid) return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    }
    const updated = await updateProfile(req.agent.id, {
      name: name?.trim() || undefined,
      password: newPassword || undefined,
    });
    const token = generateToken(updated);
    res.json({ agent: updated, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listado de usuarios: cualquier rol autenticado (lo necesita el operador
// para poder derivar a un agente específico desde Conversaciones)
router.get('/users', requireAuth, async (req, res) => {
  try {
    res.json(await listUsers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, name, password, role, areaIds } = req.body;
    if (!email || !name || !password) return res.status(400).json({ error: 'email, name y password son requeridos' });
    const user = await createUser({ email, name, password, role, areaIds: areaIds ?? [] });
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, role, areaIds } = req.body;
    const VALID_ROLES = ['admin', 'atencion_cliente', 'operador'];
    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Rol inválido. Válidos: ${VALID_ROLES.join(', ')}` });
    }
    if (req.params.id === req.agent.id && role && role !== req.agent.role) {
      return res.status(400).json({ error: 'No podés cambiar tu propio rol' });
    }
    const updated = await updateUser(req.params.id, { name, role, areaIds });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.agent.id) return res.status(400).json({ error: 'No podés eliminarte a vos mismo' });
    await deleteUser(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
