import { Component, HostListener, OnInit, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref, IonContent
} from '@ionic/angular/standalone';
import { arrowBackOutline, calendarOutline, chevronBackOutline, chevronForwardOutline, flag } from 'ionicons/icons';
import { PostService, nomeEtichetta, videoIncorporato } from '../services/post';
import { Post } from '../../types/models';

@Component({
  selector: 'app-dettaglio-post',
  templateUrl: './dettaglio-post.page.html',
  styleUrls: ['./dettaglio-post.page.scss'],
  standalone: true,
  imports: [
    RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref, IonContent,
  ],
})
export class DettaglioPostPage implements OnInit {
  readonly icone = {
    indietro: arrowBackOutline, data: calendarOutline, evidenza: flag,
    prima: chevronBackOutline, dopo: chevronForwardOutline,
  };

  /** La foto che si sta guardando, fra quelle del post. */
  fotoAttuale = 0;
  /**
   * I video di YouTube e Instagram, pronti per l'iframe. Gli indirizzi li costruiamo noi da
   * codici già controllati (vedi videoIncorporato), per questo si possono dichiarare sicuri.
   */
  videoEsterni: { sito: 'youtube' | 'instagram'; url: SafeResourceUrl; link: string }[] = [];
  private sanitizer = inject(DomSanitizer);
  private inizioTocco: number | null = null;

  post: Post | null = null;
  caricamento = true;
  errore = '';

  constructor(private route: ActivatedRoute, private posts: PostService) {}

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
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isInteger(id) || id <= 0) {
      this.caricamento = false;
      this.errore = 'Post non trovato.';
      return;
    }
    this.caricamento = true;
    this.errore = '';
    // Entrando in un post si riparte sempre dalla copertina.
    this.fotoAttuale = 0;
    this.posts.dettaglio(id).subscribe({
      next: post => {
        this.post = post;
        this.videoEsterni = (post.video_link ?? [])
          .map(videoIncorporato)
          .filter(v => !!v)
          .map(v => ({ sito: v!.sito, link: v!.link, url: this.sanitizer.bypassSecurityTrustResourceUrl(v!.incorpora) }));
        this.caricamento = false;
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.errore = err.status === 404 ? 'Post non trovato.'
          : err.status === 0 ? 'Server non raggiungibile. Riprova tra poco.'
          : 'Impossibile caricare il post.';
      },
    });
  }

  /** Tutte le foto del post, dalla copertina in poi. */
  get fotoTutte(): string[] {
    return this.post ? this.posts.urlFotoTutte(this.post) : [];
  }

  vaiAFoto(indice: number) {
    const quante = this.fotoTutte.length;
    if (!quante) return;
    this.fotoAttuale = (indice + quante) % quante;
  }

  /** Con un dito: trascinando verso sinistra la foto dopo, verso destra quella prima. */
  inizioScorrimento(evento: TouchEvent) {
    this.inizioTocco = evento.touches[0]?.clientX ?? null;
  }

  fineScorrimento(evento: TouchEvent) {
    if (this.inizioTocco === null) return;
    const spostamento = (evento.changedTouches[0]?.clientX ?? this.inizioTocco) - this.inizioTocco;
    this.inizioTocco = null;
    if (Math.abs(spostamento) > 40) this.vaiAFoto(this.fotoAttuale + (spostamento < 0 ? 1 : -1));
  }

  @HostListener('document:keydown', ['$event'])
  tastiera(evento: KeyboardEvent) {
    if (this.fotoTutte.length < 2) return;
    if (evento.key === 'ArrowLeft') this.vaiAFoto(this.fotoAttuale - 1);
    else if (evento.key === 'ArrowRight') this.vaiAFoto(this.fotoAttuale + 1);
  }

  /** L'indirizzo intero di un video caricato. */
  urlVideo(percorso: string): string {
    return this.posts.urlDaPercorso(percorso);
  }

  get urlFoto(): string {
    return this.fotoTutte[this.fotoAttuale] ?? (this.post ? this.posts.urlFoto(this.post) : '');
  }

  get etichetta(): string {
    return this.post ? nomeEtichetta(this.post.etichetta) : '';
  }

  /** Data di caricamento, es. "16 settembre 2026". */
  get data(): string {
    return this.post
      ? new Date(this.post.data_creazione).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
      : '';
  }
}
