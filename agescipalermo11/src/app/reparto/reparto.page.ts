import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subscription } from 'rxjs';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
  IonRouterLinkWithHref, IonContent, ToastController
} from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';
import {
  addOutline, arrowBackOutline, arrowUpCircleOutline, boatOutline, bonfireOutline, businessOutline,
  cameraOutline, chevronDownOutline, colorPaletteOutline, compassOutline, constructOutline, flagOutline,
  globeOutline, hammerOutline, leafOutline, medalOutline, medkitOutline, newspaperOutline, peopleOutline, ribbonOutline,
  timeOutline, trailSignOutline, trashOutline, triangleOutline, trophyOutline
} from 'ionicons/icons';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { ElencoDistintiviComponent } from '../components/elenco-distintivi/elenco-distintivi.component';
import { BREVETTI_REPARTO, SPECIALITA_REPARTO } from './specialita-reparto';
import { SquadriglieService } from '../services/squadriglie';
import { GuidonciniService, nomeAnnoScout } from '../services/guidoncini';
import { preparaImmagine } from '../services/immagini';
import { Guidoncino, SpecialitaSquadriglia, Squadriglia } from '../../types/models';

/** Le parti della pagina: si passa da una all'altra dalla fascia in alto. */
type Sezione = 'chi-siamo' | 'squadriglie' | 'guidoncini' | 'specialita' | 'promessa-e-legge';

/** L'icona di ogni specialità di squadriglia, per chiave. */
const ICONE_SPECIALITA: Record<string, string> = {
  alpinismo: triangleOutline,
  artigianato: hammerOutline,
  campismo: bonfireOutline,
  civitas: businessOutline,
  esplorazione: compassOutline,
  espressione: colorPaletteOutline,
  giornalismo: newspaperOutline,
  internazionale: globeOutline,
  natura: leafOutline,
  nautica: boatOutline,
  olympia: trophyOutline,
  'pronto-intervento': medkitOutline,
};

/** Una squadriglia con i suoi guidoncini, dal più recente. */
interface Palmares {
  squadriglia: Squadriglia;
  guidoncini: Guidoncino[];
}

/**
 * La sezione Reparto, divisa in parti che si scambiano senza ricaricare:
 * chi siamo, le squadriglie, i guidoncini in vetta (le specialità di squadriglia
 * conquistate), specialità e brevetti individuali e i testi di Promessa e Legge. Le voci del menu della home arrivano
 * qui con l'ancora (#squadriglie, #guidoncini, #specialita, #promessa-e-legge) e aprono
 * direttamente la parte giusta.
 */
@Component({
  selector: 'app-reparto',
  templateUrl: './reparto.page.html',
  styleUrls: ['./reparto.page.scss'],
  standalone: true,
  imports: [
    RouterLink, FormsModule, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent, ElencoDistintiviComponent,
  ],
})
export class RepartoPage implements OnInit, OnDestroy {
  readonly icone = {
    indietro: arrowBackOutline, squadriglie: flagOutline, promessa: ribbonOutline,
    avventura: compassOutline, squadriglia: peopleOutline, impresa: constructOutline,
    sentiero: trailSignOutline, apri: chevronDownOutline, storiche: timeOutline,
    aggiungi: addOutline, chiudi: timeOutline, riapri: arrowUpCircleOutline,
    foto: cameraOutline, elimina: trashOutline, guidoncini: triangleOutline,
    specialita: medalOutline,
  };

  /** La fascia in alto: una voce per parte, con la sua icona. */
  readonly sezioni = [
    { chiave: 'chi-siamo', titolo: 'Chi siamo', icona: this.icone.sentiero },
    { chiave: 'squadriglie', titolo: 'Squadriglie', icona: this.icone.squadriglie },
    { chiave: 'guidoncini', titolo: 'Guidoncini', icona: this.icone.guidoncini },
    { chiave: 'specialita', titolo: 'Specialità', icona: this.icone.specialita },
    { chiave: 'promessa-e-legge', titolo: 'Promessa', icona: this.icone.promessa },
  ] as const;

