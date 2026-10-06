import { Component, ElementRef, HostListener, OnDestroy, ViewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref,
  IonContent, ModalController, NavController, ToastController
} from '@ionic/angular/standalone';
import {
  arrowBackOutline, calendarOutline, callOutline, chevronBackOutline, chevronForwardOutline, closeOutline, documentOutline,
  downloadOutline, expandOutline, locationOutline, mailOutline, navigateOutline, pencilOutline, personOutline,
  trashOutline
} from 'ionicons/icons';
import * as L from 'leaflet';
import { AuthService } from '../services/auth';
import {
  PostiService, aggiungiSfondoMappa, dateCampo, dimensioneLeggibile, estensione, iconaBandierina, nomeBranca,
  stiliBranca, urlBackend, urlIndicazioni
} from '../services/posti';
import { EsitoPostoEditor, PostoEditorComponent } from '../components/posto-editor/posto-editor.component';
import { AllegatoPosto, Posto } from '../../types/models';

/** Pagina di un posto della mappa: foto, descrizione, contatti, file e indicazioni per arrivarci. */
@Component({
  selector: 'app-dettaglio-informazioni-mappa',
  templateUrl: './dettaglio-informazioni-mappa.page.html',
  styleUrls: ['./dettaglio-informazioni-mappa.page.scss'],
  standalone: true,
  imports: [
    RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref,
    IonContent,
  ],
})
export class DettaglioInformazioniMappaPage implements OnDestroy {
  readonly icone = {
    indietro: arrowBackOutline, modifica: pencilOutline, elimina: trashOutline, indicazioni: navigateOutline,
    luogo: locationOutline, telefono: callOutline, email: mailOutline, persona: personOutline,
    file: documentOutline, scarica: downloadOutline, ingrandisci: expandOutline, chiudi: closeOutline,
    precedente: chevronBackOutline, successivo: chevronForwardOutline, campo: calendarOutline,
  };
  readonly nomeBranca = nomeBranca;
  readonly dimensioneLeggibile = dimensioneLeggibile;
  readonly urlBackend = urlBackend;

  posto: Posto | null = null;
  caricamento = true;
  errore = '';
  eliminando = false;
  /** Foto aperta a schermo intero (indice in `foto`), oppure null. */
  fotoAperta: number | null = null;

  private id: number;
  private miniMappa?: L.Map;
  private segnaposto?: L.Marker;
  private osservatore?: ResizeObserver;

  /** Il contenitore compare solo dopo il caricamento: la mappa si crea quando c'è. */
  @ViewChild('miniMappa') set contenitoreMiniMappa(el: ElementRef<HTMLDivElement> | undefined) {
    if (el && !this.miniMappa) this.creaMiniMappa(el.nativeElement);
  }

