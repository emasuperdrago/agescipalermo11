
export type Branca = 'branco' | 'reparto' | 'clan';

export type Ruolo = 'capo' | 'admin' | 'ragazzo' | 'visitatore';

/** Dati comuni a chi ha un codice censimento (capi, admin, ragazzi). */
interface UtenteCensito {
  id: number;
  codice_censimento: number;
  nome: string;
  cognome: string;
  eta: number | null;
  email: string | null;
  telefono: string | null;
  branca: Branca | null;
  /** "AAAA-MM-GG" quando è stata caricata: da lei si calcola l'età, che così cresce da sola. */
  data_nascita: string | null;
  /** Percorso della foto profilo sul backend, es. "/uploads/profili/abc.jpg". */
  foto_url: string | null;
  data_registrazione: string;
}

export interface Capo extends UtenteCensito {
  ruolo: 'capo';
}

/** Capo gruppo: gestisce staff e capi. Si assegna solo dal database, non in registrazione. */
export interface Admin extends UtenteCensito {
  ruolo: 'admin';
}

export interface Ragazzo extends UtenteCensito {
  ruolo: 'ragazzo';
}

/** Nessun codice censimento e nessun dato salvato: solo visualizzazione dei contenuti. */
export interface Visitatore {
  ruolo: 'visitatore';
}

export type Utente = Capo | Admin | Ragazzo | Visitatore;

export interface LoginResponse {
  token: string;
  utente: Utente;
}

/** Evento del calendario. Date "AAAA-MM-GG" (giorno locale), orari "HH:MM". */
export interface Evento {
  id: number;
  titolo: string;
  descrizione: string | null;
  luogo: string | null;
  data_inizio: string;
  /** Solo per gli eventi di più giorni. */
  data_fine: string | null;
  ora_inizio: string | null;
  ora_fine: string | null;
  /** Una o più branche, oppure solo "gruppo", oppure solo "capi". */
  etichette: EtichettaEvento[];
  /** Evento con la bandierina: segnato nel calendario e nella lista "In evidenza". */
  in_evidenza: boolean;
  data_creazione: string;
}

export type DatiEvento = Omit<Evento, 'id' | 'data_creazione'>;

/** Etichetta di un evento: come quella dei post, più "capi" (visibile solo a capi e admin). */
export type EtichettaEvento = EtichettaPost | 'capi';

/** Dati modificabili dall'utente nel proprio profilo. */
export interface DatiProfilo {
  nome: string;
  cognome: string;
  /** Nuova foto come data URL; se assente la foto resta com'è. */
  foto?: string;
  /** true per togliere la foto attuale. */
  rimuovi_foto?: boolean;
}

/** Etichetta di un post: a quale branca (o a tutto il gruppo) si riferisce. */
export type EtichettaPost = 'branco' | 'reparto' | 'clan' | 'gruppo';

/** Post della home ("Ultime dal gruppo"). */
export interface Post {
  id: number;
  didascalia: string;
  testo: string | null;
  /** Colore del blocco sotto la foto, es. "#0B87A8". */
  colore: string;
  /** Percorso sul backend della copertina, es. "/uploads/post/abc.jpg". */
  foto_url: string;
  /** Tutte le foto del post, dalla copertina in poi (almeno una). */
  foto_urls: string[];
  /** Link a video su YouTube o Instagram, già ripuliti dal server. */
  video_link: string[];
  /** I video corti caricati sul sito. */
  video: VideoPost[];
  etichetta: EtichettaPost;
  /** I post in evidenza compaiono sopra tutti gli altri. */
  in_evidenza: boolean;
  /** Messo da parte: non sta più nella home, si trova nell'archivio. */
  archiviato: boolean;
  /** Proposto da un ragazzo del clan: aspetta il sì di un capo clan o di un capogruppo. */
  in_attesa: boolean;
  /** Chi l'ha scritto, quando serve saperlo (post in attesa). */
  autore: string | null;
  /** Data di caricamento in formato ISO, messa dal server. */
  data_creazione: string;
}

/** Dati inviati per creare o modificare un post. */
export interface DatiPost {
  didascalia: string;
  testo: string | null;
  colore: string;
  etichetta: EtichettaPost;
  /** Foto come data URL (già rimpicciolita nel browser): obbligatoria solo in creazione. */
  foto?: string;
  /**
   * Tutte le foto in ordine (la prima è la copertina): quelle già del post da tenere
   * e quelle nuove. Se c'è, vale al posto di `foto`.
   */
  foto_elenco?: VoceFotoPost[];
  /** I link ai video (YouTube o Instagram): se c'è, sostituisce quelli di prima. */
  video_link?: string[];
}

