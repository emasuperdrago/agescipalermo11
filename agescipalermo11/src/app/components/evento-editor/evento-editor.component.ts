import { Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, ModalController
} from '@ionic/angular/standalone';
import { closeOutline, flag, flagOutline } from 'ionicons/icons';
import {
  BRANCHE_EVENTO, ETICHETTE_EVENTO, EventiService, aggiungiGiorni, normalizzaEtichette
} from '../../services/eventi';
import { DatiEvento, EtichettaEvento, Evento } from '../../../types/models';
import { SelettoreDataComponent } from '../selettore-data/selettore-data.component';

/** Pop-up per creare un evento o, se riceve `evento`, modificarlo. Si chiude con role "salvato". */
@Component({
  selector: 'app-evento-editor',
  templateUrl: './evento-editor.component.html',
  styleUrls: ['./evento-editor.component.scss'],
  standalone: true,
  imports: [
    FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, SelettoreDataComponent,
  ],
})
export class EventoEditorComponent implements OnInit {
  @Input() evento?: Evento;
  /** Giorno selezionato nel calendario, usato come data di un nuovo evento. */
  @Input() dataIniziale = '';

  readonly etichette = ETICHETTE_EVENTO;
  readonly icone = { chiudi: closeOutline, evidenza: flag, evidenzaVuota: flagOutline };

  titolo = '';
  dataInizio = '';
  piuGiorni = false;
  dataFine = '';
  oraInizio = '';
  oraFine = '';
  luogo = '';
  descrizione = '';
  /** Etichette scelte: una o più branche, oppure solo Gruppo, oppure solo Capi. */
  scelte = new Set<EtichettaEvento>();
  inEvidenza = false;

  salvando = false;
  errore = '';

  constructor(private modalCtrl: ModalController, private eventi: EventiService) {}

  ngOnInit() {
    const e = this.evento;
    if (!e) {
      this.dataInizio = this.dataIniziale;
      return;
    }
    this.titolo = e.titolo;
    this.dataInizio = e.data_inizio;
    this.piuGiorni = !!e.data_fine;
    this.dataFine = e.data_fine ?? '';
    this.oraInizio = e.ora_inizio ?? '';
    this.oraFine = e.ora_fine ?? '';
    this.luogo = e.luogo ?? '';
    this.descrizione = e.descrizione ?? '';
    this.scelte = new Set(e.etichette);
    this.inEvidenza = e.in_evidenza;
  }

  get modifica(): boolean {
    return !!this.evento;
  }

  /** Una branca risulta scelta anche quando c'è "Gruppo" (che vuol dire tutte e tre). */
  scelta(etichetta: EtichettaEvento): boolean {
    if (this.scelte.has(etichetta)) return true;
    return BRANCHE_EVENTO.includes(etichetta) && this.scelte.has('gruppo');
  }

  alternaEtichetta(etichetta: EtichettaEvento) {
    // Gruppo e Capi stanno da soli: sceglierli toglie le altre etichette.
    if (etichetta === 'gruppo' || etichetta === 'capi') {
      this.scelte = this.scelte.has(etichetta) ? new Set() : new Set([etichetta]);
      return;
    }
    // Con "Gruppo" sono scelte tutte le branche: toccarne una la toglie e restano le altre due.
    const branche = new Set(this.scelte.has('gruppo') ? BRANCHE_EVENTO : [...this.scelte].filter(e => BRANCHE_EVENTO.includes(e)));
    if (branche.has(etichetta)) branche.delete(etichetta);
    else branche.add(etichetta);
    // Tutte e tre le branche diventano "Gruppo".
    this.scelte = new Set(branche.size ? normalizzaEtichette(branche) : []);
  }

  alternaPiuGiorni() {
    // Proposta comoda: la fine parte dal giorno dopo l'inizio.
    if (this.piuGiorni && !this.dataFine && this.dataInizio) {
      this.dataFine = aggiungiGiorni(this.dataInizio, 1);
    }
  }

  private valida(): string | null {
    if (!this.titolo.trim()) return 'Il titolo è obbligatorio.';
    if (!this.dataInizio) return 'Scegli la data dell\'evento.';
    if (this.piuGiorni && !this.dataFine) return 'Scegli la data di fine.';
    if (this.piuGiorni && this.dataFine < this.dataInizio) return 'La data di fine non può essere prima di quella di inizio.';
    const stessoGiorno = !this.piuGiorni || this.dataFine === this.dataInizio;
    if (this.oraInizio && this.oraFine && stessoGiorno && this.oraFine <= this.oraInizio)
      return 'L\'ora di fine deve essere dopo quella di inizio.';
    if (!this.scelte.size) return 'Scegli almeno un\'etichetta.';
    return null;
  }

  chiudi() {
    this.modalCtrl.dismiss(null, 'annulla');
  }

  salva() {
    const errore = this.valida();
    if (errore) {
      this.errore = errore;
      return;
    }

    const dati: DatiEvento = {
      titolo: this.titolo.trim(),
      data_inizio: this.dataInizio,
      data_fine: this.piuGiorni ? this.dataFine : null,
      ora_inizio: this.oraInizio || null,
      ora_fine: this.oraFine || null,
      luogo: this.luogo.trim() || null,
      descrizione: this.descrizione.trim() || null,
      etichette: normalizzaEtichette(this.scelte),
      in_evidenza: this.inEvidenza,
    };

    this.salvando = true;
    this.errore = '';
    const richiesta = this.evento ? this.eventi.aggiorna(this.evento.id, dati) : this.eventi.crea(dati);
    richiesta.subscribe({
      next: evento => this.modalCtrl.dismiss(evento, 'salvato'),
      error: (err: HttpErrorResponse) => {
        this.salvando = false;
        this.errore = err.status === 0 ? 'Server non raggiungibile. Riprova tra poco.'
          : err.status === 404 && !err.error?.error ? 'Il server non gestisce ancora il calendario: va riavviato il backend.'
          : err.error?.error ?? `Salvataggio non riuscito (errore ${err.status}). Riprova.`;
      },
    });
  }
}
