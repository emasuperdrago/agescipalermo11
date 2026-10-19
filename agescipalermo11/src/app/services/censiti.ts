import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import readXlsxFile from 'read-excel-file/browser';
import { apiUrl } from './api';
import {
  Branca, EsitoImport, RigaImport, RigaScartata, UtenteElenco
} from '../../types/models';

export interface LetturaExcel {
  foglio: string;
  righe: RigaImport[];
  scartate: RigaScartata[];
  /**
   * Righe che il file ha ma che non riguardano questo caricamento: nell'elenco del censimento
   * c'è tutto il gruppo, e chi carica i capi salta i ragazzi (e viceversa), chi carica i ragazzi
   * di una branca salta le altre.
   */
  ignorate: number;
}

type Campo = 'codice' | 'nome' | 'cognome' | 'eta' | 'nascita' | 'branca' | 'unita' | 'anno' | 'foca' | 'email';

/** Chi si sta caricando e, per i ragazzi, di quale branca. */
export interface OpzioniLettura {
  chi: 'capi' | 'ragazzi';
  /** La branca di chi carica i ragazzi: le righe delle altre branche si saltano. */
  branca?: Branca | null;
}

/** Quante righe iniziali controllare per trovare quella con le intestazioni (sopra possono esserci titoli). */
const RIGHE_RICERCA_INTESTAZIONE = 20;

function normalizza(valore: unknown): string {
  return String(valore ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Riconosce le intestazioni delle colonne che il sito legge: quelle dell'elenco soci del
 * censimento AGESCI (CodiceSocio, Nome, Cognome, DataNascita, TipoUnita, Branca, LivelloFoCa,
 * Email) e quelle più comuni dei file fatti a mano. Tutte le altre colonne (codice fiscale,
 * indirizzo, cellulare, informative…) non si leggono proprio.
 */
function campoDaIntestazione(cella: unknown): Campo | null {
  const t = normalizza(cella);
  if (!t) return null;
  // "CodiceSocio" sì, "StatusSocio" e "ArticoloSocio" no; "CodiceFiscale" nemmeno.
  if (t.includes('censiment') || t === 'codicesocio' || t === 'codsocio' || t === 'numerosocio'
      || t === 'socio' || t === 'codice' || t === 'cod') return 'codice';
  if (t === 'cognome') return 'cognome';
  if (t === 'nome') return 'nome';
  if (t === 'eta' || t === 'anni' || t.startsWith('eta')) return 'eta';
  // "DataNascita" sì, "ComuneNascita" no.
  if (t === 'nascita' || t === 'datanascita' || t === 'datadinascita' || t === 'nascitadata') return 'nascita';
  if (t === 'branca') return 'branca';
  if (t === 'tipounita' || t === 'unita') return 'unita';
  if (t.includes('foca')) return 'foca';
  if (t === 'email' || t === 'mail' || t === 'indirizzoemail') return 'email';
  // Anno di percorso dentro la branca (1, 2, 3): da non confondere con l'anno di nascita o con l'età.
  if (t === 'anno' || t === 'annobranca' || t.includes('percorso')) return 'anno';
  return null;
}

/**
 * null se la casella è vuota (capita: il ragazzo è entrato prima del censimento e il codice
 * arriverà), undefined se c'è scritto qualcosa che non è un codice.
 */
function leggiCodice(valore: unknown): number | null | undefined {
  const testo = String(valore ?? '').replace(/\s/g, '');
  if (!testo) return null;
  return /^\d{1,10}$/.test(testo) && Number(testo) > 0 ? Number(testo) : undefined;
}

/** null se vuota, undefined se presente ma non valida. */
function leggiEta(valore: unknown): number | null | undefined {
  if (valore === null || valore === undefined || String(valore).trim() === '') return null;
  const eta = Number(String(valore).trim().replace(',', '.'));
  return Number.isInteger(eta) && eta >= 0 && eta <= 120 ? eta : undefined;
}

/**
 * La data di nascita della cella come "AAAA-MM-GG" (giorno locale): accetta sia le date vere
 * di Excel sia quelle scritte a mano tipo 12/05/2014. È questa che si manda al server,
 * così l'età si ricalcola da sola a ogni compleanno.
 */
function dataDaCella(valore: unknown): string | null {
  let data: Date | null = null;
  if (valore instanceof Date) {
    data = valore;
  } else {
    // 12/05/2014, anche con l'ora dopo come nell'elenco del censimento ("12/05/2014 00:00:00").
    const testo = String(valore ?? '').trim();
    const m = testo.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
    const iso = testo.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) data = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    else if (iso) data = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  if (!data || isNaN(data.getTime())) return null;

  const anno = data.getFullYear();
  if (anno < 1900 || data.getTime() > Date.now()) return null;
  const due = (n: number) => String(n).padStart(2, '0');
  return `${anno}-${due(data.getMonth() + 1)}-${due(data.getDate())}`;
}

/** Età compiuta oggi, per mostrarla nell'anteprima del file. */
export function etaDaNascita(dataNascita: string | null): number | null {
  if (!dataNascita) return null;
  const [anno, mese, giorno] = dataNascita.split('-').map(Number);
  const oggi = new Date();
  let eta = oggi.getFullYear() - anno;
  const mesi = (oggi.getMonth() + 1) - mese;
  if (mesi < 0 || (mesi === 0 && oggi.getDate() < giorno)) eta--;
  return eta >= 0 && eta <= 120 ? eta : null;
}

/**
 * Anno di percorso dentro la branca: 1, 2, 3… null se la casella è vuota,
 * undefined se c'è scritto qualcosa che non è un numero da 1 a 5.
 */
function leggiAnnoBranca(valore: unknown): number | null | undefined {
  const testo = String(valore ?? '').trim();
  if (!testo) return null;
  const anno = Number(testo.replace(/[^\d]/g, ''));
  return Number.isInteger(anno) && anno >= 1 && anno <= 5 ? anno : undefined;
}

/** La branca scritta nel file: "Branca E/G", "REPARTO MISTO", "Reparto", "E/G"… */
function leggiBranca(valore: unknown): Branca | null {
  const t = normalizza(valore);
  if (!t) return null;
  if (/branco|lupett|coccinell|cerchio|^(branca)?lc$/.test(t)) return 'branco';
  if (/reparto|esplorator|guid|^(branca)?eg$/.test(t)) return 'reparto';
  if (/clan|rover|scolt|noviziato|fuoco|^(branca)?rs$/.test(t)) return 'clan';
  return null;
}

/** Nell'elenco del censimento i capi hanno branca "Adulti" e unità "Comunità capi". */
function eCapo(branca: unknown, unita: unknown): boolean {
  return normalizza(branca) === 'adulti' || normalizza(unita).includes('comunitacapi');
}

/**
 * Il livello di formazione capi (CFT, CFM, CFA, CAPO…). "NULLA" o vuoto vuol dire nessuno:
 * null. undefined se c'è scritto qualcosa di strano.
 */
function leggiFoca(valore: unknown): string | null | undefined {
  const testo = String(valore ?? '').trim().toUpperCase();
  if (!testo || testo === 'NULLA' || testo === 'NESSUNO' || testo === '-') return null;
  return /^[A-Z][A-Z. ]{1,19}$/.test(testo) ? testo : undefined;
}

/** null se vuota, undefined se non sembra un indirizzo email. */
function leggiEmail(valore: unknown): string | null | undefined {
  const testo = String(valore ?? '').trim().toLowerCase();
  if (!testo) return null;
  return testo.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testo) ? testo : undefined;
}

/** Gli export spesso sono in MAIUSCOLO: "ROSSI" diventa "Rossi". Il testo misto resta com'è. */
function sistemaMaiuscole(testo: string): string {
  if (testo !== testo.toUpperCase()) return testo;
  return testo.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, lettera: string) => sep + lettera.toUpperCase());
}

