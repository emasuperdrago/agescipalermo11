import { Component, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, ModalController, ToastController
} from '@ionic/angular/standalone';
import { addOutline, closeOutline, downloadOutline, saveOutline, searchOutline, trashOutline } from 'ionicons/icons';
import { SfogliaPdfComponent } from '../sfoglia-pdf/sfoglia-pdf.component';
import { SelettoreDataComponent } from '../selettore-data/selettore-data.component';
import { AuthService } from '../../services/auth';
import { CantiService, PARTI_MESSA } from '../../services/canti';
import { BozzaLibretto, DatiLibretto, ParteMessa } from '../../../types/models';

/** Per cercare senza badare a maiuscole e accenti ("cantero" trova "Canterò"). */
const normalizza = (testo: string) => testo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Dopo quanto dall'ultima modifica si rifà l'anteprima (così non parte a ogni lettera). */
const ATTESA_ANTEPRIMA = 700;

/**
 * Anteprima del libretto dei canti scelti, prima di scaricarlo: evento, data e luogo per la
 * copertina, libretto per la messa (canti nelle varie parti), con o senza accordi, carattere
 * grande. L'anteprima è il PDF vero: quello che si vede è quello che si scarica.
 * I capi lo possono salvare nelle bozze. Si chiude con role "salvato" se ha salvato una bozza.
 */
@Component({
  selector: 'app-anteprima-libretto',
  templateUrl: './anteprima-libretto.component.html',
  styleUrls: ['./anteprima-libretto.component.scss'],
  standalone: true,
  imports: [
    FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon,
    SfogliaPdfComponent, SelettoreDataComponent,
  ],
})
export class AnteprimaLibrettoComponent implements OnInit, OnDestroy {
  /** I canti scelti nel canzoniere (se si apre una bozza, arrivano da lei). */
  @Input() ids: number[] = [];
  /** Una bozza da riaprire. */
  @Input() bozza?: BozzaLibretto;

  readonly icone = {
    chiudi: closeOutline, scarica: downloadOutline, salva: saveOutline, aggiungi: addOutline, togli: trashOutline,
    cerca: searchOutline,
  };
  readonly partiMessa = PARTI_MESSA;

  private canti = inject(CantiService);
  private auth = inject(AuthService);
  private modalCtrl = inject(ModalController);
  private toastCtrl = inject(ToastController);

  /** I canti scelti, con il titolo, in ordine alfabetico. */
  scelti: { id: number; titolo: string }[] = [];
  /** Tutto il canzoniere, per aggiungere altri canti con la ricerca. */
  private tutti: { id: number; titolo: string }[] = [];
  ricerca = '';
  evento = '';
  data: string | null = null;
  luogo = '';
  messa = false;
  /** Per ogni parte della messa i canti scelti (null = la tendina è ancora vuota). */
  parti: Record<ParteMessa, (number | null)[]> = this.partiVuote();
  accordi = true;
  grande = false;
  /** Due colonne per pagina: il libretto prende circa la metà dei fogli. */
  dueColonne = true;
  /** Le opzioni toccate a mano non si cambiano più da sole accendendo la messa. */
  private opzioniToccate = false;

  urlAnteprima = '';
  private filePdf: Blob | null = null;
  aggiornando = false;
  errore = '';
  salvando = false;
  private idBozza: number | null = null;
  private salvata = false;
  private timer?: ReturnType<typeof setTimeout>;
  /** È cambiato qualcosa e l'anteprima nuova deve ancora partire. */
  private inAttesa = false;
  private richiesta = 0;

  get puoSalvare(): boolean {
    const ruolo = this.auth.utente?.ruolo;
    return ruolo === 'capo' || ruolo === 'admin';
  }

