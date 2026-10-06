import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { apiUrl } from './api';
import { DatiParteStoria, DatiTappaStoria, PaginaMarco, Storia } from '../../types/models';

/** "tappe" per la linea in alto, "parti" per le schede sotto. */
export type TipoStoria = 'tappe' | 'parti';

/** Le pagine con parti scritte dai capi. */
export type PaginaConParti = 'storia' | 'marco';

/**
 * La pagina "La nostra storia" e quella di Marco "Orso Giocoso", che usa le stesse parti.
 * Le legge chiunque; le cambiano i capi e i capigruppo.
 */
@Injectable({ providedIn: 'root' })
export class StoriaService {
  private http = inject(HttpClient);

  tutta() {
    return this.http.get<Storia>(`${apiUrl()}/storia`);
  }

  marco() {
    return this.http.get<PaginaMarco>(`${apiUrl()}/marco`);
  }

  /** Le parti nuove dicono in che pagina vanno; le tappe stanno solo nella storia. */
  aggiungi(tipo: TipoStoria, dati: DatiTappaStoria | DatiParteStoria, pagina: PaginaConParti = 'storia') {
    return this.http.post(`${apiUrl()}/storia/${tipo}`, tipo === 'parti' ? { ...dati, pagina } : dati);
  }

  aggiorna(tipo: TipoStoria, id: number, dati: DatiTappaStoria | DatiParteStoria) {
    return this.http.put(`${apiUrl()}/storia/${tipo}/${id}`, dati);
  }

  sposta(tipo: TipoStoria, id: number, verso: 'su' | 'giu') {
    return this.http.post(`${apiUrl()}/storia/${tipo}/${id}/sposta`, { verso });
  }

  togli(tipo: TipoStoria, id: number) {
    return this.http.delete(`${apiUrl()}/storia/${tipo}/${id}`);
  }
}
