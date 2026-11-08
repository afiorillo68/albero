// Scheda della persona e dell'unione: lettura, modifica, relazioni (partner, figli,
// genitori), eliminazione, suggerimenti. Solo browser; riceve il contesto dell'app da main.js.
//
// Suggerimenti: chi ha il link di lettura usa gli stessi moduli di chi modifica, che invece
// di salvare mandano la proposta in un post-it (opz.suggerisci). Chi modifica la applica dallo
// stesso modulo già compilato (opz.applica è il post-it, che sparisce insieme alla modifica).
import { esc } from "./svg.js";
import { parenti, nomeCompleto, cerca, coniugeIn, ignoto } from "./grafo.js";
import { normalizzaData, formattaData, statoInVita, TESTO_IN_VITA, eta, annoDi, generazioneSociologica } from "./deduzioni.js";
import { collocaNuova } from "./geometria.js";
import { idArcoPartner, idArcoFiglio, NEUTRO } from "./scena.js";
import { sezionePostit, gestisciPostit, azioneDiPostit } from "./postit.js";
import { CAMPI_PERSONA, CAMPI_UNIONE, MISURE, EMAIL, differenze, riassunto } from "./proposte.js";
import { CAMPO_MODULO } from "./mancanti.js";

// ------------------------------------------------------------ utilità

