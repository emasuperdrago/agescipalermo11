import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AlertController, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
  IonRouterLinkWithHref, IonContent, ToastController
} from '@ionic/angular/standalone';
import {
  archiveOutline, arrowBackOutline, bookOutline, homeOutline, arrowUndoOutline, calendarNumberOutline, callOutline,
  cashOutline, checkmarkCircleOutline, chevronForwardOutline, closeCircleOutline,
  cloudUploadOutline, downloadOutline, idCardOutline, imageOutline, mailOutline, mapOutline,
  musicalNotesOutline, newspaperOutline, notificationsOutline, peopleCircleOutline, peopleOutline,
  personAddOutline, refreshOutline, schoolOutline, shieldCheckmarkOutline, trashOutline,
  walletOutline
} from 'ionicons/icons';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { AuthService } from '../services/auth';
import { IscrizioniService, dataPerEsteso, etaDa, nomeAnnoScolastico } from '../services/iscrizioni';
import { ZonaCapiService } from '../services/zona-capi';
import { nomeBranca, stiliBranca } from '../services/posti';
import {
  AnnoScout, Branca, CompleannoOggi, NotificaContenuto, RichiestaIscrizione, StatoRichiesta
} from '../../types/models';

/**
 * Zona riservata a capi e admin (voce "Capi" della barra in basso).
 * Nelle notifiche arrivano le richieste di iscrizione della branca del capo:
 * quelle del branco ai capi branco, del reparto ai capi reparto, del clan ai capi clan.
 */
@Component({
  selector: 'app-area-capi',
  templateUrl: './area-capi.page.html',
  styleUrls: ['./area-capi.page.scss'],
  standalone: true,
  imports: [
    RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref,
    IonContent, BarraInferioreComponent,
  ],
})
export class AreaCapiPage implements OnInit {
  readonly icone = {
    indietro: arrowBackOutline, notifiche: notificationsOutline, iscrizione: personAddOutline,
    telefono: callOutline, email: mailOutline, scuola: schoolOutline, genitori: peopleCircleOutline,
    catechismo: bookOutline, casa: homeOutline,
    archivia: archiveOutline,
    ripristina: arrowUndoOutline, elimina: trashOutline, aggiorna: refreshOutline,
    censiti: idCardOutline, carica: cloudUploadOutline, apri: chevronForwardOutline,
    accetta: checkmarkCircleOutline, rifiuta: closeCircleOutline, excel: downloadOutline,
    ragazzi: peopleOutline, cassa: walletOutline, quote: cashOutline, anno: calendarNumberOutline,
    comunita: shieldCheckmarkOutline, posto: mapOutline, canto: musicalNotesOutline, post: newspaperOutline,
    foto: imageOutline,
  };
  readonly nomeBranca = nomeBranca;
  readonly stiliBranca = stiliBranca;
  readonly nomeAnnoScolastico = nomeAnnoScolastico;
  readonly dataPerEsteso = dataPerEsteso;
  readonly etaDa = etaDa;

  private auth = inject(AuthService);
  private iscrizioni = inject(IscrizioniService);
  private zona = inject(ZonaCapiService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);

  /** Ogni cambio all'elenco aggiorna anche il numero sulla voce "Capi" della barra. */
  private _richieste: RichiestaIscrizione[] = [];
  get richieste(): RichiestaIscrizione[] { return this._richieste; }
  set richieste(elenco: RichiestaIscrizione[]) {
    this._richieste = elenco;
    this.iscrizioni.nuove.set(elenco.filter(r => r.stato === 'nuova').length);
  }
  /** La branca del capo: se manca, non gli arriva nessuna richiesta. */
  branca: Branca | null = null;
  caricamento = true;
  errore = '';
  mostraArchiviate = false;

