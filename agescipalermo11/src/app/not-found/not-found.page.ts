import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref, IonContent
} from '@ionic/angular/standalone';
import {
  arrowBackOutline, calendarOutline, chevronForwardOutline, homeOutline, mapOutline, musicalNotesOutline
} from 'ionicons/icons';
import { AuthService } from '../services/auth';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';

interface Scorciatoia {
  nome: string;
  descrizione: string;
  link: string;
  icona: string;
}

/** Pagina mostrata quando l'indirizzo non esiste (vedi la rotta "**" in app.routes.ts). */
@Component({
  selector: 'app-not-found',
  templateUrl: './not-found.page.html',
  styleUrls: ['./not-found.page.scss'],
  standalone: true,
  imports: [
    RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent,
  ],
})
export class NotFoundPage {
  private auth = inject(AuthService);

  readonly icone = { indietro: arrowBackOutline, apri: chevronForwardOutline, home: homeOutline };

  /** La barra in basso ha senso solo per chi è già entrato. */
  readonly conSessione = !!this.auth.utente?.ruolo;

  // La mappa contiene contatti personali: il visitatore non la vede (come nella barra in basso).
  readonly scorciatoie: Scorciatoia[] = [
    { nome: 'Home', descrizione: 'Le notizie del gruppo', link: '/home', icona: homeOutline },
    { nome: 'Calendario', descrizione: 'Uscite, riunioni e campi', link: '/calendario', icona: calendarOutline },
    { nome: 'Canzoniere', descrizione: 'I canti con gli accordi', link: '/canzoniere', icona: musicalNotesOutline },
    { nome: 'Mappa', descrizione: 'I posti del gruppo', link: '/mappa', icona: mapOutline },
  ].filter(s => s.link !== '/mappa' || this.vedeLaMappa);

  private get vedeLaMappa(): boolean {
    const ruolo = this.auth.utente?.ruolo;
    return !!ruolo && ruolo !== 'visitatore';
  }
}