  /**
   * I tre pilastri della branca: il nome si vede sempre, la spiegazione si apre
   * toccando il riquadro (uno alla volta).
   */
  readonly pilastri = [
    {
      chiave: 'avventura',
      titolo: 'Avventura',
      testo: 'Tende piantate al buio, fuochi accesi sotto la pioggia, sentieri che non si '
        + 'conoscono. L\'avventura è il modo del Reparto di imparare: provando.',
    },
    {
      chiave: 'squadriglia',
      titolo: 'Squadriglia',
      testo: 'Sei o sette ragazzi che si scelgono un nome e un grido e si dividono i compiti. '
        + 'In squadriglia si conta su qualcuno e qualcuno conta su di te.',
    },
    {
      chiave: 'impresa',
      titolo: 'Impresa',
      testo: 'Un\'idea grande, decisa insieme e portata a termine: costruire, partire, '
        + 'organizzare. Si sceglie in Consiglio e ognuno ci mette la sua competenza.',
    },
  ] as const;

  /**
   * La Legge scout, i dieci articoli. Sono le parole dell'AGESCI: si cambiano solo qui,
   * non a mano dal sito.
   */
  readonly legge = [
    'La guida e lo scout pongono il loro onore nel meritare fiducia.',
    'La guida e lo scout sono leali.',
    'La guida e lo scout si rendono utili e aiutano gli altri.',
    'La guida e lo scout sono amici di tutti e fratelli di ogni altra guida e scout.',
    'La guida e lo scout sono cortesi.',
    'La guida e lo scout amano e rispettano la natura.',
    'La guida e lo scout sanno obbedire.',
    'La guida e lo scout sorridono e cantano anche nelle difficoltà.',
    'La guida e lo scout sono laboriosi ed economi.',
    'La guida e lo scout sono puri di pensieri, parole e azioni.',
  ] as const;

  /** Le squadriglie, in ordine alfabetico: le manda il server. */
  squadriglie: Squadriglia[] = [];
  squadriglieChiuse: Squadriglia[] = [];
  /** Vero per i capi reparto: a loro compaiono i pulsanti per gestirle. */
  puoGestire = false;
  caricamentoSquadriglie = true;
  erroreSquadriglie = '';

  /** Le specialità di squadriglia e i guidoncini conquistati: li manda il server. */
  specialita: SpecialitaSquadriglia[] = [];
  guidoncini: Guidoncino[] = [];
  annoCorrente = 0;
  caricamentoGuidoncini = true;
  erroreGuidoncini = '';
  /** La specialità aperta nella griglia: null quando sono tutte chiuse. */
  specialitaAperta: string | null = null;
  /** Il modulo dei capi reparto per segnare un guidoncino. */
  nuovo = { squadriglia_id: 0, specialita: '', anno: 0 };
  salvataggioGuidoncino = false;

  readonly specialitaIndividuali = SPECIALITA_REPARTO;
  readonly brevetti = BREVETTI_REPARTO;
  /** Nella parte Specialità si guardano le specialità o i brevetti. */
  distintiviScelti: 'specialita' | 'brevetti' = 'specialita';

  sezioneAttiva: Sezione = 'chi-siamo';
  /** Se è aperto l'elenco delle squadriglie chiuse. */
  storicheAperte = false;
  /** Il pilastro aperto adesso: null quando sono tutti chiusi. */
  pilastroAperto: string | null = null;

  private rotta = inject(ActivatedRoute);
  private squadriglieService = inject(SquadriglieService);
  private guidonciniService = inject(GuidonciniService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);
  private ascolto?: Subscription;

  ngOnInit() {
    // L'ancora arriva dal menu della home: #squadriglie apre quella parte.
    this.ascolto = this.rotta.fragment.subscribe(ancora => this.dallAncora(ancora));
    this.caricaSquadriglie();
    this.caricaGuidoncini();
  }

  ngOnDestroy() {
    this.ascolto?.unsubscribe();
  }

  ionViewWillEnter() {
    this.dallAncora(this.rotta.snapshot.fragment);
    this.caricaSquadriglie();
    this.caricaGuidoncini();
  }

