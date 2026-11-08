// Scheda della persona e dell'unione: lettura, modifica, relazioni (partner, figli,
// genitori), eliminazione. Solo browser; riceve il contesto dell'app da main.js.
import { esc } from "./svg.js";
import { parenti, nomeCompleto, cerca, coniugeIn, ignoto } from "./grafo.js";
import { normalizzaData, formattaData, statoInVita, TESTO_IN_VITA, eta, annoDi, generazioneSociologica } from "./deduzioni.js";
import { collocaNuova } from "./geometria.js";
import { idArcoPartner, idArcoFiglio, NEUTRO } from "./scena.js";
import { sezionePostit, gestisciPostit, azioneDiPostit } from "./postit.js";

// ------------------------------------------------------------ utilità

const vuotaData = () => ({ data: "", circa: false, luogo: "" });
const casuale = () => Math.random().toString(36).slice(2, 6);
const slug = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function nuovaPersona(albero, { nome = "", cognome = "" } = {}) {
  const base = [slug(cognome), slug(nome)].filter(Boolean).join("-") || "persona";
  return {
    id: `${base}-${casuale()}`, ordine: Math.max(-1, ...albero.persone.map(p => p.ordine ?? 0)) + 1,
    cognome: cognome.trim(), nome: nome.trim(), soprannome: "", sesso: "", segnaposto: false,
    nascita: vuotaData(), morte: vuotaData(), deceduto: false, note: "",
  };
}

function nuovaUnione(albero, partner, figli = []) {
  return { id: `u-${casuale()}${casuale()}`, ordine: Math.max(-1, ...albero.unioni.map(u => u.ordine ?? 0)) + 1,
    partner, figli, stato: "certa", fonte: "", note: "" };
}

const dataInIngresso = d => (d?.data ? d.data.split("-").reverse().join("/") : "");
const quando = ts => (ts?.toDate ? ts.toDate().toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "");
const ms = ts => (ts?.toMillis ? ts.toMillis() : 0);

function chip(ctx, id) {
  const p = ctx.indici().persona.get(id);
  if (!p) return "";
  const c = ctx.indici().ceppi.get(p.cognome) || NEUTRO;
  const morto = statoInVita(p) === "no" ? " †" : "";
  return `<button type="button" class="chip${ignoto(p) ? " ignoto" : ""}" data-azione="vai" data-id="${esc(id)}" style="--c:${esc(c.riempimento)};--b:${esc(c.bordo)}">${esc(nomeCompleto(p))}${morto}</button>`;
}

const testoNote = s => esc(s).replace(/\n/g, "<br>");

// ------------------------------------------------------------ scheda della persona

