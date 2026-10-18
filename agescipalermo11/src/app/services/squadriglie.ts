import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { apiUrl, backendUrl } from './api';
import { Grido, PaginaSquadriglia, Squadriglia, Squadriglie } from '../../types/models';

/**
 * Le squadriglie del Reparto. Le legge chiunque; le aggiunge, le chiude e le riapre
 * solo un capo reparto (anche un capogruppo che fa il capo reparto).
 * Dal server arrivano già in ordine alfabetico.
 */
@Injectable({ providedIn: 'root' })
export class SquadriglieService {
  private http = inject(HttpClient);

  tutte() {
    return this.http.get<Squadriglie>(`${apiUrl()}/squadriglie`);
  }

  /** La foto è facoltativa: si può aggiungere dopo dal riquadro della squadriglia. */
  aggiungi(nome: string, foto?: string) {
    return this.http.post<{ squadriglia: Squadriglia }>(`${apiUrl()}/squadriglie`,
      { nome, ...(foto ? { foto } : {}) }).pipe(map(r => r.squadriglia));
  }

  /** Chiude la squadriglia (va nell'archivio) o la riapre. */
  cambiaStato(id: number, attiva: boolean) {
    return this.aggiorna(id, { attiva });
  }

  /** La foto dell'animale, come data URL già rimpicciolita nel browser. */
  cambiaFoto(id: number, foto: string) {
    return this.aggiorna(id, { foto });
  }

  rimuoviFoto(id: number) {
    return this.aggiorna(id, { rimuovi_foto: true });
  }

  aggiorna(id: number, dati: { nome?: string; attiva?: boolean; foto?: string; rimuovi_foto?: boolean }) {
    return this.http.put<{ squadriglia: Squadriglia }>(`${apiUrl()}/squadriglie/${id}`, dati)
      .pipe(map(r => r.squadriglia));
  }

  /** Una squadriglia con la sua storia, i gridi e i guidoncini conquistati. */
  pagina(id: number) {
    return this.http.get<PaginaSquadriglia>(`${apiUrl()}/squadriglie/${id}`);
  }

  /** Storia e gridi: li scrivono i capi reparto. */
  salvaRacconto(id: number, storia: string, gridi: Grido[]) {
    return this.http.put<{ storia: string; gridi: Grido[] }>(`${apiUrl()}/squadriglie/${id}/racconto`, { storia, gridi });
  }

  /** Il percorso che arriva dal server diventa un indirizzo intero. */
  urlFoto(sq: Squadriglia): string | null {
    return sq.foto_url ? `${backendUrl()}${sq.foto_url}` : null;
  }
}
