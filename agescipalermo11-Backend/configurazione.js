// Impostazioni che non devono stare nel codice: vivono nel file .env, che non va condiviso
// né messo su GitHub (vedi .gitignore e .env.esempio).
// Alla prima accensione, se manca la chiave con cui si firmano i token, ne crea una a caso
// e la scrive lì: così ogni installazione ha la sua e nessuno può fabbricarsi un accesso
// leggendo il codice del sito.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const percorsoEnv = path.join(__dirname, '.env');

/** Legge il file .env: righe "NOME=valore", commenti con #. */
function leggiEnv() {
    if (!fs.existsSync(percorsoEnv)) return {};
    const valori = {};
    for (const riga of fs.readFileSync(percorsoEnv, 'utf8').split('\n')) {
        const pulita = riga.trim();
        if (!pulita || pulita.startsWith('#')) continue;
        const uguale = pulita.indexOf('=');
        if (uguale < 1) continue;
        const nome = pulita.slice(0, uguale).trim();
        let valore = pulita.slice(uguale + 1).trim();
        const apice = valore[0];
        if ((apice === '"' || apice === "'") && valore.endsWith(apice)) valore = valore.slice(1, -1);
        valori[nome] = valore;
    }
    return valori;
}

// Quello che è già nell'ambiente (es. lanciato con JWT_SECRET=... npm start) vince sul file.
for (const [nome, valore] of Object.entries(leggiEnv()))
    if (process.env[nome] === undefined) process.env[nome] = valore;

const LUNGHEZZA_MINIMA_CHIAVE = 32;

function chiaveDeiToken() {
    const esistente = (process.env.JWT_SECRET || '').trim();
    if (esistente.length >= LUNGHEZZA_MINIMA_CHIAVE) return esistente;
    if (esistente) {
        console.error(`❌ JWT_SECRET è troppo corta: servono almeno ${LUNGHEZZA_MINIMA_CHIAVE} caratteri.`);
        console.error(`   Cambiala nel file ${percorsoEnv} e riavvia.`);
        process.exit(1);
    }

    const nuova = crypto.randomBytes(48).toString('base64url');
    const aCapo = fs.existsSync(percorsoEnv) && fs.readFileSync(percorsoEnv, 'utf8').endsWith('\n') ? '' : '\n';
    try {
        fs.appendFileSync(percorsoEnv,
            `${aCapo}# Chiave con cui si firmano i token di accesso: non condividerla e non cambiarla\n` +
            `# senza motivo (cambiarla fa uscire tutti e obbliga a rifare l'accesso).\n` +
            `JWT_SECRET=${nuova}\n`, { mode: 0o600 });
        fs.chmodSync(percorsoEnv, 0o600);
    } catch (err) {
        console.error('❌ Manca JWT_SECRET e non riesco a scrivere il file .env:', err.message);
        console.error('   Crealo a mano con dentro: JWT_SECRET=<almeno 32 caratteri a caso>');
        process.exit(1);
    }
    console.log('🔑 Chiave dei token creata in .env: chi era già dentro dovrà rifare l\'accesso.');
    process.env.JWT_SECRET = nuova;
    return nuova;
}

/**
 * La chiave con cui è cifrato il database (SQLCipher): 32 byte a caso, scritti in esadecimale.
 * Senza di lei il file database.sqlite è illeggibile, per chiunque: se si perde il .env
 * si perdono i dati. Va tenuta anche da un'altra parte sicura (per esempio un gestore di password).
 */
function chiaveDelDatabase() {
    const esistente = (process.env.DB_KEY || '').trim();
    if (/^[0-9a-f]{64}$/i.test(esistente)) return esistente.toLowerCase();
    if (esistente) {
        console.error('❌ DB_KEY nel file .env non è valida: servono 64 caratteri esadecimali.');
        process.exit(1);
    }
    // Se il database c'è già ed è cifrato, una chiave nuova non lo aprirebbe: meglio fermarsi.
    const percorsoDb = path.join(__dirname, 'database.sqlite');
    if (fs.existsSync(percorsoDb) && !fs.readFileSync(percorsoDb).subarray(0, 16).toString('latin1').startsWith('SQLite format 3')) {
        console.error('❌ Il database è cifrato ma nel file .env manca DB_KEY: senza quella chiave non si apre.');
        console.error('   Rimetti nel .env la riga DB_KEY=... che avevi salvato.');
        process.exit(1);
    }
    // Online i dati arrivano già cifrati con la chiave del Mac: una chiave nuova inventata qui
    // li renderebbe illeggibili. Sul server la DB_KEY si mette sempre a mano.
    if (process.env.NODE_ENV === 'production') {
        console.error('❌ Manca DB_KEY: sul server va messa a mano nel file .env (la stessa del Mac).');
        process.exit(1);
    }

    const nuova = crypto.randomBytes(32).toString('hex');
    try {
        fs.appendFileSync(percorsoEnv,
            `\n# Chiave che cifra il database. SE LA PERDI, PERDI TUTTI I DATI: salvane una copia\n` +
            `# in un posto sicuro (gestore di password), e non condividerla con nessuno.\n` +
            `DB_KEY=${nuova}\n`, { mode: 0o600 });
        fs.chmodSync(percorsoEnv, 0o600);
    } catch (err) {
        console.error('❌ Manca DB_KEY e non riesco a scrivere il file .env:', err.message);
        process.exit(1);
    }
    console.log('🔐 Chiave del database creata in .env: salvane una copia in un posto sicuro.');
    process.env.DB_KEY = nuova;
    return nuova;
}

/**
 * Il collegamento al database PostgreSQL. Si leggono prima PG_HOST, PG_PORT, PG_NAME, PG_USER,
 * PG_PASSWORD (PG_SSL): il pannello dell'hosting mette nella app le sue variabili DB_* per un
 * database MySQL, che il backend non usa e che altrimenti prenderebbero il posto delle nostre.
 * Se le PG_* mancano valgono le DB_* (come sul Mac).
 */
function datiDatabase() {
    const e = process.env;
    const usaPg = !!(e.PG_HOST || e.PG_NAME || e.PG_USER);
    const v = (nome) => usaPg ? e[`PG_${nome}`] : e[`DB_${nome}`];
    return {
        host: v('HOST'),
        port: Number(v('PORT')) || 5432,
        user: v('USER'),
        password: v('PASSWORD'),
        database: v('NAME'),
        ...(v('SSL') === '1' ? { ssl: { rejectUnauthorized: true } } : {}),
    };
}

module.exports = {
    JWT_SECRET: chiaveDeiToken(),
    DB_KEY: chiaveDelDatabase(),
    percorsoEnv,
    datiDatabase,
};
