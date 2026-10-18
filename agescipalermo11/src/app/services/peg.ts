import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { apiUrl, backendUrl } from './api';
import { CartaDiClan, CarteDiClan } from '../../types/models';
import { ServizioDocumenti, TestiDocumento } from '../components/riquadro-carta/riquadro-carta.component';

/** Le parole del riquadro per il PEG. */
export const TESTI_PEG: TestiDocumento = {
  nome: 'il PEG',
  titoloBase: 'Progetto Educativo di Gruppo',
  nuovo: 'Nuovo PEG',
  modifica: 'Modifica il PEG',
  caricaNuovo: 'Carica un nuovo PEG',
  caricaPrimo: 'Carica il PEG',
  nessuno: 'Ancora nessun PEG caricato.',
  chiCarica: 'Lo caricheranno i capigruppo.',
  caricato: "PEG caricato: il precedente è finito nell'archivio.",
  mettiInVigore: 'Mettilo in vigore',
  tornaInVigore: "torna in vigore, e quello di adesso finisce nell'archivio",
  rimuovere: 'Rimuovere il PEG?',
  nomeFile: 'peg.pdf',
};

/**
 * Il PEG, Progetto Educativo di Gruppo: file PDF come la Carta di Clan. Quello in vigore e
 * l'archivio dei precedenti li vedono tutti; li caricano e li cambiano i capigruppo.
 */
@Injectable({ providedIn: 'root' })
export class PegService implements ServizioDocumenti {
  private http = inject(HttpClient);

  /** Oltre questo il server rifiuta il file: 20 MB. */
  readonly maxByte = 20 * 1024 * 1024;

  tutti() {
    return this.http.get<CarteDiClan>(`${apiUrl()}/peg`);
  }

  /** Il PDF viaggia così com'è; nome, titolo e anno vanno nelle intestazioni. */
  carica(file: Blob, nome: string, titolo: string, anno: string) {
    return this.http.post<{ carta: CartaDiClan }>(`${apiUrl()}/peg`, file, {
      headers: {
        'Content-Type': 'application/pdf',
        'X-Nome-File': encodeURIComponent(nome),
        'X-Titolo': encodeURIComponent(titolo),
        'X-Anno': encodeURIComponent(anno),
      },
    }).pipe(map(r => r.carta));
  }

  aggiorna(id: number, dati: { titolo?: string; anno?: string | null; corrente?: boolean }) {
    return this.http.put<{ carta: CartaDiClan }>(`${apiUrl()}/peg/${id}`, dati).pipe(map(r => r.carta));
  }

  elimina(id: number) {
    return this.http.delete<{ message: string }>(`${apiUrl()}/peg/${id}`);
  }

  urlIntero(percorso: string): string {
    return `${backendUrl()}${percorso}`;
  }
}
