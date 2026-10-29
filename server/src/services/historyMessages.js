// Historial de la charla → mensajes para Claude. Lo que escribe un agente desde
// el panel (role 'admin') va como turno del asistente, pero marcado: si no,
// Claude lo toma como propio y no sabe que el equipo ya intervino. Pasó con
// "Ya te hicimos el cambio" del agente: el bot contestó "ya quedó derivado
// para que lo corrijan" y volvió a derivar un simple "gracias".
export const AGENT_PREFIX = '[Mensaje de una persona del equipo de Entreno, no tuyo]';

export function historyToMessages(conversationHistory = [], limit = 10) {
  return conversationHistory.slice(-limit).map(msg => {
    const role = msg.role === 'user' ? 'user' : 'assistant';
    let content = msg.transcript ? `[Audio transcripto] ${msg.transcript}` : msg.content;
    if (msg.role === 'admin') content = `${AGENT_PREFIX} ${content}`;
    return { role, content };
  });
}
