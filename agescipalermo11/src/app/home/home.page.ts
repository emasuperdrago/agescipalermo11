import { Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  AlertController, IonContent, IonIcon, ModalController, NavController, ToastController
} from '@ionic/angular/standalone';
import {
  addOutline, archiveOutline, chevronDownOutline, chevronForwardOutline, closeOutline, flag, flagOutline,
  funnelOutline, imagesOutline, videocamOutline,
  logoFacebook, logoInstagram, menuOutline, pencilOutline, personAddOutline, personCircleOutline, trashOutline
} from 'ionicons/icons';
import { AuthService } from '../services/auth';
import { SfondiService } from '../services/sfondi';
import { ETICHETTE_POST, PostService, nomeEtichetta } from '../services/post';
import { NuovoPostComponent } from '../components/nuovo-post/nuovo-post.component';
import { AnteprimaPostComponent } from '../components/anteprima-post/anteprima-post.component';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { Branca, EtichettaPost, Post, Ruolo } from '../../types/models';

interface VoceMenu {
  etichetta: string;
  link: string;
  /** Sezione della pagina (ancora #...). */
  sezione?: string;
  /** Se presente, la voce è visibile solo a questi ruoli. */
  ruoli?: Ruolo[];
  /** Se presente, la voce è visibile solo a chi sta in una di queste branche. */
  branche?: Branca[];
}

interface MenuTendina {
  titolo: string;
  /** Dà il colore della sottolineatura al passaggio del cursore. */
  chiave: 'branco' | 'reparto' | 'clan' | 'capi' | 'chi-siamo';
  voci: VoceMenu[];
}

const MENU: MenuTendina[] = [
  {
    titolo: 'Branco',
    chiave: 'branco',
    voci: [
      { etichetta: 'Il Branco', link: '/branco' },
      { etichetta: 'Le Specialità', link: '/branco', sezione: 'specialita' },
      { etichetta: 'La Promessa', link: '/branco', sezione: 'promessa' },
    ],
  },
  {
    titolo: 'Reparto',
    chiave: 'reparto',
    voci: [
      { etichetta: 'Il Reparto', link: '/reparto' },
      { etichetta: 'Le Squadriglie', link: '/reparto', sezione: 'squadriglie' },
      { etichetta: 'Guidoncini in vetta', link: '/reparto', sezione: 'guidoncini' },
      { etichetta: 'Specialità e brevetti', link: '/reparto', sezione: 'specialita' },
      { etichetta: 'Promessa e Legge', link: '/reparto', sezione: 'promessa-e-legge' },
    ],
  },
  {
    titolo: 'Clan',
    chiave: 'clan',
    voci: [
      { etichetta: 'Il Clan', link: '/clan' },
      { etichetta: 'Carta di Clan', link: '/clan/carta-di-clan' },
      // La cassa di clan la vedono i capi clan e chi è del clan: rover, scolte e novizi.
      { etichetta: 'Cassa di clan', link: '/clan/cassa', branche: ['clan'] },
    ],
  },
  {
    titolo: 'Capi',
    chiave: 'capi',
    voci: [
      { etichetta: 'I nostri capi', link: '/capi' },
      { etichetta: 'PEG', link: '/peg' },
      { etichetta: 'Staff e capi gruppo', link: '/capi-gruppo', ruoli: ['admin'] },
      { etichetta: 'Codici censimento', link: '/gestione-censiti', ruoli: ['capo', 'admin'] },
    ],
  },
  {
    titolo: 'Chi siamo?',
    chiave: 'chi-siamo',
    voci: [
      { etichetta: 'La nostra storia', link: '/storia' },
      { etichetta: 'Marco, "Orso Giocoso"', link: '/marco' },
      { etichetta: 'Dove siamo', link: '/dove-siamo' },
      { etichetta: 'Link utili', link: '/link-utili' },
      { etichetta: 'Archivio', link: '/archivio' },
      { etichetta: 'Richiesta di iscrizione', link: '/richiesta-iscrizione' },
    ],
  },
];