const vuotaData = () => ({ data: "", circa: false, luogo: "" });
const casuale = () => Math.random().toString(36).slice(2, 6);
const slug = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function nuovaPersona(albero, { nome = "", cognome = "", nascita = null } = {}) {
  const base = [slug(cognome), slug(nome)].filter(Boolean).join("-") || "persona";
  return {
    id: `${base}-${casuale()}`, ordine: Math.max(-1, ...albero.persone.map(p => p.ordine ?? 0)) + 1,
    cognome: cognome.trim(), nome: nome.trim(), soprannome: "", sesso: "", segnaposto: false,
    nascita: { ...vuotaData(), ...(nascita || {}) }, morte: vuotaData(), deceduto: false, note: "",
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

const suSuggerimento = (descrizione, n) => (n ? `${descrizione}, su suggerimento di ${n.autore}` : descrizione);
const applicati = (ctx, n) => (n ? [{ id: n.id, avvisa: !!n.avvisa, riassunto: riassunto(ctx.indici(), n) }] : []);
const verbo = opz => (opz.suggerisci ? "Suggerisci" : "Aggiungi");
const pulsante = (opz, normale) => (opz.suggerisci ? "Invia il suggerimento" : normale);
const personaScelta = s => (s.id ? { persona: s.id } : { nuova: s.nuova });

// In cima al modulo di chi applica: chi ha suggerito e che cosa ha scritto.
function richiamo(n) {
  if (!n) return "";
  return `<div class="biglietto suggerimento richiamo"><b>Suggerimento di ${esc(n.autore)}</b>${n.testo ? `<p>${testoNote(n.testo)}</p>` : ""}
    <p class="spiegazione">Il modulo è già compilato: controlla, correggi se serve e salva. Il suggerimento sparisce con il salvataggio.</p></div>`;
}

// In fondo ai moduli di chi suggerisce: da dove viene la notizia e, se vuole la risposta,
// l'email (la propone quella usata l'ultima volta su questo dispositivo).
const campiSuggerimento = (commento = "", email = "") => `<label>Come lo sai? <span class="facoltativo">facoltativo</span>
  <textarea name="commento" rows="3" maxlength="2000" placeholder="Per esempio: me l'ha detto la zia; c'è scritto sul certificato">${esc(commento)}</textarea></label>
  <label>La tua email <span class="facoltativo">facoltativa</span>
  <input type="email" name="email" value="${esc(email)}" autocomplete="email" maxlength="200" placeholder="nome@esempio.it"></label>
  <p class="spiegazione">Se la scrivi, ti arriva una mail quando il suggerimento viene accettato o rifiutato. La legge solo chi cura l'albero.</p>`;

// {commento, email} dal modulo, oppure null se l'email è scritta male
function invio(f, segnala) {
  const commento = f.elements.commento?.value.trim() || "";
  const email = f.elements.email?.value.trim() || "";
  if (email && !EMAIL.test(email)) {
    segnala("L'email non sembra scritta bene: controllala, oppure lasciala vuota.");
    return null;
  }
  return { commento, email };
}

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

// opz.iniziale: campi che coprono quelli della scheda (proposta da modificare o da applicare).
// Da «Cosa manca»: richiesta (la riga in cima), evidenzia (i campi che mancano, il primo prende
// il cursore), torna (finito o annullato, al posto della scheda), da (per ricaricare la pagina).
export function modificaPersona(ctx, id, { nuova = null, dopoSalvataggio = null, iniziale = null, suggerisci = null, commento = "", email = "", applica = null,
  richiesta = "", evidenzia = [], torna = null, da = null } = {}) {
  const attuale = nuova || ctx.indici().persona.get(id);
  if (!attuale) return ctx.avviso("Questa persona non è più nell'albero.");
  const p = iniziale ? { ...attuale, ...iniziale } : attuale;
  const versione = ms(attuale.aggiornato?.quando);
  const lungo = n => ` maxlength="${n}"`;
  const html = `
    <form class="modulo" novalidate>
      ${richiamo(applica)}
      ${richiesta ? `<p class="richiesta-manca">${esc(richiesta)}</p>` : ""}
      ${suggerisci ? `<p class="spiegazione">Correggi o completa quello che sai. Chi cura l'albero vedrà la tua proposta e la applicherà.</p>` : ""}
      <div class="due">
        <label>Nome <input name="nome" value="${esc(p.nome)}" autocomplete="off"${lungo(MISURE.nome)}></label>
        <label>Cognome <input name="cognome" value="${esc(p.cognome)}" autocomplete="off"${lungo(MISURE.nome)}></label>
      </div>
      <div class="due">
        <label>Soprannome <input name="soprannome" value="${esc(p.soprannome)}" autocomplete="off"${lungo(MISURE.nome)}></label>
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
        <input name="nascitaLuogo" value="${esc(p.nascita?.luogo)}" placeholder="luogo"${lungo(MISURE.luogo)}>
      </fieldset>
      <fieldset>
        <legend>Morte</legend>
        <div class="data-riga">
          <input name="morte" value="${esc(dataInIngresso(p.morte))}" placeholder="gg/mm/aaaa, mm/aaaa o aaaa" inputmode="numeric">
          <label class="spunta"><input type="checkbox" name="morteCirca"${p.morte?.circa ? " checked" : ""}> circa</label>
        </div>
        <input name="morteLuogo" value="${esc(p.morte?.luogo)}" placeholder="luogo"${lungo(MISURE.luogo)}>
        <label class="spunta"><input type="checkbox" name="deceduto"${p.deceduto ? " checked" : ""}> Non è più in vita, ma la data non si sa</label>
      </fieldset>
      <label>Note <textarea name="note" rows="6" placeholder="Ricordi, mestiere, dove ha vissuto, da chi viene l'informazione…"${suggerisci ? lungo(MISURE.note) : ""}>${esc(p.note)}</textarea></label>
      ${suggerisci ? campiSuggerimento(commento, email) : ""}
      <p class="errore" hidden></p>
      <div class="azioni">
        <button type="submit" class="primario">${pulsante({ suggerisci }, "Salva")}</button>
        <button type="button" data-azione="annulla">Annulla</button>
      </div>
    </form>`;
  const titolo = suggerisci ? `Suggerisci: ${nomeCompleto(attuale)}` : applica ? `Applica: ${nomeCompleto(attuale)}`
    : nuova ? "Persona nuova" : `Modifica: ${nomeCompleto(attuale)}`;
  const fine = torna || (() => mostraPersona(ctx, id));
  ctx.apriPannello(titolo, html, azione => {
    if (azione === "annulla") (nuova ? ctx.chiudiPannello() : fine());
  }, corpo => {
    const f = corpo.querySelector("form");
    for (const nome of evidenzia) f.querySelector(`[name=${nome}]`)?.closest("fieldset, label")?.classList.add("da-completare");
    const primo = f.querySelector(`[name=${evidenzia[0] || "nome"}]`);
    if (evidenzia.length) { primo.focus({ preventScroll: true }); primo.scrollIntoView({ block: "center" }); } else primo.focus();
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const v = n => f.elements[n].value;
      const errore = f.querySelector(".errore");
      const segnala = testo => { errore.textContent = testo; errore.hidden = false; };
      const nascita = normalizzaData(v("nascita")), morte = normalizzaData(v("morte"));
      if (!nascita.valida || !morte.valida) return segnala("Una data non è valida: scrivila come 05/05/1968, 05/1968 oppure 1968.");
      if (nascita.data && morte.data && morte.data < nascita.data) return segnala("La data di morte viene prima di quella di nascita.");
      const dopo = {
        ...p,
        nome: v("nome").trim(), cognome: v("cognome").trim(), soprannome: v("soprannome").trim(), sesso: v("sesso"),
        nascita: { data: nascita.data, circa: f.elements.nascitaCirca.checked && !!nascita.data, luogo: v("nascitaLuogo").trim() },
        morte: { data: morte.data, circa: f.elements.morteCirca.checked && !!morte.data, luogo: v("morteLuogo").trim() },
        deceduto: f.elements.deceduto.checked && !morte.data,
        note: v("note").trim(),
      };
      if (suggerisci) {
        const campi = differenze(attuale, dopo, CAMPI_PERSONA);
        if (!Object.keys(campi).length) return segnala("Non hai cambiato nulla: correggi o completa almeno un campo.");
        const extra = invio(f, segnala);
        if (!extra) return;
        try {
          if (await suggerisci({ azione: "dati", campi }, extra)) fine();
        } catch (err) { ctx.errore(err); }
        return;
      }
      if (!nuova) {
        const ora = ctx.indici().persona.get(id);
        if (ora && ms(ora.aggiornato?.quando) !== versione) {
          const ok = await ctx.conferma(`${ora.aggiornato?.chi || "Qualcun altro"} ha cambiato questa scheda mentre la modificavi. Salvo comunque la tua versione?`, "Salva la mia");
          if (!ok) return mostraPersona(ctx, id);
        }
      }
      try {
        if (dopoSalvataggio) await dopoSalvataggio(dopo);
        else await ctx.salva({ operazioni: [{ raccolta: "persone", id, dopo }], applicati: applicati(ctx, applica),
          descrizione: suSuggerimento(`Modificata la scheda di ${nomeCompleto(dopo)}`, applica) });
        if (torna) torna(); else mostraPersona(ctx, dopo.id);
      } catch (err) { ctx.errore(err); }
    });
  }, da ? { da } : {});
}

// ------------------------------------------------------------ scelta di una persona (nuova o esistente)

// iniziale: {id} oppure {nuova: {nome, cognome, nascita}}; suggerimento: chiede il commento;
// conNascita: chiede anche la nascita di chi è nuovo (in chi suggerisce e in chi applica).
function scegliPersona(ctx, { titolo, spiegazione = "", ammessa = () => true, conCoppia = null, sopra = "",
  iniziale = null, commento = "", email = "", suggerimento = false, conNascita = false }) {
  const n0 = iniziale?.nuova || {};
  return ctx.dialogo(`
    <form method="dialog" class="modulo scelta">
      <h2>${esc(titolo)}</h2>
      ${sopra}
      ${spiegazione ? `<p class="spiegazione">${spiegazione}</p>` : ""}
      ${conCoppia || ""}
      <div class="schede-scelta">
        <label><input type="radio" name="modo" value="nuova" checked> Persona nuova</label>
        <label><input type="radio" name="modo" value="esistente"> Già nell'albero</label>
      </div>
      <div data-se="nuova" class="due">
        <label>Nome <input name="nome" value="${esc(n0.nome)}" autocomplete="off" maxlength="${MISURE.nome}"></label>
        <label>Cognome <input name="cognome" value="${esc(n0.cognome)}" autocomplete="off" maxlength="${MISURE.nome}"></label>
      </div>
      ${conNascita ? `<div data-se="nuova" class="due">
        <label>Nascita <span class="facoltativo">se la sai</span><input name="nascita" value="${esc(dataInIngresso(n0.nascita))}" placeholder="gg/mm/aaaa, mm/aaaa o aaaa" inputmode="numeric"></label>
        <label>Luogo di nascita <input name="nascitaLuogo" value="${esc(n0.nascita?.luogo)}" autocomplete="off" maxlength="${MISURE.luogo}"></label>
      </div>` : ""}
      <div data-se="esistente" hidden>
        <input name="cerca" type="search" placeholder="Cerca per nome o cognome" autocomplete="off">
        <select name="scelta" size="7"></select>
      </div>
      ${suggerimento ? campiSuggerimento(commento, email) : ""}
      <p class="errore" hidden></p>
      <div class="azioni">
        <button value="ok" class="primario">${suggerimento ? "Invia il suggerimento" : "Aggiungi"}</button>
        <button value="annulla" formnovalidate>Annulla</button>
      </div>
    </form>`, (d, chiudi) => {
    const f = d.querySelector("form");
    const errore = f.querySelector(".errore");
    const segnala = testo => { errore.textContent = testo; errore.hidden = false; };
    const elenco = () => {
      const q = f.elements.cerca.value;
      const lista = (q ? cerca(ctx.albero(), q) : [...ctx.albero().persone].sort((a, b) => nomeCompleto(a).localeCompare(nomeCompleto(b), "it")))
        .filter(ammessa).slice(0, 80);
      f.elements.scelta.innerHTML = lista.map(p => `<option value="${esc(p.id)}">${esc(nomeCompleto(p))}</option>`).join("");
    };
    const modo = () => {
      const m = f.elements.modo.value;
      for (const el of d.querySelectorAll('[data-se="nuova"]')) el.hidden = m !== "nuova";
      d.querySelector('[data-se="esistente"]').hidden = m !== "esistente";
      if (m === "esistente") { elenco(); f.elements.cerca.focus(); } else f.elements.nome.focus();
    };
    f.addEventListener("change", e => { if (e.target.name === "modo") modo(); });
    f.elements.cerca.addEventListener("input", elenco);
    f.addEventListener("submit", e => {
      e.preventDefault();
      if (e.submitter?.value !== "ok") return chiudi(null);
      const coppia = f.elements.coppia?.value;
      const extra = invio(f, segnala);
      if (!extra) return;
      if (f.elements.modo.value === "nuova") {
        const nuova = { nome: f.elements.nome.value.trim(), cognome: f.elements.cognome.value.trim() };
        if (suggerimento && !nuova.nome && !nuova.cognome) return segnala("Scrivi almeno il nome o il cognome.");
        if (conNascita) {
          const data = normalizzaData(f.elements.nascita.value), luogo = f.elements.nascitaLuogo.value.trim();
          if (!data.valida) return segnala("La data di nascita non è valida: scrivila come 05/05/1968, 05/1968 oppure 1968.");
          if (data.data || luogo) nuova.nascita = { data: data.data, circa: false, luogo };
        }
        return chiudi({ nuova, coppia, ...extra });
      }
      const id = f.elements.scelta.value;
      if (!id) return segnala("Scegli una persona dall'elenco.");
      chiudi({ id, coppia, ...extra });
    });
    f.elements.nome.focus();
    // proposta da modificare o da applicare: la persona già nell'albero si ritrova cercandola
    const scelta = iniziale?.id && ctx.indici().persona.get(iniziale.id);
    if (iniziale?.id && !scelta) segnala("La persona suggerita non è più nell'albero: scegline un'altra o scrivila come persona nuova.");
    if (scelta) {
      f.elements.modo.value = "esistente";
      f.elements.cerca.value = [scelta.nome, scelta.cognome].filter(Boolean).join(" ");
      modo();
      f.elements.scelta.value = scelta.id;
      if (f.elements.scelta.value !== scelta.id) segnala(`${nomeCompleto(scelta)} non si può più collegare così: scegli un'altra persona.`);
    }
  });
}

