import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { apiUrl, backendUrl } from './api';
import { SfondoHome } from '../../types/models';

/**
 * Le foto che scorrono nello sfondo della home. Le legge chiunque (la home è aperta a tutti),
 * le cambiano i capi dalla loro zona.
 */
@Injectable({ providedIn: 'root' })
export class SfondiService {
  private http = inject(HttpClient);

  /** Ogni quanto cambia la foto nella home. */
  readonly durata = 7000;

  elenco() {
    return this.http.get<{ sfondi: SfondoHome[] }>(`${apiUrl()}/sfondi`).pipe(map(r => r.sfondi));
  }

  /** La foto come data URL (già rimpicciolita nel browser). */
  aggiungi(foto: string) {
    return this.http.post<{ sfondo: SfondoHome }>(`${apiUrl()}/sfondi`, { foto }).pipe(map(r => r.sfondo));
  }

  elimina(id: number) {
    return this.http.delete<{ message: string }>(`${apiUrl()}/sfondi/${id}`);
  }

  /** Il percorso che arriva dal server diventa un indirizzo intero. */
  urlIntero(percorso: string): string {
    return `${backendUrl()}${percorso}`;
  }
}
