import { Injectable, signal } from '@angular/core';

/** Chiaro, scuro, o come è impostato il telefono (o il computer). */
export type Tema = 'chiaro' | 'scuro' | 'auto';

const CHIAVE = 'temaSito';
/** Il colore della barra del telefono, di giorno e di notte. */
const BARRA = { chiaro: '#FFFFFF', scuro: '#0E0B14' };

/**
 * La modalità notte di tutto il sito. Non c'è un secondo foglio di colori: il browser rovescia
 * i colori di tutta l'app (vedi "Modalità notte" in global.scss), e foto, video, PDF, mappe e
 * testate colorate vengono rimessi come di giorno. La scelta resta in questo browser.
 */
@Injectable({ providedIn: 'root' })
export class TemaService {
  readonly scelta = signal<Tema>(this.leggi());
  /** La notte è accesa adesso (per la scelta o perché lo chiede il telefono). */
  readonly notte = signal(false);

  private schermoScuro = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

  /** Una volta sola, all'avvio del sito. */
  avvia() {
    this.applica();
    // Con "Come il telefono", si segue il telefono anche mentre il sito è aperto.
    this.schermoScuro?.addEventListener?.('change', () => this.applica());
  }

  scegli(tema: Tema) {
    this.scelta.set(tema);
    try { localStorage.setItem(CHIAVE, tema); } catch { /* resta per questa volta */ }
    this.applica();
  }

  /** Il pulsante della luna: notte se adesso è giorno, giorno se è notte. */
  alterna() {
    this.scegli(this.notte() ? 'chiaro' : 'scuro');
  }

  private leggi(): Tema {
    try {
      const salvato = localStorage.getItem(CHIAVE);
      if (salvato === 'chiaro' || salvato === 'scuro' || salvato === 'auto') return salvato;
    } catch { /* browser senza memoria */ }
    return 'chiaro';
  }

  private applica() {
    const notte = this.scelta() === 'scuro' || (this.scelta() === 'auto' && !!this.schermoScuro?.matches);
    this.notte.set(notte);
    document.documentElement.classList.toggle('notte', notte);
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = notte ? BARRA.scuro : BARRA.chiaro;
  }
}
