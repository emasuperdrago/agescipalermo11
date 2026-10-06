import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';

export const authGuard: CanActivateFn = () => {
  if (inject(AuthService).sessioneValida()) return true;

  return inject(Router).parseUrl('/benvenuto');
};
