// Filtri (famiglia, generazione, in vita, dati mancanti) e isolamento di rami, generazioni,
// famiglie, persone. Il calcolo è puro; il pannello vive in main.js.
import { statoInVita, TESTO_IN_VITA } from "./deduzioni.js";
import { ramificazioni, nomeCompleto } from "./grafo.js";

export function filtriVuoti() {
  return { famiglie: new Set(), generazioni: new Set(), vita: new Set(), mancanti: new Set() };
}

export const ALTRI = "__altri__";
export const MANCANTI = {
  cognome: { testo: "Senza cognome", prova: p => !p.cognome && !p.segnaposto },
  nome: { testo: "Senza nome", prova: p => !p.nome && !p.segnaposto },
  nascita: { testo: "Senza data di nascita", prova: p => !p.nascita?.data && !p.segnaposto },
  note: { testo: "Con note", prova: p => !!p.note },
};

export const attivi = f => f.famiglie.size + f.generazioni.size + f.vita.size + f.mancanti.size > 0;

// Insieme delle persone che passano i filtri, o null se non c'è nessun filtro.
export function corrispondenti(albero, scena, f, oggi = new Date()) {
  if (!attivi(f)) return null;
  const out = new Set();
  for (const p of albero.persone) {
    const ceppo = scena.ix.ceppi.has(p.cognome) ? p.cognome : ALTRI;
    if (f.famiglie.size && !f.famiglie.has(ceppo)) continue;
    if (f.generazioni.size && !f.generazioni.has(scena.generazione[p.id])) continue;
    if (f.vita.size && !f.vita.has(statoInVita(p, oggi))) continue;
    if (f.mancanti.size && ![...f.mancanti].some(k => MANCANTI[k].prova(p))) continue;
    out.add(p.id);
  }
  return out;
}

// isolamento: {tipo: "antenati"|"discendenti"|"entrambi"|"famiglia"|"generazione", id}
export function insiemeIsolato(albero, scena, iso) {
  if (!iso) return null;
  const ix = scena.ix;
  const p = ix.persona.get(iso.id);
  if (!p) return null;
  if (iso.tipo === "famiglia") {
    return new Set(albero.persone.filter(q => q.cognome && q.cognome === p.cognome).map(q => q.id));
  }
  if (iso.tipo === "generazione") {
    const g = scena.generazione[iso.id];
    return new Set(albero.persone.filter(q => scena.generazione[q.id] === g).map(q => q.id));
  }
  return ramificazioni(ix, iso.id, iso.tipo);
}

export function descriviIsolamento(scena, iso) {
  const p = scena.ix.persona.get(iso.id);
  const n = nomeCompleto(p);
  return {
    antenati: `Antenati di ${n}`,
    discendenti: `Discendenti di ${n}`,
    entrambi: `Tutte le ramificazioni di ${n}`,
    famiglia: `Famiglia ${p?.cognome || ""}`,
    generazione: `La generazione di ${n}`,
  }[iso.tipo];
}

// Unisce filtri e isolamento: chi è fuori viene attenuato o nascosto.
export function visibilita(albero, scena, filtri, iso, soloVisibili, oggi = new Date()) {
  const a = corrispondenti(albero, scena, filtri, oggi);
  const b = insiemeIsolato(albero, scena, iso);
  if (!a && !b) return { dentro: null, attenuati: new Set(), nascosti: new Set() };
  const dentro = new Set(albero.persone.map(p => p.id).filter(id => (!a || a.has(id)) && (!b || b.has(id))));
  const fuori = new Set(albero.persone.map(p => p.id).filter(id => !dentro.has(id)));
  return soloVisibili ? { dentro, attenuati: new Set(), nascosti: fuori } : { dentro, attenuati: fuori, nascosti: new Set() };
}

export const VOCI_VITA = Object.entries(TESTO_IN_VITA);
