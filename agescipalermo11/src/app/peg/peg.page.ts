import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref, IonContent
} from '@ionic/angular/standalone';
import { arrowBackOutline, documentTextOutline, fileTrayFullOutline } from 'ionicons/icons';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { RiquadroCartaComponent } from '../components/riquadro-carta/riquadro-carta.component';
import { PegService, TESTI_PEG } from '../services/peg';
import { CartaDiClan } from '../../types/models';

/**
 * Il PEG, Progetto Educativo di Gruppo: quello in vigore, da sfogliare tutto, e l'archivio dei
 * precedenti. Lo vedono tutti; i capigruppo da qui ne caricano uno nuovo, cambiano titolo e
 * anni, rimettono in vigore uno vecchio o lo rimuovono. Usa il riquadro della Carta di Clan.
 */
@Component({
  selector: 'app-peg',
  templateUrl: './peg.page.html',
  styleUrls: ['./peg.page.scss'],
  standalone: true,
  imports: [
    RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent, RiquadroCartaComponent,
  ],
})
export class PegPage implements OnInit {
  readonly icone = { indietro: arrowBackOutline, carta: documentTextOutline, archivio: fileTrayFullOutline };

  readonly testi = TESTI_PEG;

  corrente: CartaDiClan | null = null;
  archivio: CartaDiClan[] = [];
  puoGestire = false;
  caricamento = true;
  errore = '';

  /** Il PEG dell'archivio aperto adesso: uno per volta, così si carica un PDF solo. */
  apertaInArchivio: number | null = null;

  /** Una richiesta per volta: le due chiamate d'ingresso non si accavallano. */
  private inCorso = false;

  readonly peg = inject(PegService);

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
    this.peg.tutti().subscribe({
      next: dati => {
        this.corrente = dati.corrente;
        this.archivio = dati.archivio;
        this.puoGestire = dati.puoGestire;
        // Se il PEG aperto non c'è più (rimosso, o tornato in vigore) si richiude tutto.
        if (!this.archivio.some(c => c.id === this.apertaInArchivio)) this.apertaInArchivio = null;
        this.caricamento = false;
        this.inCorso = false;
        this.errore = '';
      },
      error: () => {
        this.caricamento = false;
        this.inCorso = false;
        this.errore = 'Non riesco a caricare il PEG. Riprova tra poco.';
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
