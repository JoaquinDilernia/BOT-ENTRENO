import { verifyToken, getAgentById } from '../services/auth.service.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const decoded = verifyToken(token);
    const agent = await getAgentById(decoded.id);
    if (!agent) return res.status(401).json({ error: 'Usuario no encontrado' });
    req.agent = agent;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.agent?.role !== 'admin') return res.status(403).json({ error: 'Acceso restringido a administradores' });
  next();
}

// admin + atencion_cliente; blocks operador
export function requireAtLeastAtencionCliente(req, res, next) {
  const role = req.agent?.role;
  if (role !== 'admin' && role !== 'atencion_cliente') {
    return res.status(403).json({ error: 'Acceso no disponible para operadores' });
  }
  next();
}
