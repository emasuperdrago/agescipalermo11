// Cifratura dei dati personali dentro il database (codici censimento, email, telefoni, date di
// nascita, contatti, note e genitori delle richieste di iscrizione). Il database PostgreSQL sta sul server
// dell'hosting: chi riuscisse a leggerlo vedrebbe solo "cif1:..." al posto di questi campi.
//
// Si parte da DB_KEY (la chiave del .env, la stessa da tenere al sicuro) e se ne ricavano due:
//  - una per cifrare (AES-256-GCM: ogni valore ha il suo vettore casuale e un sigillo che
//    rivela se qualcuno l'ha modificato);
//  - una per le impronte delle email (HMAC-SHA256): servono a cercare un'email e a tenerla
//    unica senza doverla decifrare. Da un'impronta non si torna all'email;
//  - una per le impronte dei codici censimento, che fanno lo stesso lavoro per i codici.
const crypto = require('crypto');
const { DB_KEY } = require('./configurazione');

const PREFISSO = 'cif1:';
const chiaveMadre = Buffer.from(DB_KEY, 'hex');
const ricava = (scopo) => Buffer.from(crypto.hkdfSync('sha256', chiaveMadre, Buffer.alloc(0), `palermo11:${scopo}`, 32));
const CHIAVE_CIFRA = ricava('cifra-campi');
const CHIAVE_IMPRONTE = ricava('impronte-email');
const CHIAVE_CODICI = ricava('impronte-codici');
const CHIAVE_FILE = ricava('file-cifrati');

/** Cifra un testo; null e stringhe vuote restano come sono (non c'è niente da proteggere). */
function cripta(valore) {
    if (valore === null || valore === undefined || valore === '') return valore ?? null;
    const testo = String(valore);
    if (testo.startsWith(PREFISSO)) return testo;
    const iv = crypto.randomBytes(12);
    const cifrario = crypto.createCipheriv('aes-256-gcm', CHIAVE_CIFRA, iv);
    const dati = Buffer.concat([cifrario.update(testo, 'utf8'), cifrario.final()]);
    return PREFISSO + Buffer.concat([iv, cifrario.getAuthTag(), dati]).toString('base64');
}

/** Decifra un valore scritto da cripta(); quello che non è cifrato torna così com'è. */
function decripta(valore) {
    if (typeof valore !== 'string' || !valore.startsWith(PREFISSO)) return valore;
    const tutto = Buffer.from(valore.slice(PREFISSO.length), 'base64');
    const decifrario = crypto.createDecipheriv('aes-256-gcm', CHIAVE_CIFRA, tutto.subarray(0, 12));
    decifrario.setAuthTag(tutto.subarray(12, 28));
    return Buffer.concat([decifrario.update(tutto.subarray(28)), decifrario.final()]).toString('utf8');
}

/** L'impronta di un'email (minuscola, senza spazi): uguale per la stessa email, illeggibile. */
function improntaEmail(email) {
    if (!email) return null;
    return crypto.createHmac('sha256', CHIAVE_IMPRONTE).update(String(email).trim().toLowerCase()).digest('hex');
}

/** Email da salvare: cifrata e con la sua impronta (vanno sempre scritte insieme). */
function emailDaSalvare(email) {
    const pulita = email ? String(email).trim().toLowerCase() : null;
    return { email: cripta(pulita), impronta: improntaEmail(pulita) };
}

/** L'impronta di un codice censimento: serve a cercarlo e a tenerlo unico senza decifrarlo. */
function improntaCodice(codice) {
    if (codice === null || codice === undefined || codice === '') return null;
    return crypto.createHmac('sha256', CHIAVE_CODICI).update(String(Number(codice))).digest('hex');
}

/** Codice censimento da salvare: cifrato e con la sua impronta (vanno sempre scritti insieme). */
function codiceDaSalvare(codice) {
    if (codice === null || codice === undefined || codice === '') return { codice: null, impronta: null };
    return { codice: cripta(String(Number(codice))), impronta: improntaCodice(codice) };
}

/** Decifra tutti i campi cifrati di una riga letta dal database. */
function decriptaRiga(riga) {
    if (!riga || typeof riga !== 'object') return riga;
    for (const chiave of Object.keys(riga)) {
        const valore = riga[chiave];
        if (typeof valore === 'string' && valore.startsWith(PREFISSO)) riga[chiave] = decripta(valore);
    }
    // Il codice censimento nel database è testo cifrato: al resto del server torna come numero.
    if (typeof riga.codice_censimento === 'string' && /^\d+$/.test(riga.codice_censimento))
        riga.codice_censimento = Number(riga.codice_censimento);
    return riga;
}

/**
 * File interi cifrati (es. le foto con i ragazzi che stanno nel repository pubblico):
 * "P11F1" + vettore casuale + sigillo + dati. Senza la DB_KEY sono byte illeggibili.
 */
const INTESTAZIONE_FILE = Buffer.from('P11F1');
function criptaFile(dati) {
    const iv = crypto.randomBytes(12);
    const cifrario = crypto.createCipheriv('aes-256-gcm', CHIAVE_FILE, iv);
    const cifrati = Buffer.concat([cifrario.update(dati), cifrario.final()]);
    return Buffer.concat([INTESTAZIONE_FILE, iv, cifrario.getAuthTag(), cifrati]);
}
function decriptaFile(contenuto) {
    if (!contenuto.subarray(0, INTESTAZIONE_FILE.length).equals(INTESTAZIONE_FILE))
        throw new Error('non è un file cifrato del sito');
    const inizio = INTESTAZIONE_FILE.length;
    const decifrario = crypto.createDecipheriv('aes-256-gcm', CHIAVE_FILE, contenuto.subarray(inizio, inizio + 12));
    decifrario.setAuthTag(contenuto.subarray(inizio + 12, inizio + 28));
    return Buffer.concat([decifrario.update(contenuto.subarray(inizio + 28)), decifrario.final()]);
}

/**
 * Un testo noto cifrato con la chiave: si salva la prima volta e si ricontrolla a ogni avvio.
 * Se la DB_KEY del .env non è quella giusta, il server si ferma invece di scrivere dati che
 * poi nessuno potrebbe più leggere.
 */
const TESTO_DI_PROVA = 'palermo11-la-chiave-e-giusta';
function sigilloChiave() {
    return crypto.createHmac('sha256', CHIAVE_IMPRONTE).update(TESTO_DI_PROVA).digest('hex');
}

module.exports = { cripta, decripta, improntaEmail, emailDaSalvare, improntaCodice, codiceDaSalvare,
                   decriptaRiga, sigilloChiave, criptaFile, decriptaFile, PREFISSO };
