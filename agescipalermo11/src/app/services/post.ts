import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { apiUrl, backendUrl } from './api';
import { preparaImmagine } from './immagini';
import { DatiPost, EtichettaPost, PaginaPost, Post, VideoPost } from '../../types/models';

/** Stessa lista del backend (COLORI_POST in server.js): tutti leggibili con la scritta bianca. */
export const COLORI_POST = [
  { valore: '#E36F3C', nome: 'Arancio' },
  { valore: '#0B87A8', nome: 'Azzurro' },
  { valore: '#3E8E48', nome: 'Verde' },
  { valore: '#7D57C2', nome: 'Viola' },
  { valore: '#C8372D', nome: 'Rosso' },
  { valore: '#B07A00', nome: 'Ocra' },
];

/** Stessa lista del backend (ETICHETTE_POST in server.js). */
export const ETICHETTE_POST: { valore: EtichettaPost; nome: string }[] = [
  { valore: 'branco', nome: 'Branco' },
  { valore: 'reparto', nome: 'Reparto' },
  { valore: 'clan', nome: 'Clan' },
  { valore: 'gruppo', nome: 'Gruppo' },
];

export function nomeEtichetta(etichetta: EtichettaPost): string {
  return ETICHETTE_POST.find(e => e.valore === etichetta)?.nome ?? etichetta;
}

/** Quanti post si caricano alla volta (anche con "Vedi altro"). */
export const POST_PER_PAGINA = 12;

/** Lato più lungo della foto dopo il ridimensionamento nel browser. */
const LATO_MAX_FOTO = 1600;

/** Quante foto può avere un post (come MAX_FOTO_POST nel backend). */
export const MAX_FOTO_POST = 10;

/** Video: come nel backend (MAX_LINK_VIDEO_POST, MAX_VIDEO_POST, MAX_BYTE_VIDEO_POST). */
export const MAX_LINK_VIDEO_POST = 5;
export const MAX_VIDEO_POST = 3;
export const MAX_BYTE_VIDEO_POST = 50 * 1024 * 1024;
export const ESTENSIONI_VIDEO_POST = ['mp4', 'mov', 'm4v', 'webm'];

/** Hashtag per post, come il server. */
export const MAX_HASHTAG_POST = 10;

/** Un hashtag pulito come lo pulisce il server: senza "#", minuscolo, solo lettere, numeri e _. */
export function pulisciHashtag(valore: string): string {
  return valore.trim().replace(/^#+/, '').toLowerCase().replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 40);
}

/** Un link a un video che sappiamo mostrare dentro la pagina. */
export interface VideoIncorporato {
  sito: 'youtube' | 'instagram';
  /** Indirizzo da mettere nell'iframe. */
  incorpora: string;
  /** Il link originale, per aprirlo fuori. */
  link: string;
}

/**
 * Dal link (già ripulito dal server) all'indirizzo da incorporare. YouTube con il dominio
 * "nocookie", che non mette cookie finché non si preme play.
 */
export function videoIncorporato(link: string): VideoIncorporato | null {
  const youtube = link.match(/^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/);
  if (youtube) return { sito: 'youtube', incorpora: `https://www.youtube-nocookie.com/embed/${youtube[1]}`, link };
  const instagram = link.match(/^https:\/\/www\.instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]{5,40})\/$/);
  if (instagram) return { sito: 'instagram', incorpora: `https://www.instagram.com/${instagram[1]}/${instagram[2]}/embed`, link };
  return null;
}

/** Il controllo veloce nel modulo (quello vero lo fa il server). */
export function sembraLinkVideo(testo: string): boolean {
  return /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be|instagram\.com)\//i.test(testo.trim());
}

@Injectable({
  providedIn: 'root'
})
export class PostService {

  constructor(private http: HttpClient) { }

  /** Una pagina di post (in evidenza per primi), saltando i primi `offset` e filtrando per etichetta. */
  /** `quanti` serve per chiederne uno solo, quando si richiude il buco lasciato da un post tolto. */
  elenco(offset = 0, etichetta: EtichettaPost | null = null, quanti = POST_PER_PAGINA, hashtag: string | null = null) {
    const parametri: Record<string, string> = { offset: String(offset), limite: String(quanti) };
    if (etichetta) parametri['etichetta'] = etichetta;
    if (hashtag) parametri['hashtag'] = hashtag;
    return this.http.get<PaginaPost>(`${apiUrl()}/post`, { params: parametri });
  }

