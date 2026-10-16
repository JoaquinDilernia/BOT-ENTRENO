// El bot a veces pone [CERRAR] en una respuesta que termina preguntando
// ("¿Te ayudo con algo más?", "¿buscás algo específico?"): la charla quedaba
// como resuelta mientras el bot esperaba respuesta. Si el último mensaje del
// bot es una pregunta, la conversación sigue abierta aunque venga el marcador.
export function endsWithQuestion(text) {
  // Emojis (con tono de piel / ZWJ), espacios y cierres de formato de
  // WhatsApp (*negrita*, _cursiva_, ~tachado~) no cuentan como final.
  const trimmed = String(text ?? '')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\s*_~)\]]+$/u, '');
  return trimmed.endsWith('?');
}
