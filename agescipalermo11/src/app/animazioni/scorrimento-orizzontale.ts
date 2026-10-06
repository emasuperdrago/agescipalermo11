import { AnimationBuilder, createAnimation } from '@ionic/angular/standalone';

/** Durata e curva condivise con la "pillola" della barra in basso, così si muovono insieme. */
export const DURATA_SCORRIMENTO = 320;
export const CURVA_SCORRIMENTO = 'cubic-bezier(0.32, 0.72, 0, 1)';

export function movimentoRidotto(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Cambio pagina con scorrimento orizzontale: "forward" = la nuova pagina entra da destra,
 * "back" = entra da sinistra. La barra in basso (app-barra-inferiore) resta ferma.
 */
export const scorrimentoOrizzontale: AnimationBuilder = (_base: Element, opzioni: any) => {
  const indietro = opzioni.direction === 'back';
  const durata = movimentoRidotto() ? 0 : DURATA_SCORRIMENTO;
  // Tutto tranne la barra in basso, che è uguale nelle due pagine.
  const contenuto = (pagina: Element) => pagina.querySelectorAll(':scope > :not(app-barra-inferiore)');

  const animazione = createAnimation().duration(durata).easing(CURVA_SCORRIMENTO);

  const entrata = createAnimation()
    .addElement(opzioni.enteringEl)
    .beforeRemoveClass('ion-page-invisible');
  const contenutoEntrata = createAnimation()
    .addElement(contenuto(opzioni.enteringEl))
    .fromTo('transform', `translateX(${indietro ? '-100%' : '100%'})`, 'translateX(0)');
  animazione.addAnimation([entrata, contenutoEntrata]);

  if (opzioni.leavingEl) {
    const contenutoUscita = createAnimation()
      .addElement(contenuto(opzioni.leavingEl))
      .fromTo('transform', 'translateX(0)', `translateX(${indietro ? '100%' : '-100%'})`);
    animazione.addAnimation(contenutoUscita);

    // Durante lo scorrimento si vede la barra della pagina che esce: la sua pillola si è già
    // mossa al tocco. Quella della pagina nuova (già al suo posto) compare alla fine.
    const barraEntrata = opzioni.enteringEl.querySelectorAll(':scope > app-barra-inferiore');
    if (barraEntrata.length && opzioni.leavingEl.querySelector(':scope > app-barra-inferiore')) {
      animazione.addAnimation(createAnimation()
        .addElement(barraEntrata)
        .beforeStyles({ visibility: 'hidden' })
        .afterClearStyles(['visibility']));
    }
  }
  return animazione;
};
