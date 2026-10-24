import { Component, EventEmitter, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { IonIcon, ToastController } from '@ionic/angular/standalone';
import { addOutline } from 'ionicons/icons';
import { BRANCHE_VERE, ZonaCapiService } from '../../services/zona-capi';
import { NuovoCapo } from '../../../types/models';

/**
 * Un capo aggiunto a mano dai capigruppo, senza passare dal file del censimento: un pulsante
 * che apre un piccolo modulo. Si usa nella comunità capi e nella tabella dei capi censiti.
 * Uso: <app-aggiungi-capo (aggiunto)="ricarica()" />
 */
@Component({
  selector: 'app-aggiungi-capo',
  templateUrl: './aggiungi-capo.component.html',
  styleUrls: ['./aggiungi-capo.component.scss'],
  standalone: true,
  imports: [FormsModule, IonIcon],
})
export class AggiungiCapoComponent {
  /** Il capo è stato aggiunto: chi usa il componente ricarica il suo elenco. */
  @Output() aggiunto = new EventEmitter<void>();

  readonly icone = { aggiungi: addOutline };
  readonly branche = BRANCHE_VERE;

  private zona = inject(ZonaCapiService);
  private toastCtrl = inject(ToastController);

  aggiuntaAperta = false;
  nuovo: NuovoCapo = capoVuoto();
  aggiungendo = false;
  erroreAggiunta = '';

  alternaAggiunta() {
    this.aggiuntaAperta = !this.aggiuntaAperta;
    this.erroreAggiunta = '';
  }

  aggiungi() {
    const n = this.nuovo;
    if (!n.nome.trim() || !n.cognome.trim()) {
      this.erroreAggiunta = 'Scrivi nome e cognome.';
      return;
    }
    if (!/^\d+$/.test(n.codice_censimento.trim())) {
      this.erroreAggiunta = 'Il codice censimento deve contenere solo cifre.';
      return;
    }
    this.aggiungendo = true;
    this.erroreAggiunta = '';
    this.zona.aggiungiCapo({ ...n, codice_censimento: n.codice_censimento.trim(), email: n.email.trim() }).subscribe({
      next: () => {
        this.aggiungendo = false;
        this.avvisa(`${n.nome.trim()} ${n.cognome.trim()} è nella comunità capi.`);
        this.nuovo = capoVuoto();
        this.aggiuntaAperta = false;
        this.aggiunto.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.aggiungendo = false;
        this.erroreAggiunta = err.error?.error ?? 'Non sono riuscito ad aggiungerlo. Riprova.';
      },
    });
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 2200, position: 'top' });
    await toast.present();
  }
}

function capoVuoto(): NuovoCapo {
  return { nome: '', cognome: '', codice_censimento: '', email: '', branca: null };
}
