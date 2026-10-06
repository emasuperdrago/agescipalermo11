import { Component, OnInit, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
  IonRouterLinkWithHref, IonContent, ModalController, ToastController
} from '@ionic/angular/standalone';
import {
  addOutline, arrowBackOutline, arrowDownOutline, arrowUpOutline, checkmarkOutline, pencilOutline,
  trashOutline
} from 'ionicons/icons';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { ParteRaccontoComponent } from '../components/parte-racconto/parte-racconto.component';
import { StoriaEditorComponent } from '../components/storia-editor/storia-editor.component';
import { StoriaService, TipoStoria } from '../services/storia';
import { iconaStoria, paragrafi } from './icone-storia';
import { ParteStoria, TappaStoria } from '../../types/models';

/**
 * La storia del Gruppo Palermo 11: una linea con le tappe in alto e le parti sotto.
 * I testi stanno sul server: i capi li cambiano da qui con "Modifica la storia",
 * e possono aggiungere, spostare e togliere sia tappe sia parti.
 */
@Component({
  selector: 'app-storia',
  templateUrl: './storia.page.html',
  styleUrls: ['./storia.page.scss'],
  standalone: true,
  imports: [
    NgTemplateOutlet, RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent, ParteRaccontoComponent,
  ],
})
export class StoriaPage implements OnInit {
  readonly icone = {
    indietro: arrowBackOutline, modifica: pencilOutline, su: arrowUpOutline, giu: arrowDownOutline,
    elimina: trashOutline, aggiungi: addOutline, fatto: checkmarkOutline,
  };

  tappe: TappaStoria[] = [];
  parti: ParteStoria[] = [];
  puoGestire = false;
  caricamento = true;
  errore = '';
  /** Per i capi: con la modifica accesa compaiono i comandi su ogni tappa e parte. */
  inModifica = false;
  /** Mentre si sposta o si toglie qualcosa i comandi restano fermi. */
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
    this.storia.tutta().subscribe({
      next: dati => {
        this.tappe = dati.tappe;
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
          ? 'Il server non conosce ancora la storia: va riavviato il backend.'
          : 'Non riesco a caricare la storia. Riprova tra poco.';
      },
    });
  }

  /** Quanti anni ha il gruppo oggi. */
  get anni(): number {
    const oggi = new Date();
    const compleanno = new Date(oggi.getFullYear(), 10, 11);
    return oggi.getFullYear() - 1983 - (oggi < compleanno ? 1 : 0);
  }

  icona(chiave: string): string {
    return iconaStoria(chiave);
  }

  paragrafi(testo: string): string[] {
    return paragrafi(testo);
  }

  alternaModifica() {
    this.inModifica = !this.inModifica;
  }

  /** Apre il pop-up per scrivere una tappa o una parte (nuova se manca la voce). */
  async scrivi(tipo: TipoStoria, voce?: TappaStoria | ParteStoria) {
    const modale = await this.modalCtrl.create({
      component: StoriaEditorComponent,
      componentProps: { tipo, voce },
    });
    await modale.present();
    const { role } = await modale.onDidDismiss();
    if (role !== 'salvato') return;
    this.avvisa(voce ? 'Modifiche salvate.' : (tipo === 'tappe' ? 'Tappa aggiunta.' : 'Parte aggiunta.'));
    this.carica();
  }

  sposta(tipo: TipoStoria, voce: TappaStoria | ParteStoria, verso: 'su' | 'giu') {
    this.occupato = true;
    this.storia.sposta(tipo, voce.id, verso).subscribe({
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

  async togli(tipo: TipoStoria, voce: TappaStoria | ParteStoria) {
    const alert = await this.alertCtrl.create({
      header: tipo === 'tappe' ? 'Togliere questa tappa?' : 'Togliere questa parte?',
      message: `"${voce.titolo}" sparisce dalla storia per tutti. Non si può recuperare.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        { text: 'Togli', role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') return;
    this.occupato = true;
    this.storia.togli(tipo, voce.id).subscribe({
      next: () => {
        this.occupato = false;
        this.avvisa('Tolta dalla storia.');
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
