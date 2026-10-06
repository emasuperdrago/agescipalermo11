import { AfterViewInit, Component, ElementRef, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, ModalController
} from '@ionic/angular/standalone';
import {
  addOutline, arrowUndoOutline, closeOutline, cloudUploadOutline, documentOutline, locateOutline,
  searchOutline, trashOutline
} from 'ionicons/icons';
import * as L from 'leaflet';
import {
  BRANCHE_POSTO, CENTRO_PALERMO, ESTENSIONI_ACCETTATE, LuogoTrovato, MAX_BYTE_ALLEGATO, PostiService, ZOOM_PALERMO,
  aggiungiSfondoMappa, dimensioneLeggibile, estensione, iconaBandierina, stiliBranca, urlBackend
} from '../../services/posti';
import { GpsService } from '../../services/gps';
import { AllegatoPosto, BrancaPosto, ContattoPosto, DatiPosto, Posto } from '../../../types/models';

/** Stesso limite del backend. */
const MAX_ALLEGATI = 30;
/** Le foto grandi vengono rimpicciolite prima del caricamento, quindi possono partire più pesanti. */
const MAX_BYTE_FOTO_ORIGINALE = 40 * 1024 * 1024;

interface NuovoAllegato {
  file: File;
  /** Anteprima per le foto (URL temporaneo del browser). */
  anteprima: string | null;
}

/** Esito del salvataggio: il posto aggiornato e gli eventuali file non caricati. */
export interface EsitoPostoEditor {
  posto: Posto;
  avvisi: string[];
}

/**
 * Pop-up per aggiungere un posto alla mappa o, se riceve `posto`, modificarlo.
 * Si chiude con role "salvato" e un EsitoPostoEditor.
 */
