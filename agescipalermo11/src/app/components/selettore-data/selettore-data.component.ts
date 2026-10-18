import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * Data in tre tendine: giorno, mese e anno. Si usa al posto del calendario del browser,
 * che cambia da dispositivo a dispositivo. Dà e riceve la data come "AAAA-MM-GG" (giorno locale).
 * Uso: <app-selettore-data [valore]="data" (valoreChange)="data = $event" />
 */
@Component({
  selector: 'app-selettore-data',
  templateUrl: './selettore-data.component.html',
  styleUrls: ['./selettore-data.component.scss'],
  standalone: true,
  imports: [FormsModule],
})
export class SelettoreDataComponent {
  @Input() set valore(data: string | null) {
    const [anno, mese, giorno] = (data ?? '').split('-');
    this.anno = anno ? String(Number(anno)) : '';
    this.mese = mese ? String(Number(mese)) : '';
    this.giorno = giorno ? String(Number(giorno)) : '';
  }
  /** Quanti anni indietro arrivare: per i ragazzi bastano 30, per i capi servono di più. */
  @Input() anniIndietro = 30;
  /**
   * L'anno più recente, rispetto a oggi: +2 per gli eventi (anche i prossimi due anni),
   * -5 (di base) per le date di nascita, perché chi entra nel gruppo ha almeno 5 anni.
   */
  @Input() anniAvanti = -5;
  @Output() valoreChange = new EventEmitter<string | null>();

  readonly mesi = [
    'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
  ];

  giorno = '';
  mese = '';
  anno = '';

  get anni(): number[] {
    const adesso = new Date().getFullYear();
    const elenco: number[] = [];
    for (let a = adesso + this.anniAvanti; a >= adesso - this.anniIndietro; a--) elenco.push(a);
    return elenco;
  }

  /** Solo i giorni che esistono davvero in quel mese (febbraio 28 o 29). */
  get giorniDelMese(): number[] {
    const mese = Number(this.mese);
    const quanti = mese ? new Date(Number(this.anno) || 2000, mese, 0).getDate() : 31;
    return Array.from({ length: quanti }, (_, i) => i + 1);
  }

  cambia() {
    if (this.giorno && Number(this.giorno) > this.giorniDelMese.length) this.giorno = '';
    const due = (v: string) => v.padStart(2, '0');
    this.valoreChange.emit(this.giorno && this.mese && this.anno
      ? `${this.anno}-${due(this.mese)}-${due(this.giorno)}`
      : null);
  }
}