export function mostraPersona(ctx, id) {
  const ix = ctx.indici();
  const p = ix.persona.get(id);
  if (!p) return ctx.chiudiPannello();
  const r = parenti(ix, id);
  const c = ix.ceppi.get(p.cognome) || NEUTRO;
  const stato = statoInVita(p);
  const anni = eta(p);
  const gs = generazioneSociologica(annoDi(p.nascita?.data));
  const modifica = ctx.modifica;
  const data = (d, etichetta) => (d?.data || d?.luogo
    ? `<dt>${etichetta}</dt><dd>${esc([formattaData(d), d.luogo].filter(Boolean).join(", "))}</dd>` : "");
  const distintivi = [
    `<span class="distintivo vita-${stato.replace(/\s/g, "-")}">${esc(TESTO_IN_VITA[stato])}</span>`,
    anni !== null ? `<span class="distintivo">${anni} anni${stato === "no" ? " alla morte" : ""}</span>` : "",
    gs ? `<span class="distintivo">${esc(gs.nome)}</span>` : "",
    ix.ceppi.has(p.cognome) ? `<span class="distintivo">Famiglia ${esc(p.cognome)}</span>` : "",
  ].join("");

  const unioni = r.unioni.map(({ unione: u, partner, figli }) => `
    <div class="blocco-unione">
      <div class="riga-unione"><span class="etichetta">con</span> ${chip(ctx, partner)}
        <button type="button" class="collegamento" data-azione="unione" data-id="${esc(u.id)}">dettagli${u.stato === "ipotesi" ? " · ipotesi" : ""}</button></div>
      ${figli.length ? `<div class="figli"><span class="etichetta">figli</span> ${figli.map(f => chip(ctx, f)).join("")}</div>` : ""}
    </div>`).join("");

  const html = `
    <article class="scheda" style="--c:${esc(c.riempimento)};--b:${esc(c.bordo)}">
      <header class="testa-scheda">
        <h2>${esc(p.segnaposto ? p.nome || "non noti" : p.nome || "?")}${p.soprannome ? ` <span class="soprannome">«${esc(p.soprannome)}»</span>` : ""}${stato === "no" ? " †" : ""}</h2>
        <div class="cognome">${esc(p.cognome || (p.segnaposto ? "" : "cognome non noto"))}</div>
        <div class="distintivi">${distintivi}</div>
      </header>
      ${data(p.nascita, "Nascita") || data(p.morte, "Morte") ? `<dl class="date">${data(p.nascita, "Nascita")}${data(p.morte, "Morte")}</dl>` : ""}
      <section class="note-persona">
        <h3>Note</h3>
        ${p.note ? `<p>${testoNote(p.note)}</p>` : `<p class="vuoto">Nessuna nota.${modifica ? ` <button type="button" class="collegamento" data-azione="modifica">Aggiungine una</button>` : ""}</p>`}
      </section>
      ${p.segnaposto ? "" : sezionePostit(ctx, id, "persona")}
      ${r.genitori.length ? `<section><h3>Genitori</h3><div class="chips">${r.genitori.map(g => chip(ctx, g)).join("")}</div></section>` : ""}
      ${r.unioni.length ? `<section><h3>Partner e figli</h3>${unioni}</section>` : ""}
      ${r.fratelli.length ? `<section><h3>Fratelli e sorelle</h3><div class="chips">${r.fratelli.map(f => chip(ctx, f)).join("")}</div></section>` : ""}
      <section class="isola">
        <h3>Isola nell'albero</h3>
        <div class="pulsanti-piccoli">
          <button type="button" data-azione="isola" data-tipo="antenati">Antenati</button>
          <button type="button" data-azione="isola" data-tipo="discendenti">Discendenti</button>
          <button type="button" data-azione="isola" data-tipo="entrambi">Tutte le ramificazioni</button>
          ${p.cognome ? `<button type="button" data-azione="isola" data-tipo="famiglia">Famiglia ${esc(p.cognome)}</button>` : ""}
          <button type="button" data-azione="isola" data-tipo="generazione">La sua generazione</button>
        </div>
      </section>
      ${modifica ? `<section class="azioni">
        <button type="button" class="primario" data-azione="modifica">Modifica</button>
        <button type="button" data-azione="partner">Aggiungi partner</button>
        <button type="button" data-azione="figlio">Aggiungi figlio</button>
        ${r.unioneGenitori ? "" : `<button type="button" data-azione="genitori">Aggiungi genitori</button>`}
        <button type="button" class="pericolo" data-azione="elimina">Elimina</button>
      </section>` : ""}
      ${p.aggiornato?.chi ? `<p class="aggiornato">Ultima modifica: ${esc(p.aggiornato.chi)}, ${esc(quando(p.aggiornato.quando))}</p>` : ""}
    </article>`;

  ctx.apriPannello(nomeCompleto(p), html, async (azione, el) => {
    if (azioneDiPostit(azione)) gestisciPostit(ctx, azione, el, { nodo: id, tipo: "persona" });
    else if (azione === "vai") ctx.seleziona(el.dataset.id, { centra: true });
    else if (azione === "unione") mostraUnione(ctx, el.dataset.id);
    else if (azione === "isola") ctx.isola(el.dataset.tipo, id);
    else if (azione === "modifica") modificaPersona(ctx, id);
    else if (azione === "partner") aggiungiPartner(ctx, id);
    else if (azione === "figlio") aggiungiFiglio(ctx, id);
    else if (azione === "genitori") aggiungiGenitori(ctx, id);
    else if (azione === "elimina") eliminaPersona(ctx, id);
  }, null, { persona: id });
}

