import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
  IonRouterLinkWithHref, IonContent, ToastController
} from '@ionic/angular/standalone';
import {
  addOutline, arrowBackOutline, arrowDownCircleOutline, arrowUpCircleOutline, cameraOutline,
  closeOutline, downloadOutline, imageOutline, pencilOutline, trashOutline, walletOutline
} from 'ionicons/icons';
import { preparaImmagine } from '../services/immagini';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { ZonaCapiService, euro } from '../services/zona-capi';
import { backendUrl } from '../services/api';
import { nomeBranca } from '../services/posti';
import { AnnoDiCassa, AnnoScout, DatiMovimento, Movimento, NomeCassa } from '../../types/models';
import { SelettoreDataComponent } from '../components/selettore-data/selettore-data.component';

/**
 * Cassa di una branca o del gruppo: entrate, uscite e saldo dell'anno scout in corso.
 * Chi può aprirla lo decide il server: la propria branca, e il gruppo solo i capigruppo.
 */
@Component({
  selector: 'app-bilancio',
  templateUrl: './bilancio.page.html',
  styleUrls: ['./bilancio.page.scss'],
  standalone: true,
  imports: [
    FormsModule, RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent, SelettoreDataComponent,
  ],
})
export class BilancioPage {
  readonly icone = {
    indietro: arrowBackOutline, cassa: walletOutline, aggiungi: addOutline, modifica: pencilOutline,
    elimina: trashOutline, entrata: arrowDownCircleOutline, uscita: arrowUpCircleOutline,
    scontrino: cameraOutline, foto: imageOutline, chiudi: closeOutline, scarica: downloadOutline,
  };
  readonly euro = euro;

  private rotta = inject(ActivatedRoute);
  private zona = inject(ZonaCapiService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);

  /** Quanti movimenti si vedono per volta: gli altri arrivano con "Vedi altro". */
  private readonly PASSO = 17;
  mostrati = this.PASSO;

  cassa: NomeCassa = 'gruppo';
  anno: AnnoScout | null = null;
  movimenti: Movimento[] = [];
  entrate = 0;
  uscite = 0;
  saldo = 0;
  caricamento = true;
  errore = '';
  /** Chi non può modificare (un rover che non è tesoriere) la cassa la guarda e basta. */
  puoModificare = true;
  /** Gli anni scout con dei movimenti in questa cassa: si possono salvare tutti. */
  anni: AnnoDiCassa[] = [];

  /** Modulo per un movimento nuovo. */
  nuovo: DatiMovimento = { data: '', descrizione: '', importo: 0, tipo: 'uscita' };
  /** Quando si sta correggendo un movimento già scritto. */
  inModifica: Movimento | null = null;
  /** Foto dello scontrino scelta adesso (già rimpicciolita), da mandare al salvataggio. */
  scontrinoNuovo: string | null = null;
  /** Lo scontrino che c'era e che si vuole rimuovere. */
  scontrinoDaRimuovere = false;
  /** Foto aperta a schermo intero. */
  scontrinoAperto: string | null = null;

  ionViewWillEnter() {
    // Da /clan/cassa non arriva nessun parametro: quella è per forza la cassa di clan.
    const chiesta = this.rotta.snapshot.paramMap.get('cassa')
      ?? (this.rotta.snapshot.url.some(p => p.path === 'cassa') ? 'clan' : null);
    this.cassa = chiesta === 'branco' || chiesta === 'reparto' || chiesta === 'clan' ? chiesta : 'gruppo';
    this.daAreaCapi = this.rotta.snapshot.queryParamMap.get('da') === 'area-capi';
    this.nuovo = { data: this.oggi, descrizione: '', importo: 0, tipo: 'uscita' };
    this.carica();
  }

  /** Oggi come "AAAA-MM-GG", giorno locale (mai quello UTC). */
  get oggi(): string {
    const adesso = new Date();
    const due = (n: number) => String(n).padStart(2, '0');
    return `${adesso.getFullYear()}-${due(adesso.getMonth() + 1)}-${due(adesso.getDate())}`;
  }

