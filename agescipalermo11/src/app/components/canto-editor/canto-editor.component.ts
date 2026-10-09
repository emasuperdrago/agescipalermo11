import { Component, ElementRef, Input, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, ModalController
} from '@ionic/angular/standalone';
import { closeOutline } from 'ionicons/icons';
import {
  CantiService, SEGNO_ACCORDI, SEGNO_GRASSETTO, SEGNO_TESTO, SEZIONI_CANTO, segnoRiga, senzaSegniGrassetto
} from '../../services/canti';
import { Canto, DatiCanto, SezioneCanto } from '../../../types/models';

/** Pop-up per aggiungere un canto o, se riceve `canto`, modificarlo. Si chiude con role "salvato". */
@Component({
  selector: 'app-canto-editor',
  templateUrl: './canto-editor.component.html',
  styleUrls: ['./canto-editor.component.scss'],
  standalone: true,
  imports: [FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon],
})
export class CantoEditorComponent implements OnInit {
  @Input() canto?: Canto;
  /** Sezione già filtrata nell'elenco: si propone quella. */
  @Input() sezioneIniziale: SezioneCanto | null = null;

  @ViewChild('areaTesto') private areaTesto?: ElementRef<HTMLTextAreaElement>;

  readonly sezioni = SEZIONI_CANTO;
  readonly icone = { chiudi: closeOutline };
  readonly segnoTesto = SEGNO_TESTO;
  readonly segnoAccordi = SEGNO_ACCORDI;

  titolo = '';
  sezione: SezioneCanto | '' = '';
  testo = '';

  salvando = false;
  errore = '';

  constructor(private modalCtrl: ModalController, private canti: CantiService) {}

  ngOnInit() {
    if (this.canto) {
      this.titolo = this.canto.titolo;
      this.sezione = this.canto.sezione;
      this.testo = this.canto.testo;
      return;
    }
    this.sezione = this.sezioneIniziale ?? '';
  }

  get modifica(): boolean {
    return !!this.canto;
  }

  /**
   * Mette in grassetto la parte selezionata (o toglie il grassetto se c'era già),
   * scrivendola tra asterischi: **così**. Funziona anche con Cmd/Ctrl + B.
   * Se la scelta prende più righe, ogni riga viene segnata per conto suo: gli asterischi
   * valgono riga per riga, come gli accordi.
   */
  alternaGrassetto() {
    const area = this.areaTesto?.nativeElement;
    if (!area) return;
    const inizio = area.selectionStart;
    const fine = area.selectionEnd;
    const scelto = this.testo.slice(inizio, fine);
    const prima = this.testo.slice(0, inizio);
    const dopo = this.testo.slice(fine);
    const segno = SEGNO_GRASSETTO;

    // Niente di scelto: si aprono gli asterischi e si scrive dentro.
    if (!scelto) {
      if (prima.endsWith(segno) && dopo.startsWith(segno)) {
        this.testo = prima.slice(0, -segno.length) + dopo.slice(segno.length);
        this.rimettiCursore(area, inizio - segno.length, inizio - segno.length);
        return;
      }
      this.testo = prima + segno + segno + dopo;
      this.rimettiCursore(area, inizio + segno.length, inizio + segno.length);
      return;
    }

    // Il cursore è dentro a una parte già in grassetto: si tolgono gli asterischi intorno.
    if (!scelto.includes('\n') && prima.endsWith(segno) && dopo.startsWith(segno)) {
      this.testo = prima.slice(0, -segno.length) + scelto + dopo.slice(segno.length);
      this.rimettiCursore(area, inizio - segno.length, inizio - segno.length + scelto.length);
      return;
    }

    const righe = scelto.split('\n').map(riga => {
      const cuore = riga.trim();
      const spazioPrima = riga.slice(0, riga.length - riga.replace(/^\s+/, '').length);
      const spazioDopo = riga.slice(riga.replace(/\s+$/, '').length);
      return { cuore, spazioPrima, spazioDopo };
    });
    const piene = righe.filter(r => r.cuore);
    if (!piene.length) return;

    // Si toglie il grassetto solo se ce l'hanno già tutte le righe scelte.
    const giaInGrassetto = piene.every(r =>
      r.cuore.startsWith(segno) && r.cuore.endsWith(segno)
      && r.cuore.length >= segno.length * 2 + 1
      && senzaSegniGrassetto(r.cuore) === r.cuore.slice(segno.length, -segno.length));

    const nuovoScelto = righe.map(r => {
      if (!r.cuore) return r.spazioPrima + r.spazioDopo;
      // Gli asterischi già dentro alla riga si tolgono: così il grassetto vale per tutta la riga.
      const pulito = senzaSegniGrassetto(r.cuore);
      const cuore = giaInGrassetto ? pulito : segno + pulito + segno;
      return r.spazioPrima + cuore + r.spazioDopo;
    }).join('\n');

    this.testo = prima + nuovoScelto + dopo;
    this.rimettiCursore(area, inizio, inizio + nuovoScelto.length);
  }