  caricaSquadriglie() {
    this.caricamentoSquadriglie = true;
    this.squadriglieService.tutte().subscribe({
      next: dati => {
        this.squadriglie = dati.attive;
        this.squadriglieChiuse = dati.chiuse;
        this.puoGestire = dati.puoGestire;
        this.caricamentoSquadriglie = false;
        this.erroreSquadriglie = '';
      },
      error: (err: HttpErrorResponse) => {
        this.caricamentoSquadriglie = false;
        this.erroreSquadriglie = err.status === 404
          ? 'Il server non conosce ancora le squadriglie: va riavviato il backend.'
          : 'Non riesco a caricare le squadriglie. Riprova tra poco.';
      },
    });
  }

  /** Nuova squadriglia: si chiedono il nome e l'emoticon dell'animale. */
  async aggiungiSquadriglia() {
    const alert = await this.alertCtrl.create({
      header: 'Nuova squadriglia',
      message: 'Scrivi il nome. La foto dell\'animale la aggiungi dopo, dal suo riquadro.',
      inputs: [
        { name: 'nome', type: 'text', placeholder: 'Nome (es. Aquile)', attributes: { maxlength: 40 } },
      ],
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Aggiungi', handler: (valori: { nome: string }) => {
            const nome = (valori.nome ?? '').trim();
            if (!nome) {
              this.avvisa('Serve il nome.');
              return false;
            }
            this.squadriglieService.aggiungi(nome).subscribe({
              next: () => {
                this.avvisa(`${nome} aggiunta: ora mettile la foto dell'animale.`);
                this.caricaSquadriglie();
              },
              error: (err: HttpErrorResponse) =>
                this.avvisa(err.error?.error ?? 'Non sono riuscito ad aggiungerla.'),
            });
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  /** Chiude una squadriglia: finisce nell'archivio, non si perde. */
  async confermaChiusura(sq: Squadriglia) {
    const alert = await this.alertCtrl.create({
      header: `Chiudere ${sq.nome}?`,
      message: 'Finisce fra le squadriglie di una volta. Da lì la si può riaprire quando serve.',
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Chiudi la squadriglia', handler: () => {
            this.squadriglieService.cambiaStato(sq.id, false).subscribe({
              next: () => {
                this.avvisa(`${sq.nome} è nell'archivio.`);
                this.caricaSquadriglie();
              },
              error: (err: HttpErrorResponse) =>
                this.avvisa(err.error?.error ?? 'Non sono riuscito a chiuderla.'),
            });
          },
        },
      ],
    });
    await alert.present();
  }

