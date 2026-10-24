import { HttpInterceptorFn, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, tap, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const token = localStorage.getItem('token');

  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    // Il server allunga la sessione di chi sta usando il sito mandando un token nuovo.
    tap(evento => {
      const nuovo = evento instanceof HttpResponse ? evento.headers.get('X-Token-Nuovo') : null;
      if (nuovo && localStorage.getItem('token')) localStorage.setItem('token', nuovo);
    }),
    catchError((err: HttpErrorResponse) => {
      // Un 401 sul login significa solo credenziali errate: la pagina gestisce l'errore da sola.
      // Anche l'uscita: se la sessione era già finita non c'è niente da segnalare.
      if (err.status === 401 && !req.url.endsWith('/api/login') && !req.url.endsWith('/api/logout')) {
        localStorage.clear();
        router.navigateByUrl('/login', { replaceUrl: true });
      }
      return throwError(() => err);
    })
  );
};
