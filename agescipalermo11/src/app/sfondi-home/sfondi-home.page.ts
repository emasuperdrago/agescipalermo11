import { Component, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
  IonRouterLinkWithHref, IonContent, ToastController
} from '@ionic/angular/standalone';
import {
  addOutline, arrowBackOutline, chevronBackOutline, chevronForwardOutline, imageOutline, trashOutline
} from 'ionicons/icons';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { SfondiService } from '../services/sfondi';
import { preparaImmagine } from '../services/immagini';
import { SfondoHome } from '../../types/models';

/**
 * Le foto che scorrono nell'apertura della home. Le può cambiare qualsiasi capo:
 * si aggiungono, si tolgono, e la home le mostra a turno.
 */
@Component({
  selector: 'app-sfondi-home',
  templateUrl: './sfondi-home.page.html',
  styleUrls: ['./sfondi-home.page.scss'],
  standalone: true,
  imports: [
    RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent,
  ],
})
export class SfondiHomePage {
  readonly icone = {
    indietro: arrowBackOutline, aggiungi: addOutline, foto: imageOutline, elimina: trashOutline,
    prima: chevronBackOutline, dopo: chevronForwardOutline,
  };
  /** Mentre si salva un nuovo ordine le frecce restano ferme. */
  spostando = false;

  private sfondi$ = inject(SfondiService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);

  sfondi: SfondoHome[] = [];
  caricamento = true;
  inCaricamento = false;
  errore = '';

  ionViewWillEnter() {
    this.carica();
  }

  /** Ogni quanti secondi cambia la foto nella home: si dice qui, così si sa cosa aspettarsi. */
  get secondi(): number {
    return Math.round(this.sfondi$.durata / 1000);
  }

  url(sfondo: SfondoHome): string {
    return this.sfondi$.urlIntero(sfondo.url);
  }

  carica() {
    this.caricamento = true;
    this.sfondi$.elenco().subscribe({
      next: sfondi => {
        this.sfondi = sfondi;
        this.caricamento = false;
        this.errore = '';
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.errore = err.status === 404
          ? 'Il server non gestisce ancora le foto della home: va riavviato il backend.'
          : 'Impossibile caricare le foto. Riprova tra poco.';
      },
    });
  }

  /** La foto si rimpicciolisce qui prima di partire: lo sfondo non ha bisogno di più di 2000px. */
  async scegliFoto(evento: Event) {
    const input = evento.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    let foto: string;
    try {
      foto = await preparaImmagine(file, { latoMax: 2000 });
    } catch (e) {
      this.avvisa(e instanceof Error ? e.message : 'Questa foto non si riesce a leggere.');
      return;
    }

    this.inCaricamento = true;
    this.sfondi$.aggiungi(foto).subscribe({
      next: sfondo => {
        this.sfondi = [...this.sfondi, sfondo];
        this.inCaricamento = false;
        this.avvisa('Foto aggiunta: da ora scorre nella home.');
      },
      error: (err: HttpErrorResponse) => {
        this.inCaricamento = false;
        this.avvisa(err.error?.error ?? 'Non sono riuscito a caricare la foto.');
      },
    });
  }

  /**
   * Sposta una foto di un posto (prima o dopo) e salva subito il nuovo ordine.
   * Se il server non lo accetta si torna all'ordine vero, ricaricando.
   */
  sposta(indice: number, verso: -1 | 1) {
    const altro = indice + verso;
    if (this.spostando || altro < 0 || altro >= this.sfondi.length) return;
    const nuovo = [...this.sfondi];
    [nuovo[indice], nuovo[altro]] = [nuovo[altro], nuovo[indice]];
    this.sfondi = nuovo;
    this.spostando = true;
    this.sfondi$.riordina(nuovo.map(s => s.id)).subscribe({
      next: () => this.spostando = false,
      error: (err: HttpErrorResponse) => {
        this.spostando = false;
        this.avvisa(err.error?.error ?? 'Non sono riuscito a salvare il nuovo ordine.');
        this.carica();
      },
    });
  }

  async confermaElimina(sfondo: SfondoHome) {
    const alert = await this.alertCtrl.create({
      header: 'Rimuovere questa foto?',
      message: 'Non comparirà più nello sfondo della home.',
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Rimuovi', role: 'destructive', handler: () => {
            this.sfondi$.elimina(sfondo.id).subscribe({
              next: () => {
                this.sfondi = this.sfondi.filter(s => s.id !== sfondo.id);
                this.avvisa('Foto rimossa.');
              },
              error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Non sono riuscito a rimuoverla.'),
            });
          }
        },
      ],
    });
    await alert.present();
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 2000, position: 'top' });
    await toast.present();
  }
}
