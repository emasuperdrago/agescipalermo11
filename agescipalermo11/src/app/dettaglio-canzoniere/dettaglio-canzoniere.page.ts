import { Component } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref,
  IonContent, ModalController, NavController, ToastController
} from '@ionic/angular/standalone';
import { arrowBackOutline, musicalNotesOutline, pencilOutline, trashOutline } from 'ionicons/icons';
import { AuthService } from '../services/auth';
import { CantiService, RigaCanto, coloreSezione, nomeSezione, righeCanto } from '../services/canti';
import { CantoEditorComponent } from '../components/canto-editor/canto-editor.component';
import { Canto } from '../../types/models';

/** Pagina di un canto: testo con gli accordi, che si possono nascondere. */
@Component({
  selector: 'app-dettaglio-canzoniere',
  templateUrl: './dettaglio-canzoniere.page.html',
  styleUrls: ['./dettaglio-canzoniere.page.scss'],
  standalone: true,
  imports: [
    RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref,
    IonContent,
  ],
})
export class DettaglioCanzonierePage {
  readonly icone = {
    indietro: arrowBackOutline, modifica: pencilOutline, elimina: trashOutline, canto: musicalNotesOutline,
  };
  readonly nomeSezione = nomeSezione;
  readonly coloreSezione = coloreSezione;

  canto: Canto | null = null;
  caricamento = true;
  errore = '';
  eliminando = false;
  /** Gli accordi si possono nascondere per leggere solo le parole. */
  accordiVisibili = true;

  private id: number;

  constructor(
    route: ActivatedRoute,
    private auth: AuthService,
    private canti: CantiService,
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private navCtrl: NavController,
  ) {
    this.id = Number(route.snapshot.paramMap.get('id'));
  }

  ionViewWillEnter() {
    this.carica();
  }

  get puoModificare(): boolean {
    const ruolo = this.auth.utente?.ruolo;
    return ruolo === 'capo' || ruolo === 'admin';
  }

  /** Il canto riga per riga, con o senza le righe degli accordi. */
  get righe(): RigaCanto[] {
    return this.canto ? righeCanto(this.canto.testo, this.accordiVisibili) : [];
  }

  carica() {
    if (!Number.isInteger(this.id) || this.id <= 0) {
      this.caricamento = false;
      this.errore = 'Canto non trovato.';
      return;
    }
    this.canti.dettaglio(this.id).subscribe({
      next: canto => {
        this.canto = canto;
        this.caricamento = false;
        this.errore = '';
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.canto = null;
        this.errore = err.status === 404
          ? (err.error?.error ? 'Questo canto non esiste più.' : 'Il server non gestisce ancora il canzoniere: va riavviato il backend.')
          : 'Impossibile caricare il canto. Riprova tra poco.';
      },
    });
  }

  async modifica() {
    if (!this.canto) return;
    const modale = await this.modalCtrl.create({
      component: CantoEditorComponent,
      componentProps: { canto: this.canto },
    });
    await modale.present();
    const { data, role } = await modale.onDidDismiss<Canto>();
    if (role !== 'salvato' || !data) return;
    this.canto = data;
    this.avvisa('Canto aggiornato.');
  }

  async confermaElimina() {
    if (!this.canto) return;
    const canto = this.canto;
    const alert = await this.alertCtrl.create({
      header: 'Eliminare il canto?',
      message: `"${canto.titolo}" verrà tolto dal canzoniere. Non si può annullare.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        { text: 'Elimina', role: 'destructive' },
      ],
    });
    await alert.present();
    // Dopo l'eliminazione si torna indietro: si aspetta che la finestrella sia sparita,
    // altrimenti un suo velo invisibile resterebbe sopra la pagina a prendersi i tocchi.
    const { role } = await alert.onDidDismiss();
    if (role === 'destructive') this.elimina(canto);
  }

  private elimina(canto: Canto) {
    this.eliminando = true;
    this.canti.elimina(canto.id).subscribe({
      next: () => {
        this.avvisa('Canto eliminato.');
        this.navCtrl.navigateBack('/canzoniere');
      },
      error: (err: HttpErrorResponse) => {
        this.eliminando = false;
        this.avvisa(err.error?.error ?? 'Eliminazione non riuscita. Riprova.');
      },
    });
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 1800, position: 'top' });
    await toast.present();
  }
}