// posizioni attuali (quelle disegnate) per collocare chi arriva
const posizioniAttuali = ctx => Object.fromEntries(ctx.scena().nodi.map(n => [n.id, { x: n.x, y: n.y }]));
const tondo = p => ({ x: Math.round(p.x), y: Math.round(p.y) });

async function aggiungiPartner(ctx, id, opz = {}) {
  const p = ctx.indici().persona.get(id);
  const scelta = await scegliPersona(ctx, {
    titolo: `${verbo(opz)} un partner di ${nomeCompleto(p)}`, ammessa: q => q.id !== id,
    spiegazione: opz.suggerisci ? "Marito, moglie, compagno o compagna. Se è già nell'albero, sceglilo dall'elenco." : "",
    sopra: richiamo(opz.applica), iniziale: opz.iniziale, commento: opz.commento, email: opz.email,
    suggerimento: !!opz.suggerisci, conNascita: !!(opz.suggerisci || opz.applica),
  });
  if (!scelta) return;
  if (opz.suggerisci) return opz.suggerisci({ azione: "partner", ...personaScelta(scelta) }, scelta);
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
  await ctx.salva({ operazioni, disposizione, applicati: applicati(ctx, opz.applica),
    descrizione: suSuggerimento(`Aggiunta la coppia ${nomeCompleto(p)} e ${nomeCompleto(q)}`, opz.applica) });
  ctx.seleziona(altro, { centra: true });
}