  /** Anno scout in corso: lo apre il capogruppo. */
  anno: AnnoScout | null = null;
  /** Avvisi su posti, canti e post toccati dai ragazzi della propria branca. */
  contenuti: NotificaContenuto[] = [];
  /** I ragazzi della propria branca che compiono gli anni oggi: domani spariscono da soli. */
  compleanni: CompleannoOggi[] = [];
  apertura = false;

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
    this.caricaAnno();
    this.caricaContenuti();
    this.caricaCompleanni();
  }

  private caricaCompleanni() {
    this.zona.compleanniOggi().subscribe({
      next: elenco => this.compleanni = elenco,
      // Se non arrivano non è grave: la striscia semplicemente non compare.
      error: () => this.compleanni = [],
    });
  }

  /** Il bilancio di branca che questo capo apre da qui (il clan ha la sua cassa nella sezione Clan). */
  get miaCassa(): 'branco' | 'reparto' | null {
    return this.branca === 'branco' || this.branca === 'reparto' ? this.branca : null;
  }

  private caricaAnno() {
    this.zona.annoScout().subscribe({
      next: dati => this.anno = dati.anno,
      error: () => this.anno = null,
    });
  }

  private caricaContenuti() {
    this.zona.notificheContenuti().subscribe({
      next: dati => this.contenuti = dati.notifiche,
      error: () => this.contenuti = [],
    });
  }

  segnaContenutoLetto(notifica: NotificaContenuto) {
    this.zona.segnaNotificaLetta(notifica.id).subscribe({
      next: () => this.contenuti = this.contenuti.filter(n => n.id !== notifica.id),
      error: () => this.avvisa("Non sono riuscito a rimuovere l'avviso."),
    });
  }

  iconaContenuto(tipo: NotificaContenuto['tipo']): string {
    return tipo === 'posto' ? this.icone.posto : tipo === 'canto' ? this.icone.canto : this.icone.post;
  }

  /** Apertura dell'anno scout: tocca tutti i ragazzi, quindi si chiede conferma. */
  async confermaApriAnno() {
    const alert = await this.alertCtrl.create({
      header: "Aprire l'anno scout?",
      message: 'Tutti i ragazzi avanzano di un anno, chi ha finito la branca passa a quella dopo, '
        + 'le quote ripartono da zero e in cassa resta solo il riporto. Non si torna indietro.',
      inputs: [{ name: 'etichetta', type: 'text', placeholder: 'Anno (es. 2027/2028)' }],
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: "Apri l'anno", handler: (dati: { etichetta: string }) => {
            this.apriAnno(String(dati?.etichetta ?? '').trim());
          }
        },
      ],
    });
    await alert.present();
  }

  private apriAnno(etichetta: string) {
    this.apertura = true;
    this.zona.apriAnno(etichetta || undefined).subscribe({
      next: async esito => {
        this.apertura = false;
        this.anno = esito.anno;
        const righe = [
          `${esito.avanzati} ${esito.avanzati === 1 ? 'ragazzo è avanzato' : 'ragazzi sono avanzati'} di un anno.`,
          esito.cambi.length
            ? `Cambi di branca (${esito.cambi.length}):\n${esito.cambi.map(c => `· ${c.nome}: ${c.da} → ${c.a}`).join('\n')}`
            : 'Nessun cambio di branca.',
          esito.finitoClan.length
            ? `Hanno finito il clan, restano finché non li rimuovi:\n${esito.finitoClan.map(n => `· ${n}`).join('\n')}`
            : '',
          esito.senzaAnno.length
            ? `Senza anno di percorso, non toccati (${esito.senzaAnno.length}):\n${esito.senzaAnno.map(n => `· ${n}`).join('\n')}`
            : '',
        ].filter(Boolean);
        const riepilogo = await this.alertCtrl.create({
          header: `Anno ${esito.anno?.etichetta ?? ''} aperto`,
          message: righe.join('\n\n'),
          buttons: ['Va bene'],
        });
        await riepilogo.present();
      },
      error: (err: HttpErrorResponse) => {
        this.apertura = false;
        this.avvisa(err.error?.error ?? "Non sono riuscito ad aprire l'anno.");
      },
    });
  }

  /** I capigruppo (admin) si occupano della comunità capi. */
  get capogruppo(): boolean {
    return this.auth.utente?.ruolo === 'admin';
  }

  get nuove(): number {
    return this.richieste.filter(r => r.stato === 'nuova').length;
  }

  carica() {
    this.caricamento = true;
    this.iscrizioni.elenco(this.mostraArchiviate).subscribe({
      next: risposta => {
        this.branca = risposta.branca;
        this.richieste = risposta.richieste;
        this.caricamento = false;
        this.errore = '';
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.errore = err.status === 404
          ? 'Il server non gestisce ancora le iscrizioni: va riavviato il backend.'
          : 'Impossibile caricare le notifiche. Riprova tra poco.';
      },
    });
  }

  alternaArchiviate() {
    this.mostraArchiviate = !this.mostraArchiviate;
    this.carica();
  }

  /** Quante richieste accettate ci sono: sono quelle che finiscono nel file Excel. */
  get accettate(): number {
    return this.richieste.filter(r => r.esito === 'accettata').length;
  }

  /** Accetta o rifiuta una richiesta; ripremendo lo stesso pulsante torna in sospeso. */
  decidi(richiesta: RichiestaIscrizione, esito: 'accettata' | 'rifiutata') {
    const nuovo = richiesta.esito === esito ? null : esito;
    this.iscrizioni.decidi(richiesta.id, nuovo).subscribe({
      next: aggiornata => {
        // Una richiesta decisa viene archiviata: resta in elenco solo se si guardano le archiviate.
        this.richieste = aggiornata.stato === 'archiviata' && !this.mostraArchiviate
          ? this.richieste.filter(r => r.id !== richiesta.id)
          : this.richieste.map(r => r.id === richiesta.id ? aggiornata : r);
        this.avvisa(nuovo === 'accettata' ? 'Accettata e archiviata: resta nel file delle accettate.'
          : nuovo === 'rifiutata' ? 'Rifiutata e archiviata.' : 'Decisione annullata.');
      },
      error: () => this.avvisa('Non sono riuscito a salvare la decisione.'),
    });
  }

  /** Scarica le accettate come file Excel, pronto da ricaricare nei codici censimento. */
  scaricaAccettate() {
    this.iscrizioni.scaricaAccettate().subscribe({
      next: file => {
        const indirizzo = URL.createObjectURL(file);
        const collegamento = document.createElement('a');
        collegamento.href = indirizzo;
        collegamento.download = `richieste-accettate-${this.branca ?? 'gruppo'}.xlsx`;
        document.body.appendChild(collegamento);
        collegamento.click();
        collegamento.remove();
        setTimeout(() => URL.revokeObjectURL(indirizzo), 2000);
      },
      error: () => this.avvisa('Non sono riuscito a preparare il file.'),
    });
  }

  /** Il capo se ne prende carico (o la rimette tra quelle da guardare). */
  cambiaStato(richiesta: RichiestaIscrizione, stato: StatoRichiesta) {
    this.iscrizioni.cambiaStato(richiesta.id, stato).subscribe({
      next: aggiornata => {
        if (stato === 'archiviata' && !this.mostraArchiviate) {
          this.richieste = this.richieste.filter(r => r.id !== richiesta.id);
        } else {
          this.richieste = this.richieste.map(r => r.id === richiesta.id ? aggiornata : r);
        }
        this.avvisa(stato === 'archiviata' ? 'Richiesta archiviata.'
          : stato === 'letta' ? 'Presa in carico: gli altri capi vedono il tuo nome.'
            : 'Richiesta rimessa tra quelle da guardare.');
      },
      error: () => this.avvisa('Non sono riuscito a cambiare la richiesta. Riprova.'),
    });
  }

  async confermaElimina(richiesta: RichiestaIscrizione) {
    const alert = await this.alertCtrl.create({
      header: 'Eliminare la richiesta?',
      message: `La richiesta di ${richiesta.nome} ${richiesta.cognome} verrà cancellata per sempre.`,
      buttons: [
        { text: 'Annulla', role: 'cancel' },
        {
          text: 'Elimina', role: 'destructive', handler: () => {
            this.iscrizioni.elimina(richiesta.id).subscribe({
              next: () => {
                this.richieste = this.richieste.filter(r => r.id !== richiesta.id);
                this.avvisa('Richiesta eliminata.');
              },
              error: () => this.avvisa('Non sono riuscito a eliminare la richiesta.'),
            });
          }
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
