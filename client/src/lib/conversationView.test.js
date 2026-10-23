import { describe, it, expect } from 'vitest';
import { waitLevel, avatarColor, statusPill, AVATAR_PALETTE, resolveAssignee, pillFor, initials, listTime, buildTimeline } from './conversationView.js';

describe('waitLevel', () => {
  it('umbrales 5 y 15 minutos', () => {
    expect(waitLevel(null)).toBe('none');
    expect(waitLevel(undefined)).toBe('none');
    expect(waitLevel(0)).toBe('ok');
    expect(waitLevel(4.9)).toBe('ok');
    expect(waitLevel(5)).toBe('warn');
    expect(waitLevel(14.9)).toBe('warn');
    expect(waitLevel(15)).toBe('late');
    expect(waitLevel(120)).toBe('late');
  });
});

describe('avatarColor', () => {
  it('es estable y sale de la paleta de 8', () => {
    expect(avatarColor('5492994000000')).toBe(avatarColor('5492994000000'));
    expect(AVATAR_PALETTE).toEqual(['#7c3aed', '#e8473f', '#0ea5e9', '#f59e0b', '#16a34a', '#db2777', '#0f766e', '#6366f1']);
    for (const s of ['a', 'b', 'Juan', '5491100000000', '', null, undefined]) {
      expect(AVATAR_PALETTE).toContain(avatarColor(s));
    }
  });
  it('reparte distintos seeds en más de un color', () => {
    const colors = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map(avatarColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('statusPill', () => {
  it('bot', () => {
    expect(statusPill({ status: 'bot' }, { botName: 'TeDi' })).toEqual({ text: 'TeDi respondiendo', tone: 'bot' });
  });
  it('escalated sin humanMode', () => {
    expect(statusPill({ status: 'escalated', humanMode: false }, { botName: 'TeDi', areaName: 'Ventas' })).toEqual({ text: 'Esperando · Ventas', tone: 'wait' });
    expect(statusPill({ status: 'escalated', humanMode: false }, { botName: 'TeDi' })).toEqual({ text: 'Esperando', tone: 'wait' });
  });
  it('humanMode', () => {
    expect(statusPill({ status: 'escalated', humanMode: true }, { botName: 'TeDi', agentName: 'Joaquín' })).toEqual({ text: 'Joaquín', tone: 'agent' });
    expect(statusPill({ status: 'escalated', humanMode: true }, { botName: 'TeDi' })).toEqual({ text: 'Equipo', tone: 'agent' });
  });
  it('resolved y bot_archived', () => {
    expect(statusPill({ status: 'resolved' }, { botName: 'TeDi' })).toEqual({ text: 'Resuelta', tone: 'ok' });
    expect(statusPill({ status: 'bot_archived' }, { botName: 'TeDi' })).toEqual({ text: 'Archivada', tone: 'muted' });
  });
  it('sin botName usa "Bot"', () => {
    expect(statusPill({ status: 'bot' }, {})).toEqual({ text: 'Bot respondiendo', tone: 'bot' });
  });
});

describe('resolveAssignee', () => {
  const areas = [{ id: 'a1', name: 'Ventas' }];
  const nameMap = { a1: 'Ventas', 'jo@x.com': 'Joaquín', u7: 'Joaquín' };
  it('distingue área de agente', () => {
    expect(resolveAssignee('a1', { areas, nameMap })).toEqual({ areaName: 'Ventas', agentName: null });
    expect(resolveAssignee('jo@x.com', { areas, nameMap })).toEqual({ areaName: null, agentName: 'Joaquín' });
    expect(resolveAssignee('u7', { areas, nameMap })).toEqual({ areaName: null, agentName: 'Joaquín' });
    expect(resolveAssignee('otro@x.com', { areas, nameMap })).toEqual({ areaName: null, agentName: 'otro@x.com' });
    expect(resolveAssignee(null, { areas, nameMap })).toEqual({ areaName: null, agentName: null });
  });
});

describe('pillFor (datos reales: el backend escala con humanMode=true)', () => {
  const ctx = { botName: 'TeDi', areas: [{ id: 'a1', name: 'Ventas' }], nameMap: { 'jo@x.com': 'Joaquín' } };
  it('derivada a un área sin agente → Esperando · área', () => {
    expect(pillFor({ status: 'escalated', humanMode: true, assignedTo: 'a1' }, ctx)).toEqual({ text: 'Esperando · Ventas', tone: 'wait' });
  });
  it('escalada sin asignar → Esperando', () => {
    expect(pillFor({ status: 'escalated', humanMode: true, assignedTo: null }, ctx)).toEqual({ text: 'Esperando', tone: 'wait' });
  });
  it('tomada por un agente → nombre', () => {
    expect(pillFor({ status: 'escalated', humanMode: true, assignedTo: 'jo@x.com' }, ctx)).toEqual({ text: 'Joaquín', tone: 'agent' });
  });
  it('derivada a un área pero un agente ya respondió → tomada (Equipo)', () => {
    const conv = { status: 'escalated', humanMode: true, assignedTo: 'a1', firstAgentResponseAt: '2026-10-20T14:00:00Z' };
    expect(pillFor(conv, ctx)).toEqual({ text: 'Equipo', tone: 'agent' });
    expect(pillFor({ ...conv, assignedTo: null }, ctx)).toEqual({ text: 'Equipo', tone: 'agent' });
  });
  it('asignada a un agente y respondida → nombre del agente', () => {
    const conv = { status: 'escalated', humanMode: true, assignedTo: 'jo@x.com', firstAgentResponseAt: '2026-10-20T14:00:00Z' };
    expect(pillFor(conv, ctx)).toEqual({ text: 'Joaquín', tone: 'agent' });
  });
  it('firstAgentResponseAt sin humanMode no la marca como tomada', () => {
    expect(pillFor({ status: 'bot', humanMode: false, firstAgentResponseAt: '2026-10-20T14:00:00Z' }, ctx).tone).toBe('bot');
  });
  it('bot, resuelta y archivada', () => {
    expect(pillFor({ status: 'bot', humanMode: false }, ctx)).toEqual({ text: 'TeDi respondiendo', tone: 'bot' });
    expect(pillFor({}, ctx)).toEqual({ text: 'TeDi respondiendo', tone: 'bot' });
    expect(pillFor({ status: 'resolved', assignedTo: 'jo@x.com' }, ctx)).toEqual({ text: 'Resuelta', tone: 'ok' });
    expect(pillFor({ status: 'bot_archived' }, ctx)).toEqual({ text: 'Archivada', tone: 'muted' });
  });
});

describe('initials', () => {
  it('toma hasta 2 iniciales', () => {
    expect(initials('Ferretería Don José')).toBe('FD');
    expect(initials('lucía')).toBe('L');
    expect(initials('5492994000000')).toBe('54');
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
  });
});

describe('listTime', () => {
  const now = new Date(2026, 9, 20, 15, 0);
  it('hoy hora, ayer, o fecha', () => {
    expect(listTime(new Date(2026, 9, 20, 10, 42), now)).toMatch(/10:42/);
    expect(listTime(new Date(2026, 9, 19, 23, 0), now)).toBe('ayer');
    expect(listTime(new Date(2026, 9, 3, 9, 0), now)).toBe('03/10');
    expect(listTime({ _seconds: new Date(2026, 9, 20, 9, 5).getTime() / 1000 }, now)).toMatch(/09:05/);
    expect(listTime(null, now)).toBe('');
  });
});

describe('buildTimeline', () => {
  const nameMap = { 'j@techdi.com': 'Joaquín' };
  const u = c => ({ role: 'user', content: c, timestamp: '2026-10-20T13:00:00Z' });
  const b = c => ({ role: 'assistant', content: c, timestamp: '2026-10-20T13:01:00Z' });
  const a = (c, s = 'j@techdi.com') => ({ role: 'admin', content: c, sentBy: s, timestamp: '2026-10-20T13:02:00Z' });
  const handoffs = msgs => buildTimeline(msgs, { botName: 'TeDi', nameMap }).filter(x => x.kind === 'handoff').map(x => x.text);

  it('avisos de traspaso entre bot y agente', () => {
    expect(handoffs([u('hola'), b('hola!'), u('persona'), a('soy Joaquín')])).toEqual(['Joaquín tomó la conversación']);
    expect(handoffs([u('x'), b('y'), a('z'), b('w')])).toEqual(['Joaquín tomó la conversación', 'TeDi volvió a responder']);
    expect(handoffs([a('primer mensaje'), u('ok'), a('otro')])).toEqual([]);
    // (el brief pasaba `undefined`, que activa el valor por defecto del fixture; se usa null = sin sentBy)
    expect(handoffs([b('y'), a('z', null)])).toEqual(['Alguien del equipo tomó la conversación']);
    expect(handoffs([b('y'), a('[Difusión] promo'), b('w')])).toEqual([]);
    expect(handoffs([b('y'), u('a'), u('b'), b('z')])).toEqual([]);
  });

  it('el aviso va justo antes del mensaje que cambia de responsable', () => {
    const tl = buildTimeline([b('y'), u('p'), a('z')], { botName: 'TeDi', nameMap, now: new Date('2026-10-20T15:00:00Z') });
    expect(tl.map(x => x.kind)).toEqual(['day', 'msg', 'msg', 'handoff', 'msg']);
    expect(tl[4].msg.content).toBe('z');
    expect(tl[4].index).toBe(2);
  });

  it('entre agentes no hay aviso: solo cambia el tipo bot ⇄ agente', () => {
    const map2 = { ...nameMap, 'm@techdi.com': 'Mica' };
    const tl = buildTimeline([a('uno'), a('dos', 'm@techdi.com'), a('tres', 'desconocido@x.com'), a('cuatro', null)], { botName: 'TeDi', nameMap: map2 });
    expect(tl.filter(x => x.kind === 'handoff')).toEqual([]);
    expect(handoffs([b('y'), a('x', null), a('z')])).toEqual(['Alguien del equipo tomó la conversación']);
    expect(handoffs([b('y'), a('x'), a('z', 'otro@x.com')])).toEqual(['Joaquín tomó la conversación']);
  });

  it('separadores de día en hora de Argentina: HOY, AYER o "lun 19 oct"', () => {
    const now = new Date('2026-10-20T15:00:00Z'); // 12:00 en Argentina
    const msgs = [
      { role: 'user', content: '1', timestamp: '2026-10-18T14:00:00Z' }, // dom 18 oct
      { role: 'user', content: '2', timestamp: { _seconds: Date.parse('2026-10-19T14:00:00Z') / 1000 } }, // lun 19 → AYER
      { role: 'user', content: '3', timestamp: '2026-10-20T02:30:00Z' }, // 23:30 AR del 19 → sigue AYER
      { role: 'user', content: '4', timestamp: '2026-10-20T03:30:00Z' }, // 00:30 AR del 20 → HOY
      { role: 'user', content: '5', timestamp: '2026-10-20T13:00:00Z' },
    ];
    const days = buildTimeline(msgs, { botName: 'TeDi', nameMap, now }).filter(x => x.kind === 'day').map(x => x.label);
    expect(days).toEqual(['dom 18 oct', 'AYER', 'HOY']);
    const older = buildTimeline([{ role: 'user', content: 'x', timestamp: '2026-10-12T15:00:00Z' }], { now }).filter(x => x.kind === 'day');
    expect(older[0].label).toBe('lun 12 oct');
  });

  it('las claves de día y aviso son estables y únicas', () => {
    const msgs = [b('y'), a('z'), b('w')];
    const k1 = buildTimeline(msgs, { botName: 'TeDi', nameMap }).filter(x => x.kind !== 'msg').map(x => x.key);
    const k2 = buildTimeline(msgs, { botName: 'TeDi', nameMap }).filter(x => x.kind !== 'msg').map(x => x.key);
    expect(k1).toEqual(k2);
    expect(new Set(k1).size).toBe(k1.length);
  });

  it('tolera lista vacía, mensajes sin fecha y sin botName', () => {
    expect(buildTimeline([], {})).toEqual([]);
    expect(buildTimeline(undefined, {})).toEqual([]);
    const tl = buildTimeline([{ role: 'admin', content: 'x' }, { role: 'assistant', content: 'y' }], {});
    expect(tl.filter(x => x.kind === 'handoff').map(x => x.text)).toEqual(['Bot volvió a responder']);
    expect(tl.some(x => x.kind === 'day')).toBe(false);
  });
});
