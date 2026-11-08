// La scena: tutto quello che si disegna (fasce, nodi, unioni, archi con i loro punti),
// calcolato dai dati e dalla disposizione salvata. La vista, l'SVG esportato e il draw.io
// partono tutti da qui, così mostrano la stessa cosa. Modulo puro.
import { GEOMETRIA, impagina, generazioni } from "./layout.js";
import { ingressoLayout, etichetteFasce, annoDi, statoInVita } from "./deduzioni.js";
import { indici, ceppoDi, ignoto } from "./grafo.js";
import { posizioneUnione, scartiBarre, altezzaBarra, percorsoPartner, percorsoFiglio, fasce } from "./geometria.js";

const { W, H } = GEOMETRIA;
export const NEUTRO = { riempimento: "#ffffff", bordo: "#666666" };
export const RAGGIO_PREDEFINITO = 12;

export const idArcoPartner = (persona, unione) => `${persona}|${unione}`;
export const idArcoFiglio = (unione, figlio) => `${unione}>${figlio}`;

const annoTesto = d => (d?.data ? `${d.circa ? "c. " : ""}${annoDi(d.data)}` : "");

// Le righe di testo di un riquadro: nome (con soprannome e †), cognome, anni.
export function etichetta(p, oggi = new Date()) {
  if (p.segnaposto) return { righe: [[{ testo: p.nome || "non noti", corsivo: true }]], ignoto: true };
  if (!p.nome && !p.cognome) return { righe: [[{ testo: "non noto", corsivo: true }]], ignoto: true };
  const morto = statoInVita(p, oggi) === "no";
  const prima = [{ testo: p.nome || "?", grassetto: true, grigio: !p.nome }];
  if (p.soprannome) prima.push({ testo: ` «${p.soprannome}»` });
  if (morto) prima.push({ testo: " †" });
  const righe = [prima, [{ testo: p.cognome || "?", grigio: !p.cognome }]];
  const n = annoTesto(p.nascita), m = annoTesto(p.morte);
  const anni = n && m ? `${n} – ${m}` : n ? `n. ${n}` : m ? `m. ${m}` : "";
  if (anni) righe.push([{ testo: anni, piccolo: true, grigio: true }]);
  return { righe, ignoto: false, morto };
}

// opzioni.posizioni: posizioni provvisorie (trascinamento, «Ricompatta») per persone e unioni.
// opzioni.archi: vertici provvisori degli archi.
export function componiScena(albero, opzioni = {}) {
  const oggi = opzioni.oggi || new Date();
  const ix = indici(albero);
  const ingresso = ingressoLayout(albero);
  const { gen } = generazioni(ingresso);
  const generazione = Object.fromEntries(gen);
  // soloAutomatico («Ricompatta»): posizioni provvisorie per le persone, il resto automatico
  const salvate = opzioni.soloAutomatico ? {} : albero.disposizione?.nodi || {};
  const provvisorie = opzioni.posizioni || {};
  const archiSalvati = opzioni.soloAutomatico ? {} : albero.disposizione?.archi || {};
  const archiProvvisori = opzioni.archi || {};

  // chi non ha ancora una posizione la prende dall'impaginazione automatica
  let automatiche = null;
  const posPersona = id => {
    const p = provvisorie[id] || salvate[id];
    if (p) return p;
    automatiche = automatiche || impagina(ingresso).persone;
    return automatiche[id] || { x: 0, y: 0 };
  };

  const nodi = albero.persone.map(p => {
    const pos = posPersona(p.id);
    const c = ceppoDi(ix, p) || NEUTRO;
    const e = etichetta(p, oggi);
    return {
      id: p.id, x: pos.x, y: pos.y, w: W, h: H,
      riempimento: e.ignoto ? "#ffffff" : c.riempimento,
      bordo: e.ignoto ? "#999999" : c.bordo,
      tratteggiato: e.ignoto, righe: e.righe, morto: !!e.morto,
      ceppo: ix.ceppi.has(p.cognome) ? p.cognome : null, generazione: generazione[p.id],
    };
  });
  const posizioni = Object.fromEntries(nodi.map(n => [n.id, { x: n.x, y: n.y }]));
  const sopra = id => posizioni[id];

  const nodiUnione = {};
  for (const u of albero.unioni) {
    const sovrascritta = provvisorie[u.id] || salvate[u.id];
    nodiUnione[u.id] = sovrascritta || posizioneUnione(u, {}, sopra);
  }
  const unioni = albero.unioni.map(u => ({ id: u.id, ...nodiUnione[u.id], ipotesi: u.stato === "ipotesi", spostata: !!salvate[u.id] }));

  const scarti = scartiBarre(albero.unioni, generazione, sopra);
  const archi = [];
  for (const u of albero.unioni) {
    const pu = nodiUnione[u.id];
    const tratteggiato = u.stato === "ipotesi";
    for (const p of u.partner) {
      const id = idArcoPartner(p, u.id);
      const punti = archiProvvisori[id]?.punti || archiSalvati[id]?.punti || [];
      archi.push({ id, tipo: "partner", unione: u.id, persona: p, tratteggiato, automatico: !punti.length,
        punti: percorsoPartner(sopra(p), pu, punti) });
    }
    if (u.figli.length) {
      const yBarra = altezzaBarra(u, sopra, scarti[u.id] || 0);
      for (const f of u.figli) {
        const id = idArcoFiglio(u.id, f);
        const punti = archiProvvisori[id]?.punti || archiSalvati[id]?.punti || null;
        archi.push({ id, tipo: "figlio", unione: u.id, persona: f, tratteggiato, automatico: !punti?.length,
          punti: percorsoFiglio(pu, sopra(f), yBarra, punti) });
      }
    }
  }

  const etichette = etichetteFasce(albero, generazione);
  const strisce = fasce(generazione, posizioni).map(f => ({ ...f, ...etichette[f.g] }));

  const tutti = [...strisce.map(f => [f.x, f.y, f.x + f.larghezza, f.y + f.altezza]),
    ...nodi.map(n => [n.x, n.y, n.x + W, n.y + H]),
    ...archi.flatMap(a => a.punti.map(q => [q.x, q.y, q.x, q.y]))];
  const bbox = tutti.length
    ? { x: Math.min(...tutti.map(t => t[0])), y: Math.min(...tutti.map(t => t[1])),
        x2: Math.max(...tutti.map(t => t[2])), y2: Math.max(...tutti.map(t => t[3])) }
    : { x: 0, y: 0, x2: 1000, y2: 600 };

  return {
    nodi, unioni, archi, fasce: strisce, generazione, ix, bbox,
    raggio: albero.meta?.raggio ?? RAGGIO_PREDEFINITO,
    ceppi: albero.meta?.ceppi || [],
  };
}
