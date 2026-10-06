import { Component, HostListener, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular/standalone';
import { chevronBackOutline, chevronForwardOutline, closeOutline, searchOutline } from 'ionicons/icons';

/** Un distintivo: l'immagine sta in <cartella>/<chiave>.webp. */
export interface Distintivo {
  chiave: string;
  nome: string;
  /** Cosa sa fare chi lo conquista, in una frase. */
  testo: string;
}

/**
 * La griglia dei distintivi (specialità del Branco, specialità e brevetti del Reparto):
 * una ricerca in cima, i distintivi con il nome sotto e, toccandone uno, il riquadro
 * grande con cosa si impara. Dal riquadro si scorre agli altri con le frecce (anche
 * da tastiera) e si chiude con la X, toccando fuori o con Esc.
 */
@Component({
  selector: 'app-elenco-distintivi',
  templateUrl: './elenco-distintivi.component.html',
  styleUrls: ['./elenco-distintivi.component.scss'],
  standalone: true,
  imports: [FormsModule, IonIcon],
})
export class ElencoDistintiviComponent {
  @Input({ required: true }) voci: readonly Distintivo[] = [];
  /** La cartella delle immagini, dentro assets. */
  @Input({ required: true }) cartella = '';
  /** "toppa" per i triangoli del Branco, "quadrato" per i distintivi del Reparto. */
  @Input() forma: 'toppa' | 'quadrato' = 'toppa';
  /** Come si chiama una voce, al singolare e al plurale ("brevetto", "brevetti"). */
  @Input() singolare = 'specialità';
  @Input() plurale = 'specialità';

  readonly icone = {
    cerca: searchOutline, chiudi: closeOutline,
    precedente: chevronBackOutline, successiva: chevronForwardOutline,
  };

  cerca = '';
  aperta: Distintivo | null = null;

  /** Le voci che corrispondono alla ricerca, senza badare ad accenti e maiuscole. */
  get filtrate(): readonly Distintivo[] {
    const cercato = semplifica(this.cerca);
    if (!cercato) return this.voci;
    return this.voci.filter(v => semplifica(v.nome).includes(cercato) || semplifica(v.testo).includes(cercato));
  }

  /** "65 specialità", "1 brevetto trovato"... */
  get conta(): string {
    const n = this.filtrate.length;
    const nome = n === 1 ? this.singolare : this.plurale;
    if (!this.cerca.trim()) return `${n} ${nome}`;
    // "specialità" e "brevetti" non dicono il genere: si decide dal plurale.
    const femminile = this.plurale.endsWith('à') || this.plurale.endsWith('e');
    const trovate = n === 1 ? (femminile ? 'trovata' : 'trovato') : (femminile ? 'trovate' : 'trovati');
    return `${n} ${nome} ${trovate}`;
  }

  immagine(v: Distintivo): string {
    return `${this.cartella}/${v.chiave}.webp`;
  }

  apri(v: Distintivo) {
    this.aperta = v;
  }

  chiudi() {
    this.aperta = null;
  }

  /** Alla voce prima o dopo, fra quelle in elenco. */
  scorri(passo: number) {
    const elenco = this.filtrate;
    if (!this.aperta || !elenco.length) return;
    const qui = elenco.indexOf(this.aperta);
    this.aperta = elenco[(qui + passo + elenco.length) % elenco.length];
  }

  @HostListener('document:keydown', ['$event'])
  tastiera(evento: KeyboardEvent) {
    if (!this.aperta) return;
    if (evento.key === 'Escape') this.chiudi();
    else if (evento.key === 'ArrowLeft') this.scorri(-1);
    else if (evento.key === 'ArrowRight') this.scorri(1);
  }
}

/** Minuscole e senza accenti, per cercare "specialita" e trovare "Specialità". */
function semplifica(testo: string): string {
  return testo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
