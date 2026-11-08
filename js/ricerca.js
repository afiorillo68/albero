// Ricerca avanzata: condizioni su tutti i campi della persona, sui valori dedotti e sui
// legami di parentela, combinate con «tutte» (e) o «almeno una» (o). Modulo puro.
import { normalizza, parenti, antenati, discendenti, nomeCompleto } from "./grafo.js";
import { annoDi, eta, statoInVita, TESTO_IN_VITA, generazioneSociologica, GENERAZIONI } from "./deduzioni.js";
import { ALTRI } from "./filtri.js";

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const SI_NO = [["sì", "sì"], ["no", "no"]];
const siNo = v => (v ? "sì" : "no");

// Contesto di valutazione, ricavato dalla scena: indici, generazione di ogni persona, fasce.
export const contesto = (scena, oggi = new Date()) => ({ ix: scena.ix, generazione: scena.generazione, fasce: scena.fasce, oggi });

const unioniDa = (cx, p) => (cx.ix.unioniDi.get(p.id) || []).map(uid => cx.ix.unione.get(uid)).filter(Boolean);
const veri = (cx, ids) => ids.filter(id => !cx.ix.persona.get(id)?.segnaposto);

// tipo: testo (leggi → elenco di stringhe), numero (→ numero o null), elenco (→ valore),
// persona (il valore è un'altra persona: il campo dice quali persone le sono legate)
export const CAMPI = {
  qualsiasi: { gruppo: "Testo", etichetta: "Qualsiasi campo di testo", tipo: "testo",
    leggi: (p, cx) => [p.nome, p.cognome, p.soprannome, p.note, p.nascita?.luogo, p.morte?.luogo, p.aggiornato?.chi,
      ...unioniDa(cx, p).flatMap(u => [u.note, u.fonte])] },
  nome: { gruppo: "Testo", etichetta: "Nome", tipo: "testo", leggi: p => [p.nome] },
  cognome: { gruppo: "Testo", etichetta: "Cognome", tipo: "testo", leggi: p => [p.cognome] },
  soprannome: { gruppo: "Testo", etichetta: "Soprannome", tipo: "testo", leggi: p => [p.soprannome] },
  note: { gruppo: "Testo", etichetta: "Note", tipo: "testo", leggi: p => [p.note] },
  luogoNascita: { gruppo: "Testo", etichetta: "Luogo di nascita", tipo: "testo", leggi: p => [p.nascita?.luogo] },
  luogoMorte: { gruppo: "Testo", etichetta: "Luogo di morte", tipo: "testo", leggi: p => [p.morte?.luogo] },
  noteUnioni: { gruppo: "Testo", etichetta: "Note e fonti delle sue unioni", tipo: "testo",
    leggi: (p, cx) => unioniDa(cx, p).flatMap(u => [u.note, u.fonte]) },
  modificatoDa: { gruppo: "Testo", etichetta: "Ultima modifica fatta da", tipo: "testo", leggi: p => [p.aggiornato?.chi] },

  annoNascita: { gruppo: "Date ed età", etichetta: "Anno di nascita", tipo: "numero", misura: "anno", leggi: p => annoDi(p.nascita?.data) },
  meseNascita: { gruppo: "Date ed età", etichetta: "Mese di nascita", tipo: "elenco",
    valori: () => MESI.map((m, i) => [String(i + 1), m]),
    leggi: p => { const m = (p.nascita?.data || "").match(/^\d{4}-(\d{2})/); return m ? String(Number(m[1])) : null; } },
  annoMorte: { gruppo: "Date ed età", etichetta: "Anno di morte", tipo: "numero", misura: "anno", leggi: p => annoDi(p.morte?.data) },
  eta: { gruppo: "Date ed età", etichetta: "Età (oggi, o alla morte)", tipo: "numero", misura: "quantita", leggi: (p, cx) => eta(p, cx.oggi) },
  circa: { gruppo: "Date ed età", etichetta: "Date segnate «circa»", tipo: "elenco", unico: true, valori: () => SI_NO,
    leggi: p => siNo(p.nascita?.circa || p.morte?.circa) },

  vita: { gruppo: "Dedotti e classificazioni", etichetta: "In vita", tipo: "elenco",
    valori: () => Object.entries(TESTO_IN_VITA), leggi: (p, cx) => statoInVita(p, cx.oggi) },
  sesso: { gruppo: "Dedotti e classificazioni", etichetta: "Sesso", tipo: "elenco",
    valori: () => [["F", "femmina"], ["M", "maschio"], ["", "non indicato"]], leggi: p => p.sesso || "" },
  famiglia: { gruppo: "Dedotti e classificazioni", etichetta: "Famiglia d'origine", tipo: "elenco",
    valori: cx => [...[...cx.ix.ceppi.keys()].map(c => [c, c]), [ALTRI, "altri cognomi"]],
    leggi: (p, cx) => (cx.ix.ceppi.has(p.cognome) ? p.cognome : ALTRI) },
  fascia: { gruppo: "Dedotti e classificazioni", etichetta: "Generazione nell'albero", tipo: "elenco",
    valori: cx => cx.fasce.map(f => [String(f.g), `${f.titolo}${f.stima ? " (stima)" : ""}`]),
    leggi: (p, cx) => (cx.generazione[p.id] === undefined ? null : String(cx.generazione[p.id])) },
  sociologica: { gruppo: "Dedotti e classificazioni", etichetta: "Generazione per anno di nascita", tipo: "elenco",
    valori: () => GENERAZIONI.map(g => [g.nome, g.nome]),
    leggi: p => generazioneSociologica(annoDi(p.nascita?.data))?.nome ?? null },

  parentela: { gruppo: "Legami", etichetta: "Parentela con una persona", tipo: "persona" },
  figli: { gruppo: "Legami", etichetta: "Numero di figli noti", tipo: "numero", misura: "quantita",
    leggi: (p, cx) => new Set(veri(cx, unioniDa(cx, p).flatMap(u => u.figli))).size },
  partner: { gruppo: "Legami", etichetta: "Numero di partner", tipo: "numero", misura: "quantita",
    leggi: (p, cx) => unioniDa(cx, p).length },
  fratelli: { gruppo: "Legami", etichetta: "Numero di fratelli e sorelle", tipo: "numero", misura: "quantita",
    leggi: (p, cx) => veri(cx, parenti(cx.ix, p.id).fratelli).length },
  genitori: { gruppo: "Legami", etichetta: "Genitori nell'albero", tipo: "elenco", unico: true, valori: () => SI_NO,
    leggi: (p, cx) => siNo(cx.ix.genitoriDi.has(p.id)) },
  ipotesi: { gruppo: "Legami", etichetta: "In un legame da confermare", tipo: "elenco", unico: true, valori: () => SI_NO,
    leggi: (p, cx) => {
      const ug = cx.ix.unione.get(cx.ix.genitoriDi.get(p.id));
      return siNo(ug?.stato === "ipotesi" || unioniDa(cx, p).some(u => u.stato === "ipotesi"));
    } },
};