// ------------------------------------------------------------ modulo della persona

export function modificaPersona(ctx, id, { nuova = null, dopoSalvataggio = null } = {}) {
  const p = nuova || ctx.indici().persona.get(id);
  const versione = ms(p.aggiornato?.quando);
  const html = `
    <form class="modulo" novalidate>
      <div class="due">
        <label>Nome <input name="nome" value="${esc(p.nome)}" autocomplete="off"></label>
        <label>Cognome <input name="cognome" value="${esc(p.cognome)}" autocomplete="off"></label>
      </div>
      <div class="due">
        <label>Soprannome <input name="soprannome" value="${esc(p.soprannome)}" autocomplete="off"></label>
        <label>Sesso <select name="sesso">
          <option value="">non indicato</option>
          <option value="F"${p.sesso === "F" ? " selected" : ""}>femmina</option>
          <option value="M"${p.sesso === "M" ? " selected" : ""}>maschio</option>
        </select></label>
      </div>
      <fieldset>
        <legend>Nascita</legend>
        <div class="data-riga">
          <input name="nascita" value="${esc(dataInIngresso(p.nascita))}" placeholder="gg/mm/aaaa, mm/aaaa o aaaa" inputmode="numeric">
          <label class="spunta"><input type="checkbox" name="nascitaCirca"${p.nascita?.circa ? " checked" : ""}> circa</label>
        </div>
        <input name="nascitaLuogo" value="${esc(p.nascita?.luogo)}" placeholder="luogo">
      </fieldset>
      <fieldset>
        <legend>Morte</legend>
        <div class="data-riga">
          <input name="morte" value="${esc(dataInIngresso(p.morte))}" placeholder="gg/mm/aaaa, mm/aaaa o aaaa" inputmode="numeric">
          <label class="spunta"><input type="checkbox" name="morteCirca"${p.morte?.circa ? " checked" : ""}> circa</label>
        </div>
        <input name="morteLuogo" value="${esc(p.morte?.luogo)}" placeholder="luogo">
        <label class="spunta"><input type="checkbox" name="deceduto"${p.deceduto ? " checked" : ""}> Non è più in vita, ma la data non si sa</label>
      </fieldset>
      <label>Note <textarea name="note" rows="6" placeholder="Ricordi, mestiere, dove ha vissuto, da chi viene l'informazione…">${esc(p.note)}</textarea></label>
      <p class="errore" hidden></p>
      <div class="azioni">
        <button type="submit" class="primario">Salva</button>
        <button type="button" data-azione="annulla">Annulla</button>
      </div>
    </form>`;
  ctx.apriPannello(nuova ? "Persona nuova" : `Modifica: ${nomeCompleto(p)}`, html, azione => {
    if (azione === "annulla") (nuova ? ctx.chiudiPannello() : mostraPersona(ctx, id));
  }, corpo => {
    const f = corpo.querySelector("form");
    f.querySelector("[name=nome]").focus();
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const v = n => f.elements[n].value;
      const errore = f.querySelector(".errore");
      const nascita = normalizzaData(v("nascita")), morte = normalizzaData(v("morte"));
      if (!nascita.valida || !morte.valida) {
        errore.textContent = "Una data non è valida: scrivila come 05/05/1968, 05/1968 oppure 1968.";
        errore.hidden = false;
        return;
      }
      if (nascita.data && morte.data && morte.data < nascita.data) {
        errore.textContent = "La data di morte viene prima di quella di nascita.";
        errore.hidden = false;
        return;
      }
      const dopo = {
        ...p,
        nome: v("nome").trim(), cognome: v("cognome").trim(), soprannome: v("soprannome").trim(), sesso: v("sesso"),
        nascita: { data: nascita.data, circa: f.elements.nascitaCirca.checked && !!nascita.data, luogo: v("nascitaLuogo").trim() },
        morte: { data: morte.data, circa: f.elements.morteCirca.checked && !!morte.data, luogo: v("morteLuogo").trim() },
        deceduto: f.elements.deceduto.checked && !morte.data,
        note: v("note").trim(),
      };
      if (!nuova) {
        const ora = ctx.indici().persona.get(id);
        if (ora && ms(ora.aggiornato?.quando) !== versione) {
          const ok = await ctx.conferma(`${ora.aggiornato?.chi || "Qualcun altro"} ha cambiato questa scheda mentre la modificavi. Salvo comunque la tua versione?`, "Salva la mia");
          if (!ok) return mostraPersona(ctx, id);
        }
      }
      try {
        if (dopoSalvataggio) await dopoSalvataggio(dopo);
        else await ctx.salva({ operazioni: [{ raccolta: "persone", id, dopo }], descrizione: `Modificata la scheda di ${nomeCompleto(dopo)}` });
        mostraPersona(ctx, dopo.id);
      } catch (err) { ctx.errore(err); }
    });
  });
}

