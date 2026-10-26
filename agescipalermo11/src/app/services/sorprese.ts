import { Injectable, NgZone, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { CantiService } from './canti';

/**
 * Gli easter egg del sito: piccole sorprese nascoste, che chi non le conosce non vede mai.
 *  - parole scritte (nella ricerca o ovunque): "estote parati", "akela", "shere khan", "baden powell"/"bp";
 *  - 11 tocchi sul logo: fuochi a forma di giglio; logo tenuto premuto: "PALERMO 11" in morse (vibra);
 *  - il codice Konami (↑↑↓↓←→←→BA): il sito in stile anni '80 per qualche secondo;
 *  - scuotendo il telefono nel canzoniere: un canto a sorpresa;
 *  - 5 tocchi sul murales di Marco: l'orso con la sua frase;
 *  - nella home, certi giorni: 11 novembre (compleanno del gruppo), 22 febbraio (Thinking Day),
 *    23 aprile (San Giorgio: un drago da sconfiggere).
 * La pagina "non trovata" ha il suo minigioco (vedi components/sentiero-perso).
 */
export type Scena =
  | 'campo' | 'lupi' | 'tigre' | 'bp' | 'gigli' | 'anni80' | 'canto' | 'orso'
  | 'compleanno' | 'thinking';

/** Quanto resta sullo schermo ogni sorpresa (millisecondi). */
const DURATA: Record<Scena, number> = {
  campo: 7000, lupi: 4500, tigre: 4500, bp: 6500, gigli: 4500, anni80: 8000, canto: 2200, orso: 6000,
  compleanno: 7000, thinking: 7000,
};

/** Le parole segrete, già senza spazi e in minuscolo. */
const PAROLE: Record<string, Scena> = {
  estoteparati: 'campo', akela: 'lupi', sherekhan: 'tigre', badenpowell: 'bp',
};

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

/** "PALERMO 11" in morse: punto 80 ms, linea 240, pausa fra segni 80, fra lettere 240, fra parole 560. */
const MORSE: Record<string, string> = {
  P: '.--.', A: '.-', L: '.-..', E: '.', R: '.-.', M: '--', O: '---', '1': '.----',
};

/** Frasi di Baden-Powell: ogni volta una diversa. */
export const FRASI_BP = [
  'Lasciate il mondo un po\' migliore di come l\'avete trovato.',
  'Guarda lontano, e anche quando credi di guardare lontano, guarda ancora più lontano.',
  'Il vero modo di essere felici è quello di procurare la felicità agli altri.',
  'Un sorriso e un fischio rendono più leggera qualsiasi fatica.',
  'Lo scout guida da sé la propria canoa.',
];

const ANNO_FONDAZIONE = 1983;
const TOCCHI_LOGO = 11;
const TOCCHI_MURALES = 5;
/** Selettore dei loghi del gruppo (testate, home, benvenuto). */
const LOGHI = 'img[src*="pa11-192"], img[src*="logo-palermo11"]';

@Injectable({ providedIn: 'root' })
export class SorpreseService {
  private zone = inject(NgZone);
  private router = inject(Router);
  private canti = inject(CantiService);

  /** La sorpresa sullo schermo adesso (null = niente). */
  readonly scena = signal<Scena | null>(null);
  /** La frase di B.-P. di questa volta. */
  readonly frase = signal(FRASI_BP[0]);
  /** Il 23 aprile, nella home: il drago da sconfiggere (colpi che mancano; 0 = sconfitto, null = niente drago). */
  readonly drago = signal<number | null>(null);
  /** Gli anni del gruppo, per il compleanno. */
  readonly anni = signal(0);

  private timer?: ReturnType<typeof setTimeout>;
  private scritto = '';
  private konami = 0;
  private tocchiLogo: number[] = [];
  private tocchiMurales: number[] = [];
  private premuto?: ReturnType<typeof setTimeout>;
  private bloccaClic = false;
  private ultimaScossa = 0;

  avvia() {
    this.zone.runOutsideAngular(() => {
      // Le parole: nei campi di testo (anche da telefono) e, fuori dai campi, coi tasti.
      document.addEventListener('input', e => this.controllaCampo(e.target), true);
      document.addEventListener('keydown', e => this.tasto(e), true);
      // Tocchi e pressione lunga su logo e murales.
      document.addEventListener('pointerdown', e => this.premi(e), true);
      document.addEventListener('pointerup', () => this.lascia(), true);
      document.addEventListener('pointercancel', () => this.lascia(), true);
      document.addEventListener('click', e => this.clic(e), true);
      window.addEventListener('devicemotion', e => this.scossa(e));
    });
    // I giorni speciali, entrando nella home.
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(e => {
      if ((e as NavigationEnd).urlAfterRedirects.split('?')[0] === '/home') this.giornoSpeciale();
    });
  }

  /** Mostra una sorpresa per un po' (se ce n'è già una, la sostituisce). */
  mostra(scena: Scena) {
    this.zone.run(() => {
      clearTimeout(this.timer);
      if (scena === 'bp') this.frase.set(FRASI_BP[Math.floor(Math.random() * FRASI_BP.length)]);
      this.scena.set(scena);
      this.timer = setTimeout(() => this.zone.run(() => this.scena.set(null)), DURATA[scena]);
    });
  }

  chiudi() {
    clearTimeout(this.timer);
    this.scena.set(null);
  }

  /** Un colpo al drago di San Giorgio. */
  colpisciDrago() {
    const colpi = this.drago();
    if (!colpi) return;
    this.drago.set(colpi - 1);
    if (colpi - 1 === 0) {
      try { sessionStorage.setItem('dragoSconfitto', '1'); } catch { /* pazienza */ }
      setTimeout(() => this.zone.run(() => this.drago.set(null)), 4000);
    }
  }

  // ---------- Parole ----------

  private normalizza(testo: string): string {
    return testo.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  }

  private controllaCampo(target: EventTarget | null) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (target.type === 'password') return;
    const valore = this.normalizza(target.value);
    // "bp" solo se è tutto quello che c'è scritto (è corto: dentro una frase capita per caso).
    if (valore === 'bp') return this.mostra('bp');
    for (const [parola, scena] of Object.entries(PAROLE)) if (valore.endsWith(parola)) return this.mostra(scena);
  }

  private tasto(e: KeyboardEvent) {
    // Il codice Konami vale ovunque, anche nei campi (le frecce non scrivono).
    const atteso = KONAMI[this.konami];
    this.konami = e.key.toLowerCase() === atteso.toLowerCase() ? this.konami + 1 : (e.key === KONAMI[0] ? 1 : 0);
    if (this.konami === KONAMI.length) {
      this.konami = 0;
      this.mostra('anni80');
    }
    // Le parole scritte fuori dai campi (nei campi ci pensa controllaCampo).
    const dove = e.target as HTMLElement | null;
    if (dove?.closest('input, textarea, [contenteditable]')) return;
    if (e.key.length !== 1) return;
    this.scritto = (this.scritto + e.key).slice(-30);
    const valore = this.normalizza(this.scritto);
    for (const [parola, scena] of Object.entries(PAROLE)) {
      if (valore.endsWith(parola)) {
        this.scritto = '';
        return this.mostra(scena);
      }
    }
    if (valore.endsWith('bp') && /\bbp$/i.test(this.scritto.trim())) {
      this.scritto = '';
      this.mostra('bp');
    }
  }

  // ---------- Logo e murales ----------

  private premi(e: PointerEvent) {
    const logo = (e.target as Element | null)?.closest?.(LOGHI);
    if (!logo) return;
    clearTimeout(this.premuto);
    // Tenuto premuto più di un secondo: PALERMO 11 in morse (vibra, dove il telefono lo sa fare).
    this.premuto = setTimeout(() => {
      this.bloccaClic = true;
      this.vibraMorse();
    }, 1000);
  }

  private lascia() {
    clearTimeout(this.premuto);
  }

  private clic(e: MouseEvent) {
    const elemento = e.target as Element | null;
    const logo = elemento?.closest?.(LOGHI);
    if (logo && this.bloccaClic) {
      // Dopo la pressione lunga il logo non porta da nessuna parte.
      this.bloccaClic = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (logo) {
      this.tocchiLogo = this.conta(this.tocchiLogo, 5000);
      if (this.tocchiLogo.length >= TOCCHI_LOGO) {
        this.tocchiLogo = [];
        this.mostra('gigli');
      }
      return;
    }
    if (elemento?.closest?.('.murales img')) {
      this.tocchiMurales = this.conta(this.tocchiMurales, 4000);
      if (this.tocchiMurales.length >= TOCCHI_MURALES) {
        this.tocchiMurales = [];
        this.mostra('orso');
      }
    }
  }

  /** Aggiunge un tocco e tiene solo quelli degli ultimi `entro` millisecondi. */
  private conta(tocchi: number[], entro: number): number[] {
    const adesso = Date.now();
    return [...tocchi.filter(t => adesso - t < entro), adesso];
  }

  private vibraMorse() {
    if (!('vibrate' in navigator)) return;
    // Si alternano vibrazione e pausa: ogni segno vibra, poi si ferma (di più fra lettere e parole).
    const schema: number[] = [];
    const parole = ['PALERMO', '11'];
    parole.forEach((parola, p) => [...parola].forEach((lettera, l) => {
      const segni = [...MORSE[lettera]];
      segni.forEach((segno, s) => {
        schema.push(segno === '.' ? 80 : 240);
        const fineLettera = s === segni.length - 1;
        const fineParola = fineLettera && l === parola.length - 1;
        schema.push(fineParola ? (p < parole.length - 1 ? 560 : 0) : fineLettera ? 240 : 80);
      });
    }));
    navigator.vibrate(schema);
  }

  // ---------- Telefono scosso nel canzoniere ----------

  private async scossa(e: DeviceMotionEvent) {
    if (!/^\/canzoniere\/?(\?|$)/.test(this.router.url)) return;
    const a = e.accelerationIncludingGravity;
    if (!a?.x || !a.y || !a.z) return;
    const forza = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    const adesso = Date.now();
    if (forza < 30 || adesso - this.ultimaScossa < 3000) return;
    this.ultimaScossa = adesso;
    try {
      const tutti = await firstValueFrom(this.canti.elenco());
      if (!tutti.length) return;
      const canto = tutti[Math.floor(Math.random() * tutti.length)];
      this.mostra('canto');
      setTimeout(() => this.zone.run(() => this.router.navigate(['/canzoniere', canto.id])), 900);
    } catch { /* niente canto a sorpresa: pazienza */ }
  }

  // ---------- Giorni speciali ----------

  /** Oggi (mese-giorno); sul Mac di prova si può fingere un altro giorno con ?oggi=MM-GG. */
  private oggi(): { mese: number; giorno: number; anno: number } {
    const adesso = new Date();
    const finto = location.hostname === 'localhost' ? new URLSearchParams(location.search).get('oggi') : null;
    const [m, g] = (finto ?? '').split('-').map(Number);
    return finto && m && g
      ? { mese: m, giorno: g, anno: adesso.getFullYear() }
      : { mese: adesso.getMonth() + 1, giorno: adesso.getDate(), anno: adesso.getFullYear() };
  }

  /** Una volta per visita: la sorpresa del giorno, se oggi è un giorno speciale. */
  private giornoSpeciale() {
    const { mese, giorno, anno } = this.oggi();
    const chiave = (nome: string) => `sorpresa-${nome}-${anno}`;
    const giaVista = (nome: string) => { try { return !!sessionStorage.getItem(chiave(nome)); } catch { return false; } };
    const segna = (nome: string) => { try { sessionStorage.setItem(chiave(nome), '1'); } catch { /* pazienza */ } };
    // Si aspetta che la home sia comparsa.
    setTimeout(() => {
      if (mese === 11 && giorno === 11 && !giaVista('compleanno')) {
        segna('compleanno');
        this.anni.set(anno - ANNO_FONDAZIONE);
        this.mostra('compleanno');
      } else if (mese === 2 && giorno === 22 && !giaVista('thinking')) {
        segna('thinking');
        this.mostra('thinking');
      } else if (mese === 4 && giorno === 23) {
        let sconfitto = false;
        try { sconfitto = !!sessionStorage.getItem('dragoSconfitto'); } catch { /* pazienza */ }
        if (!sconfitto && this.drago() === null) this.zone.run(() => this.drago.set(7));
      }
    }, 900);
  }
}
