// Relazioni di parentela calcolate dai dati: genitori, partner, figli, fratelli,
// antenati, discendenti, famiglia d'origine. Modulo puro.

export function indici(albero) {
  const persona = new Map(albero.persone.map(p => [p.id, p]));
  const unione = new Map(albero.unioni.map(u => [u.id, u]));
  const unioniDi = new Map(albero.persone.map(p => [p.id, []]));
  const genitoriDi = new Map();                    // figlio -> id unione
  for (const u of albero.unioni) {
    for (const p of u.partner) if (unioniDi.has(p)) unioniDi.get(p).push(u.id);
    for (const f of u.figli) genitoriDi.set(f, u.id);
  }
  const ceppi = new Map((albero.meta?.ceppi || []).map((c, i) => [c.cognome, { ...c, indice: i }]));
  return { persona, unione, unioniDi, genitoriDi, ceppi };
}

export const coniugeIn = (u, p) => (u.partner[0] === p ? u.partner[1] : u.partner[0]);

// Gruppi di persone collegate fra loro da unioni (come partner o come figli), dal più
// numeroso: il primo è l'albero vero e proprio, gli altri sono pezzi ancora staccati.
export function componenti(albero) {
  const capo = new Map(albero.persone.map(p => [p.id, p.id]));
  const radice = x => { while (capo.get(x) !== x) { capo.set(x, capo.get(capo.get(x))); x = capo.get(x); } return x; };
  for (const u of albero.unioni) {
    const membri = [...u.partner, ...u.figli].filter(id => capo.has(id));
    for (const q of membri.slice(1)) { const a = radice(membri[0]), b = radice(q); if (a !== b) capo.set(b, a); }
  }
  const per = new Map();
  for (const p of albero.persone) { const r = radice(p.id); if (!per.has(r)) per.set(r, []); per.get(r).push(p.id); }
  const gruppi = [...per.values()].sort((a, b) => b.length - a.length);
  return { gruppi, di: new Map(gruppi.flatMap((g, i) => g.map(id => [id, i]))) };
}

export function parenti(ix, id) {
  const uGen = ix.unione.get(ix.genitoriDi.get(id));
  const genitori = uGen ? [...uGen.partner] : [];
  const fratelli = uGen ? uGen.figli.filter(f => f !== id) : [];
  const unioni = (ix.unioniDi.get(id) || []).map(uid => {
    const u = ix.unione.get(uid);
    return { unione: u, partner: coniugeIn(u, id), figli: [...u.figli] };
  });
  return { unioneGenitori: uGen || null, genitori, fratelli, unioni };
}

export function antenati(ix, id) {
  const out = new Set(), coda = [id];
  while (coda.length) {
    const q = coda.pop();
    const u = ix.unione.get(ix.genitoriDi.get(q));
    if (!u) continue;
    for (const p of u.partner) if (!out.has(p)) { out.add(p); coda.push(p); }
  }
  return out;
}

// discendenti di id, con i partner che ne sono l'altro genitore (servono a leggere le unioni)
export function discendenti(ix, id, conPartner = true) {
  const out = new Set(), coda = [id], visti = new Set([id]);
  while (coda.length) {
    const q = coda.pop();
    for (const uid of ix.unioniDi.get(q) || []) {
      const u = ix.unione.get(uid);
      if (!u.figli.length) continue;
      if (conPartner) out.add(coniugeIn(u, q));
      for (const f of u.figli) if (!visti.has(f)) { visti.add(f); out.add(f); coda.push(f); }
    }
  }
  out.delete(id);
  return out;
}

export function ramificazioni(ix, id, verso = "entrambi") {
  const out = new Set([id]);
  if (verso !== "discendenti") for (const p of antenati(ix, id)) out.add(p);
  if (verso !== "antenati") for (const p of discendenti(ix, id)) out.add(p);
  return out;
}

// colore e famiglia d'origine di una persona: il suo cognome, se è un ceppo
export function ceppoDi(ix, p) {
  return ix.ceppi.get(p.cognome) || null;
}

export function nomeCompleto(p) {
  if (!p) return "";
  if (p.segnaposto) return p.nome || "non noti";
  const parti = [p.nome || "?", p.soprannome ? `«${p.soprannome}»` : "", p.cognome || ""].filter(Boolean);
  return parti.join(" ").trim() || "non noto";
}

export const ignoto = p => p.segnaposto || (!p.nome && !p.cognome);

// ricerca senza badare ad accenti e maiuscole
export const normalizza = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Con dettagli: [{p, dove}], dove «nome» se tutte le parole stanno in nome, cognome o
// soprannome, altrimenti «note» o «luogo», cioè dov'è stata trovata la parola che nel nome manca.
export function cerca(albero, testo, { dettagli = false } = {}) {
  const q = normalizza(testo).split(/\s+/).filter(Boolean);
  if (!q.length) return [];
  const esito = p => {
    const campi = [p.nome, p.cognome, p.soprannome].map(normalizza);
    const note = normalizza(p.note), luoghi = normalizza(p.nascita?.luogo) + " " + normalizza(p.morte?.luogo);
    let s = 0, dove = "nome";
    for (const parola of q) {
      if (campi.some(c => c === parola)) s += 3;
      else if (campi.some(c => c.startsWith(parola))) s += 2;
      else if (campi.some(c => c.includes(parola))) s += 1;
      else if (note.includes(parola)) { s += 0.5; if (dove === "nome") dove = "note"; }
      else if (luoghi.includes(parola)) { s += 0.5; if (dove === "nome") dove = "luogo"; }
      else return null;
    }
    return { s, dove, p };
  };
  const trovati = albero.persone.map(esito).filter(Boolean)
    .sort((a, b) => b.s - a.s || nomeCompleto(a.p).localeCompare(nomeCompleto(b.p), "it"));
  return dettagli ? trovati.map(({ p, dove }) => ({ p, dove })) : trovati.map(r => r.p);
}
