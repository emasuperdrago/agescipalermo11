import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { apiUrl } from './api';
import {
  BozzaLibretto, Canto, CantoElenco, DatiCanto, DatiLibretto, ParteMessa, SezioneCanto
} from '../../types/models';

/** Sezioni del canzoniere, nell'ordine del canzoniere di carta. */
export const SEZIONI_CANTO: { valore: SezioneCanto; nome: string; colore: string }[] = [
  { valore: 'preghiere', nome: 'Preghiere', colore: '#7D57C2' },
  { valore: 'branco', nome: 'Branco', colore: '#5A9E2A' },
  { valore: 'reparto', nome: 'Reparto', colore: '#B98A00' },
  { valore: 'clan', nome: 'Clan', colore: '#D8392F' },
  { valore: 'liturgici', nome: 'Liturgici', colore: '#0B87A8' },
  { valore: 'fuoco', nome: 'Altro', colore: '#E36F3C' },
];

export function nomeSezione(sezione: SezioneCanto): string {
  return SEZIONI_CANTO.find(s => s.valore === sezione)?.nome ?? sezione;
}

export function coloreSezione(sezione: SezioneCanto): string {
  return SEZIONI_CANTO.find(s => s.valore === sezione)?.colore ?? '#7D57C2';
}

/**
 * Un accordo è una nota con, al massimo, quello che la completa: RE, SOLm7, FA#-, SIb, LA/DO#.
 * "lalalala" o "Signor" cominciano con una nota ma non sono accordi. (Stessa regola nel backend.)
 */