// opz.azione: «fratello» quando lo si suggerisce dalla scheda del fratello o della sorella
async function aggiungiFiglio(ctx, id, unioneScelta = null, opz = {}) {
  const ix = ctx.indici();
  const p = ix.persona.get(id);
  const unioni = (ix.unioniDi.get(id) || []).map(uid => ix.unione.get(uid));
  let coppia = "";
  if (!unioneScelta && unioni.length > 1) {
    coppia = `<label>Con chi? <select name="coppia">${unioni.map(u => `<option value="${esc(u.id)}">${esc(nomeCompleto(ix.persona.get(coniugeIn(u, id))))}</option>`).join("")}</select></label>`;
  }
  const scelta = await scegliPersona(ctx, {
    titolo: opz.titolo || `${verbo(opz)} un figlio o una figlia di ${nomeCompleto(p)}`,
    spiegazione: unioni.length ? "" : opz.suggerisci ? "Se sai chi è l'altro genitore, scrivilo in «Come lo sai?»."
      : "L'altro genitore comparirà come «non noto»: potrai completarlo dopo.",
    ammessa: q => q.id !== id && !ix.genitoriDi.has(q.id), conCoppia: coppia,
    sopra: richiamo(opz.applica), iniziale: opz.iniziale, commento: opz.commento, email: opz.email,
    suggerimento: !!opz.suggerisci, conNascita: !!(opz.suggerisci || opz.applica),
  });
  if (!scelta) return;
  if (opz.suggerisci) {
    const unione = unioneScelta || scelta.coppia || unioni[0]?.id;
    return opz.suggerisci({ azione: opz.azione || "figlio", ...(unione ? { unione } : {}), ...personaScelta(scelta) }, scelta);
  }
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
  await ctx.salva({ operazioni, disposizione, applicati: applicati(ctx, opz.applica),
    descrizione: suSuggerimento(`Aggiunto un figlio di ${nomeCompleto(p)}`, opz.applica) });
  ctx.seleziona(figlio, { centra: true });
}

