import { Injectable, inject } from '@angular/core';
import { AlertController } from '@ionic/angular/standalone';

/**
 * Le finestrelle "Sei sicuro?" prima di salvare o di perdere una modifica.
 * Uso: if (!(await this.conferma.chiedi('Salvare?', 'Il canto cambia per tutti.', 'Salva'))) return;
 */
@Injectable({ providedIn: 'root' })
export class ConfermaService {
  private alertCtrl = inject(AlertController);

  /** Vero se si tocca il pulsante `si`; falso con "Annulla" o toccando fuori. */
  async chiedi(titolo: string, messaggio: string, si: string, no = 'Annulla'): Promise<boolean> {
    const alert = await this.alertCtrl.create({
      header: titolo,
      message: messaggio,
      buttons: [
        { text: no, role: 'cancel' },
        { text: si, role: 'confirm' },
      ],
    });
    await alert.present();
    // Si aspetta che la finestrella sia sparita: un suo velo non deve restare sopra la pagina.
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }
}