  /** Riporta fra le attive una squadriglia dell'archivio. */
  async confermaRiapertura(sq: Squadriglia) {
    const alert = await this.alertCtrl.create({
      header: `Riaprire ${sq.nome}?`,
      message: 'Torna fra le squadriglie del Reparto.',
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Riapri', handler: () => {
            this.squadriglieService.cambiaStato(sq.id, true).subscribe({
              next: () => {
                this.avvisa(`${sq.nome} è di nuovo tra le attive.`);
                this.caricaSquadriglie();
              },
              error: (err: HttpErrorResponse) =>
                this.avvisa(err.error?.error ?? 'Non sono riuscito a riaprirla.'),
            });
          },
        },
      ],
    });
    await alert.present();
  }

  /** L'indirizzo intero della foto, o null se non c'è ancora. */
  urlFoto(sq: Squadriglia): string | null {
    return this.squadriglieService.urlFoto(sq);
  }

  /** L'iniziale che si vede al posto della foto, finché nessuno l'ha caricata. */
  iniziale(sq: Squadriglia): string {
    return sq.nome.trim().charAt(0).toUpperCase();
  }

  /**
   * La foto dell'animale scelta da un capo reparto: si rimpicciolisce qui nel browser,
   * così parte leggera.
   */
  async scegliFoto(evento: Event, sq: Squadriglia) {
    const input = evento.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const immagine = await preparaImmagine(file, { latoMax: 700 });
      this.squadriglieService.cambiaFoto(sq.id, immagine).subscribe({
        next: () => {
          this.avvisa(`Foto di ${sq.nome} salvata.`);
          this.caricaSquadriglie();
        },
        error: (err: HttpErrorResponse) =>
          this.avvisa(err.error?.error ?? 'Non sono riuscito a salvare la foto.'),
      });
    } catch (e) {
      this.avvisa(e instanceof Error ? e.message : 'Questa foto non si riesce a leggere.');
    }
  }

  async confermaRimuoviFoto(sq: Squadriglia) {
    const alert = await this.alertCtrl.create({
      header: `Togliere la foto di ${sq.nome}?`,
      message: 'Al suo posto torna l\'iniziale del nome. La squadriglia resta.',
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Rimuovi la foto', role: 'destructive', handler: () => {
            this.squadriglieService.rimuoviFoto(sq.id).subscribe({
              next: () => this.caricaSquadriglie(),
              error: (err: HttpErrorResponse) =>
                this.avvisa(err.error?.error ?? 'Non sono riuscito a rimuoverla.'),
            });
          },
        },
      ],
    });
    await alert.present();
  }

  // ---------- Guidoncini in vetta ----------

  caricaGuidoncini() {
    this.caricamentoGuidoncini = true;
    this.guidonciniService.tutti().subscribe({
      next: dati => {
        this.specialita = dati.specialita;
        this.guidoncini = dati.guidoncini;
        this.annoCorrente = dati.annoCorrente;
        // Il modulo parte dall'anno scout appena passato (o da quello in corso, a
        // primavera): di solito è quello di cui si segna la conquista.
        if (!this.nuovo.anno) this.nuovo.anno = Math.min(new Date().getFullYear() - 1, dati.annoCorrente);
        this.caricamentoGuidoncini = false;
        this.erroreGuidoncini = '';
      },
      error: (err: HttpErrorResponse) => {
        this.caricamentoGuidoncini = false;
        this.erroreGuidoncini = err.status === 404
          ? 'Il server non conosce ancora i guidoncini: va riavviato il backend.'
          : 'Non riesco a caricare i guidoncini. Riprova tra poco.';
      },
    });
  }

  iconaSpecialita(chiave: string): string {
    return ICONE_SPECIALITA[chiave] ?? this.icone.guidoncini;
  }

  nomeSpecialita(chiave: string): string {
    return this.specialita.find(s => s.chiave === chiave)?.nome ?? chiave;
  }

  nomeAnno(anno: number): string {
    return nomeAnnoScout(anno);
  }

  /** Tutte le squadriglie, attive e chiuse: anche quelle di una volta hanno la loro storia. */
  get tutteLeSquadriglie(): Squadriglia[] {
    return [...this.squadriglie, ...this.squadriglieChiuse];
  }

  squadrigliaDi(g: Guidoncino): Squadriglia | undefined {
    return this.tutteLeSquadriglie.find(sq => sq.id === g.squadriglia_id);
  }

  /** Il guidoncino si porta l'anno scout dopo la conquista, e un altro ancora se è confermato. */
  sulGuidone(g: Guidoncino): boolean {
    const distanza = this.annoCorrente - g.anno;
    return distanza === 1 || (g.confermata && distanza === 2);
  }

  /** I guidoncini che quest'anno stanno appesi sotto le bandierine. */
  get inVetta(): Guidoncino[] {
    return this.guidoncini.filter(g => this.sulGuidone(g) && this.squadrigliaDi(g));
  }

  /** Quante volte il Reparto ha conquistato ogni specialità. */
  conquisteDi(chiave: string): Guidoncino[] {
    return this.guidoncini.filter(g => g.specialita === chiave);
  }

  get specialitaScelta(): SpecialitaSquadriglia | undefined {
    return this.specialita.find(s => s.chiave === this.specialitaAperta);
  }

  alternaSpecialita(chiave: string) {
    this.specialitaAperta = this.specialitaAperta === chiave ? null : chiave;
  }

  /**
   * Il palmarès: prima le squadriglie di adesso (anche senza guidoncini, così si vede
   * cosa manca), poi quelle chiuse che ne hanno conquistato almeno uno.
   */
  get palmares(): Palmares[] {
    const di = (sq: Squadriglia) => this.guidoncini.filter(g => g.squadriglia_id === sq.id);
    return [
      ...this.squadriglie.map(sq => ({ squadriglia: sq, guidoncini: di(sq) })),
      ...this.squadriglieChiuse
        .map(sq => ({ squadriglia: sq, guidoncini: di(sq) }))
        .filter(p => p.guidoncini.length),
    ];
  }

  /** Gli anni scout che si possono scegliere nel modulo, dal più recente. */
  get anniScelta(): number[] {
    const anni: number[] = [];
    for (let a = this.annoCorrente; a >= 1975; a--) anni.push(a);
    return anni;
  }

  segnaGuidoncino() {
    const { squadriglia_id, specialita, anno } = this.nuovo;
    if (!squadriglia_id || !specialita || !anno) {
      this.avvisa('Scegli squadriglia, specialità e anno.');
      return;
    }
    this.salvataggioGuidoncino = true;
    this.guidonciniService.segna({ squadriglia_id: Number(squadriglia_id), specialita, anno: Number(anno) }).subscribe({
      next: g => {
        this.salvataggioGuidoncino = false;
        const sq = this.squadrigliaDi(g);
        this.avvisa(`Guidoncino di ${this.nomeSpecialita(g.specialita)} a ${sq?.nome ?? 'la squadriglia'}!`);
        this.nuovo = { squadriglia_id: 0, specialita: '', anno: this.nuovo.anno };
        this.caricaGuidoncini();
      },
      error: (err: HttpErrorResponse) => {
        this.salvataggioGuidoncino = false;
        this.avvisa(err.error?.error ?? 'Non sono riuscito a segnarlo.');
      },
    });
  }

  /** Per i capi reparto: toccando un guidoncino lo si conferma per un altro anno o lo si toglie. */
  async gestisciGuidoncino(g: Guidoncino) {
    if (!this.puoGestire) return;
    const sq = this.squadrigliaDi(g);
    const alert = await this.alertCtrl.create({
      header: `${sq?.nome ?? 'Squadriglia'} · ${this.nomeSpecialita(g.specialita)}`,
      message: g.confermata
        ? `Conquistato nel ${this.nomeAnno(g.anno)} e confermato l'anno dopo.`
        : `Conquistato nel ${this.nomeAnno(g.anno)}. Se l'anno dopo la squadriglia fa una nuova impresa affine, lo si conferma per un altro anno.`,
      buttons: [
        { text: g.confermata ? 'Togli la conferma' : 'Confermato per un altro anno', role: 'conferma' },
        { text: 'Togli il guidoncino', role: 'destructive' },
        { text: 'Annulla', role: 'cancel' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role === 'conferma') {
      this.guidonciniService.conferma(g.id, !g.confermata).subscribe({
        next: () => this.caricaGuidoncini(),
        error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Non sono riuscito a cambiarlo.'),
      });
    } else if (role === 'destructive') {
      this.guidonciniService.togli(g.id).subscribe({
        next: () => {
          this.avvisa('Guidoncino tolto.');
          this.caricaGuidoncini();
        },
        error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Non sono riuscito a toglierlo.'),
      });
    }
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 2400, position: 'top' });
    await toast.present();
  }

  private dallAncora(ancora: string | null) {
    if (!ancora) return;
    const trovata = this.sezioni.find(s => s.chiave === ancora);
    if (trovata) this.sezioneAttiva = trovata.chiave;
  }

  apriSezione(chiave: Sezione) {
    this.sezioneAttiva = chiave;
    this.pilastroAperto = null;
    this.storicheAperte = false;
    this.specialitaAperta = null;
  }

  /** Dove sta la pastiglia che scivola sotto la voce scelta. */
  get posizionePastiglia(): number {
    return this.sezioni.findIndex(s => s.chiave === this.sezioneAttiva);
  }

  alternaStoriche() {
    this.storicheAperte = !this.storicheAperte;
  }

  alternaPilastro(chiave: string) {
    this.pilastroAperto = this.pilastroAperto === chiave ? null : chiave;
  }
}