async function aggiungiGenitori(ctx, id, opz = {}) {
  const ix = ctx.indici();
  const p = ix.persona.get(id);
  const coppie = ctx.albero().unioni;
  const g = opz.iniziale?.nuovi || [{}, {}];
  const valore = (i, campo) => esc(g[i]?.[campo] || "");
  const scelta = await ctx.dialogo(`
    <form method="dialog" class="modulo scelta">
      <h2>${verbo(opz)} i genitori di ${esc(nomeCompleto(p))}</h2>
      ${richiamo(opz.applica)}
      <div class="schede-scelta">
        <label><input type="radio" name="modo" value="nuovi" checked> Persone nuove</label>
        <label><input type="radio" name="modo" value="coppia"> Una coppia già nell'albero</label>
      </div>
      <div data-se="nuovi">
        <p class="spiegazione">Lascia vuoto chi non conosci: comparirà come «non noto».</p>
        <div class="due"><label>Nome del primo genitore <input name="n1" value="${valore(0, "nome")}" maxlength="${MISURE.nome}"></label><label>Cognome <input name="c1" value="${valore(0, "cognome")}" maxlength="${MISURE.nome}"></label></div>
        <div class="due"><label>Nome del secondo genitore <input name="n2" value="${valore(1, "nome")}" maxlength="${MISURE.nome}"></label><label>Cognome <input name="c2" value="${valore(1, "cognome")}" maxlength="${MISURE.nome}"></label></div>
      </div>
      <div data-se="coppia" hidden>
        <select name="coppia" size="7">${coppie.map(u => `<option value="${esc(u.id)}">${esc(u.partner.map(q => nomeCompleto(ix.persona.get(q))).join(" e "))}</option>`).join("")}</select>
      </div>
      ${opz.suggerisci ? campiSuggerimento(opz.commento, opz.email) : ""}
      <p class="errore" hidden></p>
      <div class="azioni"><button value="ok" class="primario">${pulsante(opz, "Aggiungi")}</button><button value="annulla" formnovalidate>Annulla</button></div>
    </form>`, (d, chiudi) => {
    const f = d.querySelector("form");
    const errore = f.querySelector(".errore");
    const segnala = testo => { errore.textContent = testo; errore.hidden = false; };
    const modo = () => {
      d.querySelector('[data-se="nuovi"]').hidden = f.elements.modo.value !== "nuovi";
      d.querySelector('[data-se="coppia"]').hidden = f.elements.modo.value !== "coppia";
    };
    f.addEventListener("change", e => { if (e.target.name === "modo") modo(); });
    f.addEventListener("submit", e => {
      e.preventDefault();
      if (e.submitter?.value !== "ok") return chiudi(null);
      const extra = invio(f, segnala);
      if (!extra) return;
      if (f.elements.modo.value === "coppia") {
        return f.elements.coppia.value ? chiudi({ coppia: f.elements.coppia.value, ...extra }) : segnala("Scegli una coppia dall'elenco.");
      }
      const nuovi = [1, 2].map(i => ({ nome: f.elements[`n${i}`].value.trim(), cognome: f.elements[`c${i}`].value.trim() }));
      if (opz.suggerisci && !nuovi.some(n => n.nome || n.cognome)) return segnala("Scrivi almeno un nome o un cognome.");
      chiudi({ nuovi, ...extra });
    });
    const coppia = opz.iniziale?.coppia;
    if (coppia && ix.unione.has(coppia)) {
      f.elements.modo.value = "coppia";
      modo();
      f.elements.coppia.value = coppia;
    } else if (coppia) segnala("La coppia suggerita non è più nell'albero.");
  });
  if (!scelta) return;
  if (opz.suggerisci) {
    return opz.suggerisci({ azione: "genitori", ...(scelta.coppia ? { coppia: scelta.coppia } : { nuovi: scelta.nuovi }) }, scelta);
  }
  const albero = ctx.albero();
  if (scelta.coppia) {
    const u = ix.unione.get(scelta.coppia);
    await ctx.salva({ operazioni: [{ raccolta: "unioni", id: u.id, dopo: { ...u, figli: [...u.figli, id] } }],
      applicati: applicati(ctx, opz.applica), descrizione: suSuggerimento(`Collegati i genitori di ${nomeCompleto(p)}`, opz.applica) });
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
  await ctx.salva({ operazioni, disposizione, applicati: applicati(ctx, opz.applica),
    descrizione: suSuggerimento(`Aggiunti i genitori di ${nomeCompleto(p)}`, opz.applica) });
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

function modificaUnione(ctx, uid, { iniziale = null, suggerisci = null, commento = "", email = "", applica = null } = {}) {
  const ix = ctx.indici();
  const attuale = ix.unione.get(uid);
  if (!attuale) return ctx.avviso("Questa unione non è più nell'albero.");
  const u = iniziale ? { ...attuale, ...iniziale } : attuale;
  const coppia = attuale.partner.map(p => nomeCompleto(ix.persona.get(p))).join(" e ");
  const html = `
    <form class="modulo">
      ${richiamo(applica)}
      ${suggerisci ? `<p class="spiegazione">Correggi o completa quello che sai di questa coppia. Chi cura l'albero vedrà la tua proposta e la applicherà.</p>` : ""}
      <label>Stato <select name="stato">
        <option value="certa"${u.stato !== "ipotesi" ? " selected" : ""}>certa</option>
        <option value="ipotesi"${u.stato === "ipotesi" ? " selected" : ""}>ipotesi da confermare</option>
      </select></label>
      <label>Note <textarea name="note" rows="5"${suggerisci ? ` maxlength="${MISURE.note}" placeholder="Per esempio: si sono sposati a Napoli nel 1958"` : ""}>${esc(u.note)}</textarea></label>
      <label>Fonte <input name="fonte" value="${esc(u.fonte)}"${suggerisci ? ` maxlength="${MISURE.fonte}"` : ""}></label>
      ${suggerisci ? campiSuggerimento(commento, email) : ""}
      <p class="errore" hidden></p>
      <div class="azioni"><button type="submit" class="primario">${pulsante({ suggerisci }, "Salva")}</button><button type="button" data-azione="annulla">Annulla</button></div>
    </form>`;
  const titolo = suggerisci ? "Suggerisci: l'unione" : applica ? "Applica: l'unione" : "Modifica l'unione";
  ctx.apriPannello(titolo, html, azione => { if (azione === "annulla") mostraUnione(ctx, uid); }, corpo => {
    const f = corpo.querySelector("form");
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const dopo = { ...u, stato: f.elements.stato.value, note: f.elements.note.value.trim(), fonte: f.elements.fonte.value.trim() };
      try {
        if (suggerisci) {
          const errore = f.querySelector(".errore");
          const segnala = testo => { errore.textContent = testo; errore.hidden = false; };
          const campi = differenze(attuale, dopo, CAMPI_UNIONE);
          if (!Object.keys(campi).length) return segnala("Non hai cambiato nulla: correggi o completa almeno un campo.");
          const extra = invio(f, segnala);
          if (!extra) return;
          if (await suggerisci({ azione: "dati", campi }, extra)) mostraUnione(ctx, uid);
          return;
        }
        await ctx.salva({ operazioni: [{ raccolta: "unioni", id: uid, dopo }], applicati: applicati(ctx, applica),
          descrizione: suSuggerimento(`Modificata l'unione fra ${coppia}`, applica) });
        mostraUnione(ctx, uid);
      } catch (err) { ctx.errore(err); }
    });
  });
}

