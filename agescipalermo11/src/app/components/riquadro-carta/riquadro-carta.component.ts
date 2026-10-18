import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { AlertController, IonIcon, ToastController } from '@ionic/angular/standalone';
import {
  addOutline, arrowUpCircleOutline, documentTextOutline, downloadOutline, pencilOutline, trashOutline
} from 'ionicons/icons';
import { SfogliaPdfComponent } from '../sfoglia-pdf/sfoglia-pdf.component';
import { Observable } from 'rxjs';
import { CartaClanService } from '../../services/carta-clan';
import { CartaDiClan } from '../../../types/models';

/** Chi carica, cambia e toglie i documenti del riquadro (la Carta di Clan, il PEG). */
export interface ServizioDocumenti {
  readonly maxByte: number;
  carica(file: Blob, nome: string, titolo: string, anno: string): Observable<CartaDiClan>;
  aggiorna(id: number, dati: { titolo?: string; anno?: string | null; corrente?: boolean }): Observable<CartaDiClan>;
  elimina(id: number): Observable<unknown>;
  urlIntero(percorso: string): string;
}

/** Le parole del riquadro, che cambiano col documento. */
export interface TestiDocumento {
  nome: string;
  titoloBase: string;
  nuovo: string;
  modifica: string;
  caricaNuovo: string;
  caricaPrimo: string;
  nessuno: string;
  chiCarica: string;
  caricato: string;
  mettiInVigore: string;
  tornaInVigore: string;
  rimuovere: string;
  nomeFile: string;
}

export const TESTI_CARTA_CLAN: TestiDocumento = {
  nome: 'la Carta di Clan',
  titoloBase: 'Carta di Clan',
  nuovo: 'Nuova Carta di Clan',
  modifica: 'Modifica la Carta',
  caricaNuovo: 'Carica una nuova Carta di Clan',
  caricaPrimo: 'Carica la Carta di Clan',
  nessuno: 'Ancora nessuna Carta di Clan caricata.',
  chiCarica: 'La caricheranno i capi clan.',
  caricato: 'Carta di Clan caricata: la precedente è finita nell\'archivio.',
  mettiInVigore: 'Mettila in vigore',
  tornaInVigore: "torna nel riquadro del Clan, e quella di adesso finisce nell'archivio",
  rimuovere: 'Rimuovere la Carta?',
  nomeFile: 'carta-di-clan.pdf',
};

/**
 * Il riquadro di una Carta di Clan: si sfoglia pagina per pagina e si scarica.
 * Ai capi clan compaiono anche i pulsanti per cambiarne titolo e anno, per rimuoverla,
 * per rimetterla in vigore se sta nell'archivio e per caricarne una nuova.
 * Quando qualcosa cambia avvisa la pagina con (cambiate), che ricarica tutto.
 */
@Component({
  selector: 'app-riquadro-carta',
  templateUrl: './riquadro-carta.component.html',
  styleUrls: ['./riquadro-carta.component.scss'],
  standalone: true,
  imports: [IonIcon, SfogliaPdfComponent],
})
export class RiquadroCartaComponent {
  /** La Carta da mostrare: null quando non ce n'è ancora nessuna. */
  @Input() carta: CartaDiClan | null = null;
  /** Vero per i capi clan (e per un capogruppo che fa anche il capo clan). */
  @Input() puoGestire = false;
  /** In "pagina" il riquadro si allarga: serve nella pagina dedicata alla Carta. */
  @Input() modo: 'riquadro' | 'pagina' = 'riquadro';
  /** Nell'archivio il titolo sta già nella riga sopra: qui dentro si toglie. */
  @Input() intestazione = true;
  /** Il documento: di base la Carta di Clan; il PEG passa i suoi. */
  @Input() servizio: ServizioDocumenti | null = null;
  @Input() testi: TestiDocumento = TESTI_CARTA_CLAN;

  @Output() cambiate = new EventEmitter<void>();

  readonly icone = {
    carta: documentTextOutline, scarica: downloadOutline, modifica: pencilOutline,
    rimuovi: trashOutline, nuova: addOutline, inVigore: arrowUpCircleOutline,
  };

  /** Mentre il file sale: il pulsante resta spento. */
  caricamento = false;

