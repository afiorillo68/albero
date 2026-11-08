// Dati condivisi su Firestore: apertura con il link di lettura o di modifica, ascolto in
// tempo reale, scritture a lotti con la voce di storico, ripristino. Solo browser.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  doc, collection, onSnapshot, getDoc, getDocs, setDoc, writeBatch, serverTimestamp,
  FieldPath, deleteField, query, orderBy, limit, startAfter, where,
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

export class ErroreLink extends Error {}

function avviaFirebase(configurazione) {
  const app = initializeApp(configurazione);
  let db;
  try {
    db = initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    db = initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: memoryLocalCache() });
  }
  return { app, db };
}

const senzaId = ({ id, ...resto }) => resto;
const senzaAggiornato = ({ aggiornato, ...resto }) => resto;

// chiave: {tipo: "lettura"|"modifica", valore}; nome(): come si chiama chi modifica
export async function apri(configurazione, chiave, { suCambio, suErrore, suStatoRete, nome }) {
  const { app, db } = avviaFirebase(configurazione);
  let kL, uid = null;
  const modifica = chiave.tipo === "modifica";

  if (modifica) {
    const segreto = await getDoc(doc(db, "segreti", chiave.valore)).catch(() => null);
    if (!segreto?.exists()) throw new ErroreLink("Il link di modifica non è valido, oppure è stato sostituito con uno nuovo.");
    kL = segreto.data().albero;
    const auth = getAuth(app);
    await auth.authStateReady();
    const utente = auth.currentUser || (await signInAnonymously(auth)).user;
    uid = utente.uid;
    const rif = doc(db, "editori", uid);
    const ora = await getDoc(rif).catch(() => null);
    const d = ora?.exists() ? ora.data() : null;
    if (!d || d.chiave !== chiave.valore || d.albero !== kL) await setDoc(rif, { albero: kL, chiave: chiave.valore });
  } else {
    kL = chiave.valore;
  }

  const radice = doc(db, "alberi", kL);
  const prova = await getDoc(radice).catch(() => null);
  if (!prova?.exists()) throw new ErroreLink("Il link non è valido, oppure l'albero non è più qui.");

  const rifDisposizione = doc(db, "alberi", kL, "disposizione", "corrente");
  const stato = { meta: null, persone: new Map(), unioni: new Map(), disposizione: null, pronti: new Set(), inSospeso: new Set() };
  const notifica = () => {
    if (stato.pronti.size < 4) return;
    suCambio({
      meta: stato.meta || {},
      persone: [...stato.persone.values()],
      unioni: [...stato.unioni.values()],
      disposizione: { nodi: stato.disposizione?.nodi || {}, archi: stato.disposizione?.archi || {} },
    });
  };
  const rete = (nome, s) => {
    if (s.metadata.hasPendingWrites) stato.inSospeso.add(nome); else stato.inSospeso.delete(nome);
    suStatoRete?.({ inSospeso: stato.inSospeso.size > 0, daCache: s.metadata.fromCache });
  };
  const opzioni = { includeMetadataChanges: true };
  onSnapshot(radice, opzioni, s => { stato.meta = s.data(); stato.pronti.add("meta"); rete("meta", s); notifica(); }, suErrore);
  for (const raccolta of ["persone", "unioni"]) {
    onSnapshot(collection(db, "alberi", kL, raccolta), opzioni, s => {
      stato[raccolta] = new Map(s.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
      stato.pronti.add(raccolta);
      rete(raccolta, s);
      notifica();
    }, suErrore);
  }
  onSnapshot(rifDisposizione, opzioni, s => {
    stato.disposizione = s.exists() ? s.data() : null;
    stato.pronti.add("disposizione");
    rete("disposizione", s);
    notifica();
  }, suErrore);

  const modifiche = collection(db, "alberi", kL, "modifiche");
  const attuale = (raccolta, id) => {
    const v = stato[raccolta].get(id);
    return v ? senzaId(v) : null;
  };

  // operazioni: [{raccolta: "persone"|"unioni", id, dopo: {...} | null}]
  // disposizione: [{sezione: "nodi"|"archi", id, dopo: valore | null}]
  // meta: {campo: valore}
  async function salva({ operazioni = [], disposizione = [], meta = null, descrizione }) {
    if (!modifica) throw new Error("Questo link è in sola lettura.");
    const chi = nome() || "qualcuno";
    const batch = writeBatch(db);
    const gruppo = crypto.randomUUID();
    const voce = dati => batch.set(doc(modifiche), { quando: serverTimestamp(), chi, uid, gruppo, descrizione, ...dati });
    for (const op of operazioni) {
      const rif = doc(db, "alberi", kL, op.raccolta, op.id);
      const prima = attuale(op.raccolta, op.id);
      if (op.dopo === null) batch.delete(rif);
      else batch.set(rif, { ...senzaAggiornato(senzaId(op.dopo)), aggiornato: { quando: serverTimestamp(), chi } });
      voce({ tipo: op.raccolta, id: op.id, prima, dopo: op.dopo === null ? null : senzaAggiornato(senzaId(op.dopo)) });
    }
    if (disposizione.length) {
      if (!stato.disposizione) batch.set(rifDisposizione, { nodi: {}, archi: {} });
      const coppie = [];
      const campi = disposizione.map(c => {
        const prima = stato.disposizione?.[c.sezione]?.[c.id] ?? null;
        coppie.push(new FieldPath(c.sezione, c.id), c.dopo === null ? deleteField() : c.dopo);
        return { sezione: c.sezione, id: c.id, prima, dopo: c.dopo };
      });
      batch.update(rifDisposizione, ...coppie);
      voce({ tipo: "disposizione", campi });
    }
    if (meta) {
      const prima = Object.fromEntries(Object.keys(meta).map(k => [k, stato.meta?.[k] ?? null]));
      batch.update(radice, meta);
      voce({ tipo: "meta", prima, dopo: meta });
    }
    await batch.commit();
  }

  async function storico({ quanti = 60, dopo = null } = {}) {
    const q = dopo ? query(modifiche, orderBy("quando", "desc"), startAfter(dopo), limit(quanti))
      : query(modifiche, orderBy("quando", "desc"), limit(quanti));
    const s = await getDocs(q);
    return { voci: s.docs.map(d => ({ idVoce: d.id, ...d.data() })), ultimo: s.docs.at(-1) || null };
  }

  // Riporta lo stato di prima per tutte le voci dello stesso gruppo; diventa una modifica nuova.
  async function ripristina(gruppo, descrizione) {
    const s = await getDocs(query(modifiche, where("gruppo", "==", gruppo)));
    const voci = s.docs.map(d => d.data());
    const operazioni = [], disposizione = [];
    let meta = null;
    for (const v of voci) {
      if (v.tipo === "persone" || v.tipo === "unioni") operazioni.push({ raccolta: v.tipo, id: v.id, dopo: v.prima ? senzaAggiornato(v.prima) : null });
      else if (v.tipo === "disposizione") for (const c of v.campi) disposizione.push({ sezione: c.sezione, id: c.id, dopo: c.prima ?? null });
      else if (v.tipo === "meta") meta = { ...(meta || {}), ...v.prima };
    }
    await salva({ operazioni, disposizione, meta, descrizione });
  }

  return { modifica, uid, salva, storico, ripristina, attuale };
}
