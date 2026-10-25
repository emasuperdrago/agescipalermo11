// Il database del sito: PostgreSQL. I dati per collegarsi stanno nel file .env
// (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD; DB_SSL=1 se il database è su un altro server).
//
// Al resto del backend questo modulo offre gli stessi tre comandi di sempre (run, get, all,
// con le stesse callback), così le query restano dove sono. In più:
//  - le query si scrivono con "?" e qui diventano $1, $2… come vuole PostgreSQL;
//  - un INSERT restituisce l'id nuovo in this.lastID (gli si aggiunge RETURNING);
//  - i campi cifrati ("cif1:...") tornano già decifrati (vedi cifratura.js);
//  - BEGIN ... COMMIT valgono per tutto quello che c'è in mezzo: la transazione si tiene il
//    suo collegamento (vedi `contesto`);
//  - su Vercel le altre query passano dal "driver serverless" di Neon (vedi `viaWeb`).
const { Pool, types } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const { datiDatabase } = require('./configurazione');
const { creaSchema } = require('./schema');
const { decriptaRiga, sigilloChiave, emailDaSalvare, codiceDaSalvare, improntaCodice, decriptaFile } = require('./cifratura');
const archivio = require('./archivio');

// Numeri grandi (COUNT, SUM, BIGINT) e decimali: come numeri JavaScript, non come testo.
types.setTypeParser(20, (v) => v === null ? null : Number(v));
types.setTypeParser(1700, (v) => v === null ? null : Number(v));

const DATABASE = datiDatabase();
const mancanti = [['host', 'HOST'], ['database', 'NAME'], ['user', 'USER'], ['password', 'PASSWORD']]
  .filter(([campo]) => !DATABASE[campo]).map(([, nome]) => nome);
if (mancanti.length) {
  console.error(`❌ Mancano nel file .env i dati del database PostgreSQL: ${mancanti.join(', ')}`
    + ' (PG_HOST, PG_NAME… sul server; DB_HOST, DB_NAME… sul Mac).');
  process.exit(1);
}

const pool = new Pool({
  ...DATABASE,
  // Qualche collegamento in parallelo: la home chiede 5-6 cose insieme, e con uno solo (quando il
  // database si sta riaccendendo) le ultime aspettavano troppo. Le transazioni (BEGIN…COMMIT)
  // tengono un collegamento tutto per sé, vedi `contesto` qui sotto.
  // (Se il database sta su un altro server, il collegamento va cifrato: PG_SSL=1 / DB_SSL=1.)
  max: 5,
  // Su Vercel il backend viene "congelato" tra una visita e l'altra, mentre Neon chiude i suoi
  // collegamenti quando si spegne: un collegamento tenuto aperto può risvegliarsi già morto e
  // far aspettare la richiesta all'infinito. Lì quindi i collegamenti fermi si chiudono subito,
  // e un'attesa troppo lunga diventa un errore (che per le letture si riprova, vedi interroga).
  ...(process.env.VERCEL ? {
    idleTimeoutMillis: 2000,
    connectionTimeoutMillis: 8000,
    query_timeout: 8000,
    keepAlive: true,
  } : {}),
});
pool.on('error', (err) => console.error('Database: collegamento interrotto, si riprova alla prossima query:', err.code || err.message));
// Su Vercel: prima che la funzione venga "congelata", Vercel aspetta che i collegamenti fermi
// si chiudano (idleTimeoutMillis qui sopra). Così al risveglio non se ne trova mai uno morto.
if (process.env.VERCEL) require('@vercel/functions').attachDatabasePool(pool);

/**
 * Su Vercel le query normali non passano da un collegamento aperto ma dal "driver serverless"
 * di Neon: ogni query è una richiesta web a sé. Così non ci sono collegamenti da tenere vivi,
 * che dopo il congelamento potrebbero essere morti o restare appesi. Le transazioni e la
 * preparazione all'avvio, che hanno bisogno di un collegamento vero, restano sul pool qui sopra.
 */
const viaWeb = process.env.VERCEL && process.env.DATABASE_URL
  ? require('@neondatabase/serverless').neon(process.env.DATABASE_URL, { fullResults: true, types })
  : null;
const ATTESA_WEB_MS = 8000;