export const GRUPPI = [...new Set(Object.values(CAMPI).map(c => c.gruppo))];

// Operatori per tipo. Per i numeri le etichette cambiano con la misura: «dal 1950» per
// gli anni, «almeno 2» per età e conteggi.
const OPERATORI = {
  testo: [["contiene", "contiene"], ["non-contiene", "non contiene"], ["uguale", "è esattamente"],
    ["inizia", "comincia con"], ["pieno", "è compilato"], ["vuoto", "è vuoto"]],
  numero: [["uguale", "è"], ["diverso", "non è"], ["almeno", { anno: "dal", quantita: "almeno" }],
    ["al-massimo", { anno: "fino al", quantita: "al massimo" }], ["tra", "tra"], ["noto", "è indicato"], ["ignoto", "non è indicato"]],
  elenco: [["tra", "è uno di"], ["fuori", "non è nessuno di"]],
  persona: [["discendente", "è discendente di"], ["antenato", "è antenato di"], ["figlio", "è figlio o figlia di"],
    ["genitore", "è genitore di"], ["partner", "è partner di"], ["fratello", "è fratello o sorella di"]],
};

export function operatori(campo) {
  const c = CAMPI[campo];
  if (c.unico) return [["tra", "è"]];
  return OPERATORI[c.tipo].map(([id, e]) => [id, typeof e === "string" ? e : e[c.misura]]);
}

// operatori che non chiedono un valore
export const senzaValore = op => ["pieno", "vuoto", "noto", "ignoto"].includes(op);

export function nuovaCondizione(campo = "qualsiasi") {
  const op = operatori(campo)[0][0];
  return { campo, op, valore: CAMPI[campo].tipo === "elenco" ? [] : "", valore2: "" };
}

export const criteriVuoti = () => ({ modo: "tutte", condizioni: [nuovaCondizione()] });

const numero = v => {
  const t = String(v ?? "").trim().replace(",", ".");
  return t && Number.isFinite(Number(t)) ? Number(t) : null;
};

// Una condizione conta solo quando è completa: le altre si ignorano, così si può
// aggiungere una riga e compilarla con calma.
export function completa(c) {
  const campo = CAMPI[c.campo];
  if (!campo) return false;
  if (senzaValore(c.op)) return true;
  if (campo.tipo === "testo") return !!normalizza(c.valore);
  if (campo.tipo === "numero") return c.op === "tra" ? numero(c.valore) !== null || numero(c.valore2) !== null : numero(c.valore) !== null;
  if (campo.tipo === "elenco") return c.valore.length > 0;
  if (campo.tipo === "persona") return !!c.valore;
  return false;
}

