// Valori dedotti dai dati, mai salvati: date parziali, stato in vita, generazioni
// sociologiche, etichette delle fasce, ingresso per l'impaginazione. Modulo puro.

// ------------------------------------------------------------ date parziali
// Formato salvato: "AAAA", "AAAA-MM" o "AAAA-MM-GG". In ingresso si accetta anche
// la forma italiana: "gg/mm/aaaa", "mm/aaaa", "aaaa".

export function normalizzaData(testo) {
  const t = (testo || "").trim();
  if (!t) return { data: "", valida: true };
  let a, m, g;
  let r = t.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/);
  if (r) [, a, m, g] = r;
  else if ((r = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [, g, m, a] = r;
  else if ((r = t.match(/^(\d{1,2})[/.-](\d{4})$/))) [, m, a] = r;
  else return { data: "", valida: false };
  const mese = m ? Number(m) : null, giorno = g ? Number(g) : null;
  if (mese !== null && (mese < 1 || mese > 12)) return { data: "", valida: false };
  if (giorno !== null) {
    const ultimo = new Date(Date.UTC(Number(a), mese, 0)).getUTCDate();
    if (giorno < 1 || giorno > ultimo) return { data: "", valida: false };
  }
  const due = n => String(n).padStart(2, "0");
  return { data: [a, mese && due(mese), giorno && due(giorno)].filter(Boolean).join("-"), valida: true };
}

export function annoDi(data) {
  const m = (data || "").match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

export function formattaData(d) {
  if (!d || !d.data) return "";
  const [a, m, g] = d.data.split("-");
  const testo = [g, m, a].filter(Boolean).join("/");
  return d.circa ? `c. ${testo}` : testo;
}

// età compiuta fra due date parziali; null se non si può dire
function anniFra(da, a) {
  const [a1, m1, g1] = da.split("-").map(Number);
  const [a2, m2, g2] = a.split("-").map(Number);
  let n = a2 - a1;
  if (m1 && m2) {
    if (m2 < m1 || (m2 === m1 && g1 && g2 && g2 < g1)) n -= 1;
  }
  return n;
}

const oggiISO = oggi => oggi.toISOString().slice(0, 10);

export const ETA_MASSIMA = 105;   // oltre, senza data di morte: «presumibilmente non più in vita»

export function statoInVita(p, oggi = new Date()) {
  if (p.morte?.data || p.deceduto) return "no";
  if (!p.nascita?.data) return "non noto";
  const anni = anniFra(p.nascita.data, oggiISO(oggi));
  return anni > ETA_MASSIMA ? "presumibilmente no" : "sì";
}

export const TESTO_IN_VITA = {
  "no": "Non più in vita",
  "sì": "In vita",
  "presumibilmente no": "Presumibilmente non più in vita",
  "non noto": "Non si sa se è in vita",
};

export function eta(p, oggi = new Date()) {
  if (!p.nascita?.data) return null;
  const fine = p.morte?.data || (statoInVita(p, oggi) === "sì" ? oggiISO(oggi) : null);
  return fine ? anniFra(p.nascita.data, fine) : null;
}

// ------------------------------------------------------------ generazioni sociologiche
// Pew Research da Silent a Gen Z, Strauss e Howe per le più antiche; Gen Alpha dal 2013.
export const GENERAZIONI = [
  { nome: "Transcendental Generation", da: 1792, a: 1821 },
  { nome: "Gilded Generation", da: 1822, a: 1842 },
  { nome: "Progressive Generation", da: 1843, a: 1859 },
  { nome: "Missionary Generation", da: 1860, a: 1882 },
  { nome: "Lost Generation", da: 1883, a: 1900 },
  { nome: "Greatest Generation", da: 1901, a: 1927 },
  { nome: "Silent Generation", da: 1928, a: 1945 },
  { nome: "Baby Boomer", da: 1946, a: 1964 },
  { nome: "Gen X", da: 1965, a: 1980 },
  { nome: "Millennial", da: 1981, a: 1996 },
  { nome: "Gen Z", da: 1997, a: 2012 },
  { nome: "Gen Alpha", da: 2013, a: null },
];

export function generazioneSociologica(anno) {
  if (anno === null || anno === undefined) return null;
  return GENERAZIONI.find(g => anno >= g.da && (g.a === null || anno <= g.a)) || null;
}

export const anniGenerazione = g => (g.a === null ? `dal ${g.da}` : `${g.da}-${g.a}`);

const SFONDI = ["#f2f2f2", "#f6efe4", "#ecf4ea", "#f0ecf7", "#fbecef", "#e8f2fb", "#fbf6e0", "#eef6f4"];
const PASSO_ANNI = 30;

// Etichetta e sfondo di ogni fascia (generazione familiare g, da 0).
// Con date di nascita nella fascia: la mediana. Senza: la stima ancorata a una persona
// (meta.stimeFasce, dal file dei dati), oppure ±30 anni dalla fascia più vicina con date.
export function etichetteFasce(albero, generazione) {
  const perFascia = new Map();
  for (const p of albero.persone) {
    const g = generazione[p.id];
    if (g === undefined) continue;
    if (!perFascia.has(g)) perFascia.set(g, []);
    const a = annoDi(p.nascita?.data);
    if (a !== null) perFascia.get(g).push(a);
  }
  const fasce = [...perFascia.keys()].sort((a, b) => a - b);
  const mediana = v => { const s = [...v].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2); };
  const stime = new Map();
  for (const s of albero.meta?.stimeFasce || []) {
    const g = generazione[s.persona];
    if (g !== undefined && !stime.has(g)) stime.set(g, s);
  }
  const conDate = fasce.filter(g => perFascia.get(g).length);
  const out = {};
  for (const g of fasce) {
    const stima = stime.get(g);
    const sfondo = stima?.sfondo || SFONDI[g % SFONDI.length];
    const anni = perFascia.get(g);
    if (anni.length) {
      const gs = generazioneSociologica(mediana(anni));
      out[g] = { sfondo, titolo: gs?.nome || `Generazione ${g + 1}`, anni: gs ? anniGenerazione(gs) : "",
        base: anni.length === 1 ? "da una data di nascita" : `da ${anni.length} date di nascita`, stima: false };
    } else if (stima) {
      out[g] = { sfondo, titolo: stima.generazione, anni: stima.anni, base: "stima", stima: true };
    } else if (conDate.length) {
      const vicina = conDate.reduce((m, h) => (Math.abs(h - g) < Math.abs(m - g) ? h : m));
      const gs = generazioneSociologica(mediana(perFascia.get(vicina)) + (g - vicina) * PASSO_ANNI);
      out[g] = { sfondo, titolo: gs?.nome || `Generazione ${g + 1}`, anni: gs ? anniGenerazione(gs) : "", base: "stima", stima: true };
    } else {
      out[g] = { sfondo, titolo: `Generazione ${g + 1}`, anni: "", base: "", stima: true };
    }
  }
  return out;
}

// ------------------------------------------------------------ ingresso dell'impaginazione

// I figli con data di nascita si ordinano per data fra i posti che occupano;
// quelli senza data restano dove sono.
export function ordinaFigliPerNascita(figli, persona) {
  const posti = [], datati = [];
  figli.forEach((f, i) => {
    const d = persona(f)?.nascita?.data;
    if (d) { posti.push(i); datati.push([d, i, f]); }
  });
  if (datati.length < 2) return [...figli];
  datati.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  const out = [...figli];
  posti.forEach((i, k) => { out[i] = datati[k][2]; });
  return out;
}

const perOrdine = (a, b) => (a.ordine ?? 1e9) - (b.ordine ?? 1e9) || (a.id < b.id ? -1 : 1);

export function ingressoLayout(albero, sottoinsieme = null) {
  const dentro = sottoinsieme ? new Set(sottoinsieme) : null;
  const persone = albero.persone.filter(p => !dentro || dentro.has(p.id)).sort(perOrdine);
  const P = new Map(persone.map(p => [p.id, p]));
  const unioni = albero.unioni
    .filter(u => u.partner.every(p => P.has(p)))
    .sort(perOrdine)
    .map(u => ({ id: u.id, partner: [...u.partner], figli: ordinaFigliPerNascita(u.figli.filter(f => P.has(f)), id => P.get(id)) }));
  return {
    persone: persone.map(p => ({ id: p.id, cognome: p.cognome })),
    unioni,
    ceppi: (albero.meta?.ceppi || []).map(c => ({ cognome: c.cognome })),
  };
}
