import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { apiUrl } from './api';
import { ETICHETTE_POST } from './post';
import { DatiEvento, EtichettaEvento, Evento } from '../../types/models';

/** Stessa lista del backend (ETICHETTE_EVENTO in server.js). "Capi" lo vedono solo capi e admin. */
export const ETICHETTE_EVENTO: { valore: EtichettaEvento; nome: string }[] = [
  ...ETICHETTE_POST,
  { valore: 'capi', nome: 'Capi' },
];

export function nomeEtichettaEvento(etichetta: EtichettaEvento): string {
  return ETICHETTE_EVENTO.find(e => e.valore === etichetta)?.nome ?? etichetta;
}

/** Le branche che si possono scegliere insieme: tutte e tre diventano "gruppo". */
export const BRANCHE_EVENTO: EtichettaEvento[] = ['branco', 'reparto', 'clan'];

/** Stessi colori del calendario (calendario.page.scss). */
export const COLORI_ETICHETTA_EVENTO: Record<EtichettaEvento, string> = {
  branco: '#5A9E2A', reparto: '#B98A00', clan: '#D8392F', gruppo: '#E3C0FF', capi: '#7D57C2',
};

/** Stessa regola del backend: branche in ordine, tutte e tre = gruppo; "gruppo" e "capi" da sole. */
export function normalizzaEtichette(scelte: Iterable<EtichettaEvento>): EtichettaEvento[] {
  const insieme = new Set(scelte);
  if (insieme.has('capi')) return ['capi'];
  if (insieme.has('gruppo') || BRANCHE_EVENTO.every(b => insieme.has(b))) return ['gruppo'];
  return BRANCHE_EVENTO.filter(b => insieme.has(b));
}

/** Es. "Branco / Clan". */
export function nomiEtichette(etichette: EtichettaEvento[]): string {
  return etichette.map(nomeEtichettaEvento).join(' / ');
}

/** Colore di un evento: pieno se ha un'etichetta, a strisce (una per etichetta) se ne ha di più. */
export function sfondoEtichette(etichette: EtichettaEvento[], direzione = 'to bottom'): string {
  const colori = etichette.map(e => COLORI_ETICHETTA_EVENTO[e]);
  if (colori.length <= 1) return `linear-gradient(${colori[0] ?? '#7D57C2'}, ${colori[0] ?? '#7D57C2'})`;
  const passo = 100 / colori.length;
  const fasce = colori.map((c, i) => `${c} ${i * passo}% ${(i + 1) * passo}%`);
  return `linear-gradient(${direzione}, ${fasce.join(', ')})`;
}

// ---------- Aggiungi al calendario del telefono o del computer ----------

/** Orario di fine di comodo quando l'evento ha solo l'ora di inizio: un'ora dopo. */
function unOraDopo(ora: string): string {
  const [h, m] = ora.split(':').map(Number);
  return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Inizio e fine dell'evento come le vogliono i calendari: giorni interi o data e ora. */
function inizioFine(e: Evento): { tuttoIlGiorno: boolean; inizio: string; fine: string } {
  const giornoFine = e.data_fine ?? e.data_inizio;
  if (!e.ora_inizio) {
    // Giorni interi: la fine è il giorno dopo l'ultimo (i calendari la considerano esclusa).
    return {
      tuttoIlGiorno: true,
      inizio: e.data_inizio.replace(/-/g, ''),
      fine: aggiungiGiorni(giornoFine, 1).replace(/-/g, ''),
    };
  }
  const oraFine = e.ora_fine ?? unOraDopo(e.ora_inizio);
  const conOra = (giorno: string, ora: string) => `${giorno.replace(/-/g, '')}T${ora.replace(':', '')}00`;
  return {
    tuttoIlGiorno: false,
    inizio: conOra(e.data_inizio, e.ora_inizio),
    // Se l'ora di fine è prima di quella di inizio (evento di più giorni) la fine è l'ultimo giorno.
    fine: conOra(giornoFine, oraFine),
  };
}

function descrizioneEvento(e: Evento): string {
  const parti = [e.descrizione ?? '', `Palermo 11 · ${nomiEtichette(e.etichette)}`];
  return parti.filter(Boolean).join('\n\n');
}

/** Link a Google Calendar con l'evento già compilato. */
export function urlGoogleCalendar(e: Evento): string {
  const { inizio, fine } = inizioFine(e);
  const parametri = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.titolo,
    dates: `${inizio}/${fine}`,
    details: descrizioneEvento(e),
    ctz: 'Europe/Rome',
  });
  if (e.luogo) parametri.set('location', e.luogo);
  return `https://calendar.google.com/calendar/render?${parametri}`;
}

