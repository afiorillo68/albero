// Geometria della vista: posizioni effettive dei nodi, percorsi degli archi con spigoli
// arrotondati, fasce delle generazioni, posto per una persona nuova. Modulo puro.
import { GEOMETRIA } from "./layout.js";

const { W, H, NODO, PASSO, GAP_COPPIA, GAP_FRATELLI } = GEOMETRIA;
export const MARGINE_FASCIA = 36;
export const LARGH_ETICHETTA = 200;
export const SCARTO_BARRA = 10;      // le barre dei fratelli di unioni vicine si alternano di ±10

const fmt = n => (Math.round(n * 10) / 10).toString();

export const centro = pos => ({ x: pos.x + W / 2, y: pos.y + H / 2 });

// Un riquadro con più righe di testo è più alto di H e cresce in su e in giù di metà
// ciascuno: pos.y resta la cima del riquadro normale, così il centro non si sposta.
export const cimaDi = pos => pos.y + (H - (pos.h ?? H)) / 2;
export const fondoDi = pos => pos.y + (H + (pos.h ?? H)) / 2;

// Posizione (centro) del nodo di un'unione: quella salvata, altrimenti a metà fra i partner.
export function posizioneUnione(u, nodi, posPersona) {
  if (nodi[u.id]) return nodi[u.id];
  const [a, b] = u.partner.map(p => centro(posPersona(p)));
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Indice di alternanza delle barre: per ogni generazione, le unioni con figli in ordine
// orizzontale; la barra di una sì e una no scende di 10, come nel disegno di partenza.
export function scartiBarre(unioni, generazione, posPersona) {
  const perGen = new Map();
  for (const u of unioni) {
    if (!u.figli.length) continue;
    const g = generazione[u.partner[0]];
    if (!perGen.has(g)) perGen.set(g, []);
    perGen.get(g).push(u);
  }
  const out = {};
  for (const lista of perGen.values()) {
    lista.map(u => [Math.min(...u.partner.map(p => centro(posPersona(p)).x)), u])
      .sort((a, b) => a[0] - b[0])
      .forEach(([, u], k) => { out[u.id] = k % 2 ? SCARTO_BARRA : -SCARTO_BARRA; });
  }
  return out;
}

// Punto del bordo di un riquadro da cui partire verso il punto «verso»: il centro del lato
// che guarda in quella direzione.
export function ancoraRiquadro(pos, verso) {
  const c = centro(pos);
  const dx = (verso.x - c.x) / W, dy = (verso.y - c.y) / (pos.h ?? H);
  if (Math.abs(dx) >= Math.abs(dy)) return { x: dx >= 0 ? pos.x + W : pos.x, y: c.y };
  return { x: c.x, y: dy >= 0 ? fondoDi(pos) : cimaDi(pos) };
}

// Arco fra un partner e il nodo dell'unione: dal lato del riquadro, per i vertici salvati.
export function percorsoPartner(posP, pu, punti = []) {
  const primo = punti.length ? punti[0] : pu;
  return [ancoraRiquadro(posP, primo), ...punti, pu];
}

// Arco fra il nodo dell'unione e un figlio: senza vertici salvati scende alla barra dei
// fratelli, la percorre e scende al figlio.
export function percorsoFiglio(pu, posF, yBarra, punti = null) {
  const inizio = { x: pu.x, y: pu.y + NODO / 2 };
  const fine = { x: posF.x + W / 2, y: cimaDi(posF) };
  if (punti && punti.length) return [inizio, ...punti, fine];
  // figlio quasi in asse con il nodo: si scende dritti, senza uno scalino di pochi pixel
  if (Math.abs(fine.x - inizio.x) < NODO / 2) return [{ x: fine.x, y: inizio.y }, fine];
  return [inizio, { x: inizio.x, y: yBarra }, { x: fine.x, y: yBarra }, fine];
}

// Altezza della barra dei fratelli: a metà fra il fondo dei genitori e il figlio più alto.
export function altezzaBarra(u, posPersona, scarto = 0) {
  const fondo = Math.max(...u.partner.map(p => fondoDi(posPersona(p))));
  const cima = Math.min(...u.figli.map(f => cimaDi(posPersona(f))));
  return (fondo + cima) / 2 + scarto;
}

// Percorso SVG di una spezzata con gli spigoli arrotondati da archi di circonferenza.
// Il raggio è costante; in uno spigolo stretto si riduce, perché il tratto tolto a ogni
// segmento non superi metà del segmento (tutto, per il primo e l'ultimo). Gli spigoli
// fra segmenti allineati restano dritti.
export function percorsoArrotondato(punti, raggio) {
  const p = [];
  for (const q of punti) {
    const ultimo = p.at(-1);
    if (!ultimo || Math.hypot(q.x - ultimo.x, q.y - ultimo.y) > 0.01) p.push(q);
  }
  if (p.length < 2) return "";
  let d = `M ${fmt(p[0].x)} ${fmt(p[0].y)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1], b = p[i], c = p[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const u1 = { x: (b.x - a.x) / l1, y: (b.y - a.y) / l1 };
    const u2 = { x: (c.x - b.x) / l2, y: (c.y - b.y) / l2 };
    const croce = u1.x * u2.y - u1.y * u2.x;
    const svolta = Math.atan2(Math.abs(croce), u1.x * u2.x + u1.y * u2.y);   // 0 = dritto, π = inversione
    if (svolta < 1e-3 || raggio <= 0) { d += ` L ${fmt(b.x)} ${fmt(b.y)}`; continue; }
    const t = Math.tan(svolta / 2);
    const tratto = Math.min(raggio * t, i === 1 ? l1 : l1 / 2, i === p.length - 2 ? l2 : l2 / 2);
    const r = tratto / t;
    const p1 = { x: b.x - u1.x * tratto, y: b.y - u1.y * tratto };
    const p2 = { x: b.x + u2.x * tratto, y: b.y + u2.y * tratto };
    d += ` L ${fmt(p1.x)} ${fmt(p1.y)} A ${fmt(r)} ${fmt(r)} 0 0 ${croce > 0 ? 1 : 0} ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  const z = p.at(-1);
  return `${d} L ${fmt(z.x)} ${fmt(z.y)}`;
}

// Raggio effettivo in uno spigolo (per le prove e per l'esportazione).
export function raggioNelloSpigolo(a, b, c, raggio, primo = false, ultimo = false) {
  const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
  const u1 = { x: (b.x - a.x) / l1, y: (b.y - a.y) / l1 };
  const u2 = { x: (c.x - b.x) / l2, y: (c.y - b.y) / l2 };
  const svolta = Math.atan2(Math.abs(u1.x * u2.y - u1.y * u2.x), u1.x * u2.x + u1.y * u2.y);
  if (svolta < 1e-3) return 0;
  const t = Math.tan(svolta / 2);
  return Math.min(raggio * t, primo ? l1 : l1 / 2, ultimo ? l2 : l2 / 2) / t;
}

// Punto più vicino a q su un segmento, e distanza (per selezionare e per il «+» a metà).
export function distanzaDaSegmento(q, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0;
  const p = { x: a.x + t * dx, y: a.y + t * dy };
  return { punto: p, distanza: Math.hypot(q.x - p.x, q.y - p.y), t };
}

// Fasce: una per generazione familiare, dall'ingombro reale dei membri più un margine.
// Le fasce contigue si toccano, come nel disegno di partenza; la colonna delle etichette
// sta a sinistra di tutto.
export function fasce(generazione, posizioni) {
  const perGen = new Map();
  let minX = Infinity, maxX = -Infinity;
  for (const [id, pos] of Object.entries(posizioni)) {
    const g = generazione[id];
    if (g === undefined) continue;
    if (!perGen.has(g)) perGen.set(g, { cima: Infinity, fondo: -Infinity });
    const f = perGen.get(g);
    f.cima = Math.min(f.cima, cimaDi(pos) - MARGINE_FASCIA);
    f.fondo = Math.max(f.fondo, fondoDi(pos) + MARGINE_FASCIA);
    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x + W);
  }
  const ordinate = [...perGen.keys()].sort((a, b) => a - b);
  const sinistra = minX - LARGH_ETICHETTA - 40, destra = maxX + 50;
  return ordinate.map((g, i) => {
    const f = perGen.get(g);
    const dopo = perGen.get(ordinate[i + 1]);
    const fondo = dopo && dopo.cima >= f.fondo ? dopo.cima : f.fondo;
    return { g, x: sinistra, y: f.cima, larghezza: destra - sinistra, altezza: fondo - f.cima,
      etichettaY: (f.cima + f.fondo) / 2 };
  });
}

