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
import { mostraPersona, mostraUnione, nuovaPersonaLibera } from "./scheda.js";
import { mostraStorico } from "./storico.js";

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
  pannello: null, primoDisegno: true,
};
let dati = null, vista = null, disposizione = null;

// ------------------------------------------------------------ pannello laterale, dialoghi, avvisi
function apriPannello(titolo, html, suAzione = null, prepara = null, contesto = {}) {
  const p = $("#pannello");
  p.hidden = false;
  document.body.classList.add("con-pannello");
  $("#pannello-titolo").textContent = titolo;
  const corpo = $("#pannello-corpo");
  corpo.innerHTML = html;
  corpo.scrollTop = 0;
  S.pannello = { suAzione, modulo: !!corpo.querySelector("form"), ...contesto };
  prepara?.(corpo);
}

function chiudiPannello() {
  $("#pannello").hidden = true;
  document.body.classList.remove("con-pannello");
  S.pannello = null;
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
  setTimeout(() => a.classList.add("via"), 3200);
  setTimeout(() => a.remove(), 3800);
}

function errore(err) {
  console.error(err);
  const permesso = /permission|insufficient/i.test(err?.message || "");
  avviso(permesso ? "Non salvato: questo link non permette di modificare, o è stato sostituito." : `Qualcosa non ha funzionato: ${err?.message || err}`, "errore");
}

// ------------------------------------------------------------ disegno
function ridisegna() {
  if (!S.albero) return;
  const posizioni = { ...(S.ricompatta || {}), ...S.provvisorie.posizioni };
  S.scena = componiScena(S.albero, { posizioni, archi: S.provvisorie.archi, soloAutomatico: !!S.ricompatta });
  vista.disegna(S.scena);
  applicaClassi();
  disposizione.disegnaManiglie();
}

function applicaClassi() {
  if (!S.scena) return;
  const v = visibilita(S.albero, S.scena, S.filtri, S.isolamento, S.soloVisibili);
  S.dentro = v.dentro;
  vista.classi({ selezionata: S.sel, unioneSelezionata: S.selUnione, arcoSelezionato: disposizione.stato().arcoSel,
    attenuati: v.attenuati, nascosti: v.nascosti, evidenziati: S.evidenziati, trovati: S.trovati });
  aggiornaNastro();
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
  const qualcosa = S.isolamento || attivi(S.filtri);
  const modo = qualcosa ? `<label class="spunta piccola"><input type="checkbox" data-nastro="solo"${S.soloVisibili ? " checked" : ""}> mostra solo</label>`
    + (S.soloVisibili && S.isolamento ? `<label class="spunta piccola"><input type="checkbox" data-nastro="ricompatta"${S.ricompatta ? " checked" : ""}> ricompatta</label>` : "") : "";
  $("#nastro").innerHTML = `<div class="legenda-chips">${chips}</div><div class="nastro-stato">${iso}${fil}${modo}</div>`;
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
    <div class="azioni"><button type="button" data-azione="azzera">Azzera i filtri</button></div></div>`, (azione, el) => {
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

// ------------------------------------------------------------ ricerca
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
  const ATTESA_RICERCA = 750;      // ms dall'ultimo tasto prima di evidenziare e inquadrare
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
  const vai = r => { if (!r) return; campo.value = ""; trovati = []; disegna(); segna([]); campo.blur(); seleziona(r.p.id, { centra: true }); };
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
    <p class="spiegazione">Il nome compare nello storico accanto alle tue modifiche, così gli altri sanno chi ha cambiato cosa. Resta su questo dispositivo.</p>
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
    <section><h3>Questo link</h3><p>${modifica ? "Puoi <b>leggere e modificare</b>. Non inoltrarlo: per far vedere l'albero a qualcuno c'è il link in sola lettura." : "Puoi <b>leggere</b> l'albero, non modificarlo."}</p></section>
    ${modifica ? `<section><h3>Il tuo nome</h3><p>${esc(memoria.leggi("nome") || "non indicato")} <button type="button" class="collegamento" data-azione="nome">cambia</button></p></section>
    <section><h3>Impostazioni dell'albero</h3>
      <label>Titolo <input name="titolo" value="${esc(S.albero.meta?.titolo || "")}"></label>
      <label>Raggio delle curve: <output name="valore">${S.scena.raggio}</output> px
        <input type="range" name="raggio" min="0" max="40" step="1" value="${S.scena.raggio}"></label>
      <div class="azioni"><button type="button" class="primario" data-azione="salva-impostazioni">Salva le impostazioni</button></div>
    </section>` : ""}
    <section><h3>Come si usa</h3><ul class="aiuto">
      <li>Trascina per spostarti, rotella o due dita per ingrandire; doppio clic per avvicinarti.</li>
      <li>Tocca una persona per la sua scheda; da lì puoi isolarne antenati, discendenti, famiglia o generazione.</li>
      <li>I colori sono le famiglie d'origine: toccali nel nastro in alto per filtrare.</li>
      ${modifica ? "<li>«Disposizione» serve a sistemare il disegno: trascina le persone (con Alt anche i discendenti), tocca una linea per piegarla.</li><li>Ogni modifica finisce nello «Storico», da cui si può ripristinare.</li>" : ""}
      <li>† indica chi non è più in vita: lo si deduce dalla data di morte.</li>
    </ul></section>
    <section><h3>Questo dispositivo</h3><button type="button" class="pericolo" data-azione="dimentica">Dimentica l'albero su questo dispositivo</button></section>
  </div>`, async azione => {
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

function attivaDisposizione(si) {
  if (si && S.ricompatta) ricompatta(false);
  disposizione.attiva(si);
  $("#attrezzi").hidden = !si;
  $("#b-disposizione").classList.toggle("attiva", si);
  aggiornaAttrezzi();
  applicaClassi();
  if (si) avviso("Trascina le persone per spostarle; tocca una linea per piegarla.");
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
      if (disposizione.clic(b)) { applicaClassi(); if (b.tipo === "vuoto") { S.sel = null; S.selUnione = null; chiudiPannello(); applicaClassi(); } return; }
      if (b.tipo === "persona") seleziona(b.id);
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
        if (S.primoDisegno) {
          S.primoDisegno = false;
          $("#avvio").hidden = true;
          inquadraVisibili({ animato: false, kMax: ZOOM_PIENO });
        }
        // la scheda aperta segue le modifiche degli altri, ma non mentre la si compila
        const pan = S.pannello;
        if (pan && !pan.modulo && !document.querySelector("dialog[open]")) {
          if (pan.persona) mostraPersona(ctx, pan.persona);
          else if (pan.unione) mostraUnione(ctx, pan.unione);
        }
        aggiornaAttrezzi();
      },
      suErrore: err => errore(err),
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