/**
 * Ogni richiesta (e la preparazione all'avvio) ha il suo contesto. Quando fa BEGIN, il contesto
 * si tiene un collegamento finché non arrivano COMMIT o ROLLBACK: tutte le query della
 * transazione vanno lì, mentre le altre richieste usano gli altri collegamenti. Il resto del
 * backend non se ne accorge: scrive dbRun('BEGIN') e dbRun('COMMIT') come sempre.
 */
const contesto = new AsyncLocalStorage();

/**
 * Un collegamento dal pool, ma mai uno "vecchio". Su un server acceso i collegamenti fermi si
 * chiudono da soli dopo 2 secondi (idleTimeoutMillis): se uno è fermo da più tempo, il backend
 * è stato congelato nel frattempo (Vercel) e il collegamento, anche se sembra buono, può essere
 * morto. Si butta e se ne prende un altro, prima di mandargli qualsiasi query.
 */
const FERMO_TROPPO_MS = 3000;
async function collegamento() {
  for (let tentativo = 0; tentativo < 8; tentativo++) {
    const client = await pool.connect();
    const fermo = client.ultimoUso ? Date.now() - client.ultimoUso : 0;
    if (!process.env.VERCEL || fermo <= FERMO_TROPPO_MS) return client;
    client.release(true);
  }
  return pool.connect();
}

/** Il collegamento tenuto dal contesto torna nel pool (buttato, se si era rotto). */
function lasciaCollegamento(qui, rotto = false) {
  if (!qui?.client) return;
  qui.client.ultimoUso = Date.now();
  qui.client.release(rotto);
  qui.client = null;
}

/** Fa girare `fn` con un contesto suo: per le richieste HTTP (vedi server.js) e l'avvio. */
function conContesto(fn) {
  return contesto.run({ client: null, fisso: false }, fn);
}

/**
 * Da "?" a $1, $2…, saltando i testi tra apici ('...'), i nomi tra virgolette ("...")
 * e i commenti (-- fino a fine riga), dove un "?" o un apostrofo non vanno toccati.
 */
function segnaposti(sql) {
  let uscita = '';
  let n = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const fine = sql.indexOf(c, i + 1);
      const fino = fine === -1 ? sql.length : fine + 1;
      uscita += sql.slice(i, fino);
      i = fino - 1;
    } else if (c === '-' && sql[i + 1] === '-') {
      const fine = sql.indexOf('\n', i);
      const fino = fine === -1 ? sql.length : fine;
      uscita += sql.slice(i, fino);
      i = fino - 1;
    } else if (c === '?') {
      uscita += '$' + (++n);
    } else {
      uscita += c;
    }
  }
  return uscita;
}

/** I parametri come li vuole PostgreSQL: i sì/no diventano 1 e 0 (le colonne sono numeri). */
function parametriPuliti(parametri) {
  return (parametri ?? []).map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
}

/** La query vera, verso PostgreSQL. Agli INSERT si aggiunge RETURNING, per sapere l'id nuovo. */
/** Errori del collegamento (non della query): il database non ha risposto o ha chiuso. */
function collegamentoCaduto(err) {
  return ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', '57P01', '57P03', '08006', '08003'].includes(err?.code)
    || ['AbortError', 'TimeoutError'].includes(err?.name) || ['AbortError', 'TimeoutError'].includes(err?.cause?.name)
    || /Connection terminated|Query read timeout|timeout exceeded when trying to connect|fetch failed|aborted|timed out/i
      .test(`${err?.message ?? ''} ${err?.cause?.message ?? ''}`);
}

async function interroga(sql, parametri = []) {
  let testo = segnaposti(sql);
  if (/^\s*INSERT\b/i.test(testo) && !/\bRETURNING\b/i.test(testo)) testo += ' RETURNING *';
  const valori = parametriPuliti(parametri);
  try {
    return await sulCollegamento(testo, valori);
  } catch (err) {
    // Una lettura si può rifare senza rischi con un collegamento nuovo; una scrittura no (potrebbe
    // essere già arrivata), quindi l'errore va a chi l'ha chiesta. Dentro una transazione mai.
    if (!collegamentoCaduto(err) || !/^\s*SELECT\b/i.test(testo) || contesto.getStore()?.client) throw err;
    console.error('Database: collegamento caduto, riprovo la lettura:', err.code || err.message);
    return sulCollegamento(testo, valori);
  }
}

