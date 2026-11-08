// Storico delle modifiche: elenco per gruppi, differenze campo per campo, «Ripristina».
// Solo browser; riceve il contesto dell'app da main.js.
import { esc } from "./svg.js";
import { formattaData } from "./deduzioni.js";

const ETICHETTE = {
  nome: "nome", cognome: "cognome", soprannome: "soprannome", sesso: "sesso", note: "note",
  nascita: "nascita", morte: "morte", deceduto: "non più in vita (data non nota)",
  partner: "partner", figli: "figli", stato: "stato", fonte: "fonte",
};

function valore(campo, v, nome) {
  if (v === null || v === undefined || v === "") return "—";
  if (campo === "nascita" || campo === "morte") return [formattaData(v), v.luogo].filter(Boolean).join(", ") || "—";
  if (campo === "deceduto") return v ? "sì" : "no";
  if (campo === "partner" || campo === "figli") return v.map(nome).join(", ") || "—";
  return String(v);
}

function differenze(v, nome) {
  if (v.tipo === "disposizione") {
    const n = v.campi?.length || 0;
    return `<li>${n} ${n === 1 ? "elemento spostato o ridisegnato" : "elementi spostati o ridisegnati"}</li>`;
  }
  if (v.tipo === "meta") {
    return Object.keys(v.dopo || {}).map(k => `<li><b>${esc(k)}</b>: ${esc(JSON.stringify(v.prima?.[k] ?? null))} → ${esc(JSON.stringify(v.dopo[k]))}</li>`).join("");
  }
  if (!v.prima) return `<li>creata</li>`;
  if (!v.dopo) return `<li>eliminata</li>`;
  const out = [];
  for (const k of Object.keys(ETICHETTE)) {
    const a = valore(k, v.prima[k], nome), b = valore(k, v.dopo[k], nome);
    if (a !== b) out.push(`<li><b>${ETICHETTE[k]}</b>: ${esc(a)} → ${esc(b)}</li>`);
  }
  return out.join("") || `<li>nessuna differenza visibile</li>`;
}

export async function mostraStorico(ctx) {
  let mostraSpostamenti = false, voci = [], ultimo = null, finito = false;
  const nome = id => {
    const p = ctx.indici().persona.get(id);
    return p ? [p.nome, p.cognome].filter(Boolean).join(" ") || "non noto" : "(persona eliminata)";
  };

  async function carica() {
    const r = await ctx.storico({ dopo: ultimo });
    voci = voci.concat(r.voci);
    ultimo = r.ultimo;
    finito = r.voci.length === 0 || !r.ultimo;
  }

  function disegna() {
    const gruppi = new Map();
    for (const v of voci) {
      if (!gruppi.has(v.gruppo)) gruppi.set(v.gruppo, []);
      gruppi.get(v.gruppo).push(v);
    }
    const righe = [...gruppi.values()].filter(g => mostraSpostamenti || g.some(v => v.tipo !== "disposizione")).map(g => {
      const v = g[0];
      const data = v.quando?.toDate ? v.quando.toDate().toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" }) : "in salvataggio…";
      const nota = g.every(x => x.tipo === "nota");     // voci dell'amministrazione, senza un «prima»
      return `<li class="voce-storico">
        <div class="voce-testa"><span class="quando">${esc(data)}</span> · <span class="chi">${esc(v.chi)}</span></div>
        <div class="voce-titolo">${esc(v.descrizione || "")}</div>
        ${nota ? "" : `<details><summary>Dettagli</summary><ul class="differenze">${g.map(x => differenze(x, nome)).join("")}</ul></details>
        <button type="button" data-azione="ripristina" data-gruppo="${esc(v.gruppo)}" data-descrizione="${esc(v.descrizione || "")}">Ripristina com'era prima</button>`}
      </li>`;
    }).join("");
    ctx.apriPannello("Storico delle modifiche", `
      <div class="storico">
        <label class="spunta"><input type="checkbox" name="spostamenti"${mostraSpostamenti ? " checked" : ""}> Mostra anche gli spostamenti nel disegno</label>
        <ol class="voci">${righe || `<li class="vuoto">Nessuna modifica registrata.</li>`}</ol>
        ${finito ? "" : `<button type="button" data-azione="altre">Mostra modifiche più vecchie</button>`}
      </div>`, async (azione, el) => {
      if (azione === "altre") { await carica(); disegna(); }
      else if (azione === "ripristina") {
        const ok = await ctx.conferma(`Riporto com'era prima di «${el.dataset.descrizione}»? Anche il ripristino finisce nello storico.`, "Ripristina");
        if (!ok) return;
        try {
          await ctx.ripristina(el.dataset.gruppo, `Ripristino: ${el.dataset.descrizione}`);
          ctx.avviso("Ripristinato.");
          voci = []; ultimo = null; await carica(); disegna();
        } catch (err) { ctx.errore(err); }
      }
    }, corpo => {
      corpo.querySelector("[name=spostamenti]").addEventListener("change", e => { mostraSpostamenti = e.target.checked; disegna(); });
    });
  }

  ctx.apriPannello("Storico delle modifiche", `<p class="vuoto">Carico lo storico…</p>`);
  try { await carica(); disegna(); } catch (err) { ctx.errore(err); }
}