  dettaglio(id: number) {
    return this.http.get<{ post: Post }>(`${apiUrl()}/post/${id}`).pipe(map(r => r.post));
  }

  crea(dati: DatiPost) {
    return this.http.post<{ post: Post }>(`${apiUrl()}/post`, dati).pipe(map(r => r.post));
  }

  /** Senza `foto` resta quella attuale. */
  aggiorna(id: number, dati: DatiPost) {
    return this.http.put<{ post: Post }>(`${apiUrl()}/post/${id}`, dati).pipe(map(r => r.post));
  }

  elimina(id: number) {
    return this.http.delete<{ message: string }>(`${apiUrl()}/post/${id}`);
  }

  /** Un video corto, mandato così com'è (dopo aver salvato il post). */
  caricaVideo(idPost: number, file: File) {
    return this.http.post<{ video: VideoPost }>(`${apiUrl()}/post/${idPost}/video`, file, {
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Nome-File': encodeURIComponent(file.name) },
    }).pipe(map(r => r.video));
  }

  eliminaVideo(idPost: number, idVideo: number) {
    return this.http.delete<{ message: string }>(`${apiUrl()}/post/${idPost}/video/${idVideo}`);
  }

  impostaEvidenza(id: number, inEvidenza: boolean) {
    return this.http.patch<{ post: Post }>(`${apiUrl()}/post/${id}/evidenza`, { in_evidenza: inEvidenza })
      .pipe(map(r => r.post));
  }

  /** Tutti i post messi da parte, dal più recente: li raggruppa per anno la pagina. */
  archivio(etichetta?: EtichettaPost | null, hashtag: string | null = null) {
    const params: Record<string, string> = etichetta ? { etichetta } : {};
    if (hashtag) params['hashtag'] = hashtag;
    return this.http.get<{ post: Post[]; massimo: number }>(`${apiUrl()}/post/archivio`, { params });
  }

  /** Gli hashtag usati, dai più usati: quelli della home o, con `archivio`, dell'archivio. */
  hashtag(archivio = false) {
    return this.http.get<{ hashtag: { hashtag: string; quanti: number }[] }>(`${apiUrl()}/post/hashtag`,
      { params: archivio ? { archivio: '1' } : {} }).pipe(map(r => r.hashtag));
  }

  /**
   * I post che aspettano il sì: un ragazzo vede i suoi, un capo clan o un capogruppo
   * tutti quelli da approvare.
   */
  inAttesa() {
    return this.http.get<{ post: Post[]; puoApprovare: boolean }>(`${apiUrl()}/post/in-attesa`);
  }

  /** Il sì (o il no) di un capo clan o di un capogruppo su un post proposto. */
  decidiPubblicazione(id: number, approva: boolean) {
    return this.http.put<{ post?: Post; message?: string }>(`${apiUrl()}/post/${id}/pubblica`, { approva });
  }

  /** Mette un post in archivio o lo riporta nella home (solo capi). */
  archivia(id: number, archiviato: boolean) {
    return this.http.put<{ post: Post }>(`${apiUrl()}/post/${id}/archivio`, { archiviato })
      .pipe(map(r => r.post));
  }

  /** La copertina del post. */
  urlFoto(post: Post): string {
    return `${backendUrl()}${post.foto_url}`;
  }

  /** Tutte le foto del post, dalla copertina in poi (i post vecchi ne hanno una sola). */
  urlFotoTutte(post: Post): string[] {
    const elenco = post.foto_urls?.length ? post.foto_urls : [post.foto_url];
    return elenco.map(p => this.urlDaPercorso(p));
  }

  urlDaPercorso(percorso: string): string {
    return `${backendUrl()}${percorso}`;
  }

  /** Rimpicciolisce la foto nel browser (JPEG, lato max 1600px): il caricamento è più veloce e leggero. */
  preparaFoto(file: File): Promise<string> {
    return preparaImmagine(file, { latoMax: LATO_MAX_FOTO });
  }
}
