import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref,
  IonContent, ModalController, ToastController
} from '@ionic/angular/standalone';
import {
  addOutline, arrowBackOutline, calendarNumberOutline, chevronBackOutline, chevronForwardOutline, flag, flagOutline,
  funnelOutline, locationOutline, pencilOutline, timeOutline, todayOutline, trashOutline
} from 'ionicons/icons';
import { AuthService } from '../services/auth';
import {
  ETICHETTE_EVENTO, EventiService, aggiungiAlCalendario, aggiungiGiorni, chiaveData, dataDaChiave,
  nomeEtichettaEvento, nomiEtichette, sfondoEtichette, usaFileCalendario
} from '../services/eventi';
import { EventoEditorComponent } from '../components/evento-editor/evento-editor.component';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { EtichettaEvento, Evento } from '../../types/models';

const NOMI_MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
/** Mesi disponibili prima e dopo quello corrente. */
const MESI_PRIMA = 12;
const MESI_DOPO = 24;
/** Si disegnano per intero solo i mesi a questa distanza da quello visibile: gli altri sono segnaposti vuoti. */
const MESI_DISEGNATI_ATTORNO = 2;

/** Dove si ricordano i filtri scelti (solo su questo browser). */
const CHIAVE_FILTRI = 'filtriCalendario';

/** Un solo formattatore per tutte le date (crearne uno per ogni giorno è lento). */
const FORMATO_GIORNO = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

interface Giorno {
  chiave: string;
  numero: number;
  /** false per i giorni del mese prima/dopo che completano la griglia. */
  delMese: boolean;
  /** Es. "giovedì 17 settembre", calcolato una volta sola. */
  testo: string;
}

interface Mese {
  chiave: string;
  anno: number;
  mese: number;
  titolo: string;
}

interface InfoGiorno {
  etichette: EtichettaEvento[];
  inEvidenza: boolean;
  numero: number;
}

/** Sempre 42 giorni (6 settimane), così tutti i mesi hanno la stessa altezza. */
function costruisciGiorni(anno: number, mese: number): Giorno[] {
  const primo = new Date(anno, mese, 1);
  // Settimana da lunedì: getDay() 0 = domenica.
  const scarto = (primo.getDay() + 6) % 7;
  const inizio = new Date(anno, mese, 1 - scarto);
  const giorni: Giorno[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(inizio.getFullYear(), inizio.getMonth(), inizio.getDate() + i);
    giorni.push({ chiave: chiaveData(d), numero: d.getDate(), delMese: d.getMonth() === mese, testo: FORMATO_GIORNO.format(d) });
  }
  return giorni;
}

@Component({
  selector: 'app-calendario',
  templateUrl: './calendario.page.html',
  styleUrls: ['./calendario.page.scss'],
  standalone: true,
  imports: [
    RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref,
    IonContent, BarraInferioreComponent,
  ],
})
export class CalendarioPage implements OnInit {
  @ViewChild('scorrimento') private scorrimento?: ElementRef<HTMLDivElement>;

  readonly icone = {
    indietro: arrowBackOutline, precedente: chevronBackOutline, successivo: chevronForwardOutline,
    oggi: todayOutline, aggiungi: addOutline, orario: timeOutline, luogo: locationOutline,
    evidenza: flag, evidenzaVuota: flagOutline, modifica: pencilOutline, elimina: trashOutline,
    filtro: funnelOutline, esporta: calendarNumberOutline,
  };

  /** Su Apple si scarica il file dell'evento, altrove si apre Google Calendar. */
  readonly testoEsporta = usaFileCalendario() ? 'Aggiungi al calendario' : 'Aggiungi a Google Calendar';
  readonly giorniSettimana = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  readonly nomeEtichetta = nomeEtichettaEvento;
  readonly nomiEtichette = nomiEtichette;
  readonly sfondoEtichette = sfondoEtichette;

  readonly oggi = chiaveData(new Date());
  readonly mesi: Mese[];
  /** Mese mostrato nello scorrimento. */
  indiceMese = MESI_PRIMA;
  giornoSelezionato = this.oggi;

  eventi: Evento[] = [];
  /** Giorni dei mesi già costruiti (si costruiscono solo quando servono). */
  private giorniCalcolati = new Map<string, Giorno[]>();
  /** Per ogni giorno: gli eventi (in evidenza per primi, poi per orario). */
  private eventiPerGiorno = new Map<string, Evento[]>();
  /** Per ogni giorno: pallini da mostrare nella griglia e bandierina. */
  infoGiorni = new Map<string, InfoGiorno>();
  caricamento = true;
  errore = '';

