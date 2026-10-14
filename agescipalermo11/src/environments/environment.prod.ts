export const environment = {
  production: true,
  backendPort: null,
  /**
   * Online il backend ha un indirizzo suo (la app Node del cPanel). Se cambia il dominio,
   * o se il backend va sotto un altro nome, si cambia solo qui e si ricompila il sito.
   */
  backendOrigin: 'https://api.newsite.palermo11.it',
};
