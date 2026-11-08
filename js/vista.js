// La vista: disegna la scena in SVG, gestisce spostamento e zoom (rotella, trackpad,
// due dita), riconosce che cosa c'è sotto il puntatore e passa i trascinamenti a chi
// li chiede (la modalità «Disposizione»). Solo browser.
import { strati, esc } from "./svg.js";

const NS = "http://www.w3.org/2000/svg";
const SOGLIA_CLIC = 5;           // pixel di movimento oltre i quali non è più un clic
const DOPPIO_CLIC_MS = 350;      // due clic sullo stesso oggetto entro questo tempo

export function creaVista(svg, gestori = {}) {
  const mondo = document.createElementNS(NS, "g");
  mondo.setAttribute("id", "mondo");
  const strato = {};
  for (const nome of ["fasce", "archi", "unioni", "nodi", "postit", "onde", "guide", "maniglie"]) {
    strato[nome] = document.createElementNS(NS, "g");
    strato[nome].setAttribute("class", `strato-${nome}`);
    mondo.append(strato[nome]);
  }
  svg.append(mondo);

  // intestazioni delle generazioni: fisse sul margine sinistro a ogni zoom, seguono solo in verticale
  const testate = document.createElement("div");
  testate.className = "testate";
  testate.setAttribute("aria-hidden", "true");
  svg.after(testate);
  let righeTestate = [];

  let t = { x: 0, y: 0, k: 1 };
  let scena = null;
  const elementi = { persona: new Map(), unione: new Map(), arco: new Map(), postit: new Map() };
  let conteggiPostit = new Map();     // id della persona o dell'unione -> quanti post-it

  function posizionaTestate() {
    for (const { el, f } of righeTestate) {
      const alto = f.altezza * t.k;
      el.style.transform = `translateY(${t.y + f.y * t.k}px)`;
      el.style.height = `${alto}px`;
      el.dataset.righe = alto < 34 ? 1 : alto < 58 ? 2 : 3;
    }
  }

  const applica = () => {
    mondo.setAttribute("transform", `translate(${t.x} ${t.y}) scale(${t.k})`);
    svg.style.setProperty("--k", t.k);       // per gli effetti che restano della stessa misura sullo schermo
    posizionaTestate();
  };
  const limitaK = k => Math.max(0.08, Math.min(4, k));

  function daSchermo(cx, cy) {
    const r = svg.getBoundingClientRect();
    return { x: (cx - r.left - t.x) / t.k, y: (cy - r.top - t.y) / t.k };
  }

  function zoomIn(punto, fattore) {
    const r = svg.getBoundingClientRect();
    const sx = punto ? punto.x - r.left : r.width / 2, sy = punto ? punto.y - r.top : r.height / 2;
    const k = limitaK(t.k * fattore);
    t = { x: sx - (sx - t.x) * (k / t.k), y: sy - (sy - t.y) * (k / t.k), k };
    applica();
    gestori.suZoom?.(t.k);
  }

  let animazione = null;
  function animaVerso(dest, durata = 320) {
    cancelAnimationFrame(animazione);
    const da = { ...t }, inizio = performance.now();
    const passo = ora => {
      const f = Math.min(1, (ora - inizio) / durata), e = 1 - Math.pow(1 - f, 3);
      t = { x: da.x + (dest.x - da.x) * e, y: da.y + (dest.y - da.y) * e, k: da.k + (dest.k - da.k) * e };
      applica();
      if (f < 1) animazione = requestAnimationFrame(passo); else gestori.suZoom?.(t.k);
    };
    animazione = requestAnimationFrame(passo);
  }

  // sinistra, destra e basso: pixel coperti da intestazioni e pannello, da lasciare fuori dall'inquadratura
  function inquadra(box, { margine = 28, animato = true, kMax = 1.2, sinistra = 0, destra = 0, basso = 0 } = {}) {
    const r = svg.getBoundingClientRect();
    const lw = Math.max(80, r.width - sinistra - destra), lh = Math.max(80, r.height - basso);
    const w = Math.max(1, box.x2 - box.x), h = Math.max(1, box.y2 - box.y);
    const k = limitaK(Math.min((lw - 2 * margine) / w, (lh - 2 * margine) / h, kMax));
    const dest = { k, x: sinistra + (lw - w * k) / 2 - box.x * k, y: (lh - h * k) / 2 - box.y * k };
    if (animato) animaVerso(dest); else { t = dest; applica(); gestori.suZoom?.(t.k); }
  }

  function centraSu(x, y, { k = t.k, sinistra = 0, destra = 0, basso = 0 } = {}) {
    const r = svg.getBoundingClientRect();
    animaVerso({ k, x: sinistra + (r.width - sinistra - destra) / 2 - x * k, y: (r.height - basso) / 2 - y * k });
  }

  // Increspature: due cerchi tenui per risultato che si allargano e svaniscono, come una goccia
  // sull'acqua. Le misure sono in pixel dello schermo, ricalcolate a ogni fotogramma, così
  // si vedono a ogni zoom anche mentre la vista si sta ancora muovendo.
  let onde = [], fotogrammaOnde = null;
  const DURATA_ONDA = 1400, ALLARGAMENTO = 40;
  function increspa(ids) {
    if (!scena) return;
    for (const o of onde) o.c.remove();
    onde = [];
    const ora = performance.now();
    scena.nodi.filter(n => ids.has(n.id)).forEach((n, i) => {
      const ritardo = Math.min(i * 45, 450) + Math.random() * 120;
      for (let j = 0; j < 2; j++) {
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("class", "onda");
        c.setAttribute("cx", n.x + n.w / 2);
        c.setAttribute("cy", n.cima + n.h / 2);
        c.setAttribute("opacity", 0);
        strato.onde.append(c);
        onde.push({ c, inizio: ora + ritardo + j * 320, mezzo: n.w / 2 });
      }
    });
    if (!fotogrammaOnde) fotogrammaOnde = requestAnimationFrame(animaOnde);
  }
  function animaOnde(ora) {
    onde = onde.filter(o => {
      const f = (ora - o.inizio) / DURATA_ONDA;
      if (f < 0) return true;
      if (f >= 1) { o.c.remove(); return false; }
      const r0 = Math.max(8, o.mezzo * t.k * 0.9), e = 1 - (1 - f) * (1 - f);
      o.c.setAttribute("r", (r0 + ALLARGAMENTO * e) / t.k);
      o.c.setAttribute("opacity", (1 - f) * 0.35);
      o.c.setAttribute("stroke-width", (1.4 * (1 - f) + 0.5) / t.k);
      return true;
    });
    fotogrammaOnde = onde.length ? requestAnimationFrame(animaOnde) : null;
  }

  function disegna(nuova) {
    scena = nuova;
    const s = strati(scena, { interattivo: true });
    strato.fasce.innerHTML = s.fasce;
    strato.archi.innerHTML = s.archi;
    strato.unioni.innerHTML = s.unioni;
    strato.nodi.innerHTML = s.nodi;
    for (const m of Object.values(elementi)) m.clear();
    for (const el of strato.nodi.querySelectorAll("[data-persona]")) elementi.persona.set(el.dataset.persona, el);
    for (const el of strato.unioni.querySelectorAll("[data-unione]")) elementi.unione.set(el.dataset.unione, el);
    for (const el of strato.archi.querySelectorAll("[data-arco]")) elementi.arco.set(el.dataset.arco, el);
    testate.innerHTML = scena.fasce.map(f => `<div class="testata" style="--sfondo:${esc(f.sfondo)}">`
      + `<span class="titolo">${esc(f.titolo)}</span>`
      + (f.anni ? `<span class="anni">${esc(f.anni)}</span>` : "")
      + (f.base ? `<span class="base${f.stima ? " stima" : ""}">${esc(f.base)}</span>` : "")
      + `</div>`).join("");
    righeTestate = [...testate.children].map((el, i) => ({ el, f: scena.fasce[i] }));
    posizionaTestate();
    disegnaPostit();
  }

  // Bollino giallo, un po' storto, sull'angolo in alto a destra del riquadro (o accanto al
  // nodo dell'unione), con il numero dei post-it.
  function disegnaPostit() {
    if (!scena) return;
    const posto = new Map([...scena.nodi.map(n => [n.id, { x: n.x + n.w - 13, y: n.cima - 11 }]),
      ...scena.unioni.map(u => [u.id, { x: u.x + 7, y: u.y - 24 }])]);
    strato.postit.innerHTML = [...conteggiPostit].filter(([id]) => posto.has(id)).map(([id, n]) => {
      const { x, y } = posto.get(id);
      return `<g class="postit" data-postit="${esc(id)}" transform="translate(${x} ${y}) rotate(7 11 10)">`
        + `<rect width="22" height="20" rx="2.5" fill="#ffe873" stroke="#d6b300" stroke-width="1"/>`
        + `<text x="11" y="14.5" text-anchor="middle" font-size="11.5" font-weight="700" fill="#5c4a00">${n}</text></g>`;
    }).join("");
    elementi.postit.clear();
    for (const el of strato.postit.querySelectorAll("[data-postit]")) elementi.postit.set(el.dataset.postit, el);
  }

  function postit(conteggi) {
    conteggiPostit = conteggi;
    disegnaPostit();
  }

  // classi: {selezionata, unioneSelezionata, arcoSelezionato, attenuati: Set, nascosti: Set, evidenziati: Set}
  function classi(c) {
    if (!scena) return;
    const att = c.attenuati || new Set(), nas = c.nascosti || new Set(), evi = c.evidenziati || new Set();
    const tro = c.trovati || new Set();
    for (const [id, el] of elementi.persona) {
      el.classList.toggle("selezionata", c.selezionata === id);
      el.classList.toggle("attenuato", att.has(id));
      el.classList.toggle("nascosto", nas.has(id));
      el.classList.toggle("evidenziato", evi.has(id));
      el.classList.toggle("trovato", tro.has(id));
    }
    const unione = new Map(scena.ix.unione);
    for (const [id, el] of elementi.unione) {
      const u = unione.get(id);
      el.classList.toggle("selezionata", c.unioneSelezionata === id);
      el.classList.toggle("nascosto", u.partner.every(p => nas.has(p)));
      el.classList.toggle("attenuato", u.partner.every(p => att.has(p) || nas.has(p)));
    }
    // i bollini seguono il riquadro a cui sono attaccati
    for (const [id, el] of elementi.postit) {
      const rif = elementi.persona.get(id) || elementi.unione.get(id);
      el.classList.toggle("nascosto", !!rif?.classList.contains("nascosto"));
      el.classList.toggle("attenuato", !!rif?.classList.contains("attenuato"));
    }
    for (const a of scena.archi) {
      const el = elementi.arco.get(a.id);
      const u = unione.get(a.unione);
      const fuori = s => s.has(a.persona) || (a.tipo === "figlio" && u.partner.every(p => s.has(p)));
      el.classList.toggle("selezionato", c.arcoSelezionato === a.id);
      el.classList.toggle("nascosto", fuori(nas));
      el.classList.toggle("attenuato", fuori(new Set([...att, ...nas])));
    }
  }

  function bersaglio(el) {
    const m = el?.closest?.("[data-maniglia]");
    if (m) return { tipo: "maniglia", maniglia: m.dataset.maniglia, indice: Number(m.dataset.indice), id: m.dataset.id };
    const pi = el?.closest?.("[data-postit]");
    if (pi) return { tipo: "postit", id: pi.dataset.postit };
    const p = el?.closest?.("[data-persona]:not([data-arco])");
    if (p && p.classList.contains("nodo")) return { tipo: "persona", id: p.dataset.persona };
    const u = el?.closest?.(".unione[data-unione]");
    if (u) return { tipo: "unione", id: u.dataset.unione };
    const a = el?.closest?.("[data-arco]");
    if (a) return { tipo: "arco", id: a.dataset.arco };
    return { tipo: "vuoto" };
  }

  // ------------------------------------------------------------ puntatori
  const puntatori = new Map();
  let gesto = null;     // {tipo: "sposta"|"pizzica"|"trascina", ...}

  // Trascinando vicino a un bordo la vista scorre piano, più veloce quanto più ci si avvicina;
  // i bordi sono quelli dell'area libera, al netto di intestazioni e pannello.
  const BORDO = 56, VELOCITA = 6;        // pixel dal bordo; pixel per fotogramma al massimo
  let scorrimento = null;
  function velocitaBordo(cx, cy) {
    const r = svg.getBoundingClientRect(), ris = gestori.riserva?.() || {};
    const v = d => (d < BORDO ? VELOCITA * Math.min(1, 1 - d / BORDO) : 0);
    return {
      vx: v(cx - r.left - (ris.sinistra || 0)) - v(r.right - (ris.destra || 0) - cx),
      vy: v(cy - r.top) - v(r.bottom - (ris.basso || 0) - cy),
    };
  }
  function passoScorrimento() {
    scorrimento = null;
    if (gesto?.tipo !== "trascina" || !gesto.mosso) return;
    const e = gesto.ultimo;
    let { vx, vy } = velocitaBordo(e.clientX, e.clientY);
    // un riquadro fermo sul confine della sua generazione: inutile scorrere oltre in quella direzione
    const blocco = gestori.versoBloccato?.() || 0;
    if ((blocco > 0 && vy < 0) || (blocco < 0 && vy > 0)) vy = 0;
    if (!vx && !vy) return;
    t = { ...t, x: t.x + vx, y: t.y + vy };
    applica();
    gestori.trascina?.("muovi", daSchermo(e.clientX, e.clientY), e, gesto.b);
    scorrimento = requestAnimationFrame(passoScorrimento);
  }

  // Un gesto rimasto aperto, perché il rilascio non è arrivato (per esempio uno screenshot
  // fatto trascinando), si chiude salvando quello che si vede, prima di cominciarne un altro.
  function chiudiInterrotto() {
    if (gesto?.tipo === "trascina" && gesto.mosso) gestori.trascina?.("fine", daSchermo(gesto.ultimo.clientX, gesto.ultimo.clientY), gesto.ultimo, gesto.b);
    cancelAnimationFrame(scorrimento); scorrimento = null;
    svg.classList.remove("in-movimento");
    gesto = null;
    puntatori.clear();
  }

  svg.addEventListener("pointerdown", e => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (puntatori.has(e.pointerId) || (e.pointerType === "mouse" && [...puntatori.values()].some(p => p.mouse))) chiudiInterrotto();
    svg.setPointerCapture(e.pointerId);
    puntatori.set(e.pointerId, { x: e.clientX, y: e.clientY, mouse: e.pointerType === "mouse" });
    if (puntatori.size === 2) {
      if (gesto?.tipo === "trascina") gestori.trascina?.("annulla", null, e);
      const [a, b] = [...puntatori.values()];
      gesto = { tipo: "pizzica", d: Math.hypot(a.x - b.x, a.y - b.y), c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return;
    }
    const b = bersaglio(e.target);
    const mondoPunto = daSchermo(e.clientX, e.clientY);
    if (gestori.prendi?.(b, mondoPunto, e)) {
      gesto = { tipo: "trascina", b, inizio: { x: e.clientX, y: e.clientY }, mosso: false };
    } else {
      gesto = { tipo: "sposta", b, inizio: { x: e.clientX, y: e.clientY }, t0: { ...t }, mosso: false };
    }
  });

  svg.addEventListener("pointermove", e => {
    if (!puntatori.has(e.pointerId)) return;
    puntatori.set(e.pointerId, { x: e.clientX, y: e.clientY, mouse: e.pointerType === "mouse" });
    if (!gesto) return;
    if (gesto.tipo === "pizzica" && puntatori.size === 2) {
      const [a, b] = [...puntatori.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      zoomIn(c, d / gesto.d);
      t = { ...t, x: t.x + c.x - gesto.c.x, y: t.y + c.y - gesto.c.y };
      applica();
      gesto.d = d; gesto.c = c;
      return;
    }
    const dx = e.clientX - gesto.inizio.x, dy = e.clientY - gesto.inizio.y;
    if (!gesto.mosso && Math.hypot(dx, dy) < SOGLIA_CLIC) return;
    if (gesto.tipo === "sposta") {
      if (!gesto.mosso) svg.classList.add("in-movimento");
      gesto.mosso = true;
      t = { ...t, x: gesto.t0.x + dx, y: gesto.t0.y + dy };
      applica();
    } else if (gesto.tipo === "trascina") {
      if (!gesto.mosso) gestori.trascina?.("inizio", daSchermo(gesto.inizio.x, gesto.inizio.y), e, gesto.b);
      gesto.mosso = true;
      gesto.ultimo = e;
      gestori.trascina?.("muovi", daSchermo(e.clientX, e.clientY), e, gesto.b);
      if (!scorrimento) scorrimento = requestAnimationFrame(passoScorrimento);
    }
  });

  // Il doppio clic si riconosce qui e non con l'evento dblclick: con la cattura del puntatore
  // il browser lo manda alla tela invece che al vertice, e sul telefono non arriva affatto.
  const chiave = b => `${b.tipo}|${b.id ?? ""}|${b.maniglia ?? ""}|${b.indice ?? ""}`;
  let ultimoClic = null;

  function clicOdoppio(b, e) {
    const ora = performance.now(), m = daSchermo(e.clientX, e.clientY);
    const u = ultimoClic;
    if (u && u.chiave === chiave(b) && ora - u.ora < DOPPIO_CLIC_MS && Math.hypot(e.clientX - u.x, e.clientY - u.y) < 12) {
      ultimoClic = null;
      if (!gestori.doppioClic?.(b, m, e) && b.tipo === "vuoto") zoomIn({ x: e.clientX, y: e.clientY }, 1.6);
      return;
    }
    ultimoClic = { chiave: chiave(b), ora, x: e.clientX, y: e.clientY };
    gestori.clic?.(b, m, e);
  }

  function fine(e) {
    if (!puntatori.has(e.pointerId)) return;
    puntatori.delete(e.pointerId);
    cancelAnimationFrame(scorrimento); scorrimento = null;
    if (!gesto) return;
    if (gesto.tipo === "pizzica") { if (puntatori.size === 0) gesto = null; return; }
    if (gesto.tipo === "trascina" && gesto.mosso) {
      const ultimo = e.type === "pointerup" ? e : gesto.ultimo;      // dopo un annullamento le coordinate possono mancare
      gestori.trascina?.("fine", daSchermo(ultimo.clientX, ultimo.clientY), ultimo, gesto.b);
    } else if (!gesto.mosso && e.type === "pointerup") clicOdoppio(gesto.b, e);
    svg.classList.remove("in-movimento");
    gesto = null;
  }
  svg.addEventListener("pointerup", fine);
  svg.addEventListener("pointercancel", fine);
  // se il browser toglie la cattura senza un rilascio (finestra che perde il puntatore), si chiude lo stesso
  svg.addEventListener("lostpointercapture", fine);

  svg.addEventListener("wheel", e => {
    e.preventDefault();
    const rotella = e.deltaMode === 1 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);
    if (e.ctrlKey || e.metaKey || rotella) {
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomIn({ x: e.clientX, y: e.clientY }, Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0022)));
    } else {
      t = { ...t, x: t.x - e.deltaX, y: t.y - e.deltaY };
      applica();
    }
  }, { passive: false });

  applica();
  return {
    disegna, classi, inquadra, centraSu, daSchermo, increspa, postit,
    zoom: f => zoomIn(null, f),
    scala: () => t.k,
    larghezzaTestate: () => (righeTestate.length ? testate.offsetWidth : 0),
    strato,
    elemento: (tipo, id) => elementi[tipo].get(id),
  };
}