// ------------------------------------------------------------ scelta di una persona (nuova o esistente)

function scegliPersona(ctx, { titolo, spiegazione = "", ammessa = () => true, conCoppia = null }) {
  return ctx.dialogo(`
    <form method="dialog" class="modulo scelta">
      <h2>${esc(titolo)}</h2>
      ${spiegazione ? `<p class="spiegazione">${spiegazione}</p>` : ""}
      ${conCoppia || ""}
      <div class="schede-scelta">
        <label><input type="radio" name="modo" value="nuova" checked> Persona nuova</label>
        <label><input type="radio" name="modo" value="esistente"> Già nell'albero</label>
      </div>
      <div data-se="nuova" class="due">
        <label>Nome <input name="nome" autocomplete="off"></label>
        <label>Cognome <input name="cognome" autocomplete="off"></label>
      </div>
      <div data-se="esistente" hidden>
        <input name="cerca" type="search" placeholder="Cerca per nome o cognome" autocomplete="off">
        <select name="scelta" size="7"></select>
      </div>
      <div class="azioni">
        <button value="ok" class="primario">Aggiungi</button>
        <button value="annulla" formnovalidate>Annulla</button>
      </div>
    </form>`, (d, chiudi) => {
    const f = d.querySelector("form");
    const elenco = () => {
      const q = f.elements.cerca.value;
      const lista = (q ? cerca(ctx.albero(), q) : [...ctx.albero().persone].sort((a, b) => nomeCompleto(a).localeCompare(nomeCompleto(b), "it")))
        .filter(ammessa).slice(0, 80);
      f.elements.scelta.innerHTML = lista.map(p => `<option value="${esc(p.id)}">${esc(nomeCompleto(p))}</option>`).join("");
    };
    const modo = () => {
      const m = f.elements.modo.value;
      d.querySelector('[data-se="nuova"]').hidden = m !== "nuova";
      d.querySelector('[data-se="esistente"]').hidden = m !== "esistente";
      if (m === "esistente") { elenco(); f.elements.cerca.focus(); } else f.elements.nome.focus();
    };
    f.addEventListener("change", e => { if (e.target.name === "modo") modo(); });
    f.elements.cerca.addEventListener("input", elenco);
    f.addEventListener("submit", e => {
      e.preventDefault();
      if (e.submitter?.value !== "ok") return chiudi(null);
      const coppia = f.elements.coppia?.value;
      if (f.elements.modo.value === "nuova") return chiudi({ nuova: { nome: f.elements.nome.value, cognome: f.elements.cognome.value }, coppia });
      const id = f.elements.scelta.value;
      if (!id) return;
      chiudi({ id, coppia });
    });
    f.elements.nome.focus();
  });
}

// posizioni attuali (quelle disegnate) per collocare chi arriva
const posizioniAttuali = ctx => Object.fromEntries(ctx.scena().nodi.map(n => [n.id, { x: n.x, y: n.y }]));
const tondo = p => ({ x: Math.round(p.x), y: Math.round(p.y) });

