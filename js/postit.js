// Post-it sulle persone e sulle unioni: li aggiunge chiunque abbia il link, anche in sola
// lettura (per esempio per suggerire una correzione); li cambia o li toglie chi li ha
// scritti, dallo stesso browser, oppure chi ha il link di modifica. Un suggerimento è un
// post-it con la modifica proposta, che chi modifica applica dal modulo già compilato.
// Solo browser; riceve il contesto dell'app da main.js.
import { esc } from "./svg.js";
import { nomeCompleto } from "./grafo.js";
import { descriviProposta, riassunto } from "./proposte.js";
import { suggerisci, modificaSuggerimento, applicaSuggerimento } from "./scheda.js";

const MASSIMO = 2000;            // caratteri, come nelle regole di Firestore
const ms = ts => (ts?.toMillis ? ts.toMillis() : Date.now());     // in attesa del server: adesso
const quando = ts => new Date(ms(ts)).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
const testoNote = s => esc(s).replace(/\n/g, "<br>");

// sullo stesso riquadro si leggono in ordine, come una conversazione
const inOrdine = (a, b) => ms(a.creato) - ms(b.creato);
export const postitDi = (ctx, nodo) => ctx.postit().filter(n => n.nodo === nodo).sort(inOrdine);
const mio = (ctx, n) => ctx.modifica || (!!n.uid && n.uid === ctx.mioUid());

function nomeNodo(ctx, n) {
  const ix = ctx.indici();
  if (n.tipo === "persona") return ix.persona.has(n.nodo) ? nomeCompleto(ix.persona.get(n.nodo)) : null;
  const u = ix.unione.get(n.nodo);
  return u ? `Unione fra ${u.partner.map(p => nomeCompleto(ix.persona.get(p))).join(" e ")}` : null;
}

// chi modifica accetta (applica) o rifiuta i suggerimenti; gli altri comandi come per ogni post-it
function comandi(ctx, n) {
  const b = (azione, testo) => `<button type="button" class="collegamento" data-azione="${azione}" data-postit="${esc(n.id)}">${testo}</button>`;
  if (ctx.modifica && n.proposta) return `<span class="comandi-postit">${b("postit-applica", "applica…")}${b("postit-rifiuta", "rifiuta…")}</span>`;
  return mio(ctx, n) ? `<span class="comandi-postit">${b("postit-modifica", "modifica")}${b("postit-togli", "togli")}</span>` : "";
}

