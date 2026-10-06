import { Component, OnInit, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
  IonRouterLinkWithHref, IonContent, ModalController, ToastController
} from '@ionic/angular/standalone';
import { addOutline, arrowBackOutline, checkmarkOutline, pawOutline, pencilOutline } from 'ionicons/icons';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { ParteRaccontoComponent } from '../components/parte-racconto/parte-racconto.component';
import { StoriaEditorComponent } from '../components/storia-editor/storia-editor.component';
import { StoriaService } from '../services/storia';
import { ParteStoria } from '../../types/models';

/**
 * La pagina di Marco Barbera, "Orso Giocoso": il murales, la sua frase e le parti
 * che scrivono i capi (con "Modifica la pagina" le aggiungono, spostano e tolgono).
 */
@Component({
  selector: 'app-marco',
  templateUrl: './marco.page.html',
  styleUrls: ['./marco.page.scss'],
  standalone: true,
  imports: [
    RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent, ParteRaccontoComponent,
  ],
})
export class MarcoPage implements OnInit {
  readonly icone = {
    indietro: arrowBackOutline, zampa: pawOutline, modifica: pencilOutline,
    fatto: checkmarkOutline, aggiungi: addOutline,
  };

  parti: ParteStoria[] = [];
  puoGestire = false;
  caricamento = true;
  errore = '';
  inModifica = false;
  occupato = false;

  private storia = inject(StoriaService);
  private modalCtrl = inject(ModalController);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);
  private inCorso = false;

  // Ionic a volte crea la pagina due volte: si carica sia all'avvio sia a ogni ingresso.
  ngOnInit() {
    this.carica();
  }

  ionViewWillEnter() {
    this.carica();
  }

  carica() {
    if (this.inCorso) return;
    this.inCorso = true;
    this.storia.marco().subscribe({
      next: dati => {
        this.parti = dati.parti;
        this.puoGestire = dati.puoGestire;
        if (!this.puoGestire) this.inModifica = false;
        this.caricamento = false;
        this.errore = '';
        this.inCorso = false;
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.inCorso = false;
        this.errore = err.status === 404
          ? 'Il server non conosce ancora questa pagina: va riavviato il backend.'
          : 'Non riesco a caricare la pagina. Riprova tra poco.';
      },
    });
  }

  alternaModifica() {
    this.inModifica = !this.inModifica;
  }

  async scrivi(voce?: ParteStoria) {
    const modale = await this.modalCtrl.create({
      component: StoriaEditorComponent,
      componentProps: { tipo: 'parti', voce, pagina: 'marco', conBranche: false },
    });
    await modale.present();
    const { role } = await modale.onDidDismiss();
    if (role !== 'salvato') return;
    this.avvisa(voce ? 'Modifiche salvate.' : 'Parte aggiunta.');
    this.carica();
  }

  sposta(voce: ParteStoria, verso: 'su' | 'giu') {
    this.occupato = true;
    this.storia.sposta('parti', voce.id, verso).subscribe({
      next: () => {
        this.occupato = false;
        this.carica();
      },
      error: (err: HttpErrorResponse) => {
        this.occupato = false;
        this.avvisa(err.error?.error ?? 'Non sono riuscito a spostarla.');
      },
    });
  }

  async togli(voce: ParteStoria) {
    const alert = await this.alertCtrl.create({
      header: 'Togliere questa parte?',
      message: `"${voce.titolo}" sparisce dalla pagina per tutti. Non si può recuperare.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        { text: 'Togli', role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') return;
    this.occupato = true;
    this.storia.togli('parti', voce.id).subscribe({
      next: () => {
        this.occupato = false;
        this.avvisa('Tolta dalla pagina.');
        this.carica();
      },
      error: (err: HttpErrorResponse) => {
        this.occupato = false;
        this.avvisa(err.error?.error ?? 'Non sono riuscito a toglierla.');
      },
    });
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 2200, position: 'top' });
    await toast.present();
  }
}
