// «Come siamo parenti?»: date due persone, il nome italiano della parentela nei due versi, il
// grado come lo conta il Codice civile, il percorso passo per passo e gli elementi del disegno
// da illuminare. Prima la parentela di sangue, poi l'affinità (il partner di un parente), poi
// qualunque legame che passa per più coppie. Modulo puro.
import { coniugeIn, nomeCompleto, ignoto, normalizza } from "./grafo.js";
import { idArcoPartner, idArcoFiglio } from "./scena.js";

// ------------------------------------------------------------ sesso e parole
// Il sesso spesso non è indicato: lo si deduce dalla desinenza del nome (-a, -o), con i pochi
// nomi maschili in -a; altrimenti le parole restano doppie («lo zio o la zia»). Niente elenchi
// di nomi: il codice è pubblico e non deve contenere quelli dell'albero.
const MASCHILI_IN_A = new Set("andrea luca nicola mattia elia enea tobia battista isaia geremia zaccaria giona gianluca".split(" "));

export function sessoDi(p) {
  if (p?.sesso === "M" || p?.sesso === "F") return p.sesso;
  if (!p || ignoto(p)) return null;
  const primo = normalizza(p.nome).split(/[\s-]+/)[0] || "";
  if (MASCHILI_IN_A.has(primo)) return "M";
  if (primo.length > 2 && primo.endsWith("a")) return "F";
  if (primo.length > 2 && primo.endsWith("o")) return "M";
  return null;
}

const P = (M, F = M) => ({ M, F });
// «e» davanti a una parola che comincia per e diventa «ed»
export const ed = parola => (/^e/i.test(parola) ? "ed" : "e");
const articolo = (w, s) => (s === "F" ? (/^[aeiouh]/i.test(w) ? "l'" : "la ")
  : /^[aeiouh]/i.test(w) ? "l'" : /^(z|gn|ps|pn|x|y|s[^aeiou])/i.test(w) ? "lo " : "il ");

// la parola accordata al sesso; senza sesso, le due forme (o una sola, senza articolo, se è la stessa)
function forma(c, s, conArticolo = true) {
  if (s) return conArticolo ? articolo(c[s], s) + c[s] : c[s];
  if (c.M === c.F) return c.M;
  return conArticolo ? `${articolo(c.M, "M")}${c.M} o ${articolo(c.F, "F")}${c.F}` : `${c.M} o ${c.F}`;
}

const ORDINALI = ["", "primo", "secondo", "terzo", "quarto", "quinto", "sesto", "settimo", "ottavo"];
const GENITORE = P("padre", "madre"), FIGLIO = P("figlio", "figlia"), PARTNER = P("partner");
const FRATELLO = P("fratello", "sorella");

function antenato(k) {
  return [null, GENITORE, P("nonno", "nonna"), P("bisnonno", "bisnonna"), P("trisnonno", "trisnonna")][k]
    || P(`antenato di ${k} generazioni prima`, `antenata di ${k} generazioni prima`);
}
function discendente(k) {
  return [null, FIGLIO, P("nipote"), P("pronipote")][k]
    || P(`discendente di ${k} generazioni dopo`);
}

// Parentela di sangue di chi sale di m generazioni fino all'antenato comune e ne scende n
// fino all'altro: la parola per il primo, o null se l'italiano non ne ha una corrente.
function sangue(m, n) {
  if (m === 0) return antenato(n);
  if (n === 0) return discendente(m);
  if (m === 1 && n === 1) return FRATELLO;
  if (m === 1 && n === 2) return P("zio", "zia");
  if (m === 1 && n === 3) return P("prozio", "prozia");
  if (m === 2 && n === 1) return P("nipote");
  if (m === 3 && n === 1) return P("pronipote");
  if (m === n) return m === 2 ? P("cugino", "cugina") : P(`cugino di ${ORDINALI[m - 1] || `${m - 1}°`} grado`, `cugina di ${ORDINALI[m - 1] || `${m - 1}°`} grado`);
  return null;
}