// ------------------------------------------------------------ suggerimenti

const VOCI = {
  dati: ["Correggi o completa i dati", "nome, date e luoghi, note"],
  datiIgnoto: ["Sai chi è?", "scrivi nome, cognome e quello che sai"],
  datiUnione: ["Correggi o completa i dati della coppia", "nozze, note, se l'unione è certa"],
  partner: ["Aggiungi un partner", "marito, moglie, compagno o compagna"],
  figlio: ["Aggiungi un figlio o una figlia", "anche se è già nell'albero"],
  fratello: ["Aggiungi un fratello o una sorella", "con gli stessi genitori"],
  genitori: ["Aggiungi i genitori", "anche uno solo dei due"],
};

// Chi ha il link di lettura sceglie che cosa proporre; poi si apre il modulo di sempre.
export async function suggerisci(ctx, nodo, tipo) {
  const ix = ctx.indici();
  let voci;
  if (tipo === "unione") voci = [["dati", ...VOCI.datiUnione], ["figlio", ...VOCI.figlio]];
  else {
    const p = ix.persona.get(nodo);
    if (!p) return;
    voci = [["dati", ...(ignoto(p) ? VOCI.datiIgnoto : VOCI.dati)], ["partner", ...VOCI.partner], ["figlio", ...VOCI.figlio],
      ix.genitoriDi.has(nodo) ? ["fratello", ...VOCI.fratello] : ["genitori", ...VOCI.genitori]];
  }
  const azione = await ctx.dialogo(`<form method="dialog" class="modulo"><h2>Suggerisci una modifica</h2>
    <p class="spiegazione">Che cosa vuoi proporre? Chi cura l'albero vedrà il suggerimento fra i post-it e lo potrà applicare.</p>
    <div class="griglia-pulsanti">${voci.map(([v, t, s]) => `<button value="${v}"><b>${esc(t)}</b><span>${esc(s)}</span></button>`).join("")}</div>
    <div class="azioni"><button value="no" formnovalidate>Annulla</button></div></form>`,
  (d, chiudi) => d.querySelector("form").addEventListener("submit", e => {
    e.preventDefault();
    chiudi(e.submitter?.value === "no" ? null : e.submitter?.value);
  }));
  if (azione) apriModulo(ctx, nodo, tipo, azione, { suggerisci: inviaSuggerimento(ctx, nodo, tipo), email: ctx.email() });
}

