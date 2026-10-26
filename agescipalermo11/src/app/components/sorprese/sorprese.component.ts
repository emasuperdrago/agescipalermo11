import { Component, computed, effect, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { SorpreseService } from '../../services/sorprese';
import { DragoComponent } from '../drago/drago.component';

/** Un punto a caso dello schermo (in percentuale), con un ritardo per l'animazione. */
interface Punto { x: number; y: number; ritardo: number; misura: number }

function puntiACaso(quanti: number, altezzaMassima = 100): Punto[] {
  return Array.from({ length: quanti }, () => ({
    x: Math.round(Math.random() * 100),
    y: Math.round(Math.random() * altezzaMassima),
    ritardo: Math.round(Math.random() * 2000) / 1000,
    misura: 1 + Math.round(Math.random() * 2),
  }));
}

/**
 * Disegna le sorprese di SorpreseService sopra tutto il sito. Un tocco le chiude (il drago ha il
 * suo componente: lì i tocchi sono colpi). Chi preferisce meno movimento le vede ferme.
 * Uso: una volta sola, in app.component.html: <app-sorprese />
 */
@Component({
  selector: 'app-sorprese',
  templateUrl: './sorprese.component.html',
  styleUrls: ['./sorprese.component.scss'],
  standalone: true,
  imports: [DragoComponent],
})
export class SorpreseComponent {
  readonly sorprese = inject(SorpreseService);
  private router = inject(Router);

  /** Il drago si vede solo nella home. */
  private url = toSignal(this.router.events.pipe(
    filter(e => e instanceof NavigationEnd),
    map(e => (e as NavigationEnd).urlAfterRedirects.split('?')[0]),
  ), { initialValue: this.router.url.split('?')[0] });
  readonly dragoInVista = computed(() => this.url() === '/home' && this.sorprese.drago() !== null);

  // Stelle, fuochi e coriandoli: rifatti ogni volta che compare la scena.
  stelle: Punto[] = [];
  fuochi: Punto[] = [];
  coriandoli: Punto[] = [];
  readonly colori = ['#B98A00', '#5A9E2A', '#D8392F', '#7D57C2', '#E3C0FF', '#0B87A8'];

  constructor() {
    effect(() => {
      const scena = this.sorprese.scena();
      if (scena === 'campo') this.stelle = puntiACaso(60, 65);
      if (scena === 'gigli') this.fuochi = puntiACaso(9, 60).map(p => ({ ...p, y: 10 + p.y }));
      if (scena === 'compleanno' || scena === 'thinking') this.coriandoli = puntiACaso(50);
      // Gli anni '80 cambiano tutto il sito, non solo questo riquadro.
      document.body.classList.toggle('anni-80', scena === 'anni80');
    });
  }

  chiudi() {
    this.sorprese.chiudi();
  }
}
