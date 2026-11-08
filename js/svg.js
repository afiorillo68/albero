// Disegno SVG della scena, come testo: lo usano la vista (con gli attributi per
// l'interazione) e l'esportazione in SVG, PNG e PDF. Modulo puro.
import { percorsoArrotondato } from "./geometria.js";
import { GEOMETRIA } from "./layout.js";

const { NODO } = GEOMETRIA;
export const CARATTERE = "-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function testoRiquadro(n) {
  const righe = n.righe;
  // due o tre righe centrate nel riquadro
  const ys = righe.length === 1 ? [n.h / 2 + 4] : righe.length === 2 ? [n.h / 2 - 4, n.h / 2 + 12] : [17, 32, 47];
  return righe.map((parti, i) => {
    const pezzi = parti.map(p => {
      const st = [p.grassetto && 'font-weight="600"', p.corsivo && 'font-style="italic"',
        p.grigio && 'fill="#7a7a7a"'].filter(Boolean).join(" ");
      return `<tspan ${st}>${esc(p.testo)}</tspan>`;
    }).join("");
    const dim = parti.some(p => p.piccolo) ? 10.5 : 12.5;
    return `<text x="${n.w / 2}" y="${ys[i]}" text-anchor="middle" font-size="${dim}">${pezzi}</text>`;
  }).join("");
}

// Strati del disegno. interattivo: aggiunge data-* e le fasce larghe per cliccare gli archi.
export function strati(scena, { interattivo = false } = {}) {
  const fasce = scena.fasce.map(f => `<g class="fascia" data-g="${f.g}">`
    + `<rect x="${f.x}" y="${f.y}" width="${f.larghezza}" height="${f.altezza}" fill="${esc(f.sfondo)}"/>`
    + `<text x="${f.x + 16}" y="${f.etichettaY - 8}" font-size="16" font-weight="600" fill="#444">${esc(f.titolo)}</text>`
    + (f.anni ? `<text x="${f.x + 16}" y="${f.etichettaY + 12}" font-size="13" fill="#555">${esc(f.anni)}</text>` : "")
    + (f.base ? `<text x="${f.x + 16}" y="${f.etichettaY + 30}" font-size="11" fill="#888" font-style="${f.stima ? "italic" : "normal"}">${esc(f.base)}</text>` : "")
    + `</g>`).join("");

  const archi = scena.archi.map(a => {
    const d = percorsoArrotondato(a.punti, scena.raggio);
    const attr = interattivo ? ` data-arco="${esc(a.id)}" data-unione="${esc(a.unione)}" data-persona="${esc(a.persona)}"` : "";
    const presa = interattivo ? `<path class="presa-arco" d="${d}" fill="none" stroke="transparent" stroke-width="14"/>` : "";
    return `<g class="arco${a.automatico ? "" : " manuale"}"${attr}>${presa}`
      + `<path class="linea" d="${d}" fill="none" stroke="${a.tratteggiato ? "#999" : "#555"}" stroke-width="1.6"`
      + `${a.tratteggiato ? ' stroke-dasharray="6 4"' : ""} stroke-linejoin="round"/></g>`;
  }).join("");

  const unioni = scena.unioni.map(u => {
    const attr = interattivo ? ` data-unione="${esc(u.id)}"` : "";
    return u.ipotesi
      ? `<g class="unione"${attr}><circle cx="${u.x}" cy="${u.y}" r="${NODO / 2 + 1}" fill="#fff" stroke="#999" stroke-dasharray="3 2"/>`
        + `<text x="${u.x}" y="${u.y - 9}" text-anchor="middle" font-size="13" font-weight="700" fill="#b85450">?</text></g>`
      : `<g class="unione"${attr}><circle cx="${u.x}" cy="${u.y}" r="${NODO / 2}" fill="#555"/></g>`;
  }).join("");

  const nodi = scena.nodi.map(n => {
    const attr = interattivo ? ` data-persona="${esc(n.id)}"` : "";
    return `<g class="nodo${n.morto ? " morto" : ""}${n.tratteggiato ? " ignoto" : ""}"${attr} transform="translate(${n.x} ${n.y})">`
      + `<rect class="riquadro" width="${n.w}" height="${n.h}" rx="9" fill="${esc(n.riempimento)}" stroke="${esc(n.bordo)}"`
      + ` stroke-width="1.4"${n.tratteggiato ? ' stroke-dasharray="5 3"' : ""}/>`
      + testoRiquadro(n) + `</g>`;
  }).join("");

  return { fasce, archi, unioni, nodi };
}

// Documento SVG autonomo, con margine e legenda dei ceppi in alto.
export function documentoSVG(scena, { titolo = "Albero di famiglia", sottotitolo = "" } = {}) {
  const m = 30, alto = 90;
  const { x, y, x2, y2 } = scena.bbox;
  const larg = x2 - x + 2 * m, alt = y2 - y + 2 * m + alto;
  const s = strati(scena);
  let lx = x;
  const legenda = scena.ceppi.map(c => {
    const pezzo = `<rect x="${lx}" y="${y - alto + 34}" width="96" height="26" rx="7" fill="${esc(c.riempimento)}" stroke="${esc(c.bordo)}"/>`
      + `<text x="${lx + 48}" y="${y - alto + 51}" text-anchor="middle" font-size="12">${esc(c.cognome)}</text>`;
    lx += 104;
    return pezzo;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(larg)}" height="${Math.ceil(alt)}" `
    + `viewBox="${x - m} ${y - m - alto} ${Math.ceil(larg)} ${Math.ceil(alt)}" font-family="${CARATTERE}" fill="#1d1d1f">`
    + `<rect x="${x - m}" y="${y - m - alto}" width="${Math.ceil(larg)}" height="${Math.ceil(alt)}" fill="#ffffff"/>`
    + `<text x="${x}" y="${y - alto + 10}" font-size="22" font-weight="700">${esc(titolo)}</text>`
    + (sottotitolo ? `<text x="${x + 260}" y="${y - alto + 10}" font-size="13" fill="#666">${esc(sottotitolo)}</text>` : "")
    + legenda + s.fasce + s.archi + s.unioni + s.nodi + `</svg>\n`;
}