// ------------------------------------------------------------ posto per una persona nuova

function libero(occupati, x, y) {
  return occupati.every(o => x + W + 10 <= o.x || o.x + W + 10 <= x || y + H + 10 <= o.y || o.y + H + 10 <= y);
}

// Il posto libero più vicino a (x, y) sulla stessa riga, provando a destra e a sinistra.
export function postoLibero(occupati, x, y, preferenza = "destra") {
  const passo = W + GAP_FRATELLI;
  if (libero(occupati, x, y)) return { x, y };
  for (let k = 1; k < 200; k++) {
    const tentativi = preferenza === "destra" ? [x + k * passo, x - k * passo] : [x - k * passo, x + k * passo];
    for (const tx of tentativi) if (libero(occupati, tx, y)) return { x: tx, y };
  }
  return { x: x + 200 * passo, y };
}

// relazione: {tipo: "partner", di} | {tipo: "figlio", unione} | {tipo: "genitore", di, lato: 0|1} | {tipo: "libera"}
export function collocaNuova(posizioni, unioniPerId, relazione) {
  const occupati = Object.values(posizioni);
  const sopra = p => posizioni[p];
  if (relazione.tipo === "partner" && sopra(relazione.di)) {
    const d = sopra(relazione.di);
    const x = d.x + W + GAP_COPPIA;
    if (libero(occupati, x, d.y)) return { x, y: d.y };
    const xs = d.x - W - GAP_COPPIA;
    if (libero(occupati, xs, d.y)) return { x: xs, y: d.y };
    return postoLibero(occupati, x, d.y);
  }
  if (relazione.tipo === "figlio") {
    const u = unioniPerId.get(relazione.unione);
    const gen = u.partner.map(sopra).filter(Boolean);
    const y = (gen.length ? Math.max(...gen.map(p => p.y)) : 230) + PASSO;
    const fratelli = u.figli.map(sopra).filter(Boolean);
    const x = fratelli.length ? Math.max(...fratelli.map(p => p.x)) + W + GAP_FRATELLI
      : (gen.length ? gen.reduce((s, p) => s + p.x, 0) / gen.length : 250);
    return postoLibero(occupati, x, fratelli.length ? Math.max(...fratelli.map(p => p.y)) : y);
  }
  if (relazione.tipo === "genitore" && sopra(relazione.di)) {
    const d = sopra(relazione.di);
    const cx = d.x + W / 2;
    const x = relazione.lato ? cx + GAP_COPPIA / 2 : cx - W - GAP_COPPIA / 2;
    return postoLibero(occupati, x, d.y - PASSO, relazione.lato ? "destra" : "sinistra");
  }
  const maxX = occupati.length ? Math.max(...occupati.map(p => p.x)) : 0;
  const minY = occupati.length ? Math.min(...occupati.map(p => p.y)) : 230;
  return postoLibero(occupati, maxX + W + 80, minY);
}
