// Qué hacer con la conversación cuando un agente le manda algo al cliente
// (texto, archivo o reenvío). Si el chat no estaba en manos de un humano, el
// agente que escribe lo toma: si no, el bot contesta la respuesta del cliente
// a la pregunta del agente. Pasó con el chat en modo bot por tocar "Devolver
// a Entreno" justo mientras se enviaba la respuesta.
export function agentSendPatch(conversation, agentEmail) {
  if (conversation.humanMode) return null;
  const wasClosed = ['resolved', 'bot_archived'].includes(conversation.status);
  return {
    status: 'escalated',
    humanMode: true,
    assignedTo: agentEmail,
    escalationReason: wasClosed ? 'equipo_inicio' : 'equipo_toma',
  };
}
