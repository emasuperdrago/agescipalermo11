// Il database del sito: PostgreSQL. I dati per collegarsi stanno nel file .env
// (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD; DB_SSL=1 se il database è su un altro server).
//
// Al resto del backend questo modulo offre gli stessi tre comandi di sempre (run, get, all,
// con le stesse callback), così le query restano dove sono. In più:
//  - le query si scrivono con "?" e qui diventano $1, $2… come vuole PostgreSQL;
//  - un INSERT restituisce l'id nuovo in this.lastID (gli si aggiunge RETURNING);
//  - i campi cifrati ("cif1:...") tornano già decifrati (vedi cifratura.js);
//  - si usa un solo collegamento alla volta: le query vanno in fila e BEGIN ... COMMIT
//    valgono per tutto quello che c'è in mezzo.
const { Pool, types } = require('pg');
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
  // Un collegamento solo: le query aspettano in fila, come con SQLite.
  // (Se il database sta su un altro server, il collegamento va cifrato: PG_SSL=1 / DB_SSL=1.)
  max: 1,
});
pool.on('error', (err) => console.error('Database: collegamento interrotto, si riprova alla prossima query:', err.code || err.message));

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
async function interroga(sql, parametri = []) {
  let testo = segnaposti(sql);
  if (/^\s*INSERT\b/i.test(testo) && !/\bRETURNING\b/i.test(testo)) testo += ' RETURNING *';
  return pool.query(testo, parametriPuliti(parametri));
}

// ---------- Avvio: tabelle, controllo della chiave, dati di partenza ----------

let pronto;

async function prepara() {
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
}

pronto = prepara()
  .then(() => console.log(`✅ Database pronto (PostgreSQL, ${DATABASE.database})`))
  .catch((err) => {
    console.error('❌ Database non disponibile:', err.code || '', err.message);
    console.error('   Controlla che PostgreSQL sia acceso e i dati DB_* nel file .env.');
    process.exit(1);
  });

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
  return pronto.then(() => interroga(sql, parametri));
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
  pronto: () => pronto,
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
async function popolaDatiEsempio() {
  if (process.env.NODE_ENV === 'production') return;
  if ((await righe('SELECT id FROM utenti WHERE codice_impronta = ?', [improntaCodice(1111111)])).length) return;
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
module.exports.segnaposti = segnaposti;
