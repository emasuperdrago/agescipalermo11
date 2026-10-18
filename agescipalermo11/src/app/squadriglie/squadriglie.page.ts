import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink, IonRouterLinkWithHref, IonContent,
  ToastController
} from '@ionic/angular/standalone';
import {
  addOutline, arrowBackOutline, bookOutline, checkmarkOutline, megaphoneOutline, pencilOutline, ribbonOutline,
  trashOutline
} from 'ionicons/icons';
import { BarraInferioreComponent } from '../components/barra-inferiore/barra-inferiore.component';
import { SquadriglieService } from '../services/squadriglie';
import { Grido, PaginaSquadriglia } from '../../types/models';

/**
 * La pagina di una squadriglia: la sua storia, i gridi e i guidoncini conquistati.
 * La vedono tutti; storia e gridi li scrivono i capi reparto con "Modifica".
 */
@Component({
  selector: 'app-squadriglie',
  templateUrl: './squadriglie.page.html',
  styleUrls: ['./squadriglie.page.scss'],
  standalone: true,
  imports: [
    FormsModule, RouterLink, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonRouterLink,
    IonRouterLinkWithHref, IonContent, BarraInferioreComponent,
  ],
})
export class SquadrigliePage implements OnInit {
  readonly icone = {
    indietro: arrowBackOutline, storia: bookOutline, gridi: megaphoneOutline, guidoncini: ribbonOutline,
    modifica: pencilOutline, fatto: checkmarkOutline, aggiungi: addOutline, togli: trashOutline,
  };

  pagina: PaginaSquadriglia | null = null;
  caricamento = true;
  errore = '';

  /** La modifica: una copia di storia e gridi, che diventa vera solo con "Salva". */
  inModifica = false;
  storia = '';
  gridi: Grido[] = [];
  salvando = false;
  erroreModifica = '';

  private id: number;
  private servizio = inject(SquadriglieService);
  private toastCtrl = inject(ToastController);

  constructor(route: ActivatedRoute) {
    this.id = Number(route.snapshot.paramMap.get('id'));
  }

  ngOnInit() {
    this.carica();
  }

  carica() {
    if (!Number.isInteger(this.id) || this.id <= 0) {
      this.caricamento = false;
      this.errore = 'Squadriglia non trovata.';
      return;
    }
    this.servizio.pagina(this.id).subscribe({
      next: pagina => {
        this.pagina = pagina;
        this.caricamento = false;
        this.errore = '';
      },
      error: (err: HttpErrorResponse) => {
        this.caricamento = false;
        this.errore = err.status === 404
          ? (err.error?.error ? 'Questa squadriglia non esiste.' : 'Il server non conosce ancora questa pagina: va riavviato il backend.')
          : 'Non riesco a caricare la squadriglia. Riprova tra poco.';
      },
    });
  }

  get urlFoto(): string | null {
    return this.pagina ? this.servizio.urlFoto(this.pagina.squadriglia) : null;
  }

  get iniziale(): string {
    return (this.pagina?.squadriglia.nome ?? '?').charAt(0).toUpperCase();
  }

  /** "Chiusa nel 2019", per le squadriglie dell'archivio. */
  get chiusa(): string {
    const data = this.pagina?.squadriglia.data_chiusura;
    return this.pagina && !this.pagina.squadriglia.attiva
      ? (data ? `Chiusa nel ${data.slice(0, 4)}` : 'Squadriglia chiusa') : '';
  }

  apriModifica() {
    if (!this.pagina) return;
    this.storia = this.pagina.squadriglia.storia;
    this.gridi = this.pagina.squadriglia.gridi.map(g => ({ ...g }));
    if (!this.gridi.length) this.gridi.push({ titolo: '', testo: '' });
    this.erroreModifica = '';
    this.inModifica = true;
  }

  annulla() {
    this.inModifica = false;
  }

  aggiungiGrido() {
    this.gridi.push({ titolo: '', testo: '' });
  }

  togliGrido(indice: number) {
    this.gridi.splice(indice, 1);
  }

  salva() {
    if (!this.pagina) return;
    this.salvando = true;
    this.erroreModifica = '';
    const gridi = this.gridi.filter(g => g.testo.trim());
    this.servizio.salvaRacconto(this.pagina.squadriglia.id, this.storia, gridi).subscribe({
      next: salvato => {
        this.salvando = false;
        if (this.pagina) this.pagina.squadriglia = { ...this.pagina.squadriglia, ...salvato };
        this.inModifica = false;
        this.avvisa('Storia e gridi salvati.');
      },
      error: (err: HttpErrorResponse) => {
        this.salvando = false;
        this.erroreModifica = err.error?.error ?? 'Non sono riuscito a salvare. Riprova.';
      },
    });
  }

  private async avvisa(messaggio: string) {
    const toast = await this.toastCtrl.create({ message: messaggio, duration: 2000, position: 'top' });
    await toast.present();
  }
}
