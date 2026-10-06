/**
 * Prepara una foto nel browser prima di caricarla: la rimpicciolisce (JPEG) e, se richiesto,
 * la ritaglia quadrata al centro. Così il caricamento è veloce e le immagini hanno dimensioni omogenee.
 */
export async function preparaImmagine(file: File, opzioni: { latoMax: number; quadrata?: boolean }): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Il file scelto non è un\'immagine.');
  let immagine: ImageBitmap;
  try {
    immagine = await createImageBitmap(file);
  } catch {
    throw new Error('Impossibile leggere questa immagine: prova con una foto JPG o PNG.');
  }

  // Area della foto originale da usare: tutta, oppure il quadrato centrale.
  const lato = Math.min(immagine.width, immagine.height);
  const sorgente = opzioni.quadrata
    ? { x: (immagine.width - lato) / 2, y: (immagine.height - lato) / 2, l: lato, a: lato }
    : { x: 0, y: 0, l: immagine.width, a: immagine.height };

  const scala = Math.min(1, opzioni.latoMax / Math.max(sorgente.l, sorgente.a));
  const tela = document.createElement('canvas');
  tela.width = Math.round(sorgente.l * scala);
  tela.height = Math.round(sorgente.a * scala);
  tela.getContext('2d')!.drawImage(immagine, sorgente.x, sorgente.y, sorgente.l, sorgente.a, 0, 0, tela.width, tela.height);
  immagine.close();
  return tela.toDataURL('image/jpeg', 0.82);
}