  /**
   * Segna le righe dove sta il cursore (o quelle scelte) come testo o come accordi, quando il
   * sito da solo sbaglierebbe: es. "La la la la", che sono parole e non l'accordo LA.
   * Il segno va all'inizio della riga e chi legge il canto non lo vede. Se le righe avevano
   * già quel segno, si toglie.
   */
  segnaRighe(tipo: 'testo' | 'accordi') {
    const area = this.areaTesto?.nativeElement;
    if (!area) return;
    const segno = tipo === 'testo' ? SEGNO_TESTO : SEGNO_ACCORDI;
    // Dall'inizio della prima riga toccata alla fine dell'ultima.
    const inizio = this.testo.lastIndexOf('\n', area.selectionStart - 1) + 1;
    const fineScelta = area.selectionEnd > area.selectionStart && this.testo[area.selectionEnd - 1] === '\n'
      ? area.selectionEnd - 1 : area.selectionEnd;
    const a = this.testo.indexOf('\n', fineScelta);
    const fine = a === -1 ? this.testo.length : a;

    const righe = this.testo.slice(inizio, fine).split('\n');
    const piene = righe.filter(r => segnoRiga(r).riga.trim());
    if (!piene.length) return;
    const giaSegnate = piene.every(r => segnoRiga(r).forzata === tipo);
    const nuove = righe.map(r => {
      const pulita = segnoRiga(r).riga;
      if (!pulita.trim()) return pulita;
      return giaSegnate ? pulita : segno + pulita;
    }).join('\n');

    this.testo = this.testo.slice(0, inizio) + nuove + this.testo.slice(fine);
    this.rimettiCursore(area, inizio, inizio + nuove.length);
  }

  /** Il cursore resta sulla parte scelta, pronta da continuare a scrivere. */
  private rimettiCursore(area: HTMLTextAreaElement, inizio: number, fine: number) {
    setTimeout(() => {
      area.focus();
      area.setSelectionRange(inizio, fine);
    });
  }

  chiudi() {
    this.modalCtrl.dismiss(null, 'annulla');
  }

  salva() {
    if (!this.titolo.trim()) {
      this.errore = 'Scrivi il titolo del canto.';
      return;
    }
    if (!this.sezione) {
      this.errore = 'Scegli la sezione del canzoniere.';
      return;
    }
    if (!this.testo.trim()) {
      this.errore = 'Scrivi il testo del canto.';
      return;
    }

    const dati: DatiCanto = { titolo: this.titolo.trim(), sezione: this.sezione, testo: this.testo };
    this.salvando = true;
    this.errore = '';
    const richiesta = this.canto ? this.canti.aggiorna(this.canto.id, dati) : this.canti.crea(dati);
    richiesta.subscribe({
      next: canto => this.modalCtrl.dismiss(canto, 'salvato'),
      error: (err: HttpErrorResponse) => {
        this.salvando = false;
        this.errore = err.status === 0 ? 'Server non raggiungibile. Riprova tra poco.'
          : err.status === 404 && !err.error?.error ? 'Il server non gestisce ancora il canzoniere: va riavviato il backend.'
            : err.error?.error ?? `Salvataggio non riuscito (errore ${err.status}). Riprova.`;
      },
    });
  }
}
