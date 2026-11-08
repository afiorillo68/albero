// Modalità «Disposizione» (solo con il link di modifica): spostare persone e nodi delle
// unioni, aggiungere, spostare e togliere vertici degli archi, griglia e guide di
// allineamento, annulla e ripeti, ridisposizione automatica. Solo browser.
import { GEOMETRIA, impagina } from "./layout.js";
import { ingressoLayout } from "./deduzioni.js";
import { discendenti, nomeCompleto } from "./grafo.js";

const { W, H } = GEOMETRIA;
const NS = "http://www.w3.org/2000/svg";
const PASSO_GRIGLIA = 10;
const SOGLIA_GUIDA = 6;          // pixel sullo schermo

export function creaDisposizione(ctx) {
  let attivo = false;
  const opzioni = { griglia: true, guide: true };
  let arcoSel = null, unioneSel = null;
  let trascinamento = null;
  const annullabili = [], ripetibili = [];
  let fotogramma = null;

  const tocco = () => matchMedia("(pointer: coarse)").matches;
  const aggancia = v => (opzioni.griglia ? Math.round(v / PASSO_GRIGLIA) * PASSO_GRIGLIA : v);
  const prov = () => ctx.provvisorie();

  function ridisegnaPresto() {
    if (fotogramma) return;
    fotogramma = requestAnimationFrame(() => { fotogramma = null; ctx.ridisegna(); });
  }

  // ------------------------------------------------------------ maniglie e guide
  function disegnaManiglie() {
    const strato = ctx.vista.strato.maniglie;
    strato.innerHTML = "";
    if (!attivo) return;
    const k = ctx.vista.scala();
    const r = (tocco() ? 11 : 6) / k;
    let html = "";
    if (unioneSel) {
      const u = ctx.scena().unioni.find(x => x.id === unioneSel);
      if (u) html += `<circle class="anello-unione" cx="${u.x}" cy="${u.y}" r="${12 / k}" fill="none"/>`;
    }
    const a = arcoSel && ctx.scena().archi.find(x => x.id === arcoSel);
    if (a) {
      const p = a.punti;
      for (let j = 0; j < p.length - 1; j++) {
        const m = { x: (p[j].x + p[j + 1].x) / 2, y: (p[j].y + p[j + 1].y) / 2 };
        if (Math.hypot(p[j + 1].x - p[j].x, p[j + 1].y - p[j].y) * k < 24) continue;
        html += `<g class="maniglia aggiungi" data-maniglia="aggiungi" data-indice="${j}" data-id="${arcoSel}">`
          + `<circle cx="${m.x}" cy="${m.y}" r="${r * 0.85}"/>`
          + `<path d="M ${m.x - r * 0.45} ${m.y} H ${m.x + r * 0.45} M ${m.x} ${m.y - r * 0.45} V ${m.y + r * 0.45}"/></g>`;
      }
      p.slice(1, -1).forEach((q, i) => {
        html += `<circle class="maniglia vertice${a.automatico ? " automatica" : ""}" data-maniglia="vertice" data-indice="${i}" data-id="${arcoSel}" cx="${q.x}" cy="${q.y}" r="${r}"/>`;
      });
    }
    strato.innerHTML = html;
  }

  function disegnaGuide(linee) {
    const strato = ctx.vista.strato.guide;
    const b = ctx.scena().bbox;
    strato.innerHTML = linee.map(l => (l.x !== undefined
      ? `<line x1="${l.x}" y1="${b.y}" x2="${l.x}" y2="${b.y2}"/>`
      : `<line x1="${b.x}" y1="${l.y}" x2="${b.x2}" y2="${l.y}"/>`)).join("");
  }

  // ------------------------------------------------------------ salvataggio e annulla
  async function registra(campi, descrizione, { daAnnullare = true } = {}) {
    const disp = ctx.albero().disposizione || { nodi: {}, archi: {} };
    const completi = campi.map(c => ({ ...c, prima: disp[c.sezione]?.[c.id] ?? null }))
      .filter(c => JSON.stringify(c.prima) !== JSON.stringify(c.dopo));
    if (!completi.length) { pulisci(); return; }
    if (daAnnullare) { annullabili.push({ campi: completi, descrizione }); ripetibili.length = 0; }
    ctx.pulisciProvvisorieAlProssimoAggiornamento();
    try {
      await ctx.salva({ disposizione: completi.map(({ sezione, id, dopo }) => ({ sezione, id, dopo })), descrizione });
    } catch (err) { pulisci(); ctx.errore(err); }
    ctx.aggiornaAttrezzi();
  }

  function pulisci() {
    prov().posizioni = {};
    prov().archi = {};
    disegnaGuide([]);
    ctx.ridisegna();
  }

  async function annulla() {
    const op = annullabili.pop();
    if (!op) return;
    ripetibili.push(op);
    await registra(op.campi.map(c => ({ sezione: c.sezione, id: c.id, dopo: c.prima })), `Annullato: ${op.descrizione}`, { daAnnullare: false });
  }

  async function ripeti() {
    const op = ripetibili.pop();
    if (!op) return;
    annullabili.push(op);
    await registra(op.campi.map(c => ({ sezione: c.sezione, id: c.id, dopo: c.dopo })), op.descrizione, { daAnnullare: false });
  }

  // ------------------------------------------------------------ trascinamento
  function prendi(b) {
    if (!attivo) return false;
    return b.tipo === "persona" || b.tipo === "unione" || b.tipo === "maniglia";
  }

  function iniziaNodi(b, inizio, e) {
    const scena = ctx.scena();
    const ids = [b.id];
    if (b.tipo === "persona" && e.altKey) ids.push(...discendenti(scena.ix, b.id));
    const dentro = new Set(ids);
    const origini = new Map();
    for (const n of scena.nodi) if (dentro.has(n.id)) origini.set(n.id, { x: n.x, y: n.y, unione: false });
    const salvate = ctx.albero().disposizione?.nodi || {};
    for (const u of scena.unioni) {
      const un = scena.ix.unione.get(u.id);
      const trascinata = b.tipo === "unione" && b.id === u.id;
      if (trascinata || (salvate[u.id] && un.partner.every(p => dentro.has(p)))) origini.set(u.id, { x: u.x, y: u.y, unione: true });
    }
    const altri = scena.nodi.filter(n => !dentro.has(n.id));
    trascinamento = { tipo: "nodi", ancora: b.id, unione: b.tipo === "unione", origini, inizio, altri, descr: b.tipo === "unione" ? "Spostato il nodo di un'unione"
      : ids.length > 1 ? `Spostati ${nomeCompleto(scena.ix.persona.get(b.id))} e i discendenti` : `Spostata ${nomeCompleto(scena.ix.persona.get(b.id))}` };
  }

  function muoviNodi(m, e) {
    const t = trascinamento;
    let dx = m.x - t.inizio.x, dy = m.y - t.inizio.y;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    const o = t.origini.get(t.ancora);
    let x = o.x + dx, y = o.y + dy;
    const linee = [];
    // guide: bordi e centri allineati con le altre persone
    if (opzioni.guide && !t.unione) {
      const soglia = SOGLIA_GUIDA / ctx.vista.scala();
      let migliorX = null, migliorY = null;
      for (const n of t.altri) {
        for (const [mio, suo] of [[x, n.x], [x + W / 2, n.x + W / 2], [x + W, n.x + W]]) {
          const d = suo - mio;
          if (Math.abs(d) < soglia && (!migliorX || Math.abs(d) < Math.abs(migliorX.d))) migliorX = { d, linea: suo };
        }
        for (const [mio, suo] of [[y, n.y], [y + H / 2, n.y + H / 2]]) {
          const d = suo - mio;
          if (Math.abs(d) < soglia && (!migliorY || Math.abs(d) < Math.abs(migliorY.d))) migliorY = { d, linea: suo };
        }
      }
      if (migliorX && !(e.shiftKey && dx === 0)) { x += migliorX.d; linee.push({ x: migliorX.linea }); } else x = aggancia(x);
      if (migliorY && !(e.shiftKey && dy === 0)) { y += migliorY.d; linee.push({ y: migliorY.linea }); } else y = aggancia(y);
    } else if (!t.unione) { x = aggancia(x); y = aggancia(y); }
    if (e.shiftKey) { if (dx === 0) x = o.x; if (dy === 0) y = o.y; }
    dx = x - o.x; dy = y - o.y;
    for (const [id, p] of t.origini) prov().posizioni[id] = { x: p.x + dx, y: p.y + dy };
    t.mosso = { dx, dy };
    disegnaGuide(linee);
    ridisegnaPresto();
  }

  function fineNodi() {
    const t = trascinamento;
    const campi = [...t.origini.keys()].map(id => {
      const p = prov().posizioni[id];
      return { sezione: "nodi", id, dopo: { x: Math.round(p.x), y: Math.round(p.y) } };
    });
    disegnaGuide([]);
    registra(campi, t.descr);
  }

  function iniziaVertice(b, m) {
    const a = ctx.scena().archi.find(x => x.id === b.id);
    if (!a) return;
    const interni = a.punti.slice(1, -1).map(q => ({ x: q.x, y: q.y }));
    let indice = b.indice;
    if (b.maniglia === "aggiungi") { interni.splice(b.indice, 0, { x: m.x, y: m.y }); indice = b.indice; }
    trascinamento = { tipo: "vertice", arco: b.id, interni, indice, estremi: [a.punti[0], a.punti.at(-1)],
      descr: b.maniglia === "aggiungi" ? "Aggiunto un vertice a un arco" : "Spostato un vertice di un arco" };
  }

  function muoviVertice(m, e) {
    const t = trascinamento;
    const pieni = [t.estremi[0], ...t.interni, t.estremi[1]];
    const prima = pieni[t.indice], dopo = pieni[t.indice + 2];
    let x = m.x, y = m.y;
    const soglia = SOGLIA_GUIDA / ctx.vista.scala();
    const vicino = (v, candidati) => candidati.reduce((b, c) => (Math.abs(c - v) < Math.abs(b - v) ? c : b));
    if (e.shiftKey) { x = vicino(x, [prima.x, dopo.x]); y = vicino(y, [prima.y, dopo.y]); }
    else {
      const cx = vicino(x, [prima.x, dopo.x]), cy = vicino(y, [prima.y, dopo.y]);
      x = opzioni.guide && Math.abs(cx - x) < soglia ? cx : aggancia(x);
      y = opzioni.guide && Math.abs(cy - y) < soglia ? cy : aggancia(y);
    }
    t.interni[t.indice] = { x, y };
    prov().archi[t.arco] = { punti: t.interni.map(q => ({ x: q.x, y: q.y })) };
    t.mosso = true;
    ridisegnaPresto();
  }

  function trascina(fase, m, e, b) {
    if (fase === "inizio") {
      if (b.tipo === "maniglia") iniziaVertice(b, m);
      else iniziaNodi(b, m, e);
      return;
    }
    if (!trascinamento) return;
    if (fase === "annulla") { trascinamento = null; pulisci(); return; }
    if (fase === "muovi") (trascinamento.tipo === "nodi" ? muoviNodi : muoviVertice)(m, e);
    if (fase === "fine") {
      const t = trascinamento;
      trascinamento = null;
      if (t.tipo === "nodi" && t.mosso) fineNodi();
      if (t.tipo === "vertice" && t.mosso) {
        registra([{ sezione: "archi", id: t.arco, dopo: { punti: t.interni.map(q => ({ x: Math.round(q.x), y: Math.round(q.y) })) } }], t.descr);
      }
    }
  }

  function clic(b) {
    if (!attivo) return false;
    arcoSel = b.tipo === "arco" ? b.id : null;
    unioneSel = b.tipo === "unione" ? b.id : null;
    disegnaManiglie();
    ctx.aggiornaAttrezzi();
    return b.tipo === "arco" || b.tipo === "vuoto";
  }

  function doppioClic(b) {
    if (!attivo) return false;
    if (b.tipo === "maniglia" && b.maniglia === "vertice") {
      const a = ctx.scena().archi.find(x => x.id === b.id);
      const interni = a.punti.slice(1, -1).filter((_, i) => i !== b.indice).map(q => ({ x: Math.round(q.x), y: Math.round(q.y) }));
      registra([{ sezione: "archi", id: b.id, dopo: interni.length ? { punti: interni } : null }], "Tolto un vertice da un arco");
    }
    return b.tipo !== "vuoto";
  }

  // ------------------------------------------------------------ comandi della barra
  function raddrizza() {
    if (arcoSel) registra([{ sezione: "archi", id: arcoSel, dopo: null }], "Raddrizzato un arco");
  }

  function riallinea() {
    if (unioneSel) registra([{ sezione: "nodi", id: unioneSel, dopo: null }], "Riallineato il nodo di un'unione fra i partner");
  }

  async function ridisponi(sottoinsieme) {
    const albero = ctx.albero();
    const quanti = sottoinsieme ? sottoinsieme.size : albero.persone.length;
    const ok = await ctx.conferma(sottoinsieme
      ? `Ridispongo automaticamente le ${quanti} persone isolate? Gli spostamenti a mano su di loro e sui loro archi si perdono; il resto non cambia. Puoi annullare.`
      : "Ridispongo automaticamente tutto l'albero? Tutti gli spostamenti a mano si perdono. Puoi annullare, anche dallo storico.", "Ridisponi");
    if (!ok) return;
    const esito = impagina(ingressoLayout(albero, sottoinsieme ? [...sottoinsieme] : null));
    let dx = 0, dy = 0;
    if (sottoinsieme) {
      const ora = ctx.scena().nodi.filter(n => sottoinsieme.has(n.id));
      const nuove = Object.values(esito.persone);
      dx = Math.min(...ora.map(n => n.x)) - Math.min(...nuove.map(p => p.x));
      dy = Math.min(...ora.map(n => n.y)) - Math.min(...nuove.map(p => p.y));
    }
    const campi = Object.entries(esito.persone).map(([id, p]) => ({ sezione: "nodi", id, dopo: { x: Math.round(p.x + dx), y: Math.round(p.y + dy) } }));
    const disp = albero.disposizione || { nodi: {}, archi: {} };
    const dentro = id => !sottoinsieme || sottoinsieme.has(id);
    const ix = ctx.scena().ix;
    for (const u of albero.unioni) {
      if (!u.partner.every(dentro)) continue;
      if (disp.nodi[u.id]) campi.push({ sezione: "nodi", id: u.id, dopo: null });
    }
    for (const id of Object.keys(disp.archi || {})) {
      const [a, b] = id.includes(">") ? id.split(">") : id.split("|");
      const unione = ix.unione.get(id.includes(">") ? a : b);
      const persona = id.includes(">") ? b : a;
      if (dentro(persona) && (!unione || unione.partner.every(dentro))) campi.push({ sezione: "archi", id, dopo: null });
    }
    registra(campi, sottoinsieme ? `Ridisposte automaticamente ${quanti} persone` : "Ridisposto automaticamente tutto l'albero");
  }

  function attiva(si) {
    attivo = si;
    arcoSel = null; unioneSel = null;
    document.body.classList.toggle("in-disposizione", si);
    disegnaManiglie();
    disegnaGuide([]);
  }

  return {
    attiva, prendi, trascina, clic, doppioClic, disegnaManiglie, annulla, ripeti, raddrizza, riallinea, ridisponi,
    get attivo() { return attivo; },
    opzioni,
    stato: () => ({
      arcoManuale: !!(arcoSel && ctx.albero().disposizione?.archi?.[arcoSel]),
      arcoSel, unioneSpostata: !!(unioneSel && ctx.albero().disposizione?.nodi?.[unioneSel]),
      annullabile: annullabili.length > 0, ripetibile: ripetibili.length > 0,
    }),
  };
}