// Affinità: chi è il partner di un parente (lato «a»), o il parente del partner (lato «b»),
// con il parente che sale di m e scende di n. Le parole correnti; null dove si descrive.
function acquisito(lato, m, n) {
  const chiave = `${lato}${m},${n}`;
  return {
    "a1,0": P("genero", "nuora"), "b0,1": P("suocero", "suocera"),
    "a1,1": P("cognato", "cognata"), "b1,1": P("cognato", "cognata"),
    "a1,2": P("zio acquisito", "zia acquisita"), "b1,2": P("zio acquisito", "zia acquisita"),
    "a2,1": P("nipote acquisito", "nipote acquisita"), "b2,1": P("nipote acquisito", "nipote acquisita"),
    "a2,2": P("cugino acquisito", "cugina acquisita"), "b2,2": P("cugino acquisito", "cugina acquisita"),
    "a2,0": P("nipote acquisito", "nipote acquisita"), "b0,2": P("nonno acquisito", "nonna acquisita"),
  }[chiave] || null;
}

// ------------------------------------------------------------ il grafo
const genitoriDi = (ix, id) => ix.unione.get(ix.genitoriDi.get(id))?.partner.filter(p => ix.persona.has(p)) || [];

// Antenati con la distanza e il figlio da cui ci si arriva; la persona stessa a distanza 0.
function salita(ix, id) {
  const mappa = new Map([[id, { d: 0, da: null }]]), coda = [id];
  while (coda.length) {
    const q = coda.shift();
    for (const p of genitoriDi(ix, q)) if (!mappa.has(p)) { mappa.set(p, { d: mappa.get(q).d + 1, da: q }); coda.push(p); }
  }
  return mappa;
}
const discesa = (mappa, da) => { const out = []; for (let q = da; q; q = mappa.get(q).da) out.push(q); return out; };

// Il legame fra due persone vicine nel percorso: salita a un genitore, discesa a un figlio,
// coppia; con l'unione da cui passa.
function passo(ix, x, y) {
  const ux = ix.genitoriDi.get(x), uy = ix.genitoriDi.get(y);
  if (ux && ix.unione.get(ux).partner.includes(y)) return { verso: "su", unione: ux };
  if (uy && ix.unione.get(uy).partner.includes(x)) return { verso: "giu", unione: uy };
  const u = (ix.unioniDi.get(x) || []).find(uid => coniugeIn(ix.unione.get(uid), x) === y);
  return { verso: "partner", unione: u };
}

// Parentela di sangue: l'antenato comune più vicino (somma delle due distanze).
function parentelaDiSangue(ix, a, b) {
  const sa = salita(ix, a), sb = salita(ix, b);
  let meglio = null;
  for (const [id, x] of sa) {
    const y = sb.get(id);
    if (y && (!meglio || x.d + y.d < meglio.m + meglio.n)) meglio = { stipite: id, m: x.d, n: y.d };
  }
  if (!meglio) return null;
  const { stipite, m, n } = meglio;
  const seq = [...discesa(sa, stipite).reverse(), ...discesa(sb, stipite).slice(1)];
  // in cima al percorso: se i due rami scendono dalla stessa coppia, gli antenati comuni sono
  // tutti e due; se no, uno solo (fratelli per parte di padre o di madre)
  let stipiti = [stipite], coppia = null;
  if (m && n) {
    const ua = ix.genitoriDi.get(seq[m - 1]), ub = ix.genitoriDi.get(seq[m + 1]);
    if (ua && ua === ub) { coppia = ua; stipiti = genitoriDi(ix, seq[m - 1]); }
  }
  return { m, n, seq, stipite, stipiti, coppia };
}

