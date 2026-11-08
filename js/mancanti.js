// «Cosa manca»: quello che ancora non si sa delle persone dell'albero, una voce per persona,
// prima le generazioni più vecchie (dove basta una data di nascita a rendere certa l'etichetta
// della fascia). Per ogni voce: che cosa manca, una riga per riconoscere la persona, i post-it
// che ha e i suggerimenti in attesa che coprono già un dato. Modulo puro.
import { parenti, nomeCompleto, ignoto } from "./grafo.js";
import { ALTRI } from "./filtri.js";

// un «?» scritto al posto del nome o del cognome vale come non saputo
export const vuoto = v => !v || /^\?+$/.test(String(v).trim());

// campo: quello che manca; tipo: il gruppo del filtro nel pannello
export const DATI = {
  chi: { testo: "chi è", tipo: "nomi" },
  nome: { testo: "nome", tipo: "nomi" },
  cognome: { testo: "cognome", tipo: "nomi" },
  figli: { testo: "nomi dei figli", tipo: "nomi" },
  nascita: { testo: "data di nascita", tipo: "nascita" },
  morte: { testo: "data di morte", tipo: "morte" },
};

export const TIPI = [
  ["nascita", "Date di nascita"],
  ["nomi", "Nomi e cognomi"],
  ["morte", "Date di morte"],
];

// Il campo del modulo su cui portare il cursore, per il primo dato che manca.
export const CAMPO_MODULO = { chi: "nome", nome: "nome", cognome: "cognome", nascita: "nascita", morte: "morte" };

function datiMancanti(p) {
  if (ignoto(p)) return ["chi"];
  const out = [];
  if (vuoto(p.nome)) out.push("nome");
  if (vuoto(p.cognome)) out.push("cognome");
  if (!p.nascita?.data) out.push("nascita");
  if (p.deceduto && !p.morte?.data) out.push("morte");
  return out;
}

// I dati che un suggerimento sulla scheda propone già, con il nome di chi l'ha scritto.
function coperti(suggerimenti) {
  const out = new Map();
  for (const n of suggerimenti) {
    const c = n.proposta?.azione === "dati" ? n.proposta.campi || {} : {};
    const segna = campo => { if (!out.has(campo)) out.set(campo, n.autore || "qualcuno"); };
    if (!vuoto(c.nome)) segna("nome");
    if (!vuoto(c.cognome)) segna("cognome");
    if (!vuoto(c.nome) || !vuoto(c.cognome)) segna("chi");
    if (c.nascita?.data) segna("nascita");
    if (c.morte?.data) segna("morte");
  }
  return out;
}

const elenco = nomi => (nomi.length <= 3 ? nomi.join(", ").replace(/, ([^,]*)$/, " e $1") : `${nomi.slice(0, 2).join(", ")} e altri ${nomi.length - 2}`);
const noti = (ix, ids) => ids.map(id => ix.persona.get(id)).filter(q => q && !ignoto(q)).map(nomeCompleto);

// Una riga per riconoscere la persona: i genitori, altrimenti i figli, altrimenti il partner.
// Il sesso spesso non è indicato: allora le parole restano neutre.
export function riconoscimento(ix, p) {
  const r = parenti(ix, p.id);
  const genitori = noti(ix, r.genitori);
  const figli = noti(ix, r.unioni.flatMap(u => u.figli));
  const partner = noti(ix, r.unioni.map(u => u.partner));
  if (ignoto(p)) {
    if (figli.length) return `genitore di ${elenco(figli)}${partner.length ? `, con ${elenco(partner)}` : ""}`;
    return partner.length ? `in coppia con ${elenco(partner)}` : genitori.length ? `genitori: ${elenco(genitori)}` : "";
  }
  if (genitori.length) {
    const g = genitori.join(" e ");
    return p.sesso === "F" ? `figlia di ${g}` : p.sesso === "M" ? `figlio di ${g}` : `${genitori.length > 1 ? "genitori" : "genitore"}: ${g}`;
  }
  if (figli.length) return `${p.sesso === "F" ? "madre" : p.sesso === "M" ? "padre" : "genitore"} di ${elenco(figli)}`;
  return partner.length ? `in coppia con ${elenco(partner)}` : "";
}

const famigliaDi = (ix, p) => (p && ix.ceppi.has(p.cognome) ? p.cognome : ALTRI);

