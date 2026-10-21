import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref,
  IonContent, ModalController, NavController, ToastController
} from '@ionic/angular/standalone';
import { HttpErrorResponse } from '@angular/common/http';
import {
  arrowBackOutline, idCardOutline, logOutOutline, mailOutline, pencilOutline, person, personOutline,
  pricetagOutline, shieldCheckmarkOutline
} from 'ionicons/icons';
import { AuthService } from '../services/auth';
import { ModificaProfiloComponent } from '../components/modifica-profilo/modifica-profilo.component';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { Branca, Utente } from '../../types/models';

const NOMI_RUOLO = { ragazzo: 'Ragazzo/a', capo: 'Capo', admin: 'Capo gruppo (admin)' } as const;
const NOMI_BRANCA: Record<Branca, string> = { branco: 'Branco', reparto: 'Reparto', clan: 'Clan' };

interface CampoProfilo {
  etichetta: string;
  valore: string;
  icona: string;
  /** Pallino colorato accanto al valore (solo per la branca). */
  pallino?: string;
  /** Un pulsante accanto al valore (per ora solo "Cambia" sull'email). */
  azione?: 'email';
}

@Component({
  selector: 'app-profilo',
  templateUrl: './profilo.page.html',
  styleUrls: ['./profilo.page.scss'],
  standalone: true,
  imports: [
    RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref, IonContent,
    BarraInferioreComponent,
  ],
})
export class ProfiloPage implements OnInit {
  readonly icone = { indietro: arrowBackOutline, avatar: person, modifica: pencilOutline, esci: logOutOutline };

  utente: Utente | null = null;

  constructor(
    private auth: AuthService,
    private toastCtrl: ToastController,
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private navCtrl: NavController,
  ) {}

  async esci() {
    const alert = await this.alertCtrl.create({
      header: 'Uscire dall\'account?',
      message: 'Per rientrare ti serviranno codice censimento e password.',
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        { text: 'Esci', role: 'destructive' },
      ],
    });
    await alert.present();
    // Si cambia pagina solo quando la finestrella è sparita del tutto: se si parte mentre
    // si sta ancora chiudendo, resta un velo invisibile sopra lo schermo che si prende
    // tutti i tocchi (Accedi, Primo accesso... non rispondevano più).
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') return;
    this.auth.esci();
    this.navCtrl.navigateRoot('/benvenuto', { replaceUrl: true });
  }

  // Si mostrano subito i dati della sessione, poi si aggiornano con quelli del server.
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
    this.utente = this.auth.utente;
    if (this.visitatore) return;
    this.auth.profilo().subscribe({
      next: utente => this.utente = utente,
      error: () => {}, // restano i dati della sessione
    });
  }

  get urlFoto(): string | null {
    return this.auth.urlFotoProfilo(this.utente);
  }

  get visitatore(): boolean {
    return !this.utente || this.utente.ruolo === 'visitatore';
  }

  /** Chiave per il colore della copertina: la branca, oppure "gruppo" per chi non ne ha una. */
  get tema(): string {
    if (!this.utente || this.utente.ruolo === 'visitatore') return 'gruppo';
    return this.utente.branca ?? 'gruppo';
  }

  get nomeCompleto(): string {
    return this.utente && this.utente.ruolo !== 'visitatore' ? `${this.utente.nome} ${this.utente.cognome}` : 'Visitatore';
  }

  get campi(): CampoProfilo[] {
    const u = this.utente;
    if (!u || u.ruolo === 'visitatore') return [];
    return [
      { etichetta: 'Nome', valore: u.nome, icona: personOutline },
      { etichetta: 'Cognome', valore: u.cognome, icona: personOutline },
      { etichetta: 'Codice censimento', valore: String(u.codice_censimento), icona: idCardOutline },
      { etichetta: 'Email', valore: u.email ?? 'Nessuna', icona: mailOutline, azione: 'email' },
      { etichetta: 'Ruolo', valore: NOMI_RUOLO[u.ruolo], icona: shieldCheckmarkOutline },
      {
        etichetta: 'Branca',
        valore: u.branca ? NOMI_BRANCA[u.branca] : 'Nessuna (gruppo)',
        icona: pricetagOutline,
        pallino: u.branca ?? 'gruppo',
      },
    ];
  }

  /**
   * Cambio dell'email: si chiedono l'indirizzo nuovo e la password attuale, poi si chiede
   * conferma. L'email nuova vale solo dopo aver aperto il link che arriva lì.
   */
  async cambiaEmail() {
    if (!this.utente || this.visitatore) return;
    const chiedi = await this.alertCtrl.create({
      header: 'Cambia email',
      message: 'Scrivi la nuova email e, per sicurezza, la tua password attuale.',
      inputs: [
        { name: 'email', type: 'email', placeholder: 'Nuova email', attributes: { maxlength: 120, autocomplete: 'email' } },
        { name: 'password', type: 'password', placeholder: 'Password attuale', attributes: { autocomplete: 'current-password' } },
      ],
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        { text: 'Avanti', role: 'avanti' },
      ],
    });
    await chiedi.present();
    const { role, data } = await chiedi.onDidDismiss<{ values: { email: string; password: string } }>();
    if (role !== 'avanti') return;
    const email = (data?.values?.email ?? '').trim().toLowerCase();
    const password = data?.values?.password ?? '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return this.avvisa('Scrivi un indirizzo email valido.');
    if (!password) return this.avvisa('Per sicurezza serve la tua password attuale.');

    // Il messaggio di conferma: si dice chiaramente cosa succede prima di farlo.
    const attuale = this.utente.ruolo !== 'visitatore' ? this.utente.email : null;
    const conferma = await this.alertCtrl.create({
      header: 'Confermi il cambio?',
      message: `Mandiamo un link a ${email}. Finché non lo apri, il tuo account resta con l'email di adesso`
        + (attuale ? ` (${attuale}).` : '.'),
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        { text: 'Sì, cambia', role: 'confirm' },
      ],
    });
    await conferma.present();
    const scelta = await conferma.onDidDismiss();
    if (scelta.role !== 'confirm') return;

    this.auth.cambiaEmail(email, password).subscribe({
      next: async r => {
        const fatto = await this.alertCtrl.create({ header: 'Controlla la posta', message: r.message, buttons: ['Ok'] });
        await fatto.present();
      },
      error: (err: HttpErrorResponse) =>
        this.avvisa(err.status === 0 ? 'Server non raggiungibile. Riprova tra poco.' : (err.error?.error ?? 'Non sono riuscito a cambiarla.')),
    });
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 2600, position: 'top' });
    await toast.present();
  }

  async modificaProfilo() {
    if (!this.utente || this.visitatore) return;
    const modale = await this.modalCtrl.create({
      component: ModificaProfiloComponent,
      componentProps: { utente: this.utente },
    });
    await modale.present();
    const { data, role } = await modale.onDidDismiss<Utente>();
    if (role !== 'salvato' || !data) return;
    this.utente = data;
    const toast = await this.toastCtrl.create({ message: 'Profilo aggiornato.', duration: 1800, position: 'top' });
    await toast.present();
  }
}
