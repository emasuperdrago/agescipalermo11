import { environment } from '../../environments/environment';

/** Indirizzo del backend: stesso host del sito, porta del backend. */
export function backendUrl(): string {
  const port = environment.backendPort ? `:${environment.backendPort}` : '';
  return `${window.location.protocol}//${window.location.hostname}${port}`;
}

export function apiUrl(): string {
  return `${backendUrl()}/api`;
}