  private cartaClan = inject(CartaClanService);
  private get carte(): ServizioDocumenti {
    return this.servizio ?? this.cartaClan;
  }
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);

  get url(): string {
    return this.carta ? this.carte.urlIntero(this.carta.url) : '';
  }

  /** "caricata da Marta Rover · 21 settembre 2026", se si sa chi e quando. */
  get firma(): string {
    if (!this.carta) return '';
    const giorno = new Date(this.carta.data_creazione);
    const quando = isNaN(giorno.getTime()) ? ''
      : giorno.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
    return [this.carta.autore, quando].filter(Boolean).join(' · ');
  }

  /** La misura del file scritta in modo leggibile. */
  get peso(): string {
    const byte = this.carta?.dimensione ?? 0;
    if (byte < 1024) return `${byte} B`;
    if (byte < 1024 * 1024) return `${Math.round(byte / 1024)} KB`;
    return `${(byte / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  }

  scarica() {
    if (!this.carta) return;
    const collegamento = document.createElement('a');
    collegamento.href = this.url;
    collegamento.download = this.carta.nome_file || this.testi.nomeFile;
    collegamento.target = '_blank';
    document.body.appendChild(collegamento);
    collegamento.click();
    collegamento.remove();
  }

  /** Il PDF scelto dal capo: quello che era in vigore scende nell'archivio. */
  async scegliFile(evento: Event) {
    const input = evento.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf')
      return this.avvisa(`Per ${this.testi.nome} serve un file PDF.`);
    if (file.size > this.carte.maxByte)
      return this.avvisa('Il file è troppo grande: al massimo 20 MB.');

    const dati = await this.chiediTitolo(this.testi.nuovo, this.testi.titoloBase, '');
    if (!dati) return;

    this.caricamento = true;
    this.carte.carica(file, file.name, dati.titolo, dati.anno).subscribe({
      next: () => {
        this.caricamento = false;
        this.avvisa(this.testi.caricato);
        this.cambiate.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.avvisa(err.error?.error ?? 'Non sono riuscito a caricare il file.');
      },
    });
  }

  async modifica() {
    if (!this.carta) return;
    const dati = await this.chiediTitolo(this.testi.modifica, this.carta.titolo, this.carta.anno ?? '');
    if (!dati) return;
    this.carte.aggiorna(this.carta.id, { titolo: dati.titolo, anno: dati.anno || null }).subscribe({
      next: () => this.cambiate.emit(),
      error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Non sono riuscito a salvare.'),
    });
  }

  /** Riporta nel riquadro una Carta che stava nell'archivio. */
  async mettiInVigore() {
    if (!this.carta) return;
    const alert = await this.alertCtrl.create({
      header: 'Rimetterla in vigore?',
      message: `"${this.carta.titolo}" ${this.testi.tornaInVigore}.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: this.testi.mettiInVigore, handler: () => {
            this.carte.aggiorna(this.carta!.id, { corrente: true }).subscribe({
              next: () => this.cambiate.emit(),
              error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Non sono riuscito a cambiarla.'),
            });
          },
        },
      ],
    });
    await alert.present();
  }

  async rimuovi() {
    if (!this.carta) return;
    const alert = await this.alertCtrl.create({
      header: this.testi.rimuovere,
      message: `"${this.carta.titolo}" viene cancellata e il file non si potrà più riaprire.`
        + (this.carta.corrente ? '\nNel riquadro andrà la più recente dell\'archivio.' : ''),
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Rimuovi', role: 'destructive', handler: () => {
            this.carte.elimina(this.carta!.id).subscribe({
              next: () => this.cambiate.emit(),
              error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Non sono riuscito a rimuoverla.'),
            });
          },
        },
      ],
    });
    await alert.present();
  }

  /** Chiede titolo e anno: torna null se si annulla. */
  private chiediTitolo(intestazione: string, titolo: string, anno: string) {
    return new Promise<{ titolo: string; anno: string } | null>(async risolvi => {
      const alert = await this.alertCtrl.create({
        header: intestazione,
        inputs: [
          { name: 'titolo', type: 'text', value: titolo, placeholder: 'Titolo', attributes: { maxlength: 120 } },
          { name: 'anno', type: 'text', value: anno, placeholder: 'Anno scout (es. 2025/2026)', attributes: { maxlength: 20 } },
        ],
        buttons: [
          { text: 'Annulla', role: 'cancel', handler: () => risolvi(null) },
          {
            text: 'Salva', handler: (valori: { titolo: string; anno: string }) => {
              const nome = (valori.titolo ?? '').trim();
              if (!nome) {
                this.avvisa('Serve un titolo.');
                return false;
              }
              risolvi({ titolo: nome, anno: (valori.anno ?? '').trim() });
              return true;
            },
          },
        ],
      });
      await alert.present();
    });
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 2600, position: 'top' });
    await toast.present();
  }
}
