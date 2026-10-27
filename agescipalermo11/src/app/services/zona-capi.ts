import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { apiUrl } from './api';
import { BRANCHE_POSTO } from './posti';
import { AllegatoScheda, AnnoScout, AttivitaQuota, Branca, CampiScheda, CapoElenco, CompleannoOggi, DatiCapo, DatiMovimento, DatiRagazzo, EsitoApertura, Movimento, NomeCassa, NotificaContenuto, QuotaRagazzo, RagazzoElenco, RiepilogoCassa, SchedaRagazzo, TabellaRagazzi, NuovoCapo } from '../../types/models';

/** Le tre branche vere, con i loro colori: la stessa lista della mappa, senza "gruppo". */
export const BRANCHE_VERE = BRANCHE_POSTO
  .filter((b): b is typeof b & { valore: Branca } => b.valore !== 'gruppo');

/** Quanti anni dura ogni branca: serve per proporre l'anno di percorso giusto. */
export const ANNI_DI_BRANCA: Record<Branca, number> = { branco: 3, reparto: 5, clan: 5 };

/** L'anno di percorso scritto come lo si dice: "3° anno di branco", "noviziato". */
export function tappaDi(branca: Branca | null, anno: number | null): string {
  if (!branca || !anno) return '';
  if (branca === 'clan') return anno === 1 ? 'noviziato' : `${anno - 1}° anno di clan`;
  return `${anno}° anno di ${branca}`;
}

/** Importo in euro come si scrive da noi: 12,50 €. */
export function euro(importo: number): string {
  return `${Number(importo || 0).toFixed(2).replace('.', ',')} €`;
}

@Injectable({ providedIn: 'root' })
export class ZonaCapiService {
  private http = inject(HttpClient);

  // ---------- Anno scout ----------

  annoScout() {
    return this.http.get<{ anno: AnnoScout | null; storico: AnnoScout[] }>(`${apiUrl()}/anno-scout`);
  }

  /** Solo capigruppo: fa avanzare tutti i ragazzi di un anno. */
  apriAnno(etichetta?: string) {
    return this.http.post<EsitoApertura>(`${apiUrl()}/anno-scout/apri`, etichetta ? { etichetta } : {});
  }

  /** Annulla l'apertura dell'anno (entro 10 minuti): torna in corso quello di prima. */
  annullaAnno() {
    return this.http.post<{ anno: AnnoScout | null; ragazzi: number }>(`${apiUrl()}/anno-scout/annulla`, {});
  }

  // ---------- Ragazzi e quote ----------

  ragazzi(branca?: Branca | null) {
    const params: Record<string, string> = branca ? { branca } : {};
    return this.http.get<TabellaRagazzi>(`${apiUrl()}/ragazzi`, { params });
  }

  /** Un ragazzo entrato adesso, che il codice censimento non ce l'ha ancora. */
  creaRagazzo(dati: DatiRagazzo) {
    return this.http.post<{ ragazzo: RagazzoElenco }>(`${apiUrl()}/ragazzi`, dati).pipe(map(r => r.ragazzo));
  }

  aggiornaRagazzo(id: number, dati: DatiRagazzo) {
    return this.http.put<{ ragazzo: RagazzoElenco }>(`${apiUrl()}/ragazzi/${id}`, dati).pipe(map(r => r.ragazzo));
  }

  eliminaRagazzo(id: number) {
    return this.http.delete<{ message: string }>(`${apiUrl()}/ragazzi/${id}`);
  }

  // ---------- Scheda personale ----------

  scheda(idRagazzo: number) {
    return this.http.get<SchedaRagazzo>(`${apiUrl()}/ragazzi/${idRagazzo}/scheda`);
  }

  salvaScheda(idRagazzo: number, campi: CampiScheda) {
    return this.http.put<{ message: string }>(`${apiUrl()}/ragazzi/${idRagazzo}/scheda`, campi);
  }

  /** Il PDF viaggia così com'è; il nome originale va nell'intestazione X-Nome-File. */
  allegaAllaScheda(idRagazzo: number, file: File) {
    return this.http.post<{ allegato: AllegatoScheda }>(`${apiUrl()}/ragazzi/${idRagazzo}/scheda/allegati`, file, {
      headers: { 'Content-Type': 'application/pdf', 'X-Nome-File': encodeURIComponent(file.name) },
    }).pipe(map(r => r.allegato));
  }

  /** Il PDF arriva solo con l'accesso fatto: si scarica come file e si apre dal browser. */
  scaricaAllegatoScheda(idRagazzo: number, idAllegato: number) {
    return this.http.get(`${apiUrl()}/ragazzi/${idRagazzo}/scheda/allegati/${idAllegato}`, { responseType: 'blob' });
  }