  /** I capi clan possono arrivarci anche dall'Area Capi: allora si torna lì. */
  daAreaCapi = false;

  /** La cassa di clan sta nella sezione Clan: torna lì, non nella zona capi. */
  get dentroIlClan(): boolean {
    return this.cassa === 'clan' && !this.daAreaCapi;
  }

  get titolo(): string {
    if (this.cassa === 'gruppo') return 'Cassa del gruppo';
    if (this.cassa === 'clan') return 'Cassa di clan';
    return `Cassa del ${nomeBranca(this.cassa).toLowerCase()}`;
  }

  carica() {
    this.caricamento = true;
    this.zona.cassa(this.cassa).subscribe({
      next: dati => {
        this.anno = dati.anno;
        this.puoModificare = dati.puoModificare;
        // Solo gli anni che hanno davvero qualcosa dentro: gli altri sarebbero fogli vuoti.
        this.anni = (dati.anni ?? []).filter(a => a.corrente || a.movimenti > 0);
        this.movimenti = dati.movimenti;
        this.mostrati = this.PASSO;
        this.entrate = dati.entrate;
        this.uscite = dati.uscite;
        this.saldo = dati.saldo;
        this.caricamento = false;
        this.errore = '';
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.errore = err.status === 403 ? 'Questa cassa non è tua: la vedono i capi della branca.'
          : err.status === 404 ? 'Il server non gestisce ancora le casse: va riavviato il backend.'
            : 'Impossibile caricare la cassa. Riprova tra poco.';
      },
    });
  }

  /** Solo i primi movimenti: il resto si apre con "Vedi altro". */
  get movimentiVisibili(): Movimento[] {
    return this.movimenti.slice(0, this.mostrati);
  }

  /** Quanti ne restano nascosti. */
  get altri(): number {
    return Math.max(0, this.movimenti.length - this.mostrati);
  }

  vediAltro() {
    this.mostrati += this.PASSO;
  }

