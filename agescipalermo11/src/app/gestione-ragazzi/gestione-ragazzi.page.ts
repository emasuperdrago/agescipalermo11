import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
  IonRouterLinkWithHref, IonContent, ModalController, ToastController
} from '@ionic/angular/standalone';
import {
  addOutline, arrowBackOutline, cashOutline, downloadOutline, idCardOutline, peopleOutline, pencilOutline,
  trashOutline
} from 'ionicons/icons';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { RagazzoEditorComponent } from '../components/ragazzo-editor/ragazzo-editor.component';
import { SchedaRagazzoComponent } from '../components/scheda-ragazzo/scheda-ragazzo.component';
import { AuthService } from '../services/auth';
import { ZonaCapiService, euro } from '../services/zona-capi';
import { nomeBranca, stiliBranca } from '../services/posti';
import { AnnoScout, AttivitaQuota, Branca, QuotaRagazzo, RagazzoElenco } from '../../types/models';

/**
 * Zona capi: la tabella dei ragazzi della propria branca, con le quote delle attività.
 * Vale anche per un capogruppo: le altre branche le seguono i loro capi.
 * Il capogruppo, in più, può spostare un ragazzo in un'altra branca.
 */
@Component({
  selector: 'app-gestione-ragazzi',
  templateUrl: './gestione-ragazzi.page.html',
  styleUrls: ['./gestione-ragazzi.page.scss'],
  standalone: true,
  imports: [
    FormsModule, RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent,
  ],
})
export class GestioneRagazziPage implements OnInit {
  readonly icone = {
    indietro: arrowBackOutline, aggiungi: addOutline, scarica: downloadOutline, quote: cashOutline,
    modifica: pencilOutline, elimina: trashOutline, ragazzi: peopleOutline, scheda: idCardOutline,
  };
  readonly nomeBranca = nomeBranca;
  readonly stiliBranca = stiliBranca;
  readonly euro = euro;

