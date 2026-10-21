import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, NavController } from '@ionic/angular/standalone';
import { AuthService } from '../services/auth';

@Component({
  selector: 'app-benvenuto',
  templateUrl: './benvenuto.page.html',
  styleUrls: ['./benvenuto.page.scss'],
  standalone: true,
  imports: [IonContent, RouterLink],
})
export class BenvenutoPage implements OnInit {
  caricamento = false;
  errore = '';
  messaggioSessione = '';

  constructor(private auth: AuthService, private navCtrl: NavController) {
    this.aggiornaSessione();
  }

  // Ionic riusa la pagina quando ci si torna: ricontrolla la sessione a ogni ingresso.
  // Ionic a volte crea la pagina due volte e l'ingresso arriva a una copia sola: la pagina si
  // prepara già alla creazione, e all'ingresso solo se non l'ha appena fatto.
  private appenaCreata = false;

  ngOnInit() {
    this.appenaCreata = true;
    this.entra();
  }

  ionViewWillEnter() {
    if (this.appenaCreata) {
      this.appenaCreata = false;
      return;
    }
    this.entra();
  }

  private entra() {
    this.caricamento = false;
    this.aggiornaSessione();
  }

  esci() {
    this.auth.esci();
    this.aggiornaSessione();
  }

  private aggiornaSessione() {
    const utente = this.auth.sessioneValida() ? this.auth.utente : null;
    if (!utente) this.messaggioSessione = '';
    else if (utente.ruolo === 'visitatore') this.messaggioSessione = 'Stai navigando come visitatore.';
    else this.messaggioSessione = `Sei connesso come ${utente.nome} ${utente.cognome}.`;
  }

  accediComeVisitatore() {
    this.caricamento = true;
    this.errore = '';
    this.auth.accediComeVisitatore().subscribe({
      next: () => this.navCtrl.navigateRoot('/home'),
      error: () => {
        this.caricamento = false;
        this.errore = 'Server non raggiungibile. Riprova tra poco.';
      },
    });
  }
}
