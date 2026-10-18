import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import * as L from 'leaflet';
import { apiUrl, backendUrl } from './api';
import { preparaImmagine } from './immagini';
import { dataDaChiave } from './eventi';
import { AllegatoPosto, BrancaPosto, CampoPosto, DatiPosto, Posto } from '../../types/models';

/**
 * Branche dei posti (più "gruppo") con il colore della bandierina.
 * `testo` è il colore che si legge sopra `colore`, `forte` quello leggibile su sfondo bianco
 * e `bordo` il contorno della bandierina: servono perché il lilla del gruppo è molto chiaro.
 */
export const BRANCHE_POSTO: {
  valore: BrancaPosto; nome: string; colore: string; testo: string; forte: string; bordo: string;
}[] = [
  { valore: 'branco', nome: 'Branco', colore: '#B98A00', testo: '#FFFFFF', forte: '#B98A00', bordo: '#FFFFFF' },
  { valore: 'reparto', nome: 'Reparto', colore: '#5A9E2A', testo: '#FFFFFF', forte: '#5A9E2A', bordo: '#FFFFFF' },
  { valore: 'clan', nome: 'Clan', colore: '#D8392F', testo: '#FFFFFF', forte: '#D8392F', bordo: '#FFFFFF' },
  { valore: 'gruppo', nome: 'Gruppo', colore: '#E3C0FF', testo: '#2E1850', forte: '#7D57C2', bordo: '#7D57C2' },
];

/** Colori di una branca da passare al CSS: <div [style]="stiliBranca('gruppo')"> */
export function stiliBranca(branca: BrancaPosto): Record<string, string> {
  const b = BRANCHE_POSTO.find(x => x.valore === branca) ?? BRANCHE_POSTO[3];
  return {
    '--colore-branca': b.colore,
    '--su-branca': b.testo,
    '--forte-branca': b.forte,
    // Velo trasparente del colore del testo, per i riquadri sopra la copertina.
    '--velo-branca': b.testo === '#FFFFFF' ? 'rgba(255, 255, 255, .22)' : 'rgba(46, 24, 80, .12)',
  };
}

export function nomeBranca(branca: BrancaPosto): string {
  return BRANCHE_POSTO.find(b => b.valore === branca)?.nome ?? branca;
}

/** Centro e zoom della mappa quando non ci sono ancora posti: Palermo. */
export const CENTRO_PALERMO: L.LatLngTuple = [38.1157, 13.3615];
export const ZOOM_PALERMO = 11;

/** Stessi limiti del backend. */
export const MAX_BYTE_ALLEGATO = 15 * 1024 * 1024;
export const ESTENSIONI_ACCETTATE = [
  'jpg', 'jpeg', 'png', 'webp', 'pdf', 'gpx', 'kml', 'kmz', 'doc', 'docx', 'odt',
  'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'txt', 'zip', 'heic', 'gif',
];
/** Lato più lungo delle foto dopo il ridimensionamento nel browser. */
const LATO_MAX_FOTO = 2000;

/** Bandierina disegnata in SVG, colorata come la branca. La punta dell'asta è sul punto esatto. */
export function iconaBandierina(branca: BrancaPosto, selezionata = false): L.DivIcon {
  const b = BRANCHE_POSTO.find(x => x.valore === branca);
  const colore = b?.colore ?? '#462678';
  // Contorno scuro per i colori chiari, altrimenti la bandierina sparisce sulla mappa.
  const contorno = b?.bordo ?? '#FFFFFF';
  const scala = selezionata ? 1.25 : 1;
  const larghezza = Math.round(34 * scala);
  const altezza = Math.round(42 * scala);
  return L.divIcon({
    className: `bandierina bandierina--${branca}${selezionata ? ' bandierina--selezionata' : ''}`,
    html: `<svg viewBox="0 0 34 42" width="${larghezza}" height="${altezza}" aria-hidden="true">
      <ellipse cx="7" cy="40" rx="5" ry="2" fill="rgba(15,23,42,.25)"/>
      <rect x="5.5" y="3" width="3" height="37" rx="1.5" fill="#0F172A"/>
      <path d="M8.5 4 H31 L25 12.5 L31 21 H8.5 Z" fill="${colore}" stroke="${contorno}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="7" cy="3.5" r="3" fill="${colore}" stroke="${contorno}" stroke-width="1.5"/>
    </svg>`,
    iconSize: [larghezza, altezza],
    iconAnchor: [Math.round(7 * scala), Math.round(40 * scala)],
    tooltipAnchor: [Math.round(12 * scala), Math.round(-42 * scala)],
  });
}

/** Sfondo della mappa (OpenStreetMap): l'attribuzione è obbligatoria. */
export function aggiungiSfondoMappa(mappa: L.Map): L.TileLayer {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(mappa);
}

