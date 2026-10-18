import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { ruoloGuard } from './guards/ruolo.guard';
import { AuthService } from './services/auth';


export const routes: Routes = [

  // Chi ha già una sessione valida entra in home, tutti gli altri partono da benvenuto.
  {
    path: '',
    pathMatch: 'full',
    redirectTo: () => inject(AuthService).sessioneValida() ? '/home' : '/benvenuto'
  },

  // Benvenuto e login restano sempre raggiungibili (anche da un visitatore che vuole accedere col codice).
  {
    path: 'benvenuto',
    loadComponent: () => import('./benvenuto/benvenuto.page').then(m => m.BenvenutoPage)
  },
  {
    path: 'login',
    loadComponent: () => import('./login/login.page').then(m => m.LoginPage)
  },
  // Il link dell'email di conferma: aperto da chi si è appena registrato, senza sessione.
  {
    path: 'conferma-email',
    loadComponent: () => import('./conferma-email/conferma-email.page').then(m => m.ConfermaEmailPage)
  },
  // Il link dell'email per la password dimenticata.
  {
    path: 'nuova-password',
    loadComponent: () => import('./nuova-password/nuova-password.page').then(m => m.NuovaPasswordPage)
  },
  {
    path: 'not-found',
    loadComponent: () => import('./not-found/not-found.page').then(m => m.NotFoundPage)
  },

  {
    path: 'home',
    loadComponent: () => import('./home/home.page').then(m => m.HomePage)
  },
  {
    path: 'dettaglio-post/:id',
    loadComponent: () => import('./dettaglio-post/dettaglio-post.page').then(m => m.DettaglioPostPage)
  },
  {
    path: 'storia',
    loadComponent: () => import('./storia/storia.page').then(m => m.StoriaPage)
  },
  {
    path: 'marco',
    loadComponent: () => import('./marco/marco.page').then(m => m.MarcoPage)
  },
  {
    path: 'link-utili',
    loadComponent: () => import('./link-utili/link-utili.page').then(m => m.LinkUtiliPage)
  },
  {
    path: 'canzoniere',
    loadComponent: () => import('./canzoniere/canzoniere.page').then(m => m.CanzonierePage)
  },
  {
    path: 'canzoniere/:id',
    loadComponent: () => import('./dettaglio-canzoniere/dettaglio-canzoniere.page').then(m => m.DettaglioCanzonierePage)
  },
  {
    path: 'branco',
    loadComponent: () => import('./branco/branco.page').then(m => m.BrancoPage)
  },
  {
    path: 'reparto',
    loadComponent: () => import('./reparto/reparto.page').then(m => m.RepartoPage)
  },
  {
    path: 'reparto/squadriglie/:id',
    loadComponent: () => import('./squadriglie/squadriglie.page').then(m => m.SquadrigliePage)
  },
  {
    path: 'clan',
    loadComponent: () => import('./clan/clan.page').then(m => m.ClanPage)
  },
  {
    path: 'clan/carta-di-clan',
    loadComponent: () => import('./carta-di-clan/carta-di-clan.page').then(m => m.CartaDiClanPage)
  },
  // "Dove siamo": la sola sede, aperta a chiunque (la mappa completa resta riservata).
  {
    path: 'dove-siamo',
    loadComponent: () => import('./dove-siamo/dove-siamo.page').then(m => m.DoveSiamoPage)
  },
  // La mappa contiene contatti personali: niente visitatori.
  {
    path: 'mappa',
    canActivate: [ruoloGuard('capo', 'admin', 'ragazzo')],
    loadComponent: () => import('./mappa/mappa.page').then(m => m.MappaPage)
  },
  {
    path: 'mappa/:id',
    canActivate: [ruoloGuard('capo', 'admin', 'ragazzo')],
    loadComponent: () => import('./dettaglio-informazioni-mappa/dettaglio-informazioni-mappa.page').then(m => m.DettaglioInformazioniMappaPage)
  },
  {
    path: 'archivio',
    loadComponent: () => import('./archivio/archivio.page').then(m => m.ArchivioPage)
  },
  {
    path: 'calendario',
    loadComponent: () => import('./calendario/calendario.page').then(m => m.CalendarioPage)
  },
  {
    path: 'richiesta-iscrizione',
    loadComponent: () => import('./richiesta-iscrizione/richiesta-iscrizione.page').then(m => m.RichiestaIscrizionePage)
  },
  // La comunità capi: la stessa pagina della zona capogruppo, ma chi non è capogruppo
  // la guarda e basta (lo decide il server, che manda meno dati).
  {
    path: 'capi',
    loadComponent: () => import('./gestione-capi/gestione-capi.page').then(m => m.GestioneCapiPage)
  },
  // Il PEG, Progetto Educativo di Gruppo: lo vedono tutti.
  {
    path: 'peg',
    loadComponent: () => import('./peg/peg.page').then(m => m.PegPage)
  },
  {
    path: 'capi-gruppo',
    canActivate: [authGuard],
    loadComponent: () => import('./capi-gruppo/capi-gruppo.page').then(m => m.CapiGruppoPage)
  },

  {
    path: 'profilo',
    canActivate: [authGuard],
    loadComponent: () => import('./profilo/profilo.page').then(m => m.ProfiloPage)
  },
  // Zona riservata ai capi (voce "Capi" della barra in basso).
  {
    path: 'area-capi',
    canActivate: [ruoloGuard('capo', 'admin')],
    loadComponent: () => import('./area-capi/area-capi.page').then(m => m.AreaCapiPage)
  },
  // Zona capi: i ragazzi della propria branca con le quote, e la cassa.
  {
    path: 'gestione-ragazzi',
    canActivate: [ruoloGuard('capo', 'admin')],
    loadComponent: () => import('./gestione-ragazzi/gestione-ragazzi.page').then(m => m.GestioneRagazziPage)
  },
  // Le casse di branco, reparto e gruppo: roba della zona capi.
  {
    path: 'bilancio/:cassa',
    canActivate: [ruoloGuard('capo', 'admin')],
    loadComponent: () => import('./bilancio/bilancio.page').then(m => m.BilancioPage)
  },
  // La cassa di clan sta nella sezione Clan, non nella zona capi: la guardano anche
  // rover e scolte, e ci si arriva dal menu Clan. Chi può scrivere lo decide il server.
  {
    path: 'clan/cassa',
    canActivate: [ruoloGuard('capo', 'admin', 'ragazzo')],
    loadComponent: () => import('./bilancio/bilancio.page').then(m => m.BilancioPage)
  },
  // Le foto che scorrono nella home: le cambiano tutti i capi.
  {
    path: 'sfondi-home',
    canActivate: [ruoloGuard('capo', 'admin')],
    loadComponent: () => import('./sfondi-home/sfondi-home.page').then(m => m.SfondiHomePage)
  },
  // Zona capogruppo: la comunità capi.
  {
    path: 'gestione-capi',
    canActivate: [ruoloGuard('admin')],
    loadComponent: () => import('./gestione-capi/gestione-capi.page').then(m => m.GestioneCapiPage)
  },
  // Due zone separate: "capi" la aprono i capigruppo, "ragazzi" i capi della branca.
  {
    path: 'gestione-censiti',
    canActivate: [ruoloGuard('capo', 'admin')],
    loadComponent: () => import('./gestione-censiti/gestione-censiti.page').then(m => m.GestioneCensitiPage)
  },
  {
    path: 'gestione-censiti/:tipo',
    canActivate: [ruoloGuard('capo', 'admin')],
    loadComponent: () => import('./gestione-censiti/gestione-censiti.page').then(m => m.GestioneCensitiPage)
  },

  { path: '**', redirectTo: 'not-found' },
];
