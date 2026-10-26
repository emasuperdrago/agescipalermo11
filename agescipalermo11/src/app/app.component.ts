import { Component } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { SorpreseComponent } from './components/sorprese/sorprese.component';
import { NavigationHistoryService } from './services/navigation-history';
import { InattivitaService } from './services/inattivita';
import { SorpreseService } from './services/sorprese';

// Safari può mostrare ancora l'icona di PeekBox (stesso indirizzo localhost:8100):
// togliere e rimettere i link alle icone lo costringe ad aggiornare quella della scheda.
function aggiornaIconaScheda(): void {
  document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach(link => {
    const nuovo = link.cloneNode() as HTMLLinkElement;
    link.remove();
    document.head.appendChild(nuovo);
  });
}

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: true,
  imports: [IonApp, IonRouterOutlet, SorpreseComponent],
})
export class AppComponent {
  constructor(private navHistory: NavigationHistoryService, inattivita: InattivitaService, sorprese: SorpreseService) {
    aggiornaIconaScheda();
    // Dopo 15 minuti senza usare il sito si esce da soli.
    inattivita.avvia();
    // Gli easter egg: parole segrete, tocchi sul logo, giorni speciali.
    sorprese.avvia();
  }
}
