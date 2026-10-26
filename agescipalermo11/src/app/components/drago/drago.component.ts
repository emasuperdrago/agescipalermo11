import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { SorpreseService } from '../../services/sorprese';

/** Un "💥" dove si è colpito, che sale e sparisce. */
interface Botta { id: number; x: number; y: number; testo: string }

const CHIAVE_RECORD = 'dragoRecord';

/**
 * Il drago di San Giorgio (23 aprile, nella home): vola per lo schermo, sputa fuoco e va più veloce
 * man mano che si indebolisce. Ogni tocco è un colpo; alla fine cade, sboccia la rosa della leggenda
 * e si vede in quanto tempo lo si è sconfitto (col record di questo telefono).
 * Uso: dentro app-sorprese, quando c'è il drago.
 */
@Component({
  selector: 'app-drago',
  templateUrl: './drago.component.html',
  styleUrls: ['./drago.component.scss'],
  standalone: true,
})
export class DragoComponent implements OnInit, OnDestroy {
  readonly sorprese = inject(SorpreseService);

  /** Dove sta il drago (percentuale dello schermo). */
  readonly x = signal(70);
  readonly y = signal(55);
  /** Guarda a destra o a sinistra (si gira verso dove vola). */
  readonly versoDestra = signal(false);
  readonly colpito = signal(false);
  readonly fuoco = signal(false);
  readonly invito = signal(true);
  readonly caduto = signal(false);
  readonly vittoria = signal(false);
  readonly botte = signal<Botta[]>([]);
  tempo = '';
  record = '';
  nuovoRecord = false;

  private inizio = 0;
  private volo?: ReturnType<typeof setTimeout>;
  private fiamme?: ReturnType<typeof setInterval>;
  private altri: ReturnType<typeof setTimeout>[] = [];
  private prossimaBotta = 0;

  get vita(): number {
    return (this.sorprese.drago() ?? 0) / this.sorprese.dragoVita;
  }

  ngOnInit() {
    this.altri.push(setTimeout(() => this.invito.set(false), 3500));
    this.vola();
    this.fiamme = setInterval(() => {
      if (this.vittoria() || this.caduto()) return;
      this.fuoco.set(true);
      this.altri.push(setTimeout(() => this.fuoco.set(false), 900));
    }, 3200);
  }

  ngOnDestroy() {
    clearTimeout(this.volo);
    clearInterval(this.fiamme);
    this.altri.forEach(t => clearTimeout(t));
  }

  /** Il drago cambia posto: più è debole, più è veloce. */
  private vola() {
    if (this.caduto()) return;
    const nuovaX = 8 + Math.random() * 70;
    this.versoDestra.set(nuovaX > this.x());
    this.x.set(nuovaX);
    this.y.set(18 + Math.random() * 52);
    const pausa = 650 + 1100 * this.vita;
    this.volo = setTimeout(() => this.vola(), pausa);
  }

  colpisci(evento: MouseEvent) {
    evento.stopPropagation();
    if (this.caduto()) return;
    if (!this.inizio) this.inizio = Date.now();
    this.invito.set(false);
    this.colpito.set(true);
    this.altri.push(setTimeout(() => this.colpito.set(false), 180));
    const id = ++this.prossimaBotta;
    const frasi = ['💥', '⚔️', '💥', '✨'];
    this.botte.update(b => [...b, { id, x: evento.clientX, y: evento.clientY, testo: frasi[id % frasi.length] }]);
    this.altri.push(setTimeout(() => this.botte.update(b => b.filter(x => x.id !== id)), 800));
    if (this.sorprese.colpisciDrago()) this.sconfitto();
  }

  private sconfitto() {
    clearTimeout(this.volo);
    this.caduto.set(true);
    const secondi = (Date.now() - this.inizio) / 1000;
    this.tempo = secondi.toLocaleString('it-IT', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    let migliore = Infinity;
    try { migliore = Number(localStorage.getItem(CHIAVE_RECORD)) || Infinity; } catch { /* niente record */ }
    this.nuovoRecord = secondi < migliore;
    if (this.nuovoRecord) {
      migliore = secondi;
      try { localStorage.setItem(CHIAVE_RECORD, String(secondi)); } catch { /* pazienza */ }
    }
    this.record = migliore.toLocaleString('it-IT', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    this.altri.push(setTimeout(() => this.vittoria.set(true), 1300));
  }

  chiudi() {
    this.sorprese.chiudiDrago();
  }
}