// Il percorso più corto nel grafo, contando la coppia un po' più di un genitore: così si passa
// dal partner invece di scendere a un figlio e risalire all'altro genitore.
function percorsoQualsiasi(ix, a, b) {
  const dist = new Map([[a, 0]]), prima = new Map(), fatti = new Set();
  const vicini = q => {
    const out = genitoriDi(ix, q).map(p => [p, 1]);
    for (const uid of ix.unioniDi.get(q) || []) {
      const u = ix.unione.get(uid), c = coniugeIn(u, q);
      if (c) out.push([c, 1.5]);
      for (const f of u.figli) out.push([f, 1]);
    }
    return out.filter(([v]) => ix.persona.has(v));
  };
  for (;;) {
    let q = null, dq = Infinity;
    for (const [id, d] of dist) if (!fatti.has(id) && d < dq) { q = id; dq = d; }
    if (q === null) return null;
    if (q === b) break;
    fatti.add(q);
    for (const [v, w] of vicini(q)) if (dq + w < (dist.get(v) ?? Infinity)) { dist.set(v, dq + w); prima.set(v, q); }
  }
  const seq = [b];
  while (seq[0] !== a) seq.unshift(prima.get(seq[0]));
  return seq;
}

// ------------------------------------------------------------ il risultato
export function comeSiamoParenti(albero, a, b, ix) {
  const persona = id => ix.persona.get(id);
  const dubbi = new Set();
  const sx = id => { const s = sessoDi(persona(id)); if (!s) dubbi.add(id); return s; };
  const chi = id => {
    const p = persona(id);
    if (ignoto(p)) return "una persona non nota";
    return [p.nome, p.cognome].filter(x => x && x.trim() !== "?").join(" ") || nomeCompleto(p);
  };
  const maiuscola = t => t.charAt(0).toUpperCase() + t.slice(1);
  const frase = (x, c, y, dopo = "") => `${maiuscola(chi(x))} è ${forma(c, sx(x))}${dopo} di ${chi(y)}`;
  const linea = (m, n) => (m === 0 || n === 0 ? "in linea retta" : "in linea collaterale");

  // un tratto di sangue dentro un percorso: salite e poi discese
  const misura = seq => {
    let m = 0;
    while (m < seq.length - 1 && passo(ix, seq[m], seq[m + 1]).verso === "su") m++;
    return { m, n: seq.length - 1 - m };
  };
  // la parola di un tratto di sangue, con «per parte di…» per i fratelli di un genitore solo
  const parolaSangue = seq => {
    const { m, n } = misura(seq);
    if (m === 1 && n === 1 && ix.genitoriDi.get(seq[0]) !== ix.genitoriDi.get(seq[2])) {
      const s = sessoDi(persona(seq[1]));
      return { c: FRATELLO, dopo: ` per parte di ${s === "M" ? "padre" : s === "F" ? "madre" : chi(seq[1])}` };
    }
    return { c: sangue(m, n), dopo: "" };
  };
  // Il percorso a pezzi: una coppia, o un tratto di sangue con la sua parola. Un tratto senza
  // parola corrente si spezza su chi sta in mezzo, dove le parole ci sono (cugino, poi padre).
  const anelli = seq => {
    const out = [];
    const tratto = t => {
      const { m, n } = misura(t), w = parolaSangue(t);
      if (w.c) return out.push({ x: t[0], y: t.at(-1), ...w });
      const k = m < n ? 2 * m : m - n;
      tratto(t.slice(0, k + 1));
      tratto(t.slice(k));
    };
    let inizio = 0;
    for (let i = 0; i < seq.length - 1; i++) {
      if (passo(ix, seq[i], seq[i + 1]).verso !== "partner") continue;
      if (i > inizio) tratto(seq.slice(inizio, i + 1));
      out.push({ x: seq[i], y: seq[i + 1], c: PARTNER, dopo: "" });
      inizio = i + 1;
    }
    if (inizio < seq.length - 1) tratto(seq.slice(inizio));
    return out;
  };
  // raccontato, legato da «che è»
  const narra = seq => `${anelli(seq).map((t, i) => `${i ? "che è" : `${maiuscola(chi(t.x))} è`} ${forma(t.c, sx(t.x))}${t.dopo} di ${chi(t.y)}`).join(", ")}.`;

  // titolo: la risposta breve, quella che si legge sull'albero; frase e inversa nei due versi
  const esito = { a, b, tipo: null, titolo: "", frase: "", inversa: "", spiegazione: "", grado: "", stipiti: [], seq: null };

  const coppia = (ix.unioniDi.get(a) || []).some(uid => coniugeIn(ix.unione.get(uid), a) === b);
  const s = parentelaDiSangue(ix, a, b);
  if (coppia) {
    esito.tipo = "coppia";
    esito.frase = `${maiuscola(chi(a))} ${ed(chi(b))} ${chi(b)} sono una coppia.`;
    esito.seq = [a, b];
    if (s) {
      const c = sangue(s.m, s.n);
      esito.spiegazione = `Sono anche parenti: ${c ? frase(a, c, b) : `${chi(a)} ${ed(chi(b))} ${chi(b)} sono parenti di ${s.m + s.n}° grado`}.`;
    }
  } else if (s) {
    const { m, n, seq } = s;
    esito.tipo = "sangue";
    esito.seq = seq;
    const verso = (x, y, m, n, seq) => {
      const { c, dopo } = parolaSangue(seq);
      if (sangue(m, n)) return `${frase(x, c, y, dopo)}.`;
      // nessuna parola corrente: si passa da chi sta in mezzo
      if (m < n) { const z = seq[m * 2]; return `${frase(x, sangue(m, m), z)}, ${forma(antenato(n - m), sx(z), false)} di ${chi(y)}.`; }
      const z = seq[m - n];
      return `${frase(x, discendente(m - n), z)}, ${forma(sangue(n, n), sx(z), false)} di ${chi(y)}.`;
    };
    esito.frase = verso(a, b, m, n, seq);
    esito.inversa = verso(b, a, n, m, [...seq].reverse());
    // zii e nipoti: chi sta in mezzo toglie l'ambiguità di «nipote»
    if (m && n && m !== n && sangue(m, n)) {
      if (m < n) { const z = seq[m * 2]; esito.spiegazione = `${frase(a, sangue(m, m), z)}, ${forma(antenato(n - m), sx(z), false)} di ${chi(b)}.`; }
      else { const z = seq[m - n]; esito.spiegazione = `${frase(a, discendente(m - n), z)}, ${forma(sangue(n, n), sx(z), false)} di ${chi(b)}.`; }
    }
    const g = m + n;
    esito.grado = `Parenti ${linea(m, n)} di ${g}° grado${g > 6 ? ": oltre il sesto grado la legge non riconosce più la parentela" : ""}.`;
    if (m && n) esito.stipiti = s.stipiti;
  } else {
    // affinità: il partner di un parente, o un parente del partner; vince il grado più basso
    let meglio = null;
    const prova = (lato, coniuge, r) => { if (r && (!meglio || r.m + r.n < meglio.r.m + meglio.r.n)) meglio = { lato, coniuge, r }; };
    for (const uid of ix.unioniDi.get(a) || []) { const c = coniugeIn(ix.unione.get(uid), a); if (c && ix.persona.has(c)) prova("a", c, parentelaDiSangue(ix, c, b)); }
    for (const uid of ix.unioniDi.get(b) || []) { const c = coniugeIn(ix.unione.get(uid), b); if (c && ix.persona.has(c)) prova("b", c, parentelaDiSangue(ix, a, c)); }
    if (meglio) {
      const { lato, r } = meglio;
      const seq = lato === "a" ? [a, ...r.seq] : [...r.seq, b];
      esito.tipo = "affini";
      esito.seq = seq;
      const altro = lato === "a" ? "b" : "a";
      const ca = acquisito(lato, r.m, r.n), cb = acquisito(altro, r.n, r.m);
      esito.frase = ca ? `${frase(a, ca, b)}.` : narra(seq);
      esito.inversa = cb ? `${frase(b, cb, a)}.` : narra([...seq].reverse());
      if (ca || cb) esito.spiegazione = narra(seq);
      esito.grado = `Affini ${linea(r.m, r.n)} di ${r.m + r.n}° grado: per la legge l'affinità nasce dal matrimonio.`;
    } else {
      const seq = percorsoQualsiasi(ix, a, b);
      if (!seq) {
        esito.tipo = "nessuno";
        esito.frase = `Nell'albero non c'è nessun legame fra ${chi(a)} ${ed(chi(b))} ${chi(b)}: i loro rami non si toccano.`;
      } else {
        esito.tipo = "collegati";
        esito.seq = seq;
        const coppie = seq.slice(1).filter((y, i) => passo(ix, seq[i], y).verso === "partner").length;
        // i genitori di una coppia: consuoceri
        if (seq.length === 4 && passo(ix, seq[0], seq[1]).verso === "giu" && passo(ix, seq[1], seq[2]).verso === "partner"
          && passo(ix, seq[2], seq[3]).verso === "su") {
          esito.frase = `${frase(a, P("consuocero", "consuocera"), b)}.`;
          esito.inversa = `${frase(b, P("consuocero", "consuocera"), a)}.`;
          esito.spiegazione = narra(seq);
          esito.grado = "Non sono parenti né affini: i loro figli sono una coppia.";
        } else {
          // la catena può essere lunga: sull'albero va il titolo, la catena nel pannello, in un verso solo
          esito.titolo = `${maiuscola(chi(a))} ${ed(chi(b))} ${chi(b)} non sono parenti: le loro famiglie sono unite da ${coppie === 1 ? "una coppia" : `${coppie} coppie`}.`;
          esito.frase = narra(seq);
        }
      }
    }
  }

  esito.titolo ||= esito.frase;
  Object.assign(esito, disegno(ix, esito.seq || [a, b], esito.tipo === "nessuno"));
  esito.passi = esito.seq ? passi(ix, esito.seq, sx) : [];
  esito.dubbi = [...dubbi].filter(id => !ignoto(persona(id)));
  return esito;
}