/** Su computer le tendine si aprono anche passando col mouse. */
const HOVER_DESKTOP = '(hover: hover) and (min-width: 992px)';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, IonContent, IonIcon, BarraInferioreComponent],
})
export class HomePage implements OnDestroy, OnInit {
  readonly menu = MENU;
  tendinaAperta: string | null = null;
  menuMobileAperto = false;

  /** Barra in alto che compare quando il logo della testata non si vede più. */
  barraFissaVisibile = false;
  menuFissoAperto = false;

  /** Post di "Ultime dal gruppo": prima quelli in evidenza, poi dal più recente. */
  post: Post[] = [];
  caricamentoPost = true;
  erroreCaricamentoPost = '';
  /** Ci sono altri post da caricare con "Vedi altro". */
  altriPost = false;
  /** Post proposti dai ragazzi del clan che aspettano il sì dei capi. */
  inAttesa: Post[] = [];
  /** Vero per i capi clan e i capigruppo: possono dire sì o no. */
  puoApprovare = false;
  caricandoAltri = false;

  readonly etichette = ETICHETTE_POST;
  readonly nomeEtichetta = nomeEtichetta;
  filtroEtichetta: EtichettaPost | null = null;
  filtroAperto = false;
  /** Filtro per hashtag (senza "#"), e gli hashtag più usati da proporre. */
  filtroHashtag: string | null = null;
  hashtagPopolari: { hashtag: string; quanti: number }[] = [];

  @ViewChild('logo') private logo?: ElementRef<HTMLImageElement>;
  @ViewChild(IonContent) private contenuto?: IonContent;

  // Le icone si passano come dati: ionicons è installato in due versioni diverse
  // (quella di Ionic e quella del progetto), quindi registrarle per nome non funziona.
  /** Foto che scorrono nello sfondo dell'apertura, e quella che si vede adesso. */
  sfondi: string[] = [];
  sfondoAttuale = 0;
  private giostra?: ReturnType<typeof setInterval>;

  readonly icone = {
    menu: menuOutline,
    chiudi: closeOutline,
    freccia: chevronDownOutline,
    aggiungi: addOutline,
    filtro: funnelOutline,
    evidenza: flag,
    evidenzaVuota: flagOutline,
    modifica: pencilOutline,
    elimina: trashOutline,
    instagram: logoInstagram,
    facebook: logoFacebook,
    profilo: personCircleOutline,
    iscriviti: personAddOutline,
    apri: chevronForwardOutline,
    archivia: archiveOutline,
    foto: imagesOutline,
    video: videocamOutline,
  };

  /** Le pagine del gruppo sui social: nel menu e nel piè di pagina. */
  readonly instagram = 'https://www.instagram.com/agesci_palermo11/';
  readonly facebook = 'https://www.facebook.com/grupposcoutagescipalermo11/?locale=it_IT';

  /** Collegamenti del piè di pagina, divisi per colonna. */
  readonly piedeColonne = [
    {
      titolo: 'Il gruppo',
      voci: [
        { etichetta: 'Il Branco', link: '/branco' },
        { etichetta: 'Il Reparto', link: '/reparto' },
        { etichetta: 'Il Clan', link: '/clan' },
        { etichetta: 'I nostri capi', link: '/capi' },
        { etichetta: 'Il PEG', link: '/peg' },
      ],
    },
    {
      titolo: 'Da leggere',
      voci: [
        { etichetta: 'La nostra storia', link: '/storia' },
        { etichetta: 'Marco, "Orso Giocoso"', link: '/marco' },
        { etichetta: 'Canzoniere', link: '/canzoniere' },
        { etichetta: 'Link utili', link: '/link-utili' },
        { etichetta: 'Archivio dei post', link: '/archivio' },
      ],
    },
  ] as const;

  /** L'anno da scrivere in fondo: cambia da sé a Capodanno. */
  readonly annoCorrente = new Date().getFullYear();

