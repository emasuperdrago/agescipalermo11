import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { retry, timer, throwError } from 'rxjs';
import { apiUrl } from '../services/api';

/**
 * Le letture (GET) che falliscono per colpa del server o della rete si riprovano una volta da
 * sole, dopo un attimo. Su Vercel capita di rado (il backend che si sta riaccendendo, una nuova
 * versione appena pubblicata): così chi usa il sito non vede l'errore. Le scritture no: rifarle
 * potrebbe salvare due volte la stessa cosa.
 */
export const riprovaLettureInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.method !== 'GET' || !req.url.startsWith(apiUrl())) return next(req);
  return next(req).pipe(
    retry({
      count: 1,
      delay: (err: unknown) => {
        const stato = err instanceof HttpErrorResponse ? err.status : -1;
        // 0 = nessuna risposta (rete), 5xx = errore del server: vale la pena riprovare.
        return stato === 0 || stato >= 500 ? timer(800) : throwError(() => err);
      },
    }),
  );
};
