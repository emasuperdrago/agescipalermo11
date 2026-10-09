import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { apiUrl } from './api';
import { Canto, CantoElenco, DatiCanto, SezioneCanto } from '../../types/models';

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
  const parole = senzaSegniGrassetto(senzaSegno).trim().split(/\s+/)
    .map(p => p.replace(/[()[\]|,.:]/g, '')).filter(Boolean);
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

/**
 * Il canto riga per riga, come sul foglio: spazi e a capo restano, e si sa quali righe
 * sono accordi (le uniche mostrate in modo diverso). Con `conAccordi` a false si tolgono.
 */
export function righeCanto(testo: string, conAccordi = true): RigaCanto[] {
  const righe = conAccordi
    ? testo.split('\n')
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
  urlPdf(ids: number[], conAccordi: boolean): string {
    return `${apiUrl()}/canti/pdf/scarica?ids=${ids.join(',')}&accordi=${conAccordi ? 1 : 0}`;
  }
}