async function aggiungiPartner(ctx, id) {
  const p = ctx.indici().persona.get(id);
  const scelta = await scegliPersona(ctx, { titolo: `Aggiungi un partner di ${nomeCompleto(p)}`, ammessa: q => q.id !== id });
  if (!scelta) return;
  const albero = ctx.albero();
  const operazioni = [], disposizione = [];
  let altro = scelta.id;
  if (scelta.nuova) {
    const n = nuovaPersona(albero, scelta.nuova);
    altro = n.id;
    operazioni.push({ raccolta: "persone", id: n.id, dopo: n });
    disposizione.push({ sezione: "nodi", id: n.id, dopo: tondo(collocaNuova(posizioniAttuali(ctx), ctx.indici().unione, { tipo: "partner", di: id })) });
  }
  const u = nuovaUnione(albero, [id, altro]);
  operazioni.push({ raccolta: "unioni", id: u.id, dopo: u });
  const q = ctx.indici().persona.get(altro) || { nome: scelta.nuova?.nome, cognome: scelta.nuova?.cognome };
  await ctx.salva({ operazioni, disposizione, descrizione: `Aggiunta la coppia ${nomeCompleto(p)} e ${nomeCompleto(q)}` });
  ctx.seleziona(altro, { centra: true });
}

async function aggiungiFiglio(ctx, id, unioneScelta = null) {
  const ix = ctx.indici();
  const p = ix.persona.get(id);
  const unioni = (ix.unioniDi.get(id) || []).map(uid => ix.unione.get(uid));
  let coppia = "";
  if (!unioneScelta && unioni.length > 1) {
    coppia = `<label>Con chi? <select name="coppia">${unioni.map(u => `<option value="${esc(u.id)}">${esc(nomeCompleto(ix.persona.get(coniugeIn(u, id))))}</option>`).join("")}</select></label>`;
  }
  const scelta = await scegliPersona(ctx, {
    titolo: `Aggiungi un figlio o una figlia di ${nomeCompleto(p)}`,
    spiegazione: unioni.length ? "" : "L'altro genitore comparirà come «non noto»: potrai completarlo dopo.",
    ammessa: q => q.id !== id && !ix.genitoriDi.has(q.id), conCoppia: coppia,
  });
  if (!scelta) return;
  const albero = ctx.albero();
  const operazioni = [], disposizione = [];
  const posizioni = posizioniAttuali(ctx);
  let u = unioneScelta ? ix.unione.get(unioneScelta) : unioni.find(x => x.id === scelta.coppia) || unioni[0];
  if (!u) {
    const altro = nuovaPersona(albero);
    operazioni.push({ raccolta: "persone", id: altro.id, dopo: altro });
    const pos = tondo(collocaNuova(posizioni, ix.unione, { tipo: "partner", di: id }));
    posizioni[altro.id] = pos;
    disposizione.push({ sezione: "nodi", id: altro.id, dopo: pos });
    u = nuovaUnione(albero, [id, altro.id]);
  }
  let figlio = scelta.id;
  const unioniProva = new Map(ix.unione);
  unioniProva.set(u.id, u);
  if (scelta.nuova) {
    const n = nuovaPersona(albero, { cognome: p.cognome, ...Object.fromEntries(Object.entries(scelta.nuova).filter(([, v]) => v)) });
    figlio = n.id;
    operazioni.push({ raccolta: "persone", id: n.id, dopo: n });
    disposizione.push({ sezione: "nodi", id: n.id, dopo: tondo(collocaNuova(posizioni, unioniProva, { tipo: "figlio", unione: u.id })) });
  }
  operazioni.push({ raccolta: "unioni", id: u.id, dopo: { ...u, figli: [...u.figli, figlio] } });
  await ctx.salva({ operazioni, disposizione, descrizione: `Aggiunto un figlio di ${nomeCompleto(p)}` });
  ctx.seleziona(figlio, { centra: true });
}

