import { Component, Input } from '@angular/core';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, ModalController
} from '@ionic/angular/standalone';
import { checkmarkCircleOutline, closeOutline, pencilOutline, trashOutline } from 'ionicons/icons';
import { PostService, nomeEtichetta } from '../../services/post';
import { Post } from '../../../types/models';

/**
 * Anteprima di un post proposto da un ragazzo del clan: si vede come verrebbe pubblicato,
 * con foto, didascalia e testo interi. Chi deve approvare decide da qui;
 * l'autore può correggerlo o ritirarlo.
 * Si chiude con role "pubblica", "rifiuta", "modifica" o "ritira".
 */
@Component({
  selector: 'app-anteprima-post',
  templateUrl: './anteprima-post.component.html',
  styleUrls: ['./anteprima-post.component.scss'],
  standalone: true,
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon],
})
export class AnteprimaPostComponent {
  @Input() post!: Post;
  /** Capo clan o capogruppo: può dire sì o no. */
  @Input() puoApprovare = false;
  /** L'autore: può correggere o ritirare. */
  @Input() eMio = false;

  readonly icone = {
    chiudi: closeOutline, pubblica: checkmarkCircleOutline, rifiuta: trashOutline, modifica: pencilOutline,
  };
  readonly nomeEtichetta = nomeEtichetta;

  constructor(private modalCtrl: ModalController, private posts: PostService) {}

  get foto(): string {
    return this.posts.urlFoto(this.post);
  }

  /** Data scritta come si dice: 21 settembre 2026. */
  get quando(): string {
    const giorno = new Date(this.post.data_creazione);
    return isNaN(giorno.getTime()) ? '' :
      giorno.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  chiudi() {
    this.modalCtrl.dismiss(null, 'annulla');
  }

  decidi(azione: 'pubblica' | 'rifiuta' | 'modifica' | 'ritira') {
    this.modalCtrl.dismiss(this.post, azione);
  }
}
