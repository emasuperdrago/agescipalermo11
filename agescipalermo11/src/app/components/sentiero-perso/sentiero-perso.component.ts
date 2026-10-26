import { Component, HostListener, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Una casella del bosco. */
interface Casella { riga: number; colonna: number }

const LATO = 6;

/**
 * Easter egg della pagina "non trovata": ti sei perso nel bosco. La bussola punta verso il campo,
 * che si vede solo quando ci sei vicino; si cammina con le frecce (o toccando una casella accanto).
 * Uso: <app-sentiero-perso />
 */
@Component({
  selector: 'app-sentiero-perso',
  templateUrl: './sentiero-perso.component.html',
  styleUrls: ['./sentiero-perso.component.scss'],
  standalone: true,
  imports: [RouterLink],
})
export class SentieroPersoComponent implements OnInit {
  readonly righe = Array.from({ length: LATO }, (_, i) => i);
  readonly colonne = Array.from({ length: LATO }, (_, i) => i);

  io: Casella = { riga: 0, colonna: 0 };
  campo: Casella = { riga: 0, colonna: 0 };
  passati = new Set<string>();
  passi = 0;
  arrivato = false;

  ngOnInit() {
    this.ricomincia();
  }

  ricomincia() {
    const caso = () => Math.floor(Math.random() * LATO);
    this.io = { riga: caso(), colonna: caso() };
    // Il campo è lontano almeno quattro passi.
    do this.campo = { riga: caso(), colonna: caso() };
    while (this.distanza(this.io, this.campo) < 4);
    this.passati = new Set([this.chiave(this.io)]);
    this.passi = 0;
    this.arrivato = false;
  }

  /** Dove punta la bussola, in gradi (0 = nord, in senso orario). */
  get direzione(): number {
    const dx = this.campo.colonna - this.io.colonna;
    const dy = this.campo.riga - this.io.riga;
    return Math.atan2(dx, -dy) * 180 / Math.PI;
  }

  /** Il campo si vede solo da vicino (una casella, anche in diagonale). */
  get campoVicino(): boolean {
    return Math.max(Math.abs(this.campo.riga - this.io.riga), Math.abs(this.campo.colonna - this.io.colonna)) <= 1;
  }

  cosaC(riga: number, colonna: number): string {
    if (riga === this.io.riga && colonna === this.io.colonna) return this.arrivato ? '🎉' : '🧭';
    if (riga === this.campo.riga && colonna === this.campo.colonna && (this.campoVicino || this.arrivato)) return '⛺';
    if (this.passati.has(`${riga}-${colonna}`)) return '👣';
    return (riga * 7 + colonna * 3) % 5 === 0 ? '🌳' : '🌲';
  }

  /** Un passo verso una casella accanto (non in diagonale). */
  vai(riga: number, colonna: number) {
    if (this.arrivato) return;
    if (Math.abs(riga - this.io.riga) + Math.abs(colonna - this.io.colonna) !== 1) return;
    if (riga < 0 || colonna < 0 || riga >= LATO || colonna >= LATO) return;
    this.io = { riga, colonna };
    this.passati.add(this.chiave(this.io));
    this.passi++;
    if (riga === this.campo.riga && colonna === this.campo.colonna) this.arrivato = true;
  }

  sposta(dr: number, dc: number) {
    this.vai(this.io.riga + dr, this.io.colonna + dc);
  }

  @HostListener('window:keydown', ['$event'])
  tasto(e: KeyboardEvent) {
    const mosse: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    };
    const mossa = mosse[e.key];
    if (!mossa || (e.target as HTMLElement)?.closest('input, textarea')) return;
    e.preventDefault();
    this.sposta(...mossa);
  }

  private chiave(c: Casella): string {
    return `${c.riga}-${c.colonna}`;
  }

  private distanza(a: Casella, b: Casella): number {
    return Math.abs(a.riga - b.riga) + Math.abs(a.colonna - b.colonna);
  }
}