  ngOnInit() {
    const da = this.bozza?.libretto;
    if (da) {
      this.idBozza = this.bozza!.id;
      this.ids = da.ids;
      this.evento = da.evento;
      this.data = da.data || null;
      this.luogo = da.luogo;
      this.messa = da.messa;
      this.accordi = da.accordi;
      this.grande = da.grande;
      this.dueColonne = da.dueColonne ?? true;
      this.opzioniToccate = true;
      for (const p of PARTI_MESSA) this.parti[p.valore] = [...(da.parti[p.valore] ?? [])];
    }
    // I titoli dei canti: dall'elenco completo (i canti eliminati nel frattempo spariscono).
    this.canti.elenco().subscribe({
      next: tutti => {
        this.tutti = tutti.map(c => ({ id: c.id, titolo: c.titolo }));
        const perId = new Map(tutti.map(c => [c.id, c.titolo]));
        this.scelti = this.ids.filter(id => perId.has(id)).map(id => ({ id, titolo: perId.get(id)! }))
          .sort((a, b) => a.titolo.localeCompare(b.titolo, 'it'));
        const validi = new Set(this.scelti.map(c => c.id));
        for (const p of PARTI_MESSA) this.parti[p.valore] = this.parti[p.valore].filter(id => id === null || validi.has(id));
        this.aggiorna(0);
      },
      error: () => this.errore = 'Non riesco a leggere i canti. Riprova tra poco.',
    });
  }

  ngOnDestroy() {
    clearTimeout(this.timer);
    if (this.urlAnteprima) URL.revokeObjectURL(this.urlAnteprima);
  }

  private partiVuote(): Record<ParteMessa, (number | null)[]> {
    const vuote = {} as Record<ParteMessa, (number | null)[]>;
    for (const p of PARTI_MESSA) vuote[p.valore] = [];
    return vuote;
  }

  // ---------- I canti del libretto ----------

  /** I canti del canzoniere che si possono ancora aggiungere, trovati col titolo. */
  get trovati(): { id: number; titolo: string }[] {
    const cerca = normalizza(this.ricerca);
    if (!cerca) return [];
    const gia = new Set(this.scelti.map(c => c.id));
    return this.tutti.filter(c => !gia.has(c.id) && normalizza(c.titolo).includes(cerca)).slice(0, 8);
  }

  aggiungiCanto(canto: { id: number; titolo: string }) {
    this.scelti = [...this.scelti, canto].sort((a, b) => a.titolo.localeCompare(b.titolo, 'it'));
    this.ricerca = '';
    this.cambiato();
  }

  /** Toglie il canto dal libretto, e quindi anche dalle parti della messa. */
  togliCanto(id: number) {
    this.scelti = this.scelti.filter(c => c.id !== id);
    for (const p of PARTI_MESSA) this.parti[p.valore] = this.parti[p.valore].map(x => x === id ? null : x);
    this.cambiato();
  }

  /** Le tendine di una parte: almeno una, anche vuota. */
  tendine(parte: ParteMessa): (number | null)[] {
    return this.parti[parte].length ? this.parti[parte] : [null];
  }

  scegli(parte: ParteMessa, posto: number, id: number | null) {
    const lista = [...this.tendine(parte)];
    lista[posto] = id;
    this.parti[parte] = lista;
    this.cambiato();
  }

  aggiungiTendina(parte: ParteMessa) {
    this.parti[parte] = [...this.tendine(parte), null];
  }

  togliTendina(parte: ParteMessa, posto: number) {
    this.parti[parte] = this.tendine(parte).filter((_, i) => i !== posto);
    this.cambiato();
  }

  /** I canti scelti che non sono in nessuna parte: finiscono in fondo, in "Altri canti". */
  get altriCanti(): string[] {
    const usati = new Set<number | null>();
    for (const p of PARTI_MESSA) for (const id of this.parti[p.valore]) usati.add(id);
    return this.scelti.filter(c => !usati.has(c.id)).map(c => c.titolo);
  }

  alternaMessa() {
    // Il libretto della messa lo legge l'assemblea: di solito solo parole e carattere grande.
    if (this.messa && !this.opzioniToccate) {
      this.accordi = false;
      this.grande = true;
    }
    this.cambiato();
  }

