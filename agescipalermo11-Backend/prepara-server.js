// Prepara sul Mac la cartella "per-il-server/" con quello che va caricato sull'hosting a mano
// (con Cyberduck) e che non sta nel repository:
//  - .env                      le chiavi del sito (le stesse di qui) e le impostazioni online;
//  - dati-palermo11.json.cif   tutti i dati del database, cifrati con la DB_KEY.
// Le foto caricate (cartella uploads/) e i PDF delle schede dei ragazzi (documenti-riservati/,
// già cifrati) si copiano a parte, così come sono.
//
// Uso:  npm run server:prepara        (a backend acceso o spento, non cambia niente qui)
//
// La cartella è esclusa da Git e contiene le chiavi: non va mandata a nessuno.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { datiDatabase } = require('./configurazione');
const { criptaFile, improntaCodice, sigilloChiave } = require('./cifratura');
const { ORDINE_TABELLE } = require('./schema');

const CARTELLA = path.join(__dirname, 'per-il-server');
// Dove sarà il sito online (i link nelle email) e chi può parlare col backend.
const SITO_ONLINE = 'https://newsite.palermo11.it';
// Anche il dominio vero: il giorno che palermo11.it passa a questa app basta cambiare SITO_URL.
const ORIGINI_ONLINE = ['https://newsite.palermo11.it', 'https://www.newsite.palermo11.it',
    'https://palermo11.it', 'https://www.palermo11.it'];
// Link per email già scaduti o da usare una volta sola: online non servono.
const TABELLE_SALTATE = new Set(['link_email']);
// L'admin di prova (codice 1111111) ha ancora la password di prova, che sta scritta nel codice
// pubblico: online gli si toglie, e la si sceglie di nuovo con "Primo accesso".
const CODICE_DI_PROVA = 1111111;

async function esportaDati() {
    const client = new Client(datiDatabase());
    await client.connect();
    const tabelle = {};
    let righe = 0;
    try {
        for (const tabella of ORDINE_TABELLE) {
            if (TABELLE_SALTATE.has(tabella)) continue;
            // Riga per riga, così come sono nel database: i campi cifrati ("cif1:…") restano cifrati.
            const esito = await client.query({ text: `SELECT * FROM ${tabella}`, rowMode: 'array' });
            const colonne = esito.fields.map(f => f.name);
            const id = colonne.indexOf('id');
            if (id >= 0) esito.rows.sort((a, b) => Number(a[id]) - Number(b[id]));
            tabelle[tabella] = { colonne, righe: esito.rows };
            righe += esito.rows.length;
        }
    } finally {
        await client.end();
    }

    // Admin di prova: niente password e niente sessioni aperte.
    const utenti = tabelle.utenti;
    const colonna = (nome) => utenti.colonne.indexOf(nome);
    let adminDiProva = 0;
    for (const riga of utenti.righe) {
        if (riga[colonna('codice_impronta')] !== improntaCodice(CODICE_DI_PROVA)) continue;
        riga[colonna('password')] = null;
        riga[colonna('sessioni_valide_da')] = null;
        adminDiProva++;
    }
    return { tabelle, righe, adminDiProva };
}

/** I dati del database già scritti a mano in un .env preparato prima: rifacendo il pacchetto restano. */
function databaseGiaScritto(fileEnv) {
    const scritti = {};
    try {
        for (const riga of fs.readFileSync(fileEnv, 'utf8').split('\n')) {
            const [, nome, valore] = riga.match(/^(PG_(?:NAME|USER|PASSWORD))=(.*)$/) ?? [];
            if (nome && valore && !valore.startsWith('SCRIVI_QUI')) scritti[nome] = valore;
        }
    } catch { /* primo pacchetto: niente da tenere */ }
    return scritti;
}