/** Un video corto caricato su un post. */
export interface VideoPost {
  id: number;
  /** Percorso sul backend, es. "/uploads/post-video/abc.mp4". */
  url: string;
  nome: string;
  /** Tipo del file, es. "video/mp4". */
  tipo: string;
  dimensione: number;
}

/** Una foto dell'elenco di un post: già sul server (tieni) o appena scelta (nuova). */
export type VoceFotoPost = { tieni: string } | { nuova: string };

/** Una pagina dell'elenco dei post; altri = ci sono altri post da caricare. */
export interface PaginaPost {
  post: Post[];
  altri: boolean;
}

/** Una riga dell'Excel dei censiti, già letta e pronta da inviare al backend. */
export interface RigaImport {
  riga: number;
  /** null quando nel file la casella è vuota: il ragazzo entra lo stesso e il codice arriva dopo. */
  codice_censimento: number | null;
  nome: string;
  cognome: string;
  /** Età letta dal file; se c'è la data di nascita è solo un di più. */
  eta: number | null;
  /** "AAAA-MM-GG": se c'è, l'età la ricalcola il server a ogni compleanno. */
  data_nascita: string | null;
  /** Anno di percorso nella branca (1, 2, 3…): riempie solo chi non ce l'ha ancora. */
  anno_branca: number | null;
  branca: Branca | null;
  /** Solo per i capi: livello di formazione (CFT, CFM, CFA, CAPO…), null se nessuno. */
  livello_foca: string | null;
  /** Solo per i capi. */
  email: string | null;
}

/** Una riga del secondo file dei capi: codice censimento e branca che segue. */
export interface RigaBrancaCapo {
  riga: number;
  codice_censimento: number;
  branca: Branca;
}

export interface RigaScartata {
  riga: number;
  motivo: string;
}

export interface EsitoImport {
  inseriti: number;
  aggiornati: number;
  /** Chi era stato aggiunto a mano e ora ha ricevuto il suo codice censimento. */
  abbinati?: number;
  scartate: RigaScartata[];
  /** Righe caricate lo stesso, ma con qualcosa lasciato fuori (per esempio un'email già usata). */
  avvisi?: RigaScartata[];
}

/** Utente come appare nell'elenco della gestione codici censimento. */
export interface UtenteElenco {
  id: number;
  /** null per chi è stato aggiunto a mano e aspetta il censimento. */
  codice_censimento: number | null;
  nome: string;
  cognome: string;
  eta: number | null;
  ruolo: 'capo' | 'admin' | 'ragazzo';
  branca: Branca | null;
  data_nascita: string | null;
  /** true quando l'utente ha già creato la password con il primo accesso. */
  attivato: boolean;
  /** Solo per i capi: livello di formazione capi. */
  livello_foca: string | null;
}

export interface PendingResponse {
  pending: number;
}


export interface Box {
  id: number;
  nome: string;
  rif_armadio: number | string;
  is_preferito: boolean;
  moving_mode: boolean;
  num_oggetti?: number;
  data_eliminazione?: string;
  data_creazione?: string;
  contiene_fragili?: number;
  ruolo_condivisione?: string | null;
}

export interface BoxListResponse {
  box: Box[];
}

export interface BoxEliminateResponse {
  box_eliminate: Box[];
}


export interface Oggetto {
  id?: number;
  nome: string;
  descrizione?: string;
  quantita?: number;
  categoria?: string;
  tag?: string;
  rif_box?: number;
  foto_url?: string;
}


export interface ArchivioCondiviso {
  id: number;
  nome: string;
  ruolo: 'viewer' | 'editor';
}

export interface ArchivioCondivisiResponse {
  archivi_condivisi: ArchivioCondiviso[];
}

export interface RichiestaCondivisione {
  id: number;
  armadio_id: number;
  nome_archivio: string;
  nome_proprietario: string;
  ruolo: 'viewer' | 'editor';
  data_invio: string;
}

export interface CondivisioniInAttesaResponse {
  richieste: RichiestaCondivisione[];
}

export interface OggettiBoxCondivisaResponse {
  oggetti: Oggetto[];
  ruolo_corrente: string;
}


