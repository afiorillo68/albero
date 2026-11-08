// Avvio dell'app e regia: chiave dal link, dati, vista, pannelli, ricerca, filtri,
// isolamento, esportazioni, menu, scorciatoie. Solo browser.
import { configurazione } from "../firebase-config.js";
import { apri, ErroreLink } from "./dati.js";
import { creaVista } from "./vista.js";
import { creaDisposizione } from "./disposizione.js";
import { componiScena } from "./scena.js";
import { documentoSVG, esc } from "./svg.js";
import { aJSON, aGEDCOM, aDrawio, aCSVPersone, aCSVUnioni } from "./esporta.js";
import { cerca, nomeCompleto } from "./grafo.js";
import { impagina, GEOMETRIA } from "./layout.js";
import { ingressoLayout, annoDi, statoInVita } from "./deduzioni.js";
import { filtriVuoti, attivi, visibilita, descriviIsolamento, ALTRI, MANCANTI, VOCI_VITA } from "./filtri.js";
import { mostraPersona, mostraUnione, nuovaPersonaLibera, completaDaElenco } from "./scheda.js";
import { cosaManca, scegli, TIPI } from "./mancanti.js";
import { comeSiamoParenti, ed } from "./parentela.js";
import { mostraStorico } from "./storico.js";
import { mostraTuttiPostit } from "./postit.js";
import { CAMPI, GRUPPI, operatori, senzaValore, nuovaCondizione, criteriVuoti, completa, attiva as avanzataAttiva,
  valuta, contesto, descrivi } from "./ricerca.js";
import { VERSIONE } from "./versione.js";

const { W, H } = GEOMETRIA;
const $ = s => document.querySelector(s);

// ------------------------------------------------------------ memoria del dispositivo
const memoria = {
  leggi(k) { try { return localStorage.getItem(`albero.${k}`); } catch { return null; } },
  scrivi(k, v) { try { localStorage.setItem(`albero.${k}`, v); } catch { /* niente */ } },
  togli(k) { try { localStorage.removeItem(`albero.${k}`); } catch { /* niente */ } },
};