// Che cosa illuminare: le persone del percorso, le unioni e le linee da cui passa; in cima a
// due rami che scendono dalla stessa coppia, anche l'altro partner.
function disegno(ix, seq, vuoto) {
  const persone = new Set(seq), unioni = new Set(), archi = new Set();
  if (vuoto) return { persone, unioni, archi };
  for (let i = 0; i < seq.length - 1; i++) {
    const [x, y] = [seq[i], seq[i + 1]], h = passo(ix, x, y);
    if (!h.unione) continue;
    unioni.add(h.unione);
    if (h.verso === "su") { archi.add(idArcoFiglio(h.unione, x)); archi.add(idArcoPartner(y, h.unione)); }
    if (h.verso === "giu") { archi.add(idArcoPartner(x, h.unione)); archi.add(idArcoFiglio(h.unione, y)); }
    if (h.verso === "partner") { archi.add(idArcoPartner(x, h.unione)); archi.add(idArcoPartner(y, h.unione)); }
    const dopo = seq[i + 2] && passo(ix, y, seq[i + 2]);
    if (h.verso === "su" && dopo?.verso === "giu" && dopo.unione === h.unione) {
      const altro = coniugeIn(ix.unione.get(h.unione), y);
      if (altro && ix.persona.has(altro)) { persone.add(altro); archi.add(idArcoPartner(altro, h.unione)); }
    }
  }
  return { persone, unioni, archi };
}

// Il percorso da leggere: ogni passo con la parola che lo lega al precedente.
function passi(ix, seq, sx) {
  const out = [{ ids: [seq[0]], verso: null, parola: "" }];
  for (let i = 1; i < seq.length; i++) {
    const h = passo(ix, seq[i - 1], seq[i]), dopo = seq[i + 1] && passo(ix, seq[i], seq[i + 1]);
    if (h.verso === "su" && dopo?.verso === "giu" && dopo.unione === h.unione) {
      const altro = coniugeIn(ix.unione.get(h.unione), seq[i]);
      out.push({ ids: [seq[i], altro].filter(id => id && ix.persona.has(id)), verso: "su", parola: "genitori" });
    } else {
      const c = h.verso === "su" ? GENITORE : h.verso === "giu" ? FIGLIO : PARTNER;
      out.push({ ids: [seq[i]], verso: h.verso, parola: forma(c, sx(seq[i]), false) });
    }
  }
  return out;
}