  toccaOpzione() {
    this.opzioniToccate = true;
    this.cambiato();
  }

  /** Qualcosa è cambiato: l'anteprima si rifà poco dopo. */
  cambiato() {
    this.aggiorna(ATTESA_ANTEPRIMA);
  }

  private dati(): DatiLibretto {
    const parti: DatiLibretto['parti'] = {};
    if (this.messa) for (const p of PARTI_MESSA)
      parti[p.valore] = this.parti[p.valore].filter((id): id is number => id !== null);
    return {
      ids: this.scelti.map(c => c.id), evento: this.evento.trim(), data: this.data ?? '', luogo: this.luogo.trim(),
      messa: this.messa, parti, accordi: this.accordi, grande: this.grande, dueColonne: this.dueColonne,
    };
  }

  private aggiorna(attesa: number) {
    clearTimeout(this.timer);
    this.inAttesa = true;
    this.timer = setTimeout(() => this.creaAnteprima(), attesa);
  }

  private creaAnteprima(): Promise<Blob | null> {
    clearTimeout(this.timer);
    this.inAttesa = false;
    if (!this.scelti.length) {
      // Senza canti non c'è niente da mostrare.
      if (this.urlAnteprima) URL.revokeObjectURL(this.urlAnteprima);
      this.urlAnteprima = '';
      this.filePdf = null;
      return Promise.resolve(null);
    }
    const mia = ++this.richiesta;
    this.aggiornando = true;
    this.errore = '';
    return new Promise(fatto => {
      this.canti.pdfLibretto(this.dati()).subscribe({
        next: file => {
          // Nel frattempo è partita un'altra anteprima: questa non serve più.
          if (mia !== this.richiesta) return fatto(null);
          if (this.urlAnteprima) URL.revokeObjectURL(this.urlAnteprima);
          this.filePdf = file;
          this.urlAnteprima = URL.createObjectURL(file);
          this.aggiornando = false;
          fatto(file);
        },
        error: (err: HttpErrorResponse) => {
          if (mia !== this.richiesta) return fatto(null);
          this.aggiornando = false;
          this.errore = err.status === 0 ? 'Server non raggiungibile. Riprova tra poco.'
            : err.status === 404 ? 'Il server non sa ancora fare i libretti: va riavviato il backend.'
              : 'Non sono riuscito a preparare il PDF.';
          fatto(null);
        },
      });
    });
  }

  /** Scarica il PDF così com'è nell'anteprima (se c'era una modifica in sospeso, lo rifà prima). */
  async scarica() {
    const file = this.inAttesa || this.aggiornando || !this.filePdf ? await this.creaAnteprima() : this.filePdf;
    if (!file) return;
    const indirizzo = URL.createObjectURL(file);
    const collegamento = document.createElement('a');
    collegamento.href = indirizzo;
    collegamento.download = `${(this.evento.trim() || 'canzoniere').replace(/[\\/:*?"<>|]/g, '')}.pdf`;
    document.body.appendChild(collegamento);
    collegamento.click();
    collegamento.remove();
    setTimeout(() => URL.revokeObjectURL(indirizzo), 60_000);
  }

  salvaBozza() {
    this.salvando = true;
    this.canti.salvaBozza(this.dati(), this.idBozza).subscribe({
      next: bozza => {
        this.salvando = false;
        this.salvata = true;
        this.idBozza = bozza.id;
        this.avvisa('Salvato nelle bozze.');
      },
      error: (err: HttpErrorResponse) => {
        this.salvando = false;
        this.avvisa(err.error?.error ?? 'Non sono riuscito a salvare la bozza.');
      },
    });
  }

  chiudi() {
    this.modalCtrl.dismiss(null, this.salvata ? 'salvato' : 'annulla');
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 2000, position: 'top' });
    await toast.present();
  }
}