/**
 * Una query sul collegamento del pool. Se il collegamento si è rotto (o non risponde più),
 * non torna nel pool: si butta, e la prossima query ne apre uno nuovo. Senza questo, il
 * collegamento bloccato resterebbe lì e anche il nuovo tentativo ci finirebbe sopra.
 */
async function sulCollegamento(testo, valori) {
  const qui = contesto.getStore();
  const comando = testo.trim().split(/\s+/, 1)[0].toUpperCase();
  // Dentro una transazione (o la preparazione): sempre sul collegamento tenuto dal contesto.
  if (qui && !qui.client && comando === 'BEGIN') qui.client = await collegamento();
  if (qui?.client) {
    try {
      const esito = await qui.client.query(testo, valori);
      if ((comando === 'COMMIT' || comando === 'ROLLBACK') && !qui.fisso) lasciaCollegamento(qui);
      return esito;
    } catch (err) {
      if (collegamentoCaduto(err)) lasciaCollegamento(qui, true);
      else if (comando === 'COMMIT' || comando === 'ROLLBACK') { if (!qui.fisso) lasciaCollegamento(qui); }
      throw err;
    }
  }
  // Fuori dalle transazioni, su Vercel: una richiesta web a Neon, con un'attesa massima.
  if (viaWeb && comando !== 'BEGIN') {
    const esito = await viaWeb.query(testo, valori, { fetchOptions: { signal: AbortSignal.timeout(ATTESA_WEB_MS) } });
    // Numeri grandi (COUNT, SUM, BIGINT) e decimali: come numeri, come col collegamento classico.
    const numeriche = (esito.fields ?? []).filter(f => f.dataTypeID === 20 || f.dataTypeID === 1700).map(f => f.name);
    if (numeriche.length) {
      for (const riga of esito.rows)
        for (const nome of numeriche) if (riga[nome] !== null && riga[nome] !== undefined) riga[nome] = Number(riga[nome]);
    }
    return { rows: esito.rows, rowCount: esito.rowCount };
  }
  const client = await collegamento();
  let rotto = false;
  try {
    return await client.query(testo, valori);
  } catch (err) {
    rotto = collegamentoCaduto(err);
    throw err;
  } finally {
    client.ultimoUso = Date.now();
    client.release(rotto);
  }
}

// ---------- Avvio: tabelle, controllo della chiave, dati di partenza ----------

let pronto;

// Su Vercel possono accendersi più copie del backend nello stesso momento: se il database è
// ancora vuoto, creerebbero tabelle e dati di partenza tutte insieme, pestandosi i piedi.
// Con questo "lucchetto" del database si prepara una copia alla volta (le altre aspettano e
// poi trovano tutto già fatto). La preparazione si tiene un collegamento tutto per sé
// (vedi preparaTutto), così il lucchetto resta suo dall'inizio alla fine.
const LUCCHETTO_PREPARAZIONE = 1101983;

// Su Vercel il backend si accende tante volte: la preparazione intera (tabelle, migrazioni,
// dati di partenza) serve solo quando cambia questo file o schema.js. Il segno di quale versione
// è già stata preparata sta nelle impostazioni del database.
const VERSIONE_PREPARAZIONE = crypto.createHash('sha256')
  .update(fs.readFileSync(__filename)).update(fs.readFileSync(path.join(__dirname, 'schema.js')))
  .digest('hex').slice(0, 16);

async function prepara() {
  if (viaWeb) {
    try {
      const fatta = await interroga(`SELECT valore FROM impostazioni WHERE chiave = 'versione_preparata'`);
      if (fatta.rows[0]?.valore === VERSIONE_PREPARAZIONE) return;
    } catch { /* database nuovo o non raggiungibile: si prova la preparazione intera */ }
  }
  await preparaTutto();
  await interroga(`INSERT INTO impostazioni (chiave, valore) VALUES (?, ?)
                   ON CONFLICT (chiave) DO UPDATE SET valore = EXCLUDED.valore`, ['versione_preparata', VERSIONE_PREPARAZIONE]);
}

