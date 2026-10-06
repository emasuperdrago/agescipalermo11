import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { arrowDownOutline, arrowUpOutline, pencilOutline, trashOutline } from 'ionicons/icons';
import { iconaStoria, paragrafi } from '../../storia/icone-storia';
import { ParteStoria } from '../../../types/models';

/**
 * Una parte scritta dai capi (nella storia e nella pagina di Marco): titolo con icona,
 * paragrafi, frase in evidenza, etichette e, se chiesti, i riquadri delle branche.
 * Con la modifica accesa mostra i comandi: i cambiamenti li fa la pagina.
 */
@Component({
  selector: 'app-parte-racconto',
  templateUrl: './parte-racconto.component.html',
  styleUrls: ['./parte-racconto.component.scss'],
  standalone: true,
  imports: [RouterLink, IonIcon],
})
export class ParteRaccontoComponent {
  @Input({ required: true }) parte!: ParteStoria;
  @Input() inModifica = false;
  @Input() primo = false;
  @Input() ultimo = false;
  @Input() occupato = false;

  @Output() modifica = new EventEmitter<void>();
  @Output() sposta = new EventEmitter<'su' | 'giu'>();
  @Output() togli = new EventEmitter<void>();

  readonly icone = { modifica: pencilOutline, su: arrowUpOutline, giu: arrowDownOutline, elimina: trashOutline };

  readonly branche = [
    { sigla: 'L/C', nome: 'Branco', link: '/branco', chiave: 'branco' },
    { sigla: 'E/G', nome: 'Reparto', link: '/reparto', chiave: 'reparto' },
    { sigla: 'R/S', nome: 'Clan', link: '/clan', chiave: 'clan' },
  ] as const;

  get icona(): string {
    return iconaStoria(this.parte.icona);
  }

  get paragrafi(): string[] {
    return paragrafi(this.parte.testo);
  }
}