// Manda la proposta (nuova, o al posto di quella del post-it n); true se è partita.
// L'email resta su questo dispositivo e si ripropone al suggerimento successivo.
const inviaSuggerimento = (ctx, nodo, tipo, n = null) => async (proposta, { commento = "", email = "" } = {}) => {
  if (!await ctx.nomeAutore()) return false;
  if (email) ctx.ricordaEmail(email);
  if (n) await ctx.attendiPoco(ctx.dati().modificaPostit(n, { testo: commento, proposta, email }));
  else await ctx.attendiPoco(ctx.dati().aggiungiPostit({ nodo, tipo, testo: commento, proposta, email }));
  const risposta = email ? ` Ti scriveremo a ${email} quando sarà accettato o rifiutato.` : "";
  ctx.avviso((n ? "Suggerimento aggiornato." : "Suggerimento inviato: grazie! Chi cura l'albero lo vedrà fra i post-it.") + risposta);
  return true;
};

// Il modulo giusto per l'azione; opz: {suggerisci | applica, iniziale, commento, unione}.
function apriModulo(ctx, nodo, tipo, azione, opz) {
  const ix = ctx.indici();
  if (tipo === "unione") {
    const u = ix.unione.get(nodo);
    if (!u) return ctx.avviso("Questa unione non è più nell'albero.");
    if (azione === "dati") return modificaUnione(ctx, nodo, opz);
    const coppia = u.partner.map(p => nomeCompleto(ix.persona.get(p))).join(" e ");
    return aggiungiFiglio(ctx, u.partner[0], nodo, { ...opz, titolo: `${verbo(opz)} un figlio o una figlia di ${coppia}` });
  }
  const p = ix.persona.get(nodo);
  if (!p) return ctx.avviso("Questa persona non è più nell'albero.");
  if (azione === "dati") return modificaPersona(ctx, nodo, opz);
  if (azione === "partner") return aggiungiPartner(ctx, nodo, opz);
  if (azione === "figlio") {
    const u = ix.unione.get(opz.unione);
    return aggiungiFiglio(ctx, nodo, u?.partner.includes(nodo) ? u.id : null, opz);
  }
  if (azione === "fratello") {
    const u = ix.unione.get(ix.genitoriDi.get(nodo));
    if (!u) return ctx.avviso(`I genitori di ${nomeCompleto(p)} non sono nell'albero: aggiungi prima loro.`);
    return aggiungiFiglio(ctx, u.partner[0], u.id, { ...opz, azione: "fratello", titolo: `${verbo(opz)} un fratello o una sorella di ${nomeCompleto(p)}` });
  }
  if (azione === "genitori") {
    if (opz.applica && ix.genitoriDi.has(nodo)) {
      return ctx.avviso(`${nomeCompleto(p)} ha già i genitori nell'albero: leggi il suggerimento e correggi a mano, se serve.`);
    }
    return aggiungiGenitori(ctx, nodo, opz);
  }
}

