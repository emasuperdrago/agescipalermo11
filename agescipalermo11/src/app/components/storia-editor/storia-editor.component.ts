import { Component, Input, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, ModalController
} from '@ionic/angular/standalone';
import { closeOutline } from 'ionicons/icons';
import { PaginaConParti, StoriaService, TipoStoria } from '../../services/storia';
import { ICONE_STORIA } from '../../storia/icone-storia';
import { DatiParteStoria, DatiTappaStoria, ParteStoria, TappaStoria } from '../../../types/models';

/**
 * Il pop-up dei capi per scrivere una tappa della linea o una parte della storia,
 * nuova o già esistente. Si chiude con il ruolo "salvato" quando il server ha salvato.
 */
@Component({
  selector: 'app-storia-editor',
  templateUrl: './storia-editor.component.html',
  styleUrls: ['./storia-editor.component.scss'],
  standalone: true,
  imports: [FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon],
})
export class StoriaEditorComponent implements OnInit {
  @Input({ required: true }) tipo: TipoStoria = 'tappe';
  /** La voce da cambiare; manca quando se ne aggiunge una nuova. */
  @Input() voce?: TappaStoria | ParteStoria;
  /** La pagina in cui va una parte nuova. */
  @Input() pagina: PaginaConParti = 'storia';
  /** Se offrire i riquadri di Branco, Reparto e Clan (nella pagina di Marco non servono). */
  @Input() conBranche = true;

  readonly icone = { chiudi: closeOutline };
  readonly sceltaIcone = ICONE_STORIA;

  quando = '';
  titolo = '';
  icona = ICONE_STORIA[0].chiave;
  testo = '';
  nota = '';
  adesso = false;
  evidenza = '';
  /** Le etichette si scrivono una per riga. */
  etichette = '';
  mostraBranche = false;

  salvando = false;
  errore = '';

  private modalCtrl = inject(ModalController);
  private storia = inject(StoriaService);

  get modifica(): boolean {
    return !!this.voce;
  }

  get titoloFinestra(): string {
    if (this.tipo === 'tappe') return this.modifica ? 'Modifica la tappa' : 'Nuova tappa';
    return this.modifica ? 'Modifica la parte' : 'Nuova parte';
  }

  ngOnInit() {
    const v = this.voce;
    if (!v) {
      if (this.tipo === 'parti') this.icona = 'stella';
      return;
    }
    this.titolo = v.titolo;
    this.icona = v.icona;
    this.testo = v.testo;
    if ('quando' in v) {
      this.quando = v.quando;
      this.nota = v.nota ?? '';
      this.adesso = v.adesso;
    } else {
      this.evidenza = v.evidenza ?? '';
      this.etichette = v.etichette.join('\n');
      this.mostraBranche = v.mostra_branche;
    }
  }

  chiudi() {
    this.modalCtrl.dismiss(null, 'annulla');
  }

  async salva() {
    this.errore = '';
    if (this.tipo === 'tappe' && !this.quando.trim()) { this.errore = 'Scrivi quando: un anno, un periodo o "Adesso".'; return; }
    if (!this.titolo.trim()) { this.errore = 'Serve il titolo.'; return; }
    if (this.tipo === 'parti' && !this.testo.trim()) { this.errore = 'Serve il testo.'; return; }

    const dati: DatiTappaStoria | DatiParteStoria = this.tipo === 'tappe'
      ? {
        quando: this.quando.trim(), titolo: this.titolo.trim(), icona: this.icona,
        testo: this.testo.trim(), nota: this.nota.trim() || null, adesso: this.adesso,
      }
      : {
        titolo: this.titolo.trim(), icona: this.icona, testo: this.testo.trim(),
        evidenza: this.evidenza.trim() || null,
        etichette: this.etichette.split('\n').map(e => e.trim()).filter(Boolean),
        mostra_branche: this.mostraBranche,
      };

    this.salvando = true;
    try {
      await firstValueFrom(this.voce
        ? this.storia.aggiorna(this.tipo, this.voce.id, dati)
        : this.storia.aggiungi(this.tipo, dati, this.pagina));
      this.modalCtrl.dismiss(null, 'salvato');
    } catch (e) {
      this.errore = e instanceof HttpErrorResponse && e.error?.error
        ? e.error.error
        : 'Non sono riuscito a salvare. Riprova tra poco.';
      this.salvando = false;
    }
  }
}
