import { Injectable, NgZone, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { apiUrl } from './api';
import { AuthService } from './auth';

/** Dopo quanto tempo senza usare il sito si esce da soli (come il token del server). */
const MINUTI_INATTIVITA = 15;
const MS_INATTIVITA = MINUTI_INATTIVITA * 60 * 1000;
/** Ogni quanto si controlla (e, se si sta usando il sito, si allunga la sessione). */
const OGNI = 30 * 1000;
/** Chiave nel browser: l'ultima volta che si è usato il sito (vale per tutte le schede). */
const CHIAVE_ULTIMA = 'ultimaAttivita';
/** Per la pagina di accesso: si è usciti per inattività (lo dice, una volta). */
export const CHIAVE_USCITO = 'uscitoPerInattivita';

/**
 * Esce da solo dopo 15 minuti senza toccare il sito. "Toccare" è qualsiasi tocco, clic, tasto o
 * scorrimento: anche scrivere un post conta. Mentre si usa il sito senza che parta nessuna
 * richiesta (per esempio scrivendo), ogni tanto chiede al server di allungare la sessione,
 * così il token non scade a metà. Il visitatore non ha niente di privato: per lui non vale.
 */
@Injectable({ providedIn: 'root' })
export class InattivitaService {
  private auth = inject(AuthService);
  private http = inject(HttpClient);
  private router = inject(Router);
  private zone = inject(NgZone);
  private ultimaScritta = 0;
  private ultimoRinnovo = Date.now();

  avvia() {
    this.segna();
    // Fuori da Angular: sono eventi frequentissimi, non devono ridisegnare la pagina.
    this.zone.runOutsideAngular(() => {
      for (const evento of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'])
        window.addEventListener(evento, () => this.segna(), { capture: true, passive: true });
      setInterval(() => this.controlla(), OGNI);
      // Il telefono riaperto dopo un po': si controlla subito, prima di mostrare qualcosa.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.controlla();
      });
    });
  }

  private get conAccount(): boolean {
    const utente = this.auth.utente;
    return !!utente && utente.ruolo !== 'visitatore' && !!localStorage.getItem('token');
  }

  private ultima(): number {
    return Number(localStorage.getItem(CHIAVE_ULTIMA)) || 0;
  }

  /** Si sta usando il sito (al massimo una scrittura ogni 5 secondi). */
  private segna() {
    const adesso = Date.now();
    if (adesso - this.ultimaScritta < 5000) return;
    // Se si torna dopo più di 15 minuti, prima si esce: il tocco di adesso non salva la sessione.
    if (this.conAccount && this.ultima() && adesso - this.ultima() > MS_INATTIVITA) return this.controlla();
    this.ultimaScritta = adesso;
    try { localStorage.setItem(CHIAVE_ULTIMA, String(adesso)); } catch { /* browser senza memoria */ }
  }

  private controlla() {
    if (!this.conAccount) return;
    const adesso = Date.now();
    const ultima = this.ultima();
    if (ultima && adesso - ultima > MS_INATTIVITA) {
      this.zone.run(() => this.esci());
      return;
    }
    // Lo si sta usando, ma senza richieste da un po' (es. scrivendo): si allunga la sessione.
    if (adesso - ultima < OGNI * 2 && adesso - this.ultimoRinnovo > 5 * 60 * 1000) {
      this.ultimoRinnovo = adesso;
      this.http.get(`${apiUrl()}/sessione`).subscribe({ error: () => { /* ci pensa l'interceptor */ } });
    }
  }

  private esci() {
    // Solo da questo dispositivo: "Esci" chiuderebbe la sessione anche sugli altri (il computer
    // acceso mentre il telefono è fermo). Il token, intanto, sul server scade da solo.
    this.auth.logout();
    try { sessionStorage.setItem(CHIAVE_USCITO, '1'); } catch { /* niente avviso, pazienza */ }
    this.router.navigateByUrl('/login', { replaceUrl: true });
  }
}
