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

const NOTE = ['DO', 'RE', 'MI', 'FA', 'SOL', 'LA', 'SI'];

/**
 * Righe come "RE   SOL   LA": solo accordi, senza parole. Servono per poterli nascondere
 * a chi vuole leggere il testo e basta.
 */
export function rigaDiAccordi(riga: string): boolean {
  // Si tolgono i segni del grassetto, le parentesi e la punteggiatura: "(Sol)" o "RE-|" restano accordi.
  const parole = senzaSegniGrassetto(riga).trim().split(/\s+/)
    .map(p => p.replace(/[()[\]|,.:]/g, '')).filter(Boolean);
  if (!parole.length) return false;
  // Un accordo è una nota (RE, SOLm7…) o un pezzetto staccato che la completa ("DO m", "LA 7").
  const accordo = (p: string) => p.length <= 8 && NOTE.some(n => p.toUpperCase().startsWith(n));
  const coda = (p: string) => /^(m|min|maj|dim|aug|sus[0-9]?|add[0-9]?|[0-9]{1,2}|[+#b-]+)$/i.test(p);
  return parole.some(accordo) && parole.every(p => accordo(p) || coda(p));
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
  return testo.split('\n').filter(r => !rigaDiAccordi(r)).join('\n').replace(/\n{3,}/g, '\n\n');
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
  return righe.map(r => ({
    accordi: rigaDiAccordi(r),
    testo: senzaSegniGrassetto(r),
    pezzi: pezziRiga(r),
  }));
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