const NOTA = '(DO|RE|MI|FA|SOL|LA|SI)(#|b)?';
const NUCLEO = `${NOTA}(m|min|maj|ma|dim|aug|sus[0-9]?|add[0-9]?|[0-9]{1,2}|\\+|-|°)*`;
const ACCORDO = new RegExp(`^${NUCLEO}(/(${NOTA})?)?\\\\?$`, 'i');
/** Accordi attaccati senza spazio ("FA#-MI-"): solo in maiuscolo, se no "lalala" sembrerebbe LA LA LA. */
const ACCORDI_UNITI = new RegExp(`^(${NUCLEO}){2,}$`);
/** Un pezzetto staccato che completa l'accordo prima: "DO m", "LA 7". */
const CODA = /^(m|min|maj|dim|aug|sus[0-9]?|add[0-9]?|[0-9]{1,2}|[+#b-]+)$/i;

/**
 * Segni da mettere all'inizio di una riga quando la regola da sola non basta
 * (es. "La la la la", che sono parole ma anche accordi): chi legge il canto non li vede.
 */
export const SEGNO_TESTO = '~';
export const SEGNO_ACCORDI = '^';

/** La riga senza il segno iniziale, e che cosa diceva il segno (se c'era). */
export function segnoRiga(riga: string): { forzata: 'testo' | 'accordi' | null; riga: string } {
  if (riga.startsWith(SEGNO_TESTO)) return { forzata: 'testo', riga: riga.slice(SEGNO_TESTO.length) };
  if (riga.startsWith(SEGNO_ACCORDI)) return { forzata: 'accordi', riga: riga.slice(SEGNO_ACCORDI.length) };
  return { forzata: null, riga };
}

/**
 * Righe come "RE   SOL   LA": solo accordi, senza parole. Servono per poterli nascondere
 * a chi vuole leggere il testo e basta.
 */
export function rigaDiAccordi(riga: string): boolean {
  const { forzata, riga: senzaSegno } = segnoRiga(riga);
  if (forzata) return forzata === 'accordi';
  // Si tolgono i segni del grassetto, le parentesi e la punteggiatura: "(Sol)" o "RE-|" restano accordi.
  // Le barre staccate ("LA4 / la") non sono parole: si saltano.
  const parole = senzaSegniGrassetto(senzaSegno).trim().split(/\s+/)
    .map(p => p.replace(/[()[\]|,.:]/g, '')).filter(p => p && !/^[/\\]+$/.test(p));
  if (!parole.length) return false;
  const accordo = (p: string) => ACCORDO.test(p) || ACCORDI_UNITI.test(p);
  return parole.some(accordo) && parole.every(p => accordo(p) || CODA.test(p));
}

/**
 * Nel testo dei canti il grassetto si scrive con gli asterischi, come in tanti editor:
 * **questa parte** viene mostrata in grassetto.
 */
export const SEGNO_GRASSETTO = '**';

export function senzaSegniGrassetto(testo: string): string {
  return testo.replace(/\*\*/g, '');
}

/** Toglie dal testo le righe dei soli accordi. */
export function senzaAccordi(testo: string): string {
  return testo.split('\n').filter(r => !rigaDiAccordi(r)).map(r => segnoRiga(r).riga)
    .join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Un pezzo di riga: il testo e se va in grassetto. */
export interface PezzoRiga {
  grassetto: boolean;
  testo: string;
}

/** Una riga del canto, già pronta da mostrare. */
export interface RigaCanto {
  accordi: boolean;
  /** La riga senza i segni del grassetto (serve per misurarla). */
  testo: string;
  pezzi: PezzoRiga[];
}

/** Divide una riga nei pezzi normali e in quelli tra **asterischi**. */
export function pezziRiga(riga: string): PezzoRiga[] {
  const pezzi: PezzoRiga[] = [];
  let grassetto = false;
  for (const parte of riga.split('**')) {
    if (parte) pezzi.push({ grassetto, testo: parte });
    grassetto = !grassetto;
  }
  return pezzi.length ? pezzi : [{ grassetto: false, testo: riga }];
}

// ---------- Cambio di tonalità degli accordi (stessa regola del backend) ----------
// Ogni nota diventa un numero da 0 a 11 (DO = 0 … SI = 11), si sposta di qualche semitono e si
// riscrive col nome nuovo, nello stesso modo in cui era scritta (RE, Re o re). Il resto
// dell'accordo (m, 7, sus4, -, /basso) resta com'è.

/** Come scrivere le note alterate: in automatico secondo la tonalità, o sempre # / sempre b. */
export type Alterazioni = 'auto' | 'diesis' | 'bemolle';

const SEMITONI: Record<string, number> = { DO: 0, RE: 2, MI: 4, FA: 5, SOL: 7, LA: 9, SI: 11 };
const NOMI_DIESIS = ['DO', 'DO#', 'RE', 'RE#', 'MI', 'FA', 'FA#', 'SOL', 'SOL#', 'LA', 'LA#', 'SI'];
const NOMI_BEMOLLE = ['DO', 'REb', 'RE', 'MIb', 'MI', 'FA', 'SOLb', 'SOL', 'LAb', 'LA', 'SIb', 'SI'];
const NOTA_INIZIO = /^(DO|RE|MI|FA|SOL|LA|SI)(#|b)?/i;
// Quello che viene dopo la nota. "m" solo minuscola: in "FA#-MI-" la M è già la nota dopo.
const FINALE_ACCORDO = /^(min|maj|ma|dim|aug|sus[0-9]?|add[0-9]?|[0-9]{1,2}|m|\+|-|°)/;
// Le tonalità maggiori che si scrivono coi bemolle: FA, SIb, MIb, LAb, REb.
const TONALITA_BEMOLLE = new Set([5, 10, 3, 8, 1]);
const giro = (n: number) => ((n % 12) + 12) % 12;

function semitonoDi(nota: string): number {
  const [, lettere, alterazione] = nota.match(NOTA_INIZIO)!;
  return giro(SEMITONI[lettere.toUpperCase()] + (alterazione === '#' ? 1 : alterazione ? -1 : 0));
}

/** Il nome della nota, scritto come l'originale: tutto maiuscolo, solo l'iniziale o tutto minuscolo. */
function nomeNota(semitono: number, bemolle: boolean, comeEra: string): string {
  const nome = (bemolle ? NOMI_BEMOLLE : NOMI_DIESIS)[giro(semitono)];
  const lettere = comeEra.replace(/[#b]$/i, '');
  const radice = nome.replace(/[#b]$/, '');
  const segno = nome.slice(radice.length);
  if (lettere === lettere.toUpperCase()) return radice + segno;
  if (lettere[0] === lettere[0].toUpperCase()) return radice[0] + radice.slice(1).toLowerCase() + segno;
  return radice.toLowerCase() + segno;
}

/** Un accordo spostato di `passo` semitoni; null se non si riesce a leggerlo (resta com'era). */
function spostaAccordo(accordo: string, passo: number, bemolle: boolean): string | null {
  let resto = accordo;
  let fuori = '';
  while (resto) {
    const nota = resto.match(NOTA_INIZIO);
    if (!nota) return null;
    fuori += nomeNota(semitonoDi(nota[0]) + passo, bemolle, nota[0]);
    resto = resto.slice(nota[0].length);
    let finale: RegExpMatchArray | null;
    while ((finale = resto.match(FINALE_ACCORDO))) {
      fuori += finale[0];
      resto = resto.slice(finale[0].length);
    }
    if (resto.startsWith('/')) {
      fuori += '/';
      resto = resto.slice(1);
      const basso = resto.match(NOTA_INIZIO);
      if (basso) {
        fuori += nomeNota(semitonoDi(basso[0]) + passo, bemolle, basso[0]);
        resto = resto.slice(basso[0].length);
      }
    }
    if (resto.startsWith('\\')) {
      fuori += '\\';
      resto = resto.slice(1);
    }
  }
  return fuori;
}

/** Il primo accordo del canto: da lì si capisce la tonalità (e se è minore). */
function primoAccordo(testo: string): string | null {
  for (const riga of testo.split('\n')) {
    if (!rigaDiAccordi(riga)) continue;
    for (const parola of senzaSegniGrassetto(segnoRiga(riga).riga).trim().split(/\s+/)) {
      const pulita = parola.replace(/^[(\[|]+|[)\]|,.:]+$/g, '');
      if (NOTA_INIZIO.test(pulita)) return pulita;
    }
  }
  return null;
}

/** Il canto ha almeno una riga di accordi (se no i comandi della tonalità non servono). */
export function haAccordi(testo: string): boolean {
  return primoAccordo(testo) !== null;
}

/**
 * Diesis o bemolle per la tonalità di arrivo: "auto" guarda il primo accordo (in FA si scrive
 * SIb, non LA#; una tonalità minore si scrive come la sua relativa maggiore).
 */
function usaBemolle(testo: string, passo: number, alterazioni: Alterazioni): boolean {
  if (alterazioni === 'diesis') return false;
  if (alterazioni === 'bemolle') return true;
  const primo = primoAccordo(testo);
  if (!primo) return false;
  const dopoNota = primo.slice(primo.match(NOTA_INIZIO)![0].length);
  const minore = /^(m(?!a)|-)/.test(dopoNota);
  return TONALITA_BEMOLLE.has(giro(semitonoDi(primo) + passo + (minore ? 3 : 0)));
}

/**
 * Una riga di accordi spostata di `passo` semitoni. Ogni accordo resta nella sua colonna
 * (sopra la stessa sillaba); se uno diventa più lungo, sposta solo quello che viene dopo.
 */
function trasponiRiga(riga: string, passo: number, bemolle: boolean): string {
  const { forzata, riga: senzaSegno } = segnoRiga(riga);
  const segno = forzata === 'testo' ? SEGNO_TESTO : forzata === 'accordi' ? SEGNO_ACCORDI : '';
  let fuori = '';
  const parole = /\S+/g;
  let pezzo: RegExpExecArray | null;
  while ((pezzo = parole.exec(senzaSegno))) {
    // Asterischi del grassetto, parentesi e punteggiatura restano attaccati com'erano.
    const [, prima, cuore, dopo] = pezzo[0].match(/^([*(\[|]*)(.*?)([*)\]|,.:]*)$/)!;
    const spostato = cuore && (ACCORDO.test(cuore) || ACCORDI_UNITI.test(cuore))
      ? spostaAccordo(cuore, passo, bemolle) : null;
    const nuovo = prima + (spostato ?? cuore) + dopo;
    const colonna = fuori ? Math.max(pezzo.index, fuori.length + 1) : pezzo.index;
    fuori = fuori.padEnd(colonna, ' ') + nuovo;
  }
  return segno + fuori;
}

/** Il testo del canto con gli accordi spostati (le righe di parole restano uguali). */
export function trasponiTesto(testo: string, passo: number, alterazioni: Alterazioni = 'auto'): string {
  const spostamento = giro(passo);
  if (!spostamento && alterazioni === 'auto') return testo;
  const bemolle = usaBemolle(testo, passo, alterazioni);
  return testo.split('\n').map(r => rigaDiAccordi(r) ? trasponiRiga(r, spostamento, bemolle) : r).join('\n');
}

/** "MI", "SI minore"…: la tonalità di arrivo, detta come la si dice. */
export function nomeTonalita(testo: string, passo: number, alterazioni: Alterazioni = 'auto'): string | null {
  const primo = primoAccordo(testo);
  if (!primo) return null;
  const nota = primo.match(NOTA_INIZIO)![0];
  const minore = /^(m(?!a)|-)/.test(primo.slice(nota.length));
  return nomeNota(semitonoDi(nota) + passo, usaBemolle(testo, passo, alterazioni), 'X') + (minore ? ' minore' : '');
}

/**
 * Il canto riga per riga, come sul foglio: spazi e a capo restano, e si sa quali righe
 * sono accordi (le uniche mostrate in modo diverso). Con `conAccordi` a false si tolgono.
 * Con `passo` gli accordi si spostano di quei semitoni (il testo salvato non cambia).
 */
export function righeCanto(testo: string, conAccordi = true, passo = 0, alterazioni: Alterazioni = 'auto'): RigaCanto[] {
  const righe = conAccordi
    ? trasponiTesto(testo, passo, alterazioni).split('\n')
    : testo.split('\n').filter(r => !rigaDiAccordi(r));
  return righe.map(r => {
    const senzaSegno = segnoRiga(r).riga;
    return {
      accordi: rigaDiAccordi(r),
      testo: senzaSegniGrassetto(senzaSegno),
      pezzi: pezziRiga(senzaSegno),
    };
  });
}

/** Le parti della messa, in ordine (stesse del backend). Comunione e conclusione: anche più canti. */
export const PARTI_MESSA: { valore: ParteMessa; nome: string; piu: boolean }[] = [
  { valore: 'ingresso', nome: 'Ingresso', piu: false },
  { valore: 'gloria', nome: 'Gloria', piu: false },
  { valore: 'alleluia', nome: 'Alleluia', piu: false },
  { valore: 'offertorio', nome: 'Offertorio', piu: false },
  { valore: 'santo', nome: 'Santo', piu: false },
  { valore: 'pace', nome: 'Pace', piu: false },
  { valore: 'agnello', nome: 'Agnello di Dio', piu: false },
  { valore: 'comunione', nome: 'Comunione', piu: true },
  { valore: 'conclusione', nome: 'Conclusione', piu: true },
];

@Injectable({
  providedIn: 'root'
})
export class CantiService {

  constructor(private http: HttpClient) { }

  /** Elenco senza il testo intero; `cerca` guarda nel titolo e dentro il testo. */
  elenco(cerca = '', sezione: SezioneCanto | null = null) {
    const params: Record<string, string> = {};
    if (cerca.trim()) params['cerca'] = cerca.trim();
    if (sezione) params['sezione'] = sezione;
    return this.http.get<{ canti: CantoElenco[] }>(`${apiUrl()}/canti`, { params }).pipe(map(r => r.canti));
  }

  dettaglio(id: number) {
    return this.http.get<{ canto: Canto }>(`${apiUrl()}/canti/${id}`).pipe(map(r => r.canto));
  }

  crea(dati: DatiCanto) {
    return this.http.post<{ canto: Canto }>(`${apiUrl()}/canti`, dati).pipe(map(r => r.canto));
  }

  aggiorna(id: number, dati: DatiCanto) {
    return this.http.put<{ canto: Canto }>(`${apiUrl()}/canti/${id}`, dati).pipe(map(r => r.canto));
  }

  elimina(id: number) {
    return this.http.delete<{ message: string }>(`${apiUrl()}/canti/${id}`);
  }

  /** Indirizzo del PDF con i canti scelti (il file lo prepara il server). */
  /** Il PDF del libretto, esattamente quello dell'anteprima (copertina, messa, opzioni). */
  pdfLibretto(dati: DatiLibretto) {
    return this.http.post(`${apiUrl()}/canti/pdf`, dati, { responseType: 'blob' });
  }

  // ---------- Bozze dei libretti (solo capi) ----------

  bozze() {
    return this.http.get<{ bozze: BozzaLibretto[] }>(`${apiUrl()}/canti/bozze`).pipe(map(r => r.bozze));
  }

  bozza(id: number) {
    return this.http.get<{ bozza: BozzaLibretto }>(`${apiUrl()}/canti/bozze/${id}`).pipe(map(r => r.bozza));
  }

  /** Una bozza nuova, o quella con `id` aggiornata. */
  salvaBozza(dati: DatiLibretto, id: number | null = null) {
    const richiesta = id === null
      ? this.http.post<{ bozza: BozzaLibretto }>(`${apiUrl()}/canti/bozze`, dati)
      : this.http.put<{ bozza: BozzaLibretto }>(`${apiUrl()}/canti/bozze/${id}`, dati);
    return richiesta.pipe(map(r => r.bozza));
  }

  eliminaBozza(id: number) {
    return this.http.delete<{ message: string }>(`${apiUrl()}/canti/bozze/${id}`);
  }

  /** La tonalità del gruppo: i semitoni rispetto agli accordi scritti (lo scelgono i capi). */
  salvaTonalita(id: number, trasposizione: number) {
    return this.http.put<{ canto: Canto }>(`${apiUrl()}/canti/${id}/tonalita`, { trasposizione }).pipe(map(r => r.canto));
  }

  /**
   * Il PDF dei canti scelti, ognuno nella tonalità del gruppo. Per un canto solo si può
   * passare la tonalità di chi scarica (passo, capotasto e alterazioni).
   */
  urlPdf(ids: number[], conAccordi: boolean,
         tonalita?: { passo: number; capotasto: number; alterazioni: Alterazioni }): string {
    let url = `${apiUrl()}/canti/pdf/scarica?ids=${ids.join(',')}&accordi=${conAccordi ? 1 : 0}`;
    if (tonalita && ids.length === 1)
      url += `&passo=${tonalita.passo}&capotasto=${tonalita.capotasto}&alterazioni=${tonalita.alterazioni}`;
    return url;
  }
}
