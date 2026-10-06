import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonContent, NavController } from '@ionic/angular/standalone';
import { AuthService } from '../services/auth';

/**
 * La pagina del link "password dimenticata": si sceglie la password nuova e si entra.
 * Il codice del link si toglie subito dalla barra dell'indirizzo, così non resta nella
 * cronologia; serve solo quando si preme "Salva".
 */
@Component({
  selector: 'app-nuova-password',
  templateUrl: './nuova-password.page.html',
  styleUrls: ['./nuova-password.page.scss'],
  standalone: true,
  imports: [IonContent, FormsModule, RouterLink],
})
export class NuovaPasswordPage implements OnInit {
  password = '';
  conferma = '';
  mostraPassword = false;
  caricamento = false;
  errore = '';
  fatto = false;

  private token = '';
  private rotta = inject(ActivatedRoute);
  private auth = inject(AuthService);
  private navCtrl = inject(NavController);

  ngOnInit() {
    // Ionic può creare la pagina due volte: il codice del link si legge solo la prima.
    if (this.token) return;
    this.token = this.rotta.snapshot.queryParamMap.get('token') ?? '';
    history.replaceState(null, '', '/nuova-password');
    if (!this.token) this.errore = "Manca il codice del link: aprilo direttamente dall'email.";
  }

  get senzaLink(): boolean {
    return !this.token;
  }

  salva() {
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
    this.auth.nuovaPassword(this.token, this.password).subscribe({
      next: () => {
        this.caricamento = false;
        this.fatto = true;
        this.password = '';
        this.conferma = '';
        setTimeout(() => this.navCtrl.navigateRoot('/home', { replaceUrl: true }), 1600);
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.errore = err.status === 0
          ? 'Server non raggiungibile. Riprova tra poco.'
          : (err.error?.error ?? 'Non sono riuscito a cambiare la password.');
      },
    });
  }
}