async function preparaTutto() {
  // Tutta la preparazione su un collegamento solo: il "lucchetto" vale per quel collegamento.
  return conContesto(async () => {
    const qui = contesto.getStore();
    qui.client = await collegamento();
    qui.fisso = true;
    let rotto = false;
    try {
      await interroga('SELECT pg_advisory_lock($1)', [LUCCHETTO_PREPARAZIONE]);
      try {
        await preparaDavvero();
      } finally {
        await interroga('SELECT pg_advisory_unlock($1)', [LUCCHETTO_PREPARAZIONE]).catch(() => {});
      }
    } catch (err) {
      rotto = collegamentoCaduto(err);
      throw err;
    } finally {
      if (qui.client) lasciaCollegamento(qui, rotto);
    }
  });
}

async function preparaDavvero() {
  await creaSchema(sql => interroga(sql));
  await importaSeCiSonoDati();
  await controllaChiave();
  await cifraCodiciCensimento();
  await assicuraAnnoScout();
  await assicuraSede();
  await popolaCanzoniere();
  await popolaSfondi();
  await popolaSquadriglie();
  await popolaStoria();
  await popolaMarco();
  await popolaDatiEsempio();
  await separaCapogruppo();
  await separaAdmin();
}

// Admin e capogruppo diventano due titoli separati: chi finora aveva i permessi (ruolo 'admin')
// tiene il titolo di admin; capogruppo resta com'era. Una volta sola.
async function separaAdmin() {
  if (await impostazione('admin_separato')) return;
  await interroga(`UPDATE utenti SET titolo_admin = 1 WHERE ruolo = 'admin'`);
  await segnaImpostazione('admin_separato');
}

// Prima admin e capogruppo erano la stessa cosa: chi era admin resta segnato come capogruppo.
// Una volta sola, così poi un admin si può togliere da capogruppo.
async function separaCapogruppo() {
  if (await impostazione('capogruppo_separato')) return;
  await interroga(`UPDATE utenti SET capogruppo = 1 WHERE ruolo = 'admin'`);
  await segnaImpostazione('capogruppo_separato');
}

function avvia() {
  const preparazione = prepara()
    .then(() => console.log(`✅ Database pronto (PostgreSQL, ${DATABASE.database})`))
    .catch((err) => {
      console.error('❌ Database non disponibile:', err.code || '', err.message);
      // Su Vercel non si spegne niente: la prossima richiesta riprova a preparare il database.
      if (process.env.VERCEL) {
        pronto = null;
        throw err;
      }
      console.error('   Controlla che PostgreSQL sia acceso e i dati DB_* nel file .env.');
      process.exit(1);
    });
  // L'errore lo riceve chi aspetta il database; qui basta che non resti "non gestito".
  preparazione.catch(() => {});
  pronto = preparazione;
  return preparazione;
}
avvia();

/** Le righe di una query (per i dati di partenza qui sotto). */
async function righe(sql, parametri) {
  return (await interroga(sql, parametri)).rows;
}

/**
 * Sul server, al primo avvio: se nella cartella c'è il file dei dati preparato sul Mac
 * ("npm run server:prepara"), si caricano nel database prima di tutto il resto.
 * Se il file c'è ma non si può usare (chiave sbagliata…) ci si ferma: meglio che partire vuoti.
 */
async function importaSeCiSonoDati() {
  const { importaDati } = require('./importa-dati');
  const esito = await importaDati();
  if (esito.importato) console.log(`📦 Dati del Mac importati: ${esito.righe} righe (preparati il ${esito.creato}).`);
  else if (esito.motivo !== 'nessun file da importare') console.warn(`📦 Dati non importati: ${esito.motivo}.`);
}

/**
 * La prima volta si salva il "sigillo" della chiave; dalle volte dopo si ricontrolla.
 * Se la DB_KEY del .env non è quella con cui sono stati cifrati i dati, ci si ferma qui.
 */
async function controllaChiave() {
  const trovate = await righe(`SELECT valore FROM impostazioni WHERE chiave = 'sigillo_chiave'`);
  if (!trovate.length) {
    await interroga(`INSERT INTO impostazioni (chiave, valore) VALUES ('sigillo_chiave', ?)`, [sigilloChiave()]);
    return;
  }
  if (trovate[0].valore !== sigilloChiave()) {
    console.error('❌ La DB_KEY nel file .env non è quella con cui sono cifrati i dati di questo database.');
    console.error('   Rimetti la DB_KEY giusta (quella che hai salvato) e riavvia.');
    process.exit(1);
  }
}

