import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import { apiUrl, backendUrl } from './api';
import { preparaImmagine } from './immagini';
import { DatiProfilo, LoginResponse, Utente } from '../../types/models';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  constructor(private http: HttpClient) { }

  /** Accesso di capi, admin e ragazzi con codice censimento e password. */
  login(codice_censimento: number, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${apiUrl()}/login`, { codice_censimento, password })
      .pipe(tap(res => this.salvaSessione(res)));
  }

  /**
   * La registrazione: al codice censimento si legano email e password. Non fa ancora
   * entrare: prima va aperto il link di conferma arrivato per email.
   */
  primoAccesso(codice_censimento: number, email: string, password: string) {
    return this.http.post<{ message: string; daConfermare: boolean }>(
      `${apiUrl()}/primo-accesso`, { codice_censimento, email, password });
  }

  /** Il link dell'email: conferma l'indirizzo e fa entrare. */
  confermaEmail(token: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${apiUrl()}/conferma-email`, { token })
      .pipe(tap(res => this.salvaSessione(res)));
  }

  /** Password dimenticata: chiede il link per sceglierne una nuova. */
  passwordDimenticata(email: string) {
    return this.http.post<{ message: string }>(`${apiUrl()}/password-dimenticata`, { email });
  }

  /** Il link dell'email: la password nuova, e si entra. */
  nuovaPassword(token: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${apiUrl()}/password-dimenticata/nuova`, { token, password })
      .pipe(tap(res => this.salvaSessione(res)));
  }

  /** Cambio dell'email dal profilo: parte un link verso la nuova casella. */
  cambiaEmail(email: string, password: string) {
    return this.http.post<{ message: string }>(`${apiUrl()}/utenti/me/email`, { email, password });
  }

  /** Il link arrivato alla casella nuova. */
  confermaCambioEmail(token: string) {
    return this.http.post<{ message: string }>(`${apiUrl()}/utenti/me/email/conferma`, { token });
  }

  /** Rimanda l'email di conferma (servono codice e password). */
  reinviaConferma(codice_censimento: number, password: string) {
    return this.http.post<{ message: string }>(`${apiUrl()}/conferma-email/reinvia`, { codice_censimento, password });
  }

  /** Il visitatore non ha codice censimento: riceve un token di sola visualizzazione. */
  accediComeVisitatore(): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${apiUrl()}/login/visitatore`, {})
      .pipe(tap(res => this.salvaSessione(res)));
  }

  /** Profilo aggiornato dal server; aggiorna anche quello salvato nella sessione. */
  profilo(): Observable<Utente> {
    return this.http.get<{ utente: Utente }>(`${apiUrl()}/utenti/me`)
      .pipe(map(r => r.utente), tap(u => this.salvaUtente(u)));
  }

  aggiornaProfilo(dati: DatiProfilo): Observable<Utente> {
    return this.http.put<{ utente: Utente }>(`${apiUrl()}/utenti/me`, dati)
      .pipe(map(r => r.utente), tap(u => this.salvaUtente(u)));
  }

  urlFotoProfilo(utente: Utente | null): string | null {
    return utente && utente.ruolo !== 'visitatore' && utente.foto_url ? `${backendUrl()}${utente.foto_url}` : null;
  }

  /** Foto profilo: quadrata, 512px. */
  preparaFotoProfilo(file: File): Promise<string> {
    return preparaImmagine(file, { latoMax: 512, quadrata: true });
  }

  get utente(): Utente | null {
    try {
      const raw = localStorage.getItem('utente');
      return raw ? JSON.parse(raw) as Utente : null;
    } catch {
      return null;
    }
  }

  /**
   * La sessione è valida solo con un token non scaduto e un utente nel formato attuale.
   * Qualsiasi altro dato (es. il vecchio token di PeekBox) viene ripulito.
   */
  sessioneValida(): boolean {
    const token = localStorage.getItem('token');
    if (token && this.utente?.ruolo && !this.tokenScaduto(token)) return true;
    this.logout();
    return false;
  }

  /** Ripulisce solo il browser (per esempio quando la sessione è già scaduta). */
  logout(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('utente');
  }

  /**
   * Uscita vera, quella del pulsante "Esci": prima il server annulla le sessioni aperte
   * di questo utente (su tutti i dispositivi), così il token smette di valere anche se
   * qualcuno ne avesse una copia; poi si ripulisce il browser.
   */
  esci(): void {
    const utente = this.utente;
    if (utente && utente.ruolo !== 'visitatore' && localStorage.getItem('token')) {
      // Il token viene letto adesso, quando parte la richiesta: si può ripulire subito dopo.
      this.http.post(`${apiUrl()}/logout`, {}).subscribe({
        error: () => { /* server irraggiungibile: il token scade comunque entro 24 ore */ },
      });
    }
    this.logout();
  }

  private salvaSessione(res: LoginResponse): void {
    localStorage.setItem('token', res.token);
    this.salvaUtente(res.utente);
  }

  private salvaUtente(utente: Utente): void {
    localStorage.setItem('utente', JSON.stringify(utente));
  }

  private tokenScaduto(token: string): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now();
    } catch {
      return true;
    }
  }
}
