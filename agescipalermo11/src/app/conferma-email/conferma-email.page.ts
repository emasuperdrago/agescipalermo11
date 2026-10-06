import { Component, OnInit, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonContent, NavController } from '@ionic/angular/standalone';
import { AuthService } from '../services/auth';

/**
 * La pagina che si apre dal link dell'email di conferma: manda il codice del link al server,
 * che conferma l'indirizzo e fa entrare. Il codice del link si toglie subito dalla barra
 * dell'indirizzo, così non resta nella cronologia.
 */
@Component({
  selector: 'app-conferma-email',
  templateUrl: './conferma-email.page.html',
  styleUrls: ['./conferma-email.page.scss'],
  standalone: true,
  imports: [IonContent, RouterLink],
})
export class ConfermaEmailPage implements OnInit {
  stato: 'attesa' | 'fatto' | 'errore' = 'attesa';
  messaggio = '';
  /** Vero quando il link è quello del cambio email dal profilo (non della registrazione). */
  cambio = false;

  private rotta = inject(ActivatedRoute);
  private auth = inject(AuthService);
  private navCtrl = inject(NavController);
  private iniziata = false;

  ngOnInit() {
    // Ionic può creare la pagina due volte: il link si usa una volta sola.
    if (this.iniziata) return;
    this.iniziata = true;
    const token = this.rotta.snapshot.queryParamMap.get('token') ?? '';
    this.cambio = this.rotta.snapshot.queryParamMap.get('cambio') === '1';
    history.replaceState(null, '', '/conferma-email');
    if (!token) {
      this.stato = 'errore';
      this.messaggio = "Manca il codice del link: aprilo direttamente dall'email.";
      return;
    }
    if (this.cambio) {
      this.auth.confermaCambioEmail(token).subscribe({
        next: () => {
          this.stato = 'fatto';
          // Chi è già dentro torna al profilo (dove si vede l'email nuova), gli altri all'accesso.
          const dove = this.auth.sessioneValida() ? '/profilo' : '/login';
          setTimeout(() => this.navCtrl.navigateRoot(dove, { replaceUrl: true }), 1800);
        },
        error: (err: HttpErrorResponse) => this.mostraErrore(err),
      });
      return;
    }
    this.auth.confermaEmail(token).subscribe({
      next: () => {
        this.stato = 'fatto';
        // Un attimo per leggere che è andata, poi in home.
        setTimeout(() => this.navCtrl.navigateRoot('/home', { replaceUrl: true }), 1600);
      },
      error: (err: HttpErrorResponse) => this.mostraErrore(err),
    });
  }

  private mostraErrore(err: HttpErrorResponse) {
    this.stato = 'errore';
    this.messaggio = err.status === 0
      ? 'Server non raggiungibile. Riprova tra poco.'
      : (err.error?.error ?? 'Non sono riuscito a confermare la tua email.');
  }
}
