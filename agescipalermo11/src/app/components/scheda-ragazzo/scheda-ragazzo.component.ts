import { Component, ElementRef, Input, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AlertController, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon,
  ModalController, ToastController
} from '@ionic/angular/standalone';
import {
  attachOutline, closeOutline, documentTextOutline, downloadOutline, lockClosedOutline, trashOutline
} from 'ionicons/icons';
import { ZonaCapiService } from '../../services/zona-capi';
import { dimensioneLeggibile } from '../../services/posti';
import { AllegatoScheda, CampiScheda, RagazzoElenco, SchedaRagazzo } from '../../../types/models';

const MAX_BYTE_PDF = 15 * 1024 * 1024;

/**
 * Scheda personale di un ragazzo: indirizzo, genitori, note sanitarie e PDF allegati
 * (es. la scheda medica). La aprono i capi della sua branca e i capigruppo.
 * Si chiude con role "salvato" se è cambiato qualcosa (anche solo un allegato).
 */
@Component({
  selector: 'app-scheda-ragazzo',
  templateUrl: './scheda-ragazzo.component.html',
  styleUrls: ['./scheda-ragazzo.component.scss'],
  standalone: true,
  imports: [FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon],
})
export class SchedaRagazzoComponent implements OnInit {
  @Input({ required: true }) ragazzo!: RagazzoElenco;

  @ViewChild('scegliPdf') private scegliPdf?: ElementRef<HTMLInputElement>;

  readonly icone = {
    chiudi: closeOutline, allega: attachOutline, pdf: documentTextOutline, scarica: downloadOutline,
    elimina: trashOutline, riservato: lockClosedOutline,
  };
  readonly dimensioneLeggibile = dimensioneLeggibile;

  private modalCtrl = inject(ModalController);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);
  private zona = inject(ZonaCapiService);

  scheda: SchedaRagazzo | null = null;
  campi: CampiScheda = {
    indirizzo: '', genitore1_nome: '', genitore1_cognome: '', genitore1_telefono: '', genitore1_email: '',
    genitore2_nome: '', genitore2_cognome: '', genitore2_telefono: '', genitore2_email: '', note_sanitarie: '',
    note: '',
  };
  /** Il secondo genitore si mostra se c'è già o se lo si aggiunge. */
  secondoGenitore = false;
  caricamento = true;
  salvando = false;
  caricandoPdf = false;
  errore = '';
  /** Qualcosa è cambiato: alla chiusura la tabella si ricarica (es. il numero di PDF). */
  private cambiata = false;

  ngOnInit() {
    this.zona.scheda(this.ragazzo.id).subscribe({
      next: scheda => {
        this.scheda = scheda;
        const { da_richiesta, data_modifica, modificata_da, ...campi } = scheda.scheda;
        this.campi = campi;
        this.secondoGenitore = !!(campi.genitore2_nome || campi.genitore2_cognome
          || campi.genitore2_telefono || campi.genitore2_email);
        this.caricamento = false;
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.errore = err.status === 404 && !err.error?.error
          ? 'Il server non gestisce ancora le schede: va riavviato il backend.'
          : err.error?.error ?? 'Impossibile aprire la scheda. Riprova tra poco.';
      },
    });
  }

  get titolo(): string {
    return `${this.ragazzo.nome} ${this.ragazzo.cognome}`;
  }

  /** "12 marzo 2017 · 9 anni". */
  get nascita(): string {
    const r = this.scheda?.ragazzo;
    if (!r?.data_nascita) return '—';
    const [a, m, g] = r.data_nascita.split('-').map(Number);
    const data = new Date(a, m - 1, g).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
    return r.eta !== null ? `${data} · ${r.eta} anni` : data;
  }

  get ultimaModifica(): string {
    const s = this.scheda?.scheda;
    if (!s?.data_modifica) return '';
    const quando = new Date(s.data_modifica).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
    return s.modificata_da ? `Ultima modifica il ${quando}, da ${s.modificata_da}` : `Dati arrivati il ${quando}`;
  }

  dataAllegato(a: AllegatoScheda): string {
    return new Date(a.data_caricamento).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  togliSecondoGenitore() {
    this.secondoGenitore = false;
    this.campi.genitore2_nome = this.campi.genitore2_cognome = '';
    this.campi.genitore2_telefono = this.campi.genitore2_email = '';
  }

  salva() {
    this.salvando = true;
    this.errore = '';
    this.zona.salvaScheda(this.ragazzo.id, this.campi).subscribe({
      next: () => {
        this.salvando = false;
        this.cambiata = true;
        this.avvisa('Scheda salvata.');
        this.modalCtrl.dismiss(null, 'salvato');
      },
      error: (err: HttpErrorResponse) => {
        this.salvando = false;
        this.errore = err.status === 0 ? 'Server non raggiungibile. Riprova tra poco.'
          : err.error?.error ?? `Salvataggio non riuscito (errore ${err.status}). Riprova.`;
      },
    });
  }

  // ---------- PDF allegati ----------

  scegliFile() {
    this.scegliPdf?.nativeElement.click();
  }

  allega(evento: Event) {
    const campo = evento.target as HTMLInputElement;
    const file = campo.files?.[0];
    campo.value = '';
    if (!file || !this.scheda) return;
    if (!/\.pdf$/i.test(file.name)) {
      this.errore = 'Nella scheda si allegano solo file PDF.';
      return;
    }
    if (file.size > MAX_BYTE_PDF) {
      this.errore = 'Il PDF è troppo grande: il massimo è 15 MB.';
      return;
    }
    this.caricandoPdf = true;
    this.errore = '';
    this.zona.allegaAllaScheda(this.ragazzo.id, file).subscribe({
      next: allegato => {
        this.caricandoPdf = false;
        this.cambiata = true;
        this.scheda?.allegati.push(allegato);
      },
      error: (err: HttpErrorResponse) => {
        this.caricandoPdf = false;
        this.errore = err.status === 413 ? 'Il PDF è troppo grande: il massimo è 15 MB.'
          : err.error?.error ?? 'Non sono riuscito ad allegare il PDF. Riprova.';
      },
    });
  }

  apri(allegato: AllegatoScheda) {
    this.zona.scaricaAllegatoScheda(this.ragazzo.id, allegato.id).subscribe({
      next: file => {
        const indirizzo = URL.createObjectURL(file);
        const collegamento = document.createElement('a');
        collegamento.href = indirizzo;
        collegamento.download = allegato.nome;
        collegamento.target = '_blank';
        collegamento.click();
        // Il file resta solo il tempo di aprirlo.
        setTimeout(() => URL.revokeObjectURL(indirizzo), 60_000);
      },
      error: () => this.avvisa('Non sono riuscito ad aprire il PDF.'),
    });
  }

  async elimina(allegato: AllegatoScheda) {
    const alert = await this.alertCtrl.create({
      header: 'Eliminare il PDF?',
      message: `"${allegato.nome}" viene tolto dalla scheda. Non si torna indietro.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Elimina', role: 'destructive', handler: () => {
            this.zona.eliminaAllegatoScheda(this.ragazzo.id, allegato.id).subscribe({
              next: () => {
                this.cambiata = true;
                if (this.scheda) this.scheda.allegati = this.scheda.allegati.filter(a => a.id !== allegato.id);
              },
              error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Non sono riuscito a eliminarlo.'),
            });
          },
        },
      ],
    });
    await alert.present();
  }

  chiudi() {
    this.modalCtrl.dismiss(null, this.cambiata ? 'salvato' : 'annulla');
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 2200, position: 'bottom' });
    await toast.present();
  }
}