// scena: per indici, generazioni e fasce. postit: tutti i post-it e i suggerimenti dell'albero.
// voci: [{nodo, tipo: "persona"|"unione", g, famiglia, nome, riconoscimento, manca: [{campo, testo,
//   tipo, attesa}], postit}]; fasce: le fasce con almeno una voce; famiglie: date di nascita note
// su persone (chi non è noto non conta); totali: lo stesso per l'albero intero e per tipo di dato.
export function cosaManca(albero, scena, postit = []) {
  const ix = scena.ix;
  const perNodo = new Map();
  for (const n of postit) perNodo.set(n.nodo, [...(perNodo.get(n.nodo) || []), n]);
  const suggerimentiSu = id => (perNodo.get(id) || []).filter(n => n.proposta);
  const ordineFamiglia = new Map([...ix.ceppi.values()].map(c => [c.cognome, c.indice]));
  const voci = [];

  for (const p of albero.persone) {
    if (p.segnaposto) continue;
    const campi = datiMancanti(p);
    if (!campi.length) continue;
    const attese = coperti(suggerimentiSu(p.id));
    voci.push({
      nodo: p.id, tipo: "persona", g: scena.generazione[p.id], famiglia: famigliaDi(ix, p),
      nome: ignoto(p) ? "Non noto" : nomeCompleto(p), ignoto: ignoto(p), morto: !!(p.deceduto || p.morte?.data),
      riconoscimento: riconoscimento(ix, p),
      manca: campi.map(c => ({ campo: c, ...DATI[c], attesa: attese.get(c) || null })),
      postit: (perNodo.get(p.id) || []).length,
    });
  }

  // «figli non noti»: la voce è sull'unione dei genitori, perché il figlio si aggiunge lì
  for (const p of albero.persone.filter(q => q.segnaposto)) {
    const u = ix.unione.get(ix.genitoriDi.get(p.id));
    if (!u) continue;
    const genitori = u.partner.map(id => ix.persona.get(id)).filter(Boolean);
    const coppia = genitori.map(nomeCompleto).join(" e ");
    // un figlio suggerito sull'unione, o dalla scheda di un genitore per questa unione
    const attesa = [...suggerimentiSu(u.id), ...u.partner.flatMap(suggerimentiSu)]
      .find(n => n.proposta.azione === "figlio" && (n.nodo === u.id || n.proposta.unione === u.id));
    voci.push({
      nodo: u.id, tipo: "unione", g: scena.generazione[p.id], famiglia: famigliaDi(ix, genitori.find(q => !ignoto(q))),
      nome: `Figli di ${coppia}`, ignoto: false, morto: false,
      riconoscimento: "hanno figli, ma non sappiamo quanti né come si chiamano",
      manca: [{ campo: "figli", ...DATI.figli, attesa: attesa ? attesa.autore || "qualcuno" : null }],
      postit: (perNodo.get(u.id) || []).length,
    });
  }

  const g = v => (v === undefined ? Infinity : v);
  voci.sort((a, b) => g(a.g) - g(b.g)
    || (ordineFamiglia.get(a.famiglia) ?? 1e3) - (ordineFamiglia.get(b.famiglia) ?? 1e3)
    || Number(a.ignoto) - Number(b.ignoto)
    || a.nome.localeCompare(b.nome, "it"));

  const conVoci = new Set(voci.map(v => v.g));
  const fasce = scena.fasce.filter(f => conVoci.has(f.g));

  // il contatore per famiglia: date di nascita note su persone note
  const persone = albero.persone.filter(p => !p.segnaposto && !ignoto(p));
  const conta = lista => ({ date: lista.filter(p => p.nascita?.data).length, totale: lista.length });
  const famiglie = [...scena.ceppi.map(c => c.cognome), ALTRI]
    .map(cognome => ({ cognome, ...conta(persone.filter(p => famigliaDi(ix, p) === cognome)) }))
    .filter(f => f.totale);
  const quanti = tipo => voci.filter(v => v.manca.some(m => m.tipo === tipo)).length;
  const totali = { ...conta(persone), ...Object.fromEntries(TIPI.map(([t]) => [t, quanti(t)])) };

  return { voci, fasce, famiglie, totali };
}

// Le voci da mostrare con i filtri del pannello: tipo di dato e famiglia (null: tutte).
export function scegli(voci, { tipo = null, famiglia = null } = {}) {
  return voci
    .filter(v => !famiglia || v.famiglia === famiglia)
    .map(v => (tipo ? { ...v, manca: v.manca.filter(m => m.tipo === tipo) } : v))
    .filter(v => v.manca.length);
}