function testoCella(valore: unknown): string {
  return String(valore ?? '').trim().replace(/\s+/g, ' ');
}

@Injectable({
  providedIn: 'root'
})
export class CensitiService {

  constructor(private http: HttpClient) { }

  /**
   * Censiti che l'utente gestisce: il capogruppo li vede tutti (si occupa della comunità capi),
   * il capo solo quelli della sua branca. `branca` è null per i capigruppo e per chi non ne ha una.
   */
  elenco(tipo?: 'capi' | 'ragazzi') {
    const params: Record<string, string> = tipo ? { tipo } : {};
    return this.http.get<{ utenti: UtenteElenco[]; branca: Branca | null; capogruppo: boolean }>(
      `${apiUrl()}/utenti`, { params });
  }

  importa(ruolo: 'ragazzo' | 'capo', righe: RigaImport[]) {
    return this.http.post<EsitoImport>(`${apiUrl()}/utenti/importa`, { ruolo, righe });
  }

  /**
   * Legge il file Excel: cerca in ogni foglio la riga con le intestazioni (servono almeno
   * codice censimento, nome e cognome) e restituisce le righe valide e quelle scartate con il motivo.
   */
  async leggiExcel(file: File, opzioni: OpzioniLettura): Promise<LetturaExcel> {
    const trovato = await this.trovaIntestazioni(file, c => c.has('codice') && c.has('nome') && c.has('cognome'));
    if (!trovato) {
      throw new Error('Non trovo le colonne necessarie. Il file deve avere almeno le intestazioni: codice censimento, nome, cognome (e possibilmente data di nascita).');
    }
    return this.leggiRighe(trovato.foglio, trovato.dati, trovato.primaRiga, trovato.colonne, opzioni);
  }

