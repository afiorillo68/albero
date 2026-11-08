// Impaginazione automatica dell'albero: porting fedele di script/genera_albero.py.
//
// Modulo puro, senza DOM: gira nel browser e con node (prove e migrazione).
// Ingresso: persone [{id, cognome, ...}] e unioni [{id, partner: [a, b], figli: [...]}],
// nell'ordine in cui vanno visitate, più i ceppi [{cognome}] (il primo sta a sinistra).
// Uscita: generazione e posizione di ogni persona (angolo in alto a sinistra del riquadro)
// e di ogni nodo d'unione (centro), più il conteggio di incroci e intrusioni.

export const GEOMETRIA = {
  W: 150, H: 56,          // riquadro persona
  GAP_COPPIA: 44,         // fra i due partner (ci sta il nodo dell'unione)
  GAP_FRATELLI: 26,       // fra fratelli
  GAP_GRUPPI: 80,         // fra gruppi non imparentati sulla stessa riga
  PASSO: 180,             // da una generazione alla successiva
  Y0: 230,                // prima generazione
  X0: 250,                // a sinistra: colonna delle etichette delle fasce
  NODO: 10,               // diametro del nodo dell'unione
};

const PESO_INCROCIO = 10; // un incrocio pesa più di un'intrusione

// sum() di Python dalla 3.12: somma compensata di Neumaier. Serve per avere
// esattamente gli stessi numeri dello script Python.
function somma(v) {
  let s = 0, c = 0;
  for (const x of v) {
    const t = s + x;
    if (Math.abs(s) >= Math.abs(x)) c += (s - t) + x;
    else c += (x - t) + s;
    s = t;
  }
  return c && Number.isFinite(c) ? s + c : s;
}

function media(v) {
  return v.length ? somma(v) / v.length : null;
}

