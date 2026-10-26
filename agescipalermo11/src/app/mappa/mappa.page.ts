import { Component, AfterViewInit, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref,
  IonContent, ModalController, ToastController
} from '@ionic/angular/standalone';
import {
  addOutline, arrowBackOutline, chevronForwardOutline, closeOutline, documentOutline, funnelOutline,
  imagesOutline, locateOutline, locationOutline, searchOutline
} from 'ionicons/icons';
import * as L from 'leaflet';
import { AuthService } from '../services/auth';
import { SorpreseService } from '../services/sorprese';
import { movimentoRidotto } from '../animazioni/scorrimento-orizzontale';
import {
  BRANCHE_POSTO, CENTRO_PALERMO, PostiService, ZOOM_PALERMO, aggiungiSfondoMappa, dateCampo, iconaBandierina,
  nomeBranca, stiliBranca
} from '../services/posti';
import { EsitoPostoEditor, PostoEditorComponent } from '../components/posto-editor/posto-editor.component';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { BrancaPosto, Posto } from '../../types/models';

/** Dove si ricorda il filtro scelto (solo su questo browser). */
const CHIAVE_FILTRO = 'filtroMappa';
const TUTTE_LE_BRANCHE = BRANCHE_POSTO.map(b => b.valore);

@Component({
  selector: 'app-mappa',
  templateUrl: './mappa.page.html',
  styleUrls: ['./mappa.page.scss'],
  standalone: true,
  imports: [
    FormsModule, RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent,
  ],
})
export class MappaPage implements AfterViewInit, OnDestroy, OnInit {
  @ViewChild('mappa') private contenitoreMappa?: ElementRef<HTMLDivElement>;

  readonly branche = BRANCHE_POSTO;
  readonly nomeBranca = nomeBranca;
  readonly icone = {
    indietro: arrowBackOutline, aggiungi: addOutline, filtro: funnelOutline, cerca: searchOutline,
    luogo: locationOutline, foto: imagesOutline, file: documentOutline, apri: chevronForwardOutline,
    cancella: closeOutline,
  };

  posti: Posto[] = [];
  caricamento = true;
  errore = '';

  /** Branche da mostrare: all'inizio tutte. */
  filtroBranche = new Set<BrancaPosto>(TUTTE_LE_BRANCHE);
  ricerca = '';

  private mappa?: L.Map;
  private strato = L.layerGroup();
  /** Bandierine per id del posto, per aprire il nome della sede dopo "Riposiziona". */
  private marcatori = new Map<number, L.Marker>();
  private osservatore?: ResizeObserver;
  /** Posti da inquadrare appena la mappa ha una misura. */
  private daInquadrare?: Posto[];
  /** La prima volta la mappa si adatta ai posti; dopo resta dove l'ha lasciata l'utente. */
  private inquadrata = false;

  constructor(
    private auth: AuthService,
    private postiService: PostiService,
    private router: Router,
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private sorprese: SorpreseService,
  ) {
    this.leggiFiltro();
  }

  ngAfterViewInit() {
    const el = this.contenitoreMappa?.nativeElement;
    if (!el) return;
    this.mappa = L.map(el, { center: CENTRO_PALERMO, zoom: ZOOM_PALERMO, zoomControl: false });
    // In basso a sinistra: "Riposiziona" sotto e lo zoom sopra (Leaflet impila verso l'alto).
    this.aggiungiControlloSede(this.mappa);
    L.control.zoom({ position: 'bottomleft', zoomInTitle: 'Avvicina', zoomOutTitle: 'Allontana' }).addTo(this.mappa);
    aggiungiSfondoMappa(this.mappa);
    this.strato.addTo(this.mappa);
    // Ionic mostra la pagina con un'animazione: la mappa va rimisurata quando cambia dimensione.
    this.osservatore = new ResizeObserver(() => {
      this.mappa?.invalidateSize();
      const posti = this.daInquadrare;
      this.daInquadrare = undefined;
      if (posti) this.inquadra(posti);
    });
    this.osservatore.observe(el);
    this.disegnaBandierine();
    this.tendaNascosta(el);
  }

