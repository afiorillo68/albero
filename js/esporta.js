// Esportazioni pure: JSON (reimportabile), GEDCOM 5.5.1, draw.io, CSV.
// SVG, PNG e PDF partono da svg.js; PNG e PDF richiedono il browser (main.js).
import { GEOMETRIA } from "./layout.js";
import { statoInVita, TESTO_IN_VITA, formattaData } from "./deduzioni.js";
import { indici, nomeCompleto } from "./grafo.js";

const { NODO } = GEOMETRIA;

// ------------------------------------------------------------ JSON
const perOrdine = (a, b) => (a.ordine ?? 1e9) - (b.ordine ?? 1e9) || (a.id < b.id ? -1 : 1);

function semplice(v) {
  if (v && typeof v.toDate === "function") return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(semplice);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, semplice(x)]));
  return v;
}

export function aJSON(albero) {
  const pulito = {
    formato: "albero-genealogico/1",
    esportato: new Date().toISOString(),
    meta: semplice(albero.meta),
    persone: [...albero.persone].sort(perOrdine).map(semplice),
    unioni: [...albero.unioni].sort(perOrdine).map(semplice),
    disposizione: semplice(albero.disposizione || { nodi: {}, archi: {} }),
  };
  return JSON.stringify(pulito, null, 1) + "\n";
}

// ------------------------------------------------------------ GEDCOM 5.5.1
const MESI = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function dataGEDCOM(d) {
  if (!d?.data) return "";
  const [a, m, g] = d.data.split("-");
  const testo = [g && String(Number(g)), m && MESI[Number(m) - 1], a].filter(Boolean).join(" ");
  return d.circa ? `ABT ${testo}` : testo;
}

// testo libero su più righe: CONT a ogni a capo, CONC oltre i 200 caratteri
function righeLunghe(livello, tag, testo) {
  const out = [];
  String(testo).split(/\r?\n/).forEach((riga, i) => {
    const pezzi = riga.match(/.{1,200}/gsu) || [""];
    pezzi.forEach((pz, k) => {
      if (i === 0 && k === 0) out.push(`${livello} ${tag} ${pz}`);
      else out.push(`${livello + 1} ${k === 0 ? "CONT" : "CONC"} ${pz}`);
    });
  });
  return out;
}

export function aGEDCOM(albero) {
  const persone = [...albero.persone].sort(perOrdine);
  const unioni = [...albero.unioni].sort(perOrdine);
  const ix = indici(albero);
  const rI = new Map(persone.map((p, i) => [p.id, `@I${i + 1}@`]));
  const rF = new Map(unioni.map((u, i) => [u.id, `@F${i + 1}@`]));
  const L = ["0 HEAD", "1 SOUR ALBERO-DI-FAMIGLIA", "2 NAME Albero di famiglia", "1 GEDC", "2 VERS 5.5.1",
    "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8", "1 LANG Italian",
    `1 DATE ${dataGEDCOM({ data: new Date().toISOString().slice(0, 10) })}`];
  for (const p of persone) {
    L.push(`0 ${rI.get(p.id)} INDI`);
    const nome = p.segnaposto ? `(${p.nome || "non noti"})` : (p.nome || "");
    L.push(`1 NAME ${nome} /${p.cognome || ""}/`.replace(/\s+/g, " ").trim());
    if (p.nome && !p.segnaposto) L.push(`2 GIVN ${p.nome}`);
    if (p.cognome) L.push(`2 SURN ${p.cognome}`);
    if (p.soprannome) L.push(`2 NICK ${p.soprannome}`);
    if (p.sesso === "M" || p.sesso === "F") L.push(`1 SEX ${p.sesso}`);
    for (const [tag, d] of [["BIRT", p.nascita], ["DEAT", p.morte]]) {
      if (d?.data || d?.luogo) {
        L.push(`1 ${tag}`);
        if (d.data) L.push(`2 DATE ${dataGEDCOM(d)}`);
        if (d.luogo) L.push(`2 PLAC ${d.luogo}`);
      } else if (tag === "DEAT" && p.deceduto) L.push("1 DEAT Y");
    }
    if (p.note) L.push(...righeLunghe(1, "NOTE", p.note));
    L.push(`1 REFN ${p.id}`);
    for (const uid of ix.unioniDi.get(p.id) || []) L.push(`1 FAMS ${rF.get(uid)}`);
    if (ix.genitoriDi.has(p.id)) L.push(`1 FAMC ${rF.get(ix.genitoriDi.get(p.id))}`);
  }
  for (const u of unioni) {
    L.push(`0 ${rF.get(u.id)} FAM`);
    let [a, b] = u.partner;
    const sa = ix.persona.get(a)?.sesso, sb = ix.persona.get(b)?.sesso;
    if (sa === "F" || sb === "M") [a, b] = [b, a];
    L.push(`1 HUSB ${rI.get(a)}`, `1 WIFE ${rI.get(b)}`);
    for (const f of u.figli) L.push(`1 CHIL ${rI.get(f)}`);
    const nota = [u.note, u.fonte, u.stato === "ipotesi" ? "Unione ipotizzata, da confermare." : ""].filter(Boolean).join("\n");
    if (nota) L.push(...righeLunghe(1, "NOTE", nota));
    L.push(`1 REFN ${u.id}`);
  }
  L.push("0 TRLR");
  return L.join("\n") + "\n";
}

