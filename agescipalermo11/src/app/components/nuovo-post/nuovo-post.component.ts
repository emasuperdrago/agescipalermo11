import { Component, Input, OnInit } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, ModalController
} from '@ionic/angular/standalone';
import {
  addOutline, chevronBackOutline, chevronForwardOutline, closeOutline, imageOutline, linkOutline, videocamOutline
} from 'ionicons/icons';
import {
  COLORI_POST, ESTENSIONI_VIDEO_POST, ETICHETTE_POST, MAX_BYTE_VIDEO_POST, MAX_FOTO_POST, MAX_LINK_VIDEO_POST,
  MAX_VIDEO_POST, PostService, sembraLinkVideo
} from '../../services/post';
import { EtichettaPost, Post, VideoPost, VoceFotoPost } from '../../../types/models';

/** Una foto nel modulo: già del post (percorso) o appena scelta (data URL), con la sua anteprima. */
interface FotoNelModulo {
  tieni?: string;
  nuova?: string;
  anteprima: string;
}

export const MAX_DIDASCALIA = 160;

/**
 * Pop-up per creare un post (role "pubblicato") o, se riceve `post`, modificarlo (role "modificato").
 * In entrambi i casi si chiude restituendo il post salvato.
 */
@Component({
  selector: 'app-nuovo-post',
  templateUrl: './nuovo-post.component.html',
  styleUrls: ['./nuovo-post.component.scss'],
  standalone: true,
  imports: [FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon],
})
export class NuovoPostComponent implements OnInit {
  /** Post da modificare; se assente il pop-up crea un post nuovo. */
  @Input() post?: Post;

  readonly colori = COLORI_POST;
  readonly etichette = ETICHETTE_POST;
  readonly maxDidascalia = MAX_DIDASCALIA;
  readonly maxFoto = MAX_FOTO_POST;
  readonly maxLink = MAX_LINK_VIDEO_POST;
  readonly maxVideo = MAX_VIDEO_POST;
  readonly accettatiVideo = ESTENSIONI_VIDEO_POST.map(e => '.' + e).join(',') + ',video/mp4,video/quicktime,video/webm';
  readonly icone = {
    chiudi: closeOutline, foto: imageOutline, aggiungi: addOutline,
    prima: chevronBackOutline, dopo: chevronForwardOutline, link: linkOutline, video: videocamOutline,
  };

  /** I link a YouTube o Instagram. */
  videoLink: string[] = [];
  nuovoLink = '';
  /** I video già caricati sul post, quelli da togliere e quelli nuovi da caricare dopo il salvataggio. */
  videoEsistenti: VideoPost[] = [];
  videoDaTogliere = new Set<number>();
  videoNuovi: File[] = [];
  /** Mentre si caricano i video: "Video 1 di 2…". */
  avanzamento = '';

  /** Le foto del post in ordine: la prima è la copertina, quella che si vede nella home. */
  fotoElenco: FotoNelModulo[] = [];
  didascalia = '';
  colore = '';
  etichetta: EtichettaPost | '' = '';
  testo = '';

  preparandoFoto = false;
  pubblicando = false;
  errore = '';

  constructor(private modalCtrl: ModalController, private posts: PostService) {}

  ngOnInit() {
    if (!this.post) return;
    const percorsi = this.post.foto_urls?.length ? this.post.foto_urls : [this.post.foto_url];
    this.fotoElenco = percorsi.map(p => ({ tieni: p, anteprima: this.posts.urlDaPercorso(p) }));
    this.videoLink = [...(this.post.video_link ?? [])];
    this.videoEsistenti = [...(this.post.video ?? [])];
    this.didascalia = this.post.didascalia;
    this.colore = this.post.colore;
    this.etichetta = this.post.etichetta;
    this.testo = this.post.testo ?? '';
  }

  get modifica(): boolean {
    return !!this.post;
  }

  /** La copertina: è quella che si vede nell'anteprima della home. */
  get anteprimaFoto(): string | null {
    return this.fotoElenco[0]?.anteprima ?? null;
  }

  get valido(): boolean {
    return !!this.anteprimaFoto && !!this.didascalia.trim() && !!this.colore && !!this.etichetta;
  }

  /** Si possono scegliere più foto insieme: si aggiungono in fondo, fino al massimo. */
  async scegliFoto(evento: Event) {
    const input = evento.target as HTMLInputElement;
    const file = Array.from(input.files ?? []);
    input.value = '';
    if (!file.length) return;

    this.errore = '';
    const posto = this.maxFoto - this.fotoElenco.length;
    if (file.length > posto)
      this.errore = `Al massimo ${this.maxFoto} foto: ne ho aggiunte ${Math.max(0, posto)}.`;
    this.preparandoFoto = true;
    try {
      for (const f of file.slice(0, Math.max(0, posto))) {
        const dataUrl = await this.posts.preparaFoto(f);
        this.fotoElenco.push({ nuova: dataUrl, anteprima: dataUrl });
      }
    } catch (e) {
      this.errore = e instanceof Error ? e.message : 'Impossibile leggere una delle foto.';
    } finally {
      this.preparandoFoto = false;
    }
  }

  /** Sposta una foto prima o dopo; portarla al primo posto la fa diventare la copertina. */
  sposta(indice: number, passo: -1 | 1) {
    const dove = indice + passo;
    if (dove < 0 || dove >= this.fotoElenco.length) return;
    [this.fotoElenco[indice], this.fotoElenco[dove]] = [this.fotoElenco[dove], this.fotoElenco[indice]];
  }

  togliFoto(indice: number) {
    this.fotoElenco.splice(indice, 1);
  }

