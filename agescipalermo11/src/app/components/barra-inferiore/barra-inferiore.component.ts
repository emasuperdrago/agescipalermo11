import { ChangeDetectorRef, Component, ElementRef, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { IonFooter, IonToolbar, IonIcon, NavController } from '@ionic/angular/standalone';
import {
  calendarOutline, home, mapOutline, musicalNotesOutline, personOutline, shieldCheckmarkOutline
} from 'ionicons/icons';
import { scorrimentoOrizzontale } from '../../animazioni/scorrimento-orizzontale';
import { AuthService } from '../../services/auth';
import { IscrizioniService } from '../../services/iscrizioni';

export type VoceBarra = 'mappa' | 'calendario' | 'home' | 'canzoniere' | 'profilo' | 'area-capi';

interface VoceMenu {
  chiave: VoceBarra;
  nome: string;
  link: string;
  icona: string;
}

/**
 * Barra di navigazione in basso, condivisa tra le pagine.
 * Uso: <app-barra-inferiore attiva="home" /> dopo <ion-content>; la voce attiva è evidenziata in viola.
 * Al tocco la pillola viola scivola subito sulla nuova voce, mentre la pagina scorre in orizzontale.
 */
@Component({
  selector: 'app-barra-inferiore',
  templateUrl: './barra-inferiore.component.html',
  styleUrls: ['./barra-inferiore.component.scss'],
  standalone: true,
  imports: [IonFooter, IonToolbar, IonIcon],
})
export class BarraInferioreComponent implements OnInit, OnDestroy {
  @Input() attiva: VoceBarra | null = null;

  private auth = inject(AuthService);
  private iscrizioni = inject(IscrizioniService);

  /** Richieste di iscrizione ancora senza risposta: il pallino rosso sulla voce "Capi". */
  readonly nuove = this.iscrizioni.nuove;

  // Icone passate come dati: ionicons è installato in due versioni (vedi HomePage).
  // Il visitatore non vede la mappa (contiene contatti personali); "Capi" lo vedono solo capi e admin,
  // che invece non hanno "Profilo" (ci arrivano dal menu della home, dove c'è il logout).
  readonly voci = ([
    { chiave: 'mappa', nome: 'Mappa', link: '/mappa', icona: mapOutline },
    { chiave: 'calendario', nome: 'Calendario', link: '/calendario', icona: calendarOutline },
    { chiave: 'home', nome: 'Home', link: '/home', icona: home },
    { chiave: 'canzoniere', nome: 'Canzoniere', link: '/canzoniere', icona: musicalNotesOutline },
    { chiave: 'profilo', nome: 'Profilo', link: '/profilo', icona: personOutline },
    { chiave: 'area-capi', nome: 'Capi', link: '/area-capi', icona: shieldCheckmarkOutline },
  ] as VoceMenu[]).filter(v => this.vocePermessa(v.chiave));

  /**
   * Voce evidenziata (pillola viola e colore). All'inizio è quella della pagina;
   * al tocco passa subito alla nuova voce, senza aspettare che la nuova pagina sia pronta.
   */
  evidenziata: VoceBarra | null = null;
  /** La pillola scivola solo dopo un tocco: all'apertura della pagina è già al suo posto. */
  pillolaAnimata = false;

  /** La pagina Ionic che contiene la barra (la barra ne è figlia diretta). */
  private pagina?: HTMLElement | null;
  private allIngresso = () => {
    // Se Ionic riusa una pagina già aperta, la pillola torna sulla sua voce senza scivolare.
    this.pillolaAnimata = false;
    this.evidenziata = this.attiva;
    this.contaRichieste();
  };

  constructor(private navCtrl: NavController, private el: ElementRef<HTMLElement>, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.evidenziata = this.attiva;
    this.contaRichieste();
    this.pagina = this.el.nativeElement.parentElement;
    this.pagina?.addEventListener('ionViewWillEnter', this.allIngresso);
  }

  ngOnDestroy() {
    this.pagina?.removeEventListener('ionViewWillEnter', this.allIngresso);
  }

  get posizionePillola(): number {
    return this.indice(this.evidenziata);
  }

  async vai(evento: MouseEvent, chiave: VoceBarra, link: string) {
    // Cmd/Ctrl/Maiusc + clic: lascia al browser l'apertura in una nuova scheda.
    if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.button !== 0) return;
    evento.preventDefault();
    if (chiave === this.attiva) return;

    const avanti = this.indice(chiave) > this.indice(this.attiva);
    // La pillola parte subito in questa barra, che resta visibile per tutto il cambio pagina
    // (vedi animazioni/scorrimento-orizzontale.ts).
    this.pillolaAnimata = true;
    this.evidenziata = chiave;
    // Va disegnata adesso: appena parte la navigazione Ionic stacca la pagina che esce
    // dall'aggiornamento di Angular, e la pillola resterebbe ferma fino alla fine.
    this.cdr.detectChanges();
    const riuscito = await this.navCtrl.navigateRoot(link, {
      animated: true,
      animation: scorrimentoOrizzontale,
      animationDirection: avanti ? 'forward' : 'back',
    });
    // Navigazione annullata (es. pagina non permessa): la pillola torna sulla voce della pagina.
    if (!riuscito) this.evidenziata = this.attiva;
  }

  /** Solo i capi ricevono le richieste: agli altri non si chiede niente. */
  private contaRichieste() {
    const ruolo = this.auth.utente?.ruolo;
    if (ruolo === 'capo' || ruolo === 'admin') this.iscrizioni.aggiornaNuove();
  }

  private vocePermessa(chiave: VoceBarra): boolean {
    const ruolo = this.auth.utente?.ruolo;
    const capo = ruolo === 'capo' || ruolo === 'admin';
    if (chiave === 'mappa') return ruolo !== 'visitatore';
    if (chiave === 'area-capi') return capo;
    if (chiave === 'profilo') return !capo;
    return true;
  }

  private indice(chiave: VoceBarra | null): number {
    return this.voci.findIndex(v => v.chiave === chiave);
  }
}