export interface Messaggio {
  id: number;
  rif_utente: number;
  tipo: 'sistema' | 'supporto' | 'condivisione' | 'geofence';
  mittente: string;
  oggetto: string;
  corpo: string;
  letto: number;
  importante: number;
  direzione?: number;
  timestamp: string;
  /** Se presente, il messaggio è una notifica geofence mappata */
  geofence_id?: number;
  geofence_box_id?: number;
  geofence_armadio_id?: number;
}

export interface MessaggiResponse {
  messaggi: Messaggio[];
}

export interface GeofenceNotifica {
  id: number;
  rif_box: number;
  rif_armadio: number;
  rif_utente: number;
  latitudine: number;
  longitudine: number;
  messaggio: string;
  letto: number;
  nome_archivio: string;
  nome_box: string;
  timestamp: string;
}

export interface GeofenceNotificheResponse {
  notifiche: GeofenceNotifica[];
}

export interface RispostaRapida {
  id: number;
  rif_utente: number;
  titolo: string;
  corpo: string;
  timestamp: string;
}

export interface RisposteRapideResponse {
  risposte: RispostaRapida[];
}

/** Persona da contattare per un posto della mappa (almeno uno dei tre campi). */
export interface ContattoPosto {
  nome: string;
  telefono: string;
  email: string;
}

/** Un campo fatto in un posto: date "AAAA-MM-GG" (giorno locale), la fine solo se dura più giorni. */
export interface CampoPosto {
  data_inizio: string;
  data_fine: string | null;
}

/** Foto o file di un posto. Gli url sono percorsi sul backend. */
export interface AllegatoPosto {
  id: number;
  tipo: 'foto' | 'file';
  nome: string;
  /** Byte. */
  dimensione: number;
  /** Per mostrare la foto, es. "/uploads/posti/abc.jpg". */
  url: string;
  /** Per scaricare il file con il suo nome originale. */
  url_scarica: string;
}

/** A chi appartiene un posto della mappa: una branca o tutto il gruppo (bandierina viola). */
export type BrancaPosto = Branca | 'gruppo';

/** Posto della mappa: la bandierina ha il colore della branca. */
export interface Posto {
  id: number;
  nome: string;
  branca: BrancaPosto;
  latitudine: number;
  longitudine: number;
  indirizzo: string | null;
  descrizione: string | null;
  contatti: ContattoPosto[];
  /** Campi fatti qui, dal più recente. */
  campi: CampoPosto[];
  /** La sede del gruppo: c'è sempre, è una sola e non si elimina. "Riposiziona" porta lì. */
  sede: boolean;
  allegati: AllegatoPosto[];
  data_creazione: string;
  data_modifica: string;
}

export type DatiPosto = Omit<Posto, 'id' | 'sede' | 'allegati' | 'data_creazione' | 'data_modifica'>;

/** Sezione del canzoniere. */
export type SezioneCanto = 'preghiere' | 'branco' | 'reparto' | 'clan' | 'liturgici' | 'fuoco';

/** Canto del canzoniere. Il testo contiene anche le righe degli accordi. */
export interface Canto {
  id: number;
  titolo: string;
  sezione: SezioneCanto;
  testo: string;
  data_creazione: string;
  data_modifica: string;
}

/** Come arriva nell'elenco: senza il testo intero, con la prima riga cantata. */
export interface CantoElenco {
  id: number;
  titolo: string;
  sezione: SezioneCanto;
  anteprima: string;
  data_creazione: string;
  data_modifica: string;
}

export type DatiCanto = Pick<Canto, 'titolo' | 'sezione' | 'testo'>;

/** Anno scolastico che sta facendo chi chiede di iscriversi: da qui si ricava la branca. */
export type AnnoScolastico =
  | 'elementare-3' | 'elementare-4' | 'elementare-5'
  | 'media-1' | 'media-2' | 'media-3'
  | 'superiore-1' | 'superiore-2' | 'superiore-3' | 'superiore-4' | 'superiore-5';

/** Una richiesta nuova è ancora da guardare; letta = un capo se ne sta occupando. */
export type StatoRichiesta = 'nuova' | 'letta' | 'archiviata';

