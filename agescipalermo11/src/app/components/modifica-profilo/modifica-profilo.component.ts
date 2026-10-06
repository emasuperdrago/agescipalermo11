import { Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, ModalController
} from '@ionic/angular/standalone';
import { closeOutline, imageOutline, person, trashOutline } from 'ionicons/icons';
import { AuthService } from '../../services/auth';
import { DatiProfilo, Utente } from '../../../types/models';

export const MAX_NOME = 60;

/** Pop-up "Modifica profilo": foto, nome e cognome. Si chiude restituendo l'utente aggiornato (role "salvato"). */
@Component({
  selector: 'app-modifica-profilo',
  templateUrl: './modifica-profilo.component.html',
  styleUrls: ['./modifica-profilo.component.scss'],
  standalone: true,
  imports: [FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon],
})
export class ModificaProfiloComponent implements OnInit {
  @Input({ required: true }) utente!: Utente;

  readonly maxNome = MAX_NOME;
  readonly icone = { chiudi: closeOutline, foto: imageOutline, avatar: person, rimuovi: trashOutline };

  nome = '';
  cognome = '';
  /** Foto nuova scelta ora (data URL). */
  fotoNuova: string | null = null;
  /** true se l'utente ha chiesto di togliere la foto attuale. */
  fotoRimossa = false;

  preparandoFoto = false;
  salvando = false;
  errore = '';

  constructor(private modalCtrl: ModalController, private auth: AuthService) {}

  ngOnInit() {
    if (this.utente.ruolo === 'visitatore') return;
    this.nome = this.utente.nome;
    this.cognome = this.utente.cognome;
  }

  /** Foto da mostrare nell'anteprima: la nuova, altrimenti quella attuale (se non rimossa). */
  get anteprima(): string | null {
    if (this.fotoNuova) return this.fotoNuova;
    return this.fotoRimossa ? null : this.auth.urlFotoProfilo(this.utente);
  }

  get valido(): boolean {
    return !!this.nome.trim() && !!this.cognome.trim();
  }

  async scegliFoto(evento: Event) {
    const input = evento.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.errore = '';
    this.preparandoFoto = true;
    try {
      this.fotoNuova = await this.auth.preparaFotoProfilo(file);
      this.fotoRimossa = false;
    } catch (e) {
      this.errore = e instanceof Error ? e.message : 'Impossibile leggere la foto.';
    } finally {
      this.preparandoFoto = false;
    }
  }

  rimuoviFoto() {
    this.fotoNuova = null;
    this.fotoRimossa = true;
  }

  chiudi() {
    this.modalCtrl.dismiss(null, 'annulla');
  }

  salva() {
    if (!this.valido) {
      this.errore = 'Nome e cognome sono obbligatori.';
      return;
    }

    const dati: DatiProfilo = { nome: this.nome.trim(), cognome: this.cognome.trim() };
    if (this.fotoNuova) dati.foto = this.fotoNuova;
    else if (this.fotoRimossa) dati.rimuovi_foto = true;

    this.salvando = true;
    this.errore = '';
    this.auth.aggiornaProfilo(dati).subscribe({
      next: utente => this.modalCtrl.dismiss(utente, 'salvato'),
      error: (err: HttpErrorResponse) => {
        this.salvando = false;
        this.errore = err.status === 0 ? 'Server non raggiungibile. Riprova tra poco.'
          : err.status === 404 && !err.error?.error ? 'Il server non gestisce ancora i profili: va riavviato il backend.'
          : err.error?.error ?? `Salvataggio non riuscito (errore ${err.status}). Riprova.`;
      },
    });
  }
}
