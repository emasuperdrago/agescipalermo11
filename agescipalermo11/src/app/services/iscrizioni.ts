import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, tap } from 'rxjs';
import { apiUrl } from './api';
import {
  AnnoScolastico, Branca, DatiRichiestaIscrizione, RichiestaIscrizione, StatoRichiesta
} from '../../types/models';

/**
 * Anni scolastici accolti dal gruppo, dalla 3ª elementare alla 5ª superiore,
 * con la branca e l'anno di percorso che gli corrispondono. Stesso elenco di server.js:
 * la branca la decide comunque il server, qui serve per mostrarla nel modulo.
 */
export const ANNI_SCOLASTICI: {
  valore: AnnoScolastico; nome: string; branca: Branca; tappa: string;
}[] = [
  { valore: 'elementare-3', nome: '3ª elementare', branca: 'branco', tappa: '1° anno di branco' },
  { valore: 'elementare-4', nome: '4ª elementare', branca: 'branco', tappa: '2° anno di branco' },
  { valore: 'elementare-5', nome: '5ª elementare', branca: 'branco', tappa: '3° anno di branco (CdA)' },
  { valore: 'media-1', nome: '1ª media', branca: 'reparto', tappa: '1° anno di reparto' },
  { valore: 'media-2', nome: '2ª media', branca: 'reparto', tappa: '2° anno di reparto' },
  { valore: 'media-3', nome: '3ª media', branca: 'reparto', tappa: '3° anno di reparto' },
  { valore: 'superiore-1', nome: '1ª superiore', branca: 'reparto', tappa: '4° anno di reparto' },
  { valore: 'superiore-2', nome: '2ª superiore', branca: 'reparto', tappa: '5° anno di reparto' },
  { valore: 'superiore-3', nome: '3ª superiore', branca: 'clan', tappa: 'noviziato' },
  { valore: 'superiore-4', nome: '4ª superiore', branca: 'clan', tappa: '1° anno di clan' },
  { valore: 'superiore-5', nome: '5ª superiore', branca: 'clan', tappa: '2° anno di clan' },
];

export function annoScolastico(valore: AnnoScolastico | '') {
  return ANNI_SCOLASTICI.find(a => a.valore === valore) ?? null;
}

/** Nome dell'anno scolastico, es. "1ª media". */
export function nomeAnnoScolastico(valore: AnnoScolastico | ''): string {
  return annoScolastico(valore)?.nome ?? '';
}

/** Data "AAAA-MM-GG" scritta per esteso, es. "12 maggio 2014". */
export function dataPerEsteso(data: string): string {
  const [anno, mese, giorno] = data.split('-').map(Number);
  if (!anno || !mese || !giorno) return data;
  return new Date(anno, mese - 1, giorno).toLocaleDateString('it-IT', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

/** Età compiuta oggi, calcolata sul giorno locale. */
export function etaDa(dataNascita: string): number | null {
  const [anno, mese, giorno] = dataNascita.split('-').map(Number);
  if (!anno || !mese || !giorno) return null;
  const oggi = new Date();
  let eta = oggi.getFullYear() - anno;
  const compiuto = oggi.getMonth() + 1 > mese || (oggi.getMonth() + 1 === mese && oggi.getDate() >= giorno);
  if (!compiuto) eta--;
  return eta >= 0 && eta < 120 ? eta : null;
}

@Injectable({ providedIn: 'root' })
export class IscrizioniService {

  /**
   * Quante richieste di iscrizione aspettano ancora una risposta: lo mostra anche
   * la voce "Capi" della barra in basso. Si aggiorna a ogni elenco che arriva.
   */
  readonly nuove = signal(0);
  /** Quando si è chiesto l'ultima volta: la barra c'è in ogni pagina e non deve chiedere sempre. */
  private ultimoConteggio = 0;

  constructor(private http: HttpClient) { }

  /** Per la barra in basso: richiede il numero solo se è passato almeno mezzo minuto. */
  aggiornaNuove() {
    if (Date.now() - this.ultimoConteggio < 30_000) return;
    this.ultimoConteggio = Date.now();
    this.elenco().subscribe({ error: () => { /* senza numero la voce resta com'è */ } });
  }

  /** Modulo pubblico: lo manda chi non ha un account. */
  invia(dati: DatiRichiestaIscrizione) {
    return this.http.post<{ message: string; branca: Branca }>(`${apiUrl()}/richieste-iscrizione`, dati);
  }

  /** Notifiche del capo: il server manda solo le richieste della sua branca. */
  elenco(conArchiviate = false) {
    const params: Record<string, string> = conArchiviate ? { archiviate: '1' } : {};
    return this.http.get<{ branca: Branca | null; richieste: RichiestaIscrizione[] }>(
      `${apiUrl()}/richieste-iscrizione`, { params }).pipe(tap(r => {
        this.ultimoConteggio = Date.now();
        this.nuove.set(r.richieste.filter(x => x.stato === 'nuova').length);
      }));
  }

  /** La decisione dei capi: accettata, rifiutata, o null per rimetterla in sospeso. */
  decidi(id: number, esito: 'accettata' | 'rifiutata' | null) {
    return this.http.put<{ richiesta: RichiestaIscrizione }>(
      `${apiUrl()}/richieste-iscrizione/${id}/esito`, { esito }).pipe(map(r => r.richiesta));
  }

  /**
   * Le richieste accettate in un file Excel fatto come quello dei codici censimento:
   * si scarica e si ricarica in "Carica i ragazzi" senza riscrivere niente.
   */
  scaricaAccettate() {
    return this.http.get(`${apiUrl()}/richieste-iscrizione/excel`, { responseType: 'blob' });
  }

  cambiaStato(id: number, stato: StatoRichiesta) {
    return this.http.put<{ richiesta: RichiestaIscrizione }>(
      `${apiUrl()}/richieste-iscrizione/${id}/stato`, { stato }).pipe(map(r => r.richiesta));
  }

  elimina(id: number) {
    return this.http.delete<{ message: string }>(`${apiUrl()}/richieste-iscrizione/${id}`);
  }
}
