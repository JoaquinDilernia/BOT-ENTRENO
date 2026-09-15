import { Router } from 'express';
import multer from 'multer';
import { uploadMetaMedia } from '../services/meta.service.js';
import {
  getAllTickets, getTicketById, createTicket, updateTicket, addComment,
} from '../services/ticket.service.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

router.get('/', async (req, res) => {
  try {
    const { estado, prioridad } = req.query;
    res.json({ tickets: await getAllTickets({ estado, prioridad }) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const ticket = await getTicketById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });
    res.json({ ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { titulo, descripcion, proyectoId, contactId, prioridad, imagenes } = req.body;
  if (!titulo?.trim() || !descripcion?.trim()) return res.status(400).json({ error: 'titulo y descripcion son requeridos' });
  try {
    const ticket = await createTicket({
      titulo: titulo.trim(),
      descripcion: descripcion.trim(),
      proyectoId: proyectoId || null,
      contactId: contactId || null,
      prioridad: prioridad || 'media',
      imagenes: imagenes || [],
      createdBy: req.agent.email,
    });
    res.status(201).json({ ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const ticket = await updateTicket(req.params.id, req.body);
    res.json({ ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/comments', async (req, res) => {
  const { texto } = req.body;
  if (!texto?.trim()) return res.status(400).json({ error: 'texto es requerido' });
  try {
    const comentarios = await addComment(req.params.id, { autor: req.agent.email, texto: texto.trim() });
    res.json({ comentarios });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sube una imagen nueva (no vinculada a ningún mensaje de WhatsApp existente)
// para adjuntar a un ticket cargado a mano desde el panel. Reutiliza
// uploadMetaMedia — el archivo termina alojado en Meta igual que cualquier
// media de WhatsApp, así que se sirve después con el mismo
// GET /api/conversations/media/:mediaId que ya existe (no hace falta un
// endpoint de lectura nuevo).
router.post('/upload-image', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  try {
    const { buffer, mimetype } = req.file;
    if (!mimetype.startsWith('image/')) return res.status(400).json({ error: 'Solo se aceptan imágenes' });
    const mediaId = await uploadMetaMedia(buffer, mimetype);
    if (!mediaId) return res.status(503).json({ error: 'Meta no configurado — no se pudo subir la imagen' });
    res.json({ mediaId, mimeType: mimetype });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
