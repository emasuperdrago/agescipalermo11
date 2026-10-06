import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref, IonContent
} from '@ionic/angular/standalone';
import {
  arrowBackOutline, checkmarkCircleOutline, cloudUploadOutline, documentTextOutline, peopleOutline,
  personAddOutline, searchOutline, shieldCheckmarkOutline
} from 'ionicons/icons';
import { CensitiService, LetturaBrancheCapi, LetturaExcel } from '../services/censiti';
import { AuthService } from '../services/auth';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { nomeBranca, stiliBranca } from '../services/posti';
import { Branca, EsitoImport, UtenteElenco } from '../../types/models';

const ETICHETTE_RUOLO: Record<UtenteElenco['ruolo'], string> = {
  ragazzo: 'Ragazzo/a', capo: 'Capo', admin: 'Capogruppo',
};

/**
 * Codici censimento, in due zone separate (l'indirizzo dice quale):
 * "capi" è la comunità capi e la aprono solo i capigruppo, "ragazzi" sono i ragazzi della
 * propria branca. Chi è capogruppo e insieme capo di una branca usa tutte e due.
 * Il permesso lo controlla comunque il server.
 */
@Component({
  selector: 'app-gestione-censiti',
  templateUrl: './gestione-censiti.page.html',
  styleUrls: ['./gestione-censiti.page.scss'],
  standalone: true,
  imports: [
    FormsModule, RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent,
  ],
})
export class GestioneCensitiPage {
  readonly icone = {
    indietro: arrowBackOutline, carica: cloudUploadOutline, file: documentTextOutline, cerca: searchOutline,
    fatto: checkmarkCircleOutline, ragazzi: peopleOutline, capi: shieldCheckmarkOutline, aggiungi: personAddOutline,
  };
  readonly nomeBranca = nomeBranca;
  readonly stiliBranca = stiliBranca;

  private censiti = inject(CensitiService);
  private rotta = inject(ActivatedRoute);
  private auth = inject(AuthService);

  /** Quale zona: la comunità capi o i ragazzi della propria branca. */
  tipo: 'capi' | 'ragazzi' = 'ragazzi';

  /** Chi si sta caricando: lo decide il ruolo, non si sceglie. */
  ruolo: 'ragazzo' | 'capo' = 'ragazzo';
  nomeFile = '';
  lettura: LetturaExcel | null = null;
  esito: EsitoImport | null = null;
  errore = '';
  caricamento = false;

  /** Il secondo file dei capi (codice e branca), solo per i capigruppo. */
  nomeFileBranche = '';
  letturaBranche: LetturaBrancheCapi | null = null;
  esitoBranche: EsitoImport | null = null;
  erroreBranche = '';
  caricamentoBranche = false;

  utenti: UtenteElenco[] = [];
  filtro = '';
  /** Branca del capo (null per i capigruppo e per chi non ne ha una). */
  branca: Branca | null = null;
  capogruppo = false;
  elencoPronto = false;

  ionViewWillEnter() {
    const chiesto = this.rotta.snapshot.paramMap.get('tipo');
    // Senza indicazioni: il capogruppo arriva ai capi, gli altri ai ragazzi.
    this.tipo = chiesto === 'capi' || chiesto === 'ragazzi'
      ? chiesto
      : (this.auth.utente?.ruolo === 'admin' ? 'capi' : 'ragazzi');
    this.ruolo = this.tipo === 'capi' ? 'capo' : 'ragazzo';
    this.elencoPronto = false;
    this.esito = null;
    this.errore = '';
    this.lettura = null;
    this.nomeFile = '';
    this.letturaBranche = null;
    this.esitoBranche = null;
    this.erroreBranche = '';
    this.nomeFileBranche = '';
    this.caricaElenco();
  }

  /** Si può caricare qualcuno in questa zona? */
  get zonaPermessa(): boolean {
    return this.tipo === 'capi' ? this.capogruppo : !!this.branca;
  }

  /** Nella zona capi servono i capigruppo; in quella dei ragazzi serve una branca. */
  get puoCaricare(): boolean {
    return this.zonaPermessa;
  }

  get utentiFiltrati(): UtenteElenco[] {
    const f = this.filtro.trim().toLowerCase();
    if (!f) return this.utenti;
    return this.utenti.filter(u =>
      `${u.nome} ${u.cognome} ${u.cognome} ${u.nome} ${u.codice_censimento}`.toLowerCase().includes(f));
  }

  get attivati(): number {
    return this.utenti.filter(u => u.attivato).length;
  }