  // ---------- Filtri ----------
  /** Etichette da mostrare: all'inizio tutte. */
  filtroEtichette = new Set<EtichettaEvento>(ETICHETTE_EVENTO.map(e => e.valore));
  soloEvidenza = false;
  /** Quanti eventi del mese visibile passano i filtri. */
  private eventiDelMese = new Map<string, number>();

  constructor(
    private auth: AuthService,
    private eventiService: EventiService,
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
  ) {
    const adesso = new Date();
    this.mesi = [];
    for (let i = -MESI_PRIMA; i <= MESI_DOPO; i++) {
      const d = new Date(adesso.getFullYear(), adesso.getMonth() + i, 1);
      const anno = d.getFullYear();
      const mese = d.getMonth();
      this.mesi.push({
        chiave: `${anno}-${String(mese + 1).padStart(2, '0')}`,
        anno, mese,
        titolo: `${NOMI_MESI[mese]} ${anno}`,
      });
    }
  }

  // Ionic a volte crea la pagina due volte e l'ingresso arriva a una copia sola: la pagina si
  // prepara già alla creazione, e all'ingresso solo se non l'ha appena fatto.
  private appenaCreata = false;

  ngOnInit() {
    this.appenaCreata = true;
    this.entra();
  }

  ionViewWillEnter() {
    if (this.appenaCreata) {
      this.appenaCreata = false;
      return;
    }
    this.entra();
  }

  private entra() {
    this.leggiFiltri();
    this.caricaEventi();
    // La griglia è già disegnata: si posiziona sul mese giusto senza animazione.
    setTimeout(() => this.vaiAlMese(this.indiceMese, false));
  }

  giorniDi(mese: Mese): Giorno[] {
    let giorni = this.giorniCalcolati.get(mese.chiave);
    if (!giorni) {
      giorni = costruisciGiorni(mese.anno, mese.mese);
      this.giorniCalcolati.set(mese.chiave, giorni);
    }
    return giorni;
  }

  /** Solo i mesi vicini a quello visibile vengono disegnati: la pagina resta leggera. */
  vicino(indice: number): boolean {
    return Math.abs(indice - this.indiceMese) <= MESI_DISEGNATI_ATTORNO;
  }

  get meseVisibile(): Mese {
    return this.mesi[this.indiceMese];
  }

  /** Capi e admin aggiungono e modificano eventi; gli altri li consultano. */
  get puoModificare(): boolean {
    const ruolo = this.auth.utente?.ruolo;
    return ruolo === 'capo' || ruolo === 'admin';
  }

  /** Le etichette tra cui filtrare: "Capi" solo per chi può vederne gli eventi. */
  get etichette() {
    return ETICHETTE_EVENTO.filter(e => e.valore !== 'capi' || this.puoModificare);
  }

  /** Nessun filtro attivo: si vede tutto. */
  get tuttiVisibili(): boolean {
    return !this.soloEvidenza && this.etichette.every(e => this.filtroEtichette.has(e.valore));
  }

  get numeroEventiMese(): number {
    return this.eventiDelMese.get(this.meseVisibile.chiave) ?? 0;
  }

  /** Il giorno ha eventi, ma i filtri li nascondono tutti. */
  get giornoNascostoDaiFiltri(): boolean {
    return !this.eventiSelezionati.length && !this.tuttiVisibili
      && this.eventi.some(e => e.data_inizio <= this.giornoSelezionato && (e.data_fine ?? e.data_inizio) >= this.giornoSelezionato);
  }

  get eventiSelezionati(): Evento[] {
    return this.eventiPerGiorno.get(this.giornoSelezionato) ?? [];
  }

  /** Prossimi eventi con la bandierina (da oggi in poi). */
  get prossimiInEvidenza(): Evento[] {
    return this.eventi
      .filter(e => e.in_evidenza && this.passaFiltri(e) && (e.data_fine ?? e.data_inizio) >= this.oggi)
      .slice(0, 6);
  }

  /** Es. "mercoledì 17 settembre". */
  get titoloGiorno(): string {
    const testo = FORMATO_GIORNO.format(dataDaChiave(this.giornoSelezionato));
    return this.giornoSelezionato === this.oggi ? `Oggi, ${testo}` : testo.charAt(0).toUpperCase() + testo.slice(1);
  }

  // ---------- Caricamento ----------

  caricaEventi() {
    const da = this.giorniDi(this.mesi[0])[0].chiave;
    const ultimo = this.giorniDi(this.mesi[this.mesi.length - 1]);
    const a = ultimo[ultimo.length - 1].chiave;
    this.caricamento = true;
    this.errore = '';
    this.eventiService.elenco(da, a).subscribe({
      next: eventi => {
        this.eventi = eventi;
        this.caricamento = false;
        this.ricalcola();
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.errore = err.status === 404
          ? 'Il server non gestisce ancora il calendario: va riavviato il backend.'
          : 'Impossibile caricare gli eventi. Riprova tra poco.';
      },
    });
  }

