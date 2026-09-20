import { Router } from 'express';
import { isConfigured } from '../services/mercadolibre.service.js';

const router = Router();

// TODO: cuando haya client_id/redirect_uri reales, armar acá el link de
// autorización (https://auth.mercadolibre.com.ar/authorization?...) para que
// el panel tenga un botón "Conectar Mercado Libre" — a diferencia de Tienda
// Nube (token cargado a mano en Railway), ML exige el flujo OAuth completo.

router.get('/status', (req, res) => {
  res.json({ configured: isConfigured() });
});

export default router;
