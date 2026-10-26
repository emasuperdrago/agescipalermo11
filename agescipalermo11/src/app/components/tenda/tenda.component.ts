import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { SorpreseService } from '../../services/sorprese';

/** Un picchetto attorno alla tenda (posizione in percentuale del prato). */
interface Picchetto { x: number; y: number; piantato: boolean }

/** I secondi prima del temporale, tenda dopo tenda. */
const LIVELLI = [14, 11, 8];
const PENALITA = 1;
const CHIAVE_RECORD = 'tendaRecord';

/** Dove stanno i sei picchetti: i quattro angoli e i due tiranti davanti e dietro. */
const POSTI: { x: number; y: number }[] = [
  { x: 22, y: 72 }, { x: 78, y: 72 }, { x: 22, y: 34 }, { x: 78, y: 34 }, { x: 8, y: 53 }, { x: 92, y: 53 },
];

/**
 * Easter egg della mappa: "Monta la tenda prima del temporale". I picchetti si accendono uno alla
 * volta e vanno piantati (toccati) prima che arrivi la nuvola; tre tende, sempre meno tempo.
 * Si trova tenendo premuto un punto vuoto della mappa. Uso: dentro app-sorprese.
 */
@Component({
  selector: 'app-tenda',
  templateUrl: './tenda.component.html',
  styleUrls: ['./tenda.component.scss'],
  standalone: true,
})
export class TendaComponent implements OnInit, OnDestroy {
  private sorprese = inject(SorpreseService);

  readonly livelli = LIVELLI.length;
  readonly stato = signal<'pronto' | 'gioca' | 'montata' | 'volata' | 'fine'>('pronto');
  readonly livello = signal(0);
  readonly picchetti = signal<Picchetto[]>([]);
  readonly acceso = signal(-1);
  readonly restano = signal(LIVELLI[0]);
  readonly sbagliato = signal(false);
  readonly punti = signal(0);
  readonly record = signal(0);
  readonly nuovoRecord = signal(false);

  private orologio?: ReturnType<typeof setInterval>;
  private altri: ReturnType<typeof setTimeout>[] = [];
  private scadenza = 0;

  ngOnInit() {
    try { this.record.set(Number(localStorage.getItem(CHIAVE_RECORD)) || 0); } catch { /* niente record */ }
  }

  ngOnDestroy() {
    clearInterval(this.orologio);
    this.altri.forEach(t => clearTimeout(t));
  }

  /** Quanto è vicino il temporale (0 = lontano, 1 = arrivato): scurisce il cielo e avvicina la nuvola. */
  get temporale(): number {
    const totale = LIVELLI[this.livello()] ?? 1;
    return Math.min(1, Math.max(0, 1 - this.restano() / totale));
  }

  get fulmine(): boolean {
    return this.stato() === 'volata' || (this.stato() === 'gioca' && this.restano() < 2.5 && Math.floor(this.restano() * 4) % 3 === 0);
  }

  parti() {
    this.livello.set(0);
    this.punti.set(0);
    this.nuovoRecord.set(false);
    this.nuovaTenda();
  }

  /** La tenda dopo (o la prima): picchetti da piantare, il temporale che parte. */
  nuovaTenda() {
    this.picchetti.set(POSTI.map(p => ({ ...p, piantato: false })));
    this.stato.set('gioca');
    this.scadenza = Date.now() + LIVELLI[this.livello()] * 1000;
    this.restano.set(LIVELLI[this.livello()]);
    this.accendiProssimo();
    clearInterval(this.orologio);
    this.orologio = setInterval(() => {
      const restano = Math.max(0, (this.scadenza - Date.now()) / 1000);
      this.restano.set(restano);
      if (restano <= 0) this.volataVia();
    }, 100);
  }

  /** Si accende un picchetto ancora da piantare, a caso. */
  private accendiProssimo() {
    const liberi = this.picchetti().map((p, i) => p.piantato ? -1 : i).filter(i => i >= 0);
    this.acceso.set(liberi.length ? liberi[Math.floor(Math.random() * liberi.length)] : -1);
  }

  pianta(indice: number) {
    if (this.stato() !== 'gioca') return;
    if (indice !== this.acceso()) {
      // Picchetto sbagliato: si perde tempo.
      this.scadenza -= PENALITA * 1000;
      this.sbagliato.set(true);
      this.altri.push(setTimeout(() => this.sbagliato.set(false), 300));
      return;
    }
    this.picchetti.update(pp => pp.map((p, i) => i === indice ? { ...p, piantato: true } : p));
    if (this.picchetti().every(p => p.piantato)) return this.montata();
    this.accendiProssimo();
  }

  private montata() {
    clearInterval(this.orologio);
    this.acceso.set(-1);
    // Più tempo avanzato, più punti.
    this.punti.update(p => p + Math.round(this.restano() * 10) + 20);
    this.stato.set('montata');
    this.altri.push(setTimeout(() => {
      if (this.livello() < LIVELLI.length - 1) {
        this.livello.update(l => l + 1);
        this.nuovaTenda();
      } else this.fine();
    }, 1600));
  }

  private volataVia() {
    clearInterval(this.orologio);
    this.acceso.set(-1);
    this.stato.set('volata');
  }

  private fine() {
    if (this.punti() > this.record()) {
      this.record.set(this.punti());
      this.nuovoRecord.set(true);
      try { localStorage.setItem(CHIAVE_RECORD, String(this.punti())); } catch { /* pazienza */ }
    }
    this.stato.set('fine');
  }

  chiudi() {
    clearInterval(this.orologio);
    this.sorprese.tenda.set(false);
  }
}