  // ---------- Video ----------

  aggiungiLink() {
    const link = this.nuovoLink.trim();
    if (!link) return;
    if (!sembraLinkVideo(link)) {
      this.errore = 'Il link deve essere di un video di YouTube o di Instagram.';
      return;
    }
    if (this.videoLink.length >= this.maxLink) {
      this.errore = `Al massimo ${this.maxLink} link a video.`;
      return;
    }
    if (!this.videoLink.includes(link)) this.videoLink.push(link);
    this.nuovoLink = '';
    this.errore = '';
  }

  togliLink(indice: number) {
    this.videoLink.splice(indice, 1);
  }

  /** Quanti video ci saranno dopo il salvataggio. */
  get quantiVideo(): number {
    return this.videoEsistenti.filter(v => !this.videoDaTogliere.has(v.id)).length + this.videoNuovi.length;
  }

  scegliVideo(evento: Event) {
    const input = evento.target as HTMLInputElement;
    const scelti = Array.from(input.files ?? []);
    input.value = '';
    const scartati: string[] = [];
    for (const file of scelti) {
      const ext = (file.name.split('.').pop() ?? '').toLowerCase();
      if (!ESTENSIONI_VIDEO_POST.includes(ext)) scartati.push(`"${file.name}": serve un video MP4, MOV o WebM`);
      else if (file.size > MAX_BYTE_VIDEO_POST) scartati.push(`"${file.name}": è più di 50 MB (accorcialo o mettilo su YouTube)`);
      else if (this.quantiVideo >= this.maxVideo) scartati.push(`"${file.name}": al massimo ${this.maxVideo} video`);
      else this.videoNuovi.push(file);
    }
    this.errore = scartati.length ? `Non aggiunti: ${scartati.join('; ')}.` : '';
  }

  togliVideoNuovo(indice: number) {
    this.videoNuovi.splice(indice, 1);
  }

  alternaVideoEsistente(v: VideoPost) {
    if (this.videoDaTogliere.has(v.id)) this.videoDaTogliere.delete(v.id);
    else this.videoDaTogliere.add(v.id);
  }

  megabyte(byte: number): string {
    return `${(byte / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  }

  /** Toglie i video segnati e carica quelli nuovi; torna l'elenco dei problemi. */
  private async sistemaVideo(idPost: number): Promise<string[]> {
    const avvisi: string[] = [];
    for (const id of this.videoDaTogliere) {
      try {
        await firstValueFrom(this.posts.eliminaVideo(idPost, id));
      } catch {
        avvisi.push('un video non è stato tolto');
      }
    }
    const daCaricare = [...this.videoNuovi];
    for (const [i, file] of daCaricare.entries()) {
      this.avanzamento = `Caricamento del video ${i + 1} di ${daCaricare.length}…`;
      try {
        await firstValueFrom(this.posts.caricaVideo(idPost, file));
        this.videoNuovi.splice(this.videoNuovi.indexOf(file), 1);
      } catch (err) {
        avvisi.push((err as HttpErrorResponse).error?.error ?? `"${file.name}" non è stato caricato`);
      }
    }
    this.avanzamento = '';
    return avvisi;
  }

  chiudi() {
    this.modalCtrl.dismiss(null, 'annulla');
  }

  pubblica() {
    if (!this.valido || !this.etichetta) {
      this.errore = 'Compila i campi obbligatori: foto, didascalia, etichetta e colore.';
      return;
    }

    this.pubblicando = true;
    this.errore = '';
    const dati = {
      didascalia: this.didascalia.trim(),
      colore: this.colore,
      etichetta: this.etichetta,
      testo: this.testo.trim() || null,
    };
    // Un link scritto ma non ancora aggiunto con "+" si aggiunge da solo.
    if (this.nuovoLink.trim()) this.aggiungiLink();
    if (this.errore) {
      this.pubblicando = false;
      return;
    }
    const foto_elenco: VoceFotoPost[] = this.fotoElenco.map(f => f.tieni ? { tieni: f.tieni } : { nuova: f.nuova! });
    const video_link = [...this.videoLink];
    const eraNuovo = !this.post;
    const richiesta = this.post
      ? this.posts.aggiorna(this.post.id, { ...dati, foto_elenco, video_link })
      : this.posts.crea({ ...dati, foto_elenco, video_link });
    richiesta.subscribe({
      next: async post => {
        // Il post è salvato: ora i video, uno alla volta. Se uno non va, gli altri vanno avanti.
        const avvisi = await this.sistemaVideo(post.id);
        const aggiornato = await firstValueFrom(this.posts.dettaglio(post.id)).catch(() => post);
        if (avvisi.length) {
          // Il post c'è già: da qui in poi il modulo lo modifica, invece di crearne un altro.
          this.post = aggiornato;
          this.videoEsistenti = [...(aggiornato.video ?? [])];
          this.videoDaTogliere.clear();
          this.pubblicando = false;
          this.avanzamento = '';
          this.errore = `Post salvato, ma: ${avvisi.join('; ')}.`;
          return;
        }
        this.modalCtrl.dismiss(aggiornato, eraNuovo ? 'pubblicato' : 'modificato');
      },
      error: (err: HttpErrorResponse) => {
        this.pubblicando = false;
        this.errore = err.status === 0 ? 'Server non raggiungibile. Riprova tra poco.'
          // 404 senza messaggio: il backend acceso è una versione vecchia, senza i post.
          : err.status === 404 && !err.error?.error ? 'Il server non gestisce ancora i post: va riavviato il backend.'
          : err.error?.error ?? `Salvataggio non riuscito (errore ${err.status}). Riprova.`;
      },
    });
  }
}