  constructor(
    route: ActivatedRoute,
    private auth: AuthService,
    private postiService: PostiService,
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

  ngOnDestroy() {
    this.osservatore?.disconnect();
    this.miniMappa?.remove();
  }

  get puoModificare(): boolean {
    const ruolo = this.auth.utente?.ruolo;
    return ruolo === 'capo' || ruolo === 'admin';
  }

  /** Colori della branca per il CSS (colore, scritta sopra, colore forte su bianco). */
  readonly stiliBranca = stiliBranca;

  get foto(): AllegatoPosto[] {
    return this.posto?.allegati.filter(a => a.tipo === 'foto') ?? [];
  }

  get file(): AllegatoPosto[] {
    return this.posto?.allegati.filter(a => a.tipo === 'file') ?? [];
  }

  readonly dateCampo = dateCampo;

  get indicazioni(): string {
    return this.posto ? urlIndicazioni(this.posto) : '';
  }

  get coordinate(): string {
    return this.posto ? `${this.posto.latitudine.toFixed(5)}, ${this.posto.longitudine.toFixed(5)}` : '';
  }

  /** Es. "GPX", "PDF": si mostra nel riquadro del file. */
  tipoFile(a: AllegatoPosto): string {
    return estensione(a.nome).toUpperCase().slice(0, 4) || 'FILE';
  }

  /** Il numero per il link "tel:" senza spazi e simboli. */
  telefonoLink(numero: string): string {
    return 'tel:' + numero.replace(/[^\d+]/g, '');
  }

  // ---------- Caricamento ----------

  carica() {
    if (!Number.isInteger(this.id) || this.id <= 0) {
      this.caricamento = false;
      this.errore = 'Posto non trovato.';
      return;
    }
    this.postiService.dettaglio(this.id).subscribe({
      next: posto => {
        this.posto = posto;
        this.caricamento = false;
        this.errore = '';
        this.aggiornaMiniMappa();
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.posto = null;
        this.errore = err.status === 404
          ? (err.error?.error ? 'Questo posto non esiste più.' : 'Il server non gestisce ancora la mappa: va riavviato il backend.')
          : err.status === 403
            ? 'La mappa è riservata a chi ha un codice censimento.'
            : 'Impossibile caricare il posto. Riprova tra poco.';
      },
    });
  }

  private creaMiniMappa(el: HTMLDivElement) {
    if (!this.posto) return;
    this.miniMappa = L.map(el, {
      center: [this.posto.latitudine, this.posto.longitudine],
      zoom: 15,
      // Su telefono non deve "rubare" lo scorrimento della pagina.
      scrollWheelZoom: false,
      dragging: !L.Browser.mobile,
    });
    aggiungiSfondoMappa(this.miniMappa);
    this.osservatore = new ResizeObserver(() => this.miniMappa?.invalidateSize());
    this.osservatore.observe(el);
    this.aggiornaMiniMappa();
  }

  private aggiornaMiniMappa() {
    if (!this.miniMappa || !this.posto) return;
    const punto: L.LatLngTuple = [this.posto.latitudine, this.posto.longitudine];
    const icona = iconaBandierina(this.posto.branca, true);
    if (this.segnaposto) this.segnaposto.setLatLng(punto).setIcon(icona);
    else this.segnaposto = L.marker(punto, { icon: icona, keyboard: false }).addTo(this.miniMappa);
    this.miniMappa.setView(punto, this.miniMappa.getZoom());
  }

  // ---------- Foto a schermo intero ----------

  apriFoto(indice: number) {
    this.fotoAperta = indice;
  }

  chiudiFoto() {
    this.fotoAperta = null;
  }

  scorriFoto(passo: number) {
    if (this.fotoAperta === null || !this.foto.length) return;
    this.fotoAperta = (this.fotoAperta + passo + this.foto.length) % this.foto.length;
  }

  @HostListener('document:keydown', ['$event'])
  tasto(evento: KeyboardEvent) {
    if (this.fotoAperta === null) return;
    if (evento.key === 'Escape') this.chiudiFoto();
    else if (evento.key === 'ArrowLeft') this.scorriFoto(-1);
    else if (evento.key === 'ArrowRight') this.scorriFoto(1);
  }

  // ---------- Modifica ed eliminazione (capi e admin) ----------

  async modifica() {
    if (!this.posto) return;
    const modale = await this.modalCtrl.create({
      component: PostoEditorComponent,
      componentProps: { posto: this.posto },
    });
    await modale.present();
    const { data, role } = await modale.onDidDismiss<EsitoPostoEditor>();
    if (role !== 'salvato' || !data) return;
    this.posto = data.posto;
    this.fotoAperta = null;
    this.aggiornaMiniMappa();
    if (data.avvisi.length) {
      const alert = await this.alertCtrl.create({
        header: 'Modifiche salvate, ma…',
        message: `${data.avvisi.join('. ')}. Puoi riprovare da "Modifica".`,
        buttons: ['OK'],
      });
      await alert.present();
    } else {
      this.avvisa('Posto aggiornato.');
    }
  }

  async confermaElimina() {
    if (!this.posto || this.posto.sede) return;
    const posto = this.posto;
    const alert = await this.alertCtrl.create({
      header: 'Eliminare il posto?',
      message: `"${posto.nome}" verrà tolto dalla mappa insieme a tutte le sue foto e i suoi file. Non si può annullare.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        { text: 'Elimina', role: 'destructive' },
      ],
    });
    await alert.present();
    // Dopo l'eliminazione si torna indietro: si aspetta che la finestrella sia sparita,
    // altrimenti un suo velo invisibile resterebbe sopra la pagina a prendersi i tocchi.
    const { role } = await alert.onDidDismiss();
    if (role === 'destructive') this.elimina(posto);
  }

  private elimina(posto: Posto) {
    this.eliminando = true;
    this.postiService.elimina(posto.id).subscribe({
      next: () => {
        this.avvisa('Posto eliminato.');
        this.navCtrl.navigateBack('/mappa');
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