function daProposta(n) {
  const pr = n.proposta;
  const iniziale = pr.azione === "dati" ? pr.campi
    : pr.azione === "genitori" ? { coppia: pr.coppia || null, nuovi: pr.nuovi || null }
    : { id: pr.persona || null, nuova: pr.nuova || null };
  return { iniziale, commento: n.testo || "", unione: pr.unione || null };
}

// «Cosa manca»: «Lo so io» (con il link di modifica «Completa») apre il modulo di sempre, con
// in cima che cosa manca e il cursore sul dato scelto (primo); finito o annullato, torna.
// I figli non noti si aggiungono dall'unione dei genitori, in un dialogo sopra l'elenco.
export function completaDaElenco(ctx, voce, { primo = null, torna }) {
  const opz = ctx.modifica ? {} : { suggerisci: inviaSuggerimento(ctx, voce.nodo, voce.tipo), email: ctx.email() };
  if (voce.tipo === "unione") return apriModulo(ctx, voce.nodo, "unione", "figlio", opz);
  const campi = voce.manca.map(m => m.campo);
  const dati = voce.manca.map(m => `${m.testo}${m.attesa ? ` (già suggerito da ${m.attesa})` : ""}`);
  const richiesta = campi[0] === "chi" ? "Non sappiamo chi è: scrivi il nome e il cognome, se li sai, e quello che sai di questa persona."
    : `Manca: ${dati.join(", ").replace(/, ([^,]*)$/, " e $1")}.${campi.some(c => c === "nascita" || c === "morte") ? " Va bene anche solo l'anno; se non sei sicuro, spunta «circa»." : ""}`;
  const evidenzia = [...new Set([primo, ...campi].filter(Boolean).flatMap(c => (c === "chi" ? ["nome", "cognome"] : [CAMPO_MODULO[c]])))];
  apriModulo(ctx, voce.nodo, "persona", "dati", { ...opz, richiesta, evidenzia, torna, da: "mancanti" });
}

// Chi ha scritto il suggerimento lo riapre per cambiarlo; chi modifica lo applica.
export const modificaSuggerimento = (ctx, n) => apriModulo(ctx, n.nodo, n.tipo, n.proposta.azione,
  { ...daProposta(n), email: n.avvisa ? ctx.email() : "", suggerisci: inviaSuggerimento(ctx, n.nodo, n.tipo, n) });
export const applicaSuggerimento = (ctx, n) =>
  apriModulo(ctx, n.nodo, n.tipo, n.proposta.azione, { ...daProposta(n), applica: n });

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