/**
 * Nei database creati prima che i codici censimento fossero cifrati la colonna è ancora un
 * numero in chiaro: la si trasforma in testo, si cifra ogni codice e gli si mette accanto la
 * sua impronta (che da qui in poi fa da "codice unico"). Tutto o niente: se qualcosa va storto
 * il database resta com'era.
 */
async function cifraCodiciCensimento() {
  const colonna = await righe(`SELECT data_type FROM information_schema.columns
                               WHERE table_schema = current_schema() AND table_name = 'utenti'
                                 AND column_name = 'codice_censimento'`);
  if (!colonna.length || colonna[0].data_type === 'text') return;
  await interroga('BEGIN');
  try {
    await interroga(`ALTER TABLE utenti ADD COLUMN IF NOT EXISTS codice_impronta TEXT`);
    await interroga(`ALTER TABLE utenti DROP CONSTRAINT IF EXISTS utenti_codice_censimento_check,
                                        DROP CONSTRAINT IF EXISTS utenti_codice_censimento_key`);
    await interroga(`ALTER TABLE utenti ALTER COLUMN codice_censimento TYPE TEXT USING codice_censimento::text`);
    const daCifrare = await righe(`SELECT id, codice_censimento FROM utenti WHERE codice_censimento IS NOT NULL`);
    for (const u of daCifrare) {
      const salvato = codiceDaSalvare(u.codice_censimento);
      await interroga(`UPDATE utenti SET codice_censimento = ?, codice_impronta = ? WHERE id = ?`,
        [salvato.codice, salvato.impronta, u.id]);
    }
    await interroga(`ALTER TABLE utenti ADD CONSTRAINT utenti_codice_impronta_key UNIQUE (codice_impronta)`);
    await interroga('COMMIT');
    console.log(`🔒 Codici censimento cifrati: ${daCifrare.length}`);
  } catch (err) {
    await interroga('ROLLBACK');
    throw err;
  }
}

// ---------- I comandi per il resto del backend (come con SQLite) ----------

function parametriECallback(parametri, callback) {
  if (typeof parametri === 'function') return { parametri: [], callback: parametri };
  return { parametri: parametri ?? [], callback };
}

/** Esegue una query aspettando che il database sia pronto (le prime arrivano mentre si prepara). */
function inCoda(sql, parametri) {
  return (pronto ?? avvia()).then(() => interroga(sql, parametri));
}

const db = {
  /** INSERT, UPDATE, DELETE...: nella callback, this.lastID e this.changes come in SQLite. */
  run(sql, parametri, callback) {
    const p = parametriECallback(parametri, callback);
    inCoda(sql, p.parametri).then(
      (esito) => p.callback?.call({ lastID: esito.rows?.[0]?.id ?? 0, changes: esito.rowCount ?? 0 }, null),
      (err) => p.callback?.call({ lastID: 0, changes: 0 }, err),
    );
    return db;
  },
  /** La prima riga (o undefined), già decifrata. */
  get(sql, parametri, callback) {
    const p = parametriECallback(parametri, callback);
    inCoda(sql, p.parametri).then(
      (esito) => p.callback?.(null, esito.rows.length ? decriptaRiga(esito.rows[0]) : undefined),
      (err) => p.callback?.(err),
    );
    return db;
  },
  /** Tutte le righe, già decifrate. */
  all(sql, parametri, callback) {
    const p = parametriECallback(parametri, callback);
    inCoda(sql, p.parametri).then(
      (esito) => p.callback?.(null, esito.rows.map(decriptaRiga)),
      (err) => p.callback?.(err),
    );
    return db;
  },
  /** Per gli script (prove, controlli): le righe in forma di promessa, senza decifrare. */
  interroga: async (sql, parametri) => (await inCoda(sql, parametri)).rows,
  pronto: () => pronto ?? avvia(),
  chiudi: () => pool.end(),
};

// ---------- Dati di partenza (solo se le tabelle sono vuote) ----------