function chiaveDalLink() {
  const m = location.hash.match(/^#([ml])=([A-Za-z0-9_-]{32,})$/);
  if (m) {
    const chiave = { tipo: m[1] === "m" ? "modifica" : "lettura", valore: m[2] };
    memoria.scrivi("chiave", JSON.stringify(chiave));
    return chiave;
  }
  try { return JSON.parse(memoria.leggi("chiave")); } catch { return null; }
}

function schermata(titolo, testo, attesa = false) {
  const a = $("#avvio");
  a.hidden = false;
  a.innerHTML = `<div class="avvio-scheda">${attesa ? '<div class="girandola"></div>' : '<div class="logo">🌳</div>'}
    <h1>${esc(titolo)}</h1><p>${testo}</p></div>`;
}

// ------------------------------------------------------------ stato
const S = {
  albero: null, scena: null, sel: null, selUnione: null,
  filtri: filtriVuoti(), isolamento: null, soloVisibili: false, ricompatta: null,
  provvisorie: { posizioni: {}, archi: {} }, pulire: false, evidenziati: new Set(), trovati: new Set(),
  // ricerca avanzata: i criteri in modifica nel pannello e quelli applicati all'albero
  avanzata: criteriVuoti(), avanzataApplicata: null, esitoAvanzata: null,
  postit: [],
  // «Cosa manca»: i filtri del pannello e lo scorrimento da ritrovare tornando da un modulo
  mancanti: { tipo: null, famiglia: null, scorrimento: 0 },
  // «Come siamo parenti?»: {fase: "scelta", primo} mentre si toccano le persone, {fase: "esito", a, b, esito} dopo
  parentela: null,
  pannello: null, primoDisegno: true,
};
let dati = null, vista = null, disposizione = null;

// ------------------------------------------------------------ pannello laterale, dialoghi, avvisi
function apriPannello(titolo, html, suAzione = null, prepara = null, contesto = {}) {
  const p = $("#pannello");
  // ridisegnando lo stesso pannello (la stessa scheda, la stessa ricerca) si resta dove si era
  const stesso = !p.hidden && S.pannello && Object.keys(contesto).length && Object.entries(contesto).every(([k, v]) => S.pannello[k] === v);
  p.hidden = false;
  document.body.classList.add("con-pannello");
  $("#pannello-titolo").textContent = titolo;
  const corpo = $("#pannello-corpo");
  const scorrimento = stesso ? corpo.scrollTop : 0;
  corpo.innerHTML = html;
  corpo.scrollTop = scorrimento;
  S.pannello = { suAzione, modulo: !!corpo.querySelector("form"), ...contesto };
  prepara?.(corpo);
  aggiornaParentela();
}

function chiudiPannello() {
  $("#pannello").hidden = true;
  document.body.classList.remove("con-pannello");
  S.pannello = null;
  aggiornaParentela();
}

$("#pannello-corpo").addEventListener("click", e => {
  const b = e.target.closest("[data-azione]");
  if (b && S.pannello?.suAzione) { e.preventDefault(); S.pannello.suAzione(b.dataset.azione, b); }
});
$("#pannello-chiudi").addEventListener("click", () => { chiudiPannello(); S.sel = null; S.selUnione = null; applicaClassi(); });

function dialogo(html, prepara) {
  return new Promise(risolvi => {
    const d = document.createElement("dialog");
    d.className = "dialogo";
    d.innerHTML = html;
    document.body.append(d);
    let fatto = false;
    const chiudi = v => { if (fatto) return; fatto = true; d.close(); d.remove(); risolvi(v); };
    d.addEventListener("cancel", e => { e.preventDefault(); chiudi(null); });
    d.addEventListener("click", e => { if (e.target === d) chiudi(null); });
    prepara?.(d, chiudi);
    d.showModal();
  });
}

function conferma(testo, ok = "Conferma", pericolo = false) {
  return dialogo(`<form method="dialog" class="modulo"><p>${esc(testo)}</p><div class="azioni">
    <button value="ok" class="${pericolo ? "pericolo" : "primario"}">${esc(ok)}</button><button value="no">Annulla</button></div></form>`,
  (d, chiudi) => d.querySelector("form").addEventListener("submit", e => { e.preventDefault(); chiudi(e.submitter?.value === "ok"); }));
}

function avviso(testo, tipo = "") {
  const a = document.createElement("div");
  a.className = `avviso ${tipo}`;
  a.textContent = testo;
  $("#avvisi").append(a);
  const durata = tipo === "errore" ? 7000 : 3200;          // un errore va letto fino in fondo
  setTimeout(() => a.classList.add("via"), durata);
  setTimeout(() => a.remove(), durata + 600);
}

function errore(err) {
  console.error(err);
  const permesso = /permission|insufficient/i.test(err?.message || "");
  avviso(permesso ? "Non salvato. Ricarica la pagina e riprova: se succede ancora, questo link non permette di modificare o è stato sostituito." :`Qualcosa non ha funzionato: ${err?.message || err}`, "errore");
}

// ------------------------------------------------------------ versione nuova
// Una pagina aperta da prima di una pubblicazione gira con il codice vecchio finché non la si
// ricarica: all'avvio, quando si torna sulla pagina e ogni mezz'ora si confronta la sua versione
// con versione.txt e, se è cambiata, si propone di ricaricare.
const versione = { controllata: 0, rinviata: 0 };

async function controllaVersione() {
  const ora = Date.now();
  if (VERSIONE === "sviluppo" || !$("#versione").hidden || ora - versione.controllata < 60_000 || ora < versione.rinviata) return;
  versione.controllata = ora;
  try {
    const r = await fetch("versione.txt", { cache: "no-store" });
    const pubblicata = r.ok ? (await r.text()).trim() : "";
    if (pubblicata && pubblicata !== VERSIONE) $("#versione").hidden = false;
  } catch { /* fuori linea: si riprova al prossimo ritorno sulla pagina */ }
}

// ricaricare la pagina non basta: per qualche minuto dopo la pubblicazione il browser terrebbe
// i file vecchi in memoria; prima li si riprende dalla rete, poi si ricarica. La pagina riparte
// com'era (vedi istantanea), una volta sola: ricaricando dal browser si riparte da capo.
const RIPRISTINO = "albero.ripristino";

async function ricarica() {
  if ((S.pannello?.modulo || document.querySelector("dialog[open]"))
    && !(await conferma("Ricaricando perdi quello che stai scrivendo e non hai ancora salvato. Ricarico adesso?", "Ricarica"))) return;
  const file = performance.getEntriesByType("resource").map(e => e.name)
    .filter(u => u.startsWith(location.origin) && /\.(js|css)$/.test(new URL(u).pathname));
  await Promise.allSettled(file.map(u => fetch(u, { cache: "reload" })));
  try { sessionStorage.setItem(RIPRISTINO, JSON.stringify(istantanea())); } catch { /* si riparte da capo */ }
  location.reload();
}

// lo stato della pagina che si può rifare: inquadratura, selezione, filtri, isolamento, ricerche,
// Disposizione e il pannello aperto (di un modulo a metà resta la scheda da cui era partito)
function istantanea() {
  const p = S.pannello;
  return {
    quando: Date.now(),
    vista: S.scena ? vista.inquadratura() : null,
    sel: S.sel, selUnione: S.selUnione,
    filtri: Object.fromEntries(Object.entries(S.filtri).map(([k, v]) => [k, [...v]])),
    isolamento: S.isolamento, soloVisibili: S.soloVisibili, ricompatta: !!S.ricompatta,
    avanzata: S.avanzata, avanzataApplicata: S.avanzataApplicata,
    cerca: $("#cerca").value, trovati: [...S.trovati],
    disposizione: !$("#attrezzi").hidden,
    mancanti: { tipo: S.mancanti.tipo, famiglia: S.mancanti.famiglia },
    parentela: S.parentela && { fase: S.parentela.fase, primo: S.parentela.primo || null, a: S.parentela.a || null, b: S.parentela.b || null },
    // un modulo aperto da «Cosa manca» torna all'elenco, dov'era
    pannello: !p ? null : p.modulo && p.da === "mancanti" ? { tipo: "mancanti" }
      : p.modulo ? { persona: typeof p.di === "string" ? p.di : S.sel, unione: S.sel ? null : S.selUnione }
      : { persona: p.persona, unione: typeof p.unione === "string" ? p.unione : null, tipo: p.tipo },
    scorrimento: p?.modulo && p.da === "mancanti" ? S.mancanti.scorrimento : $("#pannello-corpo").scrollTop,
  };
}

// letta e cancellata subito, perché valga per questo caricamento soltanto
const daRipristinare = (() => {
  try {
    const r = JSON.parse(sessionStorage.getItem(RIPRISTINO));
    sessionStorage.removeItem(RIPRISTINO);
    return r && Date.now() - r.quando < 5 * 60_000 ? r : null;
  } catch { return null; }
})();

async function ripristinaStato(r) {
  const ix = S.scena.ix;
  const rp = r.parentela;
  if (rp?.fase === "esito" && ix.persona.has(rp.a) && ix.persona.has(rp.b)) mostraParentela(rp.a, rp.b, { inquadra: false, pannello: false });
  else if (rp?.fase === "scelta") { attivaParentela(); if (ix.persona.has(rp.primo)) S.parentela.primo = rp.primo; aggiornaParentela(); }
  S.sel = ix.persona.has(r.sel) ? r.sel : null;
  S.selUnione = ix.unione.has(r.selUnione) ? r.selUnione : null;
  S.filtri = Object.fromEntries(Object.entries(filtriVuoti()).map(([k, v]) => [k, new Set(r.filtri?.[k] || v)]));
  S.isolamento = r.isolamento;
  S.soloVisibili = !!r.soloVisibili;
  if (r.avanzata) S.avanzata = r.avanzata;
  S.avanzataApplicata = r.avanzataApplicata;
  $("#cerca").value = r.cerca || "";
  S.trovati = new Set(r.trovati || []);
  S.mancanti = { tipo: r.mancanti?.tipo || null, famiglia: r.mancanti?.famiglia || null, scorrimento: 0 };
  applicaClassi();
  if (r.ricompatta && S.isolamento && S.soloVisibili) ricompatta(true);
  if (r.disposizione && ctx.modifica) attivaDisposizione(true, { spiega: false });
  if (r.vista) vista.ripristina(r.vista); else inquadraVisibili({ animato: false, kMax: ZOOM_PIENO });
  const p = r.pannello;
  if (p?.persona && ix.persona.has(p.persona)) mostraPersona(ctx, p.persona);
  else if (p?.unione && ix.unione.has(p.unione)) mostraUnione(ctx, p.unione);
  else if (p?.tipo === "filtri") mostraFiltri();
  else if (p?.tipo === "avanzata") mostraAvanzata();
  else if (p?.tipo === "esporta") mostraEsporta();
  else if (p?.tipo === "menu") mostraMenu();
  else if (p?.tipo === "postit") mostraTuttiPostit(ctx);
  else if (p?.tipo === "mancanti") mostraMancanti();
  else if (p?.tipo === "parentela") mostraPannelloParentela();
  else if (p?.tipo === "storico" && ctx.modifica) await mostraStorico(ctx);
  if (S.pannello) $("#pannello-corpo").scrollTop = r.scorrimento || 0;
  avviso("Albero aggiornato alla versione nuova.");
}

$("#versione").addEventListener("click", e => {
  const b = e.target.closest("[data-versione]");
  if (b?.dataset.versione === "ricarica") ricarica();
  if (b?.dataset.versione === "dopo") { $("#versione").hidden = true; versione.rinviata = Date.now() + 30 * 60_000; }
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") controllaVersione(); });
window.addEventListener("focus", controllaVersione);
setInterval(controllaVersione, 30 * 60_000);

// ------------------------------------------------------------ disegno
function ridisegna() {
  if (!S.albero) return;
  const posizioni = { ...(S.ricompatta || {}), ...S.provvisorie.posizioni };
  S.scena = componiScena(S.albero, { posizioni, archi: S.provvisorie.archi, soloAutomatico: !!S.ricompatta });
  vista.disegna(S.scena);
  applicaClassi();
  disposizione.disegnaManiglie();
}

const risultatiAvanzati = criteri => (S.scena && avanzataAttiva(criteri) ? valuta(S.albero, contesto(S.scena, new Date(), S.postit), criteri) : null);

function applicaClassi() {
  if (!S.scena) return;
  S.esitoAvanzata = risultatiAvanzati(S.avanzataApplicata);
  const v = visibilita(S.albero, S.scena, S.filtri, S.isolamento, S.soloVisibili, new Date(), S.esitoAvanzata);
  S.dentro = v.dentro;
  // chi passa la ricerca avanzata (e i filtri) brilla come i risultati della ricerca veloce
  const trovati = S.esitoAvanzata ? new Set([...S.trovati, ...v.dentro]) : S.trovati;
  // con la parentela in vista si illumina il percorso e il resto si attenua, sopra filtri e isolamento
  const P = S.parentela, E = P?.fase === "esito" ? P.esito : null;
  const attenuati = E ? new Set(S.scena.nodi.map(n => n.id).filter(id => !E.persone.has(id))) : v.attenuati;
  vista.classi({ selezionata: S.sel, unioneSelezionata: S.selUnione, arcoSelezionato: disposizione.stato().arcoSel,
    attenuati, nascosti: E ? new Set() : v.nascosti, evidenziati: S.evidenziati, trovati,
    percorso: E, scelti: new Set(E ? [E.a, E.b] : P?.primo ? [P.primo] : []) });
  aggiornaNastro();
  $("#b-avanzata")?.classList.toggle("attiva", !!S.esitoAvanzata);
  aggiornaEsitiAvanzata();
}

// Spazio coperto da intestazioni delle generazioni (a sinistra) e pannello aperto
// (a destra sullo schermo largo, in basso sul telefono).
function riserva() {
  const sinistra = vista.larghezzaTestate();
  const p = $("#pannello");
  if (p.hidden) return { sinistra, destra: 0, basso: 0 };
  const r = p.getBoundingClientRect(), area = $("#tela").getBoundingClientRect();
  return innerWidth > 760 ? { sinistra, destra: Math.max(0, area.right - r.left + 10), basso: 0 } : { sinistra, destra: 0, basso: Math.max(0, area.bottom - r.top) };
}

const ZOOM_PIENO = 1.2;          // inquadrando non si va oltre i riquadri a grandezza piena
const ingombro = nodi => ({ x: Math.min(...nodi.map(n => n.x)), y: Math.min(...nodi.map(n => n.cima)),
  x2: Math.max(...nodi.map(n => n.x + W)), y2: Math.max(...nodi.map(n => n.cima + n.h)) });

// Inquadra un gruppo di persone stretto, con un piccolo margine. Si avvicina fino alla
// grandezza piena, o fino allo zoom attuale se è già più vicino: mai oltre.
function inquadraPersone(ids, { animato = true, kMax = Math.max(ZOOM_PIENO, vista.scala()) } = {}) {
  const nodi = S.scena.nodi.filter(n => ids.has(n.id));
  if (!nodi.length) return;
  vista.inquadra(ingombro(nodi), { animato, kMax, ...riserva() });
}

function inquadraVisibili(opzioni = {}) {
  if (!S.scena) return;
  if (S.dentro) inquadraPersone(S.dentro, opzioni);
  else if (S.scena.nodi.length) vista.inquadra(ingombro(S.scena.nodi), { animato: opzioni.animato ?? true, kMax: opzioni.kMax ?? ZOOM_PIENO, ...riserva() });
}

// ------------------------------------------------------------ selezione e isolamento
function seleziona(id, { centra = false, pannello = true } = {}) {
  S.sel = id;
  S.selUnione = null;
  applicaClassi();
  if (!id) { chiudiPannello(); return; }
  if (pannello) mostraPersona(ctx, id);
  if (centra) {
    const n = S.scena.nodi.find(x => x.id === id);
    if (n) vista.centraSu(n.x + W / 2, n.y + H / 2, riserva());
    S.evidenziati = new Set([id]);
    applicaClassi();
    setTimeout(() => { S.evidenziati = new Set(); applicaClassi(); }, 1800);
  }
}

// Apre la scheda di una persona o di un'unione; con «postit» scorre fino ai post-it.
function apriNodo(id, tipo, { centra = false, postit = false } = {}) {
  if (tipo === "persona") seleziona(id, { centra });
  else {
    S.sel = null;
    S.selUnione = id;
    applicaClassi();
    mostraUnione(ctx, id);
    const u = S.scena.unioni.find(x => x.id === id);
    if (centra && u) vista.centraSu(u.x, u.y, riserva());
  }
  if (postit) $("#postit-scheda")?.scrollIntoView({ block: "start", behavior: "smooth" });
}

// ?nodo=<id> nell'indirizzo (le mail di notifica dei post-it): apre la scheda sui post-it,
// una volta sola, e toglie il parametro perché ricaricando non si riapra.
function apriDaIndirizzo() {
  const u = new URL(location.href);
  const id = u.searchParams.get("nodo");
  if (!id) return;
  u.searchParams.delete("nodo");
  history.replaceState(null, "", u.pathname + u.search + u.hash);
  const tipo = S.scena.ix.persona.has(id) ? "persona" : S.scena.ix.unione.has(id) ? "unione" : null;
  if (tipo) apriNodo(id, tipo, { centra: true, postit: true });
  else avviso("Il riquadro della notifica non è più nell'albero.");
}

// I post-it arrivano a parte: bollini sull'albero, contatore nella barra, pannelli aperti.
function aggiornaPostit() {
  const conteggi = new Map();
  for (const n of S.postit) conteggi.set(n.nodo, (conteggi.get(n.nodo) || 0) + 1);
  vista.postit(conteggi);
  const c = $("#b-postit .conta");
  c.textContent = S.postit.length;
  c.hidden = !S.postit.length;
  if (!S.scena) return;
  applicaClassi();
  const pan = S.pannello;
  if (!pan || pan.modulo || document.querySelector("dialog[open]")) return;
  if (pan.persona) mostraPersona(ctx, pan.persona);
  else if (pan.unione) mostraUnione(ctx, pan.unione);
  else if (pan.tipo === "postit") mostraTuttiPostit(ctx);
  else if (pan.tipo === "mancanti") mostraMancanti();
}

function isola(tipo, id) {
  S.isolamento = { tipo, id };
  S.ricompatta = null;
  applicaClassi();
  inquadraVisibili();
}

function togliIsolamento() {
  S.isolamento = null;
  if (S.ricompatta) { S.ricompatta = null; ridisegna(); }
  applicaClassi();
}

function ricompatta(si) {
  if (si && S.dentro) {
    const esito = impagina(ingressoLayout(S.albero, [...S.dentro]));
    S.ricompatta = Object.fromEntries(Object.entries(esito.persone).map(([id, p]) => [id, { x: Math.round(p.x), y: Math.round(p.y) }]));
  } else S.ricompatta = null;
  ridisegna();
  inquadraVisibili();
}

// ------------------------------------------------------------ nastro: legenda, isolamento, stato
function aggiornaNastro() {
  if (!S.scena) return;
  const fam = S.filtri.famiglie;
  const chips = S.scena.ceppi.map(c => `<button type="button" class="chip legenda${fam.has(c.cognome) ? " attiva" : ""}" data-famiglia="${esc(c.cognome)}" style="--c:${esc(c.riempimento)};--b:${esc(c.bordo)}">${esc(c.cognome)}</button>`).join("")
    + `<button type="button" class="chip legenda${fam.has(ALTRI) ? " attiva" : ""}" data-famiglia="${ALTRI}" style="--c:#fff;--b:#666">altri</button>`;
  const iso = S.isolamento ? `<span class="pillola">${esc(descriviIsolamento(S.scena, S.isolamento))}<button type="button" data-nastro="togli-isola" title="Togli l'isolamento">✕</button></span>` : "";
  const fil = attivi(S.filtri) ? `<span class="pillola">Filtri attivi<button type="button" data-nastro="azzera" title="Azzera i filtri">✕</button></span>` : "";
  const n = S.esitoAvanzata?.size;
  const avz = S.esitoAvanzata ? `<span class="pillola"><button type="button" class="testo" data-nastro="apri-avanzata" title="${esc(descrivi(S.avanzataApplicata, contesto(S.scena)))}">Ricerca avanzata: ${n === 1 ? "1 persona" : `${n} persone`}</button><button type="button" data-nastro="togli-avanzata" title="Togli la ricerca avanzata">✕</button></span>` : "";
  const qualcosa = S.isolamento || attivi(S.filtri) || S.esitoAvanzata;
  const modo = qualcosa ? `<label class="spunta piccola"><input type="checkbox" data-nastro="solo"${S.soloVisibili ? " checked" : ""}> mostra solo</label>`
    + (S.soloVisibili && S.isolamento ? `<label class="spunta piccola"><input type="checkbox" data-nastro="ricompatta"${S.ricompatta ? " checked" : ""}> ricompatta</label>` : "") : "";
  $("#nastro").innerHTML = `<div class="legenda-chips">${chips}</div><div class="nastro-stato">${iso}${avz}${fil}${modo}</div>`;
}

$("#nastro").addEventListener("click", e => {
  const f = e.target.closest("[data-famiglia]");
  if (f) {
    const s = S.filtri.famiglie;
    s.has(f.dataset.famiglia) ? s.delete(f.dataset.famiglia) : s.add(f.dataset.famiglia);
    applicaClassi();
    if (S.pannello?.tipo === "filtri") mostraFiltri();
    if (S.dentro) inquadraVisibili();
    return;
  }
  const b = e.target.closest("[data-nastro]");
  if (!b || b.tagName === "INPUT") return;
  if (b.dataset.nastro === "togli-isola") togliIsolamento();
  if (b.dataset.nastro === "azzera") { S.filtri = filtriVuoti(); applicaClassi(); if (S.pannello?.tipo === "filtri") mostraFiltri(); }
  if (b.dataset.nastro === "apri-avanzata") mostraAvanzata();
  if (b.dataset.nastro === "togli-avanzata") {
    S.avanzata = criteriVuoti();
    applicaAvanzata();
    if (S.pannello?.tipo === "avanzata") mostraAvanzata();
  }
});
$("#nastro").addEventListener("change", e => {
  const n = e.target.dataset.nastro;
  if (n === "solo") { S.soloVisibili = e.target.checked; if (!S.soloVisibili && S.ricompatta) ricompatta(false); applicaClassi(); }
  if (n === "ricompatta") ricompatta(e.target.checked);
});

// ------------------------------------------------------------ filtri
function mostraFiltri() {
  const f = S.filtri;
  const gruppo = (titolo, nome, voci, insieme) => `<section><h3>${titolo}</h3><div class="chips">${voci.map(([v, testo, stile]) =>
    `<button type="button" class="chip filtro${insieme.has(v) ? " attiva" : ""}" data-azione="filtro" data-gruppo="${nome}" data-valore="${esc(v)}"${stile ? ` style="${stile}"` : ""}>${esc(testo)}</button>`).join("")}</div></section>`;
  const famiglie = [...S.scena.ceppi.map(c => [c.cognome, c.cognome, `--c:${c.riempimento};--b:${c.bordo}`]), [ALTRI, "altri cognomi", "--c:#fff;--b:#666"]];
  const generazioni = S.scena.fasce.map(x => [String(x.g), `${x.titolo}${x.stima ? " (stima)" : ""}`]);
  const gen = new Set([...f.generazioni].map(String));
  apriPannello("Filtri", `<div class="filtri">
    <p class="spiegazione">Chi non corrisponde viene attenuato; con «mostra solo», nel nastro in alto, sparisce.</p>
    ${gruppo("Famiglia", "famiglie", famiglie, f.famiglie)}
    ${gruppo("Generazione", "generazioni", generazioni, gen)}
    ${gruppo("In vita", "vita", VOCI_VITA, f.vita)}
    ${gruppo("Dati da completare", "mancanti", Object.entries(MANCANTI).map(([k, v]) => [k, v.testo]), f.mancanti)}
    <p class="spiegazione">Per combinare condizioni su tutti i campi c'è la <button type="button" class="collegamento" data-azione="avanzata">ricerca avanzata</button>.</p>
    <div class="azioni"><button type="button" data-azione="azzera">Azzera i filtri</button></div></div>`, (azione, el) => {
    if (azione === "avanzata") return mostraAvanzata();
    if (azione === "azzera") S.filtri = filtriVuoti();
    if (azione === "filtro") {
      const g = el.dataset.gruppo;
      const v = g === "generazioni" ? Number(el.dataset.valore) : el.dataset.valore;
      S.filtri[g].has(v) ? S.filtri[g].delete(v) : S.filtri[g].add(v);
    }
    applicaClassi();
    mostraFiltri();
    if (azione === "filtro" && S.dentro) inquadraVisibili();
  }, null, { tipo: "filtri" });
}

// ------------------------------------------------------------ cosa manca
// Quello che non si sa, dalle generazioni più vecchie: chi ha il link di lettura tocca «Lo so io»
// e manda il suggerimento già impostato, chi modifica tocca «Completa». L'elenco segue i dati e
// i post-it; filtri per tipo di dato e per famiglia, con le date di nascita note per famiglia.
const ORDINALI = ["Prima", "Seconda", "Terza", "Quarta", "Quinta", "Sesta", "Settima", "Ottava", "Nona", "Decima"];

// centra sull'albero senza lasciare il pannello aperto
function centraNodo(id, tipo) {
  if (tipo === "persona") return seleziona(id, { centra: true, pannello: false });
  S.sel = null;
  S.selUnione = id;
  applicaClassi();
  const u = S.scena.unioni.find(x => x.id === id);
  if (u) vista.centraSu(u.x, u.y, riserva());
}

function mostraMancanti() {
  if (!S.scena) return;
  const M = S.mancanti, ix = S.scena.ix;
  const { voci, fasce, famiglie, totali } = cosaManca(S.albero, S.scena, S.postit);
  const intere = new Map(voci.map(v => [v.nodo, v]));
  const dellaFamiglia = scegli(voci, { famiglia: M.famiglia });
  const mostrate = scegli(dellaFamiglia, { tipo: M.tipo });
  const ceppo = cognome => ix.ceppi.get(cognome);
  const colore = cognome => (ceppo(cognome) ? `--c:${ceppo(cognome).riempimento};--b:${ceppo(cognome).bordo}` : "--c:#fff;--b:#666");
  const percento = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const nomeFamiglia = cognome => (cognome === ALTRI ? "altri cognomi" : cognome);

  const famiglieHtml = famiglie.map(f => `<button type="button" class="famiglia-manca${M.famiglia === f.cognome ? " attiva" : ""}" data-azione="famiglia" data-famiglia="${esc(f.cognome)}" style="${colore(f.cognome)}" aria-pressed="${M.famiglia === f.cognome}">
      <span class="nome-famiglia">${esc(nomeFamiglia(f.cognome))}</span><span class="conto">${f.date} ${f.date === 1 ? "data" : "date"} su ${f.totale}</span>
      <span class="avanzamento"><i style="width:${percento(f.date, f.totale)}%"></i></span></button>`).join("");
  const quante = t => dellaFamiglia.filter(v => v.manca.some(m => m.tipo === t)).length;
  const tipi = [[null, "Tutto", dellaFamiglia.length], ...TIPI.map(([t, testo]) => [t, testo, quante(t)])]
    .map(([t, testo, n]) => `<button type="button" class="chip filtro${M.tipo === t ? " attiva" : ""}" data-azione="tipo" data-tipo="${t || ""}">${esc(testo)} · ${n}</button>`).join("");

  const voce = v => {
    const i = mostrate.indexOf(v), c = ceppo(v.famiglia);
    const pallino = `<span class="pallino" style="background:${c?.riempimento || "#fff"};border-color:${c?.bordo || "#666"}${v.ignoto ? ";border-style:dashed" : ""}"></span>`;
    const dati = v.manca.map(m => `<span class="dato-manca${m.attesa ? " in-attesa" : ""}">${esc(m.testo)}${m.attesa ? `<small>suggerito da ${esc(m.attesa)}</small>` : ""}</span>`).join("");
    const postit = v.postit ? `<button type="button" class="collegamento" data-azione="postit" data-i="${i}">${v.postit} post-it</button>` : "";
    return `<li class="voce-manca${v.manca.every(m => m.attesa) ? " coperta" : ""}">
      <button type="button" class="nome-voce${v.ignoto ? " ignoto" : ""}" data-azione="vai" data-i="${i}" title="Mostra sull'albero">${pallino}<span>${esc(v.nome)}${v.morto ? " †" : ""}</span></button>
      ${v.riconoscimento ? `<div class="riconosci">${esc(v.riconoscimento)}</div>` : ""}
      <div class="riga-manca"><div class="dati-manca"><span class="etichetta">manca</span>${dati}</div>
        <div class="azioni-voce">${postit}<button type="button" class="lo-so" data-azione="loso" data-i="${i}">${ctx.modifica ? "Completa" : "Lo so io"}</button></div></div></li>`;
  };
  const gruppi = new Map();
  for (const v of mostrate) gruppi.set(v.g, [...(gruppi.get(v.g) || []), v]);
  const sezioni = [...gruppi].map(([g, lista]) => {
    const f = fasce.find(x => x.g === g);
    const titolo = g === undefined ? "Fuori dalle generazioni" : `${ORDINALI[g] || `${g + 1}ª`} generazione`;
    const sotto = f ? `${f.titolo}${f.anni ? `, ${f.anni}` : ""}` : "";
    const nota = f?.stima && lista.some(v => v.manca.some(m => m.campo === "nascita"))
      ? `<p class="nota-fascia">Il nome «${esc(f.titolo)}» è una stima: basta una data di nascita di questa generazione per renderlo certo.</p>` : "";
    return `<section class="fascia-manca"><h3>${titolo}${sotto ? ` <span>· ${esc(sotto)}</span>` : ""}</h3>${nota}
      <ul class="voci-manca">${lista.map(voce).join("")}</ul></section>`;
  }).join("");
  const vuoto = !voci.length ? "Non manca niente: l'albero è completo." : "Qui non manca niente.";
  const soloFamiglia = M.famiglia ? `<p class="spiegazione">Solo ${M.famiglia === ALTRI ? "gli altri cognomi" : `la famiglia ${esc(M.famiglia)}`} · <button type="button" class="collegamento" data-azione="tutte-famiglie">tutte le famiglie</button></p>` : "";

  apriPannello("Cosa manca", `<div class="mancanti">
    <p class="spiegazione">${ctx.modifica
      ? "Quello che ancora manca nell'albero, dalle generazioni più vecchie. «Completa» apre la scheda con il cursore sul dato. Chi ha il link di lettura vede lo stesso elenco e con «Lo so io» manda un suggerimento."
      : "Qui c'è quello che ancora non sappiamo, cominciando dalle generazioni più vecchie. Se sai qualcosa, anche solo un anno, tocca «Lo so io»: chi cura l'albero vedrà il tuo suggerimento e lo aggiungerà."}</p>
    <div class="riepilogo-manca"><p>Sappiamo la data di nascita di <b>${totali.date}</b> ${totali.date === 1 ? "persona" : "persone"} su <b>${totali.totale}</b>.</p>
      <span class="avanzamento"><i style="width:${percento(totali.date, totali.totale)}%"></i></span></div>
    <section><h3>Date di nascita per famiglia</h3><div class="famiglie-manca">${famiglieHtml}</div></section>
    <div class="chips tipi-manca">${tipi}</div>
    ${soloFamiglia}
    ${sezioni || `<p class="vuoto">${vuoto}</p>`}</div>`, (azione, el) => {
    if (azione === "tipo") { M.tipo = el.dataset.tipo || null; return mostraMancanti(); }
    if (azione === "famiglia") { M.famiglia = M.famiglia === el.dataset.famiglia ? null : el.dataset.famiglia; return mostraMancanti(); }
    if (azione === "tutte-famiglie") { M.famiglia = null; return mostraMancanti(); }
    const v = mostrate[Number(el.dataset.i)];
    if (!v) return;
    if (azione === "vai") return centraNodo(v.nodo, v.tipo);
    if (azione === "postit") return apriNodo(v.nodo, v.tipo, { centra: true, postit: true });
    if (azione === "loso") {
      M.scorrimento = $("#pannello-corpo").scrollTop;
      const torna = () => { mostraMancanti(); $("#pannello-corpo").scrollTop = M.scorrimento; };
      completaDaElenco(ctx, intere.get(v.nodo), { primo: v.manca[0]?.campo, torna });
    }
  }, null, { tipo: "mancanti" });
}

// ------------------------------------------------------------ come siamo parenti
// Si attiva il pulsante e si toccano due persone sull'albero, o le si cerca nella casella:
// l'albero illumina il percorso fra loro e il pannello dice la parentela nei due versi. Lo
// stesso pulsante diventa «Annulla» mentre si sceglie e «Nascondi parentela» col risultato.
function aggiornaParentela() {
  const P = S.parentela, b = $("#b-parentela"), g = $("#guida-parentela");
  document.body.classList.toggle("in-parentela", !!P);
  b.classList.toggle("attiva", !!P);
  b.querySelector("span").textContent = !P ? "Parentela" : P.fase === "scelta" ? "Annulla" : "Nascondi parentela";
  b.title = !P ? "Come siamo parenti? Tocca due persone" : P.fase === "scelta" ? "Smetti di scegliere" : "Togli il percorso dall'albero";
  // la guida sull'albero: che cosa toccare, poi la risposta breve quando il pannello non la mostra già
  if (!P || (P.fase === "esito" && S.pannello?.tipo === "parentela")) { g.hidden = true; return; }
  g.hidden = false;
  const primo = P.primo && S.scena?.ix.persona.get(P.primo);
  g.innerHTML = P.fase === "esito" ? `<span class="titolo-parentela">${esc(P.esito.titolo)}</span><button type="button" data-parentela="dettagli">Dettagli</button>`
    : primo ? `<b>Ora tocca la seconda persona.</b><span>La prima è ${esc(nomeCompleto(primo))}: toccala di nuovo per cambiarla.</span>`
    : `<b>Tocca la prima persona.</b><span>Puoi anche cercarla nella casella in alto.</span>`;
}

function attivaParentela() {
  if (disposizione.attivo) attivaDisposizione(false);
  chiudiPannello();
  S.sel = null;
  S.selUnione = null;
  S.parentela = { fase: "scelta", primo: null };
  applicaClassi();
  aggiornaParentela();
}

function nascondiParentela() {
  const pannello = S.pannello?.tipo === "parentela";
  S.parentela = null;
  if (pannello) chiudiPannello();
  applicaClassi();
  aggiornaParentela();
}

// un tocco sull'albero mentre si sceglie: solo le persone contano, la prima ritoccata si toglie
function scegliPerParentela(b) {
  const P = S.parentela, ix = S.scena.ix;
  const id = b.tipo === "persona" || (b.tipo === "postit" && ix.persona.has(b.id)) ? b.id : null;
  if (!id) { if (b.tipo !== "vuoto") avviso("Tocca il riquadro di una persona."); return; }
  if (ix.persona.get(id).segnaposto) { avviso("Questo riquadro sta per i figli non noti: scegli una persona."); return; }
  if (!P.primo) P.primo = id;
  else if (P.primo === id) P.primo = null;
  else return mostraParentela(P.primo, id);
  applicaClassi();
  aggiornaParentela();
}

function mostraParentela(a, b, { inquadra = true, pannello = true } = {}) {
  S.parentela = { fase: "esito", a, b, esito: comeSiamoParenti(S.albero, a, b, S.scena.ix) };
  if (S.ricompatta) { S.ricompatta = null; ridisegna(); }
  S.sel = null;
  S.selUnione = null;
  applicaClassi();
  if (pannello) mostraPannelloParentela();
  aggiornaParentela();
  if (inquadra) {
    inquadraPersone(new Set(S.parentela.esito.persone));
    setTimeout(() => vista.increspa(new Set([a, b])), 120);
  }
}

// i dati sono cambiati: la risposta si rifà, o sparisce se una delle due persone non c'è più
function ricalcolaParentela() {
  const P = S.parentela, ix = S.scena.ix;
  if (!P) return;
  if (P.fase === "scelta") { if (P.primo && !ix.persona.has(P.primo)) P.primo = null; return aggiornaParentela(); }
  if (!ix.persona.has(P.a) || !ix.persona.has(P.b)) { avviso("Una delle due persone non è più nell'albero."); return nascondiParentela(); }
  P.esito = comeSiamoParenti(S.albero, P.a, P.b, ix);
  aggiornaParentela();
}

function mostraPannelloParentela() {
  const P = S.parentela;
  if (P?.fase !== "esito") return;
  const e = P.esito, ix = S.scena.ix;
  const nome = id => nomeCompleto(ix.persona.get(id));
  const elenco = ids => ids.map((id, i) => `${i === 0 ? "" : i === ids.length - 1 ? ` ${ed(nome(id))} ` : ", "}<button type="button" class="collegamento" data-azione="vai" data-id="${esc(id)}">${esc(nome(id))}</button>`).join("");
  const freccia = { su: "↑", giu: "↓", partner: "↔", fratello: "↔" };
  const passi = e.passi.map((p, i) => `<li><span class="verso" aria-hidden="true">${i ? freccia[p.verso] : "●"}</span>`
    + `${p.parola ? `<span class="parola">${esc(p.parola)}</span>` : ""}<span>${elenco(p.ids)}</span></li>`).join("");
  const dubbi = e.dubbi.length ? `<p class="spiegazione">Di ${elenco(e.dubbi)} la scheda non dice il sesso e il nome non basta a capirlo: per questo alcune parole sono doppie.${ctx.modifica ? "" : " Se lo sai, suggeriscilo dalla scheda."}</p>` : "";
  const gradi = e.tipo === "sangue" || e.tipo === "affini"
    ? `<p class="spiegazione">I gradi si contano come nel Codice civile: si sale da una persona fino all'antenato in comune e si scende fino all'altra, senza contare l'antenato.</p>` : "";
  apriPannello("Come siamo parenti?", `<div class="parentela">
    <p class="risposta">${esc(e.titolo)}</p>
    ${e.frase !== e.titolo ? `<p class="catena">${esc(e.frase)}</p>` : ""}
    ${e.inversa ? `<p class="inversa">${esc(e.inversa)}</p>` : ""}
    ${e.spiegazione ? `<p class="spiegazione">${esc(e.spiegazione)}</p>` : ""}
    ${e.grado ? `<p class="grado">${esc(e.grado)}</p>` : ""}
    ${e.stipiti.length ? `<p class="stipite">${e.stipiti.length > 1 ? "Antenati in comune" : "Antenato in comune"}: ${elenco(e.stipiti)}</p>` : ""}
    ${passi ? `<section><h3>Il percorso sull'albero</h3><ol class="passi-parentela">${passi}</ol></section>` : ""}
    ${dubbi}${gradi}
    <div class="azioni"><button type="button" class="primario" data-azione="altre">Scegli altre due persone</button></div>
  </div>`, (azione, el) => {
    if (azione === "vai") return centraNodo(el.dataset.id, "persona");
    if (azione === "altre") return attivaParentela();
  }, null, { tipo: "parentela" });
}

// ------------------------------------------------------------ ricerca
const ATTESA_RICERCA = 750;      // ms dall'ultimo tasto prima di evidenziare e inquadrare

const perCognome = (a, b) => (a.cognome || "￿").localeCompare(b.cognome || "￿", "it") || (a.nome || "").localeCompare(b.nome || "", "it");

function rigaPersona(p) {
  const c = S.scena.ix.ceppi.get(p.cognome);
  const n = annoDi(p.nascita?.data), m = annoDi(p.morte?.data);
  return `<span class="pallino" style="background:${c?.riempimento || "#fff"};border-color:${c?.bordo || "#666"}"></span>`
    + `<span class="nome-esito">${esc(nomeCompleto(p))}${statoInVita(p) === "no" ? " †" : ""}</span>`
    + (n || m ? `<span class="anni">${n || "?"}${m ? `–${m}` : ""}</span>` : "");
}

// ------------------------------------------------------------ ricerca avanzata
// I criteri si modificano nel pannello e si applicano all'albero subito per scelte e
// pulsanti, dopo una pausa mentre si scrive; poi la vista inquadra i risultati e li increspa.
let attesaAvanzata = null;
function applicaAvanzata(ritardo = 0) {
  clearTimeout(attesaAvanzata);
  attesaAvanzata = setTimeout(() => {
    S.avanzataApplicata = avanzataAttiva(S.avanzata) ? structuredClone(S.avanzata) : null;
    applicaClassi();
    if (S.esitoAvanzata && S.dentro?.size) {
      const ids = new Set(S.dentro);
      inquadraPersone(ids);
      setTimeout(() => vista.increspa(ids), 120);
    }
  }, ritardo);
}

function htmlEsitiAvanzata() {
  const ids = risultatiAvanzati(S.avanzata);
  if (!ids) return `<p class="spiegazione">Compila almeno una condizione: quelle a metà, col bordo tratteggiato, non contano.</p>`;
  const persone = S.albero.persone.filter(p => ids.has(p.id)).sort(perCognome);
  if (!persone.length) return `<h3>Risultati</h3><p class="spiegazione">Nessuna persona corrisponde.</p>`;
  const altri = [attivi(S.filtri) && "i filtri", S.isolamento && "l'isolamento"].filter(Boolean);
  const anche = altri.length ? `<p class="spiegazione">Sull'albero ${attivi(S.filtri) ? "contano" : "conta"} anche ${altri.join(" e ")}; questo elenco no.</p>` : "";
  return `<h3>${persone.length === 1 ? "1 persona" : `${persone.length} persone`}</h3>${anche}
    <ul class="esiti">${persone.map(p => `<li><button type="button" class="esito" data-azione="vai" data-id="${esc(p.id)}">${rigaPersona(p)}</button>
      <button type="button" class="collegamento" data-azione="scheda" data-id="${esc(p.id)}">scheda</button></li>`).join("")}</ul>
    <div class="azioni"><button type="button" data-azione="csv">Scarica i risultati in CSV</button></div>`;
}

function aggiornaEsitiAvanzata() {
  const el = document.querySelector("#pannello-corpo .esiti-avanzata");
  if (el && S.pannello?.tipo === "avanzata") el.innerHTML = htmlEsitiAvanzata();
}

function mostraAvanzata({ fuoco = null } = {}) {
  if (!S.scena) return;
  const A = S.avanzata, cx = contesto(S.scena);
  const corpo = $("#pannello-corpo");
  const coloriCeppi = new Map(S.scena.ceppi.map(c => [c.cognome, `--c:${c.riempimento};--b:${c.bordo}`]));
  const persone = S.albero.persone.filter(p => !p.segnaposto).sort(perCognome);

  const sceltaCampo = (c, i) => `<select data-campo="${i}" aria-label="Campo">${GRUPPI.map(g => `<optgroup label="${esc(g)}">${Object.entries(CAMPI)
    .filter(([, x]) => x.gruppo === g).map(([k, x]) => `<option value="${k}"${k === c.campo ? " selected" : ""}>${esc(x.etichetta)}</option>`).join("")}</optgroup>`).join("")}</select>`;
  const sceltaOp = (c, i) => {
    const ops = operatori(c.campo);
    return ops.length === 1 ? `<span class="op-fisso">${esc(ops[0][1])}</span>`
      : `<select data-op="${i}" aria-label="Condizione">${ops.map(([id, t]) => `<option value="${id}"${id === c.op ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  };
  const valore = (c, i) => {
    const campo = CAMPI[c.campo];
    if (senzaValore(c.op) || campo.tipo === "elenco") return "";
    if (campo.tipo === "testo") return `<input data-valore="${i}" value="${esc(c.valore)}" placeholder="testo" autocomplete="off" enterkeyhint="search">`;
    if (campo.tipo === "persona") return `<select data-valore="${i}" aria-label="Persona"><option value="">scegli una persona…</option>${persone.map(p =>
      `<option value="${esc(p.id)}"${p.id === c.valore ? " selected" : ""}>${esc(nomeCompleto(p))}${annoDi(p.nascita?.data) ? ` (${annoDi(p.nascita.data)})` : ""}</option>`).join("")}</select>`;
    const segnaposto = campo.misura === "anno" ? "anno" : "numero";
    const campoNumero = (attr, v, ph) => `<input ${attr}="${i}" value="${esc(v)}" placeholder="${ph}" inputmode="numeric" autocomplete="off" enterkeyhint="search">`;
    return c.op === "tra" ? `${campoNumero("data-valore", c.valore, "da")}<span class="e">e</span>${campoNumero("data-valore2", c.valore2, "a")}`
      : campoNumero("data-valore", c.valore, segnaposto);
  };
  const scelte = (c, i) => {
    const campo = CAMPI[c.campo];
    if (campo.tipo !== "elenco") return "";
    return `<div class="chips">${campo.valori(cx).map(([v, t]) => {
      const stile = c.campo === "famiglia" ? coloriCeppi.get(v) || "--c:#fff;--b:#666" : "";
      return `<button type="button" class="chip filtro${c.valore.includes(v) ? " attiva" : ""}" data-azione="valore" data-i="${i}" data-v="${esc(v)}"${stile ? ` style="${stile}"` : ""}>${esc(t)}</button>`;
    }).join("")}</div>`;
  };
  const connettivo = `<div class="connettivo">${A.modo === "almeno" ? "oppure" : "e"}</div>`;
  const condizioni = A.condizioni.map((c, i) => `<div class="condizione${completa(c) ? "" : " incompleta"}" data-i="${i}">
      <div class="riga-cond">${sceltaCampo(c, i)}<button type="button" class="togli" data-azione="togli" data-i="${i}" title="Togli la condizione" aria-label="Togli la condizione">✕</button></div>
      <div class="riga-cond">${sceltaOp(c, i)}${valore(c, i)}</div>${scelte(c, i)}</div>`).join(connettivo);
  const modo = A.condizioni.length > 1 ? `<div class="schede-scelta">
      <label><input type="radio" name="modo" value="tutte"${A.modo !== "almeno" ? " checked" : ""}> Tutte le condizioni</label>
      <label><input type="radio" name="modo" value="almeno"${A.modo === "almeno" ? " checked" : ""}> Almeno una</label></div>` : "";

  apriPannello("Ricerca avanzata", `<div class="modulo avanzata">
    <p class="spiegazione">Cerca su tutti i campi, anche su età, legami e valori dedotti, e combina più condizioni. Chi corrisponde si illumina, gli altri si attenuano.</p>
    ${modo}<div class="condizioni">${condizioni}</div>
    <div class="azioni"><button type="button" data-azione="aggiungi">+ Aggiungi una condizione</button><button type="button" data-azione="azzera">Azzera</button></div>
    <section class="esiti-avanzata">${htmlEsitiAvanzata()}</section></div>`, (azione, el) => {
    const i = Number(el.dataset.i);
    if (azione === "aggiungi") {
      A.condizioni.push(nuovaCondizione());
      return mostraAvanzata({ fuoco: `[data-campo="${A.condizioni.length - 1}"]` });
    }
    if (azione === "togli") {
      A.condizioni.splice(i, 1);
      if (!A.condizioni.length) A.condizioni.push(nuovaCondizione());
    }
    if (azione === "azzera") S.avanzata = criteriVuoti();
    if (azione === "valore") {
      const c = A.condizioni[i], v = el.dataset.v;
      if (CAMPI[c.campo].unico) c.valore = c.valore.includes(v) ? [] : [v];
      else c.valore = c.valore.includes(v) ? c.valore.filter(x => x !== v) : [...c.valore, v];
    }
    if (azione === "vai") return seleziona(el.dataset.id, { centra: true, pannello: false });
    if (azione === "scheda") return seleziona(el.dataset.id);
    if (azione === "csv") {
      const ids = risultatiAvanzati(S.avanzata);
      if (ids?.size) scaricaTesto(aCSVPersone(S.albero, new Date(), ids), `ricerca-${oggiTesto()}.csv`, "text/csv");
      return;
    }
    mostraAvanzata();
    applicaAvanzata();
  }, c => {
    const radice = c.querySelector(".avanzata");
    radice.addEventListener("change", e => {
      const t = e.target;
      if (t.name === "modo") { A.modo = t.value; mostraAvanzata(); return applicaAvanzata(); }
      if (t.dataset.campo !== undefined) {
        A.condizioni[Number(t.dataset.campo)] = nuovaCondizione(t.value);
        mostraAvanzata({ fuoco: `[data-campo="${t.dataset.campo}"]` });
        return applicaAvanzata();
      }
      if (t.dataset.op !== undefined) {
        A.condizioni[Number(t.dataset.op)].op = t.value;
        mostraAvanzata({ fuoco: `[data-op="${t.dataset.op}"]` });
        return applicaAvanzata();
      }
      if (t.tagName === "SELECT" && t.dataset.valore !== undefined) {
        A.condizioni[Number(t.dataset.valore)].valore = t.value;
        mostraAvanzata();
        applicaAvanzata();
      }
    });
    // mentre si scrive si aggiornano bordo della condizione ed elenco; l'albero dopo una pausa
    radice.addEventListener("input", e => {
      const t = e.target;
      if (t.tagName !== "INPUT" || t.type === "radio") return;
      const k = t.dataset.valore ?? t.dataset.valore2;
      if (k === undefined) return;
      const cond = A.condizioni[Number(k)];
      cond[t.dataset.valore !== undefined ? "valore" : "valore2"] = t.value;
      t.closest(".condizione").classList.toggle("incompleta", !completa(cond));
      aggiornaEsitiAvanzata();
      applicaAvanzata(ATTESA_RICERCA);
    });
    radice.addEventListener("keydown", e => {
      if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); applicaAvanzata(); }
    });
  }, { tipo: "avanzata" });
  if (fuoco) corpo.querySelector(fuoco)?.focus();
}

// Apre la ricerca avanzata; se nella casella c'è un testo, diventa la prima condizione.
function apriAvanzata() {
  if (S.pannello?.tipo === "avanzata") return chiudiPannello();
  const campo = $("#cerca"), testo = campo.value.trim();
  const unica = S.avanzata.condizioni.length === 1 && !completa(S.avanzata.condizioni[0]);
  if (testo && unica) {
    S.avanzata.condizioni[0] = { ...nuovaCondizione("qualsiasi"), valore: testo };
    campo.value = "";
    campo.dispatchEvent(new Event("input"));
    applicaAvanzata();
  }
  mostraAvanzata({ fuoco: !testo && unica ? 'input[data-valore="0"]' : null });
}

function preparaRicerca() {
  const campo = $("#cerca"), lista = $("#risultati");
  let trovati = [], scelto = 0;
  const disegna = () => {
    lista.hidden = !trovati.length;
    lista.innerHTML = trovati.map(({ p, dove }, i) => {
      const c = S.scena.ix.ceppi.get(p.cognome);
      const n = annoDi(p.nascita?.data), m = annoDi(p.morte?.data);
      const anni = n || m ? ` <span class="anni">${n || "?"}${m ? `–${m}` : ""}</span>` : "";
      return `<li data-id="${esc(p.id)}" class="${i === scelto ? "scelto" : ""}"><span class="pallino" style="background:${c?.riempimento || "#fff"};border-color:${c?.bordo || "#666"}"></span>${esc(nomeCompleto(p))}${statoInVita(p) === "no" ? " †" : ""}${dove === "nome" ? "" : ` <span class="dove">${dove === "note" ? "nelle note" : "nel luogo"}</span>`}${anni}</li>`;
    }).join("");
  };
  // mentre si scrive, i risultati si evidenziano e la vista li inquadra; chi è trovato solo
  // nelle note o nei luoghi resta nell'elenco ma sull'albero si illumina solo se nessun nome corrisponde
  let attesa = null;
  const segna = tutti => {
    clearTimeout(attesa);
    const nelNome = tutti.filter(r => r.dove === "nome");
    const ids = new Set((nelNome.length ? nelNome : tutti).map(r => r.p.id));
    if (!ids.size) { S.trovati = ids; applicaClassi(); return; }
    attesa = setTimeout(() => {
      S.trovati = ids;
      applicaClassi();
      inquadraPersone(ids);
      setTimeout(() => vista.increspa(ids), 120);
    }, ATTESA_RICERCA);
  };
  const vai = r => {
    if (!r) return;
    campo.value = ""; trovati = []; disegna(); segna([]); campo.blur();
    if (S.parentela?.fase !== "scelta") return seleziona(r.p.id, { centra: true });
    const n = S.scena.nodi.find(x => x.id === r.p.id);
    if (n) vista.centraSu(n.x + W / 2, n.y + H / 2, riserva());
    scegliPerParentela({ tipo: "persona", id: r.p.id });
  };
  campo.addEventListener("input", () => {
    const tutti = S.albero ? cerca(S.albero, campo.value, { dettagli: true }) : [];
    trovati = tutti.slice(0, 8);
    scelto = 0;
    disegna();
    segna(tutti);
  });
  campo.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { scelto = Math.min(scelto + 1, trovati.length - 1); disegna(); e.preventDefault(); }
    if (e.key === "ArrowUp") { scelto = Math.max(scelto - 1, 0); disegna(); e.preventDefault(); }
    if (e.key === "Enter") vai(trovati[scelto]);
    if (e.key === "Escape") { campo.value = ""; trovati = []; disegna(); segna([]); campo.blur(); }
  });
  lista.addEventListener("pointerdown", e => { const li = e.target.closest("li"); if (li) { e.preventDefault(); vai(trovati.find(r => r.p.id === li.dataset.id)); } });
  campo.addEventListener("blur", () => setTimeout(() => { lista.hidden = true; }, 150));
  campo.addEventListener("focus", () => { if (trovati.length) lista.hidden = false; });
}

// ------------------------------------------------------------ esportazioni
const oggiTesto = () => new Date().toISOString().slice(0, 10);
const nomeFile = ext => `albero-di-famiglia-${oggiTesto()}.${ext}`;

function scaricaBlob(blob, nome) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const scaricaTesto = (testo, nome, tipo) => scaricaBlob(new Blob([testo], { type: `${tipo};charset=utf-8` }), nome);

function svgDaEsportare() {
  const scena = componiScena(S.albero);
  return documentoSVG(scena, { titolo: S.albero.meta?.titolo || "Albero di famiglia",
    sottotitolo: `aggiornato al ${new Date().toLocaleDateString("it-IT")}` });
}

async function esportaPNG() {
  const url = URL.createObjectURL(new Blob([svgDaEsportare()], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scala = Math.min(2, 16000 / Math.max(img.width, img.height));
    const tela = document.createElement("canvas");
    tela.width = Math.round(img.width * scala);
    tela.height = Math.round(img.height * scala);
    const g = tela.getContext("2d");
    g.scale(scala, scala);
    g.drawImage(img, 0, 0);
    await new Promise(ok => tela.toBlob(b => { scaricaBlob(b, nomeFile("png")); ok(); }, "image/png"));
  } finally { URL.revokeObjectURL(url); }
}

function esportaPDF() {
  const cornice = document.createElement("iframe");
  cornice.className = "cornice-stampa";
  document.body.append(cornice);
  const doc = cornice.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Albero di famiglia</title>
    <style>@page{size:A3 landscape;margin:8mm}html,body{margin:0}svg{width:100%;height:auto;display:block}</style></head>
    <body>${svgDaEsportare().replace(/^<\?xml[^>]*>\s*/, "")}</body></html>`);
  doc.close();
  setTimeout(() => { cornice.contentWindow.focus(); cornice.contentWindow.print(); setTimeout(() => cornice.remove(), 2000); }, 300);
}

function mostraEsporta() {
  apriPannello("Esporta", `<div class="esporta">
    <p class="spiegazione">L'albero intero, con la disposizione che vedi. I file restano sul tuo dispositivo.</p>
    <section><h3>Da guardare o stampare</h3><div class="griglia-pulsanti">
      <button type="button" data-azione="pdf"><b>PDF</b><span>stampa o salva in A3</span></button>
      <button type="button" data-azione="png"><b>PNG</b><span>immagine ad alta risoluzione</span></button>
      <button type="button" data-azione="svg"><b>SVG</b><span>immagine vettoriale</span></button>
      <button type="button" data-azione="drawio"><b>draw.io</b><span>da ritoccare in draw.io</span></button>
    </div></section>
    <section><h3>Dati</h3><div class="griglia-pulsanti">
      <button type="button" data-azione="gedcom"><b>GEDCOM</b><span>per i programmi di genealogia</span></button>
      <button type="button" data-azione="json"><b>JSON</b><span>copia completa, con la disposizione</span></button>
      <button type="button" data-azione="csv-persone"><b>CSV persone</b><span>per Excel o Numbers</span></button>
      <button type="button" data-azione="csv-unioni"><b>CSV unioni</b><span>per Excel o Numbers</span></button>
    </div></section></div>`, async azione => {
    try {
      if (azione === "pdf") esportaPDF();
      if (azione === "png") await esportaPNG();
      if (azione === "svg") scaricaTesto(svgDaEsportare(), nomeFile("svg"), "image/svg+xml");
      if (azione === "drawio") scaricaTesto(aDrawio(componiScena(S.albero), S.albero), nomeFile("drawio"), "application/xml");
      if (azione === "gedcom") scaricaTesto(aGEDCOM(S.albero), nomeFile("ged"), "text/plain");
      if (azione === "json") scaricaTesto(aJSON(S.albero), nomeFile("json"), "application/json");
      if (azione === "csv-persone") scaricaTesto(aCSVPersone(S.albero), `persone-${oggiTesto()}.csv`, "text/csv");
      if (azione === "csv-unioni") scaricaTesto(aCSVUnioni(S.albero), `unioni-${oggiTesto()}.csv`, "text/csv");
    } catch (err) { errore(err); }
  }, null, { tipo: "esporta" });
}

// ------------------------------------------------------------ menu e impostazioni
function chiediNome(obbligatorio = false) {
  return dialogo(`<form method="dialog" class="modulo"><h2>Come ti chiami?</h2>
    <p class="spiegazione">Il nome compare accanto ai tuoi post-it${ctx.modifica ? " e alle tue modifiche nello storico" : ""}, così gli altri sanno chi ha scritto cosa. Resta su questo dispositivo.</p>
    <input name="nome" value="${esc(memoria.leggi("nome") || "")}" autocomplete="given-name" required>
    <div class="azioni"><button value="ok" class="primario">Va bene</button>${obbligatorio ? "" : '<button value="no" formnovalidate>Annulla</button>'}</div></form>`,
  (d, chiudi) => {
    const f = d.querySelector("form");
    f.addEventListener("submit", e => {
      e.preventDefault();
      if (e.submitter?.value !== "ok") return chiudi(null);
      const n = f.elements.nome.value.trim();
      if (!n) return;
      memoria.scrivi("nome", n);
      chiudi(n);
    });
  });
}

function mostraMenu() {
  const modifica = ctx.modifica;
  apriPannello("Menu", `<div class="menu">
    <section><h3>Questo link</h3><p>${modifica ? "Puoi <b>leggere e modificare</b>. Non inoltrarlo: per far vedere l'albero a qualcuno c'è il link in sola lettura." : "Puoi <b>leggere</b> l'albero e <b>suggerire modifiche</b>: apri la scheda di una persona o di una coppia e tocca «Suggerisci una modifica» per correggere un dato o aggiungere un parente, oppure lascia un post-it con le notizie che sai. Chi cura l'albero li vede e aggiorna l'albero; se lasci la tua email, ti avvisa quando il suggerimento viene accettato o rifiutato. In «Cosa manca» c'è l'elenco di quello che non sappiamo ancora."}</p></section>
    <section><h3>Il tuo nome</h3><p>${esc(memoria.leggi("nome") || "non indicato")} <button type="button" class="collegamento" data-azione="nome">cambia</button></p></section>
    ${modifica ? `<section><h3>Impostazioni dell'albero</h3>
      <label>Titolo <input name="titolo" value="${esc(S.albero.meta?.titolo || "")}"></label>
      <label>Raggio delle curve: <output name="valore">${S.scena.raggio}</output> px
        <input type="range" name="raggio" min="0" max="40" step="1" value="${S.scena.raggio}"></label>
      <div class="azioni"><button type="button" class="primario" data-azione="salva-impostazioni">Salva le impostazioni</button></div>
    </section>` : ""}
    <section><h3>Come si usa</h3><ul class="aiuto">
      <li>Trascina per spostarti, rotella o due dita per ingrandire; doppio clic per avvicinarti.</li>
      <li>Tocca una persona per la sua scheda; da lì puoi isolarne antenati, discendenti, famiglia o generazione.</li>
      <li>I colori sono le famiglie d'origine: toccali nel nastro in alto per filtrare.</li>
      <li>Il pulsante a cursori nella casella di ricerca apre la ricerca avanzata: condizioni su tutti i campi, anche età e parentele, da combinare.</li>
      <li><button type="button" class="collegamento" data-azione="manca">«Cosa manca»</button>, il pulsante con il punto di domanda, elenca date e nomi che non sappiamo ancora, dalle generazioni più vecchie: ${modifica ? "«Completa» apre la scheda sul dato che manca" : "se ne sai uno, tocca «Lo so io» e manda il suggerimento"}.</li>
      <li><button type="button" class="collegamento" data-azione="parentela">«Come siamo parenti?»</button>, il pulsante con le due persone: toccalo e poi tocca due persone sull'albero, o cercale. Il percorso fra loro si illumina e il pannello dice la parentela, con il grado.</li>
      <li>Dalla scheda di una persona o di un'unione puoi lasciare un post-it, per esempio per suggerire una correzione: lo vedono tutti, e lo cambi o lo togli tu dallo stesso dispositivo${modifica ? ", oppure chiunque abbia il link di modifica" : ""}.</li>
      ${modifica ? "<li>«Disposizione» serve a sistemare il disegno: trascina le persone (con Alt anche i discendenti), tocca una linea per piegarla.</li><li>Ogni modifica finisce nello «Storico», da cui si può ripristinare.</li>" : ""}
      <li>† indica chi non è più in vita: lo si deduce dalla data di morte.</li>
    </ul></section>
    <section><h3>Questo dispositivo</h3><button type="button" class="pericolo" data-azione="dimentica">Dimentica l'albero su questo dispositivo</button></section>
  </div>`, async azione => {
    if (azione === "manca") return mostraMancanti();
    if (azione === "parentela") return attivaParentela();
    if (azione === "nome") { await chiediNome(); mostraMenu(); }
    if (azione === "salva-impostazioni") {
      const c = $("#pannello-corpo");
      const raggio = Number(c.querySelector("[name=raggio]").value), titolo = c.querySelector("[name=titolo]").value.trim() || "Albero di famiglia";
      try { await ctx.salva({ meta: { raggio, titolo }, descrizione: "Cambiate le impostazioni dell'albero" }); avviso("Impostazioni salvate."); } catch (err) { errore(err); }
    }
    if (azione === "dimentica") {
      if (!await conferma("Tolgo da questo dispositivo il link e il tuo nome? Per riaprire l'albero servirà di nuovo il link.", "Dimentica", true)) return;
      memoria.togli("chiave"); memoria.togli("nome");
      location.replace(location.pathname);
    }
  }, corpo => {
    const r = corpo.querySelector("[name=raggio]");
    r?.addEventListener("input", () => {
      corpo.querySelector("[name=valore]").textContent = r.value;
      S.albero = { ...S.albero, meta: { ...S.albero.meta, raggio: Number(r.value) } };
      ridisegna();
    });
  }, { tipo: "menu" });
}

// ------------------------------------------------------------ barra della disposizione
function aggiornaAttrezzi() {
  const st = disposizione.stato();
  const b = $("#attrezzi");
  b.querySelector("[data-attrezzo=annulla]").disabled = !st.annullabile;
  b.querySelector("[data-attrezzo=ripeti]").disabled = !st.ripetibile;
  b.querySelector("[data-attrezzo=raddrizza]").disabled = !st.arcoManuale;
  b.querySelector("[data-attrezzo=ripristina-linea]").disabled = !st.arcoCambiato;
  $("#suggerimento-linea").hidden = !st.arcoSel;
  b.querySelector("[data-attrezzo=riallinea]").disabled = !st.unioneSpostata;
  b.querySelector("[data-attrezzo=griglia]").classList.toggle("attiva", disposizione.opzioni.griglia);
  b.querySelector("[data-attrezzo=guide]").classList.toggle("attiva", disposizione.opzioni.guide);
}

function preparaAttrezzi() {
  $("#attrezzi").addEventListener("click", e => {
    const a = e.target.closest("[data-attrezzo]")?.dataset.attrezzo;
    if (!a) return;
    if (a === "griglia" || a === "guide") disposizione.opzioni[a] = !disposizione.opzioni[a];
    if (a === "annulla") disposizione.annulla();
    if (a === "ripeti") disposizione.ripeti();
    if (a === "raddrizza") disposizione.raddrizza();
    if (a === "ripristina-linea") disposizione.ripristinaLinea();
    if (a === "riallinea") disposizione.riallinea();
    if (a === "ridisponi") {
      const solo = S.dentro && S.dentro.size < S.albero.persone.length;
      if (solo) {
        dialogo(`<form method="dialog" class="modulo"><h2>Ridisponi automaticamente</h2><p>Che cosa?</p><div class="azioni">
          <button value="isolati" class="primario">Solo le ${S.dentro.size} persone in vista</button><button value="tutto">Tutto l'albero</button><button value="no">Annulla</button></div></form>`,
        (d, chiudi) => d.querySelector("form").addEventListener("submit", ev => { ev.preventDefault(); chiudi(ev.submitter?.value); }))
          .then(v => { if (v === "isolati") disposizione.ridisponi(new Set(S.dentro)); if (v === "tutto") disposizione.ridisponi(null); });
      } else disposizione.ridisponi(null);
    }
    if (a === "fine") attivaDisposizione(false);
    aggiornaAttrezzi();
  });
}