  constructor(
    private auth: AuthService,
    private navCtrl: NavController,
    private toastCtrl: ToastController,
    private zone: NgZone,
    private posts: PostService,
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private sfondiService: SfondiService,
    private route: ActivatedRoute,
  ) {}

  /** Solo capi e admin pubblicano post direttamente; tutti gli altri li leggono. */
  get puoPubblicare(): boolean {
    const ruolo = this.auth.utente?.ruolo;
    return ruolo === 'capo' || ruolo === 'admin';
  }

  /** I ragazzi del clan preparano un post e lo mandano ai capi clan per il sì. */
  get puoProporre(): boolean {
    const utente = this.auth.utente;
    return !!utente && utente.ruolo === 'ragazzo' && utente.branca === 'clan';
  }

  /** Chi può scrivere un post, in un modo o nell'altro. */
  get puoScrivere(): boolean {
    return this.puoPubblicare || this.puoProporre;
  }

  /** Capi e admin: nel menu trovano "Profilo" invece di "Esci", che sta dentro il profilo. */
  get eCapo(): boolean {
    return this.puoPubblicare;
  }

  urlFoto(post: Post): string {
    return this.posts.urlFoto(post);
  }

  /** Ricarica la prima pagina (12 post) con il filtro attuale. */
  caricaPost() {
    this.caricamentoPost = true;
    this.erroreCaricamentoPost = '';
    this.posts.elenco(0, this.filtroEtichetta, undefined, this.filtroHashtag).subscribe({
      next: pagina => {
        this.post = pagina.post;
        this.altriPost = pagina.altri;
        this.caricamentoPost = false;
      },
      error: (err: HttpErrorResponse) => {
        this.caricamentoPost = false;
        this.erroreCaricamentoPost = err.status === 404
          ? 'Il server non gestisce ancora i post: va riavviato il backend.'
          : 'Impossibile caricare i post. Riprova tra poco.';
      },
    });
  }

  /** Carica i prossimi post (fino a 12) dopo quelli già mostrati. */
  vediAltro() {
    this.caricandoAltri = true;
    this.posts.elenco(this.post.length, this.filtroEtichetta, undefined, this.filtroHashtag).subscribe({
      next: pagina => {
        // Un post pubblicato nel frattempo sposta gli altri di una posizione: niente doppioni.
        const giaMostrati = new Set(this.post.map(p => p.id));
        this.post = [...this.post, ...pagina.post.filter(p => !giaMostrati.has(p.id))];
        this.altriPost = pagina.altri;
        this.caricandoAltri = false;
      },
      error: () => {
        this.caricandoAltri = false;
        this.avvisa('Impossibile caricare altri post. Riprova.');
      },
    });
  }

  alternaFiltro(evento: Event) {
    evento.stopPropagation();
    this.filtroAperto = !this.filtroAperto;
  }

  /** L'hashtag scelto non è fra i più usati (es. arrivando da un post): si mostra lo stesso. */
  get hashtagFuoriElenco(): boolean {
    return !!this.filtroHashtag && !this.hashtagPopolari.some(h => h.hashtag === this.filtroHashtag);
  }

  /** Tocca un hashtag: si vedono solo i post che ce l'hanno; ritoccarlo toglie il filtro. */
  scegliHashtag(hashtag: string | null) {
    this.filtroHashtag = this.filtroHashtag === hashtag ? null : hashtag;
    this.caricaPost();
  }

  private caricaHashtag() {
    this.posts.hashtag().subscribe({
      next: elenco => this.hashtagPopolari = elenco,
      error: () => this.hashtagPopolari = [],
    });
  }

  scegliFiltro(etichetta: EtichettaPost | null) {
    this.filtroAperto = false;
    if (etichetta === this.filtroEtichetta) return;
    this.filtroEtichetta = etichetta;
    this.caricaPost();
  }

