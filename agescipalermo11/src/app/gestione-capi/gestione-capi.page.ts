import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
  IonRouterLinkWithHref, IonContent, ToastController
} from '@ionic/angular/standalone';
import {
  arrowBackOutline, callOutline, mailOutline, shieldCheckmarkOutline, swapHorizontalOutline, trashOutline
} from 'ionicons/icons';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { BRANCHE_VERE, ZonaCapiService } from '../services/zona-capi';
import { nomeBranca, stiliBranca } from '../services/posti';
import { AuthService } from '../services/auth';
import { Branca, CapoElenco } from '../../types/models';

/**
 * L'elenco dei capi. Per il capogruppo è la "Comunità capi" della sua zona, e da qui
 * la gestisce; per tutti gli altri è "I nostri capi", con i soli nomi e le branche. Da qui si cambia la branca di ognuno
 * (o lo si mette a disposizione del gruppo), si nomina un capogruppo e si rimuove chi è uscito.
 */
@Component({
  selector: 'app-gestione-capi',
  templateUrl: './gestione-capi.page.html',
  styleUrls: ['./gestione-capi.page.scss'],
  standalone: true,
  imports: [
    FormsModule, RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent,
  ],
})
export class GestioneCapiPage {
  readonly icone = {
    indietro: arrowBackOutline, capi: shieldCheckmarkOutline, sposta: swapHorizontalOutline,
    elimina: trashOutline, telefono: callOutline, email: mailOutline,
  };
  readonly branche = BRANCHE_VERE;
  readonly nomeBranca = nomeBranca;
  readonly stiliBranca = stiliBranca;

  private auth = inject(AuthService);
  private rotta = inject(ActivatedRoute);
  private zona = inject(ZonaCapiService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);

  capi: CapoElenco[] = [];
  /** Vero solo per i capigruppo: a loro compaiono i pulsanti per gestirla. */
  puoGestire = false;
  caricamento = true;
  errore = '';
  ricerca = '';
  /** Riquadro scelto in alto: mostra solo quella branca. 'liberi' = chi è a disposizione. */
  filtro: Branca | 'liberi' | null = null;

  ionViewWillEnter() {
    this.carica();
  }

  /**
   * La pagina è la stessa per tutti, ma si arriva da due parti: i capigruppo dall'Area Capi,
   * tutti gli altri dal menu della home.
   */
  get dentroAreaCapi(): boolean {
    return this.puoGestire && this.rotta.snapshot.url.some(p => p.path === 'gestione-capi');
  }

  get ioSono(): number | null {
    const utente = this.auth.utente;
    return utente && utente.ruolo !== 'visitatore' ? utente.id : null;
  }

  get capiFiltrati(): CapoElenco[] {
    const cerca = this.ricerca.trim().toLowerCase();
    return this.capi.filter(c => {
      if (this.filtro === 'liberi' && c.branca) return false;
      if (this.filtro && this.filtro !== 'liberi' && c.branca !== this.filtro) return false;
      return !cerca || `${c.nome} ${c.cognome} ${c.codice_censimento}`.toLowerCase().includes(cerca);
    });
  }

  /** Tocca un riquadro per vedere solo quella branca; ritoccalo per tornare a tutti. */
  alternaFiltro(quale: Branca | 'liberi') {
    this.filtro = this.filtro === quale ? null : quale;
  }

  /** Come si chiama quello che si sta guardando adesso, per scriverlo nel titolo. */
  get nomeFiltro(): string {
    if (!this.filtro) return 'I capi';
    return this.filtro === 'liberi' ? 'A disposizione del gruppo' : nomeBranca(this.filtro);
  }

  /** Quanti capi ci sono in ogni branca: serve per vedere a colpo d'occhio se una è scoperta. */
  quantiIn(branca: Branca): number {
    return this.capi.filter(c => c.branca === branca).length;
  }

  get aDisposizione(): number {
    return this.capi.filter(c => !c.branca).length;
  }

  carica() {
    this.caricamento = true;
    this.zona.capi().subscribe({
      next: dati => {
        this.capi = dati.capi;
        this.puoGestire = dati.puoGestire;
        this.caricamento = false;
        this.errore = '';
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.errore = err.status === 403 ? 'Questa zona è dei capigruppo.'
          : err.status === 404 ? 'Il server non gestisce ancora questa parte: va riavviato il backend.'
            : 'Impossibile caricare la comunità capi. Riprova tra poco.';
      },
    });
  }

  /** Sposta un capo in un'altra branca, o lo mette a disposizione del gruppo (branca vuota). */
  spostaIn(capo: CapoElenco, branca: Branca | null) {
    if (capo.branca === branca) return;
    this.salva(capo, { branca });
  }

  async cambiaRuolo(capo: CapoElenco) {
    const diventa = capo.ruolo === 'admin' ? 'capo' : 'admin';
    if (capo.id === this.ioSono && diventa === 'capo') {
      this.avvisa('Non puoi rimuoverti da solo il ruolo di capogruppo.');
      return;
    }
    const alert = await this.alertCtrl.create({
      header: diventa === 'admin' ? 'Fare capogruppo?' : 'Rimuovere il ruolo di capogruppo?',
      message: diventa === 'admin'
        ? `${capo.nome} ${capo.cognome} potrà aprire l'anno, caricare i capi e vedere la cassa del gruppo.`
        : `${capo.nome} ${capo.cognome} tornerà a essere un capo di branca.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        { text: 'Conferma', handler: () => { this.salva(capo, { ruolo: diventa }); } },
      ],
    });
    await alert.present();
  }

  private salva(capo: CapoElenco, cambi: { branca?: Branca | null; ruolo?: 'capo' | 'admin' }) {
    this.zona.aggiornaCapo(capo.id, {
      nome: capo.nome,
      cognome: capo.cognome,
      data_nascita: capo.data_nascita,
      branca: cambi.branca !== undefined ? cambi.branca : capo.branca,
      ruolo: cambi.ruolo ?? capo.ruolo,
      telefono: capo.telefono,
      email: capo.email,
    }).subscribe({
      next: () => {
        this.carica();
        this.avvisa('Fatto.');
      },
      error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Non sono riuscito a salvare.'),
    });
  }

  async confermaElimina(capo: CapoElenco) {
    if (capo.id === this.ioSono) {
      this.avvisa('Non puoi eliminare te stesso.');
      return;
    }
    const alert = await this.alertCtrl.create({
      header: 'Rimuovere dalla comunità capi?',
      message: `${capo.nome} ${capo.cognome} viene rimosso dal database. Non si torna indietro.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Rimuovi', role: 'destructive', handler: () => {
            this.zona.eliminaCapo(capo.id).subscribe({
              next: () => {
                this.capi = this.capi.filter(c => c.id !== capo.id);
                this.avvisa('Capo rimosso.');
              },
              error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Non sono riuscito a rimuoverlo.'),
            });
          }
        },
      ],
    });
    await alert.present();
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 1800, position: 'top' });
    await toast.present();
  }
}