export const attiva = criteri => !!criteri?.condizioni.some(completa);

function legati(cx, op, id) {
  const pa = parenti(cx.ix, id);
  if (op === "discendente") return discendenti(cx.ix, id, false);
  if (op === "antenato") return antenati(cx.ix, id);
  if (op === "figlio") return new Set(pa.unioni.flatMap(u => u.figli));
  if (op === "genitore") return new Set(pa.genitori);
  if (op === "partner") return new Set(pa.unioni.map(u => u.partner));
  if (op === "fratello") return new Set(pa.fratelli);
  return new Set();
}

function provaTesto(valori, op, cercato) {
  const v = valori.map(normalizza);
  const q = normalizza(cercato).replace(/\s+/g, " ");
  if (op === "pieno") return v.some(Boolean);
  if (op === "vuoto") return v.every(x => !x);
  if (op === "contiene") return v.some(x => x.replace(/\s+/g, " ").includes(q));
  if (op === "non-contiene") return v.every(x => !x.replace(/\s+/g, " ").includes(q));
  if (op === "uguale") return v.some(x => x === q);
  if (op === "inizia") return v.some(x => x.startsWith(q));
  return false;
}

// un valore non noto non soddisfa nessun confronto: soltanto «non è indicato»
function provaNumero(n, op, a, b) {
  if (op === "noto") return n !== null && n !== undefined;
  if (op === "ignoto") return n === null || n === undefined;
  if (n === null || n === undefined) return false;
  if (op === "uguale") return n === a;
  if (op === "diverso") return n !== a;
  if (op === "almeno") return n >= a;
  if (op === "al-massimo") return n <= a;
  if (op === "tra") { const [da, fino] = a !== null && b !== null && a > b ? [b, a] : [a, b]; return (da === null || n >= da) && (fino === null || n <= fino); }
  return false;
}

function prova(p, c, cx, cache) {
  const campo = CAMPI[c.campo];
  if (campo.tipo === "testo") return provaTesto(campo.leggi(p, cx).filter(x => x !== undefined && x !== null), c.op, c.valore);
  if (campo.tipo === "numero") return provaNumero(campo.leggi(p, cx), c.op, numero(c.valore), numero(c.valore2));
  if (campo.tipo === "elenco") {
    const v = campo.leggi(p, cx), dentro = v !== null && c.valore.includes(v);
    return c.op === "fuori" ? !dentro : dentro;
  }
  if (campo.tipo === "persona") {
    const k = `${c.op}|${c.valore}`;
    if (!cache.has(k)) cache.set(k, legati(cx, c.op, c.valore));
    return cache.get(k).has(p.id);
  }
  return false;
}

// Insieme delle persone che soddisfano i criteri, o null se non c'è nessuna condizione
// completa. I segnaposto («figli non noti») non sono persone e restano fuori.
export function valuta(albero, cx, criteri) {
  const condizioni = (criteri?.condizioni || []).filter(completa);
  if (!condizioni.length) return null;
  const cache = new Map(), tutte = criteri.modo !== "almeno";
  const out = new Set();
  for (const p of albero.persone) {
    if (p.segnaposto) continue;
    const esiti = condizioni.map(c => () => prova(p, c, cx, cache));
    if (tutte ? esiti.every(f => f()) : esiti.some(f => f())) out.add(p.id);
  }
  return out;
}

// Frase leggibile di una condizione completa, per il riepilogo.
export function descriviCondizione(c, cx) {
  const campo = CAMPI[c.campo];
  const op = operatori(c.campo).find(([id]) => id === c.op)?.[1] || c.op;
  if (senzaValore(c.op)) return `${campo.etichetta} ${op}`;
  if (campo.tipo === "elenco") {
    const nomi = new Map(campo.valori(cx));
    return `${campo.etichetta} ${op} ${c.valore.map(v => nomi.get(v) ?? v).join(", ")}`;
  }
  if (campo.tipo === "persona") return `${op} ${nomeCompleto(cx.ix.persona.get(c.valore))}`;
  if (campo.tipo === "numero" && c.op === "tra") {
    const a = numero(c.valore), b = numero(c.valore2);
    const [da, fino] = campo.misura === "anno" ? ["dal", "fino al"] : ["almeno", "al massimo"];
    return a !== null && b !== null ? `${campo.etichetta} tra ${a} e ${b}` : a !== null ? `${campo.etichetta} ${da} ${a}` : `${campo.etichetta} ${fino} ${b}`;
  }
  return `${campo.etichetta} ${op} «${String(c.valore).trim()}»`;
}

export function descrivi(criteri, cx) {
  const frasi = (criteri?.condizioni || []).filter(completa).map(c => descriviCondizione(c, cx));
  return frasi.join(criteri?.modo === "almeno" ? " oppure " : " e ");
}