async function aggiungiGenitori(ctx, id) {
  const ix = ctx.indici();
  const p = ix.persona.get(id);
  const coppie = ctx.albero().unioni;
  const scelta = await ctx.dialogo(`
    <form method="dialog" class="modulo scelta">
      <h2>Aggiungi i genitori di ${esc(nomeCompleto(p))}</h2>
      <div class="schede-scelta">
        <label><input type="radio" name="modo" value="nuovi" checked> Persone nuove</label>
        <label><input type="radio" name="modo" value="coppia"> Una coppia già nell'albero</label>
      </div>
      <div data-se="nuovi">
        <p class="spiegazione">Lascia vuoto chi non conosci: comparirà come «non noto».</p>
        <div class="due"><label>Nome del primo genitore <input name="n1"></label><label>Cognome <input name="c1"></label></div>
        <div class="due"><label>Nome del secondo genitore <input name="n2"></label><label>Cognome <input name="c2"></label></div>
      </div>
      <div data-se="coppia" hidden>
        <select name="coppia" size="7">${coppie.map(u => `<option value="${esc(u.id)}">${esc(u.partner.map(q => nomeCompleto(ix.persona.get(q))).join(" e "))}</option>`).join("")}</select>
      </div>
      <div class="azioni"><button value="ok" class="primario">Aggiungi</button><button value="annulla" formnovalidate>Annulla</button></div>
    </form>`, (d, chiudi) => {
    const f = d.querySelector("form");
    f.addEventListener("change", e => {
      if (e.target.name !== "modo") return;
      d.querySelector('[data-se="nuovi"]').hidden = f.elements.modo.value !== "nuovi";
      d.querySelector('[data-se="coppia"]').hidden = f.elements.modo.value !== "coppia";
    });
    f.addEventListener("submit", e => {
      e.preventDefault();
      if (e.submitter?.value !== "ok") return chiudi(null);
      if (f.elements.modo.value === "coppia") return f.elements.coppia.value ? chiudi({ coppia: f.elements.coppia.value }) : null;
      chiudi({ nuovi: [{ nome: f.elements.n1.value, cognome: f.elements.c1.value }, { nome: f.elements.n2.value, cognome: f.elements.c2.value }] });
    });
  });
  if (!scelta) return;
  const albero = ctx.albero();
  if (scelta.coppia) {
    const u = ix.unione.get(scelta.coppia);
    await ctx.salva({ operazioni: [{ raccolta: "unioni", id: u.id, dopo: { ...u, figli: [...u.figli, id] } }],
      descrizione: `Collegati i genitori di ${nomeCompleto(p)}` });
    return mostraPersona(ctx, id);
  }
  const operazioni = [], disposizione = [];
  const posizioni = posizioniAttuali(ctx);
  const nuovi = scelta.nuovi.map((dati, lato) => {
    const n = nuovaPersona(albero, dati);
    n.ordine += lato;
    n.id = n.id + (lato ? "b" : "a");
    operazioni.push({ raccolta: "persone", id: n.id, dopo: n });
    const pos = tondo(collocaNuova(posizioni, ix.unione, { tipo: "genitore", di: id, lato }));
    posizioni[n.id] = pos;
    disposizione.push({ sezione: "nodi", id: n.id, dopo: pos });
    return n;
  });
  const u = nuovaUnione(albero, nuovi.map(n => n.id), [id]);
  operazioni.push({ raccolta: "unioni", id: u.id, dopo: u });
  await ctx.salva({ operazioni, disposizione, descrizione: `Aggiunti i genitori di ${nomeCompleto(p)}` });
  mostraPersona(ctx, id);
}