/** Il .env del server: le chiavi di qui (devono essere le stesse) e le impostazioni online. */
function envDelServer(gia = {}) {
    const e = process.env;
    const riga = (nome, valore) => `${nome}=${valore ?? ''}`;
    return [
        '# .env del backend sull\'hosting. Preparato da "npm run server:prepara": NON va su GitHub',
        '# e non va mandato a nessuno. Va caricato nella cartella agescipalermo11-Backend del server.',
        '',
        '# Online: niente admin di prova, solo gli indirizzi qui sotto, HTTPS obbligatorio.',
        riga('NODE_ENV', 'production'),
        '# L\'HTTPS lo fa l\'hosting davanti al backend (il certificato è nel pannello).',
        riga('DIETRO_PROXY', '1'),
        riga('ALLOWED_ORIGINS', ORIGINI_ONLINE.join(',')),
        riga('SITO_URL', SITO_ONLINE),
        '',
        '# Le stesse chiavi del Mac: con chiavi diverse i dati cifrati non si leggerebbero più.',
        riga('JWT_SECRET', e.JWT_SECRET),
        riga('DB_KEY', e.DB_KEY),
        '',
        '# Database PostgreSQL dell\'hosting: nome, utente e password li scrivi tu (dal pannello',
        '# del tuo amico; la password è quella NUOVA, non quella vecchia finita in una chat).',
        '# Non stanno nel codice perché il repository è pubblico. Si chiamano PG_* e non DB_*:',
        '# le DB_* il pannello le usa per un database MySQL che al backend non serve.',
        riga('PG_HOST', 'localhost'),
        riga('PG_PORT', '5432'),
        riga('PG_NAME', gia.PG_NAME ?? 'SCRIVI_QUI_IL_NOME_DEL_DATABASE'),
        riga('PG_USER', gia.PG_USER ?? 'SCRIVI_QUI_L_UTENTE_DEL_DATABASE'),
        riga('PG_PASSWORD', gia.PG_PASSWORD ?? 'SCRIVI_QUI_LA_PASSWORD_DEL_DATABASE'),
        '',
        '# Email: per ora lo stesso Gmail del Mac; più avanti la casella del dominio.',
        riga('SMTP_HOST', e.SMTP_HOST),
        riga('SMTP_PORT', e.SMTP_PORT),
        riga('SMTP_UTENTE', e.SMTP_UTENTE),
        riga('SMTP_PASSWORD', e.SMTP_PASSWORD),
        `MAIL_MITTENTE="${String(e.MAIL_MITTENTE || '').replace(/"/g, '')}"`,
        '',
    ].join('\n');
}

(async () => {
    fs.mkdirSync(CARTELLA, { recursive: true, mode: 0o700 });

    const { tabelle, righe, adminDiProva } = await esportaDati();
    const pacchetto = { versione: 1, creato: new Date().toISOString(), sigillo: sigilloChiave(), tabelle };
    const fileDati = path.join(CARTELLA, 'dati-palermo11.json.cif');
    fs.writeFileSync(fileDati, criptaFile(Buffer.from(JSON.stringify(pacchetto))), { mode: 0o600 });

    const fileEnv = path.join(CARTELLA, '.env');
    fs.writeFileSync(fileEnv, envDelServer(databaseGiaScritto(fileEnv)), { mode: 0o600 });
    fs.chmodSync(fileEnv, 0o600);

    console.log(`📦 Dati: ${Object.keys(tabelle).length} tabelle, ${righe} righe → per-il-server/dati-palermo11.json.cif (cifrato)`);
    for (const [nome, t] of Object.entries(tabelle)) console.log(`   ${nome}: ${t.righe.length}`);
    if (adminDiProva) console.log(`🔑 Admin di prova (${CODICE_DI_PROVA}): password tolta, online si rifà con "Primo accesso".`);
    console.log('🔐 .env del server → per-il-server/.env (scrivici nome, utente e password del database prima di caricarlo)');
})().catch(err => {
    console.error('❌ Preparazione non riuscita:', err.message);
    process.exit(1);
});
