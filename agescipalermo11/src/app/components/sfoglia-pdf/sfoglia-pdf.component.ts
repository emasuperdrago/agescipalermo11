import {
  Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, inject
} from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { chevronBackOutline, chevronForwardOutline } from 'ionicons/icons';

// pdf.js: disegna una pagina alla volta dentro a un canvas, dentro a un "worker" così
// il disegno non blocca il resto della pagina. Il worker viaggia dentro al sito insieme
// al resto del codice (la build lo impacchetta da node_modules).
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFWorker } from 'pdfjs-dist';

/** Il motore di un PDF: il worker del browser e l'involucro con cui pdf.js ci parla. */
interface Motore {
  worker: Worker;
  pdfWorker: PDFWorker;
}

/**
 * Ogni PDF aperto ha il suo motore, che nasce e muore con lui. Con un motore solo per tutto
 * il sito, chiudere un PDF smontava anche la parte condivisa: gli altri riquadri aperti
 * (la Carta in vigore e quella dell'archivio, per esempio) restavano bloccati o davano
 * "Non riesco ad aprire questo PDF", passando da un'anteprima all'altra.
 */
function nuovoMotore(): Motore {
  const worker = new Worker(
    new URL('../../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
    { type: 'module' },
  );
  return { worker, pdfWorker: pdfjs.PDFWorker.fromPort({ port: worker }) };
}

/** Spegne un motore: prima pdf.js, poi il worker del browser. */
function spegniMotore(motore: Motore) {
  try { motore.pdfWorker.destroy(); } catch { /* già spento */ }
  motore.worker.terminate();
}

/** Il margine bianco dentro al riquadro, uguale a quello del foglio nel CSS. */
const BORDO = 10;

/**
 * Riquadro che sfoglia un PDF: una pagina per volta, avanti e indietro coi tasti,
 * con le frecce della tastiera o trascinando col dito.
 */
@Component({
  selector: 'app-sfoglia-pdf',
  templateUrl: './sfoglia-pdf.component.html',
  styleUrls: ['./sfoglia-pdf.component.scss'],
  standalone: true,
  imports: [IonIcon],
})
export class SfogliaPdfComponent implements OnChanges, OnDestroy {
  /** Indirizzo del PDF da sfogliare. */
  @Input() src = '';
  /** Quanto può essere alto il riquadro: in "riquadro" è contenuto, in "pagina" si allarga. */
  @Input() modo: 'riquadro' | 'pagina' = 'riquadro';

  @ViewChild('tela') tela?: ElementRef<HTMLCanvasElement>;
  @ViewChild('cornice') cornice?: ElementRef<HTMLElement>;

  readonly icone = { indietro: chevronBackOutline, avanti: chevronForwardOutline };

  pagina = 1;
  pagine = 0;
  /** Forma del foglio (larghezza / altezza): la prende il riquadro, così non resta vuoto attorno.
   *  Di partenza un A4 in piedi. */
  rapporto = 0.707;
  caricamento = true;
  errore = '';

  private host = inject(ElementRef<HTMLElement>);
  private documento: PDFDocumentProxy | null = null;
  /** L'apertura in corso (o finita) del PDF: è lei che va smontata quando si cambia. */
  private compito: PDFDocumentLoadingTask | null = null;
  /** Il motore tutto suo di questo riquadro (vedi nuovoMotore). */
  private motore: Motore | null = null;
  /** Il disegno in corso: se ne parte un altro, questo va fermato. */
  private disegno: { cancel(): void } | null = null;
  /** Il numero di richiesta: risposte vecchie che arrivano in ritardo si buttano. */
  private richiesta = 0;
  private osservatore?: ResizeObserver;
  private partenzaTocco = 0;

  ngOnChanges(cambi: SimpleChanges) {
    if (cambi['src']) this.apri();
  }

  ngOnDestroy() {
    this.chiudi();
    this.osservatore?.disconnect();
  }

  /** Chiude il PDF aperto e spegne il suo motore, che non serve a nessun altro. */
  private chiudi() {
    this.disegno?.cancel();
    this.disegno = null;
    const compito = this.compito;
    const motore = this.motore;
    this.compito = null;
    this.motore = null;
    this.documento = null;
    if (!motore) return;
    // Il motore si spegne dopo che pdf.js ha finito di smontare il documento.
    (compito ? compito.destroy() : Promise.resolve())
      .catch(() => { /* già smontato */ })
      .finally(() => spegniMotore(motore));
  }

  private async apri() {
    this.chiudi();
    this.pagina = 1;
    this.pagine = 0;
    this.errore = '';
    if (!this.src) {
      this.caricamento = false;
      return;
    }

    this.caricamento = true;
    const mia = ++this.richiesta;
    try {
      // Motore nuovo, tutto per questo PDF.
      const motore = nuovoMotore();
      this.motore = motore;
      const compito = pdfjs.getDocument({ url: this.src, worker: motore.pdfWorker, withCredentials: false });
      this.compito = compito;
      const documento = await compito.promise;
      // Nel frattempo è arrivato un altro PDF: questo lo ha già chiuso chi è arrivato dopo.
      if (mia !== this.richiesta) return;
      this.documento = documento;
      this.pagine = documento.numPages;
      this.caricamento = false;
      await this.disegna();
      this.seguiLaMisura();
    } catch {
      if (mia !== this.richiesta) return;
      this.caricamento = false;
      this.errore = 'Non riesco ad aprire questo PDF.';
    }
  }

  /** Se il riquadro cambia misura la pagina va ridisegnata, o resta sgranata. */
  private seguiLaMisura() {
    if (this.osservatore || typeof ResizeObserver === 'undefined') return;
    let larga = this.cornice?.nativeElement.clientWidth ?? 0;
    let alta = this.cornice?.nativeElement.clientHeight ?? 0;
    this.osservatore = new ResizeObserver(() => {
      const l = this.cornice?.nativeElement.clientWidth ?? 0;
      const a = this.cornice?.nativeElement.clientHeight ?? 0;
      if ((l && Math.abs(l - larga) > 8) || (a && Math.abs(a - alta) > 8)) {
        larga = l;
        alta = a;
        this.disegna();
      }
    });
    this.osservatore.observe(this.host.nativeElement);
  }

  private async disegna() {
    const documento = this.documento;
    const tela = this.tela?.nativeElement;
    const cornice = this.cornice?.nativeElement;
    if (!documento || !tela || !cornice) return;

    this.disegno?.cancel();
    const mia = this.richiesta;
    try {
      const pagina = await documento.getPage(this.pagina);
      if (mia !== this.richiesta) return;

      // La pagina intera deve stare nel riquadro: si sceglie la riduzione più stretta
      // fra larghezza e altezza, così non resta niente fuori da scorrere.
      // Su schermi fitti si disegna più grande del necessario, per non sgranare le lettere.
      const naturale = pagina.getViewport({ scale: 1 });
      this.rapporto = naturale.width / naturale.height;
      const spazioLargo = Math.max(cornice.clientWidth - BORDO * 2, 120);
      const spazioAlto = Math.max(cornice.clientHeight - BORDO * 2, 160);
      const quanto = Math.min(spazioLargo / naturale.width, spazioAlto / naturale.height);
      const nitidezza = Math.min(window.devicePixelRatio || 1, 2);
      const vista = pagina.getViewport({ scale: quanto * nitidezza });

      tela.width = Math.floor(vista.width);
      tela.height = Math.floor(vista.height);
      tela.style.width = `${Math.round(naturale.width * quanto)}px`;
      tela.style.height = `${Math.round(naturale.height * quanto)}px`;

      const contesto = tela.getContext('2d');
      if (!contesto) return;
      const compito = pagina.render({ canvasContext: contesto, viewport: vista });
      this.disegno = compito;
      await compito.promise;
      this.disegno = null;
    } catch (e) {
      // Un disegno interrotto perché se n'è chiesto un altro non è un errore da mostrare.
      if ((e as { name?: string })?.name !== 'RenderingCancelledException' && mia === this.richiesta)
        this.errore = 'Questa pagina non si riesce a disegnare.';
    }
  }

  vaiA(numero: number) {
    if (!this.pagine) return;
    const voluta = Math.min(Math.max(numero, 1), this.pagine);
    if (voluta === this.pagina) return;
    this.pagina = voluta;
    this.disegna();
  }

  precedente() { this.vaiA(this.pagina - 1); }
  successiva() { this.vaiA(this.pagina + 1); }

  tasto(evento: KeyboardEvent) {
    if (evento.key === 'ArrowLeft') { evento.preventDefault(); this.precedente(); }
    if (evento.key === 'ArrowRight') { evento.preventDefault(); this.successiva(); }
  }

  // Sul telefono si cambia pagina trascinando, come su un libro.
  iniziaTocco(evento: TouchEvent) {
    this.partenzaTocco = evento.changedTouches[0]?.clientX ?? 0;
  }

  finisciTocco(evento: TouchEvent) {
    const spostamento = (evento.changedTouches[0]?.clientX ?? 0) - this.partenzaTocco;
    if (Math.abs(spostamento) < 50) return;
    if (spostamento < 0) this.successiva(); else this.precedente();
  }
}
