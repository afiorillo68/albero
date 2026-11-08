// Suggerimenti di modifica: un post-it che porta con sé la modifica proposta, da applicare
// con un clic da chi ha il link di modifica. Qui le parti pure: le differenze fra la scheda
// e la proposta, e la descrizione in parole. Le misure sono quelle delle regole di Firestore.
//
// proposta: {azione: "dati", campi}            correzioni alla scheda (persona o unione)
//           {azione: "partner", persona | nuova}
//           {azione: "figlio", unione?, persona | nuova}
//           {azione: "fratello", unione, persona | nuova}
//           {azione: "genitori", coppia | nuovi: [nuova, nuova]}
// nuova: {nome, cognome, nascita?: {data, circa, luogo}}
import { nomeCompleto } from "./grafo.js";
import { formattaData } from "./deduzioni.js";

export const CAMPI_PERSONA = ["nome", "cognome", "soprannome", "sesso", "nascita", "morte", "deceduto", "note"];
export const CAMPI_UNIONE = ["stato", "note", "fonte"];
export const MISURE = { nome: 100, luogo: 150, note: 4000, fonte: 500 };

const ETICHETTE = {
  nome: "Nome", cognome: "Cognome", soprannome: "Soprannome", sesso: "Sesso", nascita: "Nascita", morte: "Morte",
  deceduto: "Non più in vita", note: "Note", stato: "Unione", fonte: "Fonte",
};

function norma(campo, v) {
  if (campo === "nascita" || campo === "morte") return { data: v?.data || "", circa: !!v?.circa, luogo: v?.luogo || "" };
  if (campo === "deceduto") return !!v;
  if (campo === "stato") return v === "ipotesi" ? "ipotesi" : "certa";
  return v || "";
}

const uguali = (campo, a, b) => JSON.stringify(norma(campo, a)) === JSON.stringify(norma(campo, b));

// I soli campi che la proposta cambia, già normalizzati.
export function differenze(prima, dopo, campi) {
  const fuori = {};
  for (const c of campi) if (!uguali(c, prima?.[c], dopo?.[c])) fuori[c] = norma(c, dopo?.[c]);
  return fuori;
}

export function valoreLeggibile(campo, v) {
  const x = norma(campo, v);
  if (campo === "nascita" || campo === "morte") return [formattaData(x), x.luogo].filter(Boolean).join(", ") || "non indicata";
  if (campo === "sesso") return { F: "femmina", M: "maschio" }[x] || "non indicato";
  if (campo === "deceduto") return x ? "sì, data non nota" : "no";
  if (campo === "stato") return x === "ipotesi" ? "ipotesi da confermare" : "certa";
  return x || "vuoto";
}

function nuovaInParole(m) {
  const nome = [m?.nome, m?.cognome].filter(Boolean).join(" ") || "nome non indicato";
  const n = norma("nascita", m?.nascita);
  const nascita = [formattaData(n), n.luogo].filter(Boolean).join(", ");
  return nascita ? `${nome}, nascita ${nascita}` : nome;
}

function personaInParole(ix, pr) {
  if (pr.nuova) return `${nuovaInParole(pr.nuova)} (da aggiungere)`;
  const p = ix.persona.get(pr.persona);
  return p ? `${nomeCompleto(p)} (già nell'albero)` : "una persona che non è più nell'albero";
}

const coppiaInParole = (ix, u) => u.partner.map(p => nomeCompleto(ix.persona.get(p))).join(" e ");

// {titolo, righe}: righe di testo semplice, da mettere in un elenco. confronto: accanto ai
// dati proposti, quelli di adesso (non nella risposta a chi ha suggerito, che li ha già visti).
export function descriviProposta(ix, n, { confronto = true } = {}) {
  const pr = n.proposta || {};
  if (pr.azione === "dati") {
    const scheda = n.tipo === "unione" ? ix.unione.get(n.nodo) : ix.persona.get(n.nodo);
    const righe = Object.entries(pr.campi || {}).map(([c, v]) => {
      const ora = !scheda || !confronto ? "" : uguali(c, scheda[c], v) ? " (è già così)" : ` (ora: ${valoreLeggibile(c, scheda[c])})`;
      return `${ETICHETTE[c] || c}: ${valoreLeggibile(c, v)}${ora}`;
    });
    return { titolo: n.tipo === "unione" ? "Correzione dei dati della coppia" : "Correzione dei dati", righe };
  }
  if (pr.azione === "partner") return { titolo: "Partner da aggiungere", righe: [personaInParole(ix, pr)] };
  if (pr.azione === "figlio" || pr.azione === "fratello") {
    const righe = [personaInParole(ix, pr)];
    const u = pr.unione && ix.unione.get(pr.unione);
    if (pr.azione === "figlio" && u && n.tipo === "persona") {
      const altro = u.partner.find(p => p !== n.nodo);
      if (altro) righe.push(`con ${nomeCompleto(ix.persona.get(altro))}`);
    }
    if (pr.azione === "fratello" && u) righe.push(`figlio o figlia di ${coppiaInParole(ix, u)}`);
    return { titolo: pr.azione === "figlio" ? "Figlio o figlia da aggiungere" : "Fratello o sorella da aggiungere", righe };
  }
  if (pr.azione === "genitori") {
    if (pr.coppia) {
      const u = ix.unione.get(pr.coppia);
      return { titolo: "Genitori", righe: [u ? `la coppia ${coppiaInParole(ix, u)} (già nell'albero)` : "una coppia che non è più nell'albero"] };
    }
    return { titolo: "Genitori da aggiungere", righe: (pr.nuovi || []).map(m => ([m.nome, m.cognome].some(Boolean) ? nuovaInParole(m) : "non noto")) };
  }
  return { titolo: "Suggerimento", righe: [] };
}

export function doveProposta(ix, n) {
  if (n.tipo === "unione") {
    const u = ix.unione.get(n.nodo);
    return u ? `sulla coppia ${coppiaInParole(ix, u)}` : "su un'unione che non è più nell'albero";
  }
  const p = ix.persona.get(n.nodo);
  return p ? `su ${nomeCompleto(p)}` : "su una persona che non è più nell'albero";
}

// Quello che resta di un suggerimento accettato o rifiutato, per la mail a chi l'ha scritto.
export const riassunto = (ix, n) => ({ autore: n.autore, nodo: n.nodo, dove: doveProposta(ix, n), ...descriviProposta(ix, n, { confronto: false }) });

export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
