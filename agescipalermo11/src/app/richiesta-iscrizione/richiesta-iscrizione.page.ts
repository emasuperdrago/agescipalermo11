import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import {
  IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref, IonContent
} from '@ionic/angular/standalone';
import {
  arrowBackOutline, checkmarkCircleOutline, homeOutline, paperPlaneOutline
} from 'ionicons/icons';
import { ANNI_SCOLASTICI, IscrizioniService, annoScolastico } from '../services/iscrizioni';
import { AnnoScolastico, Branca, DatiRichiestaIscrizione } from '../../types/models';
import { nomeBranca, stiliBranca } from '../services/posti';

/**
 * Modulo pubblico per chiedere di entrare nel gruppo (o iscrivere un figlio).
 * Non serve l'accesso: la richiesta arriva nelle notifiche dei capi della branca,
 * che il server ricava dall'anno scolastico scelto qui.
 */
@Component({
  selector: 'app-richiesta-iscrizione',
  templateUrl: './richiesta-iscrizione.page.html',
  styleUrls: ['./richiesta-iscrizione.page.scss'],
  standalone: true,
  imports: [
    FormsModule, RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent,
  ],
})
export class RichiestaIscrizionePage {
  readonly anni = ANNI_SCOLASTICI;
  readonly nomeBranca = nomeBranca;
  readonly stiliBranca = stiliBranca;
  readonly icone = {
    indietro: arrowBackOutline, invia: paperPlaneOutline, fatto: checkmarkCircleOutline, home: homeOutline,
  };

  dati: DatiRichiestaIscrizione = {
    nome: '', cognome: '', data_nascita: '', anno_scolastico: '', telefono: '', email: '', note: '',
    genitore1_nome: '', genitore1_cognome: '', genitore2_nome: '', genitore2_cognome: '',
  };

  /** Se mostrare anche i campi del secondo genitore (facoltativo). */
  secondoGenitore = false;
  inviando = false;
  errore = '';
  /** Dopo l'invio si mostra il ringraziamento al posto del modulo. */
  inviata = false;
  brancaAssegnata: Branca | null = null;

  // La data di nascita si sceglie da tre tendine invece che dal calendario del telefono:
  // niente formati diversi tra un dispositivo e l'altro e niente date impossibili.
  readonly mesi = [
    'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
  ];
  giorno = '';
  mese = '';
  annoNascita = '';

  constructor(private iscrizioni: IscrizioniService) {}

  /** Anni possibili, dal più recente: chi entra nel gruppo ha fra i 5 e i 30 anni. */
  get anniDiNascita(): number[] {
    const adesso = new Date().getFullYear();
    const anni: number[] = [];
    for (let a = adesso - 5; a >= adesso - 30; a--) anni.push(a);
    return anni;
  }

  /** Giorni del mese scelto: febbraio ne ha 28 o 29, e si vedono solo quelli veri. */
  get giorniDelMese(): number[] {
    const mese = Number(this.mese);
    const anno = Number(this.annoNascita);
    // Senza mese si mostrano 31 giorni; il giorno 0 del mese dopo è l'ultimo di questo.
    const quanti = mese ? new Date(anno || 2000, mese, 0).getDate() : 31;
    return Array.from({ length: quanti }, (_, i) => i + 1);
  }

  /** Rimette insieme la data come "AAAA-MM-GG" (giorno locale, come nel calendario). */
  aggiornaNascita() {
    // Cambiando mese o anno il giorno scelto può non esistere più (es. 31 febbraio).
    if (this.giorno && Number(this.giorno) > this.giorniDelMese.length) this.giorno = '';
    const due = (valore: string) => valore.padStart(2, '0');
    this.dati.data_nascita = this.giorno && this.mese && this.annoNascita
      ? `${this.annoNascita}-${due(this.mese)}-${due(this.giorno)}`
      : '';
    this.errore = '';
  }

  /** Branca e anno di percorso dell'anno scolastico scelto, da mostrare sotto la scelta. */
  get tappaScelta(): string {
    const anno = annoScolastico(this.dati.anno_scolastico);
    return anno ? `${nomeBranca(anno.branca)} · ${anno.tappa}` : '';
  }

  /** A chi è arrivata la richiesta, da scrivere nel ringraziamento. */
  get destinatario(): string {
    return this.brancaAssegnata ? `È arrivata ai capi del ${nomeBranca(this.brancaAssegnata)}` : 'È arrivata ai capi';
  }

  /** Toglie il secondo genitore: i suoi campi si svuotano, così non parte niente a metà. */
  togliSecondoGenitore() {
    this.secondoGenitore = false;
    this.dati.genitore2_nome = '';
    this.dati.genitore2_cognome = '';
  }

  scegliAnno(valore: AnnoScolastico) {
    this.dati.anno_scolastico = this.dati.anno_scolastico === valore ? '' : valore;
    // Scelto l'anno, l'avviso che lo chiedeva non ha più senso: va via subito.
    this.errore = '';
  }

  invia() {
    if (!this.dati.nome.trim() || !this.dati.cognome.trim()) {
      this.errore = 'Scrivi nome e cognome.';
      return;
    }
    if (!this.dati.data_nascita) {
      this.errore = 'Scrivi la data di nascita.';
      return;
    }
    if (!this.dati.anno_scolastico) {
      this.errore = "Scegli l'anno scolastico che si sta facendo adesso.";
      return;
    }
    if (!this.dati.genitore1_nome.trim() || !this.dati.genitore1_cognome.trim()) {
      this.errore = 'Scrivi nome e cognome di almeno un genitore.';
      return;
    }
    if (!!this.dati.genitore2_nome.trim() !== !!this.dati.genitore2_cognome.trim()) {
      this.errore = 'Del secondo genitore servono sia il nome sia il cognome.';
      return;
    }
    if (!this.dati.telefono.trim() && !this.dati.email.trim()) {
      this.errore = 'Lascia almeno un contatto: telefono o email.';
      return;
    }

    this.inviando = true;
    this.errore = '';
    this.iscrizioni.invia(this.dati).subscribe({
      next: risposta => {
        this.inviata = true;
        this.brancaAssegnata = risposta.branca;
      },
      error: (err: HttpErrorResponse) => {
        this.inviando = false;
        this.errore = err.status === 0 ? 'Server non raggiungibile. Riprova tra poco.'
          : err.status === 404 && !err.error?.error ? 'Il server non gestisce ancora le iscrizioni: va riavviato il backend.'
            : err.error?.error ?? `Invio non riuscito (errore ${err.status}). Riprova.`;
      },
    });
  }

  /** Per mandare una seconda richiesta, es. un altro figlio. */
  nuovaRichiesta() {
    this.dati = {
      nome: '', cognome: '', data_nascita: '', anno_scolastico: '', telefono: '', email: '', note: '',
    genitore1_nome: '', genitore1_cognome: '', genitore2_nome: '', genitore2_cognome: '',
    };
    this.inviata = false;
    this.inviando = false;
    this.brancaAssegnata = null;
    this.secondoGenitore = false;
  }
}
