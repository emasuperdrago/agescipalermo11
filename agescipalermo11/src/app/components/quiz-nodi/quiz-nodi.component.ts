import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { SorpreseService } from '../../services/sorprese';

/** Un nodo o una legatura e a cosa serve. */
interface Nodo { nome: string; uso: string; legatura?: boolean }

const NODI: Nodo[] = [
  { nome: 'Nodo piano', uso: 'unire due corde dello stesso spessore' },
  { nome: 'Nodo di scotta', uso: 'unire due corde di spessore diverso' },
  { nome: 'Gassa d\'amante', uso: 'fare un\'asola che non scorre, per esempio per legarsi in vita' },
  { nome: 'Parlato', uso: 'fissare una corda a un palo, per cominciare e finire le legature' },
  { nome: 'Nodo Savoia', uso: 'fare un nodo d\'arresto in fondo alla corda, perché non si sfili' },
  { nome: 'Bocca di lupo', uso: 'fissare in fretta una corda a un palo o a un anello con un\'asola' },
  { nome: 'Nodo del pescatore', uso: 'unire due corde sottili e scivolose, come le lenze' },
  { nome: 'Nodo margherita', uso: 'accorciare una corda senza tagliarla' },
  { nome: 'Due mezzi colli', uso: 'legare una corda a un anello o a un palo, per esempio per ormeggiare una barca' },
  { nome: 'Nodo Prusik', uso: 'fare un nodo che si blocca sotto peso e scorre a mano, per risalire una corda' },
  { nome: 'Legatura quadra', uso: 'unire due pali che si incrociano ad angolo retto', legatura: true },
  { nome: 'Legatura a croce', uso: 'unire due pali incrociati che tendono ad allontanarsi', legatura: true },
  { nome: 'Legatura parallela', uso: 'unire due pali affiancati, per esempio per allungarli', legatura: true },
  { nome: 'Legatura a tripode', uso: 'unire tre pali per fare un treppiede', legatura: true },
];

/** L'alfabeto morse internazionale: punto e linea. */
const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....',
  '6': '-....', '7': '--...', '8': '---..', '9': '----.',
};
const LETTERE = Object.keys(MORSE);

/** Una domanda: il testo, l'eventuale codice morse da mostrare (e far sentire) e quattro scelte. */
interface Domanda {
  tipo: 'nodo' | 'morse';
  testo: string;
  /** Il codice da leggere (per "che lettera è?"), coi punti e le linee. */
  codice?: string;
  /** Le scelte sono codici morse (per "come si scrive?"): si disegnano punti e linee. */
  sceltePunti?: boolean;
  /** Il codice da far sentire con "Ascolta" (punti e linee). */
  suono?: string;
  scelte: string[];
  giusta: number;
  /** Spiegazione dopo la risposta. */
  spiega: string;
}

const DOMANDE = 10;
const SECONDI = 20;
const CHIAVE_RECORD = 'quizNodiRecord';

/** Punti e linee scritti per esteso (per la spiegazione, che resta testo). */
const segni = (codice: string) => codice.replace(/\./g, '·').replace(/-/g, '−').split('').join(' ');

