import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CantiService, rigaDiAccordi, segnoRiga, senzaSegniGrassetto } from '../../services/canti';
import { SorpreseService } from '../../services/sorprese';
import { CantoElenco } from '../../../types/models';

/** Una domanda: due versi di un canto e quattro titoli fra cui scegliere. */
interface Domanda { versi: string[]; giusto: CantoElenco; scelte: CantoElenco[] }

const DOMANDE = 10;
const SECONDI = 15;
const CHIAVE_RECORD = 'indovinaRecord';

/**
 * Easter egg del canzoniere: "Indovina il canto". Due versi di un canto vero, quattro titoli:
 * dieci domande, quindici secondi l'una, più si risponde in fretta più punti si prendono.
 * Si trova in fondo alla lista del canzoniere. Uso: dentro app-sorprese.
 */
@Component({
  selector: 'app-indovina-canto',
  templateUrl: './indovina-canto.component.html',
  styleUrls: ['./indovina-canto.component.scss'],
  standalone: true,
})
export class IndovinaCantoComponent implements OnInit, OnDestroy {
  private canti = inject(CantiService);
  private sorprese = inject(SorpreseService);
  private router = inject(Router);

  readonly totale = DOMANDE;
  readonly stato = signal<'carica' | 'gioca' | 'risposta' | 'fine' | 'errore'>('carica');
  readonly domanda = signal<Domanda | null>(null);
  readonly numero = signal(0);
  readonly punti = signal(0);
  readonly giuste = signal(0);
  readonly scelta = signal<number | null>(null);
  readonly restano = signal(SECONDI);
  readonly record = signal(0);
  readonly nuovoRecord = signal(false);

  private tutti: CantoElenco[] = [];
  private usati = new Set<number>();
  private prossima?: Promise<Domanda | null>;
  private orologio?: ReturnType<typeof setInterval>;
  private partenza = 0;

  async ngOnInit() {
    try { this.record.set(Number(localStorage.getItem(CHIAVE_RECORD)) || 0); } catch { /* niente record */ }
    try {
      this.tutti = await firstValueFrom(this.canti.elenco());
    } catch {
      return this.stato.set('errore');
    }
    if (this.tutti.length < 4) return this.stato.set('errore');
    this.ricomincia();
  }

  ngOnDestroy() {
    clearInterval(this.orologio);
  }

  ricomincia() {
    this.usati.clear();
    this.numero.set(0);
    this.punti.set(0);
    this.giuste.set(0);
    this.nuovoRecord.set(false);
    this.prossima = this.preparaDomanda();
    this.avanti();
  }

  /** La domanda dopo (preparata mentre si rispondeva a quella prima). */
  async avanti() {
    if (this.numero() >= DOMANDE) return this.fine();
    this.stato.set('carica');
    const domanda = await (this.prossima ?? this.preparaDomanda());
    if (!domanda) return this.stato.set('errore');
    this.domanda.set(domanda);
    this.numero.update(n => n + 1);
    this.scelta.set(null);
    this.stato.set('gioca');
    this.prossima = this.numero() < DOMANDE ? this.preparaDomanda() : undefined;
    this.partenza = Date.now();
    this.restano.set(SECONDI);
    clearInterval(this.orologio);
    this.orologio = setInterval(() => {
      const restano = Math.max(0, SECONDI - (Date.now() - this.partenza) / 1000);
      this.restano.set(restano);
      if (restano <= 0) this.rispondi(-1);
    }, 100);
  }

  /** La risposta (-1 = tempo scaduto). */
  rispondi(indice: number) {
    const domanda = this.domanda();
    if (this.stato() !== 'gioca' || !domanda) return;
    clearInterval(this.orologio);
    this.scelta.set(indice);
    if (indice >= 0 && domanda.scelte[indice].id === domanda.giusto.id) {
      this.giuste.update(n => n + 1);
      // 10 punti per la risposta giusta, fino a 10 in più se si è veloci.
      this.punti.update(p => p + 10 + Math.round(this.restano() / SECONDI * 10));
    }
    this.stato.set('risposta');
  }

  apriCanto() {
    const domanda = this.domanda();
    if (!domanda) return;
    this.chiudi();
    this.router.navigate(['/canzoniere', domanda.giusto.id]);
  }

  chiudi() {
    clearInterval(this.orologio);
    this.sorprese.indovina.set(false);
  }

  get giudizio(): string {
    const g = this.giuste();
    if (g >= 9) return 'Sei un canzoniere vivente! 🎸';
    if (g >= 6) return 'Pronto per il fuoco di bivacco 🔥';
    if (g >= 3) return 'Qualche canto lo sai… ripassa il canzoniere 📖';
    return 'Al prossimo fuoco stai vicino a chi suona 😄';
  }

  private fine() {
    clearInterval(this.orologio);
    if (this.punti() > this.record()) {
      this.record.set(this.punti());
      this.nuovoRecord.set(true);
      try { localStorage.setItem(CHIAVE_RECORD, String(this.punti())); } catch { /* pazienza */ }
    }
    this.stato.set('fine');
  }

  /** Un canto mai uscito con almeno due versi buoni: due versi di fila e quattro titoli. */
  private async preparaDomanda(): Promise<Domanda | null> {
    for (let tentativo = 0; tentativo < 12; tentativo++) {
      const liberi = this.tutti.filter(c => !this.usati.has(c.id));
      if (!liberi.length) this.usati.clear();
      const giusto = (liberi.length ? liberi : this.tutti)[Math.floor(Math.random() * (liberi.length || this.tutti.length))];
      this.usati.add(giusto.id);
      let testo = '';
      try { testo = (await firstValueFrom(this.canti.dettaglio(giusto.id))).testo; } catch { continue; }
      const titolo = giusto.titolo.toLowerCase();
      // Solo i versi: niente accordi, niente righe vuote o troppo corte, niente righe col titolo dentro.
      const versi = testo.split('\n')
        .filter(r => !rigaDiAccordi(r))
        .map(r => senzaSegniGrassetto(segnoRiga(r).riga).trim())
        .filter(r => r.length >= 12 && !r.toLowerCase().includes(titolo) && !/^rit\.?$/i.test(r));
      if (versi.length < 2) continue;
      const da = Math.floor(Math.random() * (versi.length - 1));
      // Gli altri titoli: della stessa sezione quando si può (così è più difficile).
      const stessa = this.tutti.filter(c => c.id !== giusto.id && c.sezione === giusto.sezione);
      const altri = (stessa.length >= 3 ? stessa : this.tutti.filter(c => c.id !== giusto.id))
        .sort(() => Math.random() - .5).slice(0, 3);
      const scelte = [...altri, giusto].sort(() => Math.random() - .5);
      return { versi: [versi[da], versi[da + 1]], giusto, scelte };
    }
    return null;
  }
}