  /** Apre il pop-up per creare un post o, se riceve un post, per modificarlo. */
  async apriEditor(post?: Post) {
    this.chiudiMenu();
    const modale = await this.modalCtrl.create({ component: NuovoPostComponent, componentProps: { post } });
    await modale.present();
    const { data, role } = await modale.onDidDismiss<Post>();
    if (!data || (role !== 'pubblicato' && role !== 'modificato')) return;

    // Il post di un rover non va subito in home: prima lo leggono i capi clan.
    if (data.in_attesa) {
      this.caricaInAttesa();
      this.avvisa(role === 'pubblicato'
        ? 'Post mandato ai capi clan: lo pubblicano loro dopo averlo letto.'
        : 'Modifiche salvate: il post aspetta ancora il sì dei capi.');
      return;
    }

    const altri = this.post.filter(p => p.id !== data.id);
    // Se il post non rispetta più il filtro attivo, sparisce dall'elenco.
    this.post = this.ordina(this.rispettaFiltro(data) ? [data, ...altri] : altri);
    this.avvisa(role === 'pubblicato' ? 'Post pubblicato!' : 'Modifiche salvate.');
  }

  async confermaElimina(post: Post) {
    const alert = await this.alertCtrl.create({
      header: 'Eliminare il post?',
      message: `"${post.didascalia}" verrà eliminato insieme alla sua foto. Non si può annullare.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        { text: 'Elimina', role: 'destructive', handler: () => this.elimina(post) },
      ],
    });
    await alert.present();
  }

  private elimina(post: Post) {
    this.posts.elimina(post.id).subscribe({
      next: () => {
        this.togliDallaLista(post);
        this.avvisa('Post eliminato.');
      },
      error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Eliminazione non riuscita. Riprova.'),
    });
  }

  /**
   * Toglie un post dalla lista e, se ce n'erano altri dietro a "Vedi altro",
   * tira su subito quello che segue: il buco si richiude da solo, senza ricaricare la pagina.
   */
  private togliDallaLista(post: Post) {
    this.post = this.post.filter(p => p.id !== post.id);
    if (!this.altriPost) return;

    this.posts.elenco(this.post.length, this.filtroEtichetta, 1, this.filtroHashtag).subscribe({
      next: pagina => {
        const giaMostrati = new Set(this.post.map(p => p.id));
        this.post = [...this.post, ...pagina.post.filter(p => !giaMostrati.has(p.id))];
        this.altriPost = pagina.altri;
      },
      // Se il server non risponde resta solo il buco: si riempie al prossimo "Vedi altro".
      error: () => {},
    });
  }

  alternaEvidenza(post: Post) {
    const inEvidenza = !post.in_evidenza;
    this.posts.impostaEvidenza(post.id, inEvidenza).subscribe({
      next: aggiornato => {
        this.post = this.ordina(this.post.map(p => (p.id === aggiornato.id ? aggiornato : p)));
        this.avvisa(inEvidenza ? 'Post messo in evidenza.' : 'Post tolto dall’evidenza.');
      },
      error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Operazione non riuscita. Riprova.'),
    });
  }

  private rispettaFiltro(post: Post): boolean {
    return (!this.filtroEtichetta || post.etichetta === this.filtroEtichetta)
      && (!this.filtroHashtag || (post.hashtag ?? []).includes(this.filtroHashtag));
  }

  /** Stesso ordine del server: in evidenza per primi, poi dal più recente. */
  private ordina(post: Post[]): Post[] {
    return [...post].sort((a, b) =>
      Number(b.in_evidenza) - Number(a.in_evidenza)
      || b.data_creazione.localeCompare(a.data_creazione)
      || b.id - a.id);
  }

  /** Mette un post in archivio: esce dalla home e si ritrova nella pagina Archivio. */
  async confermaArchivia(post: Post) {
    const alert = await this.alertCtrl.create({
      header: 'Mettere il post in archivio?',
      message: `"${post.didascalia}" esce dalla home e si ritrova nell'Archivio, `
        + 'diviso per anno. Da lì un capo può riportarlo indietro.',
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Archivia', handler: () => {
            this.posts.archivia(post.id, true).subscribe({
              next: () => {
                this.togliDallaLista(post);
                this.avvisa('Post messo in archivio.');
              },
              error: () => this.avvisa('Non sono riuscito ad archiviare il post.'),
            });
          }
        },
      ],
    });
    await alert.present();
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 1800, position: 'top' });
    await toast.present();
  }

  vociVisibili(menu: MenuTendina): VoceMenu[] {
    const utente = this.auth.utente;
    const ruolo = utente?.ruolo;
    const branca = utente && utente.ruolo !== 'visitatore' ? utente.branca : null;
    return menu.voci.filter(v => {
      if (v.ruoli && (!ruolo || !v.ruoli.includes(ruolo))) return false;
      if (v.branche && (!branca || !v.branche.includes(branca))) return false;
      return true;
    });
  }

  alternaTendina(titolo: string, evento: Event) {
    evento.stopPropagation();
    this.tendinaAperta = this.tendinaAperta === titolo ? null : titolo;
  }

  apriSuDesktop(titolo: string) {
    if (window.matchMedia(HOVER_DESKTOP).matches) this.tendinaAperta = titolo;
  }

  chiudiSuDesktop(titolo: string) {
    if (window.matchMedia(HOVER_DESKTOP).matches && this.tendinaAperta === titolo) this.tendinaAperta = null;
  }

  alternaMenuMobile(evento: Event) {
    evento.stopPropagation();
    this.menuMobileAperto = !this.menuMobileAperto;
    if (!this.menuMobileAperto) this.tendinaAperta = null;
  }

  alternaMenuFisso(evento: Event) {
    evento.stopPropagation();
    this.menuFissoAperto = !this.menuFissoAperto;
    if (!this.menuFissoAperto) this.tendinaAperta = null;
  }

  chiudiMenu() {
    this.tendinaAperta = null;
    this.menuMobileAperto = false;
    this.menuFissoAperto = false;
  }

  alloScorrimento() {
    const fondoLogo = this.logo?.nativeElement.getBoundingClientRect().bottom ?? 1;
    const visibile = fondoLogo <= 0;
    if (visibile === this.barraFissaVisibile) return;
    // Ionic invia ionScroll fuori dalla zona di Angular (per non rallentare lo scorrimento):
    // si rientra solo quando lo stato cambia, così la pagina si aggiorna.
    this.zone.run(() => {
      this.barraFissaVisibile = visibile;
      // Passando da una barra all'altra si chiudono i menu rimasti aperti.
      this.chiudiMenu();
    });
  }

  tornaSu() {
    this.chiudiMenu();
    this.contenuto?.scrollToTop(400);
  }

  @HostListener('document:click', ['$event'])
  clicFuori(evento: MouseEvent) {
    const bersaglio = evento.target as HTMLElement | null;
    if (!bersaglio?.closest('.testata, .barra-fissa')) this.chiudiMenu();
    if (!bersaglio?.closest('.filtro')) this.filtroAperto = false;
  }

  @HostListener('document:keydown.escape')
  chiudiConEsc() {
    this.chiudiMenu();
    this.filtroAperto = false;
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
    // Arrivando da un hashtag toccato in un post (/home?hashtag=…) si filtra subito per quello.
    const daLink = this.route.snapshot.queryParamMap.get('hashtag');
    if (daLink) this.filtroHashtag = daLink;
    this.caricaHashtag();
    this.caricaPost();
    this.caricaSfondi();
    this.caricaInAttesa();
  }

  /** I post che aspettano il sì: i propri per un rover, tutti per un capo clan. */
  private caricaInAttesa() {
    if (!this.puoScrivere && this.auth.utente?.ruolo !== 'admin') {
      this.inAttesa = [];
      return;
    }
    this.posts.inAttesa().subscribe({
      next: dati => {
        this.inAttesa = dati.post;
        this.puoApprovare = dati.puoApprovare;
      },
      error: () => this.inAttesa = [],
    });
  }

  /**
   * Apre l'anteprima di un post proposto: si legge com'è venuto e si decide da lì.
   * Chi approva trova "Pubblica" e "Rifiuta", l'autore "Modifica" e "Ritira".
   */
  async apriAnteprima(post: Post) {
    const modale = await this.modalCtrl.create({
      component: AnteprimaPostComponent,
      componentProps: { post, puoApprovare: this.puoApprovare, eMio: !this.puoApprovare },
    });
    await modale.present();
    const { role } = await modale.onDidDismiss<Post>();
    if (role === 'pubblica') this.decidi(post, true);
    else if (role === 'rifiuta') this.decidi(post, false);
    else if (role === 'modifica') this.apriEditor(post);
    else if (role === 'ritira') this.confermaRitira(post);
  }

  /** Il sì o il no di un capo clan (o capogruppo) su un post proposto. */
  decidi(post: Post, approva: boolean) {
    this.posts.decidiPubblicazione(post.id, approva).subscribe({
      next: () => {
        this.inAttesa = this.inAttesa.filter(p => p.id !== post.id);
        this.avvisa(approva ? 'Post pubblicato nella home.' : 'Post rifiutato ed eliminato.');
        if (approva) this.caricaPost();
      },
      error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Non sono riuscito a salvare la decisione.'),
    });
  }

  /** Il rover può buttare il proprio post finché aspetta il sì. */
  async confermaRitira(post: Post) {
    const alert = await this.alertCtrl.create({
      header: 'Ritirare il post?',
      message: `"${post.didascalia}" e la sua foto verranno eliminati. Potrai sempre rifarlo.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Ritira', role: 'destructive', handler: () => {
            this.posts.elimina(post.id).subscribe({
              next: () => {
                this.inAttesa = this.inAttesa.filter(p => p.id !== post.id);
                this.avvisa('Post ritirato.');
              },
              error: () => this.avvisa('Non sono riuscito a ritirarlo.'),
            });
          }
        },
      ],
    });
    await alert.present();
  }

  ionViewWillLeave() {
    this.chiudiMenu();
    this.filtroAperto = false;
    this.fermaGiostra();
  }

  ngOnDestroy() {
    this.fermaGiostra();
  }

  // ---------- Foto che scorrono nell'apertura ----------

  /** Le foto le cambiano i capi: qui si prendono come stanno adesso. */
  /** Le foto già chieste al server (indici in `sfondi`). */
  scaricate = new Set<number>();

  private caricaSfondi() {
    this.sfondiService.elenco().subscribe({
      next: sfondi => {
        this.sfondi = sfondi.map(s => this.sfondiService.urlIntero(s.url));
        this.sfondoAttuale = 0;
        // Si scarica la foto che si vede e la prossima; le altre arrivano una alla volta,
        // un giro prima di comparire: così la prima non aspetta tutte le altre.
        this.scaricate = new Set([0, 1]);
        this.avviaGiostra();
      },
      // Se il server non risponde resta la foto fissa dello sfondo: la home si vede lo stesso.
      error: () => this.sfondi = [],
    });
  }

  private avviaGiostra() {
    this.fermaGiostra();
    if (this.sfondi.length < 2) return;
    // Chi ha chiesto meno animazioni vede solo la prima foto, ferma.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    // Fuori da Angular: è un timer che gira sempre, non deve far ridisegnare tutta la pagina.
    this.zone.runOutsideAngular(() => {
      this.giostra = setInterval(() => {
        this.zone.run(() => {
          this.sfondoAttuale = (this.sfondoAttuale + 1) % this.sfondi.length;
          this.scaricate.add((this.sfondoAttuale + 1) % this.sfondi.length);
        });
      }, this.sfondiService.durata);
    });
  }

  private fermaGiostra() {
    if (this.giostra) clearInterval(this.giostra);
    this.giostra = undefined;
  }

  esci() {
    this.chiudiMenu();
    this.auth.esci();
    this.navCtrl.navigateRoot('/benvenuto', { replaceUrl: true });
  }
}