function biglietto(ctx, n) {
  const altro = n.modificatoDa && n.modificatoDa !== n.autore ? ` · modificato da ${esc(n.modificatoDa)}` : "";
  let corpo = `<p>${testoNote(n.testo)}</p>`;
  if (n.proposta) {
    const { titolo, righe } = descriviProposta(ctx.indici(), n);
    const risposta = !n.avvisa ? "" : ctx.modifica ? `${esc(n.autore)} riceverà la risposta per mail.` : mio(ctx, n) ? "Riceverai la risposta per mail." : "";
    corpo = `<div class="testa-suggerimento"><span class="marchio-suggerimento">Suggerimento</span> ${esc(titolo)}</div>
      ${righe.length ? `<ul class="proposta">${righe.map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
      ${n.testo ? `<p class="commento">${testoNote(n.testo)}</p>` : ""}
      ${risposta ? `<p class="avvisa">✉ ${risposta}</p>` : ""}`;
  }
  return `<div class="biglietto${n.proposta ? " suggerimento" : ""}">${corpo}
    <div class="firma"><span>${esc(n.autore)}, ${esc(quando(n.creato))}${altro}</span>${comandi(ctx, n)}</div></div>`;
}

// Invito sopra i post-it: chi legge è il familiare che sa qualcosa; chi modifica li smaltisce.
const INVITO = {
  persona: "Se sai la data o il luogo di nascita, un soprannome o altre notizie su questa persona, scrivile in un post-it. Se manca un parente o un dato è sbagliato, suggerisci la modifica: l'albero verrà aggiornato appena possibile.",
  unione: "Se sai quando e dove si sono sposati o altre notizie su questa coppia, scrivile in un post-it. Se manca un figlio o un dato è sbagliato, suggerisci la modifica: l'albero verrà aggiornato appena possibile.",
  modifica: "Qui i familiari lasciano notizie, correzioni e suggerimenti. «Applica» apre la modifica già compilata: la controlli, la salvi e il suggerimento sparisce. Chi ha lasciato l'email riceve la risposta, sia che accetti sia che rifiuti. Quando hai aggiornato l'albero da un post-it, toglilo.",
};

// Sezione per la scheda di una persona o di un'unione (tipo: "persona" | "unione").
export function sezionePostit(ctx, nodo, tipo) {
  const note = postitDi(ctx, nodo);
  const suggerisci = ctx.modifica ? ""
    : `<button type="button" class="aggiungi-postit suggerisci" data-azione="postit-suggerisci">✎ Suggerisci una modifica</button>`;
  return `<section class="sezione-postit" id="postit-scheda"><h3>Post-it e suggerimenti${note.length ? ` · ${note.length}` : ""}</h3>
    <p class="spiegazione">${esc(INVITO[ctx.modifica ? "modifica" : tipo])}</p>
    ${note.map(n => biglietto(ctx, n)).join("")}
    <div class="aggiungi-due"><button type="button" class="aggiungi-postit" data-azione="postit-aggiungi">+ Aggiungi un post-it</button>${suggerisci}</div></section>`;
}

export const azioneDiPostit = azione => azione?.startsWith("postit-");

function scrivi(ctx, titolo, iniziale = "") {
  return ctx.dialogo(`<form method="dialog" class="modulo"><h2>${esc(titolo)}</h2>
    <p class="spiegazione">Lo vedono tutti quelli che hanno il link. Se suggerisci una correzione, chi ha il link di modifica la può fare e poi togliere il post-it.</p>
    <textarea name="testo" rows="6" maxlength="${MASSIMO}" required placeholder="Per esempio: la data di nascita è il 12/03/1931, me l'ha detto la zia">${esc(iniziale)}</textarea>
    <div class="azioni"><button value="ok" class="primario">Salva</button><button value="no" formnovalidate>Annulla</button></div></form>`,
  (d, chiudi) => {
    const f = d.querySelector("form");
    f.addEventListener("submit", e => {
      e.preventDefault();
      if (e.submitter?.value !== "ok") return chiudi(null);
      const t = f.elements.testo.value.trim();
      if (t) chiudi(t);
    });
    setTimeout(() => f.elements.testo.focus(), 30);
  });
}

// Il rifiuto di un suggerimento: il motivo (anche vuoto) se si conferma, null se si annulla.
function rifiuto(ctx, n) {
  return ctx.dialogo(`<form method="dialog" class="modulo"><h2>Rifiuti il suggerimento di ${esc(n.autore)}?</h2>
    <p class="spiegazione">Sparisce per tutti e non si può recuperare.${n.avvisa ? ` ${esc(n.autore)} riceverà una mail con la risposta.` : ""}</p>
    ${n.avvisa ? `<label>Vuoi dire perché? <span class="facoltativo">facoltativo, va nella mail</span>
      <textarea name="motivo" rows="3" maxlength="2000" placeholder="Per esempio: secondo lo stato di famiglia la data è un'altra"></textarea></label>` : ""}
    <div class="azioni"><button value="ok" class="pericolo">Rifiuta</button><button value="no" formnovalidate>Annulla</button></div></form>`,
  (d, chiudi) => {
    const f = d.querySelector("form");
    f.addEventListener("submit", e => {
      e.preventDefault();
      chiudi(e.submitter?.value === "ok" ? (f.elements.motivo?.value.trim() || "") : null);
    });
  });
}

// Esegue le azioni «postit-…» di schede e pannello. nodo: {nodo, tipo} per l'aggiunta.
export async function gestisciPostit(ctx, azione, el, nodo = null) {
  try {
    if (azione === "postit-suggerisci" && nodo) return await suggerisci(ctx, nodo.nodo, nodo.tipo);
    if (azione === "postit-aggiungi" && nodo) {
      const dove = nomeNodo(ctx, nodo) || "questo riquadro";
      const testo = await scrivi(ctx, `Post-it su ${dove}`);
      if (!testo || !await ctx.nomeAutore()) return;
      await ctx.attendiPoco(ctx.dati().aggiungiPostit({ ...nodo, testo }));
      ctx.avviso("Post-it aggiunto.");
    }
    const n = ctx.postit().find(x => x.id === el?.dataset.postit);
    if (!n) return;
    if (azione === "postit-applica" && n.proposta) return await applicaSuggerimento(ctx, n);
    if (azione === "postit-rifiuta" && n.proposta) {
      const motivo = await rifiuto(ctx, n);
      if (motivo === null) return;
      await ctx.attendiPoco(ctx.dati().rifiutaSuggerimento({ ...n, riassunto: riassunto(ctx.indici(), n) }, motivo));
      return ctx.avviso(n.avvisa ? `Suggerimento rifiutato: ${n.autore} riceverà la risposta per mail.` : "Suggerimento rifiutato.");
    }
    if (azione === "postit-modifica" && n.proposta) return await modificaSuggerimento(ctx, n);
    if (azione === "postit-modifica") {
      const testo = await scrivi(ctx, "Modifica il post-it", n.testo);
      if (!testo || testo === n.testo || !await ctx.nomeAutore()) return;
      await ctx.attendiPoco(ctx.dati().modificaPostit(n, { testo }));
    }
    if (azione === "postit-togli") {
      const cosa = n.proposta ? "questo suggerimento" : "questo post-it";
      if (!await ctx.conferma(`Tolgo ${cosa}? Sparisce per tutti e non si può recuperare.`, "Togli", true)) return;
      await ctx.attendiPoco(ctx.dati().togliPostit(n));
    }
  } catch (err) { ctx.errore(err); }
}

// Pannello con tutti i post-it dell'albero, raggruppati per persona o unione: prima i
// riquadri con il post-it più recente.
export function mostraTuttiPostit(ctx) {
  const gruppi = new Map();
  for (const n of [...ctx.postit()].sort((a, b) => inOrdine(b, a))) {
    if (!gruppi.has(n.nodo)) gruppi.set(n.nodo, []);
    gruppi.get(n.nodo).push(n);
  }
  const blocchi = [...gruppi.values()].map(gruppo => gruppo.sort(inOrdine)).map(note => {
    const n0 = note[0], nome = nomeNodo(ctx, n0);
    const testa = nome
      ? `<button type="button" class="collegamento titolo-postit" data-azione="vai-nodo" data-nodo="${esc(n0.nodo)}" data-tipo="${esc(n0.tipo)}">${esc(nome)}</button>`
      : `<span class="titolo-postit tolto">${n0.tipo === "persona" ? "Una persona" : "Un'unione"} non più nell'albero</span>`;
    return `<section class="gruppo-postit">${testa}${note.map(n => biglietto(ctx, n)).join("")}</section>`;
  }).join("");
  ctx.apriPannello("Post-it", `<div class="tutti-postit">
    <p class="spiegazione">Per aggiungere un post-it o suggerire una modifica apri la scheda di una persona o di un'unione. I riquadri con un post-it o un suggerimento hanno un bollino giallo.</p>
    ${blocchi || `<p class="vuoto">Nessun post-it, per ora.</p>`}</div>`, (azione, el) => {
    if (azione === "vai-nodo") return ctx.apriNodo(el.dataset.nodo, el.dataset.tipo, { centra: true });
    if (azioneDiPostit(azione)) return gestisciPostit(ctx, azione, el);
  }, null, { tipo: "postit" });
}