  /** Chi si sta caricando, scritto per esteso: serve nei pulsanti e nelle spiegazioni. */
  get chiCarico(): string {
    if (this.tipo === 'capi') return 'capi';
    return this.branca ? `ragazzi del ${nomeBranca(this.branca).toLowerCase()}` : 'ragazzi';
  }

  /** Data di nascita scritta all'italiana: 12/05/2014. */
  dataItaliana(data: string | null): string {
    if (!data) return '—';
    const [anno, mese, giorno] = data.split('-');
    return `${giorno}/${mese}/${anno}`;
  }

  brancaScritta(b: Branca | null): string {
    return b ? nomeBranca(b) : '—';
  }

  etichettaRuolo(r: UtenteElenco['ruolo']): string {
    return ETICHETTE_RUOLO[r];
  }

  async scegliFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // così si può ricaricare lo stesso file dopo averlo corretto
    if (!file) return;

    this.esito = null;
    this.errore = '';
    this.lettura = null;
    this.nomeFile = file.name;

    if (!/\.xlsx$/i.test(file.name)) {
      this.errore = 'Carica un file in formato .xlsx (da Excel: File → Salva con nome → Cartella di lavoro Excel).';
      return;
    }
    try {
      this.lettura = await this.censiti.leggiExcel(file, { chi: this.tipo, branca: this.branca });
    } catch (e) {
      this.errore = e instanceof Error ? e.message : 'Impossibile leggere il file.';
    }
  }

  annulla() {
    this.lettura = null;
    this.nomeFile = '';
  }

  /** Il livello Fo.Ca. come si legge nelle tabelle. */
  nomeFoca(livello: string | null): string {
    return livello ?? '—';
  }

  // ---------- Il secondo file dei capi: codice censimento e branca ----------

  async scegliFileBranche(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.esitoBranche = null;
    this.erroreBranche = '';
    this.letturaBranche = null;
    this.nomeFileBranche = file.name;
    if (!/\.xlsx$/i.test(file.name)) {
      this.erroreBranche = 'Carica un file in formato .xlsx (da Excel: File → Salva con nome → Cartella di lavoro Excel).';
      return;
    }
    try {
      this.letturaBranche = await this.censiti.leggiBrancheCapi(file);
    } catch (e) {
      this.erroreBranche = e instanceof Error ? e.message : 'Impossibile leggere il file.';
    }
  }

  annullaBranche() {
    this.letturaBranche = null;
    this.nomeFileBranche = '';
  }

  /** Nell'anteprima: di chi è quel codice, se è già nel sito. */
  nomeCapo(codice: number): string {
    const u = this.utenti.find(x => x.codice_censimento === codice);
    return u ? `${u.cognome} ${u.nome}` : 'non è tra i capi';
  }

  importaBranche() {
    const lettura = this.letturaBranche;
    if (!lettura?.righe.length) return;
    this.caricamentoBranche = true;
    this.erroreBranche = '';
    this.censiti.importaBrancheCapi(lettura.righe).subscribe({
      next: esito => {
        this.caricamentoBranche = false;
        this.letturaBranche = null;
        this.esitoBranche = {
          ...esito,
          scartate: [...lettura.scartate, ...esito.scartate].sort((a, b) => a.riga - b.riga),
        };
        this.caricaElenco();
      },
      error: (err: HttpErrorResponse) => {
        this.caricamentoBranche = false;
        this.erroreBranche = this.messaggioErrore(err, 'Aggiornamento non riuscito.');
      },
    });
  }

  importa() {
    const lettura = this.lettura;
    if (!lettura?.righe.length) return;

    this.caricamento = true;
    this.errore = '';
    this.censiti.importa(this.ruolo, lettura.righe).subscribe({
      next: esito => {
        this.caricamento = false;
        this.lettura = null;
        this.esito = {
          ...esito,
          scartate: [...lettura.scartate, ...esito.scartate].sort((a, b) => a.riga - b.riga),
        };
        this.caricaElenco();
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.errore = this.messaggioErrore(err, 'Importazione non riuscita.');
      },
    });
  }

  private caricaElenco() {
    this.censiti.elenco(this.tipo).subscribe({
      next: res => {
        this.utenti = res.utenti;
        this.branca = res.branca;
        this.capogruppo = res.capogruppo;
        this.elencoPronto = true;
      },
      error: (err: HttpErrorResponse) => {
        this.elencoPronto = true;
        this.errore = this.messaggioErrore(err, "Impossibile caricare l'elenco.");
      },
    });
  }

  private messaggioErrore(err: HttpErrorResponse, predefinito: string): string {
    if (err.status === 0) return 'Server non raggiungibile. Riprova tra poco.';
    return err.error?.error ?? predefinito;
  }
}