  private auth = inject(AuthService);
  private zona = inject(ZonaCapiService);
  private modalCtrl = inject(ModalController);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);

  anno: AnnoScout | null = null;
  branca: Branca | null = null;
  attivita: AttivitaQuota[] = [];
  ragazzi: RagazzoElenco[] = [];
  caricamento = true;
  errore = '';

  /** Modulo per aggiungere un'attività da pagare. */
  nuovaAttivita = '';
  nuovoImporto: number | null = null;

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
    this.carica();
  }

  get capogruppo(): boolean {
    return this.auth.utente?.ruolo === 'admin';
  }

  carica() {
    this.caricamento = true;
    this.zona.ragazzi().subscribe({
      next: dati => {
        this.anno = dati.anno;
        // La branca la decide il server: è quella di chi guarda.
        this.branca = dati.branca;
        this.attivita = dati.attivita;
        this.ragazzi = dati.ragazzi;
        this.caricamento = false;
        this.errore = '';
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.errore = err.status === 404
          ? 'Il server non gestisce ancora questa parte: va riavviato il backend.'
          : 'Impossibile caricare i ragazzi. Riprova tra poco.';
      },
    });
  }

  // ---------- Quote ----------

  /** Come sta un ragazzo con un'attività (niente segnato = partecipa e deve la quota a testa). */
  quota(ragazzo: RagazzoElenco, attivita: AttivitaQuota): QuotaRagazzo {
    return ragazzo.quote.find(q => q.attivita === attivita.id)
      ?? { attivita: attivita.id, versato: 0, pagato: false, partecipa: true, quota: attivita.importo };
  }

  versato(ragazzo: RagazzoElenco, attivita: AttivitaQuota): number {
    return this.quota(ragazzo, attivita).versato;
  }

  statoQuota(ragazzo: RagazzoElenco, attivita: AttivitaQuota): 'niente' | 'parziale' | 'pagata' | 'fuori' {
    const q = this.quota(ragazzo, attivita);
    if (!q.partecipa) return 'fuori';
    if (q.versato <= 0) return 'niente';
    return q.versato + 0.005 >= q.quota ? 'pagata' : 'parziale';
  }

  /** Cosa si legge nella casella: la cifra versata, "no" per chi non partecipa. */
  testoQuota(ragazzo: RagazzoElenco, attivita: AttivitaQuota): string {
    const q = this.quota(ragazzo, attivita);
    if (!q.partecipa) return 'no';
    return q.versato > 0 ? euro(q.versato) : '—';
  }

  /** Quanto deve in tutto un ragazzo: solo le attività a cui partecipa, ognuna con la sua quota. */
  totaleDovuto(ragazzo: RagazzoElenco): number {
    return this.attivita.reduce((somma, a) => {
      const q = this.quota(ragazzo, a);
      return q.partecipa ? somma + q.quota : somma;
    }, 0);
  }

  totaleVersato(ragazzo: RagazzoElenco): number {
    return ragazzo.quote.reduce((somma, q) => somma + q.versato, 0);
  }

  /** Quanti ragazzi partecipano a un'attività. */
  partecipanti(attivita: AttivitaQuota): number {
    return this.ragazzi.filter(r => this.quota(r, attivita).partecipa).length;
  }

  /** Quanto ci si aspetta di incassare per un'attività, contando solo chi partecipa. */
  atteso(attivita: AttivitaQuota): number {
    return this.ragazzi.reduce((somma, r) => {
      const q = this.quota(r, attivita);
      return q.partecipa ? somma + q.quota : somma;
    }, 0);
  }

  /** Totale raccolto per un'attività: utile per sapere a che punto si è. */
  raccolto(attivita: AttivitaQuota): number {
    return this.ragazzi.reduce((somma, r) => somma + this.versato(r, attivita), 0);
  }

  async cambiaQuota(ragazzo: RagazzoElenco, attivita: AttivitaQuota) {
    const q = this.quota(ragazzo, attivita);
    const alert = await this.alertCtrl.create({
      header: attivita.nome,
      subHeader: `${ragazzo.nome} ${ragazzo.cognome} · quota a testa ${euro(attivita.importo)}`,
      inputs: [
        { name: 'quota', type: 'number', min: 0, label: 'Quota', placeholder: 'Quota per lui/lei', value: q.quota },
        { name: 'versato', type: 'number', min: 0, placeholder: 'Quanto ha versato', value: q.versato || null },
      ],
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        // Chi non partecipa esce dai conti dell'attività: non deve niente.
        { text: 'Non partecipa', handler: () => { this.salvaQuota(ragazzo, attivita, 0, false, q.quota); } },
        {
          text: 'Pagata tutta',
          handler: (dati: { quota: string }) => {
            const quota = this.numero(dati?.quota, attivita.importo);
            this.salvaQuota(ragazzo, attivita, quota, true, quota);
          },
        },
        {
          text: 'Salva',
          handler: (dati: { quota: string; versato: string }) => {
            const quota = this.numero(dati?.quota, attivita.importo);
            const versato = this.numero(dati?.versato, 0);
            if (versato < 0 || quota < 0) return false;
            this.salvaQuota(ragazzo, attivita, versato, true, quota);
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  /** Legge una cifra scritta a mano, accettando anche la virgola. */
  private numero(valore: string | number | undefined, sePerso: number): number {
    const n = Number(String(valore ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : sePerso;
  }

  private salvaQuota(ragazzo: RagazzoElenco, attivita: AttivitaQuota, versato: number, partecipa: boolean, quota: number) {
    this.zona.segnaPagamento(attivita.id, ragazzo.id, { versato, partecipa, quota }).subscribe({
      next: salvata => {
        const esistente = ragazzo.quote.find(x => x.attivita === attivita.id);
        if (esistente) Object.assign(esistente, salvata);
        else ragazzo.quote.push(salvata);
        this.avvisa(!partecipa ? 'Segnato: non partecipa.'
          : versato > 0 ? 'Quota segnata: entra anche in cassa.' : 'Quota azzerata.');
      },
      error: () => this.avvisa('Non sono riuscito a salvare la quota.'),
    });
  }

  aggiungiAttivita() {
    const nome = this.nuovaAttivita.trim();
    const importo = Number(this.nuovoImporto);
    if (!nome || !Number.isFinite(importo) || importo < 0) {
      this.avvisa("Scrivi nome e importo dell'attività.");
      return;
    }
    this.zona.creaAttivita(nome, importo).subscribe({
      next: attivita => {
        this.attivita = [...this.attivita, attivita];
        this.nuovaAttivita = '';
        this.nuovoImporto = null;
      },
      error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? "Non sono riuscito ad aggiungere l'attività."),
    });
  }

  async confermaEliminaAttivita(attivita: AttivitaQuota) {
    const alert = await this.alertCtrl.create({
      header: 'Eliminare l\'attività?',
      message: `"${attivita.nome}" sparisce dalla tabella insieme a tutte le quote segnate e ai movimenti in cassa che ne sono nati.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Elimina', role: 'destructive', handler: () => {
            this.zona.eliminaAttivita(attivita.id).subscribe({
              next: () => { this.attivita = this.attivita.filter(a => a.id !== attivita.id); this.carica(); },
              error: () => this.avvisa("Non sono riuscito a eliminare l'attività."),
            });
          }
        },
      ],
    });
    await alert.present();
  }

  // ---------- Ragazzi ----------

  /** Quanti tesorieri ha il clan (almeno uno, al massimo due). */
  get tesorieri(): number {
    return this.ragazzi.filter(r => r.tesoriere).length;
  }

  async modifica(ragazzo: RagazzoElenco) {
    const modale = await this.modalCtrl.create({
      component: RagazzoEditorComponent,
      componentProps: { ragazzo, puoSpostare: this.capogruppo },
    });
    await modale.present();
    const { role } = await modale.onDidDismiss<RagazzoElenco>();
    if (role === 'salvato') this.carica();
  }

  /** La scheda personale: indirizzo, genitori, note sanitarie e PDF (es. la scheda medica). */
  async apriScheda(ragazzo: RagazzoElenco) {
    const modale = await this.modalCtrl.create({
      component: SchedaRagazzoComponent,
      componentProps: { ragazzo },
    });
    await modale.present();
    const { role } = await modale.onDidDismiss();
    if (role === 'salvato') this.carica();
  }

  /** Un ragazzo entrato adesso, prima del censimento: si aggiunge a mano. */
  async nuovoRagazzo() {
    const modale = await this.modalCtrl.create({
      component: RagazzoEditorComponent,
      componentProps: { brancaIniziale: this.branca, puoSpostare: false },
    });
    await modale.present();
    const { data, role } = await modale.onDidDismiss<RagazzoElenco>();
    if (role !== 'salvato') return;
    this.carica();
    this.avvisa(data?.codice_censimento
      ? `${data.nome} aggiunto al gruppo.`
      : `${data?.nome ?? 'Il ragazzo'} aggiunto: gli manca il codice censimento.`);
  }

  async confermaElimina(ragazzo: RagazzoElenco) {
    const alert = await this.alertCtrl.create({
      header: 'Rimuovere il ragazzo?',
      message: `${ragazzo.nome} ${ragazzo.cognome} viene rimosso dal database insieme alle sue quote. Non si torna indietro.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Rimuovi', role: 'destructive', handler: () => {
            this.zona.eliminaRagazzo(ragazzo.id).subscribe({
              next: () => {
                this.ragazzi = this.ragazzi.filter(r => r.id !== ragazzo.id);
                this.avvisa('Ragazzo rimosso.');
              },
              error: (err: HttpErrorResponse) => this.avvisa(err.error?.error ?? 'Non sono riuscito a rimuoverlo.'),
            });
          }
        },
      ],
    });
    await alert.present();
  }

  scaricaTabella() {
    this.zona.scaricaTabella().subscribe({
      next: file => {
        const indirizzo = URL.createObjectURL(file);
        const collegamento = document.createElement('a');
        collegamento.href = indirizzo;
        collegamento.download = `censiti-${this.branca ?? 'gruppo'}-${(this.anno?.etichetta ?? '').replace('/', '-')}.csv`;
        document.body.appendChild(collegamento);
        collegamento.click();
        collegamento.remove();
        // L'indirizzo temporaneo si butta appena il browser ha preso il file.
        setTimeout(() => URL.revokeObjectURL(indirizzo), 2000);
      },
      error: () => this.avvisa('Non sono riuscito a preparare la tabella.'),
    });
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 1800, position: 'top' });
    await toast.present();
  }
}