// L'anno scout in corso, così quote e casse hanno sempre un anno a cui attaccarsi.
// Da settembre in poi è "2026/2027", prima è "2025/2026".
async function assicuraAnnoScout() {
  if ((await righe(`SELECT id FROM anno_scout WHERE corrente = 1`)).length) return;
  const oggi = new Date();
  const primo = oggi.getMonth() + 1 >= 9 ? oggi.getFullYear() : oggi.getFullYear() - 1;
  await interroga(`INSERT INTO anno_scout (etichetta) VALUES (?)`, [`${primo}/${primo + 1}`]);
  console.log(`📅 Anno scout ${primo}/${primo + 1} aperto.`);
}

// La sede del gruppo sulla mappa: una sola (lo garantisce l'indice unico).
async function assicuraSede() {
  if ((await righe(`SELECT id FROM posto WHERE sede = 1`)).length) return;
  await interroga(`INSERT INTO posto (nome, branca, latitudine, longitudine, indirizzo, sede)
                   VALUES ('Sede del gruppo', 'gruppo', 38.1157, 13.3615, 'Palermo', 1)`);
  console.log('🏠 Sede del gruppo aggiunta alla mappa: sistemane la posizione da "Modifica"');
}

// I canti del canzoniere del gruppo (dati/canzoniere.json). Se ce n'è già almeno uno non si tocca niente.
async function popolaCanzoniere() {
  const [{ quanti }] = await righe('SELECT COUNT(*) AS quanti FROM canto');
  if (quanti > 0) return;
  let canti;
  try {
    canti = JSON.parse(fs.readFileSync(path.join(__dirname, 'dati', 'canzoniere.json'), 'utf8'));
  } catch (err) {
    return console.error('Canzoniere di partenza non leggibile:', err.message);
  }
  for (const c of canti) await interroga('INSERT INTO canto (titolo, sezione, testo) VALUES (?, ?, ?)', [c.titolo, c.sezione, c.testo]);
  console.log(`🎵 Canzoniere caricato: ${canti.length} canti`);
}

// Le foto di partenza dello sfondo della home, copiate in uploads/sfondi.
async function popolaSfondi() {
  const [{ quante }] = await righe('SELECT COUNT(*) AS quante FROM sfondo_home');
  if (quante > 0) return;
  const origine = path.join(__dirname, 'dati', 'sfondi-iniziali');
  const destinazione = path.join(__dirname, 'uploads', 'sfondi');
  let file;
  try {
    archivio.prepara(destinazione);
    // Le foto possono esserci in chiaro (sul computer) o solo cifrate ("foto.jpg.cif", come
    // arrivano dal repository): si prende ogni foto una volta sola.
    const nomi = fs.readdirSync(origine).map(f => f.replace(/\.cif$/, ''));
    file = [...new Set(nomi)].filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  } catch (err) {
    return console.error('Sfondi di partenza non leggibili:', err.message);
  }
  for (const [i, nome] of file.entries()) {
    try {
      const inChiaro = path.join(origine, nome);
      const dati = fs.existsSync(inChiaro) ? fs.readFileSync(inChiaro) : decriptaFile(fs.readFileSync(inChiaro + '.cif'));
      await archivio.scrivi(destinazione, nome, dati);
      await interroga('INSERT INTO sfondo_home (percorso, ordine) VALUES (?, ?)', [`/uploads/sfondi/${nome}`, i]);
    } catch (err) {
      console.error(`Sfondo ${nome} non copiato:`, err.message);
    }
  }
  if (file.length) console.log(`🖼️  Sfondi della home: ${file.length} foto pronte`);
}

// Le squadriglie di oggi e quelle chiuse negli anni. La foto la mettono poi i capi reparto.
async function popolaSquadriglie() {
  const [{ quante }] = await righe('SELECT COUNT(*) AS quante FROM squadriglia');
  if (quante > 0) return;
  for (const nome of ['Falchi', 'Lupi', 'Cervi', 'Delfini', 'Pantere'])
    await interroga('INSERT INTO squadriglia (nome, attiva) VALUES (?, 1)', [nome]);
  for (const nome of ['Albatros', 'Volpi', 'Canguri', 'Bufali', 'Succiacapre', 'Antilopi', 'Scoiattoli'])
    await interroga('INSERT INTO squadriglia (nome, attiva) VALUES (?, 0)', [nome]);
  console.log("🏕️  Squadriglie caricate: 5 attive e 7 nell'archivio");
}

