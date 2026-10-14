import { environment } from '../../environments/environment';

/**
 * Indirizzo del backend. Online è quello scritto in environment.prod.ts; in locale è lo
 * stesso host del sito con la porta del backend (così funziona anche dal telefono).
 */
export function backendUrl(): string {
  if (environment.backendOrigin) return environment.backendOrigin;
  const port = environment.backendPort ? `:${environment.backendPort}` : '';
  return `${window.location.protocol}//${window.location.hostname}${port}`;
}

export function apiUrl(): string {
  return `${backendUrl()}/api`;
}
