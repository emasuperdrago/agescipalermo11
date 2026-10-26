import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, firstValueFrom, from, switchMap, throwError } from 'rxjs';
import { apiUrl } from '../services/api';
import { AuthService } from '../services/auth';

/**
 * Su Vercel il backend non riceve richieste più grandi di 4,5 MB (video, PDF, post con tante foto).
 * Per quelle il file va prima in Vercel Blob, in uno spazio privato e solo per chi lo carica;
 * poi parte la richiesta vera, vuota, con il nome di quel file: il backend lo riprende da lì.
 * Sul Mac (e su un server normale) il backend risponde "diretto: false" e non cambia niente.
 */
const SOGLIA = 4 * 1024 * 1024;

interface Modo { diretto: boolean; soglia: number }
let modo: Promise<Modo> | null = null;

/** Si chiede una volta sola al backend; se non risponde, si manda tutto come sempre. */
function chiediModo(http: HttpClient): Promise<Modo> {
  modo ??= firstValueFrom(http.get<Modo>(`${apiUrl()}/caricamenti`))
    .catch(() => ({ diretto: false, soglia: Infinity }));
  return modo;
}

/** Il corpo della richiesta come file, per misurarlo e caricarlo. */
function comeFile(corpo: unknown): Blob | null {
  if (corpo instanceof Blob) return corpo;
  if (corpo instanceof ArrayBuffer) return new Blob([corpo]);
  if (typeof corpo === 'string') return new Blob([corpo], { type: 'text/plain' });
  if (corpo && typeof corpo === 'object' && !(corpo instanceof FormData)) {
    return new Blob([JSON.stringify(corpo)], { type: 'application/json' });
  }
  return null;
}

async function caricaSuBlob(file: Blob, idUtente: number): Promise<string> {
  // La libreria di Blob si carica solo quando serve: chi non carica file grandi non la scarica.
  const { uploadPresigned } = await import('@vercel/blob/client');
  const percorso = `tmp/${idUtente}/${crypto.randomUUID()}`;
  const token = localStorage.getItem('token');
  await uploadPresigned(percorso, file, {
    access: 'private',
    handleUploadUrl: `${apiUrl()}/caricamenti`,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    contentType: file.type || 'application/octet-stream',
  });
  return percorso;
}

export const caricamentiGrandiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next(req);
  if (!req.url.startsWith(apiUrl()) || req.url.startsWith(`${apiUrl()}/caricamenti`)) return next(req);
  const file = comeFile(req.body);
  if (!file || file.size < SOGLIA) return next(req);

  const http = inject(HttpClient);
  const auth = inject(AuthService);
  return from(chiediModo(http)).pipe(
    switchMap((m): Observable<any> => {
      // Il visitatore non ha un id (e non carica file): per lui niente Blob.
      const chi = auth.utente;
      const idUtente = chi && 'id' in chi ? chi.id : undefined;
      if (!m.diretto || file.size < m.soglia || !idUtente) return next(req);
      return from(caricaSuBlob(file, idUtente)).pipe(
        // Il caricamento su Blob non passa da HttpClient: il suo errore diventa uno come gli altri,
        // con un messaggio che si capisce (altrimenti le pagine scrivono "errore undefined").
        catchError((err: unknown) => {
          console.error('Caricamento su Blob:', err);
          return throwError(() => new HttpErrorResponse({
            status: 502, url: req.url,
            error: { error: 'Il caricamento delle foto o dei file non è riuscito. Riprova; se continua, esci e rientra.' },
          }));
        }),
        switchMap(percorso => next(req.clone({
          body: null,
          setHeaders: {
            'X-Corpo-Caricato': percorso,
            'Content-Type': file.type === 'application/json'
              ? 'application/json'
              : req.headers.get('Content-Type') ?? 'application/octet-stream',
          },
        }))),
      );
    }),
  );
};
