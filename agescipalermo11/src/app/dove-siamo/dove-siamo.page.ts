import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import {
  IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref, IonContent
} from '@ionic/angular/standalone';
import { arrowBackOutline, locationOutline, navigateOutline } from 'ionicons/icons';
import * as L from 'leaflet';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { aggiungiSfondoMappa, iconaBandierina, urlIndicazioni } from '../services/posti';
import { apiUrl } from '../services/api';

/** Quello che il server dice della sede: solo il punto, senza contatti. */
interface Sede {
  nome: string;
  indirizzo: string | null;
  latitudine: number;
  longitudine: number;
}

/**
 * "Dove siamo": una mappa con il solo punto della sede, aperta a chiunque.
 * La mappa completa dei posti resta quella della barra in basso, riservata ai censiti.
 */
@Component({
  selector: 'app-dove-siamo',
  templateUrl: './dove-siamo.page.html',
  styleUrls: ['./dove-siamo.page.scss'],
  standalone: true,
  imports: [
    RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent,
  ],
})
export class DoveSiamoPage implements AfterViewInit, OnDestroy {
  readonly icone = { indietro: arrowBackOutline, posto: locationOutline, indicazioni: navigateOutline };

  @ViewChild('contenitore') contenitore?: ElementRef<HTMLElement>;

  sede: Sede | null = null;
  errore = '';

  private http = inject(HttpClient);
  private mappa?: L.Map;
  private osservatore?: ResizeObserver;

  ngAfterViewInit() {
    this.http.get<{ sede: Sede }>(`${apiUrl()}/sede`).subscribe({
      next: r => {
        this.sede = r.sede;
        this.disegna(r.sede);
      },
      error: () => this.errore = 'Non riesco a caricare la sede. Riprova tra poco.',
    });
  }

  ngOnDestroy() {
    this.osservatore?.disconnect();
    this.mappa?.remove();
  }

  private disegna(sede: Sede) {
    const el = this.contenitore?.nativeElement;
    if (!el) return;
    const punto: L.LatLngTuple = [sede.latitudine, sede.longitudine];
    this.mappa = L.map(el, { center: punto, zoom: 16, zoomControl: false });
    L.control.zoom({ position: 'bottomleft', zoomInTitle: 'Avvicina', zoomOutTitle: 'Allontana' })
      .addTo(this.mappa);
    aggiungiSfondoMappa(this.mappa);
    // Una bandierina sola: la sede è del gruppo, quindi viola.
    L.marker(punto, { icon: iconaBandierina('gruppo'), title: sede.nome, keyboard: false })
      .addTo(this.mappa);
    // Ionic apre la pagina con un'animazione: la mappa va rimisurata quando cambia misura.
    this.osservatore = new ResizeObserver(() => this.mappa?.invalidateSize());
    this.osservatore.observe(el);
  }

  /** Link che apre il navigatore del telefono. */
  get indicazioni(): string {
    return this.sede ? urlIndicazioni(this.sede) : '';
  }
}
