import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { IonContent, NavController } from '@ionic/angular/standalone';
import { AuthService } from '../services/auth';

type Modalita = 'accedi' | 'primo-accesso' | 'recupero';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [IonContent, FormsModule, RouterLink],
})
export class LoginPage {
  modalita: Modalita = 'accedi';
  caricamento = false;
  mostraPassword = false;
  errore = '';
  /** Un messaggio buono (es. "ti abbiamo mandato un'email"). */
  avviso = '';
  /** Vero quando la password è giusta ma l'email non è ancora confermata. */
  daConfermare = false;
  inviando = false;

  codice = '';
  /** Solo nel primo accesso: l'email che si lega al codice censimento. */
  email = '';
  password = '';
  conferma = '';

  constructor(private auth: AuthService, private navCtrl: NavController) {}

  get titolo(): string {
    if (this.modalita === 'accedi') return 'Accedi';
    return this.modalita === 'recupero' ? 'Password dimenticata' : 'Primo accesso';
  }

  /** Password dimenticata: il server manda il link solo se l'email è di un account confermato. */
  chiediLink() {
    const email = this.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.errore = 'Scrivi un indirizzo email valido.';
      return;
    }
    this.caricamento = true;
    this.errore = '';
    this.auth.passwordDimenticata(email).subscribe({
      next: r => {
        this.caricamento = false;
        this.avviso = r.message;
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.errore = this.messaggioErrore(err);
      },
    });
  }

  cambiaModalita(modalita: Modalita) {
    this.modalita = modalita;
    this.errore = '';
    this.avviso = '';
    this.daConfermare = false;
    this.password = '';
    this.conferma = '';
  }

  accedi() {
    if (!this.codiceValido() || !this.password) {
      this.errore = 'Inserisci il codice censimento (solo cifre) e la password.';
      return;
    }

    this.caricamento = true;
    this.errore = '';
    this.avviso = '';
    this.daConfermare = false;
    this.auth.login(Number(this.codice.trim()), this.password).subscribe({
      next: () => this.entra(),
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        // Codice caricato ma mai registrato: porta direttamente al primo accesso.
        if (err.status === 403 && err.error?.motivo === 'primo-accesso') this.cambiaModalita('primo-accesso');
        // Registrato ma senza aver confermato l'email: si può farsela rimandare.
        if (err.status === 403 && err.error?.motivo === 'email-da-confermare') this.daConfermare = true;
        this.errore = this.messaggioErrore(err);
      },
    });
  }

  creaPassword() {
    if (!this.codiceValido()) {
      this.errore = 'Il codice censimento deve contenere solo cifre.';
      return;
    }
    const email = this.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.errore = 'Scrivi un indirizzo email valido.';
      return;
    }
    if (this.password.length < 8) {
      this.errore = 'La password deve avere almeno 8 caratteri.';
      return;
    }
    if (this.password !== this.conferma) {
      this.errore = 'Le password non coincidono.';
      return;
    }

    this.caricamento = true;
    this.errore = '';
    this.auth.primoAccesso(Number(this.codice.trim()), email, this.password).subscribe({
      next: risposta => {
        // Registrato: si torna su "Accedi" (il codice resta scritto) e si aspetta la conferma.
        this.caricamento = false;
        const codice = this.codice;
        this.cambiaModalita('accedi');
        this.codice = codice;
        this.email = '';
        this.avviso = risposta.message;
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.errore = this.messaggioErrore(err);
      },
    });
  }

  /** Rimanda l'email di conferma a chi ha la password giusta ma non ha ancora confermato. */
  rimandaEmail() {
    if (!this.codiceValido() || !this.password) {
      this.errore = 'Scrivi codice censimento e password, poi tocca «Rimanda l\'email».';
      return;
    }
    this.inviando = true;
    this.auth.reinviaConferma(Number(this.codice.trim()), this.password).subscribe({
      next: r => {
        this.inviando = false;
        this.errore = '';
        this.daConfermare = false;
        this.avviso = r.message;
      },
      error: (err: HttpErrorResponse) => {
        this.inviando = false;
        this.errore = this.messaggioErrore(err);
      },
    });
  }

  private entra() {
    this.caricamento = false;
    this.email = '';
    this.password = '';
    this.conferma = '';
    // Radice: login e benvenuto escono dalla cronologia, "indietro" non ci riporta più qui.
    this.navCtrl.navigateRoot('/home', { replaceUrl: true });
  }

  private codiceValido(): boolean {
    const c = this.codice.trim();
    return /^\d{1,10}$/.test(c) && Number(c) > 0;
  }

  private messaggioErrore(err: HttpErrorResponse): string {
    if (err.status === 0) return 'Server non raggiungibile. Riprova tra poco.';
    return err.error?.error ?? 'Si è verificato un errore. Riprova.';
  }
}