/** Vero se l'impostazione c'è già (es. "la storia è già stata caricata una volta"). */
async function impostazione(chiave) {
  return (await righe('SELECT valore FROM impostazioni WHERE chiave = ?', [chiave])).length > 0;
}

async function segnaImpostazione(chiave) {
  await interroga(`INSERT INTO impostazioni (chiave, valore) VALUES (?, '1')
                   ON CONFLICT (chiave) DO UPDATE SET valore = EXCLUDED.valore`, [chiave]);
}

// La storia del gruppo com'era scritta prima che i capi potessero cambiarla dal sito.
// Una volta sola: se poi la svuotano, resta vuota.
async function popolaStoria() {
  if (await impostazione('storia_popolata')) return;
  const [{ quante }] = await righe(`SELECT (SELECT COUNT(*) FROM storia_tappa) +
                                   (SELECT COUNT(*) FROM storia_parte WHERE pagina = 'storia') AS quante`);
  if (quante > 0) return segnaImpostazione('storia_popolata');
  const { TAPPE, PARTI } = require('./storia-iniziale');
  for (const [i, t] of TAPPE.entries())
    await interroga(`INSERT INTO storia_tappa (ordine, quando, titolo, icona, testo, nota, adesso) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [i + 1, t.quando, t.titolo, t.icona, t.testo, t.nota ?? null, t.adesso ? 1 : 0]);
  for (const [i, p] of PARTI.entries())
    await interroga(`INSERT INTO storia_parte (ordine, titolo, icona, testo, evidenza, etichette, mostra_branche)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [i + 1, p.titolo, p.icona, p.testo, p.evidenza ?? null, p.etichette ? JSON.stringify(p.etichette) : null,
       p.mostra_branche ? 1 : 0]);
  await segnaImpostazione('storia_popolata');
  console.log('📜 Storia del gruppo caricata');
}

// La pagina di Marco parte con una sola parte da scrivere: la riempiono i capi dal sito.
async function popolaMarco() {
  if (await impostazione('marco_popolata')) return;
  const [{ quante }] = await righe(`SELECT COUNT(*) AS quante FROM storia_parte WHERE pagina = 'marco'`);
  if (quante === 0)
    await interroga(`INSERT INTO storia_parte (pagina, ordine, titolo, icona, testo) VALUES ('marco', 1, ?, 'cuore', ?)`,
      ['Chi era Marco', 'Qui va scritto chi era Marco, "Orso Giocoso", e cosa ha lasciato al gruppo.']);
  await segnaImpostazione('marco_popolata');
}

// Solo in sviluppo: un capogruppo di prova per poter entrare subito.
// Un admin di prova solo per un database nuovo, vuoto (per entrare la prima volta sul Mac):
// se ci sono già utenti non si crea, così una volta tolto non torna.
async function popolaDatiEsempio() {
  if (process.env.NODE_ENV === 'production') return;
  if ((await righe('SELECT id FROM utenti LIMIT 1')).length) return;
  const impronta = await bcrypt.hash('password123', 12);
  const { email, impronta: improntaEmail } = emailDaSalvare(null);
  const codice = codiceDaSalvare(1111111);
  await interroga(`INSERT INTO utenti (codice_censimento, codice_impronta, nome, cognome, password, ruolo,
                                       email, email_impronta, email_confermata)
                   VALUES (?, ?, 'Admin', 'Palermo 11', ?, 'admin', ?, ?, 1)`,
    [codice.codice, codice.impronta, impronta, email, improntaEmail]);
  console.log('👤 Admin di prova creato (codice censimento 1111111, password password123)');
}

module.exports = db;
module.exports.conContesto = conContesto;
module.exports.lasciaCollegamento = () => {
  // A fine richiesta: se una transazione è rimasta aperta (errore senza ROLLBACK), si chiude qui.
  const qui = contesto.getStore();
  if (!qui?.client) return;
  qui.client.query('ROLLBACK').catch(() => {}).finally(() => lasciaCollegamento(qui));
};
module.exports.segnaposti = segnaposti;
