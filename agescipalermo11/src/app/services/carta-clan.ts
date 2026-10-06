import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { apiUrl, backendUrl } from './api';
import { CartaDiClan, CarteDiClan } from '../../types/models';

/**
 * Le Carte di Clan: file PDF. Quella in vigore sta nel riquadro della sezione Clan,
 * le precedenti nell'archivio. Le legge chiunque; le carica e le cambia solo un capo clan.
 */
@Injectable({ providedIn: 'root' })
export class CartaClanService {
  private http = inject(HttpClient);

  /** Oltre questo il server rifiuta il file: 20 MB. */
  readonly maxByte = 20 * 1024 * 1024;

  tutte() {
    return this.http.get<CarteDiClan>(`${apiUrl()}/carta-clan`);
  }

  /** Il PDF viaggia così com'è; nome, titolo e anno vanno nelle intestazioni. */
  carica(file: Blob, nome: string, titolo: string, anno: string) {
    return this.http.post<{ carta: CartaDiClan }>(`${apiUrl()}/carta-clan`, file, {
      headers: {
        'Content-Type': 'application/pdf',
        'X-Nome-File': encodeURIComponent(nome),
        'X-Titolo': encodeURIComponent(titolo),
        'X-Anno': encodeURIComponent(anno),
      },
    }).pipe(map(r => r.carta));
  }

  /** Cambia titolo e anno, oppure riporta nel riquadro una Carta dell'archivio. */
  aggiorna(id: number, dati: { titolo?: string; anno?: string | null; corrente?: boolean }) {
    return this.http.put<{ carta: CartaDiClan }>(`${apiUrl()}/carta-clan/${id}`, dati).pipe(map(r => r.carta));
  }

  elimina(id: number) {
    return this.http.delete<{ message: string }>(`${apiUrl()}/carta-clan/${id}`);
  }

  /** Il percorso che arriva dal server diventa un indirizzo intero. */
  urlIntero(percorso: string): string {
    return `${backendUrl()}${percorso}`;
  }
}