async function eliminaPersona(ctx, id) {
  const ix = ctx.indici();
  const p = ix.persona.get(id);
  // Un genitore «non noto» non si sostituisce con un altro «non noto»: se ne va con le sue
  // unioni, e i figli restano nell'albero senza quei genitori.
  const nonNoto = ignoto(p);
  const conFigli = (ix.unioniDi.get(id) || []).map(uid => ix.unione.get(uid)).filter(u => u.figli.length);
  const figliDi = conFigli.flatMap(u => u.figli.map(f => nomeCompleto(ix.persona.get(f))));
  const domanda = nonNoto && conFigli.length
    ? `Tolgo questo genitore non noto insieme alla sua unione? ${figliDi.join(", ")} ${figliDi.length > 1 ? "restano" : "resta"} nell'albero, senza questi genitori. Potrai annullare dallo storico.`
    : nonNoto ? "Elimino questo «non noto» dall'albero? Potrai annullare dallo storico."
    : `Elimino ${nomeCompleto(p)} dall'albero? Le unioni con figli restano, con un genitore «non noto» al suo posto. Potrai annullare dallo storico.`;
  const ok = await ctx.conferma(domanda, nonNoto && conFigli.length ? "Togli" : "Elimina", true);
  if (!ok) return;
  const albero = ctx.albero();
  const operazioni = [{ raccolta: "persone", id, dopo: null }];
  const disposizione = [{ sezione: "nodi", id, dopo: null }];
  const pos = ctx.albero().disposizione?.nodi?.[id];
  for (const uid of ix.unioniDi.get(id) || []) {
    const u = ix.unione.get(uid);
    disposizione.push({ sezione: "archi", id: idArcoPartner(id, uid), dopo: null });
    if (u.figli.length && nonNoto) {
      operazioni.push({ raccolta: "unioni", id: uid, dopo: null });
      disposizione.push({ sezione: "nodi", id: uid, dopo: null });
      for (const q of u.partner) disposizione.push({ sezione: "archi", id: idArcoPartner(q, uid), dopo: null });
      for (const f of u.figli) disposizione.push({ sezione: "archi", id: idArcoFiglio(uid, f), dopo: null });
    } else if (u.figli.length) {
      const segnaposto = nuovaPersona(albero);
      segnaposto.id += uid.slice(-3);
      operazioni.push({ raccolta: "persone", id: segnaposto.id, dopo: segnaposto });
      if (pos) disposizione.push({ sezione: "nodi", id: segnaposto.id, dopo: pos });
      operazioni.push({ raccolta: "unioni", id: uid, dopo: { ...u, partner: u.partner.map(q => (q === id ? segnaposto.id : q)) } });
    } else {
      operazioni.push({ raccolta: "unioni", id: uid, dopo: null });
      disposizione.push({ sezione: "nodi", id: uid, dopo: null });
      for (const q of u.partner) disposizione.push({ sezione: "archi", id: idArcoPartner(q, uid), dopo: null });
    }
  }
  const ug = ix.genitoriDi.get(id);
  if (ug) {
    const u = ix.unione.get(ug);
    operazioni.push({ raccolta: "unioni", id: ug, dopo: { ...u, figli: u.figli.filter(f => f !== id) } });
    disposizione.push({ sezione: "archi", id: idArcoFiglio(ug, id), dopo: null });
  }
  const descrizione = !nonNoto ? `Eliminata ${nomeCompleto(p)}`
    : figliDi.length ? `Tolto il genitore non noto di ${figliDi.join(", ")}` : "Eliminato un «non noto»";
  await ctx.salva({ operazioni, disposizione: dedup(disposizione), descrizione });
  ctx.seleziona(null);
}

const dedup = campi => [...new Map(campi.map(c => [`${c.sezione}/${c.id}`, c])).values()];

// ------------------------------------------------------------ scheda dell'unione

