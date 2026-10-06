import { Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AlertController, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon,
  ModalController
} from '@ionic/angular/standalone';
import { closeOutline } from 'ionicons/icons';
import { SelettoreDataComponent } from '../selettore-data/selettore-data.component';
import { ANNI_DI_BRANCA, BRANCHE_VERE, ZonaCapiService, tappaDi } from '../../services/zona-capi';
import { nomeBranca, stiliBranca } from '../../services/posti';
import { Branca, DatiRagazzo, RagazzoElenco } from '../../../types/models';

/**
 * Pop-up per aggiungere un ragazzo o, se riceve `ragazzo`, correggerne i dati.
 * Il codice censimento può restare vuoto: chi entra adesso lo riceve più avanti.
 * Si chiude con role "salvato".
 */
@Component({
  selector: 'app-ragazzo-editor',
  templateUrl: './ragazzo-editor.component.html',
  styleUrls: ['./ragazzo-editor.component.scss'],
  standalone: true,
  imports: [
    FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon,
    SelettoreDataComponent,
  ],
})
export class RagazzoEditorComponent implements OnInit {
  /** Se manca, si sta aggiungendo un ragazzo nuovo. */
  @Input() ragazzo?: RagazzoElenco;
  /** La branca di chi sta aggiungendo: serve per proporre gli anni giusti. */
  @Input() brancaIniziale: Branca | null = null;
  /** Solo i capigruppo possono spostare un ragazzo in un'altra branca. */
  @Input() puoSpostare = false;

  readonly icone = { chiudi: closeOutline };
  readonly branche = BRANCHE_VERE;
  readonly nomeBranca = nomeBranca;
  readonly stiliBranca = stiliBranca;
  readonly tappaDi = tappaDi;

  dati: DatiRagazzo = {
    codice_censimento: '', nome: '', cognome: '', data_nascita: null, branca: null,
    anno_branca: null, telefono: null, email: null, tesoriere: false,
  };
  salvando = false;
  errore = '';

  constructor(
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private zona: ZonaCapiService,
  ) {}

  ngOnInit() {
    const r = this.ragazzo;
    if (!r) {
      this.dati.branca = this.brancaIniziale;
      return;
    }
    this.dati = {
      codice_censimento: r.codice_censimento ? String(r.codice_censimento) : '',
      nome: r.nome, cognome: r.cognome, data_nascita: r.data_nascita, branca: r.branca,
      anno_branca: r.anno_branca, telefono: r.telefono, email: r.email, tesoriere: r.tesoriere,
    };
  }

  get nuovo(): boolean {
    return !this.ragazzo;
  }

  get titolo(): string {
    return this.ragazzo ? `${this.ragazzo.nome} ${this.ragazzo.cognome}` : 'Nuovo ragazzo';
  }

  /** Gli anni possibili nella branca scelta: il branco ne ha 3, reparto e clan 5. */
  get anniPossibili(): number[] {
    const quanti = this.dati.branca ? ANNI_DI_BRANCA[this.dati.branca] : 0;
    return Array.from({ length: quanti }, (_, i) => i + 1);
  }

  scegliBranca(branca: Branca) {
    if (!this.puoSpostare || this.dati.branca === branca) return;
    this.dati.branca = branca;
    // Il tesoriere esiste solo nel clan.
    if (branca !== 'clan') this.dati.tesoriere = false;
    // Cambiando branca l'anno di prima può non esistere più (il branco arriva a 3).
    if (this.dati.anno_branca && this.dati.anno_branca > ANNI_DI_BRANCA[branca]) this.dati.anno_branca = null;
  }

  scegliAnno(anno: number) {
    this.dati.anno_branca = this.dati.anno_branca === anno ? null : anno;
  }

  /** Avviso prima di spostare un ragazzo in un'altra branca. true = si procede. */
  private confermaCambioBranca(): Promise<boolean> {
    const chi = `${this.dati.nome.trim()} ${this.dati.cognome.trim()}`.trim() || 'Il ragazzo';
    const da = this.ragazzo?.branca ? nomeBranca(this.ragazzo.branca).toLowerCase() : 'nessuna branca';
    const a = this.dati.branca ? nomeBranca(this.dati.branca).toLowerCase() : 'nessuna branca';
    const tappa = this.dati.anno_branca ? tappaDi(this.dati.branca, this.dati.anno_branca) : null;

    return new Promise(async risolvi => {
      const alert = await this.alertCtrl.create({
        header: 'Cambio di branca',
        message: `${chi} passa dal ${da} al ${a}`
          + (tappa ? `, come ${tappa}` : '')
          + `.\n\nSparirà dalla tabella del ${da} e da lì in poi lo seguono i capi del ${a}. `
          + `Le quote che ha già versato restano nei conti del ${da}.`,
        buttons: [
          { text: 'Annulla', role: 'cancel', handler: () => risolvi(false) },
          { text: 'Sposta', handler: () => risolvi(true) },
        ],
      });
      // Chiudendo l'avviso in un altro modo (tasto indietro, tocco fuori) non si sposta niente.
      alert.onDidDismiss().then(({ role }) => { if (role === 'backdrop' || role === 'cancel') risolvi(false); });
      await alert.present();
    });
  }

  chiudi() {
    this.modalCtrl.dismiss(null, 'annulla');
  }

  async salva() {
    if (!this.dati.nome.trim() || !this.dati.cognome.trim()) {
      this.errore = 'Nome e cognome non possono restare vuoti.';
      return;
    }
    // Cambiare branca sposta il ragazzo sotto altri capi: prima si chiede conferma.
    if (this.ragazzo && this.dati.branca !== this.ragazzo.branca && !await this.confermaCambioBranca()) return;
    this.salvando = true;
    this.errore = '';
    const richiesta = this.ragazzo
      ? this.zona.aggiornaRagazzo(this.ragazzo.id, this.dati)
      : this.zona.creaRagazzo(this.dati);
    richiesta.subscribe({
      next: ragazzo => this.modalCtrl.dismiss(ragazzo, 'salvato'),
      error: (err: HttpErrorResponse) => {
        this.salvando = false;
        this.errore = err.status === 0 ? 'Server non raggiungibile. Riprova tra poco.'
          : err.error?.error ?? `Salvataggio non riuscito (errore ${err.status}).`;
      },
    });
  }
}
