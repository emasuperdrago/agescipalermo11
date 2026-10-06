import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref, IonContent
} from '@ionic/angular/standalone';
import { arrowBackOutline, documentTextOutline, fileTrayFullOutline } from 'ionicons/icons';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { RiquadroCartaComponent } from '../components/riquadro-carta/riquadro-carta.component';
import { CartaClanService } from '../services/carta-clan';
import { CartaDiClan } from '../../types/models';

/**
 * La Carta di Clan in vigore, da sfogliare tutta, e l'archivio di quelle degli anni passati.
 * I capi clan (e un capogruppo che fa anche il capo clan) da qui ne caricano una nuova,
 * cambiano titolo e anno, rimettono in vigore una vecchia o la rimuovono.
 */
@Component({
  selector: 'app-carta-di-clan',
  templateUrl: './carta-di-clan.page.html',
  styleUrls: ['./carta-di-clan.page.scss'],
  standalone: true,
  imports: [
    RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent, RiquadroCartaComponent,
  ],
})
export class CartaDiClanPage implements OnInit {
  readonly icone = { indietro: arrowBackOutline, carta: documentTextOutline, archivio: fileTrayFullOutline };

  corrente: CartaDiClan | null = null;
  archivio: CartaDiClan[] = [];
  puoGestire = false;
  caricamento = true;
  errore = '';

  /** La Carta dell'archivio aperta adesso: una per volta, così si carica un PDF solo. */
  apertaInArchivio: number | null = null;

  /** Una richiesta per volta: le due chiamate d'ingresso non si accavallano. */
  private inCorso = false;

  private carte = inject(CartaClanService);

  // Ionic può creare la pagina più di una volta: chiedendo i dati sia qui sia all'ingresso
  // si è sicuri che quella davvero mostrata li abbia.
  ngOnInit() {
    this.carica();
  }

  ionViewWillEnter() {
    this.carica();
  }

  carica() {
    if (this.inCorso) return;
    this.inCorso = true;
    this.caricamento = true;
    this.carte.tutte().subscribe({
      next: dati => {
        this.corrente = dati.corrente;
        this.archivio = dati.archivio;
        this.puoGestire = dati.puoGestire;
        // Se la Carta aperta non c'è più (rimossa, o tornata in vigore) si richiude tutto.
        if (!this.archivio.some(c => c.id === this.apertaInArchivio)) this.apertaInArchivio = null;
        this.caricamento = false;
        this.inCorso = false;
        this.errore = '';
      },
      error: () => {
        this.caricamento = false;
        this.inCorso = false;
        this.errore = 'Non riesco a caricare le Carte di Clan. Riprova tra poco.';
      },
    });
  }

  apriChiudi(carta: CartaDiClan) {
    this.apertaInArchivio = this.apertaInArchivio === carta.id ? null : carta.id;
  }

  /** Gli anni dell'archivio, per la riga sotto al titolo. */
  quando(carta: CartaDiClan): string {
    const giorno = new Date(carta.data_creazione);
    const data = isNaN(giorno.getTime()) ? ''
      : giorno.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
    return [carta.anno, data].filter(Boolean).join(' · ');
  }
}