/** Richiesta di iscrizione mandata dal modulo della home (chi la manda non ha un account). */
export interface RichiestaIscrizione {
  id: number;
  nome: string;
  cognome: string;
  /** "AAAA-MM-GG" (giorno locale). */
  data_nascita: string;
  anno_scolastico: AnnoScolastico;
  /** Calcolata dal server sull'anno scolastico: decide a quali capi arriva. */
  branca: Branca;
  telefono: string | null;
  email: string | null;
  /** "Nome Cognome" dei genitori scritti nel modulo: almeno uno (le richieste vecchie possono non averne). */
  genitori: string[];
  /** Anno di catechismo che frequenta (1-5); null se non lo frequenta o se la richiesta è di prima. */
  catechismo: number | null;
  /** Indirizzo di casa; null per le richieste arrivate prima che il modulo lo chiedesse. */
  indirizzo: string | null;
  note: string | null;
  stato: StatoRichiesta;
  /** La decisione dei capi; null se non hanno ancora deciso. */
  esito: 'accettata' | 'rifiutata' | null;
  /** Nome del capo che l'ha presa in carico, se c'è. */
  capo: string | null;
  data_creazione: string;
}

/** Quello che si scrive nel modulo: la branca la calcola il server. */
export interface DatiRichiestaIscrizione {
  nome: string;
  cognome: string;
  /** Almeno un genitore, con nome e cognome. */
  genitore1_nome: string;
  genitore1_cognome: string;
  /** Il secondo genitore è facoltativo. */
  genitore2_nome: string;
  genitore2_cognome: string;
  data_nascita: string;
  anno_scolastico: AnnoScolastico | '';
  telefono: string;
  email: string;
  note: string;
  /** Anno di catechismo (1-5) se lo frequenta, altrimenti null. */
  catechismo: number | null;
  /** Via, numero civico, CAP e città. */
  indirizzo: string;
}

// ---------- Zona capi: anno scout, ragazzi, quote, casse ----------

/** L'anno scout in corso, es. "2026/2027". Lo apre il capogruppo. */
export interface AnnoScout {
  id: number;
  etichetta: string;
  aperto_il: string;
  corrente: number;
}

/** Cosa è successo aprendo l'anno: chi è avanzato, chi ha cambiato branca, chi è rimasto indietro. */
export interface EsitoApertura {
  anno: AnnoScout | null;
  avanzati: number;
  cambi: { nome: string; da: Branca; a: Branca }[];
  /** Ha finito il clan: resta lì finché un capo non lo toglie. */
  finitoClan: string[];
  /** Senza anno di percorso impostato: l'apertura non li ha toccati. */
  senzaAnno: string[];
}

/** Un'attività da pagare, decisa dai capi della branca (es. "Campo estivo, 120 €"). */
export interface AttivitaQuota {
  id: number;
  branca: Branca;
  nome: string;
  importo: number;
}

/** Come sta un ragazzo con un'attività: se partecipa, quanto deve e quanto ha versato. */
export interface QuotaRagazzo {
  attivita: number;
  versato: number;
  pagato: boolean;
  /** false = non partecipa, quindi non deve niente per quell'attività. */
  partecipa: boolean;
  /** Quanto deve lui: di solito la quota a testa dell'attività, a volte una cifra diversa. */
  quota: number;
}

/** Un ragazzo come appare nella tabella della zona capi (anche senza codice censimento). */
export interface RagazzoElenco {
  id: number;
  /** null finché non arriva il censimento. */
  codice_censimento: number | null;
  nome: string;
  cognome: string;
  eta: number | null;
  data_nascita: string | null;
  branca: Branca | null;
  /** 1, 2, 3…: l'anno dentro la branca. */
  anno_branca: number | null;
  /** L'anno scritto per esteso, es. "3° anno di branco". */
  tappa: string | null;
  telefono: string | null;
  email: string | null;
  attivato: boolean;
  /** Solo nel clan: tiene la cassa insieme ai capi clan. */
  tesoriere: boolean;
  /** Quanti PDF ci sono nella sua scheda personale (es. la scheda medica). */
  allegati_scheda: number;
  quote: QuotaRagazzo[];
}

/** I campi della scheda personale che i capi possono scrivere. */
export interface CampiScheda {
  /** Via, numero civico, CAP e città. */
  indirizzo: string;
  genitore1_nome: string;
  genitore1_cognome: string;
  genitore1_telefono: string;
  genitore1_email: string;
  genitore2_nome: string;
  genitore2_cognome: string;
  genitore2_telefono: string;
  genitore2_email: string;
  /** Allergie, intolleranze, farmaci: la scheda medica completa va allegata in PDF. */
  note_sanitarie: string;
  /** Tutto il resto; ci arrivano anche le note scritte nella richiesta di iscrizione. */
  note: string;
}

