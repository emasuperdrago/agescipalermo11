import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { Ruolo } from '../../types/models';

/** Lascia passare solo gli utenti con uno dei ruoli indicati, es. ruoloGuard('capo', 'admin'). */
export const ruoloGuard = (...ruoli: Ruolo[]): CanActivateFn => () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.sessioneValida()) return router.parseUrl('/benvenuto');
  const ruolo = auth.utente?.ruolo;
  return ruolo && ruoli.includes(ruolo) ? true : router.parseUrl('/home');
};