export function mostraUnione(ctx, uid) {
  const ix = ctx.indici();
  const u = ix.unione.get(uid);
  if (!u) return ctx.chiudiPannello();
  const modifica = ctx.modifica;
  const html = `
    <article class="scheda unione-scheda">
      <header class="testa-scheda"><h2>Unione</h2><div class="distintivi"><span class="distintivo">${u.stato === "ipotesi" ? "Ipotesi da confermare" : "Unione certa"}</span></div></header>
      <section><h3>Partner</h3><div class="chips">${u.partner.map(p => chip(ctx, p)).join("")}</div></section>
      <section><h3>Figli</h3>${u.figli.length ? `<div class="chips">${u.figli.map(f => chip(ctx, f)).join("")}</div>` : `<p class="vuoto">Nessun figlio indicato.</p>`}</section>
      <section class="note-persona"><h3>Note</h3>${u.note ? `<p>${testoNote(u.note)}</p>` : `<p class="vuoto">Nessuna nota.</p>`}</section>
      ${u.fonte ? `<section><h3>Fonte</h3><p>${esc(u.fonte)}</p></section>` : ""}
      ${sezionePostit(ctx, uid, "unione")}
      ${modifica ? `<section class="azioni">
        <button type="button" class="primario" data-azione="modifica">Modifica</button>
        <button type="button" data-azione="figlio">Aggiungi figlio</button>
        <button type="button" class="pericolo" data-azione="elimina">Elimina l'unione</button>
      </section>` : ""}
      ${u.aggiornato?.chi ? `<p class="aggiornato">Ultima modifica: ${esc(u.aggiornato.chi)}, ${esc(quando(u.aggiornato.quando))}</p>` : ""}
    </article>`;
  ctx.apriPannello("Unione", html, async (azione, el) => {
    if (azioneDiPostit(azione)) gestisciPostit(ctx, azione, el, { nodo: uid, tipo: "unione" });
    else if (azione === "vai") ctx.seleziona(el.dataset.id, { centra: true });
    else if (azione === "figlio") aggiungiFiglio(ctx, u.partner[0], uid);
    else if (azione === "modifica") modificaUnione(ctx, uid);
    else if (azione === "elimina") {
      const ok = await ctx.conferma("Elimino questa unione? I partner restano nell'albero; i figli restano senza genitori. Potrai annullare dallo storico.", "Elimina", true);
      if (!ok) return;
      const disposizione = [{ sezione: "nodi", id: uid, dopo: null },
        ...u.partner.map(p => ({ sezione: "archi", id: idArcoPartner(p, uid), dopo: null })),
        ...u.figli.map(f => ({ sezione: "archi", id: idArcoFiglio(uid, f), dopo: null }))];
      await ctx.salva({ operazioni: [{ raccolta: "unioni", id: uid, dopo: null }], disposizione,
        descrizione: `Eliminata l'unione fra ${u.partner.map(p => nomeCompleto(ix.persona.get(p))).join(" e ")}` });
      ctx.chiudiPannello();
    }
  }, null, { unione: uid });
}

function modificaUnione(ctx, uid) {
  const ix = ctx.indici();
  const u = ix.unione.get(uid);
  const html = `
    <form class="modulo">
      <label>Stato <select name="stato">
        <option value="certa"${u.stato !== "ipotesi" ? " selected" : ""}>certa</option>
        <option value="ipotesi"${u.stato === "ipotesi" ? " selected" : ""}>ipotesi da confermare</option>
      </select></label>
      <label>Note <textarea name="note" rows="5">${esc(u.note)}</textarea></label>
      <label>Fonte <input name="fonte" value="${esc(u.fonte)}"></label>
      <div class="azioni"><button type="submit" class="primario">Salva</button><button type="button" data-azione="annulla">Annulla</button></div>
    </form>`;
  ctx.apriPannello("Modifica l'unione", html, azione => { if (azione === "annulla") mostraUnione(ctx, uid); }, corpo => {
    const f = corpo.querySelector("form");
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const dopo = { ...u, stato: f.elements.stato.value, note: f.elements.note.value.trim(), fonte: f.elements.fonte.value.trim() };
      try {
        await ctx.salva({ operazioni: [{ raccolta: "unioni", id: uid, dopo }],
          descrizione: `Modificata l'unione fra ${u.partner.map(p => nomeCompleto(ix.persona.get(p))).join(" e ")}` });
        mostraUnione(ctx, uid);
      } catch (err) { ctx.errore(err); }
    });
  });
}

// ------------------------------------------------------------ persona senza legami

export function nuovaPersonaLibera(ctx) {
  const albero = ctx.albero();
  const bozza = nuovaPersona(albero);
  modificaPersona(ctx, null, {
    nuova: bozza,
    dopoSalvataggio: async dopo => {
      const n = { ...dopo, id: nuovaPersona(albero, dopo).id };
      const pos = tondo(collocaNuova(posizioniAttuali(ctx), ctx.indici().unione, { tipo: "libera" }));
      await ctx.salva({ operazioni: [{ raccolta: "persone", id: n.id, dopo: n }], disposizione: [{ sezione: "nodi", id: n.id, dopo: pos }],
        descrizione: `Aggiunta ${nomeCompleto(n)}` });
      dopo.id = n.id;
      setTimeout(() => ctx.seleziona(n.id, { centra: true }), 50);
    },
  });
}
