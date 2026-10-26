import { AfterViewInit, Component, ElementRef, HostListener, NgZone, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { SorpreseService } from '../../services/sorprese';

/** Un ostacolo sul sentiero (o un uccello in volo, più avanti nel gioco). */
interface Ostacolo { x: number; tipo: string; larghezza: number; altezza: number; inAria: boolean }
/** Una nuvola o un albero sullo sfondo, che scorre più piano. */
interface Sfondo { x: number; y: number; tipo: string; misura: number; velocita: number }

const LARGHEZZA = 640;
const ALTEZZA = 220;
const TERRENO = 180;
const GRAVITA = 0.62;
const SALTO = -11.6;
const CHIAVE_RECORD = 'lupettoRecord';

/**
 * Easter egg: quando cade la connessione, invece di un errore c'è il lupetto che corre sul sentiero
 * e salta tronchi e sassi (come il dinosauro di Chrome). Si salta toccando lo schermo o con la
 * barra spaziatrice; più si va avanti più si corre veloce. Il record resta sul telefono.
 * Uso: una volta sola, in app-sorprese.
 */
@Component({
  selector: 'app-lupetto',
  templateUrl: './lupetto.component.html',
  styleUrls: ['./lupetto.component.scss'],
  standalone: true,
})
export class LupettoComponent implements AfterViewInit, OnDestroy {
  readonly sorprese = inject(SorpreseService);
  private zone = inject(NgZone);

  @ViewChild('tela') private tela?: ElementRef<HTMLCanvasElement>;

  readonly stato = signal<'pronto' | 'gioca' | 'fine'>('pronto');
  readonly punti = signal(0);
  readonly record = signal(0);
  readonly nuovoRecord = signal(false);

  private ctx?: CanvasRenderingContext2D;
  private giro = 0;
  private ultimo = 0;
  private y = TERRENO;
  private velY = 0;
  private velocita = 6;
  private distanza = 0;
  private prossimo = 0;
  private ostacoli: Ostacolo[] = [];
  private sfondo: Sfondo[] = [];
  private passo = 0;

  ngAfterViewInit() {
    try { this.record.set(Number(localStorage.getItem(CHIAVE_RECORD)) || 0); } catch { /* niente record */ }
    const tela = this.tela?.nativeElement;
    if (!tela) return;
    // Nitido anche sugli schermi ad alta densità.
    const densita = Math.min(window.devicePixelRatio || 1, 2);
    tela.width = LARGHEZZA * densita;
    tela.height = ALTEZZA * densita;
    this.ctx = tela.getContext('2d') ?? undefined;
    this.ctx?.scale(densita, densita);
    this.preparaSfondo();
    this.disegna();
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.giro);
  }

  // ---------- Comandi ----------

  @HostListener('window:keydown', ['$event'])
  tasto(e: KeyboardEvent) {
    if (e.code !== 'Space' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    this.salta();
  }

  salta() {
    if (this.stato() !== 'gioca') return this.parti();
    // Si salta solo da terra.
    if (this.y >= TERRENO) this.velY = SALTO;
  }

  parti() {
    this.y = TERRENO;
    this.velY = 0;
    this.velocita = 6;
    this.distanza = 0;
    this.prossimo = 60;
    this.ostacoli = [];
    this.punti.set(0);
    this.nuovoRecord.set(false);
    this.stato.set('gioca');
    this.ultimo = performance.now();
    cancelAnimationFrame(this.giro);
    // Il gioco gira fuori da Angular: sessanta disegni al secondo non devono ridisegnare la pagina.
    this.zone.runOutsideAngular(() => this.giro = requestAnimationFrame(t => this.avanza(t)));
  }

  chiudi() {
    cancelAnimationFrame(this.giro);
    this.sorprese.lupetto.set(false);
  }

  // ---------- Il gioco ----------

  private preparaSfondo() {
    this.sfondo = [];
    for (let i = 0; i < 4; i++)
      this.sfondo.push({ x: Math.random() * LARGHEZZA, y: 20 + Math.random() * 50, tipo: '☁️', misura: 26 + Math.random() * 14, velocita: .15 });
    for (let i = 0; i < 6; i++)
      this.sfondo.push({ x: i * 120 + Math.random() * 60, y: TERRENO - 8, tipo: Math.random() < .5 ? '🌲' : '🌳', misura: 30 + Math.random() * 18, velocita: .35 });
  }

  private avanza(adesso: number) {
    // Lo stesso passo su ogni telefono, anche se uno disegna più in fretta di un altro.
    const fattore = Math.min((adesso - this.ultimo) / (1000 / 60), 3);
    this.ultimo = adesso;

    this.velY += GRAVITA * fattore;
    this.y = Math.min(TERRENO, this.y + this.velY * fattore);
    if (this.y >= TERRENO) this.velY = 0;

    this.velocita = Math.min(14, 6 + this.distanza / 1500);
    const avanti = this.velocita * fattore;
    this.distanza += avanti;
    this.passo += avanti;

    // Nuovi ostacoli, sempre a distanza giusta per poterli saltare.
    this.prossimo -= avanti;
    if (this.prossimo <= 0) {
      const inAria = this.distanza > 2500 && Math.random() < .22;
      const tipi = inAria ? ['🦅'] : ['🪵', '🪨', '🌿', '🪵'];
      const tipo = tipi[Math.floor(Math.random() * tipi.length)];
      const misura = tipo === '🪨' ? 30 : tipo === '🌿' ? 34 : 36;
      this.ostacoli.push({ x: LARGHEZZA + 20, tipo, larghezza: misura * .7, altezza: misura * .7, inAria });
      this.prossimo = 260 + Math.random() * 260 + this.velocita * 12;
    }
    this.ostacoli.forEach(o => o.x -= avanti);
    this.ostacoli = this.ostacoli.filter(o => o.x > -60);
    this.sfondo.forEach(s => {
      s.x -= avanti * s.velocita;
      if (s.x < -50) s.x = LARGHEZZA + Math.random() * 80;
    });

    const punti = Math.floor(this.distanza / 12);
    if (punti !== this.punti()) this.zone.run(() => this.punti.set(punti));

    if (this.scontro()) return this.zone.run(() => this.fine());
    this.disegna();
    this.giro = requestAnimationFrame(t => this.avanza(t));
  }

  /** Il lupetto tocca un ostacolo (con un po' di margine: deve sembrare giusto, non pignolo). */
  private scontro(): boolean {
    const lupo = { x: 62, y: this.y - 30, l: 30, a: 28 };
    return this.ostacoli.some(o => {
      const oy = o.inAria ? TERRENO - 62 : TERRENO - o.altezza;
      return lupo.x < o.x + o.larghezza && lupo.x + lupo.l > o.x
        && lupo.y < oy + o.altezza && lupo.y + lupo.a > oy;
    });
  }

  private fine() {
    this.stato.set('fine');
    if (this.punti() > this.record()) {
      this.record.set(this.punti());
      this.nuovoRecord.set(true);
      try { localStorage.setItem(CHIAVE_RECORD, String(this.punti())); } catch { /* pazienza */ }
    }
    this.disegna();
  }

  private disegna() {
    const c = this.ctx;
    if (!c) return;
    // Il cielo e il prato.
    const cielo = c.createLinearGradient(0, 0, 0, ALTEZZA);
    cielo.addColorStop(0, '#CDE8F7');
    cielo.addColorStop(1, '#F4FAF0');
    c.fillStyle = cielo;
    c.fillRect(0, 0, LARGHEZZA, ALTEZZA);
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    for (const s of this.sfondo) {
      c.font = `${s.misura}px sans-serif`;
      c.globalAlpha = s.tipo === '☁️' ? .9 : .55;
      c.fillText(s.tipo, s.x, s.tipo === '☁️' ? s.y + s.misura : s.y);
    }
    c.globalAlpha = 1;
    c.fillStyle = '#8DBF6A';
    c.fillRect(0, TERRENO - 2, LARGHEZZA, ALTEZZA - TERRENO + 2);
    // Il sentiero: trattini che scorrono.
    c.fillStyle = '#B98A5A';
    for (let x = -(this.passo % 40); x < LARGHEZZA; x += 40) c.fillRect(x, TERRENO + 12, 22, 4);

    for (const o of this.ostacoli) {
      c.font = `${o.inAria ? 30 : 36}px sans-serif`;
      c.fillText(o.tipo, o.x + o.larghezza / 2, o.inAria ? TERRENO - 30 : TERRENO + 4);
    }

    // Il lupetto: l'emoji guarda a sinistra, lo si gira verso il sentiero; corre "ballonzolando".
    const saltella = this.stato() === 'gioca' && this.y >= TERRENO ? Math.abs(Math.sin(this.passo / 14)) * 3 : 0;
    c.save();
    c.translate(77, this.y + 4 - saltella);
    c.scale(-1, 1);
    c.font = '40px sans-serif';
    c.fillText(this.stato() === 'fine' ? '😵' : '🐺', 0, 0);
    c.restore();
  }
}