function mescola<T>(elenco: T[]): T[] {
  const copia = [...elenco];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/** Quattro scelte con la giusta in mezzo: torna le scelte e dove sta la giusta. */
function conGiusta(giusta: string, altre: string[]): { scelte: string[]; giusta: number } {
  const scelte = mescola([giusta, ...mescola(altre.filter(a => a !== giusta)).slice(0, 3)]);
  return { scelte, giusta: scelte.indexOf(giusta) };
}

function domandaNodo(): Domanda {
  const nodo = NODI[Math.floor(Math.random() * NODI.length)];
  // Le scelte sbagliate dello stesso tipo (nodi con nodi, legature con legature): più difficile.
  const simili = NODI.filter(n => n !== nodo && !!n.legatura === !!nodo.legatura);
  const altri = simili.length >= 3 ? simili : NODI.filter(n => n !== nodo);
  if (Math.random() < .5) {
    const { scelte, giusta } = conGiusta(nodo.uso, altri.map(n => n.uso));
    return { tipo: 'nodo', testo: `A cosa serve: ${nodo.nome}?`, scelte, giusta, spiega: `${nodo.nome}: serve per ${nodo.uso}.` };
  }
  const { scelte, giusta } = conGiusta(nodo.nome, altri.map(n => n.nome));
  return { tipo: 'nodo', testo: `Quale usi per ${nodo.uso}?`, scelte, giusta, spiega: `Si usa: ${nodo.nome}.` };
}

function domandaMorse(): Domanda {
  const lettera = LETTERE[Math.floor(Math.random() * LETTERE.length)];
  const codice = MORSE[lettera];
  // Le sbagliate: codici della stessa lunghezza quando si può, si confondono di più.
  const simili = LETTERE.filter(l => l !== lettera && MORSE[l].length === codice.length);
  const altre = simili.length >= 3 ? simili : LETTERE.filter(l => l !== lettera);
  const spiega = `${lettera} = ${segni(codice)}`;
  if (Math.random() < .5) {
    const { scelte, giusta } = conGiusta(lettera, altre);
    return { tipo: 'morse', testo: 'Che lettera è?', codice, suono: codice, scelte, giusta, spiega };
  }
  const { scelte, giusta } = conGiusta(codice, altre.map(l => MORSE[l]));
  return { tipo: 'morse', testo: `Come si scrive «${lettera}» in morse?`, scelte, giusta, spiega, sceltePunti: true };
}

/**
 * "Nodi e morse": dieci domande, metà sui nodi e le legature e metà sul morse, venti secondi
 * l'una; più si risponde in fretta più punti si prendono. Il morse si può anche ascoltare.
 * Si apre dalla parte Specialità del Reparto. Uso: dentro app-sorprese.
 */
@Component({
  selector: 'app-quiz-nodi',
  templateUrl: './quiz-nodi.component.html',
  styleUrls: ['./quiz-nodi.component.scss'],
  standalone: true,
})
export class QuizNodiComponent implements OnInit, OnDestroy {
  private sorprese = inject(SorpreseService);

  readonly totale = DOMANDE;
  readonly secondi = SECONDI;
  readonly stato = signal<'gioca' | 'risposta' | 'fine'>('gioca');
  readonly domanda = signal<Domanda | null>(null);
  readonly numero = signal(0);
  readonly punti = signal(0);
  readonly giuste = signal(0);
  readonly scelta = signal<number | null>(null);
  readonly restano = signal(SECONDI);
  readonly record = signal(0);
  readonly nuovoRecord = signal(false);

  private elenco: Domanda[] = [];
  private orologio?: ReturnType<typeof setInterval>;
  private partenza = 0;
  private audio?: AudioContext;

  ngOnInit() {
    try { this.record.set(Number(localStorage.getItem(CHIAVE_RECORD)) || 0); } catch { /* niente record */ }
    this.ricomincia();
  }

  ngOnDestroy() {
    clearInterval(this.orologio);
    this.audio?.close().catch(() => undefined);
  }

  ricomincia() {
    // Metà nodi e metà morse, mescolati; mai due volte la stessa domanda.
    const visti = new Set<string>();
    const nuova = (fai: () => Domanda) => {
      for (let i = 0; i < 20; i++) {
        const d = fai();
        const chiave = d.testo + (d.codice ?? '');
        if (!visti.has(chiave)) { visti.add(chiave); return d; }
      }
      return fai();
    };
    this.elenco = mescola([
      ...Array.from({ length: DOMANDE / 2 }, () => nuova(domandaNodo)),
      ...Array.from({ length: DOMANDE / 2 }, () => nuova(domandaMorse)),
    ]);
    this.numero.set(0);
    this.punti.set(0);
    this.giuste.set(0);
    this.nuovoRecord.set(false);
    this.avanti();
  }

  avanti() {
    if (this.numero() >= DOMANDE) return this.fine();
    this.domanda.set(this.elenco[this.numero()]);
    this.numero.update(n => n + 1);
    this.scelta.set(null);
    this.stato.set('gioca');
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
    if (indice === domanda.giusta) {
      this.giuste.update(n => n + 1);
      // 10 punti per la risposta giusta, fino a 10 in più se si è veloci.
      this.punti.update(p => p + 10 + Math.round(this.restano() / SECONDI * 10));
    }
    this.stato.set('risposta');
  }

  /** Fa sentire il codice: punto corto, linea lunga, come col fischietto. */
  ascolta() {
    const codice = this.domanda()?.suono;
    if (!codice) return;
    try {
      this.audio ??= new AudioContext();
      if (this.audio.state === 'suspended') this.audio.resume();
      let tempo = this.audio.currentTime + .05;
      for (const segno of codice) {
        const durata = segno === '.' ? .12 : .36;
        const nota = this.audio.createOscillator();
        const volume = this.audio.createGain();
        nota.frequency.value = 700;
        volume.gain.value = .12;
        nota.connect(volume).connect(this.audio.destination);
        nota.start(tempo);
        nota.stop(tempo + durata);
        tempo += durata + .12;
      }
    } catch { /* senza suono si legge e basta */ }
  }

  /** I segni di un codice, uno per uno, per disegnarli. */
  segniDi(codice: string): ('punto' | 'linea')[] {
    return [...codice].map(c => c === '.' ? 'punto' : 'linea');
  }

  /** Per chi non vede i segni: "punto linea punto". */
  aVoce(codice: string): string {
    return this.segniDi(codice).join(' ');
  }

  chiudi() {
    clearInterval(this.orologio);
    this.sorprese.quiz.set(false);
  }

  get giudizio(): string {
    const g = this.giuste();
    if (g >= 9) return 'Pronto per il brevetto di pioniere! 🪢';
    if (g >= 6) return 'Le tende stanno su e i messaggi arrivano 📡';
    if (g >= 3) return 'Ripassa con la tua squadriglia, ci sei quasi ⛺';
    return 'Prendi una corda e un amico che te li insegni 😄';
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
}
