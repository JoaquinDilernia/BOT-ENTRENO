// Canonicaliza un teléfono al ÚNICO formato usado como ID de contacto de
// WhatsApp en todo el sistema: `549` + área + abonado (celular argentino en
// E.164 sin el `+`). SIEMPRE con el 9 — es lo que exige la API de WhatsApp
// para enviar y lo que evita que se dupliquen las conversaciones.
//
// Por qué existe: las conversaciones y los clientes se guardan en Firestore
// con el teléfono como ID de documento. Si el mismo número entra escrito de
// dos formas distintas (el 9 de celular, un 0 de prefijo, un 15, el +), se
// crean dos documentos para la misma persona: uno cuando sale una plantilla
// y otro cuando responde el cliente. Todas las rutas que crean o buscan una
// conversación —webhook entrante y envíos salientes— tienen que pasar por acá.
//
// Meta manda el `from` de los números argentinos a veces CON el 9 y a veces
// SIN él (rollout inconsistente número por número), así que normalizar en un
// solo lugar es la única forma de que ambos lados coincidan.
//
// Limitaciones conocidas:
//  - Números de otros países se devuelven sin tocar.
//  - Un "15" de celular sin código de área se asume área 11 (Bs. As.).

export function toWaContactId(raw) {
  if (raw === null || raw === undefined) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;

  if (d.startsWith('00')) d = d.slice(2); // prefijo internacional 00

  // ¿Parece un número argentino? Solo tocamos estos; cualquier otro código de
  // país se devuelve tal cual para no romper contactos del exterior.
  const looksArgentine =
    d.startsWith('54') ||
    d.startsWith('0') ||
    d.length === 10 ||
    (d.length === 11 && d.startsWith('9'));
  if (!looksArgentine) return d;

  if (d.startsWith('54')) d = d.slice(2);       // sacar código de país
  else if (d.startsWith('0')) d = d.slice(1);   // sacar 0 troncal

  // Los códigos de área argentinos nunca empiezan con 9, así que un 9
  // adelante siempre es el prefijo de celular — lo agregamos nosotros después.
  d = d.replace(/^9+/, '');

  // Sacar el "15" de celular de la notación de discado local:
  //  - <área>15<abonado>: área + abonado SIEMPRE suma 10 dígitos en Argentina,
  //    así que con el "15" en el medio el total es exactamente 12. Un número
  //    de 10 dígitos NO lleva 15 intercalado (es área + abonado a secas, ej.
  //    "351 5163920" de Córdoba, o un abonado de Bs. As. que arranca con 15).
  //  - "15" + 8 dígitos sin área: se asume Buenos Aires (área 11).
  if (d.length === 12) {
    const m = d.match(/^(\d{2,4})15(\d{6,8})$/);
    if (m && m[1].length + m[2].length === 10) d = m[1] + m[2];
  } else if (d.length === 10 && d.startsWith('15')) {
    d = `11${d.slice(2)}`;
  }

  return `549${d}`;
}