  private ricalcola() {
    const ordinati = [...this.eventi].sort((a, b) =>
      a.data_inizio.localeCompare(b.data_inizio) || (a.ora_inizio ?? '').localeCompare(b.ora_inizio ?? '') || a.id - b.id);
    this.eventi = ordinati;

    const perGiorno = new Map<string, Evento[]>();
    const perMese = new Map<string, number>();
    for (const e of ordinati.filter(e => this.passaFiltri(e))) {
      // Un evento di più mesi conta una volta in ognuno.
      const primoMese = e.data_inizio.slice(0, 7);
      const ultimoMese = (e.data_fine ?? e.data_inizio).slice(0, 7);
      for (const m of this.mesi) {
        if (m.chiave >= primoMese && m.chiave <= ultimoMese) perMese.set(m.chiave, (perMese.get(m.chiave) ?? 0) + 1);
      }
      // Un evento di più giorni compare in ognuno dei suoi giorni.
      for (let g = e.data_inizio; g <= (e.data_fine ?? e.data_inizio); g = aggiungiGiorni(g, 1)) {
        const lista = perGiorno.get(g) ?? [];
        lista.push(e);
        perGiorno.set(g, lista);
      }
    }
    const info = new Map<string, InfoGiorno>();
    for (const [giorno, lista] of perGiorno) {
      lista.sort((a, b) => Number(b.in_evidenza) - Number(a.in_evidenza));
      info.set(giorno, {
        // Pallini nell'ordine delle etichette (branco, reparto, clan, gruppo, capi).
        etichette: ETICHETTE_EVENTO.map(x => x.valore).filter(v => lista.some(e => e.etichette.includes(v))).slice(0, 4),
        inEvidenza: lista.some(e => e.in_evidenza),
        numero: lista.length,
      });
    }
    this.eventiPerGiorno = perGiorno;
    this.infoGiorni = info;
    this.eventiDelMese = perMese;
  }

  // ---------- Filtri ----------

  private passaFiltri(e: Evento): boolean {
    // Un evento di più branche si vede se almeno una delle sue etichette è tra quelle scelte.
    return e.etichette.some(x => this.filtroEtichette.has(x)) && (!this.soloEvidenza || e.in_evidenza);
  }

  /** Con tutte le etichette attive, un tocco mostra solo quella; poi ogni tocco la aggiunge o la toglie. */
  alternaEtichetta(etichetta: EtichettaEvento) {
    const visibili = this.etichette.map(e => e.valore);
    const tutte = visibili.every(v => this.filtroEtichette.has(v));
    if (tutte) {
      this.filtroEtichette = new Set([etichetta]);
    } else {
      const nuovo = new Set(this.filtroEtichette);
      if (nuovo.has(etichetta)) nuovo.delete(etichetta);
      else nuovo.add(etichetta);
      // Togliendo l'ultima non resterebbe niente: si torna a vedere tutto.
      this.filtroEtichette = visibili.some(v => nuovo.has(v)) ? nuovo : new Set(ETICHETTE_EVENTO.map(e => e.valore));
    }
    this.filtriCambiati();
  }

  alternaSoloEvidenza() {
    this.soloEvidenza = !this.soloEvidenza;
    this.filtriCambiati();
  }

  mostraTutti() {
    this.filtroEtichette = new Set(ETICHETTE_EVENTO.map(e => e.valore));
    this.soloEvidenza = false;
    this.filtriCambiati();
  }

  /** La scelta è attiva, ma non quando si vede tutto (così i pulsanti non sembrano tutti accesi). */
  etichettaAttiva(etichetta: EtichettaEvento): boolean {
    return this.filtroEtichette.has(etichetta) && !this.etichette.every(e => this.filtroEtichette.has(e.valore));
  }

  private filtriCambiati() {
    this.ricalcola();
    try {
      localStorage.setItem(CHIAVE_FILTRI, JSON.stringify({
        etichette: [...this.filtroEtichette], soloEvidenza: this.soloEvidenza,
      }));
    } catch { /* senza memoria del browser i filtri valgono solo per questa visita */ }
  }

  private leggiFiltri() {
    try {
      const salvati = JSON.parse(localStorage.getItem(CHIAVE_FILTRI) ?? 'null');
      if (!salvati) return;
      const valide = ETICHETTE_EVENTO.map(e => e.valore);
      const etichette = (salvati.etichette as EtichettaEvento[]).filter(e => valide.includes(e));
      // Serve almeno un'etichetta che questo utente può vedere (es. non solo "Capi" per un ragazzo).
      if (this.etichette.some(e => etichette.includes(e.valore))) this.filtroEtichette = new Set(etichette);
      this.soloEvidenza = salvati.soloEvidenza === true;
    } catch { /* filtri salvati illeggibili: si parte da tutti */ }
  }

