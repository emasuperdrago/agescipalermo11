import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref,
  IonContent, ModalController, NavController, ToastController
} from '@ionic/angular/standalone';
import {
  addOutline, arrowBackOutline, downloadOutline, musicalNotesOutline, pencilOutline, refreshOutline, removeOutline,
  trashOutline
} from 'ionicons/icons';
import { AuthService } from '../services/auth';
import {
  Alterazioni, CantiService, RigaCanto, coloreSezione, haAccordi, nomeSezione, nomeTonalita, righeCanto
} from '../services/canti';
import { CantoEditorComponent } from '../components/canto-editor/canto-editor.component';
import { Canto } from '../../types/models';

/** Fin dove si sposta il capotasto (oltre, le corde sono troppo corte per suonare bene). */
const MAX_CAPOTASTO = 7;

/**
 * Pagina di un canto: testo con gli accordi, che si possono nascondere o spostare di tonalità.
 * Il canto si apre nella tonalità del gruppo (scelta dai capi); chi legge la può cambiare per
 * sé, mettere il capotasto e scaricare il PDF così com'è. Il testo salvato non cambia mai.
 */
@Component({
  selector: 'app-dettaglio-canzoniere',
  templateUrl: './dettaglio-canzoniere.page.html',
  styleUrls: ['./dettaglio-canzoniere.page.scss'],
  standalone: true,
  imports: [
    FormsModule, RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref,
    IonContent,
  ],
})
export class DettaglioCanzonierePage implements OnInit {
  readonly icone = {
    indietro: arrowBackOutline, modifica: pencilOutline, elimina: trashOutline, canto: musicalNotesOutline,
    giu: removeOutline, su: addOutline, originale: refreshOutline, pdf: downloadOutline,
  };
  readonly tastiCapotasto = Array.from({ length: MAX_CAPOTASTO + 1 }, (_, i) => i);
  readonly sceltaAlterazioni: { valore: Alterazioni; nome: string }[] = [
    { valore: 'auto', nome: 'Automatiche' }, { valore: 'diesis', nome: 'Diesis #' }, { valore: 'bemolle', nome: 'Bemolle b' },
  ];
  readonly nomeSezione = nomeSezione;
  readonly coloreSezione = coloreSezione;

  canto: Canto | null = null;
  caricamento = true;
  errore = '';
  eliminando = false;
  /** Gli accordi si possono nascondere per leggere solo le parole. */
  accordiVisibili = true;
  /** Semitoni rispetto agli accordi scritti: parte dalla tonalità del gruppo. */
  passo = 0;
  /** Tasto del capotasto (0 = senza): si mostrano le posizioni, la tonalità che si sente resta. */
  capotasto = 0;
  alterazioni: Alterazioni = 'auto';
  salvandoTonalita = false;

  private id: number;

  constructor(
    route: ActivatedRoute,
    private auth: AuthService,
    private canti: CantiService,
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private navCtrl: NavController,
  ) {
    this.id = Number(route.snapshot.paramMap.get('id'));
  }

  // Ionic a volte crea la pagina due volte e l'ingresso arriva a una copia sola: la pagina si
  // prepara già alla creazione, e all'ingresso solo se non l'ha appena fatto.
  private appenaCreata = false;

  ngOnInit() {
    this.appenaCreata = true;
    this.entra();
  }

  ionViewWillEnter() {
    if (this.appenaCreata) {
      this.appenaCreata = false;
      return;
    }
    this.entra();
  }

  private entra() {
    this.carica();
  }

  get puoModificare(): boolean {
    const ruolo = this.auth.utente?.ruolo;
    return ruolo === 'capo' || ruolo === 'admin';
  }

  /** Il canto riga per riga, con o senza le righe degli accordi, nella tonalità scelta. */
  get righe(): RigaCanto[] {
    return this.canto
      ? righeCanto(this.canto.testo, this.accordiVisibili, this.passo - this.capotasto, this.alterazioni)
      : [];
  }

  /** Quanti caratteri ha la riga più lunga: da telefono il testo si rimpicciolisce per starci tutto. */
  get caratteriRigaPiuLunga(): number {
    return this.righe.reduce((massimo, r) => Math.max(massimo, r.testo.replace(/\t/g, '    ').length), 20);
  }

  /** Senza accordi da tenere allineati, le righe troppo lunghe possono andare a capo. */
  get soloParole(): boolean {
    return !this.conAccordi || !this.accordiVisibili;
  }

  // ---------- Tonalità ----------

  get conAccordi(): boolean {
    return !!this.canto && haAccordi(this.canto.testo);
  }

  /** La tonalità del gruppo, salvata dai capi (0 = come sono scritti gli accordi). */
  get passoGruppo(): number {
    return this.canto?.trasposizione ?? 0;
  }

  /** "MI", "SI minore": come suona adesso. */
  get tonalita(): string {
    return this.canto ? nomeTonalita(this.canto.testo, this.passo, this.alterazioni) ?? '' : '';
  }

