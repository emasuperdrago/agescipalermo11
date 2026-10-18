import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref,
  IonContent, ModalController, ToastController
} from '@ionic/angular/standalone';
import {
  addOutline, arrowBackOutline, checkmarkOutline, chevronForwardOutline, closeOutline, documentTextOutline,
  downloadOutline, musicalNotesOutline, searchOutline, trashOutline
} from 'ionicons/icons';
import { AuthService } from '../services/auth';
import { CantiService, SEZIONI_CANTO, coloreSezione, nomeSezione } from '../services/canti';
import { CantoEditorComponent } from '../components/canto-editor/canto-editor.component';
import { AnteprimaLibrettoComponent } from '../components/anteprima-libretto/anteprima-libretto.component';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { BozzaLibretto, Canto, CantoElenco, SezioneCanto } from '../../types/models';

@Component({
  selector: 'app-canzoniere',
  templateUrl: './canzoniere.page.html',
  styleUrls: ['./canzoniere.page.scss'],
  standalone: true,
  imports: [
    FormsModule, RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent,
  ],
})
export class CanzonierePage {
  readonly sezioni = SEZIONI_CANTO;
  readonly nomeSezione = nomeSezione;
  readonly coloreSezione = coloreSezione;
  readonly icone = {
    indietro: arrowBackOutline, cerca: searchOutline, cancella: closeOutline, aggiungi: addOutline,
    canto: musicalNotesOutline, apri: chevronForwardOutline, scarica: downloadOutline,
    scelta: checkmarkOutline, libretto: documentTextOutline, elimina: trashOutline,
  };

  /** Le bozze dei libretti salvate dai capi, nella loro parte del canzoniere. */
  bozze: BozzaLibretto[] = [];
  vista: 'canti' | 'bozze' = 'canti';

  /** Selezione dei canti da mettere insieme in un PDF. */
  modalitaSelezione = false;
  scelti = new Set<number>();

  canti: CantoElenco[] = [];
  caricamento = true;
  errore = '';
  ricerca = '';
  sezione: SezioneCanto | null = null;

  /** La ricerca parte poco dopo che si smette di scrivere, non a ogni lettera. */
  private richieste = new Subject<void>();

  constructor(
    private auth: AuthService,
    private canti$: CantiService,
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
  ) {
    this.richieste.pipe(
      debounceTime(250),
      distinctUntilChanged(() => false),
      switchMap(() => this.canti$.elenco(this.ricerca, this.sezione)),
    ).subscribe({
      next: canti => {
        this.canti = canti;
        this.caricamento = false;
        this.errore = '';
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.errore = err.status === 404
          ? 'Il server non gestisce ancora il canzoniere: va riavviato il backend.'
          : 'Impossibile caricare i canti. Riprova tra poco.';
      },
    });
  }

  ionViewWillEnter() {
    // Al ritorno dal dettaglio un canto può essere cambiato o sparito.
    this.cerca();
    this.caricaBozze();
  }

  /** Capi e admin aggiungono, modificano ed eliminano i canti; gli altri li leggono. */
  get puoModificare(): boolean {
    const ruolo = this.auth.utente?.ruolo;
    return ruolo === 'capo' || ruolo === 'admin';
  }

  cerca() {
    this.caricamento = true;
    this.richieste.next();
  }

  // ---------- Libretto in PDF ----------

  /** I canti scelti, anche quelli non più in elenco dopo una ricerca. */
  get numeroScelti(): number {
    return this.scelti.size;
  }

  get tuttiScelti(): boolean {
    return this.canti.length > 0 && this.canti.every(c => this.scelti.has(c.id));
  }

  avviaSelezione() {
    this.modalitaSelezione = true;
  }

  annullaSelezione() {
    this.modalitaSelezione = false;
    this.scelti.clear();
  }

  alternaScelto(id: number) {
    if (this.scelti.has(id)) this.scelti.delete(id);
    else this.scelti.add(id);
  }

  /** Aggiunge o toglie tutti i canti che si vedono adesso (quelli trovati dalla ricerca). */
  alternaTutti() {
    if (this.tuttiScelti) this.canti.forEach(c => this.scelti.delete(c.id));
    else this.canti.forEach(c => this.scelti.add(c.id));
  }

  /** I canti scelti vanno nell'anteprima: copertina, messa, opzioni, e da lì si scarica. */
  async scaricaPdf() {
    if (!this.scelti.size) return;
    await this.apriAnteprima({ ids: [...this.scelti] });
  }

  private async apriAnteprima(props: { ids?: number[]; bozza?: BozzaLibretto }) {
    const modale = await this.modalCtrl.create({
      component: AnteprimaLibrettoComponent, componentProps: props, cssClass: 'modale-grande',
    });
    await modale.present();
    const { role } = await modale.onDidDismiss();
    if (role === 'salvato') this.caricaBozze();
  }

  // ---------- Bozze dei libretti ----------

  caricaBozze() {
    if (!this.puoModificare) return;
    this.canti$.bozze().subscribe({
      next: bozze => this.bozze = bozze,
      error: () => this.bozze = [],
    });
  }

  /** "25 ottobre 2026" (la data dell'evento) o quando è stata salvata. */
  dataBozza(b: BozzaLibretto): string {
    const opzioni: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
    if (b.data) {
      const [a, m, g] = b.data.split('-').map(Number);
      return new Date(a, m - 1, g).toLocaleDateString('it-IT', opzioni);
    }
    return `salvata il ${new Date(b.data_modifica).toLocaleDateString('it-IT', opzioni)}`;
  }

  apriBozza(b: BozzaLibretto) {
    this.canti$.bozza(b.id).subscribe({
      next: bozza => this.apriAnteprima({ bozza }),
      error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Non riesco ad aprire la bozza.'),
    });
  }

  async eliminaBozza(b: BozzaLibretto) {
    const alert = await this.alertCtrl.create({
      header: 'Eliminare la bozza?',
      message: `"${b.evento || 'Senza titolo'}" sparisce dalle bozze per tutti i capi.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        { text: 'Elimina', role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') return;
    this.canti$.eliminaBozza(b.id).subscribe({
      next: () => {
        this.bozze = this.bozze.filter(x => x.id !== b.id);
        this.avvisa('Bozza eliminata.');
      },
      error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Non sono riuscito a eliminarla.'),
    });
  }

  pulisciRicerca() {
    this.ricerca = '';
    this.cerca();
  }

  scegliSezione(sezione: SezioneCanto | null) {
    this.sezione = this.sezione === sezione ? null : sezione;
    this.cerca();
  }

  mostraTutti() {
    this.ricerca = '';
    this.sezione = null;
    this.cerca();
  }

  async nuovoCanto() {
    const modale = await this.modalCtrl.create({
      component: CantoEditorComponent,
      componentProps: { sezioneIniziale: this.sezione },
    });
    await modale.present();
    const { data, role } = await modale.onDidDismiss<Canto>();
    if (role !== 'salvato' || !data) return;
    this.avvisa(`"${data.titolo}" aggiunto al canzoniere.`);
    this.cerca();
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 1800, position: 'top' });
    await toast.present();
  }
}