  eliminaAllegatoScheda(idRagazzo: number, idAllegato: number) {
    return this.http.delete<{ message: string }>(`${apiUrl()}/ragazzi/${idRagazzo}/scheda/allegati/${idAllegato}`);
  }

  /**
   * La tabella come file da aprire con Excel. Arriva col token (la pagina è riservata),
   * quindi si scarica con una chiamata normale e poi si salva.
   */
  scaricaTabella(branca?: Branca | null) {
    const params: Record<string, string> = branca ? { branca } : {};
    return this.http.get(`${apiUrl()}/ragazzi/csv`, { params, responseType: 'blob' });
  }

  creaAttivita(nome: string, importo: number, branca?: Branca | null) {
    return this.http.post<{ attivita: AttivitaQuota }>(`${apiUrl()}/quote/attivita`, { nome, importo, branca })
      .pipe(map(r => r.attivita));
  }

  aggiornaAttivita(id: number, nome: string, importo: number) {
    return this.http.put<{ attivita: AttivitaQuota }>(`${apiUrl()}/quote/attivita/${id}`, { nome, importo })
      .pipe(map(r => r.attivita));
  }

  eliminaAttivita(id: number) {
    return this.http.delete<{ message: string }>(`${apiUrl()}/quote/attivita/${id}`);
  }

  /**
   * Segna come sta un ragazzo con un'attività: se partecipa, quanto deve e quanto ha versato.
   * Quello che versa entra da solo nella cassa della branca.
   */
  segnaPagamento(attivita: number, ragazzo: number, dati: { versato: number; partecipa: boolean; quota: number }) {
    return this.http.put<{ pagamento: QuotaRagazzo & { ragazzo: number } }>(
      `${apiUrl()}/quote/pagamenti`, { attivita, ragazzo, ...dati }).pipe(map(r => r.pagamento));
  }

  // ---------- Cassa ----------

  cassa(nome: NomeCassa) {
    return this.http.get<RiepilogoCassa>(`${apiUrl()}/cassa/${nome}`);
  }

  /** Il bilancio di un anno in un file Excel; senza `anno` prende quello in corso. */
  scaricaCassa(nome: NomeCassa, anno?: number) {
    const params: Record<string, string> = anno ? { anno: String(anno) } : {};
    return this.http.get(`${apiUrl()}/cassa/${nome}/excel`, { params, responseType: 'blob' });
  }

  aggiungiMovimento(nome: NomeCassa, dati: DatiMovimento) {
    return this.http.post<{ movimento: Movimento }>(`${apiUrl()}/cassa/${nome}`, dati).pipe(map(r => r.movimento));
  }

  aggiornaMovimento(id: number, dati: DatiMovimento) {
    return this.http.put<{ movimento: Movimento }>(`${apiUrl()}/cassa/movimenti/${id}`, dati).pipe(map(r => r.movimento));
  }

  eliminaMovimento(id: number) {
    return this.http.delete<{ message: string }>(`${apiUrl()}/cassa/movimenti/${id}`);
  }

  // ---------- Comunità capi (capigruppo) ----------

  /** L'elenco della comunità capi, con il permesso di gestirla (vero per i capigruppo). */
  capi() {
    return this.http.get<{ capi: CapoElenco[]; puoGestire: boolean; gestore: boolean }>(`${apiUrl()}/capi`);
  }

  /** Un capo aggiunto a mano (senza il file del censimento): entra come capo. */
  aggiungiCapo(dati: NuovoCapo) {
    return this.http.post<{ capo: CapoElenco }>(`${apiUrl()}/capi`, dati).pipe(map(r => r.capo));
  }

  aggiornaCapo(id: number, dati: DatiCapo) {
    return this.http.put<{ capo: CapoElenco }>(`${apiUrl()}/capi/${id}`, dati).pipe(map(r => r.capo));
  }

  eliminaCapo(id: number) {
    return this.http.delete<{ message: string }>(`${apiUrl()}/capi/${id}`);
  }

  // ---------- Avvisi sui contenuti ----------

  /** Chi della propria branca compie gli anni oggi. */
  compleanniOggi() {
    return this.http.get<{ compleanni: CompleannoOggi[] }>(`${apiUrl()}/compleanni-oggi`)
      .pipe(map(r => r.compleanni));
  }

  notificheContenuti(conLette = false) {
    const params: Record<string, string> = conLette ? { lette: '1' } : {};
    return this.http.get<{ branca: Branca | null; notifiche: NotificaContenuto[] }>(
      `${apiUrl()}/notifiche-contenuti`, { params });
  }

  segnaNotificaLetta(id: number, letta = true) {
    return this.http.put<{ id: number; letta: boolean }>(`${apiUrl()}/notifiche-contenuti/${id}/letta`, { letta });
  }
}