function attivaDisposizione(si, { spiega = true } = {}) {
  if (si && S.ricompatta) ricompatta(false);
  if (si && S.parentela) nascondiParentela();
  disposizione.attiva(si);
  $("#attrezzi").hidden = !si;
  $("#b-disposizione").classList.toggle("attiva", si);
  aggiornaAttrezzi();
  applicaClassi();
  if (si && spiega) avviso("Trascina le persone per spostarle; tocca una linea per piegarla.");
}

// ------------------------------------------------------------ contesto per i moduli
const ctx = {
  modifica: false,
  albero: () => S.albero,
  scena: () => S.scena,
  indici: () => S.scena.ix,
  get vista() { return vista; },
  provvisorie: () => S.provvisorie,
  pulisciProvvisorieAlProssimoAggiornamento: () => { S.pulire = true; },
  ridisegna, apriPannello, chiudiPannello, dialogo, conferma, avviso, errore, seleziona, isola, aggiornaAttrezzi,
  // la scrittura locale è immediata; si aspetta il server al massimo poco, gli errori arrivano comunque
  async salva(richiesta) {
    if (!memoria.leggi("nome")) await chiediNome(true);
    const p = dati.salva(richiesta);
    p.catch(errore);
    await Promise.race([p, new Promise(ok => setTimeout(ok, 600))]);
  },
  storico: o => dati.storico(o),
  ripristina: (g, d) => dati.ripristina(g, d),
  // post-it
  dati: () => dati,
  postit: () => S.postit,
  mioUid: () => dati?.mioUid(),
  apriNodo,
  nomeAutore: async () => memoria.leggi("nome") || chiediNome(),
  // l'email per la risposta ai suggerimenti: resta su questo dispositivo, come il nome
  email: () => memoria.leggi("email") || "",
  ricordaEmail: v => memoria.scrivi("email", v),
  async attendiPoco(promessa) {
    promessa.catch(errore);
    await Promise.race([promessa, new Promise(ok => setTimeout(ok, 600))]);
  },
};

