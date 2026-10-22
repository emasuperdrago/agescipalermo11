import { Component, ElementRef, HostListener, OnInit, ViewChild, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
  IonRouterLinkWithHref, IonContent, ModalController, ToastController
} from '@ionic/angular/standalone';
import {
  addOutline, arrowBackOutline, arrowDownOutline, arrowForwardOutline, arrowUpOutline, cameraOutline,
  checkmarkOutline, chevronBackOutline, chevronForwardOutline, closeOutline, pencilOutline, trashOutline
} from 'ionicons/icons';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { ParteRaccontoComponent } from '../components/parte-racconto/parte-racconto.component';
import { StoriaEditorComponent } from '../components/storia-editor/storia-editor.component';
import { StoriaService, TipoStoria } from '../services/storia';
import { preparaImmagine } from '../services/immagini';
import { urlBackend } from '../services/posti';
import { iconaStoria, paragrafi } from './icone-storia';
import { Fazzolettone, ParteStoria, TappaStoria } from '../../types/models';

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
    sinistra: arrowBackOutline, destra: arrowForwardOutline, foto: cameraOutline, chiudi: closeOutline,
    precedente: chevronBackOutline, successivo: chevronForwardOutline,
  };
  readonly urlBackend = urlBackend;

  tappe: TappaStoria[] = [];
  parti: ParteStoria[] = [];
  fazzolettoni: Fazzolettone[] = [];
  /** Foto dei fazzolettoni aperta a schermo intero (indice), oppure null. */
  fazzolettoneAperto: number | null = null;
  caricandoFoto = false;
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
        this.fazzolettoni = dati.fazzolettoni ?? [];
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

  // ---------- La striscia dei fazzolettoni ----------

  @ViewChild('striscia') private striscia?: ElementRef<HTMLDivElement>;

  /** Le frecce ai lati della striscia la fanno scorrere di quasi una schermata. */
  scorriStriscia(verso: -1 | 1) {
    const el = this.striscia?.nativeElement;
    el?.scrollBy({ left: verso * el.clientWidth * .8, behavior: 'smooth' });
  }

  /** La foto si rimpicciolisce qui prima di partire; poi si chiede la scritta (facoltativa). */
  async scegliFazzolettone(evento: Event) {
    const input = evento.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    let foto: string;
    try {
      foto = await preparaImmagine(file, { latoMax: 1600 });
    } catch (e) {
      this.avvisa(e instanceof Error ? e.message : 'Questa foto non si riesce a leggere.');
      return;
    }
    const didascalia = await this.chiediScritta('Una scritta sotto la foto?', '');
    if (didascalia === null) return;

    this.caricandoFoto = true;
    this.storia.aggiungiFazzolettone(foto, didascalia).subscribe({
      next: f => {
        this.fazzolettoni = [...this.fazzolettoni, f];
        this.caricandoFoto = false;
        this.avvisa('Foto aggiunta.');
        // La nuova è in fondo: la striscia ci arriva da sola.
        setTimeout(() => {
          const el = this.striscia?.nativeElement;
          el?.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
        });
      },
      error: (err: HttpErrorResponse) => {
        this.caricandoFoto = false;
        this.avvisa(err.error?.error ?? 'Non sono riuscito a caricare la foto.');
      },
    });
  }

  async cambiaScritta(f: Fazzolettone) {
    const didascalia = await this.chiediScritta('Scritta sotto la foto', f.didascalia);
    if (didascalia === null || didascalia === f.didascalia) return;
    this.occupato = true;
    this.storia.scrittaFazzolettone(f.id, didascalia).subscribe({
      next: nuovo => {
        this.occupato = false;
        this.fazzolettoni = this.fazzolettoni.map(x => x.id === nuovo.id ? nuovo : x);
      },
      error: (err: HttpErrorResponse) => {
        this.occupato = false;
        this.avvisa(err.error?.error ?? 'Non sono riuscito a salvare la scritta.');
      },
    });
  }

  /** La scritta scelta (anche vuota), oppure null se si annulla. */
  private async chiediScritta(titolo: string, valore: string): Promise<string | null> {
    const alert = await this.alertCtrl.create({
      header: titolo,
      message: 'Facoltativa: per esempio gli anni in cui si è portato.',
      inputs: [{ name: 'didascalia', type: 'text', value: valore, placeholder: 'Es. 1983–1995, il primo', attributes: { maxlength: 80 } }],
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        { text: 'Salva', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    if (role !== 'confirm') return null;
    return String(data?.values?.didascalia ?? '').trim();
  }

  /**
   * Sposta una foto di un posto (prima o dopo) e salva subito il nuovo ordine.
   * Se il server non lo accetta si torna all'ordine vero, ricaricando.
   */
  spostaFazzolettone(indice: number, verso: -1 | 1) {
    const altro = indice + verso;
    if (this.occupato || altro < 0 || altro >= this.fazzolettoni.length) return;
    const nuovo = [...this.fazzolettoni];
    [nuovo[indice], nuovo[altro]] = [nuovo[altro], nuovo[indice]];
    this.fazzolettoni = nuovo;
    this.occupato = true;
    this.storia.riordinaFazzolettoni(nuovo.map(f => f.id)).subscribe({
      next: () => this.occupato = false,
      error: (err: HttpErrorResponse) => {
        this.occupato = false;
        this.avvisa(err.error?.error ?? 'Non sono riuscito a salvare il nuovo ordine.');
        this.carica();
      },
    });
  }

  async togliFazzolettone(f: Fazzolettone) {
    const alert = await this.alertCtrl.create({
      header: 'Togliere questa foto?',
      message: 'La foto sparisce dalla striscia dei fazzolettoni per tutti. Non si può recuperare.',
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        { text: 'Togli', role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') return;
    this.occupato = true;
    this.storia.togliFazzolettone(f.id).subscribe({
      next: () => {
        this.occupato = false;
        this.fazzolettoni = this.fazzolettoni.filter(x => x.id !== f.id);
        this.avvisa('Foto tolta.');
      },
      error: (err: HttpErrorResponse) => {
        this.occupato = false;
        this.avvisa(err.error?.error ?? 'Non sono riuscito a toglierla.');
      },
    });
  }

  apriFazzolettone(indice: number) {
    this.fazzolettoneAperto = indice;
  }

  chiudiFazzolettone() {
    this.fazzolettoneAperto = null;
  }

  scorriFazzolettoni(passo: number) {
    const quanti = this.fazzolettoni.length;
    if (this.fazzolettoneAperto === null || !quanti) return;
    this.fazzolettoneAperto = (this.fazzolettoneAperto + passo + quanti) % quanti;
  }

  @HostListener('document:keydown', ['$event'])
  tasto(evento: KeyboardEvent) {
    if (this.fazzolettoneAperto === null) return;
    if (evento.key === 'Escape') this.chiudiFazzolettone();
    else if (evento.key === 'ArrowLeft') this.scorriFazzolettoni(-1);
    else if (evento.key === 'ArrowRight') this.scorriFazzolettoni(1);
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 2200, position: 'top' });
    await toast.present();
  }
}