/** PDF allegato alla scheda (si scarica solo con l'accesso fatto). */
export interface AllegatoScheda {
  id: number;
  nome: string;
  dimensione: number;
  data_caricamento: string;
}

/** La scheda personale di un ragazzo: la vedono solo i capi della sua branca e i capigruppo. */
export interface SchedaRagazzo {
  ragazzo: {
    id: number;
    nome: string;
    cognome: string;
    codice_censimento: number | null;
    data_nascita: string | null;
    eta: number | null;
    branca: Branca | null;
    tappa: string | null;
    telefono: string | null;
    email: string | null;
  };
  scheda: CampiScheda & {
    /** I dati sono arrivati da una richiesta di iscrizione accettata. */
    da_richiesta: boolean;
    data_modifica: string | null;
    modificata_da: string | null;
  };
  allegati: AllegatoScheda[];
}

export interface TabellaRagazzi {
  branca: Branca | null;
  anno: AnnoScout | null;
  attivita: AttivitaQuota[];
  ragazzi: RagazzoElenco[];
}

/** Dati modificabili di un ragazzo dalla zona capi. */
export interface DatiRagazzo {
  /** Può restare vuoto: chi entra adesso il codice lo riceve col censimento. */
  codice_censimento: string;
  /** Solo nel clan: chi tiene la cassa insieme ai capi. */
  tesoriere?: boolean;
  nome: string;
  cognome: string;
  data_nascita: string | null;
  branca: Branca | null;
  anno_branca: number | null;
  telefono: string | null;
  email: string | null;
}

/**
 * Le casse: branco e reparto (dei loro capi), clan (capi clan e tesoriere, ma la guardano
 * tutti i rover e le scolte) e gruppo (dei capigruppo).
 */
export type NomeCassa = 'branco' | 'reparto' | 'clan' | 'gruppo';

/** Un movimento di cassa: importo positivo se entra, negativo se esce. */
export interface Movimento {
  id: number;
  data: string;
  descrizione: string;
  importo: number;
  /** Nato da una quota segnata pagata: non si modifica a mano. */
  automatico: boolean;
  /** Foto dello scontrino, con il link firmato che la apre (null se non c'è). */
  scontrino_url?: string | null;
  autore?: string | null;
}

export interface DatiMovimento {
  data: string;
  descrizione: string;
  importo: number;
  tipo: 'entrata' | 'uscita';
  /** Foto dello scontrino come data URL, già rimpicciolita nel browser. */
  scontrino?: string;
  /** true per togliere lo scontrino che c'era. */
  rimuovi_scontrino?: boolean;
}

/** Un anno scout come compare nella scelta di quale bilancio scaricare. */
export interface AnnoDiCassa {
  id: number;
  etichetta: string;
  corrente: boolean;
  /** Quanti movimenti ha quella cassa in quell'anno. */
  movimenti: number;
}

export interface RiepilogoCassa {
  cassa: NomeCassa;
  anno: AnnoScout | null;
  /** false per chi la cassa può solo guardarla (i rover che non sono tesorieri). */
  puoModificare: boolean;
  /** Gli anni scout, dal più recente: da qui si sceglie quale bilancio salvare. */
  anni: AnnoDiCassa[];
  entrate: number;
  uscite: number;
  saldo: number;
  movimenti: Movimento[];
}

/** Avviso per i capi: un ragazzo della branca ha aggiunto o cambiato qualcosa. */
export interface NotificaContenuto {
  id: number;
  tipo: 'posto' | 'canto' | 'post';
  azione: 'creato' | 'modificato';
  titolo: string;
  rif_oggetto: number | null;
  autore: string;
  letta: boolean;
  data_creazione: string;
}

/** Un capo come appare nella zona del capogruppo (anche i capigruppo stessi). */
export interface CapoElenco {
  id: number;
  codice_censimento: number;
  nome: string;
  cognome: string;
  eta: number | null;
  data_nascita: string | null;
  /** null = a disposizione del gruppo. */
  branca: Branca | null;
  ruolo: 'capo' | 'admin';
  telefono: string | null;
  email: string | null;
  attivato: boolean;
  /** Livello di formazione capi (CFT, CFM, CFA, CAPO…): lo vede solo il capogruppo. */
  livello_foca: string | null;
}

/** Dati che il capogruppo può cambiare di un capo. */
export interface DatiCapo {
  nome: string;
  cognome: string;
  data_nascita: string | null;
  branca: Branca | null;
  ruolo: 'capo' | 'admin';
  telefono: string | null;
  email: string | null;
}

