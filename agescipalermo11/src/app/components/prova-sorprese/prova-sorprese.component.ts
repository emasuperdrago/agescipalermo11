import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Scena, SorpreseService } from '../../services/sorprese';

interface Prova { nome: Scena | 'drago' | 'bosco' | 'lupetto' | 'indovina' | 'tenda'; titolo: string; come: string }

/**
 * Solo per gli admin, nel profilo: un pulsante per ogni easter egg, anche per quelli dei giorni
 * speciali, così si provano quando si vuole. Capi e capigruppo non lo vedono.
 * Uso: <app-prova-sorprese />
 */
@Component({
  selector: 'app-prova-sorprese',
  templateUrl: './prova-sorprese.component.html',
  styleUrls: ['./prova-sorprese.component.scss'],
  standalone: true,
})
export class ProvaSorpreseComponent {
  private sorprese = inject(SorpreseService);
  private router = inject(Router);

  readonly prove: Prova[] = [
    { nome: 'campo', titolo: '⛺ Estote parati', come: 'Scrivere "estote parati"' },
    { nome: 'lupi', titolo: '🐺 Akela', come: 'Scrivere "akela"' },
    { nome: 'tigre', titolo: '🐯 Shere Khan', come: 'Scrivere "shere khan"' },
    { nome: 'bp', titolo: '🎩 Baden-Powell', come: 'Scrivere "baden powell" o "bp"' },
    { nome: 'gigli', titolo: '⚜️ Fuochi a giglio', come: '11 tocchi sul logo' },
    { nome: 'morse', titolo: '📡 Morse', come: 'Logo tenuto premuto' },
    { nome: 'anni80', titolo: '🕹️ Anni \'80', come: 'Codice Konami da tastiera' },
    { nome: 'canto', titolo: '🎲 Canto a sorpresa', come: '3 tocchi sul titolo del canzoniere, o scuotere' },
    { nome: 'orso', titolo: '🐻 L\'orso di Marco', come: '5 tocchi sul murales' },
    { nome: 'compleanno', titolo: '🎂 Compleanno', come: 'In home l\'11 novembre' },
    { nome: 'thinking', titolo: '🌍 Thinking Day', come: 'In home il 22 febbraio' },
    { nome: 'drago', titolo: '🐉 Drago di San Giorgio', come: 'In home il 23 aprile' },
    { nome: 'bosco', titolo: '🧭 Perso nel bosco', come: 'Un indirizzo che non esiste' },
    { nome: 'lupetto', titolo: '🐺 Lupetto senza internet', come: 'Quando cade la connessione' },
    { nome: 'indovina', titolo: '🎵 Indovina il canto', come: 'In fondo alla lista del canzoniere' },
    { nome: 'tenda', titolo: '⛺ Monta la tenda', come: 'Tenere premuto un punto vuoto della mappa' },
  ];

  prova(p: Prova) {
    if (p.nome === 'bosco') {
      this.router.navigateByUrl('/not-found');
      return;
    }
    this.sorprese.prova(p.nome);
  }
}
