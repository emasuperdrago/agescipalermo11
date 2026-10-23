// Le tabelle del sito su PostgreSQL. Si creano da sole al primo avvio (CREATE ... IF NOT EXISTS),
// nell'ordine giusto per i collegamenti fra tabelle.
//
// Le date restano scritte come testo, uguali a prima: "AAAA-MM-GG" per i giorni e
// "AAAA-MM-GGTHH:MM:SSZ" (ora UTC) per i momenti, così il resto del codice non cambia.
// I campi con dati personali contengono il valore cifrato ("cif1:..."): vedi cifratura.js.
// I sì/no restano numeri (0 e 1), come prima.

const ADESSO = `(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))`;
const OGGI = `(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'))`;
const SECONDI = `(extract(epoch from now())::bigint)`;
const BRANCHE = `('branco', 'reparto', 'clan')`;

const TABELLE = [
    // Capi, capigruppo e ragazzi. codice_censimento, email, telefono e data_nascita sono cifrati;
    // codice_impronta ed email_impronta servono a cercarli e a non averne due uguali
    // (vedi cifratura.js).
    `CREATE TABLE IF NOT EXISTS utenti (
        id SERIAL PRIMARY KEY,
        codice_censimento TEXT,
        codice_impronta TEXT UNIQUE,
        nome TEXT NOT NULL,
        cognome TEXT NOT NULL,
        eta INTEGER CHECK (eta IS NULL OR eta BETWEEN 0 AND 120),
        email TEXT,
        email_impronta TEXT UNIQUE,
        telefono TEXT,
        password TEXT,
        ruolo TEXT NOT NULL CHECK (ruolo IN ('capo', 'admin', 'ragazzo')),
        branca TEXT CHECK (branca IN ${BRANCHE}),
        data_registrazione TEXT NOT NULL DEFAULT ${OGGI},
        foto TEXT,
        data_nascita TEXT,
        anno_branca INTEGER,
        tesoriere SMALLINT NOT NULL DEFAULT 0,
        sessioni_valide_da BIGINT,
        livello_foca TEXT,
        email_a_mano SMALLINT NOT NULL DEFAULT 0,
        email_confermata SMALLINT NOT NULL DEFAULT 0
    )`,
    // "Capogruppo" è il nome che compare nell'elenco dei capi; i permessi li dà il ruolo admin.
    // Un admin può esserlo o no (vale solo per gli admin).
    `ALTER TABLE utenti ADD COLUMN IF NOT EXISTS capogruppo SMALLINT NOT NULL DEFAULT 0`,
    // Chi gestisce il sito: l'unico che vede chi è admin e lo cambia; il suo account non lo
    // tocca nessun altro. Si mette dal database (non sta nel codice, che è pubblico).
    `ALTER TABLE utenti ADD COLUMN IF NOT EXISTS gestore_sito SMALLINT NOT NULL DEFAULT 0`,

    `CREATE TABLE IF NOT EXISTS anno_scout (
        id SERIAL PRIMARY KEY,
        etichetta TEXT NOT NULL UNIQUE,
        aperto_il TEXT NOT NULL DEFAULT ${OGGI},
        rif_capogruppo INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        corrente SMALLINT NOT NULL DEFAULT 1
    )`,
    // Uno solo è l'anno in corso.
    `CREATE UNIQUE INDEX IF NOT EXISTS anno_scout_corrente ON anno_scout (corrente) WHERE corrente = 1`,

    `CREATE TABLE IF NOT EXISTS attivita_quota (
        id SERIAL PRIMARY KEY,
        rif_anno INTEGER NOT NULL REFERENCES anno_scout(id) ON DELETE CASCADE,
        branca TEXT NOT NULL CHECK (branca IN ${BRANCHE}),
        nome TEXT NOT NULL,
        importo DOUBLE PRECISION NOT NULL DEFAULT 0,
        ordine INTEGER NOT NULL DEFAULT 0,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO}
    )`,

    `CREATE TABLE IF NOT EXISTS pagamento_quota (
        id SERIAL PRIMARY KEY,
        rif_attivita INTEGER NOT NULL REFERENCES attivita_quota(id) ON DELETE CASCADE,
        rif_utente INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
        versato DOUBLE PRECISION NOT NULL DEFAULT 0,
        pagato SMALLINT NOT NULL DEFAULT 0,
        data_modifica TEXT NOT NULL DEFAULT ${ADESSO},
        partecipa SMALLINT NOT NULL DEFAULT 1,
        quota DOUBLE PRECISION,
        UNIQUE (rif_attivita, rif_utente)
    )`,

    `CREATE TABLE IF NOT EXISTS movimento_cassa (
        id SERIAL PRIMARY KEY,
        rif_anno INTEGER NOT NULL REFERENCES anno_scout(id) ON DELETE CASCADE,
        cassa TEXT NOT NULL CHECK (cassa IN ('branco', 'reparto', 'clan', 'gruppo')),
        data TEXT NOT NULL,
        descrizione TEXT NOT NULL,
        importo DOUBLE PRECISION NOT NULL,
        rif_pagamento INTEGER REFERENCES pagamento_quota(id) ON DELETE CASCADE,
        rif_autore INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        scontrino TEXT,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO}
    )`,

    `CREATE TABLE IF NOT EXISTS canto (
        id SERIAL PRIMARY KEY,
        titolo TEXT NOT NULL,
        sezione TEXT NOT NULL CHECK (sezione IN ('preghiere', 'branco', 'reparto', 'clan', 'liturgici', 'fuoco')),
        testo TEXT NOT NULL,
        rif_autore INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO},
        data_modifica TEXT NOT NULL DEFAULT ${ADESSO},
        trasposizione SMALLINT NOT NULL DEFAULT 0 CHECK (trasposizione BETWEEN -11 AND 11)
    )`,
    // La "tonalità del gruppo": di quanti semitoni i capi hanno spostato gli accordi rispetto
    // al testo scritto (che resta sempre quello originale). Per le tabelle nate prima:
    `ALTER TABLE canto ADD COLUMN IF NOT EXISTS trasposizione SMALLINT NOT NULL DEFAULT 0
        CHECK (trasposizione BETWEEN -11 AND 11)`,

    // "Link utili" (in Chi siamo): titolo e indirizzo, in quattro sezioni. Li vedono tutti,
    // li aggiungono, cambiano, spostano e tolgono i capi e i capigruppo.
    `CREATE TABLE IF NOT EXISTS link_utile (
        id SERIAL PRIMARY KEY,
        sezione TEXT NOT NULL CHECK (sezione IN ('branco', 'reparto', 'clan', 'capi')),
        titolo TEXT NOT NULL,
        url TEXT NOT NULL,
        ordine INTEGER NOT NULL DEFAULT 0,
        rif_autore INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO},
        data_modifica TEXT NOT NULL DEFAULT ${ADESSO}
    )`,

    // Bozze dei libretti dei canti (anche per la messa): le scelte in JSON, da riaprire.
    `CREATE TABLE IF NOT EXISTS libretto_bozza (
        id SERIAL PRIMARY KEY,
        dati TEXT NOT NULL,
        rif_autore INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO},
        data_modifica TEXT NOT NULL DEFAULT ${ADESSO}
    )`,

    // PEG, Progetto Educativo di Gruppo: come la Carta di Clan, un PDF in vigore e l'archivio.
    `CREATE TABLE IF NOT EXISTS peg (
        id SERIAL PRIMARY KEY,
        titolo TEXT NOT NULL,
        anno TEXT,
        percorso TEXT NOT NULL,
        nome_originale TEXT NOT NULL,
        dimensione BIGINT NOT NULL DEFAULT 0,
        corrente SMALLINT NOT NULL DEFAULT 0,
        rif_autore INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO}
    )`,

    `CREATE TABLE IF NOT EXISTS carta_clan (
        id SERIAL PRIMARY KEY,
        titolo TEXT NOT NULL,
        anno TEXT,
        percorso TEXT NOT NULL,
        nome_originale TEXT NOT NULL,
        dimensione BIGINT NOT NULL DEFAULT 0,
        corrente SMALLINT NOT NULL DEFAULT 0,
        rif_autore INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO}
    )`,

    // etichette è un elenco JSON: se non lo è, la conversione a jsonb lo rifiuta.
    `CREATE TABLE IF NOT EXISTS evento (
        id SERIAL PRIMARY KEY,
        titolo TEXT NOT NULL,
        descrizione TEXT,
        luogo TEXT,
        data_inizio TEXT NOT NULL,
        data_fine TEXT,
        ora_inizio TEXT,
        ora_fine TEXT,
        etichette TEXT NOT NULL DEFAULT '["gruppo"]' CHECK ((etichette::jsonb) IS NOT NULL),
        in_evidenza SMALLINT NOT NULL DEFAULT 0,
        rif_autore INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO}
    )`,

    `CREATE TABLE IF NOT EXISTS squadriglia (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        foto TEXT,
        attiva SMALLINT NOT NULL DEFAULT 1,
        rif_autore INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO},
        data_chiusura TEXT
    )`,
    // "Falchi" e "falchi" sono la stessa squadriglia.
    `CREATE UNIQUE INDEX IF NOT EXISTS squadriglia_nome_unico ON squadriglia (lower(nome))`,
    // La storia della squadriglia e i suoi gridi (elenco JSON di { titolo, testo }).
    `ALTER TABLE squadriglia ADD COLUMN IF NOT EXISTS storia TEXT`,
    `ALTER TABLE squadriglia ADD COLUMN IF NOT EXISTS gridi TEXT`,

    `CREATE TABLE IF NOT EXISTS guidoncino (
        id SERIAL PRIMARY KEY,
        rif_squadriglia INTEGER NOT NULL REFERENCES squadriglia(id) ON DELETE CASCADE,
        specialita TEXT NOT NULL,
        anno INTEGER NOT NULL,
        confermata SMALLINT NOT NULL DEFAULT 0,
        rif_autore INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO},
        UNIQUE (rif_squadriglia, anno)
    )`,

    `CREATE TABLE IF NOT EXISTS impostazioni (
        chiave TEXT PRIMARY KEY,
        valore TEXT
    )`,

    // I link mandati per email: del link c'è solo l'impronta, l'email è cifrata.
    `CREATE TABLE IF NOT EXISTS link_email (
        id SERIAL PRIMARY KEY,
        rif_utente INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL CHECK (tipo IN ('conferma', 'password', 'cambio-email')),
        impronta TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        scadenza BIGINT NOT NULL,
        usato SMALLINT NOT NULL DEFAULT 0,
        data_creazione BIGINT NOT NULL DEFAULT ${SECONDI}
    )`,

    `CREATE TABLE IF NOT EXISTS notifica_contenuto (
        id SERIAL PRIMARY KEY,
        tipo TEXT NOT NULL CHECK (tipo IN ('posto', 'canto', 'post')),
        azione TEXT NOT NULL CHECK (azione IN ('creato', 'modificato')),
        titolo TEXT NOT NULL,
        rif_oggetto INTEGER,
        rif_autore INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        branca TEXT NOT NULL CHECK (branca IN ${BRANCHE}),
        letta SMALLINT NOT NULL DEFAULT 0,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO}
    )`,

    `CREATE TABLE IF NOT EXISTS post (
        id SERIAL PRIMARY KEY,
        didascalia TEXT NOT NULL,
        testo TEXT,
        colore TEXT NOT NULL,
        foto TEXT NOT NULL,
        rif_autore INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO},
        etichetta TEXT NOT NULL DEFAULT 'gruppo' CHECK (etichetta IN ('branco', 'reparto', 'clan', 'gruppo')),
        in_evidenza SMALLINT NOT NULL DEFAULT 0,
        archiviato SMALLINT NOT NULL DEFAULT 0,
        data_archiviazione TEXT,
        in_attesa SMALLINT NOT NULL DEFAULT 0,
        altre_foto TEXT,
        video_link TEXT
    )`,

    // Gli hashtag del post: elenco JSON, già puliti (minuscoli, senza "#").
    `ALTER TABLE post ADD COLUMN IF NOT EXISTS hashtag TEXT`,

    `CREATE TABLE IF NOT EXISTS post_video (
        id SERIAL PRIMARY KEY,
        rif_post INTEGER NOT NULL REFERENCES post(id) ON DELETE CASCADE,
        percorso TEXT NOT NULL,
        nome_originale TEXT NOT NULL,
        tipo TEXT NOT NULL,
        dimensione BIGINT NOT NULL DEFAULT 0,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO}
    )`,

    // I posti della mappa. contatti (nomi, telefoni, email di custodi e gestori) è cifrato.
    `CREATE TABLE IF NOT EXISTS posto (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        branca TEXT NOT NULL CHECK (branca IN ('branco', 'reparto', 'clan', 'gruppo')),
        latitudine DOUBLE PRECISION NOT NULL,
        longitudine DOUBLE PRECISION NOT NULL,
        indirizzo TEXT,
        descrizione TEXT,
        contatti TEXT NOT NULL DEFAULT '[]',
        rif_autore INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO},
        data_modifica TEXT NOT NULL DEFAULT ${ADESSO},
        sede SMALLINT NOT NULL DEFAULT 0,
        campi TEXT NOT NULL DEFAULT '[]'
    )`,
    // La sede del gruppo è una sola.
    `CREATE UNIQUE INDEX IF NOT EXISTS posto_sede_unica ON posto (sede) WHERE sede = 1`,

    `CREATE TABLE IF NOT EXISTS posto_allegato (
        id SERIAL PRIMARY KEY,
        rif_posto INTEGER NOT NULL REFERENCES posto(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL CHECK (tipo IN ('foto', 'file')),
        nome_originale TEXT NOT NULL,
        percorso TEXT NOT NULL,
        dimensione BIGINT NOT NULL,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO}
    )`,

    // Le richieste di iscrizione: data di nascita, contatti, note e genitori sono cifrati.
    `CREATE TABLE IF NOT EXISTS richiesta_iscrizione (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        cognome TEXT NOT NULL,
        data_nascita TEXT NOT NULL,
        anno_scolastico TEXT NOT NULL,
        branca TEXT NOT NULL CHECK (branca IN ${BRANCHE}),
        telefono TEXT,
        email TEXT,
        note TEXT,
        stato TEXT NOT NULL DEFAULT 'nuova' CHECK (stato IN ('nuova', 'letta', 'archiviata')),
        rif_capo INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO},
        esito TEXT,
        data_archiviazione TEXT,
        genitore1_nome TEXT,
        genitore1_cognome TEXT,
        genitore2_nome TEXT,
        genitore2_cognome TEXT,
        catechismo TEXT,
        indirizzo TEXT
    )`,
    // Anno di catechismo (1-5) se lo frequenta, cifrato come gli altri dati della richiesta;
    // vuoto se non lo frequenta. Per le tabelle nate prima che ci fosse la domanda:
    `ALTER TABLE richiesta_iscrizione ADD COLUMN IF NOT EXISTS catechismo TEXT`,
    // L'indirizzo di casa (cifrato), chiesto dal modulo da ottobre 2026.
    `ALTER TABLE richiesta_iscrizione ADD COLUMN IF NOT EXISTS indirizzo TEXT`,

    // Scheda personale di un ragazzo: la vedono e la cambiano i capi della sua branca e i
    // capigruppo. Tutti i campi sono cifrati (indirizzo, genitori, note sanitarie).
    // rif_richiesta: la richiesta di iscrizione da cui sono arrivati i dati, una volta sola.
    `CREATE TABLE IF NOT EXISTS scheda_ragazzo (
        rif_utente INTEGER PRIMARY KEY REFERENCES utenti(id) ON DELETE CASCADE,
        indirizzo TEXT,
        genitore1_nome TEXT,
        genitore1_cognome TEXT,
        genitore1_telefono TEXT,
        genitore1_email TEXT,
        genitore2_nome TEXT,
        genitore2_cognome TEXT,
        genitore2_telefono TEXT,
        genitore2_email TEXT,
        note_sanitarie TEXT,
        note TEXT,
        rif_richiesta INTEGER,
        data_modifica TEXT,
        rif_modificato_da INTEGER REFERENCES utenti(id) ON DELETE SET NULL
    )`,

    // Note generali (cifrate): ci arrivano anche quelle scritte nella richiesta di iscrizione.
    `ALTER TABLE scheda_ragazzo ADD COLUMN IF NOT EXISTS note TEXT`,

    // PDF allegati alla scheda (es. la scheda medica). Il file sta su disco cifrato, fuori
    // dalle cartelle pubbliche; anche il nome originale è cifrato.
    `CREATE TABLE IF NOT EXISTS scheda_allegato (
        id SERIAL PRIMARY KEY,
        rif_utente INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
        nome_originale TEXT NOT NULL,
        file TEXT NOT NULL UNIQUE,
        dimensione INTEGER NOT NULL,
        data_caricamento TEXT NOT NULL DEFAULT ${ADESSO},
        rif_autore INTEGER REFERENCES utenti(id) ON DELETE SET NULL
    )`,

    `CREATE TABLE IF NOT EXISTS sfondo_home (
        id SERIAL PRIMARY KEY,
        percorso TEXT NOT NULL,
        ordine INTEGER NOT NULL DEFAULT 0,
        rif_autore INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO}
    )`,

    `CREATE TABLE IF NOT EXISTS storia_tappa (
        id SERIAL PRIMARY KEY,
        ordine INTEGER NOT NULL,
        quando TEXT NOT NULL,
        titolo TEXT NOT NULL,
        icona TEXT NOT NULL,
        testo TEXT NOT NULL DEFAULT '',
        nota TEXT,
        adesso SMALLINT NOT NULL DEFAULT 0,
        rif_autore INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        data_modifica TEXT NOT NULL DEFAULT ${ADESSO}
    )`,

    `CREATE TABLE IF NOT EXISTS storia_parte (
        id SERIAL PRIMARY KEY,
        ordine INTEGER NOT NULL,
        titolo TEXT NOT NULL,
        icona TEXT NOT NULL,
        testo TEXT NOT NULL DEFAULT '',
        evidenza TEXT,
        etichette TEXT,
        mostra_branche SMALLINT NOT NULL DEFAULT 0,
        rif_autore INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        data_modifica TEXT NOT NULL DEFAULT ${ADESSO},
        pagina TEXT NOT NULL DEFAULT 'storia'
    )`,

    // Le foto dei fazzolettoni del gruppo, nella striscia della storia.
    `CREATE TABLE IF NOT EXISTS storia_fazzolettone (
        id SERIAL PRIMARY KEY,
        percorso TEXT NOT NULL,
        didascalia TEXT,
        ordine INTEGER NOT NULL DEFAULT 0,
        rif_autore INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
        data_creazione TEXT NOT NULL DEFAULT ${ADESSO}
    )`,
];

/** Le tabelle in un ordine in cui ognuna trova già quelle a cui è collegata. */
const ORDINE_TABELLE = TABELLE.map(sql => sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1]).filter(Boolean);

/** Crea tabelle e indici che mancano. `esegui` manda una query (vedi db.js). */
async function creaSchema(esegui) {
    for (const sql of TABELLE) await esegui(sql);
}

module.exports = { creaSchema, ORDINE_TABELLE, ADESSO, OGGI, SECONDI };
