import { Component, OnInit, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
  IonRouterLinkWithHref, IonContent, ToastController
} from '@ionic/angular/standalone';
import {
  addOutline, arrowBackOutline, arrowDownOutline, arrowUpOutline, checkmarkOutline, compassOutline, linkOutline,
  pawOutline, peopleOutline, pencilOutline, trailSignOutline, trashOutline
} from 'ionicons/icons';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { LinkUtiliService } from '../services/link-utili';
import { stiliBranca } from '../services/posti';
import { LinkUtile, SezioneLink } from '../../types/models';

/** Il modulo aperto in una sezione: un link nuovo (id null) o uno da cambiare. */
interface Modulo {
  sezione: SezioneLink;
  id: number | null;
  titolo: string;
  url: string;
  errore: string;
}

/**
 * "Link utili", in Chi siamo: quattro sezioni (branco, reparto, clan, capi) con titolo e
 * indirizzo. Le vedono tutti; i capi le cambiano direttamente qui con "Modifica la pagina".
 */
@Component({
  selector: 'app-link-utili',
  templateUrl: './link-utili.page.html',
  styleUrls: ['./link-utili.page.scss'],
  standalone: true,
  imports: [
    NgTemplateOutlet, FormsModule, RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent,
  ],
})
export class LinkUtiliPage implements OnInit {
  readonly icone = {
    indietro: arrowBackOutline, modifica: pencilOutline, fatto: checkmarkOutline, aggiungi: addOutline,
    link: linkOutline, su: arrowUpOutline, giu: arrowDownOutline, togli: trashOutline,
  };
  readonly sezioni: { valore: SezioneLink; nome: string; icona: string; stile: Record<string, string> }[] = [
    { valore: 'branco', nome: 'Branco', icona: pawOutline, stile: stiliBranca('branco') },
    { valore: 'reparto', nome: 'Reparto', icona: compassOutline, stile: stiliBranca('reparto') },
    { valore: 'clan', nome: 'Clan', icona: trailSignOutline, stile: stiliBranca('clan') },
    { valore: 'capi', nome: 'Capi', icona: peopleOutline, stile: stiliBranca('gruppo') },
  ];

  link: Record<SezioneLink, LinkUtile[]> = { branco: [], reparto: [], clan: [], capi: [] };
  puoGestire = false;
  caricamento = true;
  errore = '';
  inModifica = false;
  occupato = false;
  modulo: Modulo | null = null;

  private servizio = inject(LinkUtiliService);
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
    this.servizio.tutti().subscribe({
      next: dati => {
        this.link = dati.sezioni;
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
          : 'Non riesco a caricare i link. Riprova tra poco.';
      },
    });
  }

  /** "www.agesci.it": solo il sito, per far capire dove porta il link. */
  dominio(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  alternaModifica() {
    this.inModifica = !this.inModifica;
    this.modulo = null;
  }

  nuovo(sezione: SezioneLink) {
    this.modulo = { sezione, id: null, titolo: '', url: '', errore: '' };
  }

  cambia(link: LinkUtile) {
    this.modulo = { sezione: link.sezione, id: link.id, titolo: link.titolo, url: link.url, errore: '' };
  }

  annulla() {
    this.modulo = null;
  }

  salva() {
    const m = this.modulo;
    if (!m) return;
    if (!m.titolo.trim()) {
      m.errore = 'Scrivi il titolo del link.';
      return;
    }
    if (!m.url.trim()) {
      m.errore = "Scrivi l'indirizzo, es. https://www.agesci.it";
      return;
    }
    this.occupato = true;
    const richiesta = m.id === null
      ? this.servizio.aggiungi(m.sezione, m.titolo.trim(), m.url.trim())
      : this.servizio.aggiorna(m.id, m.titolo.trim(), m.url.trim());
    richiesta.subscribe({
      next: () => {
        this.occupato = false;
        this.avvisa(m.id === null ? 'Link aggiunto.' : 'Link aggiornato.');
        this.modulo = null;
        this.carica();
      },
      error: (err: HttpErrorResponse) => {
        this.occupato = false;
        m.errore = err.status === 0 ? 'Server non raggiungibile. Riprova tra poco.'
          : err.error?.error ?? 'Non sono riuscito a salvarlo. Riprova.';
      },
    });
  }

  sposta(link: LinkUtile, verso: 'su' | 'giu') {
    this.occupato = true;
    this.servizio.sposta(link.id, verso).subscribe({
      next: () => {
        this.occupato = false;
        this.carica();
      },
      error: (err: HttpErrorResponse) => {
        this.occupato = false;
        this.avvisa(err.error?.error ?? 'Non sono riuscito a spostarlo.');
      },
    });
  }

  async togli(link: LinkUtile) {
    const alert = await this.alertCtrl.create({
      header: 'Togliere questo link?',
      message: `"${link.titolo}" sparisce dalla pagina per tutti.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        { text: 'Togli', role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') return;
    this.occupato = true;
    this.servizio.togli(link.id).subscribe({
      next: () => {
        this.occupato = false;
        this.avvisa('Link tolto.');
        this.carica();
      },
      error: (err: HttpErrorResponse) => {
        this.occupato = false;
        this.avvisa(err.error?.error ?? 'Non sono riuscito a toglierlo.');
      },
    });
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 2200, position: 'top' });
    await toast.present();
  }
}
