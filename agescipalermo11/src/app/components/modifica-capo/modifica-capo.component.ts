import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ZonaCapiService, BRANCHE_VERE } from '../../services/zona-capi';
import { SelettoreDataComponent } from '../selettore-data/selettore-data.component';
import { Branca, CapoElenco } from '../../../types/models';

/**
 * I dati di un capo, cambiati dalla comunità capi (la matita accanto al suo nome): nome, cognome,
 * email, telefono, data di nascita e branca. Ruolo e capogruppo restano quelli dei pulsanti.
 * Uso: <app-modifica-capo [capo]="c" (fatto)="..." />  (fatto: true = salvato, false = annullato)
 */
@Component({
  selector: 'app-modifica-capo',
  templateUrl: './modifica-capo.component.html',
  styleUrls: ['../aggiungi-capo/aggiungi-capo.component.scss'],
  standalone: true,
  imports: [FormsModule, SelettoreDataComponent],
})
export class ModificaCapoComponent implements OnInit {
  @Input({ required: true }) capo!: CapoElenco;
  @Output() fatto = new EventEmitter<boolean>();

  readonly branche = BRANCHE_VERE;
  private zona = inject(ZonaCapiService);

  dati = { nome: '', cognome: '', email: '', telefono: '', data_nascita: null as string | null, branca: null as Branca | null };
  salvando = false;
  errore = '';

  ngOnInit() {
    const c = this.capo;
    this.dati = {
      nome: c.nome, cognome: c.cognome, email: c.email ?? '', telefono: c.telefono ?? '',
      data_nascita: c.data_nascita, branca: c.branca,
    };
  }

  salva() {
    const d = this.dati;
    if (!d.nome.trim() || !d.cognome.trim()) {
      this.errore = 'Scrivi nome e cognome.';
      return;
    }
    this.salvando = true;
    this.errore = '';
    this.zona.aggiornaCapo(this.capo.id, {
      nome: d.nome.trim(), cognome: d.cognome.trim(), data_nascita: d.data_nascita, branca: d.branca,
      // Ruolo e capogruppo non si toccano da qui: restano come sono.
      ruolo: this.capo.ruolo, capogruppo: this.capo.capogruppo,
      telefono: d.telefono.trim() || null, email: d.email.trim() || null,
    }).subscribe({
      next: () => {
        this.salvando = false;
        this.fatto.emit(true);
      },
      error: (err: HttpErrorResponse) => {
        this.salvando = false;
        this.errore = err.error?.error ?? 'Non sono riuscito a salvare. Riprova.';
      },
    });
  }
}