// ------------------------------------------------------------ draw.io
const xa = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
const he = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r0 = n => Math.round(n);

function etichettaHTML(n) {
  return n.righe.map(parti => {
    const html = parti.map(p => {
      let t = he(p.testo);
      if (p.grassetto) t = `<b>${t}</b>`;
      if (p.corsivo) t = `<i>${t}</i>`;
      if (p.grigio) t = `<font color="#7a7a7a">${t}</font>`;
      if (p.piccolo) t = `<font style="font-size:10px">${t}</font>`;
      return t;
    }).join("");
    return html;
  }).join("<br>");
}

export function aDrawio(scena, albero, oggi = new Date()) {
  const ix = indici(albero);
  const celle = [];
  const arcSize = 2 * scena.raggio;       // in draw.io il raggio degli spigoli è arcSize/2
  for (const f of scena.fasce) {
    celle.push(`<mxCell id="fascia-${f.g}" value="" style="rounded=0;html=1;fillColor=${f.sfondo};strokeColor=none;locked=1;" vertex="1" parent="1"><mxGeometry x="${r0(f.x)}" y="${r0(f.y)}" width="${r0(f.larghezza)}" height="${r0(f.altezza)}" as="geometry"/></mxCell>`);
    const testo = `<b>${he(f.titolo)}</b>` + (f.anni ? `<br>${he(f.anni)}` : "")
      + (f.base ? `<br><font style="font-size:11px" color="#777777">${f.stima ? `<i>${he(f.base)}</i>` : he(f.base)}</font>` : "");
    celle.push(`<mxCell id="fascia-testo-${f.g}" value="${xa(testo)}" style="text;html=1;align=left;verticalAlign=middle;fontSize=16;whiteSpace=wrap;fontColor=#444444;spacingLeft=16;" vertex="1" parent="1"><mxGeometry x="${r0(f.x)}" y="${r0(f.etichettaY - 38)}" width="200" height="76" as="geometry"/></mxCell>`);
  }
  // legenda
  let lx = scena.bbox.x;
  const ly = scena.bbox.y - 60;
  celle.push(`<mxCell id="titolo" value="${xa(`<b>${he(albero.meta?.titolo || "Albero di famiglia")}</b>`)}" style="text;html=1;align=left;verticalAlign=top;fontSize=22;" vertex="1" parent="1"><mxGeometry x="${r0(lx)}" y="${r0(ly - 50)}" width="600" height="40" as="geometry"/></mxCell>`);
  for (const c of scena.ceppi) {
    celle.push(`<mxCell id="leg-${xa(c.cognome)}" value="${xa(c.cognome)}" style="rounded=1;whiteSpace=wrap;html=1;arcSize=12;fillColor=${c.riempimento};strokeColor=${c.bordo};fontSize=12;" vertex="1" parent="1"><mxGeometry x="${r0(lx)}" y="${r0(ly)}" width="100" height="30" as="geometry"/></mxCell>`);
    lx += 110;
  }
  const archi = [];
  for (const a of scena.archi) {
    const [sorgente, destinazione] = a.tipo === "partner" ? [`p-${a.persona}`, `u-${a.unione}`] : [`u-${a.unione}`, `p-${a.persona}`];
    const interni = a.punti.slice(1, -1);
    const stile = `endArrow=none;html=1;rounded=1;arcSize=${arcSize};edgeStyle=none;strokeColor=${a.tratteggiato ? "#999999" : "#555555"};strokeWidth=1.5;`
      + (a.tratteggiato ? "dashed=1;" : "");
    const punti = interni.length ? `<Array as="points">${interni.map(q => `<mxPoint x="${r0(q.x)}" y="${r0(q.y)}"/>`).join("")}</Array>` : "";
    archi.push(`<mxCell id="a-${xa(a.id)}" style="${stile}" edge="1" parent="1" source="${xa(sorgente)}" target="${xa(destinazione)}"><mxGeometry relative="1" as="geometry">${punti}</mxGeometry></mxCell>`);
  }
  const nodi = [];
  for (const u of scena.unioni) {
    const stile = u.ipotesi
      ? "ellipse;html=1;aspect=fixed;fillColor=#ffffff;strokeColor=#999999;dashed=1;verticalLabelPosition=top;verticalAlign=bottom;fontSize=14;fontStyle=1;fontColor=#b85450;"
      : "ellipse;html=1;aspect=fixed;fillColor=#555555;strokeColor=#555555;";
    const un = ix.unione.get(u.id);
    const tooltip = [un?.note, un?.fonte, `Stato: ${un?.stato || "certa"}`].filter(Boolean).join("\n");
    nodi.push(`<object id="u-${xa(u.id)}" label="${u.ipotesi ? "?" : ""}" tooltip="${xa(tooltip)}"><mxCell style="${stile}" vertex="1" parent="1"><mxGeometry x="${r0(u.x - NODO / 2)}" y="${r0(u.y - NODO / 2)}" width="${NODO}" height="${NODO}" as="geometry"/></mxCell></object>`);
  }
  for (const n of scena.nodi) {
    const p = ix.persona.get(n.id);
    const date = [p.nascita?.data && `Nascita: ${formattaData(p.nascita)}${p.nascita.luogo ? `, ${p.nascita.luogo}` : ""}`,
      p.morte?.data && `Morte: ${formattaData(p.morte)}${p.morte.luogo ? `, ${p.morte.luogo}` : ""}`].filter(Boolean);
    const tooltip = [TESTO_IN_VITA[statoInVita(p, oggi)], ...date, p.note].filter(Boolean).join("\n");
    const stile = `rounded=1;whiteSpace=wrap;html=1;arcSize=12;fillColor=${n.riempimento};strokeColor=${n.bordo};fontSize=12;fontFamily=Helvetica;`
      + (n.tratteggiato ? "dashed=1;fontColor=#777777;" : "");
    nodi.push(`<object id="p-${xa(n.id)}" label="${xa(etichettaHTML(n))}" nome="${xa(nomeCompleto(p))}" tooltip="${xa(tooltip)}"><mxCell style="${stile}" vertex="1" parent="1"><mxGeometry x="${r0(n.x)}" y="${r0(n.cima)}" width="${n.w}" height="${n.h}" as="geometry"/></mxCell></object>`);
  }
  return '<mxfile host="albero-di-famiglia">\n  <diagram id="albero" name="Albero di famiglia">\n'
    + '    <mxGraphModel dx="1400" dy="900" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0">\n'
    + '      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n'
    + [...celle, ...archi, ...nodi].map(c => `        ${c}\n`).join("")
    + "      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n";
}

