import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { apiUrl } from './api';
import { Guidoncini, Guidoncino } from '../../types/models';

/**
 * I guidoncini verdi del Reparto: le specialità di squadriglia conquistate negli anni.
 * Li legge chiunque; li segnano, confermano e tolgono solo i capi reparto.
 */
@Injectable({ providedIn: 'root' })
export class GuidonciniService {
  private http = inject(HttpClient);

  tutti() {
    return this.http.get<Guidoncini>(`${apiUrl()}/guidoncini`);
  }

  segna(dati: { squadriglia_id: number; specialita: string; anno: number }) {
    return this.http.post<{ guidoncino: Guidoncino }>(`${apiUrl()}/guidoncini`, dati)
      .pipe(map(r => r.guidoncino));
  }

  /** La squadriglia l'ha rinnovata per un altro anno (o si toglie la conferma). */
  conferma(id: number, confermata: boolean) {
    return this.http.put<{ guidoncino: Guidoncino }>(`${apiUrl()}/guidoncini/${id}`, { confermata })
      .pipe(map(r => r.guidoncino));
  }

  togli(id: number) {
    return this.http.delete<{ message: string }>(`${apiUrl()}/guidoncini/${id}`);
  }
}

/** 2025 → "2025/26". */
export function nomeAnnoScout(anno: number): string {
  return `${anno}/${String(anno + 1).slice(-2)}`;
}
