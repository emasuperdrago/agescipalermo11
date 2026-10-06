import { Component, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
  IonRouterLinkWithHref, IonContent, ToastController
} from '@ionic/angular/standalone';
import { archiveOutline, arrowBackOutline, arrowUndoOutline, chevronForwardOutline, flag } from 'ionicons/icons';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { AuthService } from '../services/auth';
import { ETICHETTE_POST, PostService, nomeEtichetta } from '../services/post';
import { EtichettaPost, Post } from '../../types/models';

/** I post di un anno, già in ordine dal più recente. */
interface AnnoDiPost {
  anno: number;
  post: Post[];
}

/**
 * Archivio dei post: ci finiscono i più vecchi quando la home supera i 50,
 * e quelli che un capo mette da parte a mano. Sono divisi per anno, dal più recente.
 */
@Component({
  selector: 'app-archivio',
  templateUrl: './archivio.page.html',
  styleUrls: ['./archivio.page.scss'],
  standalone: true,
  imports: [
    RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent,
  ],
})
export class ArchivioPage {
  readonly icone = {
    indietro: arrowBackOutline, archivio: archiveOutline, ripristina: arrowUndoOutline,
    apri: chevronForwardOutline, evidenza: flag,
  };
  readonly nomeEtichetta = nomeEtichetta;
  readonly etichette = ETICHETTE_POST;

  private auth = inject(AuthService);
  private posts = inject(PostService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);

  anni: AnnoDiPost[] = [];
  quanti = 0;
  /** Tutti i post dell'archivio: il filtro per branca lavora su questi, senza richiamare il server. */
  private tutti: Post[] = [];
  etichetta: EtichettaPost | null = null;
  caricamento = true;
  errore = '';

  ionViewWillEnter() {
    this.carica();
  }

  /** Solo capi e admin riportano un post nella home. */
  get puoGestire(): boolean {
    const ruolo = this.auth.utente?.ruolo;
    return ruolo === 'capo' || ruolo === 'admin';
  }

  urlFoto(post: Post): string {
    return this.posts.urlFoto(post);
  }

  carica() {
    this.caricamento = true;
    this.posts.archivio().subscribe({
      next: dati => {
        this.tutti = dati.post;
        this.mostra();
        this.caricamento = false;
        this.errore = '';
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.errore = err.status === 404
          ? "Il server non gestisce ancora l'archivio: va riavviato il backend."
          : "Impossibile caricare l'archivio. Riprova tra poco.";
      },
    });
  }

  /** Sceglie la branca da vedere; ritoccando la stessa si torna a tutte. */
  filtra(etichetta: EtichettaPost | null) {
    this.etichetta = this.etichetta === etichetta ? null : etichetta;
    this.mostra();
  }

  /** Rifà i gruppi per anno tenendo conto del filtro. */
  private mostra() {
    const scelti = this.etichetta ? this.tutti.filter(p => p.etichetta === this.etichetta) : this.tutti;
    this.quanti = scelti.length;
    this.anni = this.dividiPerAnno(scelti);
  }

  /** I post arrivano già dal più recente: qui si spezzano in gruppi per anno. */
  private dividiPerAnno(post: Post[]): AnnoDiPost[] {
    const gruppi: AnnoDiPost[] = [];
    for (const p of post) {
      const anno = Number(p.data_creazione.slice(0, 4));
      const ultimo = gruppi[gruppi.length - 1];
      if (ultimo && ultimo.anno === anno) ultimo.post.push(p);
      else gruppi.push({ anno, post: [p] });
    }
    return gruppi;
  }

  /** Data scritta come si dice: 3 settembre 2026. */
  dataPerEsteso(data: string): string {
    const giorno = new Date(data);
    return isNaN(giorno.getTime()) ? '' :
      giorno.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  /** Riporta un post nella home: se là ci sono già 50 post, il server dice di no. */
  riporta(post: Post) {
    this.posts.archivia(post.id, false).subscribe({
      next: () => {
        this.avvisa(`"${post.didascalia}" è tornato nella home.`);
        this.carica();
      },
      error: async (err: HttpErrorResponse) => {
        const messaggio = err.error?.error ?? 'Non sono riuscito a riportarlo nella home.';
        const alert = await this.alertCtrl.create({
          header: 'Home piena',
          message: messaggio,
          buttons: ['Va bene'],
        });
        await alert.present();
      },
    });
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 2000, position: 'top' });
    await toast.present();
  }
}