// ------------------------------------------------------------ CSV (separatore «;», per Excel in italiano)
const cella = v => {
  const s = String(v ?? "");
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = righe => "﻿" + righe.map(r => r.map(cella).join(";")).join("\r\n") + "\r\n";

// solo: insieme di id da esportare (i risultati di una ricerca); senza, tutte le persone
export function aCSVPersone(albero, oggi = new Date(), solo = null) {
  const ix = indici(albero);
  const testa = ["id", "nome", "cognome", "soprannome", "sesso", "nascita", "luogo di nascita", "morte",
    "luogo di morte", "in vita (dedotto)", "genitori", "note"];
  const righe = albero.persone.filter(p => !solo || solo.has(p.id)).sort(perOrdine).map(p => {
    const ug = ix.unione.get(ix.genitoriDi.get(p.id));
    return [p.id, p.nome, p.cognome, p.soprannome, p.sesso, formattaData(p.nascita), p.nascita?.luogo,
      formattaData(p.morte), p.morte?.luogo, TESTO_IN_VITA[statoInVita(p, oggi)],
      ug ? ug.partner.map(q => nomeCompleto(ix.persona.get(q))).join(" e ") : "", p.note];
  });
  return csv([testa, ...righe]);
}

export function aCSVUnioni(albero) {
  const ix = indici(albero);
  const nome = id => nomeCompleto(ix.persona.get(id));
  const testa = ["id", "partner 1", "partner 2", "figli", "stato", "fonte", "note"];
  const righe = [...albero.unioni].sort(perOrdine).map(u =>
    [u.id, nome(u.partner[0]), nome(u.partner[1]), u.figli.map(nome).join(", "), u.stato, u.fonte, u.note]);
  return csv([testa, ...righe]);
}
