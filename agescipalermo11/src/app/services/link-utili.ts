import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { apiUrl } from './api';
import { LinkUtile, PaginaLinkUtili, SezioneLink } from '../../types/models';

/** La pagina "Link utili": la leggono tutti, la cambiano i capi e i capigruppo. */
@Injectable({ providedIn: 'root' })
export class LinkUtiliService {
  private http = inject(HttpClient);

  tutti() {
    return this.http.get<PaginaLinkUtili>(`${apiUrl()}/link-utili`);
  }

  aggiungi(sezione: SezioneLink, titolo: string, url: string) {
    return this.http.post<{ link: LinkUtile }>(`${apiUrl()}/link-utili`, { sezione, titolo, url });
  }

  aggiorna(id: number, titolo: string, url: string) {
    return this.http.put<{ link: LinkUtile }>(`${apiUrl()}/link-utili/${id}`, { titolo, url });
  }

  sposta(id: number, verso: 'su' | 'giu') {
    return this.http.post(`${apiUrl()}/link-utili/${id}/sposta`, { verso });
  }

  togli(id: number) {
    return this.http.delete(`${apiUrl()}/link-utili/${id}`);
  }
}