  /**
   * Salva il bilancio in un file Excel. Se ci sono anni passati si chiede quale,
   * altrimenti si scarica direttamente quello in corso.
   */
  async scarica() {
    if (this.anni.length <= 1) return this.scaricaAnno(this.anni[0]?.id, this.anno?.etichetta);
    const alert = await this.alertCtrl.create({
      header: 'Quale bilancio salvare?',
      inputs: this.anni.map((a, i) => ({
        type: 'radio' as const,
        label: a.corrente ? `${a.etichetta} (anno in corso)` : a.etichetta,
        value: a.id,
        checked: i === 0,
      })),
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Salva', handler: (id: number) => {
            const scelto = this.anni.find(a => a.id === id) ?? this.anni[0];
            this.scaricaAnno(scelto.id, scelto.etichetta);
          },
        },
      ],
    });
    await alert.present();
  }

  private scaricaAnno(id?: number, etichetta?: string) {
    this.zona.scaricaCassa(this.cassa, id).subscribe({
      next: file => {
        const indirizzo = URL.createObjectURL(file);
        const collegamento = document.createElement('a');
        collegamento.href = indirizzo;
        collegamento.download = `cassa-${this.cassa}-${(etichetta ?? '').replace('/', '-')}.xlsx`;
        document.body.appendChild(collegamento);
        collegamento.click();
        collegamento.remove();
        setTimeout(() => URL.revokeObjectURL(indirizzo), 2000);
      },
      error: () => this.avvisa('Non sono riuscito a preparare il file.'),
    });
  }

  /** Data scritta all'italiana: 20/09/2026. */
  dataItaliana(data: string): string {
    const [anno, mese, giorno] = data.split('-');
    return `${giorno}/${mese}/${anno}`;
  }

  /** La foto dello scontrino: si rimpicciolisce qui, così parte leggera (il limite è 3 MB). */
  async scegliScontrino(evento: Event) {
    const input = evento.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      this.scontrinoNuovo = await preparaImmagine(file, { latoMax: 1600 });
      this.scontrinoDaRimuovere = false;
    } catch (e) {
      this.avvisa(e instanceof Error ? e.message : 'Questa foto non si riesce a leggere.');
    }
  }

  rimuoviScontrino() {
    this.scontrinoNuovo = null;
    // Se il movimento ne aveva già uno, al salvataggio va rimosso anche dal server.
    if (this.inModifica?.scontrino_url) this.scontrinoDaRimuovere = true;
  }

  /** La foto da mostrare nel modulo: quella appena scelta, o quella già salvata. */
  get anteprimaScontrino(): string | null {
    if (this.scontrinoNuovo) return this.scontrinoNuovo;
    if (this.scontrinoDaRimuovere) return null;
    return this.inModifica?.scontrino_url ? this.urlBackend(this.inModifica.scontrino_url) : null;
  }

  /** Il percorso che arriva dal server diventa un indirizzo intero. */
  urlBackend(percorso: string): string {
    return `${backendUrl()}${percorso}`;
  }

  apriScontrino(movimento: Movimento) {
    if (movimento.scontrino_url) this.scontrinoAperto = this.urlBackend(movimento.scontrino_url);
  }

  chiudiScontrino() {
    this.scontrinoAperto = null;
  }

  salva() {
    const dati: DatiMovimento = {
      data: this.nuovo.data || this.oggi,
      descrizione: this.nuovo.descrizione.trim(),
      importo: Number(this.nuovo.importo),
      tipo: this.nuovo.tipo,
      ...(this.scontrinoNuovo ? { scontrino: this.scontrinoNuovo } : {}),
      ...(this.scontrinoDaRimuovere && !this.scontrinoNuovo ? { rimuovi_scontrino: true } : {}),
    };
    if (!dati.descrizione || !Number.isFinite(dati.importo) || dati.importo <= 0) {
      this.avvisa('Scrivi a cosa si riferisce e un importo maggiore di zero.');
      return;
    }

    const richiesta = this.inModifica
      ? this.zona.aggiornaMovimento(this.inModifica.id, dati)
      : this.zona.aggiungiMovimento(this.cassa, dati);
    richiesta.subscribe({
      next: () => {
        this.annullaModifica();
        this.carica();
      },
      error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Non sono riuscito a salvare il movimento.'),
    });
  }

  modifica(movimento: Movimento) {
    if (movimento.automatico) {
      this.avvisa('Questo movimento arriva da una quota: si cambia dalla tabella dei ragazzi.');
      return;
    }
    this.inModifica = movimento;
    this.scontrinoNuovo = null;
    this.scontrinoDaRimuovere = false;
    this.nuovo = {
      data: movimento.data,
      descrizione: movimento.descrizione,
      importo: Math.abs(movimento.importo),
      tipo: movimento.importo < 0 ? 'uscita' : 'entrata',
    };
  }

  annullaModifica() {
    this.inModifica = null;
    this.scontrinoNuovo = null;
    this.scontrinoDaRimuovere = false;
    this.nuovo = { data: this.oggi, descrizione: '', importo: 0, tipo: 'uscita' };
  }

  async confermaElimina(movimento: Movimento) {
    if (movimento.automatico) {
      this.avvisa('Questo movimento arriva da una quota: si rimuove dalla tabella dei ragazzi.');
      return;
    }
    const alert = await this.alertCtrl.create({
      header: 'Eliminare il movimento?',
      message: `"${movimento.descrizione}" — ${euro(Math.abs(movimento.importo))}`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Elimina', role: 'destructive', handler: () => {
            this.zona.eliminaMovimento(movimento.id).subscribe({
              next: () => this.carica(),
              error: () => this.avvisa('Non sono riuscito a eliminare il movimento.'),
            });
          }
        },
      ],
    });
    await alert.present();
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 2000, position: 'top' });
    await toast.present();
  }
}