  // ---------- Scorrimento tra i mesi ----------

  alloScorrimento() {
    const el = this.scorrimento?.nativeElement;
    if (!el || !el.clientWidth) return;
    const indice = Math.round(el.scrollLeft / el.clientWidth);
    if (indice !== this.indiceMese) this.indiceMese = indice;
  }

  vaiAlMese(indice: number, animato = true) {
    const el = this.scorrimento?.nativeElement;
    this.indiceMese = Math.max(0, Math.min(this.mesi.length - 1, indice));
    el?.scrollTo({ left: this.indiceMese * el.clientWidth, behavior: animato ? 'smooth' : 'auto' });
  }

  // Cambiando la larghezza della finestra il mese visibile resta lo stesso.
  @HostListener('window:resize')
  alRidimensionamento() {
    this.vaiAlMese(this.indiceMese, false);
  }

  tornaAOggi() {
    this.giornoSelezionato = this.oggi;
    this.vaiAlMese(MESI_PRIMA);
  }

  seleziona(giorno: Giorno, indiceMese: number) {
    this.giornoSelezionato = giorno.chiave;
    // Un giorno del mese prima/dopo porta a quel mese.
    if (!giorno.delMese) this.vaiAlMese(indiceMese + (giorno.numero > 15 ? -1 : 1));
  }

  vaiAlGiorno(chiave: string) {
    this.giornoSelezionato = chiave;
    const indice = this.mesi.findIndex(m => m.chiave === chiave.slice(0, 7));
    if (indice >= 0) this.vaiAlMese(indice);
  }

  descriviGiorno(giorno: Giorno): string {
    const testo = giorno.testo;
    const info = this.infoGiorni.get(giorno.chiave);
    if (!info) return testo;
    return `${testo}, ${info.numero} ${info.numero === 1 ? 'evento' : 'eventi'}${info.inEvidenza ? ', in evidenza' : ''}`;
  }

  // ---------- Testi degli eventi ----------

  orario(e: Evento): string {
    const breve = (c: string) => dataDaChiave(c).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
    const ore = e.ora_inizio ? (e.ora_fine ? `${e.ora_inizio}–${e.ora_fine}` : `ore ${e.ora_inizio}`) : '';
    if (e.data_fine) return `${breve(e.data_inizio)} → ${breve(e.data_fine)}${ore ? ` · ${ore}` : ''}`;
    return ore || 'Tutto il giorno';
  }

  dataBreve(e: Evento): { giorno: string; mese: string } {
    const d = dataDaChiave(e.data_inizio);
    return { giorno: String(d.getDate()), mese: d.toLocaleDateString('it-IT', { month: 'short' }).replace('.', '') };
  }

  /** Mette l'evento nel calendario del telefono o del computer. */
  esportaEvento(evento: Evento) {
    aggiungiAlCalendario(evento);
  }

  // ---------- Modifiche (capi e admin) ----------

  async apriEditor(evento?: Evento) {
    const modale = await this.modalCtrl.create({
      component: EventoEditorComponent,
      componentProps: { evento, dataIniziale: this.giornoSelezionato },
    });
    await modale.present();
    const { data, role } = await modale.onDidDismiss<Evento>();
    if (role !== 'salvato' || !data) return;
    this.eventi = [...this.eventi.filter(e => e.id !== data.id), data];
    this.ricalcola();
    this.vaiAlGiorno(data.data_inizio);
    this.avvisa(evento ? 'Evento aggiornato.' : 'Evento aggiunto al calendario.');
  }

  alternaEvidenza(evento: Evento) {
    const inEvidenza = !evento.in_evidenza;
    this.eventiService.impostaEvidenza(evento.id, inEvidenza).subscribe({
      next: aggiornato => {
        this.eventi = this.eventi.map(e => (e.id === aggiornato.id ? aggiornato : e));
        this.ricalcola();
        this.avvisa(inEvidenza ? 'Evento messo in evidenza.' : 'Evento tolto dall’evidenza.');
      },
      error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Operazione non riuscita. Riprova.'),
    });
  }

  async confermaElimina(evento: Evento) {
    const alert = await this.alertCtrl.create({
      header: 'Eliminare l’evento?',
      message: `"${evento.titolo}" verrà tolto dal calendario. Non si può annullare.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Elimina', role: 'destructive',
          handler: () => {
            this.eventiService.elimina(evento.id).subscribe({
              next: () => {
                this.eventi = this.eventi.filter(e => e.id !== evento.id);
                this.ricalcola();
                this.avvisa('Evento eliminato.');
              },
              error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Eliminazione non riuscita. Riprova.'),
            });
          },
        },
      ],
    });
    await alert.present();
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 1800, position: 'top' });
    await toast.present();
  }
}