@Component({
  selector: 'app-posto-editor',
  templateUrl: './posto-editor.component.html',
  styleUrls: ['./posto-editor.component.scss'],
  standalone: true,
  imports: [FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon],
})
export class PostoEditorComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() posto?: Posto;
  /** Dove aprire la mappa per un posto nuovo (di solito la zona che si stava guardando). */
  @Input() centroIniziale?: { latitudine: number; longitudine: number; zoom: number };

  @ViewChild('mappa') private contenitoreMappa?: ElementRef<HTMLDivElement>;

  readonly branche = BRANCHE_POSTO;
  readonly accettati = ESTENSIONI_ACCETTATE.map(e => '.' + e).join(',');
  readonly dimensioneLeggibile = dimensioneLeggibile;
  readonly stiliBranca = stiliBranca;
  readonly icone = {
    chiudi: closeOutline, cerca: searchOutline, posizione: locateOutline, aggiungi: addOutline,
    elimina: trashOutline, file: documentOutline, carica: cloudUploadOutline, ripristina: arrowUndoOutline,
  };

  nome = '';
  branca: BrancaPosto | '' = '';
  latitudine: number | null = null;
  longitudine: number | null = null;
  indirizzo = '';
  descrizione = '';
  contatti: ContattoPosto[] = [];
  /**
   * Campi fatti nel posto: una riga per campo (le righe vuote non si salvano).
   * `chiave` resta fissa per la riga, così i campi del modulo non si scambiano quando se ne aggiunge uno in cima.
   */
  campi: { chiave: number; data_inizio: string; data_fine: string }[] = [];
  private prossimaChiave = 0;

  /** Allegati già salvati; quelli in `daRimuovere` spariranno al salvataggio. */
  allegatiEsistenti: AllegatoPosto[] = [];
  daRimuovere = new Set<number>();
  nuoviAllegati: NuovoAllegato[] = [];

  ricerca = '';
  risultatiRicerca: LuogoTrovato[] = [];
  cercando = false;
  messaggioPosizione = '';

  salvando = false;
  avanzamento = '';
  errore = '';

  private mappa?: L.Map;
  private segnaposto?: L.Marker;
  private osservatore?: ResizeObserver;
  /** Ultimo indirizzo messo in automatico: se l'utente non l'ha cambiato, si può aggiornare. */
  private indirizzoAutomatico = '';

  constructor(
    private modalCtrl: ModalController,
    private postiService: PostiService,
    private gps: GpsService,
  ) {}

  ngOnInit() {
    const p = this.posto;
    if (!p) {
      this.contatti = [{ nome: '', telefono: '', email: '' }];
      this.campi = [this.rigaCampo()];
      return;
    }
    this.nome = p.nome;
    this.branca = p.branca;
    this.latitudine = p.latitudine;
    this.longitudine = p.longitudine;
    this.indirizzo = p.indirizzo ?? '';
    this.descrizione = p.descrizione ?? '';
    this.campi = p.campi.map(c => this.rigaCampo(c.data_inizio, c.data_fine ?? ''));
    if (!this.campi.length && !p.sede) this.campi = [this.rigaCampo()];
    this.contatti = p.contatti.length ? p.contatti.map(c => ({ ...c })) : [{ nome: '', telefono: '', email: '' }];
    this.allegatiEsistenti = [...p.allegati];
  }

  ngAfterViewInit() {
    const el = this.contenitoreMappa?.nativeElement;
    if (!el) return;
    const haPosizione = this.latitudine !== null && this.longitudine !== null;
    const centro: L.LatLngTuple = haPosizione
      ? [this.latitudine!, this.longitudine!]
      : this.centroIniziale ? [this.centroIniziale.latitudine, this.centroIniziale.longitudine] : CENTRO_PALERMO;
    const zoom = haPosizione ? 15 : this.centroIniziale?.zoom ?? ZOOM_PALERMO;

    this.mappa = L.map(el, { center: centro, zoom, zoomControl: true });
    aggiungiSfondoMappa(this.mappa);
    this.mappa.on('click', (e: L.LeafletMouseEvent) => this.impostaPosizione(e.latlng.lat, e.latlng.lng, true));
    if (haPosizione) this.mostraSegnaposto();
    // Il pop-up si apre con un'animazione: la mappa va rimisurata quando cambia dimensione.
    this.osservatore = new ResizeObserver(() => this.mappa?.invalidateSize());
    this.osservatore.observe(el);
  }

  ngOnDestroy() {
    this.osservatore?.disconnect();
    this.mappa?.remove();
    this.nuoviAllegati.forEach(a => a.anteprima && URL.revokeObjectURL(a.anteprima));
  }

  get modifica(): boolean {
    return !!this.posto;
  }

  /** La sede del gruppo ha sempre la bandierina viola: se ne cambiano solo posizione e dati. */
  get eSede(): boolean {
    return !!this.posto?.sede;
  }

  get coordinate(): string {
    return this.latitudine === null || this.longitudine === null
      ? '' : `${this.latitudine.toFixed(5)}, ${this.longitudine.toFixed(5)}`;
  }

  // ---------- Posizione ----------

  private impostaPosizione(lat: number, lng: number, cercaIndirizzo: boolean) {
    this.latitudine = lat;
    this.longitudine = lng;
    this.messaggioPosizione = '';
    this.mostraSegnaposto();
    if (cercaIndirizzo) this.aggiornaIndirizzo(lat, lng);
  }

  private mostraSegnaposto() {
    if (!this.mappa || this.latitudine === null || this.longitudine === null) return;
    const punto: L.LatLngTuple = [this.latitudine, this.longitudine];
    const icona = iconaBandierina(this.branca || 'reparto', true);
    if (!this.segnaposto) {
      this.segnaposto = L.marker(punto, { icon: icona, draggable: true, keyboard: false }).addTo(this.mappa);
      this.segnaposto.on('dragend', () => {
        const { lat, lng } = this.segnaposto!.getLatLng();
        this.impostaPosizione(lat, lng, true);
      });
    } else {
      this.segnaposto.setLatLng(punto).setIcon(icona);
    }
  }

  /** Cambiando branca cambia il colore della bandierina. */
  cambiaBranca() {
    this.mostraSegnaposto();
  }

  private async aggiornaIndirizzo(lat: number, lng: number) {
    // Un indirizzo scritto a mano non si tocca.
    if (this.indirizzo.trim() && this.indirizzo !== this.indirizzoAutomatico) return;
    const trovato = await this.postiService.indirizzoDi(lat, lng);
    // Nel frattempo la bandierina potrebbe essere stata spostata di nuovo.
    if (!trovato || lat !== this.latitudine || lng !== this.longitudine) return;
    if (this.indirizzo.trim() && this.indirizzo !== this.indirizzoAutomatico) return;
    this.indirizzo = trovato;
    this.indirizzoAutomatico = trovato;
  }

  async cerca() {
    const testo = this.ricerca.trim();
    if (testo.length < 3) {
      this.messaggioPosizione = 'Scrivi almeno 3 lettere per cercare.';
      return;
    }
    this.cercando = true;
    this.messaggioPosizione = '';
    try {
      this.risultatiRicerca = await this.postiService.cercaIndirizzo(testo);
      if (!this.risultatiRicerca.length) this.messaggioPosizione = 'Nessun luogo trovato: prova a scriverlo diversamente o tocca la mappa.';
    } catch {
      this.messaggioPosizione = 'Ricerca non disponibile in questo momento: tocca la mappa per segnare il posto.';
    } finally {
      this.cercando = false;
    }
  }

  scegliRisultato(luogo: LuogoTrovato) {
    this.risultatiRicerca = [];
    this.ricerca = '';
    // Scegliere un risultato è una scelta esplicita: l'indirizzo si aggiorna sempre.
    this.indirizzo = luogo.nome;
    this.indirizzoAutomatico = luogo.nome;
    this.impostaPosizione(luogo.latitudine, luogo.longitudine, false);
    this.mappa?.setView([luogo.latitudine, luogo.longitudine], 16);
  }

  async usaMiaPosizione() {
    this.messaggioPosizione = 'Cerco la tua posizione…';
    try {
      const p = await this.gps.getPosizione();
      this.impostaPosizione(p.latitudine, p.longitudine, true);
      this.mappa?.setView([p.latitudine, p.longitudine], 17);
    } catch {
      this.messaggioPosizione = 'Posizione non disponibile: controlla i permessi del browser o tocca la mappa.';
    }
  }

  // ---------- Contatti ----------

  private rigaCampo(data_inizio = '', data_fine = '') {
    return { chiave: this.prossimaChiave++, data_inizio, data_fine };
  }

  aggiungiCampo() {
    // Il nuovo campo va in cima: di solito è il più recente.
    this.campi.unshift(this.rigaCampo());
  }

  rimuoviCampo(indice: number) {
    this.campi.splice(indice, 1);
  }

  aggiungiContatto() {
    this.contatti.push({ nome: '', telefono: '', email: '' });
  }

  rimuoviContatto(indice: number) {
    this.contatti.splice(indice, 1);
  }

  // ---------- Foto e file ----------

  get numeroAllegati(): number {
    return this.allegatiEsistenti.length - this.daRimuovere.size + this.nuoviAllegati.length;
  }

  alternaRimozione(allegato: AllegatoPosto) {
    if (this.daRimuovere.has(allegato.id)) this.daRimuovere.delete(allegato.id);
    else this.daRimuovere.add(allegato.id);
  }

  urlFoto(allegato: AllegatoPosto): string {
    return urlBackend(allegato.url);
  }

  scegliFile(evento: Event) {
    const input = evento.target as HTMLInputElement;
    const scelti = Array.from(input.files ?? []);
    input.value = '';
    const scartati: string[] = [];
    for (const file of scelti) {
      const ext = estensione(file.name);
      const eFoto = ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
      // Una HEIC dell'iPhone si trasforma in JPEG al caricamento: vale il limite delle foto.
      const eHeic = ext === 'heic';
      if (!ESTENSIONI_ACCETTATE.includes(ext)) {
        scartati.push(`"${file.name}": tipo di file non accettato`);
      } else if (file.size > (eFoto || eHeic ? MAX_BYTE_FOTO_ORIGINALE : MAX_BYTE_ALLEGATO)) {
        scartati.push(`"${file.name}": troppo grande (massimo ${eFoto || eHeic ? 40 : 15} MB)`);
      } else if (this.numeroAllegati >= MAX_ALLEGATI) {
        scartati.push(`"${file.name}": massimo ${MAX_ALLEGATI} tra foto e file`);
      } else {
        this.nuoviAllegati.push({ file, anteprima: eFoto ? URL.createObjectURL(file) : null });
      }
    }
    this.errore = scartati.length ? `Non aggiunti: ${scartati.join('; ')}.` : '';
  }

  rimuoviNuovo(indice: number) {
    const [tolto] = this.nuoviAllegati.splice(indice, 1);
    if (tolto?.anteprima) URL.revokeObjectURL(tolto.anteprima);
  }

  // ---------- Salvataggio ----------

  private valida(): string | null {
    if (!this.nome.trim()) return 'Scrivi il nome del posto.';
    if (!this.branca) return 'Scegli la branca: dà il colore alla bandierina.';
    if (this.latitudine === null || this.longitudine === null) return 'Segna sulla mappa dove si trova il posto.';
    for (const c of this.campi) {
      if (c.data_fine && !c.data_inizio) return 'Per ogni campo indica il giorno di inizio.';
      if (c.data_inizio && c.data_fine && c.data_fine < c.data_inizio)
        return 'La fine di un campo non può essere prima dell\'inizio.';
    }
    for (const c of this.contatti) {
      if (c.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) return `L'email "${c.email}" non è valida.`;
      if (c.telefono.trim() && !/^\+?[\d\s./-]{3,}$/.test(c.telefono.trim())) return `Il numero "${c.telefono}" non sembra un telefono.`;
    }
    return null;
  }

  chiudi() {
    this.modalCtrl.dismiss(null, 'annulla');
  }

  async salva() {
    const errore = this.valida();
    if (errore || !this.branca || this.latitudine === null || this.longitudine === null) {
      this.errore = errore ?? 'Controlla i dati inseriti.';
      return;
    }

    const dati: DatiPosto = {
      nome: this.nome.trim(),
      branca: this.branca,
      latitudine: this.latitudine,
      longitudine: this.longitudine,
      indirizzo: this.indirizzo.trim() || null,
      descrizione: this.descrizione.trim() || null,
      campi: this.campi
        .filter(c => c.data_inizio)
        .map(c => ({ data_inizio: c.data_inizio, data_fine: c.data_fine || null })),
      contatti: this.contatti
        .map(c => ({ nome: c.nome.trim(), telefono: c.telefono.trim(), email: c.email.trim() }))
        .filter(c => c.nome || c.telefono || c.email),
    };

    this.salvando = true;
    this.errore = '';
    this.avanzamento = 'Salvataggio del posto…';
    let posto: Posto;
    try {
      posto = this.posto
        ? await firstValueFrom(this.postiService.aggiorna(this.posto.id, dati))
        : await firstValueFrom(this.postiService.crea(dati));
    } catch (err) {
      this.salvando = false;
      this.avanzamento = '';
      this.errore = this.messaggioErrore(err as HttpErrorResponse);
      return;
    }

    // Il posto è salvato: da qui in poi un file che non va non blocca gli altri.
    const avvisi: string[] = [];
    for (const id of this.daRimuovere) {
      try {
        await firstValueFrom(this.postiService.eliminaAllegato(posto.id, id));
      } catch {
        const nome = this.allegatiEsistenti.find(a => a.id === id)?.nome ?? 'un file';
        avvisi.push(`"${nome}" non è stato rimosso`);
      }
    }
    for (const [i, nuovo] of this.nuoviAllegati.entries()) {
      this.avanzamento = `Caricamento ${i + 1} di ${this.nuoviAllegati.length}: ${nuovo.file.name}`;
      try {
        const { dati: contenuto, nome } = await this.postiService.preparaAllegato(nuovo.file);
        await firstValueFrom(this.postiService.caricaAllegato(posto.id, contenuto, nome));
      } catch (err) {
        avvisi.push((err as HttpErrorResponse).error?.error ?? `"${nuovo.file.name}" non è stato caricato`);
      }
    }

    // Si rilegge il posto per avere l'elenco aggiornato di foto e file.
    if (this.daRimuovere.size || this.nuoviAllegati.length) {
      try {
        posto = await firstValueFrom(this.postiService.dettaglio(posto.id));
      } catch { /* resta il posto senza gli ultimi allegati: la pagina lo ricaricherà */ }
    }
    const esito: EsitoPostoEditor = { posto, avvisi };
    this.modalCtrl.dismiss(esito, 'salvato');
  }

  private messaggioErrore(err: HttpErrorResponse): string {
    if (err.status === 0) return 'Server non raggiungibile. Riprova tra poco.';
    if (err.status === 404 && !err.error?.error) return 'Il server non gestisce ancora la mappa: va riavviato il backend.';
    return err.error?.error ?? `Salvataggio non riuscito (errore ${err.status}). Riprova.`;
  }
}