// ------------------------------------------------------------ avvio
async function avvia() {
  if (!configurazione) return schermata("Albero di famiglia", "L'app non è ancora collegata alla sua base dati.");
  const chiave = chiaveDalLink();
  if (!chiave) return schermata("Albero di famiglia", "Per aprire l'albero serve il link completo che ti è stato mandato.");
  schermata("Apro l'albero…", "", true);

  vista = creaVista($("#tela"), {
    prendi: (b, m, e) => disposizione.prendi(b, m, e),
    trascina: (fase, m, e, b) => disposizione.trascina(fase, m, e, b),
    clic: b => {
      if (S.parentela?.fase === "scelta") return scegliPerParentela(b);
      if (disposizione.clic(b)) { applicaClassi(); if (b.tipo === "vuoto") { S.sel = null; S.selUnione = null; chiudiPannello(); applicaClassi(); } return; }
      if (b.tipo === "postit") apriNodo(b.id, S.scena.ix.persona.has(b.id) ? "persona" : "unione", { postit: true });
      else if (b.tipo === "persona") seleziona(b.id);
      else if (b.tipo === "unione") { S.sel = null; S.selUnione = b.id; applicaClassi(); mostraUnione(ctx, b.id); }
      else if (b.tipo === "arco") { const a = S.scena.archi.find(x => x.id === b.id); if (a) { S.sel = null; S.selUnione = a.unione; applicaClassi(); mostraUnione(ctx, a.unione); } }
      else { S.sel = null; S.selUnione = null; chiudiPannello(); applicaClassi(); }
    },
    doppioClic: b => disposizione.doppioClic(b),
    riserva: () => riserva(),
    versoBloccato: () => disposizione.versoBloccato(),
    suZoom: () => disposizione.disegnaManiglie(),
  });
  disposizione = creaDisposizione(ctx);

  try {
    dati = await apri(configurazione, chiave, {
      nome: () => memoria.leggi("nome"),
      suCambio: albero => {
        S.albero = albero;
        if (S.pulire) { S.provvisorie = { posizioni: {}, archi: {} }; S.pulire = false; }
        $("#titolo").textContent = albero.meta?.titolo || "Albero di famiglia";
        ridisegna();
        if (S.parentela) { ricalcolaParentela(); applicaClassi(); }
        if (S.primoDisegno) {
          S.primoDisegno = false;
          $("#avvio").hidden = true;
          if (daRipristinare) {
            ripristinaStato(daRipristinare).catch(err => { console.error(err); inquadraVisibili({ animato: false, kMax: ZOOM_PIENO }); });
          } else inquadraVisibili({ animato: false, kMax: ZOOM_PIENO });
          apriDaIndirizzo();
          controllaVersione();
        }
        // la scheda aperta segue le modifiche degli altri, ma non mentre la si compila
        const pan = S.pannello;
        if (pan && !pan.modulo && !document.querySelector("dialog[open]")) {
          if (pan.persona) mostraPersona(ctx, pan.persona);
          else if (pan.unione) mostraUnione(ctx, pan.unione);
          else if (pan.tipo === "mancanti") mostraMancanti();
          else if (pan.tipo === "parentela") mostraPannelloParentela();
        }
        aggiornaEsitiAvanzata();
        aggiornaAttrezzi();
      },
      suErrore: err => errore(err),
      suPostit: elenco => { S.postit = elenco; aggiornaPostit(); },
      suStatoRete: ({ inSospeso, daCache }) => {
        const r = $("#rete");
        r.textContent = inSospeso ? "Salvataggio…" : daCache ? "Non in linea" : "";
        r.hidden = !inSospeso && !daCache;
      },
    });
  } catch (err) {
    if (err instanceof ErroreLink) return schermata("Albero di famiglia", esc(err.message));
    console.error(err);
    return schermata("Albero di famiglia", "Non riesco a raggiungere la base dati. Controlla la connessione e riprova.");
  }

  ctx.modifica = dati.modifica;
  document.body.classList.toggle("modo-modifica", dati.modifica);
  document.body.classList.toggle("modo-lettura", !dati.modifica);
  if (dati.modifica && !memoria.leggi("nome")) chiediNome(true);

  preparaRicerca();
  preparaAttrezzi();
  $("#b-filtri").addEventListener("click", () => (S.pannello?.tipo === "filtri" ? chiudiPannello() : mostraFiltri()));
  $("#b-avanzata").addEventListener("click", apriAvanzata);
  $("#b-postit").addEventListener("click", () => (S.pannello?.tipo === "postit" ? chiudiPannello() : mostraTuttiPostit(ctx)));
  $("#b-manca").addEventListener("click", () => (S.pannello?.tipo === "mancanti" ? chiudiPannello() : mostraMancanti()));
  $("#b-parentela").addEventListener("click", () => (S.parentela ? nascondiParentela() : attivaParentela()));
  $("#guida-parentela").addEventListener("click", e => { if (e.target.closest("[data-parentela=dettagli]")) mostraPannelloParentela(); });
  $("#b-esporta").addEventListener("click", () => (S.pannello?.tipo === "esporta" ? chiudiPannello() : mostraEsporta()));
  $("#b-menu").addEventListener("click", () => (S.pannello?.tipo === "menu" ? chiudiPannello() : mostraMenu()));
  $("#b-storico").addEventListener("click", () => mostraStorico(ctx));
  $("#b-aggiungi").addEventListener("click", () => nuovaPersonaLibera(ctx));
  $("#b-disposizione").addEventListener("click", () => attivaDisposizione(!disposizione.attivo));
  $("#z-piu").addEventListener("click", () => vista.zoom(1.25));
  $("#z-meno").addEventListener("click", () => vista.zoom(0.8));
  $("#z-adatta").addEventListener("click", () => inquadraVisibili({ kMax: ZOOM_PIENO }));

  document.addEventListener("keydown", e => {
    const inCampo = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.querySelector("dialog[open]");
    if (inCampo) return;
    if (e.key === "/") { e.preventDefault(); $("#cerca").focus(); }
    if (e.key === "Escape" && S.parentela) return nascondiParentela();
    if (e.key === "Escape") { if (S.pannello) chiudiPannello(); S.sel = null; S.selUnione = null; disposizione.clic({ tipo: "vuoto" }); applicaClassi(); }
    if (e.key === "+" || e.key === "=") vista.zoom(1.25);
    if (e.key === "-") vista.zoom(0.8);
    if (disposizione.attivo && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      (e.shiftKey ? disposizione.ripeti : disposizione.annulla)();
    }
  });
  addEventListener("resize", () => disposizione.disegnaManiglie());
}

avvia();
