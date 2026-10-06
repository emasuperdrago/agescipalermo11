import { Component } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { NavigationHistoryService } from './services/navigation-history';

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
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  constructor(private navHistory: NavigationHistoryService) {
    aggiornaIconaScheda();
  }
}
