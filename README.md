# BOT-ENTRENO

Bot conversacional para ENTRENO (entreno.com.ar), tienda online (TiendaNube)
de suplementos deportivos, nutrición e indumentaria fitness (proteínas,
creatina/pre-entreno, vitaminas, quemadores, indumentaria, +40 marcas:
Star Nutrition, Integralmedica, Flint, Raw, Myprotein, Optimum Nutrition,
Ghost, BSN, Nutrex, etc.).

Integra WhatsApp Business, Instagram y Claude AI para atender leads
(preventa) y clientes existentes (soporte pre/post-venta) por un mismo
canal, con derivación a un equipo humano organizada en Áreas configurables
desde el panel de administración.

Clonado de BOT-BASE (plantilla interna de TECHDI).

---

## Stack

- **Frontend**: React + Vite + CSS Modules
- **Backend**: Node.js (ESM) + Express
- **Database**: Firebase Firestore (proyecto compartido `pedidos-lett-2`, colecciones con prefijo `bot-entreno_`)
- **AI**: Claude API (Anthropic)
- **Mensajería**: Meta Cloud API (WhatsApp Business + Instagram)

## Estructura

```
BOT-ENTRENO/
├── client/           # Dashboard admin (React)
│   └── src/
│       ├── components/
│       ├── pages/
│       ├── hooks/
│       ├── contexts/
│       ├── lib/
│       └── styles/
└── server/           # API + Webhook handler (Node/Express)
    └── src/
        ├── routes/
        ├── services/
        └── middleware/
```

## Pendiente de setup para este cliente

- [ ] Completar `server/.env` y `client/.env` a partir de sus `.env.example`
      con credenciales **nuevas** (WhatsApp/Instagram/Firebase config del
      front — nunca reusar las de otro bot).
- [ ] `ADMIN_EMAIL` / `ADMIN_NAME` / `ADMIN_PASSWORD` en `server/.env`:
      cuenta admin inicial del cliente.
- [ ] Ajustar la personalidad y el mensaje de bienvenida desde la pantalla
      Config del panel (o los defaults en `server/src/routes/config.routes.js`).
- [ ] Cargar la Knowledge Base real del cliente (arranca vacía a propósito):
      catálogo de productos, política de envíos ($85.000 ARS gratis),
      métodos de pago (hasta 3 cuotas sin interés), WhatsApp humano de
      respaldo (+54 11 3019-2777).
- [ ] Conectar integración TiendaNube (store de ENTRENO) para stock/pedidos,
      siguiendo el patrón de BOT-ALTORANCHO (`tiendanube.service.js`).
- [ ] Deploy: Railway (backend) + Vercel (frontend), separado de cualquier
      otro bot.

## Cómo correr localmente

```bash
# Backend
cd server && npm install && npm run dev   # puerto 3001

# Frontend
cd client && npm install && npm run dev   # puerto 5173
```

Completá `server/.env` y `client/.env` a partir de sus `.env.example` antes de arrancar.