  /**
   * Easter egg: tenendo premuto un punto vuoto della mappa (non una bandierina, non un pulsante)
   * compare "Monta la tenda qui!" e parte il gioco della tenda (vedi components/tenda).
   */
  private tendaNascosta(el: HTMLElement) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let da: { x: number; y: number } | null = null;
    const annulla = () => { clearTimeout(timer); da = null; };
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      if ((e.target as Element).closest('.leaflet-marker-icon, .leaflet-control, .leaflet-popup')) return;
      da = { x: e.clientX, y: e.clientY };
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!this.mappa || !da) return;
        const punto = this.mappa.mouseEventToLatLng(e as unknown as MouseEvent);
        L.popup({ closeButton: false, className: 'popup-tenda' }).setLatLng(punto)
          .setContent('⛺ Monta la tenda qui!').openOn(this.mappa);
        setTimeout(() => {
          this.mappa?.closePopup();
          this.sorprese.tenda.set(true);
        }, 900);
        da = null;
      }, 800);
    });
    el.addEventListener('pointermove', (e: PointerEvent) => {
      if (da && Math.hypot(e.clientX - da.x, e.clientY - da.y) > 10) annulla();
    });
    el.addEventListener('pointerup', annulla);
    el.addEventListener('pointercancel', annulla);
  }

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
    // Al ritorno dal dettaglio un posto può essere stato modificato o eliminato.
    this.caricaPosti();
  }

  ngOnDestroy() {
    this.osservatore?.disconnect();
    this.mappa?.remove();
  }

  /** Capi e admin aggiungono, modificano ed eliminano i posti; i ragazzi li consultano. */
  get puoModificare(): boolean {
    const ruolo = this.auth.utente?.ruolo;
    return ruolo === 'capo' || ruolo === 'admin';
  }

  /** La sede del gruppo (il backend la crea sempre). */
  get sede(): Posto | undefined {
    return this.posti.find(p => p.sede);
  }

  get tutteVisibili(): boolean {
    return TUTTE_LE_BRANCHE.every(b => this.filtroBranche.has(b));
  }

  /** Posti che passano il filtro per branca (quelli sulla mappa). */
  get postiFiltrati(): Posto[] {
    return this.posti.filter(p => this.filtroBranche.has(p.branca));
  }

  /** Posti dell'elenco: filtro per branca più la ricerca per nome o indirizzo. */
  get postiElenco(): Posto[] {
    const testo = normalizza(this.ricerca.trim());
    const filtrati = this.postiFiltrati;
    if (!testo) return filtrati;
    return filtrati.filter(p => normalizza(`${p.nome} ${p.indirizzo ?? ''}`).includes(testo));
  }

  /** Colori della branca per il CSS (colore, scritta sopra, colore forte su bianco). */
  readonly stiliBranca = stiliBranca;

  numeroPer(branca: BrancaPosto): number {
    return this.posti.filter(p => p.branca === branca).length;
  }

  /** Es. "1–8 agosto 2026 (+2)": l'ultimo campo e quanti altri ce ne sono. */
  testoCampi(p: Posto): string {
    if (!p.campi.length) return '';
    const altri = p.campi.length - 1;
    return dateCampo(p.campi[0]) + (altri ? ` (+${altri})` : '');
  }

  numeroFoto(p: Posto): number {
    return p.allegati.filter(a => a.tipo === 'foto').length;
  }

  numeroFile(p: Posto): number {
    return p.allegati.filter(a => a.tipo === 'file').length;
  }

  // ---------- Caricamento e bandierine ----------

  caricaPosti() {
    this.errore = '';
    this.postiService.elenco().subscribe({
      next: posti => {
        this.posti = posti;
        this.caricamento = false;
        this.disegnaBandierine();
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.errore = err.status === 404
          ? 'Il server non gestisce ancora la mappa: va riavviato il backend.'
          : err.status === 403
            ? 'La mappa è riservata a chi ha un codice censimento.'
            : 'Impossibile caricare i posti. Riprova tra poco.';
      },
    });
  }

  private disegnaBandierine() {
    if (!this.mappa) return;
    this.strato.clearLayers();
    this.marcatori.clear();
    const visibili = this.postiFiltrati;
    for (const p of visibili) {
      // La sede ha la bandierina più grande e sta sopra le altre.
      const marcatore = L.marker([p.latitudine, p.longitudine], {
        icon: iconaBandierina(p.branca, p.sede),
        title: p.sede ? `${p.nome} (sede)` : p.nome,
        alt: `${p.nome} (${p.sede ? 'sede del gruppo' : nomeBranca(p.branca)})`,
        riseOnHover: true,
        zIndexOffset: p.sede ? 1000 : 0,
      })
        // Il nome va passato come testo, non come stringa: Leaflet metterebbe una stringa
        // dentro la pagina come HTML, e un nome costruito apposta farebbe girare del codice.
        .bindTooltip(testoSicuro(p.nome), { direction: 'top', className: 'nome-posto' })
        .on('click', () => this.apri(p))
        .addTo(this.strato);
      this.marcatori.set(p.id, marcatore);
    }
    if (!this.inquadrata && this.posti.length) {
      this.inquadrata = true;
      this.inquadra(visibili.length ? visibili : this.posti);
    }
  }

  private inquadra(posti: Posto[]) {
    if (!this.mappa || !posti.length) return;
    // I posti possono arrivare prima che la pagina sia disegnata: con la mappa ancora senza
    // misura l'inquadratura verrebbe sbagliata, quindi si fa appena la mappa ha la sua misura.
    this.mappa.invalidateSize();
    const misura = this.mappa.getSize();
    if (!misura.x || !misura.y) {
      this.daInquadrare = posti;
      return;
    }
    if (posti.length === 1) {
      this.mappa.setView([posti[0].latitudine, posti[0].longitudine], 13);
      return;
    }
    const limiti = L.latLngBounds(posti.map(p => [p.latitudine, p.longitudine] as L.LatLngTuple));
    this.mappa.fitBounds(limiti, { padding: [48, 48], maxZoom: 13 });
  }

  apri(p: Posto) {
    this.router.navigate(['/mappa', p.id]);
  }

  // ---------- Riposiziona sulla sede ----------

  /** Pulsante dentro la mappa, così segue i controlli di Leaflet su telefono e computer. */
  private aggiungiControlloSede(mappa: L.Map) {
    const ControlloSede = L.Control.extend({
      onAdd: () => {
        const pulsante = L.DomUtil.create('button', 'controllo-sede') as HTMLButtonElement;
        pulsante.type = 'button';
        pulsante.title = 'Riposiziona sulla sede del gruppo';
        pulsante.setAttribute('aria-label', 'Riposiziona la mappa sulla sede del gruppo');
        const icona = L.DomUtil.create('ion-icon', '', pulsante);
        icona.setAttribute('icon', locateOutline);
        icona.setAttribute('aria-hidden', 'true');
        L.DomUtil.create('span', '', pulsante).textContent = 'Riposiziona';
        // I clic sul pulsante non devono arrivare alla mappa.
        L.DomEvent.disableClickPropagation(pulsante);
        L.DomEvent.on(pulsante, 'click', () => this.riposiziona());
        return pulsante;
      },
    });
    new ControlloSede({ position: 'bottomleft' }).addTo(mappa);
  }

  riposiziona() {
    const sede = this.sede;
    if (!this.mappa) return;
    if (!sede) {
      // Succede solo se i posti non sono ancora arrivati dal server.
      this.avvisa(this.caricamento ? 'Un attimo: sto caricando la mappa.' : 'Sede non trovata: ricarica la pagina.');
      return;
    }
    // Se il filtro nascondeva la sua bandierina, la si rimette.
    if (!this.filtroBranche.has(sede.branca)) {
      this.filtroBranche = new Set([...this.filtroBranche, sede.branca]);
      this.salvaFiltro();
      this.disegnaBandierine();
    }
    const punto: L.LatLngTuple = [sede.latitudine, sede.longitudine];
    const mostraNome = () => this.marcatori.get(sede.id)?.openTooltip();
    if (movimentoRidotto()) {
      this.mappa.setView(punto, 16);
      mostraNome();
    } else {
      this.mappa.once('moveend', mostraNome);
      this.mappa.flyTo(punto, 16, { duration: 0.8 });
    }
  }

  // ---------- Filtro ----------

  /** Come nel calendario: con tutte attive un tocco mostra solo quella; poi ogni tocco la aggiunge o la toglie. */
  alternaBranca(branca: BrancaPosto) {
    if (this.tutteVisibili) {
      this.filtroBranche = new Set([branca]);
    } else {
      const nuovo = new Set(this.filtroBranche);
      if (nuovo.has(branca)) nuovo.delete(branca);
      else nuovo.add(branca);
      this.filtroBranche = nuovo.size ? nuovo : new Set(TUTTE_LE_BRANCHE);
    }
    this.filtroCambiato();
  }

  mostraTutte() {
    this.filtroBranche = new Set(TUTTE_LE_BRANCHE);
    this.filtroCambiato();
  }

  brancaAttiva(branca: BrancaPosto): boolean {
    return this.filtroBranche.has(branca) && !this.tutteVisibili;
  }

  private filtroCambiato() {
    this.disegnaBandierine();
    // Si inquadrano i posti rimasti, così non restano bandierine fuori dallo schermo.
    this.inquadra(this.postiFiltrati);
    this.salvaFiltro();
  }

  private salvaFiltro() {
    try {
      localStorage.setItem(CHIAVE_FILTRO, JSON.stringify([...this.filtroBranche]));
    } catch { /* senza memoria del browser il filtro vale solo per questa visita */ }
  }

  private leggiFiltro() {
    try {
      const salvate = JSON.parse(localStorage.getItem(CHIAVE_FILTRO) ?? 'null');
      if (!Array.isArray(salvate)) return;
      const valide = salvate.filter((b): b is BrancaPosto => TUTTE_LE_BRANCHE.includes(b));
      if (valide.length) this.filtroBranche = new Set(valide);
    } catch { /* filtro salvato illeggibile: si parte da tutte */ }
  }

  // ---------- Nuovo posto (capi e admin) ----------

  async aggiungiPosto() {
    const centro = this.mappa?.getCenter();
    const modale = await this.modalCtrl.create({
      component: PostoEditorComponent,
      componentProps: {
        centroIniziale: centro ? { latitudine: centro.lat, longitudine: centro.lng, zoom: this.mappa!.getZoom() } : undefined,
      },
    });
    await modale.present();
    const { data, role } = await modale.onDidDismiss<EsitoPostoEditor>();
    if (role !== 'salvato' || !data) return;

    const { posto, avvisi } = data;
    this.posti = [...this.posti.filter(p => p.id !== posto.id), posto]
      .sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
    // Il nuovo posto deve vedersi anche se il filtro nascondeva la sua branca.
    if (!this.filtroBranche.has(posto.branca)) {
      this.filtroBranche = new Set([...this.filtroBranche, posto.branca]);
      this.filtroCambiato();
    }
    this.disegnaBandierine();
    this.mappa?.setView([posto.latitudine, posto.longitudine], Math.max(this.mappa.getZoom(), 14));

    if (avvisi.length) await this.mostraAvvisi(avvisi);
    else this.avvisa('Posto aggiunto alla mappa.');
  }

  private async mostraAvvisi(avvisi: string[]) {
    const alert = await this.alertCtrl.create({
      header: 'Posto salvato, ma…',
      message: `${avvisi.join('. ')}. Puoi riprovare da "Modifica".`,
      buttons: ['OK'],
    });
    await alert.present();
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 1800, position: 'top' });
    await toast.present();
  }
}

/** Minuscole e senza accenti, per cercare "citta" e trovare "Città". */
function normalizza(testo: string): string {
  return testo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Un elemento con dentro solo testo: quello che contiene non viene mai letto come HTML. */
function testoSicuro(testo: string): HTMLElement {
  const el = document.createElement('span');
  el.textContent = testo;
  return el;
}
