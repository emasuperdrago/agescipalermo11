import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref, IonContent
} from '@ionic/angular/standalone';
import {
  arrowBackOutline, chevronDownOutline, happyOutline, medalOutline, pawOutline, peopleOutline,
  ribbonOutline, trailSignOutline
} from 'ionicons/icons';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { ElencoDistintiviComponent } from '../components/elenco-distintivi/elenco-distintivi.component';
import { SPECIALITA_BRANCO } from './specialita-branco';

/** Le parti della pagina: si passa da una all'altra dalla fascia in alto. */
type Sezione = 'chi-siamo' | 'specialita' | 'promessa';

/**
 * La sezione Branco: chi sono lupetti e lupette, le specialità con i loro distintivi e i
 * testi della Promessa e della Legge. Le voci del menu della home arrivano qui con
 * l'ancora (#specialita, #promessa) e aprono direttamente quella parte.
 */
@Component({
  selector: 'app-branco',
  templateUrl: './branco.page.html',
  styleUrls: ['./branco.page.scss'],
  standalone: true,
  imports: [
    RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent, ElencoDistintiviComponent,
  ],
})
export class BrancoPage implements OnInit, OnDestroy {
  readonly icone = {
    indietro: arrowBackOutline, apri: chevronDownOutline, promessa: ribbonOutline,
    giungla: pawOutline, sestiglia: peopleOutline, gioco: happyOutline,
    sentiero: trailSignOutline, specialita: medalOutline,
  };

  /** La fascia in alto: una voce per parte, con la sua icona. */
  readonly sezioni = [
    { chiave: 'chi-siamo', titolo: 'Chi siamo', icona: this.icone.sentiero },
    { chiave: 'specialita', titolo: 'Specialità', icona: this.icone.specialita },
    { chiave: 'promessa', titolo: 'Promessa e Legge', icona: this.icone.promessa },
  ] as const;

  /**
   * I tre pilastri della branca: il nome si vede sempre, la spiegazione si apre
   * toccando il riquadro (uno alla volta).
   */
  readonly pilastri = [
    {
      chiave: 'giungla',
      titolo: 'Giungla',
      testo: 'Le storie di Mowgli non sono solo racconti: sono il modo in cui il Branco impara. '
        + 'Akela, Baloo, Bagheera e Kaa danno il nome ai capi e alle prove di ogni lupetto.',
    },
    {
      chiave: 'sestiglia',
      titolo: 'Sestiglia',
      testo: 'Il Branco si divide in piccoli gruppi, le sestiglie, ognuna con il suo colore. '
        + 'Si sta insieme, ci si aiuta e si impara a fare la propria parte.',
    },
    {
      chiave: 'gioco',
      titolo: 'Gioco',
      testo: 'Nel Branco si impara giocando: cacce, voli, imprese e canti. Il gioco è una cosa '
        + 'seria, perché è lì che si scopre come stare insieme agli altri.',
    },
  ] as const;

  /**
   * La Legge del Branco e la Promessa del Lupetto: sono le parole dell'AGESCI,
   * si cambiano solo qui e non a mano dal sito.
   */
  readonly legge = [
    'Il Lupetto pensa agli altri come a se stesso.',
    'Il Lupetto vive con gioia e lealtà insieme al branco.',
  ] as const;

  readonly specialita = SPECIALITA_BRANCO;

  sezioneAttiva: Sezione = 'chi-siamo';
  /** Il pilastro aperto adesso: null quando sono tutti chiusi. */
  pilastroAperto: string | null = null;

  private rotta = inject(ActivatedRoute);
  private ascolto?: Subscription;

  ngOnInit() {
    this.ascolto = this.rotta.fragment.subscribe(ancora => this.dallAncora(ancora));
  }

  ngOnDestroy() {
    this.ascolto?.unsubscribe();
  }

  ionViewWillEnter() {
    this.dallAncora(this.rotta.snapshot.fragment);
  }

  private dallAncora(ancora: string | null) {
    if (!ancora) return;
    const trovata = this.sezioni.find(s => s.chiave === ancora);
    if (trovata) this.sezioneAttiva = trovata.chiave;
  }

  apriSezione(chiave: Sezione) {
    this.sezioneAttiva = chiave;
    this.pilastroAperto = null;
  }

  /** Dove sta la pastiglia che scivola sotto la voce scelta. */
  get posizionePastiglia(): number {
    return this.sezioni.findIndex(s => s.chiave === this.sezioneAttiva);
  }

  alternaPilastro(chiave: string) {
    this.pilastroAperto = this.pilastroAperto === chiave ? null : chiave;
  }
}