  get tonalitaScritta(): string {
    return this.canto ? nomeTonalita(this.canto.testo, 0, this.alterazioni) ?? '' : '';
  }

  /** Le posizioni che si fanno col capotasto: la tonalità "per le dita". */
  get tonalitaPosizioni(): string {
    return this.canto ? nomeTonalita(this.canto.testo, this.passo - this.capotasto, this.alterazioni) ?? '' : '';
  }

  /** "+2 dall'originale", "come è scritto". */
  get distanza(): string {
    if (!this.passo) return 'come è scritto';
    const semitoni = Math.abs(this.passo) === 1 ? 'semitono' : 'semitoni';
    return `${this.passo > 0 ? '+' : '−'}${Math.abs(this.passo)} ${semitoni}`;
  }

  /** Mezzo tono più su o più giù: dopo 11 semitoni si torna alla stessa nota. */
  sposta(verso: 1 | -1) {
    const nuovo = this.passo + verso;
    this.passo = nuovo > 11 ? nuovo - 12 : nuovo < -11 ? nuovo + 12 : nuovo;
  }

  tornaAllOriginale() {
    this.passo = 0;
    this.capotasto = 0;
  }

  tornaAlGruppo() {
    this.passo = this.passoGruppo;
  }

  /** I capi salvano la tonalità di adesso come quella del gruppo (il testo non cambia). */
  salvaTonalitaGruppo() {
    if (!this.canto) return;
    this.salvandoTonalita = true;
    this.canti.salvaTonalita(this.canto.id, this.passo).subscribe({
      next: canto => {
        this.salvandoTonalita = false;
        this.canto = canto;
        this.avvisa(this.passo ? `Tonalità del gruppo: ${this.tonalita}.` : 'Il gruppo lo canta come è scritto.');
      },
      error: (err: HttpErrorResponse) => {
        this.salvandoTonalita = false;
        this.avvisa(err.error?.error ?? 'Non sono riuscito a salvare la tonalità.');
      },
    });
  }

  /** Il PDF di questo canto, così come si vede adesso (tonalità, capotasto, con o senza accordi). */
  scaricaPdf() {
    if (!this.canto) return;
    const indirizzo = this.canti.urlPdf([this.canto.id], this.accordiVisibili,
      { passo: this.passo, capotasto: this.capotasto, alterazioni: this.alterazioni });
    const collegamento = document.createElement('a');
    collegamento.href = indirizzo;
    collegamento.rel = 'noopener';
    collegamento.target = '_blank';
    document.body.appendChild(collegamento);
    collegamento.click();
    collegamento.remove();
    this.avvisa('PDF in preparazione…');
  }

  carica() {
    if (!Number.isInteger(this.id) || this.id <= 0) {
      this.caricamento = false;
      this.errore = 'Canto non trovato.';
      return;
    }
    this.canti.dettaglio(this.id).subscribe({
      next: canto => {
        this.canto = canto;
        // Si parte sempre dalla tonalità del gruppo.
        this.passo = canto.trasposizione ?? 0;
        this.capotasto = 0;
        this.caricamento = false;
        this.errore = '';
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.canto = null;
        this.errore = err.status === 404
          ? (err.error?.error ? 'Questo canto non esiste più.' : 'Il server non gestisce ancora il canzoniere: va riavviato il backend.')
          : 'Impossibile caricare il canto. Riprova tra poco.';
      },
    });
  }

  async modifica() {
    if (!this.canto) return;
    const modale = await this.modalCtrl.create({
      component: CantoEditorComponent,
      componentProps: { canto: this.canto },
    });
    await modale.present();
    const { data, role } = await modale.onDidDismiss<Canto>();
    if (role !== 'salvato' || !data) return;
    this.canto = data;
    this.avvisa('Canto aggiornato.');
  }

  async confermaElimina() {
    if (!this.canto) return;
    const canto = this.canto;
    const alert = await this.alertCtrl.create({
      header: 'Eliminare il canto?',
      message: `"${canto.titolo}" verrà tolto dal canzoniere. Non si può annullare.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        { text: 'Elimina', role: 'destructive' },
      ],
    });
    await alert.present();
    // Dopo l'eliminazione si torna indietro: si aspetta che la finestrella sia sparita,
    // altrimenti un suo velo invisibile resterebbe sopra la pagina a prendersi i tocchi.
    const { role } = await alert.onDidDismiss();
    if (role === 'destructive') this.elimina(canto);
  }

  private elimina(canto: Canto) {
    this.eliminando = true;
    this.canti.elimina(canto.id).subscribe({
      next: () => {
        this.avvisa('Canto eliminato.');
        this.navCtrl.navigateBack('/canzoniere');
      },
      error: (err: HttpErrorResponse) => {
        this.eliminando = false;
        this.avvisa(err.error?.error ?? 'Eliminazione non riuscita. Riprova.');
      },
    });
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 1800, position: 'top' });
    await toast.present();
  }
}