/** Link per farsi portare al posto dal navigatore (Google Maps, su telefono apre l'app). */
export function urlIndicazioni(posto: Pick<Posto, 'latitudine' | 'longitudine'>): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${posto.latitudine},${posto.longitudine}`;
}

export function urlBackend(percorso: string): string {
  return `${backendUrl()}${percorso}`;
}

/**
 * Date di un campo in forma leggibile: "5 agosto 2026", "1–8 agosto 2026",
 * "28 luglio – 3 agosto 2026", "28 dicembre 2025 – 3 gennaio 2026".
 */
export function dateCampo(campo: CampoPosto): string {
  const inizio = dataDaChiave(campo.data_inizio);
  const completa = (d: Date) => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  if (!campo.data_fine) return completa(inizio);
  const fine = dataDaChiave(campo.data_fine);
  if (inizio.getFullYear() !== fine.getFullYear()) return `${completa(inizio)} – ${completa(fine)}`;
  if (inizio.getMonth() !== fine.getMonth()) {
    return `${inizio.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })} – ${completa(fine)}`;
  }
  return `${inizio.getDate()}–${completa(fine)}`;
}

/** Es. "2,4 MB". */
export function dimensioneLeggibile(byte: number): string {
  if (byte < 1024) return `${byte} B`;
  if (byte < 1024 * 1024) return `${Math.round(byte / 1024)} KB`;
  return `${(byte / (1024 * 1024)).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`;
}

export function estensione(nome: string): string {
  const punto = nome.lastIndexOf('.');
  return punto > 0 ? nome.slice(punto + 1).toLowerCase() : '';
}

/** Risultato della ricerca di un indirizzo. */
export interface LuogoTrovato {
  nome: string;
  latitudine: number;
  longitudine: number;
}

@Injectable({
  providedIn: 'root'
})
export class PostiService {

  constructor(private http: HttpClient) { }

  elenco() {
    return this.http.get<{ posti: Posto[] }>(`${apiUrl()}/posti`).pipe(map(r => r.posti));
  }

  dettaglio(id: number) {
    return this.http.get<{ posto: Posto }>(`${apiUrl()}/posti/${id}`).pipe(map(r => r.posto));
  }

  crea(dati: DatiPosto) {
    return this.http.post<{ posto: Posto }>(`${apiUrl()}/posti`, dati).pipe(map(r => r.posto));
  }

  aggiorna(id: number, dati: DatiPosto) {
    return this.http.put<{ posto: Posto }>(`${apiUrl()}/posti/${id}`, dati).pipe(map(r => r.posto));
  }

  elimina(id: number) {
    return this.http.delete<{ message: string }>(`${apiUrl()}/posti/${id}`);
  }

  /** Il file viaggia così com'è; il nome originale va nell'intestazione X-Nome-File. */
  caricaAllegato(idPosto: number, file: Blob, nome: string) {
    return this.http.post<{ allegato: AllegatoPosto }>(`${apiUrl()}/posti/${idPosto}/allegati`, file, {
      headers: { 'Content-Type': 'application/octet-stream', 'X-Nome-File': encodeURIComponent(nome) },
    }).pipe(map(r => r.allegato));
  }

  eliminaAllegato(idPosto: number, idAllegato: number) {
    return this.http.delete<{ message: string }>(`${apiUrl()}/posti/${idPosto}/allegati/${idAllegato}`);
  }

  /**
   * Le foto JPG/PNG/WebP vengono rimpicciolite prima di caricarle; gli altri file restano come sono.
   * Se la foto non si riesce a leggere, si carica l'originale.
   */
  async preparaAllegato(file: File): Promise<{ dati: Blob; nome: string }> {
    const ext = estensione(file.name);
    // Le foto dell'iPhone (HEIC) si provano a trasformare in JPEG: così finiscono nella galleria
    // invece che tra i file da scaricare. Safari ci riesce; dove il browser non sa leggerle
    // restano un file, come prima.
    const heic = ext === 'heic' || ext === 'heif';
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext) && !heic) return { dati: file, nome: file.name };
    try {
      const dataUrl = await preparaImmagine(heic ? new File([file], file.name, { type: 'image/heic' }) : file,
        { latoMax: LATO_MAX_FOTO });
      const dati = await (await fetch(dataUrl)).blob();
      // Solo se il ridimensionamento fa davvero risparmiare (una HEIC va trasformata comunque).
      if (!heic && dati.size >= file.size) return { dati: file, nome: file.name };
      return { dati, nome: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
    } catch {
      return { dati: file, nome: file.name };
    }
  }

  /**
   * Cerca un indirizzo con Nominatim (OpenStreetMap). Si usa fetch e non HttpClient,
   * così il token del sito non viene mandato a un servizio esterno.
   */
  async cercaIndirizzo(testo: string): Promise<LuogoTrovato[]> {
    const parametri = new URLSearchParams({
      q: testo, format: 'jsonv2', limit: '5', countrycodes: 'it', 'accept-language': 'it',
    });
    const risposta = await fetch(`https://nominatim.openstreetmap.org/search?${parametri}`);
    if (!risposta.ok) throw new Error('Ricerca non disponibile');
    const risultati: { display_name: string; lat: string; lon: string }[] = await risposta.json();
    return risultati.map(r => ({ nome: r.display_name, latitudine: Number(r.lat), longitudine: Number(r.lon) }));
  }

  /** Indirizzo di un punto della mappa (o null se non si trova). */
  async indirizzoDi(latitudine: number, longitudine: number): Promise<string | null> {
    const parametri = new URLSearchParams({
      lat: String(latitudine), lon: String(longitudine), format: 'jsonv2', zoom: '18', 'accept-language': 'it',
    });
    try {
      const risposta = await fetch(`https://nominatim.openstreetmap.org/reverse?${parametri}`);
      if (!risposta.ok) return null;
      const r: { display_name?: string; address?: Record<string, string> } = await risposta.json();
      const a = r.address;
      if (!a) return r.display_name ?? null;
      // Forma breve: "Via Roma 10, Palermo".
      const via = [a['road'] ?? a['pedestrian'] ?? a['path'], a['house_number']].filter(Boolean).join(' ');
      const citta = a['city'] ?? a['town'] ?? a['village'] ?? a['municipality'];
      const breve = [via, citta].filter(Boolean).join(', ');
      return breve || r.display_name || null;
    } catch {
      return null;
    }
  }
}
