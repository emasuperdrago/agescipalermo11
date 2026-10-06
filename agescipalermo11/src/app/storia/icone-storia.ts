import {
  bonfireOutline, bookOutline, boatOutline, calendarOutline, flagOutline, footstepsOutline,
  globeOutline, heartOutline, homeOutline, leafOutline, locationOutline, peopleOutline,
  schoolOutline, starOutline, timeOutline, trophyOutline
} from 'ionicons/icons';

/**
 * Le icone che i capi possono scegliere per tappe e parti della storia. La chiave è quella
 * salvata sul server (che accetta solo queste): se se ne aggiunge una, va aggiunta anche
 * in ICONE_STORIA nel backend.
 */
export const ICONE_STORIA: readonly { chiave: string; nome: string; icona: string }[] = [
  { chiave: 'bandiera', nome: 'Bandiera', icona: flagOutline },
  { chiave: 'casa', nome: 'Casa', icona: homeOutline },
  { chiave: 'luogo', nome: 'Luogo', icona: locationOutline },
  { chiave: 'tempo', nome: 'Orologio', icona: timeOutline },
  { chiave: 'calendario', nome: 'Calendario', icona: calendarOutline },
  { chiave: 'persone', nome: 'Persone', icona: peopleOutline },
  { chiave: 'scuola', nome: 'Formazione', icona: schoolOutline },
  { chiave: 'cuore', nome: 'Cuore', icona: heartOutline },
  { chiave: 'mondo', nome: 'Mondo', icona: globeOutline },
  { chiave: 'fuoco', nome: 'Fuoco', icona: bonfireOutline },
  { chiave: 'foglia', nome: 'Natura', icona: leafOutline },
  { chiave: 'barca', nome: 'Barca', icona: boatOutline },
  { chiave: 'passi', nome: 'Strada', icona: footstepsOutline },
  { chiave: 'trofeo', nome: 'Trofeo', icona: trophyOutline },
  { chiave: 'stella', nome: 'Stella', icona: starOutline },
  { chiave: 'libro', nome: 'Libro', icona: bookOutline },
];

export function iconaStoria(chiave: string): string {
  return (ICONE_STORIA.find(i => i.chiave === chiave) ?? ICONE_STORIA[0]).icona;
}

/** Il testo diviso in paragrafi: li separa una riga vuota. */
export function paragrafi(testo: string): string[] {
  return testo.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
}