// sorted(v, key=k) con chiave booleana: stabile, i falsi prima
function ordinaPerBooleano(v, k) {
  return v.map((x, i) => [k(x) ? 1 : 0, i, x]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(t => t[2]);
}

// min(v, key=k): il primo dei minimi
function minimoPer(v, k) {
  let meglio = v[0], km = k(v[0]);
  for (const x of v.slice(1)) {
    const kx = k(x);
    if (kx < km) { meglio = x; km = kx; }
  }
  return meglio;
}

function copia(ordine) {
  return new Map([...ordine].map(([g, f]) => [g, [...f]]));
}

function strutture(persone, unioni) {
  const P = new Map(persone.map(p => [p.id, p]));
  const U = new Map(unioni.map(u => [u.id, u]));
  const genitori = new Map();                       // figlio -> id unione
  const unioniDi = new Map(persone.map(p => [p.id, []]));
  for (const u of unioni) {
    for (const q of [...u.partner, ...u.figli]) {
      if (!P.has(q)) throw new Error(`Unione ${u.id}: persona sconosciuta «${q}»`);
    }
    unioniDi.get(u.partner[0]).push(u.id);
    unioniDi.get(u.partner[1]).push(u.id);
    for (const f of u.figli) {
      if (genitori.has(f)) throw new Error(`${f} ha due coppie di genitori: ${genitori.get(f)} e ${u.id}`);
      genitori.set(f, u.id);
    }
  }
  const coniuge = (uid, p) => {
    const [a, b] = U.get(uid).partner;
    return a === p ? b : a;
  };
  return { P, U, genitori, unioniDi, coniuge };
}

// Generazione familiare di ogni persona (0 = la più antica), con gli avvisi di incoerenza.
export function generazioni({ persone, unioni }) {
  return calcolaGenerazioni(persone, strutture(persone, unioni));
}

function calcolaGenerazioni(persone, { U, genitori, unioniDi, coniuge }) {
  const avvisi = [];
  const gen = new Map();
  for (const { id: inizio } of persone) {
    if (gen.has(inizio)) continue;
    gen.set(inizio, 0);
    const coda = [inizio];
    for (let testa = 0; testa < coda.length; testa++) {
      const p = coda[testa];
      const vicini = [];
      for (const uid of unioniDi.get(p)) {
        vicini.push([coniuge(uid, p), gen.get(p)]);
        for (const f of U.get(uid).figli) vicini.push([f, gen.get(p) + 1]);
      }
      if (genitori.has(p)) {
        const u = U.get(genitori.get(p));
        vicini.push([u.partner[0], gen.get(p) - 1], [u.partner[1], gen.get(p) - 1]);
      }
      for (const [q, g] of vicini) {
        if (!gen.has(q)) { gen.set(q, g); coda.push(q); }
        else if (gen.get(q) !== g) avvisi.push(`generazione incoerente per ${q} (${gen.get(q)} invece di ${g})`);
      }
    }
  }
  const base = gen.size ? Math.min(...gen.values()) : 0;
  for (const [p, g] of gen) gen.set(p, g - base);
  return { gen, avvisi };
}

export function impagina({ persone, unioni, ceppi = [] }, geometria = GEOMETRIA) {
  const { W, H, GAP_COPPIA, GAP_FRATELLI, GAP_GRUPPI, PASSO, Y0, X0 } = geometria;
  const S = strutture(persone, unioni);
  const { P, U, genitori, unioniDi, coniuge } = S;

  // ------------------------------------------------------------ generazioni
  const { gen, avvisi } = calcolaGenerazioni(persone, S);

  // ------------------------------------------------------------ ordine nelle righe
  // Visita in profondità dal capostipite del primo ceppo. I figli sposati con
  // qualcuno che porta con sé la propria famiglia vanno in fondo al gruppo dei
  // fratelli, così quella famiglia si apre subito alla loro destra.
  const righe = new Map();
  const riga = g => { if (!righe.has(g)) righe.set(g, []); return righe.get(g); };
  const emessi = new Set(), visitate = new Set();
  const portati = new Map();                        // persona -> famiglie acquisite da visitare dopo
  const porta = (chi, ...ps) => { if (!portati.has(chi)) portati.set(chi, []); portati.get(chi).push(...ps); };

  // il coniuge di p che porta con sé genitori non ancora disegnati, se c'è
  function famigliaPortata(p) {
    for (const uid of unioniDi.get(p)) {
      const s = coniuge(uid, p);
      if (!emessi.has(s) && genitori.has(s)) return s;
    }
    return null;
  }
  const portaFamiglia = p => famigliaPortata(p) !== null;

  // quante persone stanno sopra p: misura quanto è ingombrante la sua famiglia
  function antenati(p) {
    let n = 0;
    const coda = [p];
    while (coda.length) {
      const q = coda.pop();
      if (genitori.has(q)) {
        const u = U.get(genitori.get(q));
        n += 2;
        coda.push(u.partner[0], u.partner[1]);
      }
    }
    return n;
  }

  // mette p nella sua riga con i coniugi accanto; con due coniugi, uno va a sinistra
  function emetti(p, chiPorta, coniugeASinistra = false) {
    if (emessi.has(p)) return;
    const nuovi = unioniDi.get(p).map(uid => coniuge(uid, p)).filter(s => !emessi.has(s));
    const acquisiti = nuovi.filter(s => !genitori.has(s));
    if (acquisiti.length && (coniugeASinistra || nuovi.length >= 2)) {
      const s = acquisiti[0];                       // le sue eventuali altre unioni restano a destra di p
      riga(gen.get(s)).push(s);
      emessi.add(s);
    }
    riga(gen.get(p)).push(p);
    emessi.add(p);
    for (const uid of unioniDi.get(p)) {
      const s = coniuge(uid, p);
      if (emessi.has(s)) continue;
      if (genitori.has(s)) emettiFamiglia(s, chiPorta);
      else emetti(s, chiPorta);
    }
  }

  // s entra per matrimonio ma ha genitori: s, poi i genitori sopra, poi i fratelli
  function emettiFamiglia(s, chiPorta) {
    const pu = U.get(genitori.get(s));
    emetti(s, chiPorta, true);                      // s resta attaccato ai fratelli
    emettiCoppia(pu, chiPorta);
    porta(chiPorta, pu.partner[0], pu.partner[1]);
    const fratelli = ordinaPerBooleano(pu.figli.filter(f => !emessi.has(f)), portaFamiglia);
    for (const f of fratelli) emetti(f, chiPorta);
  }

  // i genitori di una famiglia acquisita; se anche il primo ha genitori, la sua
  // famiglia si apre a sinistra e quella del secondo a destra
  function emettiCoppia(pu, chiPorta) {
    const [p1, p2] = pu.partner;
    if (!emessi.has(p1)) {
      if (genitori.has(p1)) {
        const gp = U.get(genitori.get(p1));
        emettiCoppia(gp, chiPorta);
        porta(chiPorta, gp.partner[0], gp.partner[1]);
        for (const f of gp.figli) if (f !== p1) emetti(f, chiPorta);
      }
      emetti(p1, chiPorta);                         // tira dietro p2, e la famiglia di p2 a destra
    }
    if (!emessi.has(p2)) {
      if (genitori.has(p2)) emettiFamiglia(p2, chiPorta);
      else emetti(p2, chiPorta);
    }
  }

  // il coniuge s di c porta una famiglia che va a sinistra di c: fratelli di s, s, poi c;
  // i genitori di s si inseriscono nella riga sopra subito prima dei genitori di c
  function famigliaASinistra(s, c, uc) {
    const pu = U.get(genitori.get(s));
    for (const f of pu.figli) if (f !== s && !emessi.has(f)) emetti(f, c);
    riga(gen.get(s)).push(s);
    emessi.add(s);
    const filaSu = riga(gen.get(c) - 1);
    const ancora = minimoPer([uc.partner[0], uc.partner[1]], p => filaSu.indexOf(p));
    const nuovi = pu.partner.filter(p => !emessi.has(p));
    filaSu.splice(filaSu.indexOf(ancora), 0, ...nuovi);
    for (const p of nuovi) emessi.add(p);
    porta(c, pu.partner[0], pu.partner[1]);
    for (const p of nuovi) {
      if (genitori.has(p)) avvisi.push(`${p} ha genitori, la famiglia a sinistra si ferma un livello sopra`);
    }
  }

  function visita(p) {
    for (const uid of unioniDi.get(p)) {
      if (visitate.has(uid)) continue;
      visitate.add(uid);
      const u = U.get(uid);
      const figli = ordinaPerBooleano(u.figli, portaFamiglia);   // in fondo chi porta famiglia
      const portatori = figli.filter(portaFamiglia);
      let aSinistra = null;
      if (portatori.length >= 2) {                  // una famiglia sola si apre a destra: la più piccola va a sinistra
        aSinistra = minimoPer(portatori, f => antenati(famigliaPortata(f)));
        figli.splice(figli.indexOf(aSinistra), 1);
        figli.unshift(aSinistra);
      }
      for (const f of figli) {
        if (f === aSinistra) famigliaASinistra(famigliaPortata(f), f, u);
        emetti(f, f);
      }
      for (const f of figli) visita(f);
    }
    const lista = portati.get(p) || [];
    portati.delete(p);
    for (const q of lista) visita(q);
  }

  const radici = unioni.filter(u => !genitori.has(u.partner[0]) && !genitori.has(u.partner[1]));
  const ordineCeppi = new Map(ceppi.map((c, i) => [c.cognome, i]));
  const chiaveRadice = u => [ordineCeppi.get(P.get(u.partner[0]).cognome) ?? 99, gen.get(u.partner[0])];
  const radiciOrdinate = radici.map((u, i) => [chiaveRadice(u), i, u])
    .sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1] || a[1] - b[1]).map(t => t[2]);
  for (const u of radiciOrdinate) {
    if (visitate.has(u.id)) continue;
    for (const p of u.partner) emetti(p, u.partner[0]);
    visita(u.partner[0]);
  }
  for (const { id: p } of persone) {                // persone isolate, se ce ne sono
    if (!emessi.has(p)) { emetti(p, p); visita(p); }
  }

  // ------------------------------------------------------------ riduzione degli incroci
  // Spazzate alterne per baricentro sui blocchi di coniugi (metodo di Sugiyama),
  // poi ricerca locale; si tiene l'ordine con meno incroci genitori-figli.

  // i blocchi di coniugi di una riga, ciascuno ordinato come un cammino di matrimoni
  function catene(fila) {
    const dentro = new Set(fila), visti = new Set(), out = [];
    const indice = new Map();
    fila.forEach((p, i) => { if (!indice.has(p)) indice.set(p, i); });
    for (const p of fila) {
      if (visti.has(p)) continue;
      let comp = [];
      const coda = [p];
      visti.add(p);
      while (coda.length) {
        const q = coda.pop();
        comp.push(q);
        for (const uid of unioniDi.get(q)) {
          const s = coniuge(uid, q);
          if (dentro.has(s) && !visti.has(s)) { visti.add(s); coda.push(s); }
        }
      }
      comp.sort((a, b) => indice.get(a) - indice.get(b));
      if (comp.length > 2) {                        // chi ha due coniugi sta in mezzo
        const vicini = new Map(comp.map(q => [q, unioniDi.get(q).map(uid => coniuge(uid, q)).filter(s => comp.includes(s))]));
        const estremi = comp.filter(q => vicini.get(q).length === 1);
        if (estremi.length) {
          const cammino = [estremi[0]];
          while (cammino.length < comp.length) {
            const nuovi = vicini.get(cammino.at(-1)).filter(s => !cammino.includes(s));
            if (!nuovi.length) break;
            cammino.push(nuovi[0]);
          }
          if (cammino.length === comp.length) comp = cammino;
        }
      }
      out.push(comp);
    }
    return out;
  }

  function posizioni(ordine) {
    const pos = new Map();
    for (const fila of ordine.values()) fila.forEach((p, i) => pos.set(p, (i + 0.5) / fila.length));
    return pos;
  }

  const posUnione = (uid, pos) => (pos.get(U.get(uid).partner[0]) + pos.get(U.get(uid).partner[1])) / 2;

  function incroci(ordine) {
    const pos = posizioni(ordine);
    const archi = new Map();
    for (const u of unioni) {
      const a = posUnione(u.id, pos);
      for (const f of u.figli) {
        const g = gen.get(f);
        if (!archi.has(g)) archi.set(g, []);
        archi.get(g).push([a, pos.get(f)]);
      }
    }
    let tot = 0;
    for (const lista of archi.values()) {
      for (let i = 0; i < lista.length; i++) {
        for (let j = i + 1; j < lista.length; j++) {
          const [a1, c1] = lista[i], [a2, c2] = lista[j];
          if ((a1 - a2) * (c1 - c2) < 0) tot++;
        }
      }
    }
    return tot;
  }

  // riordina i blocchi della riga g sul baricentro dei genitori (giù) o dei figli (su)
  function spazzata(ordine, g, verso) {
    const pos = posizioni(ordine);
    const bl = catene(ordine.get(g));
    const chiavi = bl.map(b => {
      let k;
      if (verso === "giù") {
        k = media(b.filter(p => genitori.has(p)).map(p => posUnione(genitori.get(p), pos)));
      } else {
        const v = [];
        for (const p of b) {
          for (const uid of unioniDi.get(p)) {
            if (b.includes(coniuge(uid, p))) for (const f of U.get(uid).figli) v.push(pos.get(f));
          }
        }
        k = media(v);
      }
      return k !== null ? k : media(b.map(p => pos.get(p)));
    });
    const nuovi = [];
    const coppie = bl.map((b, i) => [chiavi[i], i, b]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    for (let [, , b] of coppie) {
      if (b.length > 1) {                           // verso del blocco: ciascuno dalla parte dei suoi genitori
        const sx = genitori.has(b[0]) ? posUnione(genitori.get(b[0]), pos) : null;
        const dx = genitori.has(b.at(-1)) ? posUnione(genitori.get(b.at(-1)), pos) : null;
        if (sx !== null && dx !== null && sx > dx) b = [...b].reverse();
      }
      nuovi.push(...b);
    }
    ordine.set(g, nuovi);
  }

  const unioniDellaRiga = new Map();
  for (const u of unioni) {
    const g = gen.get(u.partner[0]);
    if (!unioniDellaRiga.has(g)) unioniDellaRiga.set(g, []);
    unioniDellaRiga.get(g).push(u);
  }

  // archi fra le unioni della riga g e i figli nella g+1, come [posizione unione, posizione figlio]
  function archiSotto(ordine, g) {
    if (!ordine.has(g) || !ordine.has(g + 1)) return [];
    const su = new Map(ordine.get(g).map((p, i) => [p, i]));
    const giu = new Map(ordine.get(g + 1).map((p, i) => [p, i]));
    const out = [];
    for (const u of unioniDellaRiga.get(g) || []) {
      const a = (su.get(u.partner[0]) + su.get(u.partner[1])) / 2;
      for (const f of u.figli) out.push([a, giu.get(f)]);
    }
    return out;
  }

  function conta(archi) {
    let n = 0;
    for (let i = 0; i < archi.length; i++) {
      for (let j = i + 1; j < archi.length; j++) {
        if ((archi[i][0] - archi[j][0]) * (archi[i][1] - archi[j][1]) < 0) n++;
      }
    }
    return n;
  }

  // persone della riga g che stanno fra due fratelli senza esserne fratelli né coniugi
  function intrusioni(ordine, g) {
    if (!ordine.has(g) || !ordine.has(g - 1)) return 0;
    const fila = ordine.get(g);
    const idx = new Map(fila.map((p, i) => [p, i]));
    let n = 0;
    for (const u of unioniDellaRiga.get(g - 1) || []) {
      if (u.figli.length < 2) continue;
      const posti = u.figli.map(f => idx.get(f));
      const diCasa = new Set(u.figli);
      for (const f of u.figli) for (const uid of unioniDi.get(f)) diCasa.add(coniuge(uid, f));
      for (const p of fila.slice(Math.min(...posti) + 1, Math.max(...posti))) if (!diCasa.has(p)) n++;
    }
    return n;
  }

  const costo = ordine => PESO_INCROCIO * incroci(ordine) + somma([...ordine.keys()].map(g => intrusioni(ordine, g)));

  // ricerca locale: ogni blocco prova ogni posizione della sua riga, nei due versi
  function setaccio(ordine) {
    const locali = g => PESO_INCROCIO * (conta(archiSotto(ordine, g - 1)) + conta(archiSotto(ordine, g)))
      + intrusioni(ordine, g);
    let migliorato = true;
    while (migliorato) {
      migliorato = false;
      for (const g of [...ordine.keys()].sort((a, b) => a - b)) {
        for (const capo of catene(ordine.get(g)).map(b => b[0])) {
          const bl = catene(ordine.get(g));
          const b = bl.find(x => x.includes(capo));
          const resto = bl.filter(x => x !== b);
          let meglio = locali(g), scelta = null;
          for (let i = 0; i <= resto.length; i++) {
            for (const verso of (b.length > 1 ? [b, [...b].reverse()] : [b])) {
              ordine.set(g, [...resto.slice(0, i), verso, ...resto.slice(i)].flat());
              const c = locali(g);
              if (c < meglio) { meglio = c; scelta = [...ordine.get(g)]; }
            }
          }
          if (scelta) { ordine.set(g, scelta); migliorato = true; }
          else ordine.set(g, bl.flat());
        }
      }
    }
    return ordine;
  }

  const ordine = copia(righe);
  const incrociIniziali = incroci(ordine);
  let migliore = copia(ordine), minimo = incrociIniziali;
  const livelli = [...ordine.keys()].sort((a, b) => a - b);
  for (let it = 0; it < 24; it++) {
    for (const [verso, seq] of [["giù", livelli.slice(1)], ["su", livelli.slice(0, -1).reverse()]]) {
      for (const g of seq) spazzata(ordine, g, verso);
      const c = incroci(ordine);
      if (c < minimo) { migliore = copia(ordine); minimo = c; }
    }
  }
  // ricerca locale da due partenze; a parità vince l'ordine della visita, più leggibile
  const candidati = [setaccio(copia(righe)), setaccio(migliore)];
  const finale = costo(candidati[1]) < costo(candidati[0]) ? candidati[1] : candidati[0];

  // ------------------------------------------------------------ blocchi e posizioni
  // Un blocco è una fila di persone unite da matrimonio, che si muove rigida.
  const sposati = (a, b) => unioniDi.get(a).some(uid => coniuge(uid, a) === b);
  const blocchi = new Map();
  for (const [g, fila] of finale) {
    const bl = [];
    for (const p of fila) {
      if (bl.length && sposati(bl.at(-1).at(-1), p)) bl.at(-1).push(p);
      else bl.push([p]);
    }
    blocchi.set(g, bl);
  }
  const offset = new Map(), larghezza = new Map(), bloccoDi = new Map(), xb = new Map();
  const chiave = (g, i) => `${g},${i}`;
  for (const [g, bl] of blocchi) {
    bl.forEach((b, i) => {
      let x = 0;
      for (const p of b) { offset.set(p, x); x += W + GAP_COPPIA; bloccoDi.set(p, chiave(g, i)); }
      larghezza.set(chiave(g, i), x - GAP_COPPIA);
    });
    let x = X0;
    bl.forEach((b, i) => { xb.set(chiave(g, i), x); x += larghezza.get(chiave(g, i)) + GAP_GRUPPI; });
  }
  const cx = p => xb.get(bloccoDi.get(p)) + offset.get(p) + W / 2;
  // distanza minima fra l'ultima persona di un blocco e la prima del successivo
  const stacco = (a, b) => (genitori.has(a) && genitori.get(b) === genitori.get(a) ? GAP_FRATELLI : GAP_GRUPPI);

  // regressione isotonica pesata (pool adjacent violators)
  function isotonica(t, w) {
    const pile = [];
    for (let i = 0; i < t.length; i++) {
      pile.push([t[i] * w[i], w[i], 1]);
      while (pile.length > 1 && pile.at(-2)[0] / pile.at(-2)[1] > pile.at(-1)[0] / pile.at(-1)[1]) {
        const [s, ww, n] = pile.pop();
        pile.at(-1)[0] += s;
        pile.at(-1)[1] += ww;
        pile.at(-1)[2] += n;
      }
    }
    const out = [];
    for (const [s, ww, n] of pile) for (let k = 0; k < n; k++) out.push(s / ww);
    return out;
  }

  const conFigli = unioni.filter(u => u.figli.length);
  for (let it = 0; it < 600; it++) {
    const desideri = new Map();
    const desidera = (k, v) => { if (!desideri.has(k)) desideri.set(k, []); desideri.get(k).push(v); };
    for (const u of conFigli) {
      const uc = (cx(u.partner[0]) + cx(u.partner[1])) / 2;
      const cc = u.figli.map(cx);
      const fc = (Math.min(...cc) + Math.max(...cc)) / 2;
      desidera(bloccoDi.get(u.partner[0]), fc - uc);
      for (const k of new Set(u.figli.map(f => bloccoDi.get(f)))) desidera(k, uc - fc);
    }
    for (const [g, bl] of blocchi) {
      const t = [], w = [], o = [];
      let acc = 0;
      bl.forEach((b, i) => {
        if (i) acc += larghezza.get(chiave(g, i - 1)) + stacco(bl[i - 1].at(-1), b[0]);
        o.push(acc);
        const d = desideri.get(chiave(g, i));
        const spinta = d ? somma(d) / d.length : 0;
        t.push(xb.get(chiave(g, i)) + 0.5 * spinta - acc);
        w.push(b.length + (d ? d.length : 0));
      });
      isotonica(t, w).forEach((y, i) => xb.set(chiave(g, i), y + o[i]));
    }
  }
  const sx = Math.min(...xb.values());
  for (const [k, v] of xb) xb.set(k, v + X0 - sx);

  // ------------------------------------------------------------ risultato
  const posizioniPersone = {};
  for (const { id: p } of persone) {
    posizioniPersone[p] = { x: xb.get(bloccoDi.get(p)) + offset.get(p), y: Y0 + gen.get(p) * PASSO };
  }
  const posizioniUnioni = {};
  for (const u of unioni) {
    posizioniUnioni[u.id] = { x: (cx(u.partner[0]) + cx(u.partner[1])) / 2, y: Y0 + gen.get(u.partner[0]) * PASSO + H / 2 };
    const [a, b] = u.partner;
    const adiacenti = bloccoDi.get(a) === bloccoDi.get(b) && Math.abs(offset.get(b) - offset.get(a)) === W + GAP_COPPIA;
    if (!adiacenti) avvisi.push(`i partner di ${u.id} non sono vicini nel disegno`);
  }
  return {
    generazione: Object.fromEntries(gen),
    righe: Object.fromEntries([...finale].sort((a, b) => a[0] - b[0])),
    persone: posizioniPersone,
    unioni: posizioniUnioni,
    incrociIniziali,
    incroci: incroci(finale),
    intrusioni: somma([...finale.keys()].map(g => intrusioni(finale, g))),
    avvisi,
  };
}
