import axios from 'axios';

const EXT_BY_MIME = {
  ogg: 'ogg', mpeg: 'mp3', mp3: 'mp3', mp4: 'm4a', m4a: 'm4a', wav: 'wav', webm: 'webm',
};

function extForMime(mimeType) {
  const found = Object.keys(EXT_BY_MIME).find(key => mimeType?.includes(key));
  return found ? EXT_BY_MIME[found] : 'ogg';
}

export async function transcribeAudio(buffer, mimeType) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY no configurada');
  const form = new FormData();
  form.append('model', 'whisper-1');
  form.append('language', 'es');
  form.append('file', new Blob([buffer], { type: mimeType }), `audio.${extForMime(mimeType)}`);
  const { data } = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  });
  return data.text;
}