/** Una foto dello sfondo della home. */
export interface SfondoHome {
  id: number;
  /** Percorso sul backend, es. "/uploads/sfondi/abc.jpg". */
  url: string;
}

/** Una Carta di Clan: un PDF, quella in vigore o una dell'archivio. */
export interface CartaDiClan {
  id: number;
  titolo: string;
  /** Anno scout a cui si riferisce, scritto dai capi (es. "2025/2026"). */
  anno: string | null;
  /** Percorso sul backend, es. "/uploads/carte/abc.pdf". */
  url: string;
  nome_file: string;
  dimensione: number;
  /** Vero per la Carta in vigore, quella che si vede nel riquadro. */
  corrente: boolean;
  autore: string | null;
  data_creazione: string;
}

/** Quello che il server risponde sulle Carte di Clan. */
export interface CarteDiClan {
  corrente: CartaDiClan | null;
  archivio: CartaDiClan[];
  /** Vero per i capi clan (anche capigruppo che fanno il capo clan). */
  puoGestire: boolean;
}

/** Una squadriglia del Reparto: attiva, oppure chiusa e finita nell'archivio. */
export interface Squadriglia {
  id: number;
  nome: string;
  /** Percorso della foto dell'animale sul backend; null finché nessuno l'ha caricata. */
  foto_url: string | null;
  attiva: boolean;
  /** Quando è stata chiusa, se lo è. */
  data_chiusura: string | null;
}

/** Quello che il server risponde sulle squadriglie. */
export interface Squadriglie {
  attive: Squadriglia[];
  chiuse: Squadriglia[];
  /** Vero per i capi reparto (anche capigruppo che fanno il capo reparto). */
  puoGestire: boolean;
}

/** Una delle specialità di squadriglia dell'AGESCI: l'elenco lo manda il server. */
export interface SpecialitaSquadriglia {
  chiave: string;
  nome: string;
  /** Di cosa si occupa, in una frase. */
  ambito: string;
}

/** Un guidoncino verde: la specialità conquistata da una squadriglia in un anno scout. */
export interface Guidoncino {
  id: number;
  squadriglia_id: number;
  specialita: string;
  /** L'anno in cui comincia l'anno scout della conquista: 2025 vuol dire 2025/26. */
  anno: number;
  /** Rinnovata l'anno dopo con una nuova impresa. */
  confermata: boolean;
}

export interface Guidoncini {
  specialita: SpecialitaSquadriglia[];
  guidoncini: Guidoncino[];
  /** L'anno scout in corso (2026 vuol dire 2026/27). */
  annoCorrente: number;
  puoGestire: boolean;
}

/** Una tappa della linea in alto nella pagina della storia. */
export interface TappaStoria {
  id: number;
  /** Quando: "11 novembre 1983", "Per oltre 15 anni", "Adesso"… */
  quando: string;
  titolo: string;
  /** Chiave dell'icona (vedi storia/icone-storia.ts). */
  icona: string;
  testo: string;
  /** Una frase in più, in evidenza sotto il testo. */
  nota: string | null;
  /** La tappa di oggi: una sola, con il segno verde. */
  adesso: boolean;
}

/** Una parte della pagina della storia, sotto la linea. */
export interface ParteStoria {
  id: number;
  titolo: string;
  icona: string;
  /** I paragrafi sono separati da una riga vuota. */
  testo: string;
  /** Una frase messa in risalto sotto il testo. */
  evidenza: string | null;
  /** Parole brevi mostrate come etichette in fondo. */
  etichette: string[];
  /** Aggiunge i riquadri di Branco, Reparto e Clan. */
  mostra_branche: boolean;
}

export interface Storia {
  tappe: TappaStoria[];
  parti: ParteStoria[];
  /** Vero per capi e capigruppo: a loro compare "Modifica la storia". */
  puoGestire: boolean;
}

/** La pagina di Marco "Orso Giocoso": solo parti scritte dai capi. */
export interface PaginaMarco {
  parti: ParteStoria[];
  puoGestire: boolean;
}

export type DatiTappaStoria = Omit<TappaStoria, 'id'>;
export type DatiParteStoria = Omit<ParteStoria, 'id'>;

/** Un ragazzo della propria branca che compie gli anni oggi (si calcola e basta: non si salva). */
export interface CompleannoOggi {
  nome: string;
  cognome: string;
  /** Gli anni che compie oggi. */
  anni: number;
}
