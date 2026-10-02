import { spawn } from 'child_process';
import fs from 'fs';
import ffmpegPath from 'ffmpeg-static';

// Reglas de la API de WhatsApp Cloud para archivos salientes. Cualquier cosa
// fuera de estas listas Meta la rechaza en el upload (o peor: la acepta y el
// cliente nunca la recibe), así que se normaliza ACÁ antes de subir, y si no
// hay forma de mandarla se corta con un mensaje claro para el agente.
// https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media#supported-media-types
const MB = 1024 * 1024;
export const MAX_UPLOAD_BYTES = 100 * MB;

const WA_IMAGE = new Set(['image/jpeg', 'image/png']);
const WA_VIDEO = new Set(['video/mp4', 'video/3gpp']);
const WA_AUDIO = new Set(['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg']);
const WA_DOCUMENT = new Set([
  'text/plain',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const LIMITS = { image: 5 * MB, video: 16 * MB, audio: 16 * MB, document: 100 * MB };

// El navegador a veces manda '' o 'application/octet-stream' (archivos que el
// SO no reconoce, o .docx en algunos Windows) — se resuelve por extensión.
const MIME_BY_EXT = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  mp4: 'video/mp4', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', amr: 'audio/amr', ogg: 'audio/ogg', opus: 'audio/ogg',
  webm: 'audio/webm', wav: 'audio/wav',
};
const MIME_ALIASES = { 'audio/x-m4a': 'audio/mp4', 'audio/mp3': 'audio/mpeg', 'image/jpg': 'image/jpeg', 'audio/opus': 'audio/ogg' };

// Formatos de texto plano que WhatsApp no lista pero que viajan perfecto como
// text/plain: el cliente los recibe con su nombre y extensión originales.
const TEXT_LIKE_EXT = new Set(['csv', 'tsv', 'json', 'xml', 'md', 'log', 'html', 'htm', 'ics', 'vcf', 'rtf']);

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name ?? '');
  return m ? m[1].toLowerCase() : '';
}

function normalizeMime(mimetype, fileName) {
  let base = String(mimetype ?? '').split(';')[0].trim().toLowerCase();
  base = MIME_ALIASES[base] ?? base;
  if (!base || base === 'application/octet-stream') base = MIME_BY_EXT[extOf(fileName)] ?? base;
  return base;
}

function prettySize(bytes) {
  return `${(bytes / MB).toFixed(1).replace('.0', '')} MB`;
}

export class MediaRejectedError extends Error {}

/**
 * Convierte cualquier audio a ogg/opus — el formato nativo de las notas de voz
 * de WhatsApp (se ven con la onda y el botón de play, no como archivo).
 * Chrome sólo graba webm (que WhatsApp no acepta) y Safari graba mp4/aac.
 */
async function toOggOpus(buffer) {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) throw new Error('ffmpeg no disponible');
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn', '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip',
      '-f', 'ogg', 'pipe:1',
    ]);
    const chunks = [];
    let stderr = '';
    proc.stdout.on('data', c => chunks.push(c));
    proc.stderr.on('data', c => { stderr += c; });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0 && chunks.length) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg salió con código ${code}: ${stderr.slice(0, 300)}`));
    });
    proc.stdin.on('error', () => { /* ffmpeg puede cerrar stdin antes — el error real sale por 'close' */ });
    proc.stdin.end(buffer);
  });
}

/**
 * Deja un archivo listo para subir a WhatsApp, o tira MediaRejectedError con
 * un mensaje para mostrarle tal cual al agente.
 *
 * @returns {Promise<{ buffer: Buffer, mimeType: string, waType: 'image'|'video'|'audio'|'document', fileName: string }>}
 */
export async function prepareWhatsAppMedia({ buffer, mimetype, originalname, isVoiceNote = false }) {
  const fileName = originalname || 'archivo';
  const ext = extOf(fileName);
  const mime = normalizeMime(mimetype, fileName);
  const size = buffer.length;

  if (size > MAX_UPLOAD_BYTES) {
    throw new MediaRejectedError(`El archivo pesa ${prettySize(size)}. WhatsApp acepta hasta 100 MB.`);
  }

  if (mime.startsWith('image/')) {
    // Imagen "liviana" en formato soportado → se manda como foto. Si pesa más
    // de 5 MB se manda como documento: WhatsApp la acepta igual (y sin
    // comprimir), y el cliente la abre como cualquier archivo.
    if (WA_IMAGE.has(mime) && size <= LIMITS.image) return { buffer, mimeType: mime, waType: 'image', fileName };
    if (WA_IMAGE.has(mime)) return { buffer, mimeType: mime, waType: 'document', fileName };
    throw new MediaRejectedError(`WhatsApp no acepta imágenes .${ext || mime.split('/')[1]}. Mandala en JPG o PNG.`);
  }

  if (mime.startsWith('video/')) {
    if (!WA_VIDEO.has(mime)) {
      throw new MediaRejectedError(`WhatsApp no acepta videos .${ext || mime.split('/')[1]}. Mandalo en MP4.`);
    }
    if (size > LIMITS.video) {
      throw new MediaRejectedError(`El video pesa ${prettySize(size)} y WhatsApp acepta hasta 16 MB. Recortalo o compartí un link.`);
    }
    return { buffer, mimeType: mime, waType: 'video', fileName };
  }

  if (mime.startsWith('audio/')) {
    // Notas de voz grabadas en el panel → siempre ogg/opus, así le llegan al
    // cliente como nota de voz y no como "archivo de audio". Un audio subido
    // como archivo (mp3, m4a…) se respeta tal cual si WhatsApp lo acepta.
    const needsConversion = isVoiceNote ? mime !== 'audio/ogg' : !WA_AUDIO.has(mime);
    if (needsConversion) {
      try {
        const ogg = await toOggOpus(buffer);
        return { buffer: ogg, mimeType: 'audio/ogg', waType: 'audio', fileName: fileName.replace(/\.[^.]+$/, '') + '.ogg' };
      } catch (err) {
        console.error('[media] Falló la conversión de audio a ogg:', err.message);
        if (!WA_AUDIO.has(mime)) {
          throw new MediaRejectedError('No se pudo convertir el audio a un formato que acepte WhatsApp. Probá grabarlo de nuevo o mandarlo como MP3.');
        }
      }
    }
    if (size > LIMITS.audio) {
      throw new MediaRejectedError(`El audio pesa ${prettySize(size)} y WhatsApp acepta hasta 16 MB.`);
    }
    return { buffer, mimeType: mime, waType: 'audio', fileName };
  }

  if (WA_DOCUMENT.has(mime)) return { buffer, mimeType: mime, waType: 'document', fileName };
  if (mime.startsWith('text/') || TEXT_LIKE_EXT.has(ext)) {
    return { buffer, mimeType: 'text/plain', waType: 'document', fileName };
  }

  throw new MediaRejectedError(
    `WhatsApp no permite enviar archivos .${ext || 'de este tipo'}. Se pueden mandar PDF, Word, Excel, PowerPoint, TXT/CSV, imágenes, videos MP4 y audios. Para otros formatos (ej. .zip), subilo a Drive y mandá el link.`
  );
}