  /** Cerca in ogni foglio la riga delle intestazioni (sopra possono esserci titoli). */
  private async trovaIntestazioni(file: File, bastano: (colonne: Map<Campo, number>) => boolean) {
    let fogli;
    try {
      fogli = await readXlsxFile(file);
    } catch {
      throw new Error('Impossibile leggere il file: assicurati che sia un Excel .xlsx valido.');
    }
    for (const { sheet, data } of fogli) {
      for (let r = 0; r < Math.min(data.length, RIGHE_RICERCA_INTESTAZIONE); r++) {
        const colonne = new Map<Campo, number>();
        data[r].forEach((cella, c) => {
          const campo = campoDaIntestazione(cella);
          if (campo && !colonne.has(campo)) colonne.set(campo, c);
        });
        if (bastano(colonne)) return { foglio: sheet, dati: data.slice(r + 1), primaRiga: r + 2, colonne };
      }
    }
    return null;
  }

  private leggiRighe(foglio: string, dati: unknown[][], primaRiga: number, colonne: Map<Campo, number>,
                     opzioni: OpzioniLettura): LetturaExcel {
    const cella = (riga: unknown[], campo: Campo) => colonne.has(campo) ? riga[colonne.get(campo)!] : null;
    const righe: RigaImport[] = [];
    const scartate: RigaScartata[] = [];
    const visti = new Set<number>();
    const perCapi = opzioni.chi === 'capi';
    // L'elenco del censimento ha tutto il gruppo, e lì i capi si riconoscono ("Adulti",
    // "Comunità capi"): si tengono solo le righe che riguardano questo caricamento.
    // Un file fatto a mano con la sola colonna Branca (Reparto, Clan…) resta com'era:
    // per i capi è la loro branca, per i ragazzi si saltano solo quelli delle altre branche.
    const delCensimento = dati.some(v => eCapo(cella(v, 'branca'), cella(v, 'unita')));
    let ignorate = 0;

    dati.forEach((valori, i) => {
      const riga = primaRiga + i;
      if (valori.every(v => testoCella(v) === '')) return;

      const capo = eCapo(cella(valori, 'branca'), cella(valori, 'unita'));
      const brancaFile = leggiBranca(cella(valori, 'branca')) ?? leggiBranca(cella(valori, 'unita'));
      if (perCapi && delCensimento && !capo) { ignorate++; return; }
      if (!perCapi && (capo || (opzioni.branca && brancaFile && brancaFile !== opzioni.branca))) { ignorate++; return; }
      // Livello Fo.Ca. ed email si leggono solo per i capi.
      const foca = perCapi && colonne.has('foca') ? leggiFoca(cella(valori, 'foca')) : null;
      const email = perCapi && colonne.has('email') ? leggiEmail(cella(valori, 'email')) : null;

      const codice = leggiCodice(cella(valori, 'codice'));
      const nome = sistemaMaiuscole(testoCella(cella(valori, 'nome')));
      const cognome = sistemaMaiuscole(testoCella(cella(valori, 'cognome')));
      const etaLetta = leggiEta(cella(valori, 'eta'));
      // Se c'è la data di nascita si tiene quella: l'età si ricalcola da sola col passare del tempo.
      const dataNascita = colonne.has('nascita') ? dataDaCella(cella(valori, 'nascita')) : null;
      const eta = etaLetta === null ? etaDaNascita(dataNascita) : etaLetta;
      const annoBranca = colonne.has('anno') ? leggiAnnoBranca(cella(valori, 'anno')) : null;

      let motivo: string | null = null;
      if (codice === undefined) motivo = 'Codice censimento non numerico';
      // Per i capi il codice serve: senza non possono nemmeno entrare nel sito.
      else if (codice === null && perCapi) motivo = 'Codice censimento mancante';
      else if (!nome || !cognome) motivo = 'Nome o cognome mancante';
      else if (eta === undefined) motivo = 'Età non valida';
      else if (annoBranca === undefined) motivo = 'Anno di percorso non valido: scrivi 1, 2, 3…';
      else if (codice !== null && visti.has(codice)) motivo = 'Codice ripetuto nel file';
      else if (foca === undefined) motivo = 'Livello Fo.Ca. non riconosciuto';
      if (motivo) {
        scartate.push({ riga, motivo });
        return;
      }

      if (codice) visti.add(codice);
      righe.push({
        riga, codice_censimento: codice ?? null, nome, cognome,
        eta: eta ?? null, data_nascita: dataNascita, anno_branca: annoBranca ?? null,
        // Nell'elenco del censimento i capi sono "Adulti": la loro branca si mette a mano o con
        // il secondo file, e qui resta vuota (quella che hanno già non si tocca).
        branca: capo || (!perCapi && !brancaFile) ? null : brancaFile,
        livello_foca: foca ?? null,
        // Un'email scritta male non ferma la riga: semplicemente non si salva.
        email: email ?? null,
      });
    });

    return { foglio, righe, scartate, ignorate };
  }
}