/** Testo del file .ics (Calendario di Apple, Outlook e gli altri). */
export function contenutoIcs(e: Evento): string {
  const { tuttoIlGiorno, inizio, fine } = inizioFine(e);
  // Le virgole, i punti e virgola e gli a capo vanno protetti.
  const testo = (v: string) => v.replace(/\\/g, '\\\\').replace(/[;,]/g, c => '\\' + c).replace(/\n/g, '\\n');
  const adesso = new Date();
  const due = (n: number) => String(n).padStart(2, '0');
  const timbro = `${adesso.getUTCFullYear()}${due(adesso.getUTCMonth() + 1)}${due(adesso.getUTCDate())}` +
    `T${due(adesso.getUTCHours())}${due(adesso.getUTCMinutes())}${due(adesso.getUTCSeconds())}Z`;
  const righe = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Palermo 11//Calendario//IT',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:evento-${e.id}@palermo11`,
    `DTSTAMP:${timbro}`,
    tuttoIlGiorno ? `DTSTART;VALUE=DATE:${inizio}` : `DTSTART:${inizio}`,
    tuttoIlGiorno ? `DTEND;VALUE=DATE:${fine}` : `DTEND:${fine}`,
    `SUMMARY:${testo(e.titolo)}`,
    `DESCRIPTION:${testo(descrizioneEvento(e))}`,
    ...(e.luogo ? [`LOCATION:${testo(e.luogo)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  // Le righe lunghe vanno spezzate con uno spazio all'inizio della riga seguente.
  const spezza = (r: string): string => r.length <= 74 ? r : r.slice(0, 74) + '\r\n ' + spezza(r.slice(74));
  return righe.map(spezza).join('\r\n') + '\r\n';
}

/** Su iPhone, iPad e Mac si usa il file .ics, che apre l'app Calendario. */
export function usaFileCalendario(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Macintosh/.test(ua);
}

/**
 * Aggiunge l'evento al calendario del dispositivo: file .ics su Apple (lo apre l'app Calendario),
 * Google Calendar sugli altri.
 */
export function aggiungiAlCalendario(e: Evento): void {
  if (!usaFileCalendario()) {
    window.open(urlGoogleCalendar(e), '_blank', 'noopener');
    return;
  }
  const file = new Blob([contenutoIcs(e)], { type: 'text/calendar;charset=utf-8' });
  const indirizzo = URL.createObjectURL(file);
  const collegamento = document.createElement('a');
  collegamento.href = indirizzo;
  collegamento.download = `${e.titolo.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'evento'}.ics`;
  document.body.appendChild(collegamento);
  collegamento.click();
  collegamento.remove();
  setTimeout(() => URL.revokeObjectURL(indirizzo), 10000);
}

// ---------- Date "AAAA-MM-GG" nel fuso locale (niente toISOString, che sposterebbe il giorno) ----------

export function chiaveData(data: Date): string {
  const m = String(data.getMonth() + 1).padStart(2, '0');
  const g = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${m}-${g}`;
}

export function dataDaChiave(chiave: string): Date {
  const [a, m, g] = chiave.split('-').map(Number);
  return new Date(a, m - 1, g);
}

export function aggiungiGiorni(chiave: string, giorni: number): string {
  const d = dataDaChiave(chiave);
  d.setDate(d.getDate() + giorni);
  return chiaveData(d);
}

@Injectable({
  providedIn: 'root'
})
export class EventiService {

  constructor(private http: HttpClient) { }

  /** Eventi che toccano l'intervallo [da, a], compresi quelli di più giorni. */
  elenco(da: string, a: string) {
    return this.http.get<{ eventi: Evento[] }>(`${apiUrl()}/eventi`, { params: { da, a } }).pipe(map(r => r.eventi));
  }

  crea(dati: DatiEvento) {
    return this.http.post<{ evento: Evento }>(`${apiUrl()}/eventi`, dati).pipe(map(r => r.evento));
  }

  aggiorna(id: number, dati: DatiEvento) {
    return this.http.put<{ evento: Evento }>(`${apiUrl()}/eventi/${id}`, dati).pipe(map(r => r.evento));
  }

  elimina(id: number) {
    return this.http.delete<{ message: string }>(`${apiUrl()}/eventi/${id}`);
  }

  impostaEvidenza(id: number, inEvidenza: boolean) {
    return this.http.patch<{ evento: Evento }>(`${apiUrl()}/eventi/${id}/evidenza`, { in_evidenza: inEvidenza })
      .pipe(map(r => r.evento));
  }
}
