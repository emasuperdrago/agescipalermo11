import { Component, OnInit, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import {
  IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref, IonContent
} from '@ionic/angular/standalone';
import {
  arrowBackOutline, documentTextOutline, fileTrayFullOutline, footstepsOutline, handRightOutline,
  peopleCircleOutline, walletOutline
} from 'ionicons/icons';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { RiquadroCartaComponent } from '../components/riquadro-carta/riquadro-carta.component';
import { AuthService } from '../services/auth';
import { CartaClanService } from '../services/carta-clan';
import { CartaDiClan } from '../../types/models';

/**
 * La sezione Clan: chi sono rover e scolte, la Carta di Clan da sfogliare
 * e, per chi è del clan, la porta della cassa.
 */
@Component({
  selector: 'app-clan',
  templateUrl: './clan.page.html',
  styleUrls: ['./clan.page.scss'],
  standalone: true,
  imports: [
    RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent, RiquadroCartaComponent,
  ],
})
export class ClanPage implements OnInit {
  readonly icone = {
    indietro: arrowBackOutline, carta: documentTextOutline, archivio: fileTrayFullOutline,
    cassa: walletOutline, strada: footstepsOutline, comunita: peopleCircleOutline,
    servizio: handRightOutline,
  };

  /** I tre pilastri della branca: solo il nome, con la sua icona. */
  readonly pilastri = [
    { chiave: 'strada', titolo: 'Strada' },
    { chiave: 'comunita', titolo: 'Comunità' },
    { chiave: 'servizio', titolo: 'Servizio' },
  ] as const;

  carta: CartaDiClan | null = null;
  quanteInArchivio = 0;
  puoGestire = false;
  caricamento = true;
  errore = '';

  /** Una richiesta per volta: le due chiamate d'ingresso non si accavallano. */
  private inCorso = false;

  private auth = inject(AuthService);
  private carte = inject(CartaClanService);

  // Ionic può creare la pagina più di una volta: chiedendo i dati sia qui sia all'ingresso
  // si è sicuri che quella davvero mostrata li abbia. La richiesta doppia la ferma `inCorso`.
  ngOnInit() {
    this.carica();
  }

  ionViewWillEnter() {
    this.carica();
  }

  /**
   * La cassa di clan la aprono i rover e le scolte del clan, i capi clan e un capogruppo
   * che fa anche il capo clan: tutti quelli che hanno il clan come branca.
   */
  get vedeLaCassa(): boolean {
    const utente = this.auth.utente;
    return !!utente && utente.ruolo !== 'visitatore' && utente.branca === 'clan';
  }

  carica() {
    if (this.inCorso) return;
    this.inCorso = true;
    this.caricamento = true;
    this.carte.tutte().subscribe({
      next: dati => {
        this.carta = dati.corrente;
        this.quanteInArchivio = dati.archivio.length;
        this.puoGestire = dati.puoGestire;
        this.caricamento = false;
        this.inCorso = false;
        this.errore = '';
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.inCorso = false;
        // Senza questo avviso sembrerebbe solo che la Carta non c'è ancora.
        this.errore = err.status === 404
          ? 'Il server non conosce ancora la Carta di Clan: va riavviato il backend.'
          : 'Non riesco a caricare la Carta di Clan. Riprova tra poco.';
      },
    });
  }
}
