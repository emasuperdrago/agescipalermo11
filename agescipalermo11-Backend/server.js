// Tutto quello che il server crea (database, foto, scontrini, Carte di Clan, .env) nasce
// leggibile solo dal proprietario del computer: nessun altro utente della macchina lo apre.
process.umask(0o077);

// Va letta per prima: mette nell'ambiente quello che sta nel file .env.
const configurazione = require('./configurazione');

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const os = require('os');
const fs = require('fs');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
// Dati personali cifrati nel database: vedi cifratura.js.
const {
    cripta, improntaEmail, emailDaSalvare, improntaCodice, codiceDaSalvare, criptaFile, decriptaFile,
} = require('./cifratura');
const { creaXlsx } = require('./excel');
const {
    postaPronta, controllaPosta, inviaEmail, descriviErrore, ATTESE_SOTTOFONDO, emailDiConferma, emailRecuperoPassword, emailNuovaRichiesta,
    emailCambioEmail, emailEmailCambiata,
} = require('./posta');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
// La chiave dei token sta solo nel file .env, mai nel codice: vedi configurazione.js.
const SECRET_KEY = configurazione.JWT_SECRET;

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}
const HOST = process.env.HOST || getLocalIP();

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:8100').split(',');
// HTTPS diretto: con HTTPS_KEY e HTTPS_CERT nel .env (percorsi del certificato).
const HTTPS_ACCESO = !!(process.env.HTTPS_KEY && process.env.HTTPS_CERT);

/**
 * Chi può parlare col backend. Online vale solo la lista di ALLOWED_ORIGINS.
 * Mentre si lavora in locale vanno bene anche 127.0.0.1 e gli indirizzi della rete di casa,
 * così il sito funziona sia aperto sul computer sia provato dal telefono.
 */
function origineAmmessa(origine, risposta) {
    // Senza Origin (curl, app native) non c'è niente da controllare.
    if (!origine || ALLOWED_ORIGINS.includes(origine)) return risposta(null, true);
    if (process.env.NODE_ENV !== 'production') {
        try {
            const host = new URL(origine).hostname;
            const questoComputer = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
            // Gli altri dispositivi di casa (il telefono) solo se il server parla HTTPS:
            // in chiaro il backend non si fa nemmeno raggiungere dalla rete (vedi in fondo).
            const inCasa = /^10\./.test(host) || /^192\.168\./.test(host)
                || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
            if (questoComputer || (inCasa && HTTPS_ACCESO)) return risposta(null, true);
        } catch {
            // Origin scritto male: si tratta come non ammesso.
        }
    }
    risposta(null, false);
}
app.use(cors({ origin: origineAmmessa }));

// Dietro un proxy (es. Nginx o il servizio di hosting) l'indirizzo di chi chiama e il fatto
// che la connessione sia protetta arrivano nelle intestazioni: senza questo Express non li legge.
const DIETRO_PROXY = process.env.DIETRO_PROXY === '1';
if (DIETRO_PROXY) app.set('trust proxy', 1);

/**
 * La richiesta è arrivata in HTTPS (direttamente o passando da un proxy che lo fa per noi)?
 * req.secure guarda X-Forwarded-Proto solo se c'è un proxy dichiarato (trust proxy): senza,
 * chiunque potrebbe scriversi quell'intestazione da solo e fingere una connessione protetta.
 */
function connessioneProtetta(req) {
    return req.secure;
}

// Intestazioni di sicurezza di base, più HSTS quando si viaggia in HTTPS
// (dice al browser di non riprovare mai in chiaro su questo indirizzo).
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (connessioneProtetta(req))
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Con FORZA_HTTPS=1 chi arriva in chiaro viene rimandato all'indirizzo protetto.
if (process.env.FORZA_HTTPS === '1') {
    app.use((req, res, next) => {
        if (connessioneProtetta(req)) return next();
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!host) return res.status(400).json({ error: 'Richiesta senza host.' });
        res.redirect(308, `https://${host}${req.originalUrl}`);
    });
}
// Quanto può essere grande una richiesta. Di base poco (100 KB bastano per tutti i testi),
// così nessuno può intasare il server mandando file enormi a caso. Il limite grande vale solo
// dove arrivano davvero delle foto (in base64: una foto da 5 MB ne pesa quasi 7) o il file
// dei censiti. I file veri (allegati della mappa, Carta di Clan) hanno il loro limite nella rotta.
const ROTTE_CON_FOTO = ['/api/post', '/api/utenti/me', '/api/sfondi', '/api/squadriglie', '/api/cassa'];
// Un post può avere fino a MAX_FOTO_POST foto, già rimpicciolite nel browser: serve più spazio.
app.use('/api/post', express.json({ limit: '30mb' }));
app.use(ROTTE_CON_FOTO, express.json({ limit: '10mb' }));
app.use('/api/utenti/importa', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '100kb' }));
// Nessuna pagina manda moduli classici: basta poco, e senza l'analisi "estesa" (che usa qs).
app.use(express.urlencoded({ limit: '20kb', extended: false }));
// Chi sta chiamando, riletto dal database a ogni richiesta (vedi caricaUtente).
app.use((req, res, next) => caricaUtente(req, res, next));

// Ruoli assegnabili con l'import da Excel. 'admin' (capo gruppo) si assegna solo dal database.
const RUOLI_IMPORTABILI = ['ragazzo', 'capo'];
const BRANCHE = ['branco', 'reparto', 'clan'];
const MAX_RIGHE_IMPORT = 2000;

// Post: le foto stanno in uploads/post e sono pubbliche come i post.
const CARTELLA_FOTO_POST = path.join(__dirname, 'uploads', 'post');
// I video corti dei post: pubblici come le foto dei post.
const CARTELLA_VIDEO_POST = path.join(__dirname, 'uploads', 'post-video');
fs.mkdirSync(CARTELLA_VIDEO_POST, { recursive: true });
const CARTELLA_FOTO_PROFILI = path.join(__dirname, 'uploads', 'profili');
// Foto degli scontrini di cassa: sono conti del gruppo, quindi stanno dietro al link firmato.
const CARTELLA_SCONTRINI = path.join(__dirname, 'uploads', 'scontrini');
// Foto che scorrono nello sfondo della home: sono pubbliche come la home stessa.
const CARTELLA_SFONDI = path.join(__dirname, 'uploads', 'sfondi');
fs.mkdirSync(CARTELLA_FOTO_POST, { recursive: true });
fs.mkdirSync(CARTELLA_FOTO_PROFILI, { recursive: true });
fs.mkdirSync(CARTELLA_SCONTRINI, { recursive: true });
fs.mkdirSync(CARTELLA_SFONDI, { recursive: true });
const MAX_NOME = 60;
// ---------- File riservati: si aprono solo con un link firmato ----------

// Le foto dei post sono pubbliche come la home. Le foto profilo e gli allegati della mappa no:
// contengono persone e contatti, e la mappa è già chiusa ai visitatori. Siccome un <img> non può
// mandare il token, il server mette la firma dentro al link quando lo scrive nelle sue risposte:
// il link vale un giorno, come la sessione, e senza firma il file non si apre.
const DURATA_LINK_FILE = 24 * 60 * 60 * 1000;

function firmaPercorso(percorso, scade) {
    return crypto.createHmac('sha256', SECRET_KEY)
        .update(`${percorso}|${scade}`).digest('base64url').slice(0, 32);
}

/** Il percorso con la firma attaccata, pronto da mandare al sito. */
function linkFirmato(percorso) {
    const scade = Date.now() + DURATA_LINK_FILE;
    return `${percorso}?scade=${scade}&firma=${firmaPercorso(percorso, scade)}`;
}

function firmaValida(percorso, scade, firma) {
    const quando = Number(scade);
    if (!Number.isFinite(quando) || quando < Date.now()) return false;
    const attesa = Buffer.from(firmaPercorso(percorso, String(quando)));
    const ricevuta = Buffer.from(String(firma ?? ''));
    // Confronto a tempo costante: non fa capire quanto ci si è avvicinati alla firma giusta.
    return attesa.length === ricevuta.length && crypto.timingSafeEqual(attesa, ricevuta);
}

function soloConFirma(req, res, next) {
    if (!firmaValida(req.baseUrl + req.path, req.query.scade, req.query.firma))
        return res.status(403).json({ error: "Link scaduto o non valido: riapri la pagina." });
    next();
}

app.use('/uploads/profili', soloConFirma);
app.use('/uploads/posti', soloConFirma);
app.use('/uploads/scontrini', soloConFirma);
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '7d' }));

// Stessa lista di src/app/services/post.ts: colori scuri abbastanza per la scritta bianca.
const COLORI_POST = ['#E36F3C', '#0B87A8', '#3E8E48', '#7D57C2', '#C8372D', '#B07A00'];
const MAX_FOTO_BYTE = 5 * 1024 * 1024;
const MAX_DIDASCALIA = 160;
const MAX_TESTO_POST = 20000;
const ETICHETTE_POST = ['branco', 'reparto', 'clan', 'gruppo'];
// Gli eventi hanno in più "capi": riunioni della comunità capi, visibili solo a capi e admin.
const ETICHETTE_EVENTO = [...ETICHETTE_POST, 'capi'];

// Etichette di un evento, già in ordine: una o più branche; tutte e tre diventano "gruppo".
// "gruppo" e "capi" stanno da sole. Restituisce { errore } oppure { etichette }.
function normalizzaEtichetteEvento(valore) {
    // Accetta anche il vecchio formato con una sola etichetta.
    const scelte = Array.isArray(valore) ? valore.map(String) : (valore ? [String(valore)] : []);
    if (!scelte.length) return { errore: "Scegli almeno un'etichetta." };
    if (scelte.some(e => !ETICHETTE_EVENTO.includes(e)))
        return { errore: "Etichette valide: branco, reparto, clan, gruppo o capi." };
    const uniche = new Set(scelte);
    if (uniche.has('capi')) {
        if (uniche.size > 1) return { errore: "Gli eventi dei capi non si possono unire ad altre etichette." };
        return { etichette: ['capi'] };
    }
    if (uniche.has('gruppo') || BRANCHE.every(b => uniche.has(b))) return { etichette: ['gruppo'] };
    return { etichette: BRANCHE.filter(b => uniche.has(b)) };
}
const RUOLI_CAPI = ['capo', 'admin'];
const POST_PER_PAGINA = 12;

// Il tipo dichiarato nel data URL non basta: si controllano i primi byte del file.
const FORMATI_FOTO = [
    { estensione: 'jpg', riconosci: b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
    { estensione: 'png', riconosci: b => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47])) },
    { estensione: 'webp', riconosci: b => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

/**
 * Errore imprevisto: il dettaglio (messaggio del database, percorsi, ...) va solo nel log
 * del server. Al sito arriva un messaggio generico, che non racconta com'è fatto dentro.
 */
function erroreInterno(res, err) {
    // PostgreSQL rifiuta un numero scritto male (es. /api/post/abc) o troppo grande:
    // è un errore di chi chiede, non del server.
    if ((err?.code === '22P02' || err?.code === '22003') && !res.headersSent)
        return res.status(400).json({ error: "Richiesta non valida." });
    console.error(`[${new Date().toISOString()}] Errore interno:`, err?.stack || err);
    if (res.headersSent) return;
    return res.status(500).json({ error: "Qualcosa è andato storto sul server. Riprova tra poco." });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) { err ? reject(err) : resolve(this); });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => { err ? reject(err) : resolve(row); });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => { err ? reject(err) : resolve(rows); });
    });
}

/**
 * Chi sta facendo la richiesta, letto dal database e non dal token. Il token dice solo
 * "sono l'utente 41": ruolo ed esistenza si ricontrollano ogni volta, così chi viene tolto
 * dal gruppo o perde un ruolo lo perde subito, non dopo 24 ore. E un token rilasciato prima
 * dell'ultima uscita dal sito (sessioni_valide_da) non vale più.
 * Il risultato sta in req.utenteCorrente: null se non c'è un accesso valido.
 */
async function caricaUtente(req, res, next) {
    req.utenteCorrente = null;
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return next();
    req.conToken = true;
    let dati;
    try {
        dati = jwt.verify(token, SECRET_KEY, { algorithms: ['HS256'] });
    } catch {
        return next();
    }
    // Il visitatore non è nel database: il suo token vale per quello che dice.
    if (dati?.ruolo === 'visitatore' && !dati.id) {
        req.utenteCorrente = { ruolo: 'visitatore' };
        return next();
    }
    if (!dati?.id) return next();
    try {
        const utente = await dbGet(
            'SELECT id, codice_censimento, ruolo, sessioni_valide_da FROM utenti WHERE id = ?', [dati.id]);
        if (!utente) return next();
        if (utente.sessioni_valide_da && (dati.iat ?? 0) < utente.sessioni_valide_da) return next();
        req.utenteCorrente = { id: utente.id, codice_censimento: utente.codice_censimento, ruolo: utente.ruolo };
    } catch (err) {
        console.error('Controllo della sessione:', err.message);
    }
    next();
}

function verificaToken(req, res, next) {
    if (!req.conToken) return res.status(401).json({ error: "Accesso negato. Token mancante." });
    // 401 e non 403: è la sessione a non valere più (scaduta, uscita dal sito, utente tolto),
    // e il sito lo capisce e riporta all'accesso. Il 403 resta per i permessi che mancano.
    if (!req.utenteCorrente) return res.status(401).json({ error: "Sessione scaduta: rifai l'accesso." });
    req.user = req.utenteCorrente;
    next();
}

function verificaRuolo(...ruoli) {
    return (req, res, next) => verificaToken(req, res, () => {
        if (!ruoli.includes(req.user.ruolo))
            return res.status(403).json({ error: "Non hai i permessi per questa operazione." });
        next();
    });
}

/** Chi fa la richiesta, se ha un accesso valido; altrimenti null (senza bloccare). Vedi caricaUtente. */
function utenteDaToken(req) {
    return req.utenteCorrente?.id ? req.utenteCorrente : null;
}

/** Ruolo di chi fa la richiesta, preso dal database; null se non ha un accesso valido. */
function ruoloDaToken(req) {
    return req.utenteCorrente?.ruolo ?? null;
}

function firmaToken(payload) {
    return jwt.sign(payload, SECRET_KEY, { expiresIn: '24h' });
}

function tokenUtente(utente) {
    return firmaToken({ id: utente.id, codice_censimento: utente.codice_censimento, ruolo: utente.ruolo });
}

// Il codice censimento è numerico: accetta sia 123456 sia "123456".
function leggiCodiceCensimento(valore) {
    const testo = String(valore ?? '').trim();
    if (!/^\d{1,10}$/.test(testo) || Number(testo) <= 0) return null;
    return Number(testo);
}

// null se assente, undefined se presente ma non valida.
function leggiEta(valore) {
    if (valore === null || valore === undefined || valore === '') return null;
    const eta = Number(valore);
    return Number.isInteger(eta) && eta >= 0 && eta <= 120 ? eta : undefined;
}

// Riceve "data:image/...;base64,..." e restituisce i byte della foto, o null se non è valida.
function leggiFoto(dataUrl) {
    const m = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return null;
    const dati = Buffer.from(m[1], 'base64');
    if (dati.length < 12 || dati.length > MAX_FOTO_BYTE) return null;
    const formato = FORMATI_FOTO.find(f => f.riconosci(dati));
    return formato ? { dati, estensione: formato.estensione } : null;
}

// Foto di uno scontrino: passa dal browser già rimpicciolita, qui si controlla che sia
// davvero un'immagine e che non superi il limite.
const MAX_SCONTRINO_BYTE = 3 * 1024 * 1024;
function leggiScontrino(dataUrl) {
    const m = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return null;
    const dati = Buffer.from(m[1], 'base64');
    if (dati.length < 12 || dati.length > MAX_SCONTRINO_BYTE) return null;
    const formato = FORMATI_FOTO.find(f => f.riconosci(dati));
    return formato ? { dati, estensione: formato.estensione } : null;
}

function salvaScontrino(scontrino) {
    const nomeFile = `${crypto.randomUUID()}.${scontrino.estensione}`;
    fs.writeFileSync(path.join(CARTELLA_SCONTRINI, nomeFile), scontrino.dati);
    return `/uploads/scontrini/${nomeFile}`;
}

/** Tutte le foto di un post, dalla copertina in poi. */
function fotoDelPost(p) {
    let altre = [];
    try { altre = p.altre_foto ? JSON.parse(p.altre_foto) : []; } catch { altre = []; }
    return [p.foto, ...altre.filter(f => typeof f === 'string')].filter(Boolean);
}

function postPubblico(p) {
    return {
        id: p.id,
        archiviato: p.archiviato === 1,
        // In attesa che un capo clan o un capogruppo lo approvi.
        in_attesa: p.in_attesa === 1,
        autore: p.autore_nome ? `${p.autore_nome} ${p.autore_cognome}` : null,
        didascalia: p.didascalia,
        testo: p.testo,
        colore: p.colore,
        // La copertina (quella della home) e, in foto_urls, tutte le foto dalla copertina in poi.
        foto_url: p.foto,
        foto_urls: fotoDelPost(p),
        video_link: linkVideoDelPost(p),
        // I video caricati arrivano a parte (vedi inviaPost e il dettaglio): qui c'è solo quanti sono.
        video: p.video ?? [],
        etichetta: p.etichetta,
        in_evidenza: p.in_evidenza === 1,
        data_creazione: p.data_creazione
    };
}

/** Testo pulito dagli spazi ai bordi; con `max` viene anche accorciato. */
function testo(valore, max) {
    const pulito = typeof valore === 'string' ? valore.trim() : '';
    return max ? pulito.slice(0, max) : pulito;
}

/**
 * Età di oggi: se c'è la data di nascita si calcola ogni volta (così al compleanno cresce da sola),
 * altrimenti resta quella caricata a mano. Conti sul giorno locale, come nel resto del sito.
 */
function etaDaNascita(dataNascita) {
    if (typeof dataNascita !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dataNascita)) return null;
    const [anno, mese, giorno] = dataNascita.split('-').map(Number);
    const oggi = new Date();
    let eta = oggi.getFullYear() - anno;
    const mesi = (oggi.getMonth() + 1) - mese;
    if (mesi < 0 || (mesi === 0 && oggi.getDate() < giorno)) eta--;
    return eta >= 0 && eta <= 120 ? eta : null;
}

/** L'età da mostrare: quella calcolata dalla data di nascita, se c'è. */
function etaDiOggi(u) {
    const calcolata = etaDaNascita(u.data_nascita);
    return calcolata === null ? (u.eta ?? null) : calcolata;
}

function utentePubblico(u) {
    return {
        id: u.id,
        codice_censimento: u.codice_censimento,
        nome: u.nome,
        cognome: u.cognome,
        eta: etaDiOggi(u),
        data_nascita: u.data_nascita || null,
        email: u.email,
        telefono: u.telefono,
        ruolo: u.ruolo,
        branca: u.branca,
        // Link firmato: la foto profilo non è aperta a chiunque (vedi soloConFirma).
        foto_url: u.foto ? linkFirmato(u.foto) : null,
        data_registrazione: u.data_registrazione
    };
}


app.get('/', (req, res) => {
    res.send('🚀 Backend agescipalermo11 attivo');
});

// ---------- Limite ai tentativi di accesso ----------

// Senza un limite si possono provare migliaia di password una dopo l'altra finché non si indovina.
// Si contano i tentativi andati male degli ultimi 15 minuti, sia per codice censimento
// (così non si può martellare un singolo account) sia per indirizzo di chi chiama
// (così non si possono provare tanti codici diversi). Quando si entra, il conto si azzera.
const FINESTRA_TENTATIVI = 15 * 60 * 1000;
const MAX_TENTATIVI_CODICE = 5;
const MAX_TENTATIVI_INDIRIZZO = 30;
const tentativiFalliti = new Map();

function chiaviTentativo(req, codice) {
    const chiavi = [`ip:${req.ip || 'sconosciuto'}`];
    if (codice) chiavi.push(`codice:${codice}`);
    return chiavi;
}

function recenti(chiave, adesso) {
    return (tentativiFalliti.get(chiave) || []).filter(t => adesso - t < FINESTRA_TENTATIVI);
}

/** Millisecondi da aspettare prima di poter riprovare; 0 se la strada è libera. */
function attesaPrimaDiRiprovare(req, codice) {
    const adesso = Date.now();
    let attesa = 0;
    for (const chiave of chiaviTentativo(req, codice)) {
        const massimo = chiave.startsWith('codice:') ? MAX_TENTATIVI_CODICE : MAX_TENTATIVI_INDIRIZZO;
        const prove = recenti(chiave, adesso);
        if (prove.length) tentativiFalliti.set(chiave, prove); else tentativiFalliti.delete(chiave);
        // Si riapre quando il più vecchio dei tentativi esce dalla finestra dei 15 minuti.
        if (prove.length >= massimo) attesa = Math.max(attesa, FINESTRA_TENTATIVI - (adesso - prove[0]));
    }
    return attesa;
}

function segnaTentativoFallito(req, codice) {
    const adesso = Date.now();
    for (const chiave of chiaviTentativo(req, codice)) {
        const prove = recenti(chiave, adesso);
        prove.push(adesso);
        tentativiFalliti.set(chiave, prove);
    }
    // Ogni tanto si buttano via i conti vecchi, così la mappa non cresce all'infinito.
    if (tentativiFalliti.size > 2000)
        for (const [chiave, prove] of tentativiFalliti)
            if (!prove.some(t => adesso - t < FINESTRA_TENTATIVI)) tentativiFalliti.delete(chiave);
}

function azzeraTentativi(req, codice) {
    for (const chiave of chiaviTentativo(req, codice)) tentativiFalliti.delete(chiave);
}

/** Risposta unica per chi ha esagerato: dice anche quanto manca. */
function rispostaTroppiTentativi(res, attesa) {
    const minuti = Math.max(1, Math.ceil(attesa / 60000));
    res.setHeader('Retry-After', Math.ceil(attesa / 1000));
    return res.status(429).json({
        error: `Troppi tentativi sbagliati: riprova tra ${minuti} ${minuti === 1 ? 'minuto' : 'minuti'}.`,
    });
}

// Hash finto (di una password a caso che nessuno conosce): quando il codice non esiste si
// confronta lo stesso, così rispondere "codice sconosciuto" costa quanto rispondere
// "password sbagliata" e dai tempi non si capisce quali codici censimento esistono.
const HASH_FINTO = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);

app.post('/api/login', (req, res) => {
    const body = req.body || {};
    const codice = leggiCodiceCensimento(body.codice_censimento);
    const { password } = body;
    if (!codice || typeof password !== 'string' || !password)
        return res.status(400).json({ error: "Codice censimento e password sono obbligatori." });

    const attesa = attesaPrimaDiRiprovare(req, codice);
    if (attesa) return rispostaTroppiTentativi(res, attesa);

    db.get('SELECT * FROM utenti WHERE codice_impronta = ?', [improntaCodice(codice)], async (err, utente) => {
        if (err) return erroreInterno(res, err);
        if (utente && !utente.password)
            return res.status(403).json({ error: "Non ti sei ancora registrato: fai il primo accesso.", motivo: 'primo-accesso' });
        // Il confronto si fa sempre, anche se il codice non esiste: vedi HASH_FINTO.
        const passwordGiusta = await bcrypt.compare(password, utente?.password || HASH_FINTO);
        if (!utente || !passwordGiusta) {
            segnaTentativoFallito(req, codice);
            return res.status(401).json({ error: "Codice censimento o password non corretti." });
        }

        azzeraTentativi(req, codice);
        // Password giusta ma email mai confermata: si entra solo dopo aver aperto il link.
        if (utente.email_confermata !== 1)
            return res.status(403).json({
                error: `Prima conferma la tua email: apri il link che ti abbiamo mandato a ${emailMascherata(utente.email)}.`,
                motivo: 'email-da-confermare',
            });
        res.json({ message: "Accesso eseguito!", token: tokenUtente(utente), utente: utentePubblico(utente) });
    });
});

// ---------- Conferma dell'email ----------

// L'indirizzo del sito a cui puntano i link nelle email (in locale: quello di ionic serve).
const SITO_URL = (process.env.SITO_URL || 'http://localhost:8101').replace(/\/+$/, '');
const ORE_LINK_CONFERMA = 24;
/** Fra un'email di conferma e l'altra allo stesso utente: niente raffiche. */
const SECONDI_FRA_EMAIL = 60;

function improntaLink(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Crea un link di conferma nuovo (quelli di prima smettono di valere) e manda l'email.
 * Torna true se l'email è partita. Senza posta impostata, fuori dalla produzione, il link
 * si scrive nel terminale del backend così si può provare lo stesso.
 */
async function mandaConferma(utente, email) {
    const token = crypto.randomBytes(32).toString('base64url');
    const scadenza = Math.floor(Date.now() / 1000) + ORE_LINK_CONFERMA * 3600;
    await dbRun(`UPDATE link_email SET usato = 1 WHERE rif_utente = ? AND tipo = 'conferma' AND usato = 0`, [utente.id]);
    await dbRun(`INSERT INTO link_email (rif_utente, tipo, impronta, email, scadenza) VALUES (?, 'conferma', ?, ?, ?)`,
        [utente.id, improntaLink(token), cripta(email), scadenza]);
    const link = `${SITO_URL}/conferma-email?token=${token}`;
    if (!postaPronta) {
        if (process.env.NODE_ENV === 'production') throw new Error('POSTA_NON_IMPOSTATA');
        console.warn(`✉️  (prova, posta non impostata) link di conferma per ${utente.nome}: ${link}`);
        return false;
    }
    await inviaEmail({ a: email, ...emailDiConferma({ nome: utente.nome, link, ore: ORE_LINK_CONFERMA }) });
    return true;
}

/** Nasconde una parte dell'indirizzo, per dire dove è andata l'email senza mostrarlo tutto. */
function emailMascherata(email) {
    const [nome, dominio] = String(email).split('@');
    if (!dominio) return '';
    return `${nome.slice(0, 2)}${'•'.repeat(Math.max(1, nome.length - 2))}@${dominio}`;
}

// Chi è stato caricato dai capi si registra qui: al suo codice censimento si legano l'email
// e la password che sceglie, poi deve aprire il link arrivato per email per attivare l'account.
// La password non si salva mai così com'è: se ne salva solo l'impronta bcrypt, da cui non si
// torna indietro. L'email sta nel database cifrata, come il codice censimento (vedi cifratura.js).
// Se il codice è di un capo con l'email del censimento, deve essere quella: così chi conosce
// solo il codice di un capo non può prendersi il suo account.
// Finché l'email non è confermata ci si può registrare di nuovo (per esempio se era sbagliata).
app.post('/api/primo-accesso', (req, res) => {
    const body = req.body || {};
    const codice = leggiCodiceCensimento(body.codice_censimento);
    const email = leggiEmailImport(body.email);
    const { password } = body;
    if (!codice) return res.status(400).json({ error: "Il codice censimento deve contenere solo cifre." });
    if (!email) return res.status(400).json({ error: "Scrivi un indirizzo email valido." });
    if (typeof password !== 'string' || password.length < 8)
        return res.status(400).json({ error: "La password deve essere di almeno 8 caratteri." });
    if (password.length > 72)
        return res.status(400).json({ error: "La password può avere al massimo 72 caratteri." });

    // Stesso limite dell'accesso: qui non si indovina una password, ma senza limite si
    // potrebbe provare un codice dopo l'altro per scoprire quali esistono.
    const attesaPrimo = attesaPrimaDiRiprovare(req, codice);
    if (attesaPrimo) return rispostaTroppiTentativi(res, attesaPrimo);

    db.get('SELECT * FROM utenti WHERE codice_impronta = ?', [improntaCodice(codice)], async (err, utente) => {
        if (err) return erroreInterno(res, err);
        if (!utente) {
            segnaTentativoFallito(req, codice);
            return res.status(404).json({ error: "Codice censimento non trovato. Chiedi ai tuoi capi di caricarlo." });
        }
        if (utente.password && utente.email_confermata === 1)
            return res.status(409).json({ error: "Ti sei già registrato: accedi normalmente." });
        const eCapo = utente.ruolo === 'capo' || utente.ruolo === 'admin';
        // Per un capo l'email giusta è sempre quella del censimento (anche rifacendo la
        // registrazione): un tentativo non confermato non può spostarla altrove.
        if (eCapo && utente.email && utente.email.toLowerCase() !== email) {
            segnaTentativoFallito(req, codice);
            return res.status(403).json({
                error: "Per i capi serve l'email del censimento. Se è cambiata, chiedi ai capigruppo di aggiornarla.",
            });
        }

        try {
            const giaUsata = await dbGet('SELECT id FROM utenti WHERE email_impronta = ? AND id <> ?', [improntaEmail(email), utente.id]);
            if (giaUsata) {
                segnaTentativoFallito(req, codice);
                return res.status(409).json({ error: "Questa email è già usata da un altro account: scegline un'altra." });
            }
            const hashedPassword = await bcrypt.hash(password, 12);
            // Passa solo se nel frattempo nessuno ha confermato questo account.
            const nuova = emailDaSalvare(email);
            const esito = await dbRun(`UPDATE utenti SET password = ?, email = ?, email_impronta = ?, email_confermata = 0
                                       WHERE id = ? AND (password IS NULL OR email_confermata = 0)`,
                [hashedPassword, nuova.email, nuova.impronta, utente.id]);
            if (esito.changes === 0)
                return res.status(409).json({ error: "Ti sei già registrato: accedi normalmente." });
            azzeraTentativi(req, codice);
            let inviata;
            try {
                inviata = await mandaConferma(utente, email);
            } catch (errPosta) {
                console.error('❌ Email di conferma non partita:', descriviErrore(errPosta));
                return res.status(502).json({
                    error: "Registrazione salvata, ma l'email di conferma non è partita. Riprova tra poco con «Rimanda l'email».",
                    motivo: 'email-da-confermare',
                });
            }
            res.status(202).json({
                message: inviata
                    ? `Ti abbiamo mandato un'email a ${emailMascherata(email)}: apri il link per attivare l'account.`
                    : "Registrazione salvata. Le email non sono ancora impostate: il link di conferma è nel terminale del backend.",
                daConfermare: true,
            });
        } catch (error) {
            if (error?.code === '23505')
                return res.status(409).json({ error: "Questa email è già usata da un altro account: scegline un'altra." });
            erroreInterno(res, error);
        }
    });
});

// Rimanda l'email di conferma. Servono codice e password, così nessuno può riempire di
// email la casella di un altro conoscendo solo il suo codice.
app.post('/api/conferma-email/reinvia', (req, res) => {
    const body = req.body || {};
    const codice = leggiCodiceCensimento(body.codice_censimento);
    const { password } = body;
    if (!codice || typeof password !== 'string' || !password)
        return res.status(400).json({ error: "Servono codice censimento e password." });
    const attesa = attesaPrimaDiRiprovare(req, codice);
    if (attesa) return rispostaTroppiTentativi(res, attesa);

    db.get('SELECT * FROM utenti WHERE codice_impronta = ?', [improntaCodice(codice)], async (err, utente) => {
        if (err) return erroreInterno(res, err);
        const passwordGiusta = await bcrypt.compare(password, utente?.password || HASH_FINTO);
        if (!utente || !utente.password || !passwordGiusta) {
            segnaTentativoFallito(req, codice);
            return res.status(401).json({ error: "Codice censimento o password non corretti." });
        }
        if (utente.email_confermata === 1)
            return res.status(409).json({ error: "La tua email è già confermata: accedi normalmente." });
        try {
            const ultimo = await dbGet(`SELECT MAX(data_creazione) AS quando FROM link_email
                                        WHERE rif_utente = ? AND tipo = 'conferma'`, [utente.id]);
            const passati = Math.floor(Date.now() / 1000) - (ultimo?.quando ?? 0);
            if (passati < SECONDI_FRA_EMAIL)
                return res.status(429).json({ error: `Aspetta ${SECONDI_FRA_EMAIL - passati} secondi prima di chiederne un'altra.` });
            const inviata = await mandaConferma(utente, utente.email);
            res.json({
                message: inviata
                    ? `Email rimandata a ${emailMascherata(utente.email)}.`
                    : 'Le email non sono ancora impostate: il nuovo link è nel terminale del backend.',
            });
        } catch (errPosta) {
            console.error('❌ Email di conferma non partita:', descriviErrore(errPosta));
            res.status(502).json({ error: "L'email non è partita. Riprova tra poco." });
        }
    });
});

// Il link dell'email: conferma l'indirizzo e fa entrare direttamente.
app.post('/api/conferma-email', async (req, res) => {
    const token = String(req.body?.token ?? '');
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token))
        return res.status(400).json({ error: "Il link non è valido. Copialo per intero dall'email." });
    const attesa = attesaPrimaDiRiprovare(req, null);
    if (attesa) return rispostaTroppiTentativi(res, attesa);
    try {
        const adesso = Math.floor(Date.now() / 1000);
        const link = await dbGet(`SELECT * FROM link_email WHERE impronta = ? AND tipo = 'conferma'`, [improntaLink(token)]);
        const utente = link ? await dbGet('SELECT * FROM utenti WHERE id = ?', [link.rif_utente]) : null;
        if (!link || !utente) {
            segnaTentativoFallito(req, null);
            return res.status(404).json({ error: "Questo link non è valido. Rifai la registrazione o chiedi un'altra email." });
        }
        if (utente.email_confermata === 1 && link.usato === 1)
            return res.status(409).json({ error: "Email già confermata: accedi normalmente.", motivo: 'gia-confermata' });
        // Scaduto, già usato, sostituito da uno più nuovo o per un'email che nel frattempo è cambiata.
        if (link.usato === 1 || link.scadenza < adesso || String(link.email).toLowerCase() !== String(utente.email).toLowerCase())
            return res.status(410).json({ error: "Questo link è scaduto. Accedi con codice e password per farti mandare un'altra email." });

        await dbRun('UPDATE link_email SET usato = 1 WHERE id = ?', [link.id]);
        await dbRun('UPDATE utenti SET email_confermata = 1 WHERE id = ?', [utente.id]);
        const aggiornato = await dbGet('SELECT * FROM utenti WHERE id = ?', [utente.id]);
        res.json({ message: "Email confermata!", token: tokenUtente(aggiornato), utente: utentePubblico(aggiornato) });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// ---------- Recupero della password ----------

const MINUTI_LINK_PASSWORD = 60;

// Chi ha dimenticato la password scrive la sua email e riceve un link per sceglierne una nuova.
// La risposta è sempre la stessa, che l'email esista o no: così da qui non si scopre chi è
// registrato. Vale solo per chi ha già confermato l'email (l'indirizzo è sicuramente suo).
app.post('/api/password-dimenticata', async (req, res) => {
    const email = leggiEmailImport(req.body?.email);
    if (!email) return res.status(400).json({ error: "Scrivi un indirizzo email valido." });
    // Ogni richiesta conta come un tentativo: niente raffiche, né per email né da uno stesso indirizzo.
    const chiave = `email:${email}`;
    const attesa = attesaPrimaDiRiprovare(req, chiave);
    if (attesa) return rispostaTroppiTentativi(res, attesa);
    segnaTentativoFallito(req, chiave);

    const risposta = {
        message: "Se c'è un account confermato con questa email, ti abbiamo mandato un link per scegliere una nuova password. Guarda anche nello spam.",
    };
    try {
        const utente = await dbGet(`SELECT * FROM utenti WHERE email_impronta = ? AND password IS NOT NULL
                                    AND email_confermata = 1`, [improntaEmail(email)]);
        if (!utente) return res.json(risposta);
        const ultimo = await dbGet(`SELECT MAX(data_creazione) AS quando FROM link_email
                                    WHERE rif_utente = ? AND tipo = 'password'`, [utente.id]);
        // Un link ogni minuto al massimo: la risposta non cambia, così non si capisce niente.
        if (Math.floor(Date.now() / 1000) - (ultimo?.quando ?? 0) < SECONDI_FRA_EMAIL) return res.json(risposta);

        const token = crypto.randomBytes(32).toString('base64url');
        const scadenza = Math.floor(Date.now() / 1000) + MINUTI_LINK_PASSWORD * 60;
        await dbRun(`UPDATE link_email SET usato = 1 WHERE rif_utente = ? AND tipo = 'password' AND usato = 0`, [utente.id]);
        await dbRun(`INSERT INTO link_email (rif_utente, tipo, impronta, email, scadenza) VALUES (?, 'password', ?, ?, ?)`,
            [utente.id, improntaLink(token), cripta(utente.email), scadenza]);
        const link = `${SITO_URL}/nuova-password?token=${token}`;
        if (!postaPronta) {
            if (process.env.NODE_ENV === 'production') throw new Error('POSTA_NON_IMPOSTATA');
            console.warn(`✉️  (prova, posta non impostata) link per la nuova password di ${utente.nome}: ${link}`);
        } else {
            await inviaEmail({ a: utente.email, ...emailRecuperoPassword({ nome: utente.nome, link, minuti: MINUTI_LINK_PASSWORD }) });
        }
        res.json(risposta);
    } catch (err) {
        console.error('❌ Email per la nuova password non partita:', descriviErrore(err));
        res.status(502).json({ error: "L'email non è partita. Riprova tra poco." });
    }
});

// Il link dell'email: si sceglie la password nuova. Tutte le sessioni aperte prima (su
// qualunque dispositivo) smettono di valere, e si entra con quella nuova.
app.post('/api/password-dimenticata/nuova', async (req, res) => {
    const token = String(req.body?.token ?? '');
    const { password } = req.body || {};
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token))
        return res.status(400).json({ error: "Il link non è valido. Copialo per intero dall'email." });
    if (typeof password !== 'string' || password.length < 8)
        return res.status(400).json({ error: "La password deve essere di almeno 8 caratteri." });
    if (password.length > 72)
        return res.status(400).json({ error: "La password può avere al massimo 72 caratteri." });
    const attesa = attesaPrimaDiRiprovare(req, null);
    if (attesa) return rispostaTroppiTentativi(res, attesa);
    try {
        const adesso = Math.floor(Date.now() / 1000);
        const link = await dbGet(`SELECT * FROM link_email WHERE impronta = ? AND tipo = 'password'`, [improntaLink(token)]);
        const utente = link ? await dbGet('SELECT * FROM utenti WHERE id = ?', [link.rif_utente]) : null;
        if (!link || !utente) {
            segnaTentativoFallito(req, null);
            return res.status(404).json({ error: "Questo link non è valido. Chiedine un altro da «Password dimenticata»." });
        }
        if (link.usato === 1 || link.scadenza < adesso || String(link.email).toLowerCase() !== String(utente.email).toLowerCase())
            return res.status(410).json({ error: "Questo link è scaduto o è già stato usato. Chiedine un altro da «Password dimenticata»." });

        const impronta = await bcrypt.hash(password, 12);
        // Il link si brucia per primo: se due richieste arrivano insieme, passa solo una.
        const bruciato = await dbRun('UPDATE link_email SET usato = 1 WHERE id = ? AND usato = 0', [link.id]);
        if (bruciato.changes === 0)
            return res.status(410).json({ error: "Questo link è già stato usato. Chiedine un altro da «Password dimenticata»." });
        await dbRun(`UPDATE utenti SET password = ?, sessioni_valide_da = extract(epoch from now())::bigint
                     WHERE id = ?`, [impronta, utente.id]);
        await dbRun(`UPDATE link_email SET usato = 1 WHERE rif_utente = ? AND tipo = 'password'`, [utente.id]);
        azzeraTentativi(req, utente.codice_censimento);
        const aggiornato = await dbGet('SELECT * FROM utenti WHERE id = ?', [utente.id]);
        res.json({ message: "Password cambiata!", token: tokenUtente(aggiornato), utente: utentePubblico(aggiornato) });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// Uscita dal sito: tutti i token di questo utente rilasciati finora smettono di valere,
// su qualunque dispositivo. Chi rientra riceve un token nuovo.
app.post('/api/logout', verificaUtenteCensito, async (req, res) => {
    try {
        await dbRun(`UPDATE utenti SET sessioni_valide_da = extract(epoch from now())::bigint WHERE id = ?`,
            [req.user.id]);
        res.json({ message: "Sei uscito." });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.post('/api/login/visitatore', (req, res) => {
    const token = firmaToken({ ruolo: 'visitatore' });
    res.json({ message: "Accesso come visitatore.", token, utente: { ruolo: 'visitatore' } });
});


// ---------- Profilo personale ----------

function verificaUtenteCensito(req, res, next) {
    verificaToken(req, res, () => {
        if (req.user.ruolo === 'visitatore' || !req.user.id)
            return res.status(403).json({ error: "I visitatori non hanno un profilo." });
        next();
    });
}

app.get('/api/utenti/me', verificaUtenteCensito, (req, res) => {
    db.get('SELECT * FROM utenti WHERE id = ?', [req.user.id], (err, utente) => {
        if (err) return erroreInterno(res, err);
        if (!utente) return res.status(404).json({ error: "Utente non trovato." });
        res.json({ utente: utentePubblico(utente) });
    });
});

// Modifica di nome, cognome e foto profilo. foto: data URL per aggiungerla o cambiarla;
// rimuovi_foto: true per toglierla; se nessuno dei due, la foto resta com'è.
app.put('/api/utenti/me', verificaUtenteCensito, (req, res) => {
    const body = req.body || {};
    const nome = testo(body.nome);
    const cognome = testo(body.cognome);
    if (!nome || !cognome) return res.status(400).json({ error: "Nome e cognome sono obbligatori." });
    if (nome.length > MAX_NOME || cognome.length > MAX_NOME)
        return res.status(400).json({ error: `Nome e cognome possono avere al massimo ${MAX_NOME} caratteri.` });

    let fotoNuova = null;
    if (body.foto !== undefined && body.foto !== null && body.foto !== '') {
        fotoNuova = leggiFoto(body.foto);
        if (!fotoNuova) return res.status(400).json({ error: "Carica una foto JPG, PNG o WebP di massimo 5 MB." });
    }
    const rimuoviFoto = body.rimuovi_foto === true;

    db.get('SELECT * FROM utenti WHERE id = ?', [req.user.id], (err, utente) => {
        if (err) return erroreInterno(res, err);
        if (!utente) return res.status(404).json({ error: "Utente non trovato." });

        const salva = (percorsoFoto) => {
            db.run('UPDATE utenti SET nome = ?, cognome = ?, foto = ? WHERE id = ?',
                [nome, cognome, percorsoFoto, utente.id], (runErr) => {
                    if (runErr) {
                        if (percorsoFoto && percorsoFoto !== utente.foto) eliminaFile(CARTELLA_FOTO_PROFILI, percorsoFoto);
                        return erroreInterno(res, runErr);
                    }
                    // La foto precedente non serve più se è stata sostituita o tolta.
                    if (utente.foto && utente.foto !== percorsoFoto) eliminaFile(CARTELLA_FOTO_PROFILI, utente.foto);
                    db.get('SELECT * FROM utenti WHERE id = ?', [utente.id], (getErr, aggiornato) => {
                        if (getErr || !aggiornato) return res.status(500).json({ error: "Profilo salvato ma non riletto." });
                        res.json({ utente: utentePubblico(aggiornato) });
                    });
                });
        };

        if (!fotoNuova) return salva(rimuoviFoto ? null : utente.foto);
        const nomeFile = `${crypto.randomUUID()}.${fotoNuova.estensione}`;
        fs.writeFile(path.join(CARTELLA_FOTO_PROFILI, nomeFile), fotoNuova.dati, (scriviErr) => {
            if (scriviErr) return res.status(500).json({ error: "Impossibile salvare la foto." });
            salva(`/uploads/profili/${nomeFile}`);
        });
    });
});

// ---------- Cambio dell'email dal profilo ----------

// Per cambiare email serve la password attuale (se qualcuno trova il telefono sbloccato non
// può spostare l'account su una sua casella). L'email nuova vale solo dopo aver aperto il link
// arrivato lì; quando cambia, la casella di prima riceve un avviso.
app.post('/api/utenti/me/email', verificaUtenteCensito, async (req, res) => {
    try {
        const utente = await dbGet('SELECT * FROM utenti WHERE id = ?', [req.user.id]);
        if (!utente) return res.status(404).json({ error: "Utente non trovato." });
        const email = leggiEmailImport(req.body?.email);
        const { password } = req.body || {};
        if (!email) return res.status(400).json({ error: "Scrivi un indirizzo email valido." });
        if (typeof password !== 'string' || !password)
            return res.status(400).json({ error: "Per sicurezza serve la tua password attuale." });
        const attesa = attesaPrimaDiRiprovare(req, utente.codice_censimento);
        if (attesa) return rispostaTroppiTentativi(res, attesa);
        if (!utente.password || !(await bcrypt.compare(password, utente.password))) {
            segnaTentativoFallito(req, utente.codice_censimento);
            return res.status(401).json({ error: "La password non è giusta." });
        }
        if (utente.email && utente.email.toLowerCase() === email)
            return res.status(400).json({ error: "È già la tua email." });
        const giaUsata = await dbGet('SELECT id FROM utenti WHERE email_impronta = ? AND id <> ?', [improntaEmail(email), utente.id]);
        if (giaUsata) return res.status(409).json({ error: "Questa email è già usata da un altro account." });
        const ultimo = await dbGet(`SELECT MAX(data_creazione) AS quando FROM link_email
                                    WHERE rif_utente = ? AND tipo = 'cambio-email'`, [utente.id]);
        const passati = Math.floor(Date.now() / 1000) - (ultimo?.quando ?? 0);
        if (passati < SECONDI_FRA_EMAIL)
            return res.status(429).json({ error: `Aspetta ${SECONDI_FRA_EMAIL - passati} secondi prima di riprovare.` });

        const token = crypto.randomBytes(32).toString('base64url');
        const scadenza = Math.floor(Date.now() / 1000) + ORE_LINK_CONFERMA * 3600;
        await dbRun(`UPDATE link_email SET usato = 1 WHERE rif_utente = ? AND tipo = 'cambio-email' AND usato = 0`, [utente.id]);
        await dbRun(`INSERT INTO link_email (rif_utente, tipo, impronta, email, scadenza) VALUES (?, 'cambio-email', ?, ?, ?)`,
            [utente.id, improntaLink(token), cripta(email), scadenza]);
        const link = `${SITO_URL}/conferma-email?token=${token}&cambio=1`;
        if (!postaPronta) {
            if (process.env.NODE_ENV === 'production') throw new Error('POSTA_NON_IMPOSTATA');
            console.warn(`✉️  (prova, posta non impostata) link per la nuova email di ${utente.nome}: ${link}`);
            return res.json({ message: "Le email non sono ancora impostate: il link per confermare è nel terminale del backend." });
        }
        await inviaEmail({ a: email, ...emailCambioEmail({ nome: utente.nome, link, ore: ORE_LINK_CONFERMA }) });
        res.json({
            message: `Ti abbiamo mandato un link a ${emailMascherata(email)}. Aprilo per confermare: fino ad allora resta l'email di adesso.`,
        });
    } catch (err) {
        if (err?.message === 'POSTA_NON_IMPOSTATA' || err?.code)
            console.error('❌ Email per il cambio di indirizzo non partita:', descriviErrore(err));
        if (err?.code) return res.status(502).json({ error: "L'email non è partita. Riprova tra poco." });
        erroreInterno(res, err);
    }
});

// Il link arrivato alla casella nuova: da qui l'email dell'account è quella.
app.post('/api/utenti/me/email/conferma', async (req, res) => {
    const token = String(req.body?.token ?? '');
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token))
        return res.status(400).json({ error: "Il link non è valido. Copialo per intero dall'email." });
    const attesa = attesaPrimaDiRiprovare(req, null);
    if (attesa) return rispostaTroppiTentativi(res, attesa);
    try {
        const adesso = Math.floor(Date.now() / 1000);
        const link = await dbGet(`SELECT * FROM link_email WHERE impronta = ? AND tipo = 'cambio-email'`, [improntaLink(token)]);
        const utente = link ? await dbGet('SELECT * FROM utenti WHERE id = ?', [link.rif_utente]) : null;
        if (!link || !utente) {
            segnaTentativoFallito(req, null);
            return res.status(404).json({ error: "Questo link non è valido. Rifai il cambio dal profilo." });
        }
        if (link.usato === 1 || link.scadenza < adesso)
            return res.status(410).json({ error: "Questo link è scaduto o è già stato usato. Rifai il cambio dal profilo." });
        const nuova = String(link.email).toLowerCase();
        const giaUsata = await dbGet('SELECT id FROM utenti WHERE email_impronta = ? AND id <> ?', [improntaEmail(nuova), utente.id]);
        if (giaUsata) return res.status(409).json({ error: "Nel frattempo questa email è stata presa da un altro account." });

        const bruciato = await dbRun('UPDATE link_email SET usato = 1 WHERE id = ? AND usato = 0', [link.id]);
        if (bruciato.changes === 0)
            return res.status(410).json({ error: "Questo link è già stato usato. Rifai il cambio dal profilo." });
        // email_a_mano: scelta dalla persona, il file del censimento non la sovrascrive più.
        const salvata = emailDaSalvare(nuova);
        await dbRun(`UPDATE utenti SET email = ?, email_impronta = ?, email_confermata = 1, email_a_mano = 1 WHERE id = ?`,
            [salvata.email, salvata.impronta, utente.id]);
        res.json({ message: "Email cambiata!" });

        // L'avviso alla casella di prima parte dopo aver risposto.
        if (utente.email && postaPronta && utente.email.toLowerCase() !== nuova) {
            inviaEmail({ a: utente.email, ...emailEmailCambiata({ nome: utente.nome, nuova }) }, ATTESE_SOTTOFONDO)
                .catch(errPosta => console.error("❌ Avviso di email cambiata non partito:", descriviErrore(errPosta)));
        }
    } catch (err) {
        erroreInterno(res, err);
    }
});

// Elenco dei censiti. Il capogruppo (admin) vede tutti, perché si occupa della comunità capi;
// il capo vede la sua branca, quella che gestisce.
app.get('/api/utenti', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const capogruppo = req.user.ruolo === 'admin';
        // La branca è quella vera di chi chiede, anche per un capogruppo che segue una branca.
        const branca = await brancaDelCapo(req.user.id);
        // tipo=capi: la comunità capi (solo i capigruppo). tipo=ragazzi: i ragazzi della propria branca.
        const tipo = String(req.query.tipo ?? '');
        if (tipo === 'capi' && !capogruppo)
            return res.status(403).json({ error: "La comunità capi la gestiscono i capigruppo." });
        if (tipo !== 'capi' && !branca) return res.json({ utenti: [], branca: null, capogruppo });

        const dove = tipo === 'capi'
            ? `WHERE ruolo IN ('capo', 'admin')`
            : tipo === 'ragazzi' ? `WHERE ruolo = 'ragazzo' AND branca = ?`
                : (capogruppo ? '' : 'WHERE branca = ?');
        const valori = dove.includes('?') ? [branca] : [];

        const sql = `SELECT id, codice_censimento, nome, cognome, eta, data_nascita, ruolo, branca,
                            livello_foca, (password IS NOT NULL)::int AS attivato
                     FROM utenti ${dove}
                     ORDER BY lower(cognome), lower(nome)`;
        const righe = await dbAll(sql, valori);
        res.json({
            // L'età si ricalcola qui a ogni richiesta: al compleanno cambia da sola.
            utenti: righe.map(u => ({
                ...u, eta: etaDiOggi(u), attivato: u.attivato === 1,
                // Il livello Fo.Ca. è dei capi: per i ragazzi non c'è.
                livello_foca: u.ruolo === 'ragazzo' ? null : (u.livello_foca || null),
            })),
            branca, capogruppo,
        });
    } catch (err) {
        erroreInterno(res, err);
    }
});

/** Livello di formazione capi: CFT, CFM, CFA, CAPO… "NULLA" o vuoto vuol dire nessuno. */
function leggiLivelloFoca(valore) {
    const t = String(valore ?? '').trim().toUpperCase();
    if (!t || t === 'NULLA') return null;
    return /^[A-Z][A-Z. ]{1,19}$/.test(t) ? t : null;
}

function leggiEmailImport(valore) {
    const t = String(valore ?? '').trim().toLowerCase();
    return t.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null;
}

// Il secondo file dei capi: codice censimento e branca. Nell'elenco del censimento i capi sono
// "Adulti", quindi la branca la mettono i capigruppo, a mano o con questo file.
// Tocca solo chi è già nel sito come capo o capogruppo.
app.post('/api/utenti/branche-capi', verificaRuolo('admin'), async (req, res) => {
    const righe = req.body?.righe;
    if (!Array.isArray(righe) || righe.length === 0)
        return res.status(400).json({ error: "Nessuna riga da caricare." });
    if (righe.length > MAX_RIGHE_IMPORT)
        return res.status(400).json({ error: `Puoi caricare al massimo ${MAX_RIGHE_IMPORT} righe alla volta.` });
    try {
        const capi = await dbAll(`SELECT id, codice_censimento FROM utenti WHERE ruolo IN ('capo', 'admin')`);
        const perCodice = new Map(capi.filter(c => c.codice_censimento).map(c => [c.codice_censimento, c]));
        const scartate = [];
        const daFare = [];
        righe.forEach((r, i) => {
            const riga = Number.isInteger(r?.riga) ? r.riga : i + 1;
            const codice = leggiCodiceCensimento(String(r?.codice_censimento ?? ''));
            if (!codice) return scartate.push({ riga, motivo: 'Codice censimento non valido' });
            if (!BRANCHE.includes(r?.branca)) return scartate.push({ riga, motivo: 'Branca non riconosciuta' });
            const capo = perCodice.get(codice);
            if (!capo) return scartate.push({ riga, motivo: 'Nessun capo nel sito con questo codice' });
            daFare.push({ id: capo.id, branca: r.branca });
        });
        await dbRun('BEGIN');
        for (const d of daFare) await dbRun('UPDATE utenti SET branca = ? WHERE id = ?', [d.branca, d.id]);
        await dbRun('COMMIT');
        res.json({ inseriti: 0, aggiornati: daFare.length, scartate });
    } catch (err) {
        await dbRun('ROLLBACK').catch(() => {});
        erroreInterno(res, err);
    }
});

// Import da Excel: inserisce i nuovi codici e aggiorna nome, cognome, età (e branca se presente)
// di quelli già esistenti. Ruolo e password degli utenti esistenti non vengono mai toccati.
app.post('/api/utenti/importa', verificaRuolo('capo', 'admin'), async (req, res) => {
    const { ruolo, righe } = req.body || {};
    if (!RUOLI_IMPORTABILI.includes(ruolo))
        return res.status(400).json({ error: "Ruolo non valido: puoi importare ragazzi o capi." });
    if (!Array.isArray(righe) || righe.length === 0)
        return res.status(400).json({ error: "Nessuna riga da importare." });
    if (righe.length > MAX_RIGHE_IMPORT)
        return res.status(400).json({ error: `Puoi importare al massimo ${MAX_RIGHE_IMPORT} righe alla volta.` });

    // Ognuno carica quelli di cui si occupa: i capigruppo la comunità capi,
    // gli altri capi i ragazzi della propria branca.
    // I capi nuovi li caricano solo i capigruppo. I ragazzi li carica chi segue una branca:
    // un capogruppo che è anche capo di branca può fare tutte e due le cose, ognuna dalla sua zona.
    const capogruppo = req.user.ruolo === 'admin';
    const miaBranca = await brancaDelCapo(req.user.id).catch(() => null);
    if (ruolo === 'capo' && !capogruppo)
        return res.status(403).json({ error: "I capi nuovi li caricano i capigruppo." });
    if (ruolo === 'ragazzo' && !miaBranca)
        return res.status(403).json({ error: "Non risulti in nessuna branca: chiedi ai capigruppo di assegnartela." });

    let esistenti;
    try {
        esistenti = await dbAll(`SELECT id, codice_censimento, nome, cognome, data_nascita, ruolo, branca, email,
                                        email_a_mano FROM utenti`);
    } catch (err) {
        return erroreInterno(res, err);
    }
    const perCodice = new Map(esistenti.filter(u => u.codice_censimento).map(u => [u.codice_censimento, u]));
    // Chi è già stato aggiunto a mano e aspetta il codice: si riconosce da nome, cognome
    // e data di nascita, così il file del censimento gli assegna il codice senza fare doppioni.
    // I nomi uguali capitano (due fratelli, due omonimi): è la data a distinguerli.
    const comeSiChiama = (u) => `${u.nome} ${u.cognome}`.toLowerCase().replace(/\s+/g, ' ').trim();
    const ragazziDellaBranca = new Map();
    for (const u of esistenti) {
        if (u.ruolo !== 'ragazzo' || u.branca !== miaBranca) continue;
        const chiave = comeSiChiama(u);
        if (!ragazziDellaBranca.has(chiave)) ragazziDellaBranca.set(chiave, []);
        ragazziDellaBranca.get(chiave).push(u);
    }
    const omonimiDi = (nome, cognome) =>
        ragazziDellaBranca.get(`${nome} ${cognome}`.toLowerCase().replace(/\s+/g, ' ').trim()) ?? [];

    const valide = [];
    const scartate = [];
    const avvisi = [];
    const visti = new Set();
    const emailViste = new Set();
    righe.forEach((r, i) => {
        const riga = Number.isInteger(r?.riga) ? r.riga : i + 1;
        // La casella del codice può essere vuota: il ragazzo entra lo stesso e il codice arriva dopo.
        const codiceScritto = String(r?.codice_censimento ?? '').trim();
        const codice = codiceScritto ? leggiCodiceCensimento(codiceScritto) : null;
        const nome = testo(r?.nome);
        const cognome = testo(r?.cognome);
        const eta = leggiEta(r?.eta);
        // Con la data di nascita l'età non va più aggiornata a mano: si ricalcola da sola.
        const dataNascita = /^\d{4}-\d{2}-\d{2}$/.test(String(r?.data_nascita ?? '')) ? r.data_nascita : null;
        // Anno di percorso nella branca (1, 2, 3…): serve solo ai ragazzi e riempie solo i vuoti.
        const annoScritto = Number(r?.anno_branca);
        // I ragazzi vanno nella branca di chi li carica: la colonna del file non conta.
        // Per i capi la branca la porta il file (un capo può essere a disposizione del gruppo).
        const branca = ruolo === 'capo' ? (BRANCHE.includes(r?.branca) ? r.branca : null) : miaBranca;
        // Livello Fo.Ca. ed email arrivano solo per i capi; per i ragazzi non si salvano.
        const livelloFoca = ruolo === 'capo' ? leggiLivelloFoca(r?.livello_foca) : null;
        const email = ruolo === 'capo' ? leggiEmailImport(r?.email) : null;
        const massimo = ANNI_DI_BRANCA[branca] || 5;
        const annoBranca = ruolo === 'ragazzo' && Number.isInteger(annoScritto)
            && annoScritto >= 1 && annoScritto <= massimo ? annoScritto : null;
        const gia = codice ? perCodice.get(codice) : null;

        let motivo = null;
        if (codiceScritto && !codice) motivo = 'Codice censimento non valido';
        // Un capo senza codice non potrebbe nemmeno entrare nel sito.
        else if (!codice && ruolo === 'capo') motivo = 'Ai capi serve il codice censimento';
        else if (!nome || !cognome) motivo = 'Nome o cognome mancante';
        else if (eta === undefined) motivo = 'Età non valida';
        else if (ruolo === 'ragazzo' && r?.anno_branca && !annoBranca)
            motivo = `Anno di percorso non valido: nel ${branca} si va da 1 a ${massimo}`;
        else if (codice && visti.has(codice)) motivo = 'Codice ripetuto nel file';
        // L'elenco del censimento ha tutto il gruppo: un ragazzo di un'altra branca non si carica qui.
        else if (ruolo === 'ragazzo' && BRANCHE.includes(r?.branca) && r.branca !== miaBranca)
            motivo = "È di un'altra branca: lo caricano i suoi capi";
        // Un capo non tocca chi non è della sua branca, né i capi: quelli sono dei capigruppo.
        // Caricando ragazzi non si tocca chi è un capo né chi è di un'altra branca.
        else if (ruolo === 'ragazzo' && gia && gia.ruolo !== 'ragazzo') motivo = 'Il codice è di un capo: lo gestiscono i capigruppo';
        else if (ruolo === 'ragazzo' && gia && gia.branca && gia.branca !== miaBranca) motivo = "Il codice è di un'altra branca";
        if (motivo) return scartate.push({ riga, motivo });

        // Riconoscere chi c'è già: nome, cognome e data di nascita devono combaciare tutti e tre.
        const stessaPersona = (u) => u.data_nascita && dataNascita && u.data_nascita === dataNascita;
        let inAttesa = null;   // aveva una riga senza codice: gliene diamo uno
        let daAggiornare = null;   // riga del file senza codice, ma la persona c'è già

        if (ruolo === 'ragazzo' && !gia) {
            const omonimi = omonimiDi(nome, cognome);
            // Col codice si cerca solo fra chi il codice lo aspetta; senza codice fra tutti.
            const candidati = codice ? omonimi.filter(u => !u.codice_censimento) : omonimi;
            const trovato = candidati.find(stessaPersona);
            if (trovato) {
                if (codice) inAttesa = trovato; else daAggiornare = trovato;
            } else if (candidati.length) {
                // Stesso nome ma la data non torna (o manca da una parte): meglio fermarsi che
                // fare un doppione o dare il codice alla persona sbagliata.
                return scartate.push({
                    riga,
                    motivo: dataNascita
                        ? `C'è già un "${nome} ${cognome}" in questa branca con un'altra data di nascita: controlla a mano`
                        : `C'è già un "${nome} ${cognome}" in questa branca: senza data di nascita non so se è lui`,
                });
            }
        }

        if (codice) visti.add(codice);
        // L'email è unica nel sito: se ce l'ha già un altro utente (o un'altra riga del file)
        // la riga si carica lo stesso, ma senza email.
        let emailScelta = email;
        // Chi ha l'email cambiata a mano tiene la sua: quella del file non conta.
        if (gia && gia.email_a_mano === 1) emailScelta = null;
        else if (email) {
            const altro = esistenti.find(u => u.email && u.email.toLowerCase() === email && u.codice_censimento !== codice);
            if (altro || emailViste.has(email)) {
                emailScelta = null;
                avvisi.push({ riga, motivo: `Email ${email} già usata da un altro utente: non salvata` });
            } else {
                emailViste.add(email);
            }
        }
        valide.push({ codice, nome, cognome, eta, dataNascita, annoBranca, branca,
                      livelloFoca, email: emailScelta, gia: !!gia, inAttesa, daAggiornare });
    });

    try {
        await dbRun('BEGIN');
        let abbinati = 0;
        let giaAggiornati = 0;
        for (const v of valide) {
            if (v.inAttesa) {
                // Aveva già una riga senza codice: si completa quella, niente doppione.
                const codice = codiceDaSalvare(v.codice);
                await dbRun(`UPDATE utenti SET codice_censimento = ?, codice_impronta = ?, nome = ?, cognome = ?,
                             eta = COALESCE(?, eta), data_nascita = COALESCE(?, data_nascita),
                             anno_branca = COALESCE(anno_branca, ?) WHERE id = ?`,
                    [codice.codice, codice.impronta, v.nome, v.cognome, v.eta, cripta(v.dataNascita), v.annoBranca, v.inAttesa.id]);
                abbinati++;
                continue;
            }
            if (v.daAggiornare) {
                // Riga del file senza codice di una persona che c'è già: si aggiornano i dati,
                // il codice che ha resta com'è.
                await dbRun(`UPDATE utenti SET nome = ?, cognome = ?, eta = COALESCE(?, eta),
                             data_nascita = COALESCE(?, data_nascita),
                             anno_branca = COALESCE(anno_branca, ?) WHERE id = ?`,
                    [v.nome, v.cognome, v.eta, cripta(v.dataNascita), v.annoBranca, v.daAggiornare.id]);
                giaAggiornati++;
                continue;
            }
            if (!v.codice) {
                // Nuovo e senza codice: entra lo stesso, il codice glielo si mette più avanti.
                await dbRun(`INSERT INTO utenti (codice_censimento, nome, cognome, eta, data_nascita,
                             ruolo, branca, anno_branca) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)`,
                    [v.nome, v.cognome, v.eta, cripta(v.dataNascita), ruolo, v.branca, v.annoBranca]);
                continue;
            }
            // Codice, email e data di nascita si salvano cifrati (codice ed email con la loro
            // impronta: è l'impronta del codice a dire se la persona c'è già).
            const salvata = emailDaSalvare(v.email);
            const codice = codiceDaSalvare(v.codice);
            await dbRun(`INSERT INTO utenti (codice_censimento, codice_impronta, nome, cognome, eta, data_nascita,
                         ruolo, branca, anno_branca, livello_foca, email, email_impronta)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                         ON CONFLICT (codice_impronta) DO UPDATE SET
                           nome = EXCLUDED.nome, cognome = EXCLUDED.cognome,
                           eta = COALESCE(EXCLUDED.eta, utenti.eta),
                           data_nascita = COALESCE(EXCLUDED.data_nascita, utenti.data_nascita),
                           branca = COALESCE(EXCLUDED.branca, utenti.branca),
                           -- L'anno di percorso lo comanda l'apertura dell'anno: il file riempie solo i vuoti.
                           anno_branca = COALESCE(utenti.anno_branca, EXCLUDED.anno_branca),
                           -- Dal censimento: livello Fo.Ca. ed email dei capi. Se nel file mancano
                           -- resta quello che c'era; un'email cambiata a mano dal sito vince sempre.
                           livello_foca = COALESCE(EXCLUDED.livello_foca, utenti.livello_foca),
                           email = CASE WHEN utenti.email_a_mano = 1 THEN utenti.email
                                        ELSE COALESCE(EXCLUDED.email, utenti.email) END,
                           email_impronta = CASE WHEN utenti.email_a_mano = 1 THEN utenti.email_impronta
                                                 ELSE COALESCE(EXCLUDED.email_impronta, utenti.email_impronta) END`,
                [codice.codice, codice.impronta, v.nome, v.cognome, v.eta, cripta(v.dataNascita), ruolo,
                 v.branca, v.annoBranca, v.livelloFoca, salvata.email, salvata.impronta]);
        }
        await dbRun('COMMIT');
        const aggiornati = valide.filter(v => v.gia).length + giaAggiornati;
        // Chi arriva dal censimento e aveva fatto la richiesta: la scheda prende i suoi dati.
        if (ruolo === 'ragazzo') await riempiSchedeDaRichieste(miaBranca).catch(err =>
            console.error('❌ Schede dalle richieste:', err.message));
        // `abbinati`: chi era stato aggiunto a mano e ora ha ricevuto il suo codice.
        res.json({
            inseriti: valide.length - aggiornati - abbinati,
            aggiornati, abbinati, scartate, avvisi,
        });
    } catch (err) {
        await dbRun('ROLLBACK').catch(() => {});
        erroreInterno(res, err);
    }
});


// ---------- Post ----------

// Controlla i campi di un post. La foto è obbligatoria in creazione, facoltativa in modifica
// (se manca resta quella di prima). Restituisce { errore } oppure { dati }.
function validaPost(body, { fotoObbligatoria }) {
    const didascalia = testo(body.didascalia);
    const contenuto = testo(body.testo) || null;
    const colore = String(body.colore ?? '').toUpperCase();
    const etichetta = String(body.etichetta ?? '');

    if (!didascalia) return { errore: "La didascalia è obbligatoria." };
    if (didascalia.length > MAX_DIDASCALIA)
        return { errore: `La didascalia può avere al massimo ${MAX_DIDASCALIA} caratteri.` };
    if (contenuto && contenuto.length > MAX_TESTO_POST) return { errore: "Il testo è troppo lungo." };
    if (!COLORI_POST.includes(colore)) return { errore: "Scegli uno dei colori proposti." };
    if (!ETICHETTE_POST.includes(etichetta)) return { errore: "Scegli l'etichetta: branco, reparto, clan o gruppo." };

    let foto = null;
    if (body.foto !== undefined && body.foto !== null && body.foto !== '') {
        foto = leggiFoto(body.foto);
        if (!foto) return { errore: "Carica una foto JPG, PNG o WebP di massimo 5 MB." };
    } else if (fotoObbligatoria) {
        return { errore: "Carica una foto JPG, PNG o WebP di massimo 5 MB." };
    }
    // I link ai video: si accettano solo YouTube e Instagram, e si salvano già ripuliti.
    let videoLink;
    if (body.video_link !== undefined) {
        if (!Array.isArray(body.video_link)) return { errore: "Elenco dei link ai video non valido." };
        if (body.video_link.length > MAX_LINK_VIDEO_POST)
            return { errore: `Al massimo ${MAX_LINK_VIDEO_POST} link a video per post.` };
        videoLink = [];
        for (const scritto of body.video_link) {
            const pulito = linkVideoPulito(scritto);
            if (!pulito) return { errore: "I link ai video devono essere di YouTube o Instagram (un video, un reel o un post)." };
            if (!videoLink.includes(pulito)) videoLink.push(pulito);
        }
    }
    return { dati: { didascalia, contenuto, colore, etichetta, foto, videoLink } };
}

const MAX_FOTO_POST = 10;
const MAX_LINK_VIDEO_POST = 5;
const MAX_VIDEO_POST = 3;
const MAX_BYTE_VIDEO_POST = 50 * 1024 * 1024;
const VIDEO_POST = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    m4v: 'video/mp4',
    webm: 'video/webm',
};

/**
 * Un link a un video, ripulito: solo YouTube e Instagram, e si tiene l'indirizzo "pulito"
 * (senza parametri di tracciamento). null se non è un link che sappiamo mostrare.
 */
function linkVideoPulito(valore) {
    let url;
    try { url = new URL(String(valore ?? '').trim()); } catch { return null; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.replace(/^(www\.|m\.)/, '');
    const idYoutube = /^[A-Za-z0-9_-]{11}$/;
    if (host === 'youtu.be') {
        const id = url.pathname.slice(1).split('/')[0];
        return idYoutube.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
    }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        const id = url.searchParams.get('v')
            ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1] ?? '';
        return idYoutube.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
    }
    if (host === 'instagram.com') {
        const m = url.pathname.match(/^\/(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})/);
        return m ? `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/` : null;
    }
    return null;
}

/** I link ai video di un post, dal database. */
function linkVideoDelPost(p) {
    try { return p.video_link ? JSON.parse(p.video_link).filter(l => typeof l === 'string') : []; } catch { return []; }
}

/** Riconosce un video dai primi byte: MP4/MOV hanno "ftyp" al quarto byte, WebM inizia con 1A 45 DF A3. */
function eUnVideo(dati, estensione) {
    if (!Buffer.isBuffer(dati) || dati.length < 12) return false;
    if (estensione === 'webm') return dati[0] === 0x1A && dati[1] === 0x45 && dati[2] === 0xDF && dati[3] === 0xA3;
    return dati.subarray(4, 8).toString('latin1') === 'ftyp';
}

/**
 * Le foto di un post come le manda il sito: un elenco in ordine (la prima è la copertina),
 * dove ogni voce è una foto già del post da tenere ({ tieni: percorso }) o una nuova
 * ({ nuova: data URL }). Restituisce { errore } oppure { elenco }.
 */
function leggiElencoFoto(valore, giaDelPost = []) {
    if (!Array.isArray(valore)) return { errore: "Elenco delle foto non valido." };
    if (!valore.length) return { errore: "Serve almeno una foto." };
    if (valore.length > MAX_FOTO_POST) return { errore: `Al massimo ${MAX_FOTO_POST} foto per post.` };
    const elenco = [];
    for (const voce of valore) {
        if (typeof voce?.tieni === 'string') {
            // Si possono tenere solo foto che sono già di questo post.
            if (!giaDelPost.includes(voce.tieni) || elenco.some(e => e.percorso === voce.tieni))
                return { errore: "Una delle foto non è di questo post." };
            elenco.push({ percorso: voce.tieni });
        } else if (typeof voce?.nuova === 'string') {
            const foto = leggiFoto(voce.nuova);
            if (!foto) return { errore: "Ogni foto deve essere JPG, PNG o WebP, di massimo 5 MB." };
            elenco.push({ foto });
        } else {
            return { errore: "Elenco delle foto non valido." };
        }
    }
    return { elenco };
}

/** Salva su disco le foto nuove dell'elenco e torna tutti i percorsi, in ordine. */
async function salvaElencoFoto(elenco) {
    const salvati = [];
    try {
        for (const voce of elenco) {
            if (voce.percorso) { salvati.push(voce.percorso); continue; }
            const percorso = await new Promise((ok, ko) => salvaFotoPost(voce.foto, (err, p) => err ? ko(err) : ok(p)));
            voce.salvata = percorso;
            salvati.push(percorso);
        }
    } catch (err) {
        // Se una non si salva, si buttano quelle appena scritte: niente file orfani.
        for (const voce of elenco) if (voce.salvata) eliminaFotoPost(voce.salvata);
        throw err;
    }
    return salvati;
}

function salvaFotoPost(foto, cb) {
    const nomeFile = `${crypto.randomUUID()}.${foto.estensione}`;
    fs.writeFile(path.join(CARTELLA_FOTO_POST, nomeFile), foto.dati, (err) => cb(err, `/uploads/post/${nomeFile}`));
}

// Cancella il file di una foto partendo dal percorso salvato nel database ("/uploads/<cartella>/<file>").
function eliminaFile(cartella, percorso) {
    if (!percorso) return;
    fs.unlink(path.join(cartella, path.basename(percorso)), () => {});
}

function eliminaFotoPost(percorso) {
    eliminaFile(CARTELLA_FOTO_POST, percorso);
}

function videoPubblico(v) {
    return { id: v.id, url: v.percorso, nome: v.nome_originale, tipo: v.tipo, dimensione: v.dimensione };
}

/** Aggiunge ai post i loro video caricati, in una sola lettura. */
async function conVideo(posts) {
    if (!posts.length) return posts;
    const righe = await dbAll(`SELECT * FROM post_video WHERE rif_post IN (${posts.map(() => '?').join(',')}) ORDER BY id`,
        posts.map(p => p.id));
    for (const p of posts) p.video = righe.filter(v => v.rif_post === p.id).map(videoPubblico);
    return posts;
}

function inviaPost(res, id, stato = 200) {
    db.get('SELECT * FROM post WHERE id = ?', [id], async (err, post) => {
        if (err || !post) return res.status(500).json({ error: "Post salvato ma non riletto." });
        try { await conVideo([post]); } catch { post.video = []; }
        res.status(stato).json({ post: postPubblico(post) });
    });
}

function eliminaVideoDelPost(righe) {
    for (const v of righe) eliminaFile(CARTELLA_VIDEO_POST, v.percorso);
}

// Elenco a pagine: i post in evidenza sempre per primi, poi dal più recente.
// ?offset=N salta i primi N, ?limite=M (1-12), ?etichetta=branco|reparto|clan|gruppo filtra.
app.get('/api/post', (req, res) => {
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const limite = Math.min(POST_PER_PAGINA, Math.max(1, Number.parseInt(req.query.limite, 10) || POST_PER_PAGINA));
    const etichetta = ETICHETTE_POST.includes(req.query.etichetta) ? req.query.etichetta : null;

    const sql = `SELECT * FROM post WHERE archiviato = 0 AND in_attesa = 0 ${etichetta ? 'AND etichetta = ?' : ''}
                 ORDER BY in_evidenza DESC, data_creazione DESC, id DESC
                 LIMIT ? OFFSET ?`;
    const parametri = [...(etichetta ? [etichetta] : []), limite + 1, offset];
    db.all(sql, parametri, async (err, rows) => {
        if (err) return erroreInterno(res, err);
        const pagina = rows.slice(0, limite);
        try { await conVideo(pagina); } catch { pagina.forEach(p => p.video = []); }
        // Se ne arriva uno in più del limite, ci sono altri post da caricare con "Vedi altro".
        res.json({ post: pagina.map(postPubblico), altri: rows.length > limite });
    });
});

// Quanti post restano nella home: oltre questo numero i più vecchi finiscono in archivio.
const MAX_POST_HOME = 50;

/**
 * Chi può scrivere un post e come ci arriva nella home.
 * Capi e capigruppo pubblicano direttamente. I ragazzi del clan preparano il post e lo
 * mandano ai capi: resta in attesa finché un capo clan o un capogruppo non lo approva.
 */
async function permessiPost(req) {
    const utente = await dbGet('SELECT ruolo, branca FROM utenti WHERE id = ?', [req.user.id]);
    if (!utente) return { scrive: false, subito: false, approva: false };
    const capo = utente.ruolo === 'capo' || utente.ruolo === 'admin';
    const approva = utente.ruolo === 'admin' || (capo && utente.branca === 'clan');
    if (capo) return { scrive: true, subito: true, approva };
    // Rover e scolte: possono proporre, non pubblicare.
    const delClan = utente.ruolo === 'ragazzo' && utente.branca === 'clan';
    return { scrive: delClan, subito: false, approva: false };
}

// I post proposti dai ragazzi, in attesa di un sì.
// I ragazzi vedono i propri, i capi clan e i capigruppo tutti quelli da approvare.
app.get('/api/post/in-attesa', verificaUtenteCensito, async (req, res) => {
    try {
        const permessi = await permessiPost(req);
        const soloMiei = !permessi.approva;
        if (soloMiei && !permessi.scrive) return res.json({ post: [], puoApprovare: false });

        const righe = await dbAll(`SELECT p.*, u.nome AS autore_nome, u.cognome AS autore_cognome
                                   FROM post p LEFT JOIN utenti u ON u.id = p.rif_autore
                                   WHERE p.in_attesa = 1 ${soloMiei ? 'AND p.rif_autore = ?' : ''}
                                   ORDER BY p.data_creazione DESC`, soloMiei ? [req.user.id] : []);
        res.json({ post: righe.map(postPubblico), puoApprovare: permessi.approva });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// Il sì (o il no) di un capo clan o di un capogruppo.
app.put('/api/post/:id/pubblica', verificaUtenteCensito, async (req, res) => {
    try {
        if (!(await permessiPost(req)).approva)
            return res.status(403).json({ error: "I post dei ragazzi li approvano i capi clan e i capigruppo." });

        const post = await dbGet('SELECT * FROM post WHERE id = ?', [req.params.id]);
        if (!post) return res.status(404).json({ error: "Post non trovato." });
        if (post.in_attesa !== 1) return res.status(409).json({ error: "Questo post è già stato deciso." });

        if (req.body?.approva === false) {
            // Rifiutato: il post, le sue foto e i suoi video se ne vanno.
            const video = await dbAll('SELECT percorso FROM post_video WHERE rif_post = ?', [post.id]);
            await dbRun('DELETE FROM post WHERE id = ?', [post.id]);
            fotoDelPost(post).forEach(eliminaFotoPost);
            eliminaVideoDelPost(video);
            return res.json({ message: "Post rifiutato." });
        }

        await dbRun('UPDATE post SET in_attesa = 0 WHERE id = ?', [post.id]);
        // Col post nuovo la home potrebbe superare i 50: i più vecchi vanno in archivio.
        sistemaArchivioPost(() => inviaPost(res, post.id));
    } catch (err) {
        erroreInterno(res, err);
    }
});

/**
 * Tiene la home a 50 post: quando se ne aggiunge uno, i più vecchi vanno in archivio.
 * I post in evidenza non si toccano: restano appesi in alto finché lo decide un capo.
 */
function sistemaArchivioPost(cb = () => {}) {
    db.get(`SELECT COUNT(*) AS quanti FROM post WHERE archiviato = 0`, (err, riga) => {
        if (err || !riga) return cb(err);
        const daArchiviare = riga.quanti - MAX_POST_HOME;
        if (daArchiviare <= 0) return cb(null, 0);
        db.run(`UPDATE post SET archiviato = 1, data_archiviazione = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
                WHERE id IN (
                  SELECT id FROM post WHERE archiviato = 0 AND in_evidenza = 0
                  ORDER BY data_creazione ASC, id ASC LIMIT ?
                )`, [daArchiviare], function(errUpdate) {
            cb(errUpdate, this?.changes ?? 0);
        });
    });
}

// L'archivio: tutti i post messi da parte, dal più recente al più vecchio.
app.get('/api/post/archivio', (req, res) => {
    const etichetta = ETICHETTE_POST.includes(req.query.etichetta) ? req.query.etichetta : null;
    const sql = `SELECT * FROM post WHERE archiviato = 1 AND in_attesa = 0 ${etichetta ? 'AND etichetta = ?' : ''}
                 ORDER BY data_creazione DESC, id DESC LIMIT 1000`;
    db.all(sql, etichetta ? [etichetta] : [], (err, rows) => {
        if (err) return erroreInterno(res, err);
        res.json({ post: rows.map(postPubblico), massimo: MAX_POST_HOME });
    });
});

// Mette un post in archivio o lo riporta nella home.
app.put('/api/post/:id/archivio', verificaRuolo('capo', 'admin'), (req, res) => {
    const archiviare = req.body?.archiviato !== false;
    db.get('SELECT * FROM post WHERE id = ?', [req.params.id], (err, post) => {
        if (err) return erroreInterno(res, err);
        if (!post) return res.status(404).json({ error: "Post non trovato." });

        const aggiorna = () => db.run(
            `UPDATE post SET archiviato = ?, data_archiviazione = ? WHERE id = ?`,
            [archiviare ? 1 : 0, archiviare ? new Date().toISOString().slice(0, 10) : null, post.id],
            (errUpdate) => {
                if (errUpdate) return erroreInterno(res, errUpdate);
                inviaPost(res, post.id);
            });

        if (!archiviare) {
            // Nella home ci stanno 50 post: per farne tornare uno bisogna prima archiviarne un altro.
            return db.get(`SELECT COUNT(*) AS quanti FROM post WHERE archiviato = 0`, (errConta, riga) => {
                if (errConta) return erroreInterno(res, errConta);
                if (riga.quanti >= MAX_POST_HOME)
                    return res.status(409).json({
                        error: `Sono già presenti ${MAX_POST_HOME} post: archiviane prima un altro.`,
                    });
                aggiorna();
            });
        }
        aggiorna();
    });
});

app.get('/api/post/:id', (req, res) => {
    db.get(`SELECT p.*, u.nome AS autore_nome, u.cognome AS autore_cognome
            FROM post p LEFT JOIN utenti u ON u.id = p.rif_autore WHERE p.id = ?`,
        [req.params.id], async (err, post) => {
            if (err) return erroreInterno(res, err);
            if (!post) return res.status(404).json({ error: "Post non trovato." });

            // Finché aspetta il sì, il post lo vedono solo l'autore e chi lo deve approvare.
            if (post.in_attesa === 1) {
                const chi = utenteDaToken(req);
                if (!chi) return res.status(403).json({ error: "Questo post non è ancora pubblicato." });
                const permessi = await permessiPost({ user: chi }).catch(() => null);
                const mio = post.rif_autore === chi.id;
                if (!mio && !permessi?.approva)
                    return res.status(403).json({ error: "Questo post non è ancora pubblicato." });
            }
            try { await conVideo([post]); } catch { post.video = []; }
            res.json({ post: postPubblico(post) });
        });
});

app.post('/api/post', verificaUtenteCensito, async (req, res) => {
    const permessi = await permessiPost(req);
    if (!permessi.scrive)
        return res.status(403).json({ error: "I post li scrivono i capi e i ragazzi del clan." });

    const body = req.body || {};
    // Con l'elenco delle foto la copertina è la prima; senza, vale la sola "foto" (come prima).
    const conElenco = Array.isArray(body.foto_elenco);
    const { errore, dati } = validaPost(body, { fotoObbligatoria: !conElenco });
    if (errore) return res.status(400).json({ error: errore });
    const lettura = conElenco ? leggiElencoFoto(body.foto_elenco) : { elenco: [{ foto: dati.foto }] };
    if (lettura.errore) return res.status(400).json({ error: lettura.errore });

    let percorsi;
    try {
        percorsi = await salvaElencoFoto(lettura.elenco);
    } catch {
        return res.status(500).json({ error: "Impossibile salvare le foto." });
    }
    try {
        const [copertina, ...altre] = percorsi;
        const esito = await dbRun(`INSERT INTO post (didascalia, testo, colore, etichetta, foto, altre_foto, video_link,
                                   rif_autore, in_attesa) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [dati.didascalia, dati.contenuto, dati.colore, dati.etichetta, copertina,
             altre.length ? JSON.stringify(altre) : null,
             dati.videoLink?.length ? JSON.stringify(dati.videoLink) : null, req.user.id, permessi.subito ? 0 : 1]);
        // Un post in attesa non entra ancora nella home: l'archivio si sistema all'approvazione.
        if (!permessi.subito) return inviaPost(res, esito.lastID, 201);
        // Col post nuovo la home potrebbe superare i 50: i più vecchi vanno in archivio.
        sistemaArchivioPost(() => inviaPost(res, esito.lastID, 201));
    } catch (err) {
        percorsi.forEach(eliminaFotoPost);
        erroreInterno(res, err);
    }
});

/**
 * Chi può mettere le mani su questo post: i capi sempre, un ragazzo del clan solo sul
 * proprio e solo finché è in attesa (dopo l'approvazione è roba dei capi).
 * Risponde già lei in caso di no.
 */
async function postModificabile(req, res) {
    const post = await dbGet('SELECT * FROM post WHERE id = ?', [req.params.id]);
    if (!post) {
        res.status(404).json({ error: "Post non trovato." });
        return null;
    }
    if (req.user.ruolo === 'capo' || req.user.ruolo === 'admin') return post;
    if (post.rif_autore === req.user.id && post.in_attesa === 1) return post;
    res.status(403).json({ error: "Questo post non è tuo, o è già stato pubblicato." });
    return null;
}

app.put('/api/post/:id', verificaUtenteCensito, async (req, res) => {
    const esistente = await postModificabile(req, res);
    if (!esistente) return;
    const body = req.body || {};
    const { errore, dati } = validaPost(body, { fotoObbligatoria: false });
    if (errore) return res.status(400).json({ error: errore });

    const prima = fotoDelPost(esistente);
    let lettura;
    if (Array.isArray(body.foto_elenco)) lettura = leggiElencoFoto(body.foto_elenco, prima);
    // Senza elenco: una "foto" nuova prende il posto della copertina, le altre restano.
    else lettura = { elenco: [dati.foto ? { foto: dati.foto } : { percorso: prima[0] }, ...prima.slice(1).map(p => ({ percorso: p }))] };
    if (lettura.errore) return res.status(400).json({ error: lettura.errore });

    let percorsi;
    try {
        percorsi = await salvaElencoFoto(lettura.elenco);
    } catch {
        return res.status(500).json({ error: "Impossibile salvare le foto." });
    }
    const nuove = percorsi.filter(p => !prima.includes(p));
    try {
        const [copertina, ...altre] = percorsi;
        // Senza video_link nella richiesta i link restano quelli di prima.
        const link = dati.videoLink === undefined ? esistente.video_link
            : (dati.videoLink.length ? JSON.stringify(dati.videoLink) : null);
        await dbRun(`UPDATE post SET didascalia = ?, testo = ?, colore = ?, etichetta = ?, foto = ?, altre_foto = ?,
                     video_link = ? WHERE id = ?`,
            [dati.didascalia, dati.contenuto, dati.colore, dati.etichetta, copertina,
             altre.length ? JSON.stringify(altre) : null, link, esistente.id]);
    } catch (err) {
        nuove.forEach(eliminaFotoPost);
        return erroreInterno(res, err);
    }
    // Le foto tolte dal post non servono più.
    prima.filter(p => !percorsi.includes(p)).forEach(eliminaFotoPost);
    inviaPost(res, esistente.id);
});

app.delete('/api/post/:id', verificaUtenteCensito, async (req, res) => {
    if (!await postModificabile(req, res)) return;
    db.get('SELECT foto, altre_foto FROM post WHERE id = ?', [req.params.id], async (err, post) => {
        if (err) return erroreInterno(res, err);
        if (!post) return res.status(404).json({ error: "Post non trovato." });
        const video = await dbAll('SELECT percorso FROM post_video WHERE rif_post = ?', [req.params.id]).catch(() => []);
        db.run('DELETE FROM post WHERE id = ?', [req.params.id], (delErr) => {
            if (delErr) return erroreInterno(res, delErr);
            fotoDelPost(post).forEach(eliminaFotoPost);
            eliminaVideoDelPost(video);
            res.json({ message: "Post eliminato." });
        });
    });
});

// Un video corto alla volta, inviato così com'è (niente base64), dopo aver salvato il post.
// Il nome originale arriva nell'intestazione X-Nome-File, codificato con encodeURIComponent.
app.post('/api/post/:id/video', verificaUtenteCensito,
    express.raw({ type: () => true, limit: MAX_BYTE_VIDEO_POST }),
    async (req, res) => {
        try {
            const post = await postModificabile(req, res);
            if (!post) return;
            let nome;
            try { nome = decodeURIComponent(String(req.headers['x-nome-file'] ?? '')); } catch { nome = ''; }
            nome = path.basename(nome).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(-MAX_NOME_FILE) || 'video';
            const estensione = path.extname(nome).slice(1).toLowerCase();
            const dati = Buffer.isBuffer(req.body) ? req.body : null;
            if (!VIDEO_POST[estensione])
                return res.status(400).json({ error: `"${nome}": i video possono essere MP4, MOV o WebM.` });
            if (!dati || !dati.length) return res.status(400).json({ error: `"${nome}" è vuoto.` });
            if (!eUnVideo(dati, estensione))
                return res.status(400).json({ error: `"${nome}" non sembra un video ${estensione.toUpperCase()} valido.` });
            const { quanti } = await dbGet('SELECT COUNT(*) AS quanti FROM post_video WHERE rif_post = ?', [post.id]);
            if (quanti >= MAX_VIDEO_POST)
                return res.status(400).json({ error: `Un post può avere al massimo ${MAX_VIDEO_POST} video caricati.` });

            const nomeSuDisco = `${crypto.randomUUID()}.${estensione === 'm4v' ? 'mp4' : estensione}`;
            await fs.promises.writeFile(path.join(CARTELLA_VIDEO_POST, nomeSuDisco), dati);
            const percorso = `/uploads/post-video/${nomeSuDisco}`;
            try {
                const esito = await dbRun(`INSERT INTO post_video (rif_post, percorso, nome_originale, tipo, dimensione)
                                           VALUES (?, ?, ?, ?, ?)`, [post.id, percorso, nome, VIDEO_POST[estensione], dati.length]);
                const riga = await dbGet('SELECT * FROM post_video WHERE id = ?', [esito.lastID]);
                res.status(201).json({ video: videoPubblico(riga) });
            } catch (err) {
                eliminaFile(CARTELLA_VIDEO_POST, percorso);
                throw err;
            }
        } catch (err) {
            erroreInterno(res, err);
        }
    });

app.delete('/api/post/:id/video/:idVideo', verificaUtenteCensito, async (req, res) => {
    try {
        const post = await postModificabile(req, res);
        if (!post) return;
        const video = await dbGet('SELECT * FROM post_video WHERE id = ? AND rif_post = ?', [req.params.idVideo, post.id]);
        if (!video) return res.status(404).json({ error: "Video non trovato." });
        await dbRun('DELETE FROM post_video WHERE id = ?', [video.id]);
        eliminaFile(CARTELLA_VIDEO_POST, video.percorso);
        res.json({ message: "Video tolto." });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// Mette o toglie un post "in evidenza": i post in evidenza compaiono sopra tutti gli altri.
app.patch('/api/post/:id/evidenza', verificaRuolo('capo', 'admin'), (req, res) => {
    const inEvidenza = req.body?.in_evidenza;
    if (typeof inEvidenza !== 'boolean') return res.status(400).json({ error: "in_evidenza deve essere true o false." });
    db.run('UPDATE post SET in_evidenza = ? WHERE id = ?', [inEvidenza ? 1 : 0, req.params.id], function(err) {
        if (err) return erroreInterno(res, err);
        if (this.changes === 0) return res.status(404).json({ error: "Post non trovato." });
        inviaPost(res, req.params.id);
    });
});


// ---------- Eventi del calendario ----------

const MAX_TITOLO_EVENTO = 120;
const MAX_LUOGO_EVENTO = 160;
const MAX_DESCRIZIONE_EVENTO = 5000;

// "AAAA-MM-GG" di un giorno che esiste davvero (niente 31 febbraio).
function dataValida(valore) {
    if (typeof valore !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valore)) return false;
    const [a, m, g] = valore.split('-').map(Number);
    const d = new Date(Date.UTC(a, m - 1, g));
    return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === g;
}

function oraValida(valore) {
    return typeof valore === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(valore);
}

function eventoPubblico(e) {
    return {
        id: e.id,
        titolo: e.titolo,
        descrizione: e.descrizione,
        luogo: e.luogo,
        data_inizio: e.data_inizio,
        data_fine: e.data_fine,
        ora_inizio: e.ora_inizio,
        ora_fine: e.ora_fine,
        etichette: leggiElenco(e.etichette),
        in_evidenza: e.in_evidenza === 1,
        data_creazione: e.data_creazione
    };
}

// Restituisce { errore } oppure { dati } con i campi già puliti.
function validaEvento(body) {
    const titolo = testo(body.titolo);
    const descrizione = testo(body.descrizione) || null;
    const luogo = testo(body.luogo) || null;
    const dataInizio = body.data_inizio;
    const dataFine = body.data_fine || null;
    const oraInizio = body.ora_inizio || null;
    const oraFine = body.ora_fine || null;
    const { errore: erroreEtichette, etichette } = normalizzaEtichetteEvento(body.etichette ?? body.etichetta);

    if (!titolo) return { errore: "Il titolo è obbligatorio." };
    if (titolo.length > MAX_TITOLO_EVENTO) return { errore: `Il titolo può avere al massimo ${MAX_TITOLO_EVENTO} caratteri.` };
    if (luogo && luogo.length > MAX_LUOGO_EVENTO) return { errore: `Il luogo può avere al massimo ${MAX_LUOGO_EVENTO} caratteri.` };
    if (descrizione && descrizione.length > MAX_DESCRIZIONE_EVENTO) return { errore: "La descrizione è troppo lunga." };
    if (!dataValida(dataInizio)) return { errore: "Scegli una data valida." };
    if (dataFine && !dataValida(dataFine)) return { errore: "La data di fine non è valida." };
    if (dataFine && dataFine < dataInizio) return { errore: "La data di fine non può essere prima di quella di inizio." };
    if (oraInizio && !oraValida(oraInizio)) return { errore: "L'ora di inizio non è valida." };
    if (oraFine && !oraValida(oraFine)) return { errore: "L'ora di fine non è valida." };
    const stessoGiorno = !dataFine || dataFine === dataInizio;
    if (oraInizio && oraFine && stessoGiorno && oraFine <= oraInizio)
        return { errore: "L'ora di fine deve essere dopo quella di inizio." };
    if (erroreEtichette) return { errore: erroreEtichette };

    return {
        dati: {
            titolo, descrizione, luogo,
            etichette: JSON.stringify(etichette),
            data_inizio: dataInizio,
            // Un evento di un giorno solo non ha data di fine.
            data_fine: dataFine && dataFine !== dataInizio ? dataFine : null,
            ora_inizio: oraInizio,
            ora_fine: oraFine,
            in_evidenza: body.in_evidenza === true ? 1 : 0,
        }
    };
}

function inviaEvento(res, id, stato = 200) {
    db.get('SELECT * FROM evento WHERE id = ?', [id], (err, evento) => {
        if (err || !evento) return res.status(500).json({ error: "Evento salvato ma non riletto." });
        res.status(stato).json({ evento: eventoPubblico(evento) });
    });
}

// Eventi che toccano l'intervallo ?da=AAAA-MM-GG&a=AAAA-MM-GG (anche quelli di più giorni).
// Gli eventi "capi" arrivano solo a capi e admin; il token qui è facoltativo.
app.get('/api/eventi', (req, res) => {
    const { da, a } = req.query;
    if (!dataValida(da) || !dataValida(a) || a < da)
        return res.status(400).json({ error: "Indica un intervallo valido: ?da=AAAA-MM-GG&a=AAAA-MM-GG" });
    const vedeCapi = RUOLI_CAPI.includes(ruoloDaToken(req));
    const sql = `SELECT * FROM evento
                 WHERE data_inizio <= ? AND COALESCE(data_fine, data_inizio) >= ?
                 ${vedeCapi ? '' : `AND NOT (evento.etichette::jsonb @> '["capi"]'::jsonb)`}
                 ORDER BY data_inizio, COALESCE(ora_inizio, '00:00'), id`;
    db.all(sql, [a, da], (err, rows) => {
        if (err) return erroreInterno(res, err);
        res.json({ eventi: rows.map(eventoPubblico) });
    });
});

app.post('/api/eventi', verificaRuolo('capo', 'admin'), (req, res) => {
    const { errore, dati } = validaEvento(req.body || {});
    if (errore) return res.status(400).json({ error: errore });
    db.run(`INSERT INTO evento (titolo, descrizione, luogo, data_inizio, data_fine, ora_inizio, ora_fine, etichette, in_evidenza, rif_autore)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [dati.titolo, dati.descrizione, dati.luogo, dati.data_inizio, dati.data_fine, dati.ora_inizio, dati.ora_fine,
         dati.etichette, dati.in_evidenza, req.user.id], function(err) {
            if (err) return erroreInterno(res, err);
            inviaEvento(res, this.lastID, 201);
        });
});

app.put('/api/eventi/:id', verificaRuolo('capo', 'admin'), (req, res) => {
    const { errore, dati } = validaEvento(req.body || {});
    if (errore) return res.status(400).json({ error: errore });
    db.run(`UPDATE evento SET titolo = ?, descrizione = ?, luogo = ?, data_inizio = ?, data_fine = ?,
            ora_inizio = ?, ora_fine = ?, etichette = ?, in_evidenza = ? WHERE id = ?`,
        [dati.titolo, dati.descrizione, dati.luogo, dati.data_inizio, dati.data_fine, dati.ora_inizio, dati.ora_fine,
         dati.etichette, dati.in_evidenza, req.params.id], function(err) {
            if (err) return erroreInterno(res, err);
            if (this.changes === 0) return res.status(404).json({ error: "Evento non trovato." });
            inviaEvento(res, req.params.id);
        });
});

app.delete('/api/eventi/:id', verificaRuolo('capo', 'admin'), (req, res) => {
    db.run('DELETE FROM evento WHERE id = ?', [req.params.id], function(err) {
        if (err) return erroreInterno(res, err);
        if (this.changes === 0) return res.status(404).json({ error: "Evento non trovato." });
        res.json({ message: "Evento eliminato." });
    });
});

// Mette o toglie la bandierina: gli eventi in evidenza sono segnati nel calendario.
app.patch('/api/eventi/:id/evidenza', verificaRuolo('capo', 'admin'), (req, res) => {
    const inEvidenza = req.body?.in_evidenza;
    if (typeof inEvidenza !== 'boolean') return res.status(400).json({ error: "in_evidenza deve essere true o false." });
    db.run('UPDATE evento SET in_evidenza = ? WHERE id = ?', [inEvidenza ? 1 : 0, req.params.id], function(err) {
        if (err) return erroreInterno(res, err);
        if (this.changes === 0) return res.status(404).json({ error: "Evento non trovato." });
        inviaEvento(res, req.params.id);
    });
});


// ---------- Mappa: posti con bandierina ----------
// I posti li vedono capi, admin e ragazzi (non i visitatori: ci sono contatti personali);
// li aggiungono, modificano ed eliminano solo capi e admin.

const CARTELLA_POSTI = path.join(__dirname, 'uploads', 'posti');
fs.mkdirSync(CARTELLA_POSTI, { recursive: true });
const MAX_NOME_POSTO = 100;
const MAX_INDIRIZZO_POSTO = 200;
const MAX_DESCRIZIONE_POSTO = 5000;
const MAX_CONTATTI_POSTO = 10;
const MAX_CAMPI_POSTO = 50;
const MAX_ALLEGATI_POSTO = 30;
const MAX_BYTE_ALLEGATO = 15 * 1024 * 1024;
const MAX_NOME_FILE = 150;
// Estensioni accettate: foto, documenti e tracce GPS (per i percorsi del clan).
// Oltre alle branche, un posto può essere di tutto il gruppo (bandierina viola).
const BRANCHE_POSTO = [...BRANCHE, 'gruppo'];
const ESTENSIONI_FOTO = ['jpg', 'jpeg', 'png', 'webp'];
const ESTENSIONI_FILE = ['pdf', 'gpx', 'kml', 'kmz', 'doc', 'docx', 'odt', 'xls', 'xlsx', 'ods',
    'ppt', 'pptx', 'txt', 'zip', 'heic', 'gif'];

const verificaUtenteMappa = verificaRuolo('capo', 'admin', 'ragazzo');

function allegatoPubblico(a) {
    return {
        id: a.id,
        tipo: a.tipo,
        nome: a.nome_originale,
        dimensione: a.dimensione,
        // Le foto si mostrano direttamente, i file si scaricano con il loro nome originale.
        // Tutti e due i link sono firmati: valgono un giorno e non si aprono senza firma.
        url: linkFirmato(a.percorso),
        url_scarica: linkFirmato(`/api/posti/allegati/${path.basename(a.percorso)}`),
    };
}

// Colonne JSON (contatti, campi): se il testo è illeggibile si considera un elenco vuoto.
function leggiElenco(testoJson) {
    try {
        const valore = JSON.parse(testoJson || '[]');
        return Array.isArray(valore) ? valore : [];
    } catch {
        return [];
    }
}

function postoPubblico(p, allegati = []) {
    const contatti = leggiElenco(p.contatti);
    return {
        id: p.id,
        nome: p.nome,
        branca: p.branca,
        latitudine: p.latitudine,
        longitudine: p.longitudine,
        indirizzo: p.indirizzo,
        descrizione: p.descrizione,
        contatti,
        campi: leggiElenco(p.campi),
        sede: p.sede === 1,
        allegati: allegati.map(allegatoPubblico),
        data_creazione: p.data_creazione,
        data_modifica: p.data_modifica,
    };
}

// Restituisce { errore } oppure { dati } con i campi già puliti.
function validaPosto(body) {
    const nome = testo(body.nome);
    const branca = String(body.branca ?? '');
    const latitudine = typeof body.latitudine === 'number' ? body.latitudine : NaN;
    const longitudine = typeof body.longitudine === 'number' ? body.longitudine : NaN;
    const indirizzo = testo(body.indirizzo) || null;
    const descrizione = testo(body.descrizione) || null;

    if (!nome) return { errore: "Il nome del posto è obbligatorio." };
    if (nome.length > MAX_NOME_POSTO) return { errore: `Il nome può avere al massimo ${MAX_NOME_POSTO} caratteri.` };
    if (!BRANCHE_POSTO.includes(branca)) return { errore: "Scegli la branca: branco, reparto, clan o gruppo." };
    if (!Number.isFinite(latitudine) || !Number.isFinite(longitudine)
        || Math.abs(latitudine) > 90 || Math.abs(longitudine) > 180)
        return { errore: "Segna sulla mappa dove si trova il posto." };
    if (indirizzo && indirizzo.length > MAX_INDIRIZZO_POSTO) return { errore: "L'indirizzo è troppo lungo." };
    if (descrizione && descrizione.length > MAX_DESCRIZIONE_POSTO) return { errore: "La descrizione è troppo lunga." };

    const grezzi = body.contatti ?? [];
    if (!Array.isArray(grezzi)) return { errore: "Contatti non validi." };
    if (grezzi.length > MAX_CONTATTI_POSTO) return { errore: `Puoi inserire al massimo ${MAX_CONTATTI_POSTO} contatti.` };
    const contatti = [];
    for (const c of grezzi) {
        const contatto = { nome: testo(c?.nome), telefono: testo(c?.telefono), email: testo(c?.email) };
        // Le righe lasciate vuote si ignorano.
        if (!contatto.nome && !contatto.telefono && !contatto.email) continue;
        if (contatto.nome.length > 80 || contatto.telefono.length > 30 || contatto.email.length > 120)
            return { errore: "Uno dei contatti ha un campo troppo lungo." };
        if (contatto.telefono && !/^\+?[\d\s./-]{3,}$/.test(contatto.telefono))
            return { errore: `Il numero "${contatto.telefono}" non sembra un telefono.` };
        if (contatto.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contatto.email))
            return { errore: `L'email "${contatto.email}" non è valida.` };
        contatti.push(contatto);
    }

    // Campi fatti nel posto: facoltativi; la fine c'è solo se il campo dura più giorni.
    const campiGrezzi = body.campi ?? [];
    if (!Array.isArray(campiGrezzi)) return { errore: "Date dei campi non valide." };
    if (campiGrezzi.length > MAX_CAMPI_POSTO) return { errore: `Puoi inserire al massimo ${MAX_CAMPI_POSTO} campi.` };
    const campi = [];
    for (const c of campiGrezzi) {
        const inizio = c?.data_inizio || null;
        const fine = c?.data_fine || null;
        // Le righe lasciate vuote si ignorano.
        if (!inizio && !fine) continue;
        if (!inizio) return { errore: "Per ogni campo indica il giorno di inizio." };
        if (!dataValida(inizio) || (fine && !dataValida(fine))) return { errore: "Una delle date dei campi non è valida." };
        if (fine && fine < inizio) return { errore: "La fine di un campo non può essere prima dell'inizio." };
        campi.push({ data_inizio: inizio, data_fine: fine && fine !== inizio ? fine : null });
    }
    // Dal più recente.
    campi.sort((a, b) => b.data_inizio.localeCompare(a.data_inizio));

    return {
        dati: {
            nome, branca, latitudine, longitudine, indirizzo, descrizione,
            contatti: JSON.stringify(contatti),
            campi: JSON.stringify(campi),
        }
    };
}

async function inviaPosto(res, id, stato = 200) {
    try {
        const posto = await dbGet('SELECT * FROM posto WHERE id = ?', [id]);
        if (!posto) return res.status(404).json({ error: "Posto non trovato." });
        const allegati = await dbAll('SELECT * FROM posto_allegato WHERE rif_posto = ? ORDER BY id', [posto.id]);
        res.status(stato).json({ posto: postoPubblico(posto, allegati) });
    } catch (err) {
        erroreInterno(res, err);
    }
}

// La sede del gruppo: questa la vedono tutti, anche chi non è entrato nel sito
// ("Dove siamo" nel menu). Esce solo il punto sulla mappa, senza i contatti.
app.get('/api/sede', async (req, res) => {
    try {
        const sede = await dbGet('SELECT nome, indirizzo, latitudine, longitudine FROM posto WHERE sede = 1');
        if (!sede) return res.status(404).json({ error: "La sede non è ancora stata segnata." });
        res.json({ sede });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.get('/api/posti', verificaUtenteMappa, async (req, res) => {
    try {
        const posti = await dbAll('SELECT * FROM posto ORDER BY lower(nome), id');
        const allegati = await dbAll('SELECT * FROM posto_allegato ORDER BY id');
        const perPosto = new Map();
        for (const a of allegati) perPosto.set(a.rif_posto, [...(perPosto.get(a.rif_posto) ?? []), a]);
        res.json({ posti: posti.map(p => postoPubblico(p, perPosto.get(p.id))) });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.get('/api/posti/:id', verificaUtenteMappa, (req, res) => inviaPosto(res, req.params.id));

app.post('/api/posti', verificaRuolo('capo', 'admin'), async (req, res) => {
    const { errore, dati } = validaPosto(req.body || {});
    if (errore) return res.status(400).json({ error: errore });
    try {
        // I posti nuovi non sono mai la sede: quella c'è già.
        const esito = await dbRun(`INSERT INTO posto (nome, branca, latitudine, longitudine, indirizzo, descrizione, contatti,
                                   campi, rif_autore)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            // I contatti (custodi, gestori: nomi, telefoni, email) si salvano cifrati.
            [dati.nome, dati.branca, dati.latitudine, dati.longitudine, dati.indirizzo, dati.descrizione, cripta(dati.contatti),
             dati.campi, req.user.id]);
        inviaPosto(res, esito.lastID, 201);
    } catch (err) {
        erroreInterno(res, err);
    }
});

// La sede resta sempre del gruppo: della sede si cambiano posizione e dati, non la bandierina.
app.put('/api/posti/:id', verificaRuolo('capo', 'admin'), async (req, res) => {
    const { errore, dati } = validaPosto(req.body || {});
    if (errore) return res.status(400).json({ error: errore });
    try {
        const esito = await dbRun(`UPDATE posto SET nome = ?, branca = CASE WHEN sede = 1 THEN 'gruppo' ELSE ? END,
                                   latitudine = ?, longitudine = ?, indirizzo = ?, descrizione = ?, contatti = ?,
                                   campi = ?,
                                   data_modifica = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                                   WHERE id = ?`,
            [dati.nome, dati.branca, dati.latitudine, dati.longitudine, dati.indirizzo, dati.descrizione, cripta(dati.contatti),
             dati.campi, req.params.id]);
        if (esito.changes === 0) return res.status(404).json({ error: "Posto non trovato." });
        inviaPosto(res, req.params.id);
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.delete('/api/posti/:id', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const posto = await dbGet('SELECT sede FROM posto WHERE id = ?', [req.params.id]);
        if (!posto) return res.status(404).json({ error: "Posto non trovato." });
        if (posto.sede === 1) return res.status(403).json({ error: "La sede del gruppo non si può eliminare." });
        const allegati = await dbAll('SELECT percorso FROM posto_allegato WHERE rif_posto = ?', [req.params.id]);
        // Gli allegati spariscono dal database insieme al posto (ON DELETE CASCADE), poi dal disco.
        const esito = await dbRun('DELETE FROM posto WHERE id = ? AND sede = 0', [req.params.id]);
        if (esito.changes === 0) return res.status(404).json({ error: "Posto non trovato." });
        for (const a of allegati) eliminaFile(CARTELLA_POSTI, a.percorso);
        res.json({ message: "Posto eliminato." });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// Un allegato alla volta, inviato così com'è (niente base64): il nome originale arriva
// nell'intestazione X-Nome-File, codificato con encodeURIComponent.
app.post('/api/posti/:id/allegati', verificaRuolo('capo', 'admin'),
    express.raw({ type: () => true, limit: MAX_BYTE_ALLEGATO }),
    async (req, res) => {
        let nome;
        try { nome = decodeURIComponent(String(req.headers['x-nome-file'] ?? '')); } catch { nome = ''; }
        // Solo il nome (niente cartelle) e senza caratteri di controllo.
        nome = path.basename(nome).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(-MAX_NOME_FILE);
        const dati = Buffer.isBuffer(req.body) ? req.body : null;
        const estensione = path.extname(nome).slice(1).toLowerCase();

        if (!nome || !estensione) return res.status(400).json({ error: "Il file non ha un nome valido." });
        const eFoto = ESTENSIONI_FOTO.includes(estensione);
        if (!eFoto && !ESTENSIONI_FILE.includes(estensione))
            return res.status(400).json({ error: `"${nome}": tipo di file non accettato.` });
        // Il file va inviato come application/octet-stream (o col suo tipo), non come modulo.
        if (!dati || !dati.length) return res.status(400).json({ error: `"${nome}" è vuoto.` });
        // Una foto dev'essere davvero una foto (si controllano i primi byte).
        if (eFoto && !FORMATI_FOTO.some(f => f.riconosci(dati)))
            return res.status(400).json({ error: `"${nome}" non è una foto JPG, PNG o WebP valida.` });

        try {
            const posto = await dbGet('SELECT id FROM posto WHERE id = ?', [req.params.id]);
            if (!posto) return res.status(404).json({ error: "Posto non trovato." });
            const { numero } = await dbGet('SELECT COUNT(*) AS numero FROM posto_allegato WHERE rif_posto = ?', [posto.id]);
            if (numero >= MAX_ALLEGATI_POSTO)
                return res.status(400).json({ error: `Un posto può avere al massimo ${MAX_ALLEGATI_POSTO} tra foto e file.` });

            const nomeSuDisco = `${crypto.randomUUID()}.${estensione === 'jpeg' ? 'jpg' : estensione}`;
            await fs.promises.writeFile(path.join(CARTELLA_POSTI, nomeSuDisco), dati);
            const percorso = `/uploads/posti/${nomeSuDisco}`;
            try {
                const esito = await dbRun(`INSERT INTO posto_allegato (rif_posto, tipo, nome_originale, percorso, dimensione)
                                           VALUES (?, ?, ?, ?, ?)`, [posto.id, eFoto ? 'foto' : 'file', nome, percorso, dati.length]);
                const allegato = await dbGet('SELECT * FROM posto_allegato WHERE id = ?', [esito.lastID]);
                res.status(201).json({ allegato: allegatoPubblico(allegato) });
            } catch (err) {
                eliminaFile(CARTELLA_POSTI, percorso);
                throw err;
            }
        } catch (err) {
            erroreInterno(res, err);
        }
    });

app.delete('/api/posti/:id/allegati/:idAllegato', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const allegato = await dbGet('SELECT * FROM posto_allegato WHERE id = ? AND rif_posto = ?',
            [req.params.idAllegato, req.params.id]);
        if (!allegato) return res.status(404).json({ error: "Allegato non trovato." });
        await dbRun('DELETE FROM posto_allegato WHERE id = ?', [allegato.id]);
        eliminaFile(CARTELLA_POSTI, allegato.percorso);
        res.json({ message: "Allegato eliminato." });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// Scarica un allegato con il suo nome originale. Il nome su disco è casuale e non si indovina,
// così il link funziona anche senza token (come le foto in /uploads).
app.get('/api/posti/allegati/:file', async (req, res) => {
    try {
        const file = path.basename(req.params.file);
        if (!firmaValida(`/api/posti/allegati/${file}`, req.query.scade, req.query.firma))
            return res.status(403).json({ error: "Link scaduto o non valido: riapri la pagina." });
        const allegato = await dbGet('SELECT * FROM posto_allegato WHERE percorso = ?', [`/uploads/posti/${file}`]);
        if (!allegato) return res.status(404).json({ error: "File non trovato." });
        res.download(path.join(CARTELLA_POSTI, file), allegato.nome_originale, (err) => {
            if (err && !res.headersSent) res.status(404).json({ error: "File non trovato." });
        });
    } catch (err) {
        erroreInterno(res, err);
    }
});


// ---------- Canzoniere ----------
// I canti li leggono tutti (anche i visitatori); li aggiungono, modificano ed eliminano capi e admin.

const SEZIONI_CANTO = ['preghiere', 'branco', 'reparto', 'clan', 'liturgici', 'fuoco'];
const MAX_TITOLO_CANTO = 120;
const MAX_TESTO_CANTO = 20000;
const MAX_CANTI_PDF = 150;
// Un accordo è una nota con, al massimo, quello che la completa: RE, SOLm7, FA#-, SIb, LA/DO#.
// "lalalala" o "Signor" cominciano con una nota ma non sono accordi. (Stessa regola del sito.)
const NOTA = '(DO|RE|MI|FA|SOL|LA|SI)(#|b)?';
const NUCLEO = `${NOTA}(m|min|maj|ma|dim|aug|sus[0-9]?|add[0-9]?|[0-9]{1,2}|\\+|-|°)*`;
const ACCORDO = new RegExp(`^${NUCLEO}(/(${NOTA})?)?\\\\?$`, 'i');
// Accordi attaccati senza spazio ("FA#-MI-"): solo in maiuscolo, se no "lalala" sembrerebbe LA LA LA.
const ACCORDI_UNITI = new RegExp(`^(${NUCLEO}){2,}$`);
// Un pezzetto staccato che completa l'accordo prima: "DO m", "LA 7".
const CODA = /^(m|min|maj|dim|aug|sus[0-9]?|add[0-9]?|[0-9]{1,2}|[+#b-]+)$/i;

// Segni a inizio riga per quando la regola da sola non basta ("La la la la" sono parole ma
// anche accordi): "~" = è testo, "^" = sono accordi. Chi legge il canto non li vede.
const SEGNO_TESTO = '~';
const SEGNO_ACCORDI = '^';
function segnoRiga(riga) {
    if (riga.startsWith(SEGNO_TESTO)) return { forzata: 'testo', riga: riga.slice(SEGNO_TESTO.length) };
    if (riga.startsWith(SEGNO_ACCORDI)) return { forzata: 'accordi', riga: riga.slice(SEGNO_ACCORDI.length) };
    return { forzata: null, riga };
}

// Nel testo dei canti il grassetto si scrive tra asterischi: **così**.
function senzaSegniGrassetto(testo) {
    return testo.replace(/\*\*/g, '');
}

/** Divide una riga nei pezzi normali e in quelli in grassetto. */
function pezziRiga(riga) {
    const pezzi = [];
    let grassetto = false;
    for (const parte of riga.split('**')) {
        if (parte) pezzi.push({ grassetto, testo: parte });
        grassetto = !grassetto;
    }
    return pezzi.length ? pezzi : [{ grassetto: false, testo: riga }];
}

function rigaDiAccordi(riga) {
    const { forzata, riga: senzaSegno } = segnoRiga(riga);
    if (forzata) return forzata === 'accordi';
    // Si tolgono i segni del grassetto, le parentesi e la punteggiatura.
    const parole = senzaSegniGrassetto(senzaSegno).trim().split(/\s+/)
        .map(p => p.replace(/[()[\]|,.:]/g, '')).filter(Boolean);
    if (!parole.length) return false;
    const accordo = (p) => ACCORDO.test(p) || ACCORDI_UNITI.test(p);
    return parole.some(accordo) && parole.every(p => accordo(p) || CODA.test(p));
}

// ---------- Cambio di tonalità degli accordi (stessa regola del sito, services/canti.ts) ----------
// Ogni nota diventa un numero da 0 a 11 (DO = 0 … SI = 11), si sposta di qualche semitono e si
// riscrive col nome nuovo, nello stesso modo in cui era scritta (RE, Re o re). Il resto
// dell'accordo (m, 7, sus4, -, /basso) resta com'è.
const SEMITONI = { DO: 0, RE: 2, MI: 4, FA: 5, SOL: 7, LA: 9, SI: 11 };
const NOMI_DIESIS = ['DO', 'DO#', 'RE', 'RE#', 'MI', 'FA', 'FA#', 'SOL', 'SOL#', 'LA', 'LA#', 'SI'];
const NOMI_BEMOLLE = ['DO', 'REb', 'RE', 'MIb', 'MI', 'FA', 'SOLb', 'SOL', 'LAb', 'LA', 'SIb', 'SI'];
const NOTA_INIZIO = /^(DO|RE|MI|FA|SOL|LA|SI)(#|b)?/i;
// Quello che viene dopo la nota. "m" solo minuscola: in "FA#-MI-" la M è già la nota dopo.
const FINALE_ACCORDO = /^(min|maj|ma|dim|aug|sus[0-9]?|add[0-9]?|[0-9]{1,2}|m|\+|-|°)/;
// Le tonalità maggiori che si scrivono coi bemolle: FA, SIb, MIb, LAb, REb.
const TONALITA_BEMOLLE = new Set([5, 10, 3, 8, 1]);
const giro = (n) => ((n % 12) + 12) % 12;

function semitonoDi(nota) {
    const [, lettere, alterazione] = nota.match(NOTA_INIZIO);
    return giro(SEMITONI[lettere.toUpperCase()] + (alterazione === '#' ? 1 : alterazione ? -1 : 0));
}

/** Il nome della nota, scritto come l'originale: tutto maiuscolo, solo l'iniziale o tutto minuscolo. */
function nomeNota(semitono, bemolle, comeEra) {
    const nome = (bemolle ? NOMI_BEMOLLE : NOMI_DIESIS)[giro(semitono)];
    const lettere = comeEra.replace(/[#b]$/i, '');
    const radice = nome.replace(/[#b]$/, '');
    const segno = nome.slice(radice.length);
    if (lettere === lettere.toUpperCase()) return radice + segno;
    if (lettere[0] === lettere[0].toUpperCase()) return radice[0] + radice.slice(1).toLowerCase() + segno;
    return radice.toLowerCase() + segno;
}

/** Un accordo spostato di `passo` semitoni; null se non si riesce a leggerlo (resta com'era). */
function spostaAccordo(accordo, passo, bemolle) {
    let resto = accordo;
    let fuori = '';
    while (resto) {
        const nota = resto.match(NOTA_INIZIO);
        if (!nota) return null;
        fuori += nomeNota(semitonoDi(nota[0]) + passo, bemolle, nota[0]);
        resto = resto.slice(nota[0].length);
        let finale;
        while ((finale = resto.match(FINALE_ACCORDO))) {
            fuori += finale[0];
            resto = resto.slice(finale[0].length);
        }
        if (resto.startsWith('/')) {
            fuori += '/';
            resto = resto.slice(1);
            const basso = resto.match(NOTA_INIZIO);
            if (basso) {
                fuori += nomeNota(semitonoDi(basso[0]) + passo, bemolle, basso[0]);
                resto = resto.slice(basso[0].length);
            }
        }
        if (resto.startsWith('\\')) {
            fuori += '\\';
            resto = resto.slice(1);
        }
    }
    return fuori;
}

/** Il primo accordo del canto: da lì si capisce la tonalità (e se è minore). */
function primoAccordo(testo) {
    for (const riga of String(testo).split('\n')) {
        if (!rigaDiAccordi(riga)) continue;
        for (const parola of senzaSegniGrassetto(segnoRiga(riga).riga).trim().split(/\s+/)) {
            const pulita = parola.replace(/^[(\[|]+|[)\]|,.:]+$/g, '');
            if (NOTA_INIZIO.test(pulita)) return pulita;
        }
    }
    return null;
}

/**
 * Diesis o bemolle per la tonalità di arrivo: "auto" guarda il primo accordo (in FA si scrive
 * SIb, non LA#; una tonalità minore si scrive come la sua relativa maggiore).
 */
function usaBemolle(testo, passo, alterazioni = 'auto') {
    if (alterazioni === 'diesis') return false;
    if (alterazioni === 'bemolle') return true;
    const primo = primoAccordo(testo);
    if (!primo) return false;
    const dopoNota = primo.slice(primo.match(NOTA_INIZIO)[0].length);
    const minore = /^(m(?!a)|-)/.test(dopoNota);
    return TONALITA_BEMOLLE.has(giro(semitonoDi(primo) + passo + (minore ? 3 : 0)));
}

/**
 * Una riga di accordi spostata di `passo` semitoni. Ogni accordo resta nella sua colonna
 * (sopra la stessa sillaba); se uno diventa più lungo, sposta solo quello che viene dopo.
 */
function trasponiRiga(riga, passo, bemolle) {
    const { forzata, riga: senzaSegno } = segnoRiga(riga);
    const segno = forzata === 'testo' ? SEGNO_TESTO : forzata === 'accordi' ? SEGNO_ACCORDI : '';
    let fuori = '';
    for (const pezzo of senzaSegno.matchAll(/\S+/g)) {
        // Asterischi del grassetto, parentesi e punteggiatura restano attaccati com'erano.
        const [, prima, cuore, dopo] = pezzo[0].match(/^([*(\[|]*)(.*?)([*)\]|,.:]*)$/);
        const spostato = cuore && (ACCORDO.test(cuore) || ACCORDI_UNITI.test(cuore))
            ? spostaAccordo(cuore, passo, bemolle) : null;
        const nuovo = prima + (spostato ?? cuore) + dopo;
        const colonna = fuori ? Math.max(pezzo.index, fuori.length + 1) : pezzo.index;
        fuori = fuori.padEnd(colonna, ' ') + nuovo;
    }
    return segno + fuori;
}

/** Il testo del canto con gli accordi spostati (le righe di parole restano uguali). */
function trasponiTesto(testo, passo, alterazioni = 'auto') {
    const spostamento = giro(passo);
    if (!spostamento && alterazioni === 'auto') return testo;
    const bemolle = usaBemolle(testo, passo, alterazioni);
    return testo.split('\n').map(r => rigaDiAccordi(r) ? trasponiRiga(r, spostamento, bemolle) : r).join('\n');
}

/** "MI", "SI minore"…: la tonalità di arrivo, detta come la si dice. */
function nomeTonalita(testo, passo, alterazioni = 'auto') {
    const primo = primoAccordo(testo);
    if (!primo) return null;
    const nota = primo.match(NOTA_INIZIO)[0];
    const minore = /^(m(?!a)|-)/.test(primo.slice(nota.length));
    return nomeNota(semitonoDi(nota) + passo, usaBemolle(testo, passo, alterazioni), 'X') + (minore ? ' minore' : '');
}

/** Prima riga cantata del canto, per far capire di quale si tratta nell'elenco. */
function anteprimaCanto(testo) {
    const riga = testo.split('\n').find(r => r.trim() && !rigaDiAccordi(r));
    return riga ? senzaSegniGrassetto(segnoRiga(riga).riga).trim().slice(0, 120) : '';
}

function cantoPubblico(c, conTesto = true) {
    return {
        id: c.id,
        titolo: c.titolo,
        sezione: c.sezione,
        ...(conTesto ? { testo: c.testo } : { anteprima: anteprimaCanto(c.testo) }),
        // Tonalità del gruppo: semitoni rispetto agli accordi scritti (0 = come sono scritti).
        trasposizione: c.trasposizione ?? 0,
        data_creazione: c.data_creazione,
        data_modifica: c.data_modifica,
    };
}

function validaCanto(body) {
    const titolo = testo(body.titolo);
    const sezione = String(body.sezione ?? '');
    const contenuto = typeof body.testo === 'string' ? body.testo.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim() : '';

    if (!titolo) return { errore: "Il titolo è obbligatorio." };
    if (titolo.length > MAX_TITOLO_CANTO) return { errore: `Il titolo può avere al massimo ${MAX_TITOLO_CANTO} caratteri.` };
    if (!SEZIONI_CANTO.includes(sezione))
        return { errore: "Scegli la sezione: preghiere, branco, reparto, clan, liturgici o fuoco." };
    if (!contenuto) return { errore: "Scrivi il testo del canto." };
    if (contenuto.length > MAX_TESTO_CANTO) return { errore: "Il testo è troppo lungo." };

    return { dati: { titolo, sezione, testo: contenuto } };
}

async function inviaCanto(res, id, stato = 200) {
    try {
        const canto = await dbGet('SELECT * FROM canto WHERE id = ?', [id]);
        if (!canto) return res.status(404).json({ error: "Canto non trovato." });
        res.status(stato).json({ canto: cantoPubblico(canto) });
    } catch (err) {
        erroreInterno(res, err);
    }
}

// Elenco senza il testo intero: ?cerca=parole (nel titolo e nel testo), ?sezione=branco…
app.get('/api/canti', async (req, res) => {
    const sezione = SEZIONI_CANTO.includes(req.query.sezione) ? req.query.sezione : null;
    const cerca = testo(req.query.cerca);
    const condizioni = [];
    const parametri = [];
    if (sezione) {
        condizioni.push('sezione = ?');
        parametri.push(sezione);
    }
    if (cerca) {
        // Tutte le parole cercate devono comparire nel titolo o nel testo.
        for (const parola of cerca.split(/\s+/).slice(0, 6)) {
            // ILIKE: senza badare alle maiuscole, come prima.
            condizioni.push('(titolo ILIKE ? OR testo ILIKE ?)');
            parametri.push(`%${parola}%`, `%${parola}%`);
        }
    }
    const dove = condizioni.length ? `WHERE ${condizioni.join(' AND ')}` : '';
    try {
        const righe = await dbAll(`SELECT * FROM canto ${dove} ORDER BY lower(titolo)`, parametri);
        res.json({ canti: righe.map(c => cantoPubblico(c, false)) });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// ---------- Canzoniere in PDF ----------
// Raccoglie i canti scelti in un unico file, con o senza accordi.

const PDFDocument = require('pdfkit');

const VIOLA = '#462678';
const VIOLA_CHIARO = '#7D57C2';
const GRIGIO = '#64748B';
const COLORI_SEZIONE = {
    preghiere: '#7D57C2', branco: '#5A9E2A', reparto: '#B98A00',
    clan: '#D8392F', liturgici: '#0B87A8', fuoco: '#E36F3C',
};
const NOMI_SEZIONE = {
    preghiere: 'Preghiere', branco: 'Branco', reparto: 'Reparto',
    clan: 'Clan', liturgici: 'Liturgici', fuoco: 'Al fuoco',
};
const MARGINE = 42;
// Stesso carattere e stessa dimensione per tutti i canti, così due canti stampati insieme
// si leggono uguali. Courier: ogni lettera è larga 0,6 volte la dimensione.
const DIMENSIONE_TESTO = 9;
const INTERLINEA = DIMENSIONE_TESTO * 1.32;
const LARGHEZZA_LETTERA = DIMENSIONE_TESTO * 0.602;
const ALTEZZA_TESTATA = 54;

/** Barra viola in cima a ogni pagina, come quella del sito. */
function testata(doc, sottotitolo) {
    const larghezza = doc.page.width - MARGINE * 2;
    doc.save();
    doc.roundedRect(MARGINE, MARGINE - 14, larghezza, ALTEZZA_TESTATA - 12, 14).fill(VIOLA);
    try {
        doc.image(path.join(__dirname, 'dati', 'logo.png'), MARGINE + 12, MARGINE - 8, { width: 30 });
    } catch { /* senza logo la barra resta comunque */ }
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13)
        .text('PALERMO 11', MARGINE + 50, MARGINE - 4);
    doc.font('Helvetica').fontSize(8).fillColor('#E3C0FF')
        .text('GRUPPO SCOUT AGESCI', MARGINE + 50, MARGINE + 12);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF')
        .text(sottotitolo, MARGINE, MARGINE + 2, { width: larghezza - 14, align: 'right' });
    doc.restore();
}

function piePagina(doc, numero) {
    const y = doc.page.height - MARGINE + 6;
    // Il piè di pagina sta sotto il margine: senza questo pdfkit aggiungerebbe una pagina.
    const margineSotto = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.save().font('Helvetica').fontSize(8).fillColor(GRIGIO)
        .text(`Canzoniere Palermo 11 · pagina ${numero}`, MARGINE, y,
            { width: doc.page.width - MARGINE * 2, align: 'center', lineBreak: false });
    doc.restore();
    doc.page.margins.bottom = margineSotto;
}

/** Toglie le righe dei soli accordi (stessa regola del sito). */
function soloParole(testo) {
    return testo.split('\n').filter(r => !rigaDiAccordi(r)).join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * `tonalita`: per un canto solo, quella scelta da chi scarica ({ passo, capotasto, alterazioni });
 * altrimenti ogni canto esce nella tonalità del gruppo.
 */
function creaPdfCanzoniere(canti, conAccordi, res, tonalita = null) {
    const doc = new PDFDocument({ size: 'A4', margins: { top: MARGINE + ALTEZZA_TESTATA, bottom: MARGINE + 14, left: MARGINE, right: MARGINE } });
    let pagina = 0;
    const nuovaPagina = () => {
        pagina += 1;
        testata(doc, canti.length === 1 ? 'Canzoniere' : `Canzoniere · ${canti.length} canti`);
        piePagina(doc, pagina);
        doc.y = MARGINE + ALTEZZA_TESTATA;
    };
    doc.on('pageAdded', nuovaPagina);

    res.setHeader('Content-Type', 'application/pdf');
    const nomeFile = canti.length === 1
        ? `${canti[0].titolo.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'canto'}.pdf`
        : 'canzoniere-palermo11.pdf';
    res.setHeader('Content-Disposition', `attachment; filename="${nomeFile}"; filename*=UTF-8''${encodeURIComponent(nomeFile)}`);
    doc.pipe(res);

    nuovaPagina();
    const larghezza = doc.page.width - MARGINE * 2;

    // Indice, quando i canti sono parecchi: titolo a sinistra, sezione a destra.
    if (canti.length >= 4) {
        doc.font('Helvetica-Bold').fontSize(16).fillColor(VIOLA).text('Indice', MARGINE, doc.y + 6, { lineBreak: false });
        let y = doc.y + 24;
        for (const c of canti) {
            if (y > doc.page.height - MARGINE - 30) {
                doc.addPage();
                y = doc.y;
            }
            const colore = COLORI_SEZIONE[c.sezione] ?? VIOLA;
            doc.circle(MARGINE + 3, y + 5, 3).fill(colore);
            doc.font('Helvetica').fontSize(10).fillColor('#0F172A')
                .text(c.titolo, MARGINE + 14, y, { width: larghezza - 100, lineBreak: false, ellipsis: true });
            doc.font('Helvetica').fontSize(9).fillColor(GRIGIO)
                .text(NOMI_SEZIONE[c.sezione] ?? '', MARGINE, y + 1, { width: larghezza, align: 'right', lineBreak: false });
            y += 17;
        }
        doc.y = y;
        doc.addPage();
    }

    for (const [i, c] of canti.entries()) {
        const passo = tonalita ? tonalita.passo : (c.trasposizione ?? 0);
        const capotasto = tonalita?.capotasto ?? 0;
        const alterazioni = tonalita?.alterazioni ?? 'auto';
        // Con il capotasto si scrivono le posizioni da fare: la tonalità che si sente resta `passo`.
        const testo = conAccordi ? trasponiTesto(c.testo, passo - capotasto, alterazioni) : soloParole(c.testo);
        const righe = testo.split('\n');
        const colore = COLORI_SEZIONE[c.sezione] ?? VIOLA;

        const altezzaCanto = 34 + righe.length * INTERLINEA;
        const spazioRimasto = doc.page.height - MARGINE - 14 - doc.y;
        // Si va a pagina nuova se il canto non ci sta e ne resta poco, oppure se in fondo
        // alla pagina entrerebbero solo il titolo e due righe.
        // Pagina nuova solo se in fondo resterebbe spazio per poco più del titolo.
        if (i > 0 && spazioRimasto < 150) doc.addPage();
        else if (i > 0) doc.y += 18;

        doc.font('Helvetica-Bold').fontSize(8).fillColor(colore)
            .text((NOMI_SEZIONE[c.sezione] ?? '').toUpperCase(), MARGINE, doc.y, { characterSpacing: 0.8 });
        doc.font('Helvetica-Bold').fontSize(14).fillColor('#0F172A').text(c.titolo, MARGINE, doc.y + 1);
        // Se gli accordi non sono quelli scritti, si dice in che tonalità sono.
        if (conAccordi && (giro(passo) || capotasto)) {
            const tono = nomeTonalita(c.testo, passo, alterazioni);
            const parti = [tono ? `Tonalità: ${tono}` : 'Tonalità cambiata',
                capotasto ? `capotasto al ${capotasto}° tasto` : null].filter(Boolean);
            doc.font('Helvetica').fontSize(8.5).fillColor(GRIGIO).text(parti.join(' · '), MARGINE, doc.y + 1);
        }
        doc.moveDown(0.4);

        for (const riga of righe) {
            if (doc.y > doc.page.height - MARGINE - 24) doc.addPage();
            const accordi = rigaDiAccordi(riga);
            const senzaSegno = segnoRiga(riga).riga;
            const pulita = senzaSegniGrassetto(senzaSegno);
            // Le pochissime righe più larghe della pagina vanno a capo, invece di sforare.
            const troppoLunga = pulita.length * LARGHEZZA_LETTERA > larghezza;
            const opzioni = troppoLunga ? { width: larghezza } : { lineBreak: false, width: larghezza * 2 };
            // Gli accordi sono già tutti in neretto; i versi seguono gli **asterischi**.
            // Courier normale e grassetto sono larghi uguali, quindi l'allineamento non cambia.
            const pezzi = accordi ? [{ grassetto: true, testo: pulita || ' ' }] : pezziRiga(senzaSegno || ' ');
            const partenza = doc.y;
            doc.fontSize(DIMENSIONE_TESTO).fillColor(accordi ? colore : '#0F172A');
            pezzi.forEach((pezzo, indice) => {
                doc.font(pezzo.grassetto ? 'Courier-Bold' : 'Courier');
                const continua = indice < pezzi.length - 1;
                if (indice === 0) doc.text(pezzo.testo, MARGINE, partenza, { ...opzioni, continued: continua });
                else doc.text(pezzo.testo, { ...opzioni, continued: continua });
            });
            doc.y += INTERLINEA - DIMENSIONE_TESTO;
        }
    }

    doc.end();
}

// ?ids=1,2,3 &accordi=0|1 — i canti li può scaricare chiunque, come il canzoniere del sito.
// Per un canto solo anche la tonalità di chi scarica: &passo=-11…11 &capotasto=0…11
// &alterazioni=auto|diesis|bemolle. Senza, ogni canto esce nella tonalità del gruppo.
app.get('/api/canti/pdf/scarica', async (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').map(n => Number.parseInt(n, 10))
        .filter(n => Number.isInteger(n) && n > 0).slice(0, MAX_CANTI_PDF);
    if (!ids.length) return res.status(400).json({ error: "Scegli almeno un canto." });
    const conAccordi = req.query.accordi !== '0';
    let tonalita = null;
    if (ids.length === 1 && req.query.passo !== undefined) {
        const passo = Number(req.query.passo);
        const capotasto = Number(req.query.capotasto ?? 0);
        const alterazioni = ['auto', 'diesis', 'bemolle'].includes(req.query.alterazioni) ? req.query.alterazioni : 'auto';
        if (!Number.isInteger(passo) || passo < -11 || passo > 11 || !Number.isInteger(capotasto) || capotasto < 0 || capotasto > 11)
            return res.status(400).json({ error: "Tonalità non valida." });
        tonalita = { passo, capotasto, alterazioni };
    }
    try {
        const righe = await dbAll(
            `SELECT * FROM canto WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY lower(titolo)`, ids);
        if (!righe.length) return res.status(404).json({ error: "Nessuno dei canti scelti esiste più." });
        creaPdfCanzoniere(righe, conAccordi, res, tonalita);
    } catch (err) {
        if (!res.headersSent) erroreInterno(res, err);
    }
});


app.get('/api/canti/:id', (req, res) => inviaCanto(res, req.params.id));

app.post('/api/canti', verificaRuolo('capo', 'admin'), async (req, res) => {
    const { errore, dati } = validaCanto(req.body || {});
    if (errore) return res.status(400).json({ error: errore });
    try {
        const esito = await dbRun('INSERT INTO canto (titolo, sezione, testo, rif_autore) VALUES (?, ?, ?, ?)',
            [dati.titolo, dati.sezione, dati.testo, req.user.id]);
        inviaCanto(res, esito.lastID, 201);
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.put('/api/canti/:id', verificaRuolo('capo', 'admin'), async (req, res) => {
    const { errore, dati } = validaCanto(req.body || {});
    if (errore) return res.status(400).json({ error: errore });
    try {
        const esito = await dbRun(`UPDATE canto SET titolo = ?, sezione = ?, testo = ?,
                                   data_modifica = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE id = ?`,
            [dati.titolo, dati.sezione, dati.testo, req.params.id]);
        if (esito.changes === 0) return res.status(404).json({ error: "Canto non trovato." });
        inviaCanto(res, req.params.id);
    } catch (err) {
        erroreInterno(res, err);
    }
});

// La tonalità del gruppo: la scelgono i capi, il testo con gli accordi originali non cambia.
app.put('/api/canti/:id/tonalita', verificaRuolo('capo', 'admin'), async (req, res) => {
    const passo = Number(req.body?.trasposizione);
    if (!Number.isInteger(passo) || passo < -11 || passo > 11)
        return res.status(400).json({ error: "La tonalità va indicata in semitoni, da -11 a +11." });
    try {
        const esito = await dbRun(`UPDATE canto SET trasposizione = ? WHERE id = ?`, [passo, req.params.id]);
        if (esito.changes === 0) return res.status(404).json({ error: "Canto non trovato." });
        inviaCanto(res, req.params.id);
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.delete('/api/canti/:id', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const esito = await dbRun('DELETE FROM canto WHERE id = ?', [req.params.id]);
        if (esito.changes === 0) return res.status(404).json({ error: "Canto non trovato." });
        res.json({ message: "Canto eliminato." });
    } catch (err) {
        erroreInterno(res, err);
    }
});


// ---------- Richieste di iscrizione ----------

// Chi vuole entrare nel gruppo (o iscrivere un figlio) manda il modulo dalla home, senza account.
// La branca si ricava dall'anno scolastico che sta facendo adesso, secondo il criterio del gruppo:
// dalla 3ª elementare alla 5ª superiore. La richiesta arriva poi ai capi di quella branca.
// Stesso elenco di src/app/services/iscrizioni.ts.
// `classe` è la classe contata dalla prima elementare (3 = 3ª elementare, 6 = 1ª media,
// 9 = 1ª superiore): serve per confrontarla con l'età e per l'anno di percorso.
const ANNI_SCOLASTICI = [
    { valore: 'elementare-3', nome: '3ª elementare', classe: 3, branca: 'branco', anno: 1, tappa: '1° anno di branco' },
    { valore: 'elementare-4', nome: '4ª elementare', classe: 4, branca: 'branco', anno: 2, tappa: '2° anno di branco' },
    { valore: 'elementare-5', nome: '5ª elementare', classe: 5, branca: 'branco', anno: 3, tappa: '3° anno di branco (CdA)' },
    { valore: 'media-1', nome: '1ª media', classe: 6, branca: 'reparto', anno: 1, tappa: '1° anno di reparto' },
    { valore: 'media-2', nome: '2ª media', classe: 7, branca: 'reparto', anno: 2, tappa: '2° anno di reparto' },
    { valore: 'media-3', nome: '3ª media', classe: 8, branca: 'reparto', anno: 3, tappa: '3° anno di reparto' },
    { valore: 'superiore-1', nome: '1ª superiore', classe: 9, branca: 'reparto', anno: 4, tappa: '4° anno di reparto' },
    { valore: 'superiore-2', nome: '2ª superiore', classe: 10, branca: 'reparto', anno: 5, tappa: '5° anno di reparto' },
    { valore: 'superiore-3', nome: '3ª superiore', classe: 11, branca: 'clan', anno: 1, tappa: 'noviziato' },
    { valore: 'superiore-4', nome: '4ª superiore', classe: 12, branca: 'clan', anno: 2, tappa: '1° anno di clan' },
    { valore: 'superiore-5', nome: '5ª superiore', classe: 13, branca: 'clan', anno: 3, tappa: '2° anno di clan' },
];

/** Branca e anno di percorso di una classe scolastica (3 = 3ª elementare … 13 = 5ª superiore). */
function tappaDaClasse(classe) {
    const limitata = Math.min(13, Math.max(3, classe));
    const riga = ANNI_SCOLASTICI.find(a => a.classe === limitata);
    return riga ? { branca: riga.branca, anno: riga.anno, nome: riga.nome } : null;
}
const ANNI_PER_VALORE = new Map(ANNI_SCOLASTICI.map(a => [a.valore, a]));
const STATI_RICHIESTA = ['nuova', 'letta', 'archiviata'];
const MAX_NOTE_RICHIESTA = 1000;
const MAX_NOME_RICHIESTA = 60;
const MAX_INDIRIZZO = 200;

// Il modulo è aperto a tutti: si accettano al massimo 5 richieste all'ora dallo stesso indirizzo,
// così una pagina pubblica non può riempire il database.
const MAX_RICHIESTE_ORA = 5;
const inviiRecenti = new Map();
function troppeRichieste(req) {
    const ora = Date.now();
    const chiave = req.ip || 'sconosciuto';
    const recenti = (inviiRecenti.get(chiave) || []).filter(t => ora - t < 60 * 60 * 1000);
    if (recenti.length >= MAX_RICHIESTE_ORA) return true;
    recenti.push(ora);
    inviiRecenti.set(chiave, recenti);
    // Ogni tanto si ripulisce la mappa dagli indirizzi vecchi.
    if (inviiRecenti.size > 500) for (const [k, v] of inviiRecenti)
        if (!v.some(t => ora - t < 60 * 60 * 1000)) inviiRecenti.delete(k);
    return false;
}

/** Controlla il modulo. Restituisce { errore } oppure { dati }. */
function validaRichiestaIscrizione(body) {
    const testo = (valore, max) => String(valore ?? '').trim().slice(0, max);
    const nome = testo(body.nome, MAX_NOME_RICHIESTA);
    const cognome = testo(body.cognome, MAX_NOME_RICHIESTA);
    if (!nome || !cognome) return { errore: "Nome e cognome sono obbligatori." };

    const dataNascita = testo(body.data_nascita, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataNascita)) return { errore: "Scrivi la data di nascita." };
    // Data letta come giorno locale (niente fusi orari, come nel calendario).
    const [anno4, mese, giornoMese] = dataNascita.split('-').map(Number);
    const giorno = new Date(anno4, mese - 1, giornoMese, 12);
    if (giorno.getFullYear() !== anno4 || giorno.getMonth() !== mese - 1 || giorno.getDate() !== giornoMese)
        return { errore: "La data di nascita non esiste." };
    if (giorno.getTime() > Date.now()) return { errore: "La data di nascita non può essere nel futuro." };

    const anno = ANNI_PER_VALORE.get(testo(body.anno_scolastico, 30));
    if (!anno) return { errore: "Scegli l'anno scolastico che stai facendo." };

    const telefono = testo(body.telefono, 20);
    const email = testo(body.email, 120).toLowerCase();
    if (telefono && !/^[0-9+\s().-]{6,20}$/.test(telefono))
        return { errore: "Il numero di telefono non sembra giusto." };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
        return { errore: "L'indirizzo email non sembra giusto." };
    if (!telefono && !email) return { errore: "Lascia almeno un contatto: telefono o email." };

    const indirizzo = testo(body.indirizzo, MAX_INDIRIZZO);
    if (!indirizzo) return { errore: "Scrivi l'indirizzo di casa." };

    // Almeno un genitore, con nome e cognome; l'altro è facoltativo, ma se c'è va scritto per intero.
    const genitore1Nome = testo(body.genitore1_nome, MAX_NOME_RICHIESTA);
    const genitore1Cognome = testo(body.genitore1_cognome, MAX_NOME_RICHIESTA);
    const genitore2Nome = testo(body.genitore2_nome, MAX_NOME_RICHIESTA);
    const genitore2Cognome = testo(body.genitore2_cognome, MAX_NOME_RICHIESTA);
    if (!genitore1Nome || !genitore1Cognome) return { errore: "Scrivi nome e cognome di almeno un genitore." };
    if (!!genitore2Nome !== !!genitore2Cognome) return { errore: "Del secondo genitore servono sia il nome sia il cognome." };

    // Catechismo: vuoto se non lo frequenta, altrimenti l'anno (dal 1° al 5°).
    let catechismo = null;
    if (body.catechismo !== null && body.catechismo !== undefined && body.catechismo !== '') {
        catechismo = Number(body.catechismo);
        if (!Number.isInteger(catechismo) || catechismo < 1 || catechismo > 5)
            return { errore: "Scegli l'anno di catechismo, dal 1° al 5°." };
    }

    return {
        dati: {
            genitore1_nome: genitore1Nome, genitore1_cognome: genitore1Cognome,
            genitore2_nome: genitore2Nome || null, genitore2_cognome: genitore2Cognome || null,
            nome, cognome, data_nascita: dataNascita, anno_scolastico: anno.valore, branca: anno.branca,
            telefono: telefono || null, email: email || null, note: testo(body.note, MAX_NOTE_RICHIESTA) || null,
            catechismo, indirizzo,
        }
    };
}

function richiestaPubblica(r) {
    return {
        id: r.id,
        nome: r.nome,
        cognome: r.cognome,
        data_nascita: r.data_nascita,
        anno_scolastico: r.anno_scolastico,
        branca: r.branca,
        telefono: r.telefono,
        email: r.email,
        // I genitori: il secondo può mancare. Le richieste arrivate prima non li hanno.
        genitori: [
            [r.genitore1_nome, r.genitore1_cognome],
            [r.genitore2_nome, r.genitore2_cognome],
        ].filter(([n, c]) => n && c).map(([n, c]) => `${n} ${c}`),
        // Anno di catechismo (1-5); null se non lo frequenta o se la richiesta è di prima.
        catechismo: r.catechismo ? Number(r.catechismo) : null,
        // Indirizzo di casa; null per le richieste arrivate prima che il modulo lo chiedesse.
        indirizzo: r.indirizzo || null,
        note: r.note,
        stato: r.stato,
        // Accettata o rifiutata dai capi; vuoto se non hanno ancora deciso.
        esito: r.esito || null,
        // Chi se ne sta occupando, se un capo l'ha già presa in carico.
        capo: r.capo_nome ? `${r.capo_nome} ${r.capo_cognome}` : null,
        data_creazione: r.data_creazione,
    };
}

/** La branca del capo, letta adesso dal database (nel token non c'è). */
async function brancaDelCapo(idUtente) {
    const riga = await dbGet('SELECT branca FROM utenti WHERE id = ?', [idUtente]);
    return riga?.branca ?? null;
}

// Elenco degli anni scolastici per il modulo (aperto a tutti, come il modulo stesso).
app.get('/api/anni-scolastici', (req, res) => res.json({ anni: ANNI_SCOLASTICI }));

const NOMI_BRANCA_EMAIL = { branco: 'Branco', reparto: 'Reparto', clan: 'Clan' };

/**
 * Avvisa per email i capi della branca della richiesta: gli stessi che la vedono nell'Area
 * capi (capi e capigruppo con quella branca). Uno per uno, così nessuno vede gli indirizzi
 * degli altri. Se un invio non va, gli altri partono lo stesso.
 */
async function avvisaCapiNuovaRichiesta(branca) {
    const capi = await dbAll(`SELECT nome, email FROM utenti WHERE ruolo IN ('capo', 'admin') AND branca = ?
                              AND email IS NOT NULL AND email <> ''`, [branca]);
    if (!capi.length) return;
    const nomeBranca = NOMI_BRANCA_EMAIL[branca] ?? branca;
    if (!postaPronta) {
        if (process.env.NODE_ENV !== 'production')
            console.warn(`✉️  (prova, posta non impostata) avviso di nuova richiesta per ${capi.length} capi del ${nomeBranca}`);
        return;
    }
    const link = `${SITO_URL}/area-capi`;
    for (const capo of capi) {
        try {
            await inviaEmail({ a: capo.email, ...emailNuovaRichiesta({ nome: capo.nome, branca: nomeBranca, link }) },
                             ATTESE_SOTTOFONDO);
        } catch (err) {
            console.error(`❌ Avviso di nuova richiesta non partito (${nomeBranca}):`, descriviErrore(err));
        }
    }
}

app.post('/api/richieste-iscrizione', async (req, res) => {
    if (troppeRichieste(req))
        return res.status(429).json({ error: "Hai già mandato diverse richieste: riprova più tardi." });
    const { errore, dati } = validaRichiestaIscrizione(req.body || {});
    if (errore) return res.status(400).json({ error: errore });
    try {
        await dbRun(`INSERT INTO richiesta_iscrizione (nome, cognome, data_nascita, anno_scolastico, branca,
                     telefono, email, note, genitore1_nome, genitore1_cognome, genitore2_nome, genitore2_cognome,
                     catechismo, indirizzo)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            // Data di nascita, contatti, note, genitori, catechismo e indirizzo si salvano cifrati.
            [dati.nome, dati.cognome, cripta(dati.data_nascita), dati.anno_scolastico, dati.branca,
             cripta(dati.telefono), cripta(dati.email), cripta(dati.note), cripta(dati.genitore1_nome),
             cripta(dati.genitore1_cognome), cripta(dati.genitore2_nome), cripta(dati.genitore2_cognome),
             cripta(dati.catechismo === null ? null : String(dati.catechismo)), cripta(dati.indirizzo)]);
        res.status(201).json({ message: "Richiesta inviata! I capi ti ricontattano presto.", branca: dati.branca });
        // Le email ai capi partono dopo aver risposto: chi compila il modulo non aspetta Gmail.
        avvisaCapiNuovaRichiesta(dati.branca).catch(err => console.error('❌ Avviso ai capi:', err.message));
    } catch (err) {
        erroreInterno(res, err);
    }
});

// I compleanni di oggi dei ragazzi della propria branca. Non si salva niente e non parte
// nessuna email: si calcola ogni volta dalla data di nascita, e domani non c'è più.
app.get('/api/compleanni-oggi', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const branca = await brancaDelCapo(req.user.id);
        if (!branca) return res.json({ compleanni: [] });
        const oggi = new Date();
        const mese = oggi.getMonth() + 1;
        const giorno = oggi.getDate();
        const anno = oggi.getFullYear();
        // Chi è nato il 29 febbraio, negli anni senza, lo festeggia il 28.
        const bisestile = (anno % 4 === 0 && anno % 100 !== 0) || anno % 400 === 0;
        const ragazzi = await dbAll(`SELECT nome, cognome, data_nascita FROM utenti
                                     WHERE ruolo = 'ragazzo' AND branca = ? AND data_nascita IS NOT NULL
                                     ORDER BY lower(cognome), lower(nome)`, [branca]);
        const compleanni = ragazzi.filter(r => {
            const [, m, g] = String(r.data_nascita).split('-').map(Number);
            return (m === mese && g === giorno) || (!bisestile && m === 2 && g === 29 && mese === 2 && giorno === 28);
        }).map(r => ({
            nome: r.nome,
            cognome: r.cognome,
            anni: anno - Number(String(r.data_nascita).slice(0, 4)),
        }));
        res.json({ compleanni });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// Notifiche dei capi: ognuno vede solo le richieste della propria branca.
app.get('/api/richieste-iscrizione', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const branca = await brancaDelCapo(req.user.id);
        if (!branca) return res.json({ branca: null, richieste: [] });
        const conArchiviate = String(req.query.archiviate ?? '') === '1';
        const righe = await dbAll(`SELECT r.*, u.nome AS capo_nome, u.cognome AS capo_cognome
                                   FROM richiesta_iscrizione r LEFT JOIN utenti u ON u.id = r.rif_capo
                                   WHERE r.branca = ?${conArchiviate ? '' : " AND r.stato <> 'archiviata'"}
                                   ORDER BY (r.stato = 'nuova') DESC, r.data_creazione DESC`, [branca]);
        res.json({ branca, richieste: righe.map(richiestaPubblica) });
    } catch (err) {
        erroreInterno(res, err);
    }
});

/** La richiesta esiste ed è della branca del capo? Altrimenti manda già la risposta di errore. */
async function richiestaDellaMiaBranca(req, res) {
    const branca = await brancaDelCapo(req.user.id);
    const riga = await dbGet('SELECT * FROM richiesta_iscrizione WHERE id = ?', [req.params.id]);
    if (!riga) {
        res.status(404).json({ error: "Richiesta non trovata." });
        return null;
    }
    if (!branca || riga.branca !== branca) {
        res.status(403).json({ error: "Questa richiesta è di un'altra branca." });
        return null;
    }
    return riga;
}

app.put('/api/richieste-iscrizione/:id/stato', verificaRuolo('capo', 'admin'), async (req, res) => {
    const stato = String(req.body?.stato ?? '');
    if (!STATI_RICHIESTA.includes(stato)) return res.status(400).json({ error: "Stato non valido." });
    try {
        if (!await richiestaDellaMiaBranca(req, res)) return;
        // Il capo che la prende in carico resta segnato; tornando a "nuova" il nome si rimuove.
        await dbRun(`UPDATE richiesta_iscrizione SET stato = ?, rif_capo = ?, data_archiviazione = ?
                     WHERE id = ?`,
            [stato, stato === 'nuova' ? null : req.user.id,
             stato === 'archiviata' ? new Date().toISOString().slice(0, 10) : null, req.params.id]);
        const riga = await dbGet(`SELECT r.*, u.nome AS capo_nome, u.cognome AS capo_cognome
                                  FROM richiesta_iscrizione r LEFT JOIN utenti u ON u.id = r.rif_capo
                                  WHERE r.id = ?`, [req.params.id]);
        res.json({ richiesta: richiestaPubblica(riga) });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// Accettare o rifiutare: la decisione dei capi sulla richiesta.
app.put('/api/richieste-iscrizione/:id/esito', verificaRuolo('capo', 'admin'), async (req, res) => {
    const esito = req.body?.esito === null || req.body?.esito === undefined ? null : String(req.body.esito);
    if (esito !== null && esito !== 'accettata' && esito !== 'rifiutata')
        return res.status(400).json({ error: "Esito non valido." });
    try {
        if (!await richiestaDellaMiaBranca(req, res)) return;
        // Una richiesta decisa è gestita: si archivia da sola (i 10 mesi di vita
        // partono comunque da quando è arrivata, vedi pulisciRichiesteVecchie).
        await dbRun(`UPDATE richiesta_iscrizione SET esito = ?, stato = ?, rif_capo = ?,
                     data_archiviazione = ? WHERE id = ?`,
            [esito, esito ? 'archiviata' : 'nuova', esito ? req.user.id : null,
             esito ? new Date().toISOString().slice(0, 10) : null, req.params.id]);
        const riga = await dbGet(`SELECT r.*, u.nome AS capo_nome, u.cognome AS capo_cognome
                                  FROM richiesta_iscrizione r LEFT JOIN utenti u ON u.id = r.rif_capo
                                  WHERE r.id = ?`, [req.params.id]);
        res.json({ richiesta: richiestaPubblica(riga) });
    } catch (err) {
        erroreInterno(res, err);
    }
});

/**
 * Le richieste accettate in un file Excel uguale a quello che si carica nei codici censimento,
 * così i ragazzi nuovi entrano senza riscrivere niente a mano.
 * L'anno di percorso lo decide la classe frequentata; l'età serve solo a correggere
 * chi è più grande dell'età regolare per quella classe (bocciature, ingressi tardivi).
 */
app.get('/api/richieste-iscrizione/excel', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const branca = await brancaDelCapo(req.user.id);
        if (!branca) return res.status(403).json({ error: "Non risulti in nessuna branca." });

        const righe = await dbAll(`SELECT * FROM richiesta_iscrizione
                                   WHERE branca = ? AND esito = 'accettata'
                                   ORDER BY lower(cognome), lower(nome)`, [branca]);

        const anno = await annoCorrente();
        // L'anno scout di partenza (2025/2026 → 2025): meglio dell'orologio del computer.
        const inizio = Number(String(anno?.etichetta ?? '').slice(0, 4)) || new Date().getFullYear();

        const italiana = (data) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data ?? ''))) return '';
            const [a, m, g] = data.split('-');
            return `${g}/${m}/${a}`;
        };

        // "Genitori" in fondo: caricando il file nei codici censimento quella colonna non si legge.
        const intestazioni = ['Codice censimento', 'Cognome', 'Nome', 'Data di nascita', 'Anno', 'Branca', 'Contatti', 'Genitori',
                              'Catechismo', 'Indirizzo'];
        const contenuto = righe.map(r => {
            const scolastico = ANNI_SCOLASTICI.find(a => a.valore === r.anno_scolastico);
            let tappa = scolastico ? { branca: scolastico.branca, anno: scolastico.anno } : null;

            // Controllo dell'età: se è nato prima di quanto ci si aspetta per quella classe,
            // vale l'età. Chi è più piccolo resta dov'è: comanda la classe.
            const annoNascita = Number(String(r.data_nascita ?? '').slice(0, 4));
            if (scolastico && annoNascita) {
                const nascitaAttesa = inizio - scolastico.classe - 5;
                if (annoNascita < nascitaAttesa) {
                    const classeDaEta = inizio - annoNascita - 5;
                    tappa = tappaDaClasse(classeDaEta) ?? tappa;
                }
            }

            const contatti = [r.telefono, r.email].filter(Boolean).join(' · ');
            const { genitori, catechismo, indirizzo } = richiestaPubblica(r);
            return ['', r.cognome, r.nome, italiana(r.data_nascita), tappa ? String(tappa.anno) : '',
                    tappa ? tappa.branca.charAt(0).toUpperCase() + tappa.branca.slice(1) : '', contatti,
                    genitori.join(' · '), catechismo ? `${catechismo}° anno` : '', indirizzo ?? ''];
        });

        const file = creaXlsx([intestazioni, ...contenuto], 'Censiti');
        const nomeFile = `richieste-accettate-${branca}-${(anno?.etichetta ?? '').replace('/', '-')}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${nomeFile}"`);
        res.send(file);
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.delete('/api/richieste-iscrizione/:id', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        if (!await richiestaDellaMiaBranca(req, res)) return;
        await dbRun('DELETE FROM richiesta_iscrizione WHERE id = ?', [req.params.id]);
        res.json({ message: "Richiesta eliminata." });
    } catch (err) {
        erroreInterno(res, err);
    }
});


// ---------- Anno scout ----------

// Quanti anni dura ogni branca e dove si va dopo: è il percorso del gruppo
// (3ª elementare = 1° anno di branco … 2° anno di università = 4° e ultimo anno di clan).
const ANNI_DI_BRANCA = { branco: 3, reparto: 5, clan: 5 };
const BRANCA_DOPO = { branco: 'reparto', reparto: 'clan', clan: null };
const CASSE = ['branco', 'reparto', 'clan', 'gruppo'];

async function annoCorrente() {
    return dbGet(`SELECT * FROM anno_scout WHERE corrente = 1`);
}

/** L'anno di percorso scritto per esteso, es. "3° anno di branco". */
function tappaDi(branca, anno) {
    if (!branca || !anno) return null;
    if (branca === 'clan') return anno === 1 ? 'noviziato' : `${anno - 1}° anno di clan`;
    return `${anno}° anno di ${branca}`;
}

app.get('/api/anno-scout', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const anno = await annoCorrente();
        const storico = await dbAll(`SELECT id, etichetta, aperto_il, corrente FROM anno_scout ORDER BY id DESC`);
        res.json({ anno: anno || null, storico });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// Apertura dell'anno: tutti i ragazzi avanzano di un anno, chi ha finito la branca passa
// a quella dopo, le quote ripartono da zero e in cassa resta solo il riporto.
app.post('/api/anno-scout/apri', verificaRuolo('admin'), async (req, res) => {
    try {
        const vecchio = await annoCorrente();
        const oggi = new Date();
        const primo = oggi.getMonth() + 1 >= 9 ? oggi.getFullYear() : oggi.getFullYear() - 1;
        const etichetta = testo(req.body?.etichetta) || `${primo}/${primo + 1}`;
        if (await dbGet(`SELECT id FROM anno_scout WHERE etichetta = ?`, [etichetta]))
            return res.status(409).json({ error: `L'anno ${etichetta} è già stato aperto.` });

        const ragazzi = await dbAll(`SELECT id, nome, cognome, branca, anno_branca FROM utenti WHERE ruolo = 'ragazzo'`);
        const cambi = [];
        const senzaAnno = [];
        const finitoClan = [];
        let avanzati = 0;

        await dbRun('BEGIN');
        try {
            await dbRun(`UPDATE anno_scout SET corrente = 0 WHERE corrente = 1`);
            const esito = await dbRun(`INSERT INTO anno_scout (etichetta, rif_capogruppo) VALUES (?, ?)`,
                [etichetta, req.user.id]);
            const nuovoAnno = esito.lastID;

            for (const r of ragazzi) {
                const nome = `${r.nome} ${r.cognome}`;
                // Senza branca o senza anno di percorso non si sa da dove far ripartire il conto.
                if (!r.branca || !r.anno_branca) { senzaAnno.push(nome); continue; }

                const prossimo = r.anno_branca + 1;
                if (prossimo <= ANNI_DI_BRANCA[r.branca]) {
                    await dbRun(`UPDATE utenti SET anno_branca = ? WHERE id = ?`, [prossimo, r.id]);
                    avanzati++;
                    continue;
                }
                const dopo = BRANCA_DOPO[r.branca];
                if (dopo) {
                    await dbRun(`UPDATE utenti SET branca = ?, anno_branca = 1 WHERE id = ?`, [dopo, r.id]);
                    cambi.push({ nome, da: r.branca, a: dopo });
                } else {
                    // Finito il clan resta dov'è finché un capo non lo rimuove a mano.
                    finitoClan.push(nome);
                }
            }

            // Le attività si ricopiano nell'anno nuovo, senza i pagamenti: le quote ripartono da zero.
            if (vecchio) {
                await dbRun(`INSERT INTO attivita_quota (rif_anno, branca, nome, importo, ordine)
                             SELECT ?, branca, nome, importo, ordine FROM attivita_quota WHERE rif_anno = ?`,
                    [nuovoAnno, vecchio.id]);

                // In cassa resta il riporto: i soldi non spariscono col cambio d'anno.
                for (const cassa of CASSE) {
                    const saldo = await dbGet(`SELECT COALESCE(SUM(importo), 0) AS totale FROM movimento_cassa
                                               WHERE rif_anno = ? AND cassa = ?`, [vecchio.id, cassa]);
                    if (!saldo || Math.abs(saldo.totale) < 0.005) continue;
                    await dbRun(`INSERT INTO movimento_cassa (rif_anno, cassa, data, descrizione, importo, rif_autore)
                                 VALUES (?, ?, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), ?, ?, ?)`,
                        [nuovoAnno, cassa, `Riporto dall'anno ${vecchio.etichetta}`, saldo.totale, req.user.id]);
                }
            }
            await dbRun('COMMIT');
        } catch (errDentro) {
            await dbRun('ROLLBACK').catch(() => {});
            throw errDentro;
        }

        res.status(201).json({
            anno: await annoCorrente(),
            avanzati, cambi, finitoClan, senzaAnno,
        });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// ---------- Ragazzi, quote e casse ----------

/**
 * La branca su cui si può lavorare: sempre e solo la propria, anche per un capogruppo.
 * I ragazzi e le quote li segue chi sta in quella branca.
 */
async function brancaDiLavoro(req, richiesta) {
    const mia = await brancaDelCapo(req.user.id);
    if (!mia) return null;
    return !richiesta || richiesta === mia ? mia : null;
}

async function elencoRagazzi(branca) {
    const anno = await annoCorrente();
    const dove = branca ? 'AND branca = ?' : '';
    const ragazzi = await dbAll(`SELECT id, codice_censimento, nome, cognome, eta, data_nascita, branca, anno_branca,
                                        telefono, email, tesoriere, (password IS NOT NULL)::int AS attivato,
                                        (SELECT COUNT(*) FROM scheda_allegato a WHERE a.rif_utente = utenti.id)::int
                                          AS allegati_scheda
                                 FROM utenti WHERE ruolo = 'ragazzo' ${dove}
                                 -- Prima i più grandi (ultimo anno di branca), poi a scendere;
                                 -- chi non ha ancora l'anno segnato va in fondo.
                                 ORDER BY anno_branca DESC NULLS LAST, lower(cognome), lower(nome)`,
                                 branca ? [branca] : []);
    const attivita = anno ? await dbAll(`SELECT * FROM attivita_quota WHERE rif_anno = ? ${branca ? 'AND branca = ?' : ''}
                                         ORDER BY ordine, id`, branca ? [anno.id, branca] : [anno.id]) : [];
    const pagamenti = attivita.length
        ? await dbAll(`SELECT * FROM pagamento_quota WHERE rif_attivita IN (${attivita.map(() => '?').join(',')})`,
            attivita.map(a => a.id))
        : [];

    return {
        anno: anno || null,
        attivita: attivita.map(a => ({ id: a.id, branca: a.branca, nome: a.nome, importo: a.importo })),
        ragazzi: ragazzi.map(r => ({
            id: r.id,
            codice_censimento: r.codice_censimento,
            nome: r.nome,
            cognome: r.cognome,
            eta: etaDiOggi(r),
            data_nascita: r.data_nascita || null,
            branca: r.branca,
            anno_branca: r.anno_branca,
            tappa: tappaDi(r.branca, r.anno_branca),
            telefono: r.telefono,
            email: r.email,
            attivato: r.attivato === 1,
            // Solo nel clan: chi tiene la cassa insieme ai capi.
            tesoriere: r.tesoriere === 1,
            // Quanti PDF ha nella scheda personale (es. la scheda medica).
            allegati_scheda: r.allegati_scheda,
            // Per ogni attività: se partecipa, quanto deve (la sua quota o quella a testa) e quanto ha dato.
            quote: pagamenti.filter(p => p.rif_utente === r.id).map(p => ({
                attivita: p.rif_attivita,
                versato: p.versato,
                pagato: p.pagato === 1,
                partecipa: p.partecipa === 1,
                quota: p.quota ?? (attivita.find(a => a.id === p.rif_attivita)?.importo ?? 0),
            })),
        })),
    };
}

app.get('/api/ragazzi', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        // Ognuno vede i ragazzi della propria branca: le altre branche non lo riguardano.
        const branca = await brancaDelCapo(req.user.id);
        if (!branca) return res.json({ branca: null, anno: null, attivita: [], ragazzi: [] });
        const dati = await elencoRagazzi(branca);
        res.json({ branca, ...dati });
    } catch (err) {
        erroreInterno(res, err);
    }
});

/** Il ragazzo esiste ed è della mia branca? Altrimenti risponde già lei. */
async function ragazzoGestibile(req, res) {
    const riga = await dbGet(`SELECT * FROM utenti WHERE id = ? AND ruolo = 'ragazzo'`, [req.params.id]);
    if (!riga) {
        res.status(404).json({ error: "Ragazzo non trovato." });
        return null;
    }
    const mia = await brancaDelCapo(req.user.id);
    if (!mia || riga.branca !== mia) {
        res.status(403).json({ error: "Questo ragazzo è di un'altra branca." });
        return null;
    }
    return riga;
}

// Un ragazzo che entra adesso e non ha ancora il codice censimento: lo aggiunge il capo a mano.
// Il codice glielo si mette dopo, da "Modifica" o con il prossimo file del censimento.
app.post('/api/ragazzi', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const branca = await brancaDelCapo(req.user.id);
        if (!branca) return res.status(403).json({ error: "Non risulti in nessuna branca." });

        const body = req.body || {};
        const nome = testo(body.nome, MAX_NOME);
        const cognome = testo(body.cognome, MAX_NOME);
        if (!nome || !cognome) return res.status(400).json({ error: "Nome e cognome sono obbligatori." });

        const dataNascita = testo(body.data_nascita, 10);
        if (dataNascita && !/^\d{4}-\d{2}-\d{2}$/.test(dataNascita))
            return res.status(400).json({ error: "La data di nascita va scritta come AAAA-MM-GG." });

        const { errore, codice } = await leggiCodiceLibero(body.codice_censimento);
        if (errore) return res.status(400).json({ error: errore });

        const annoBranca = Number(body.anno_branca);
        const anno = Number.isInteger(annoBranca) && annoBranca >= 1 && annoBranca <= (ANNI_DI_BRANCA[branca] || 5)
            ? annoBranca : null;

        // Codice, data di nascita, telefono ed email si salvano cifrati (codice ed email con la
        // loro impronta).
        const email = emailDaSalvare(testo(body.email, 120).toLowerCase() || null);
        const salvato = codiceDaSalvare(codice);
        const esito = await dbRun(`INSERT INTO utenti (codice_censimento, codice_impronta, nome, cognome,
                                   data_nascita, ruolo, branca, anno_branca, telefono, email, email_impronta)
                                   VALUES (?, ?, ?, ?, ?, 'ragazzo', ?, ?, ?, ?, ?)`,
            [salvato.codice, salvato.impronta, nome, cognome, cripta(dataNascita || null), branca, anno,
             cripta(testo(body.telefono, 20) || null), email.email, email.impronta]);
        const nuovo = await dbGet(`SELECT * FROM utenti WHERE id = ?`, [esito.lastID]);
        await riempiSchedaDaRichiesta(nuovo).catch(err => console.error('❌ Scheda dalla richiesta:', err.message));
        res.status(201).json({ ragazzo: { ...utentePubblico(nuovo), anno_branca: nuovo.anno_branca,
                                          tappa: tappaDi(nuovo.branca, nuovo.anno_branca), quote: [] } });
    } catch (err) {
        erroreInterno(res, err);
    }
});

/**
 * Legge il codice censimento scritto a mano: può restare vuoto (arriverà col censimento),
 * ma se c'è dev'essere fatto di sole cifre e non già di qualcun altro.
 */
async function leggiCodiceLibero(valore, idDaEscludere = null) {
    const scritto = String(valore ?? '').trim();
    if (!scritto) return { codice: null };
    const codice = leggiCodiceCensimento(scritto);
    if (!codice) return { errore: "Il codice censimento deve contenere solo cifre." };
    const gia = await dbGet(`SELECT id, nome, cognome FROM utenti WHERE codice_impronta = ?`, [improntaCodice(codice)]);
    if (gia && gia.id !== idDaEscludere)
        return { errore: `Il codice ${codice} è già di ${gia.nome} ${gia.cognome}.` };
    return { codice };
}

app.put('/api/ragazzi/:id', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const ragazzo = await ragazzoGestibile(req, res);
        if (!ragazzo) return;
        const body = req.body || {};
        const nome = testo(body.nome, MAX_NOME);
        const cognome = testo(body.cognome, MAX_NOME);
        if (!nome || !cognome) return res.status(400).json({ error: "Nome e cognome sono obbligatori." });

        const dataNascita = testo(body.data_nascita, 10);
        if (dataNascita && !/^\d{4}-\d{2}-\d{2}$/.test(dataNascita))
            return res.status(400).json({ error: "La data di nascita va scritta come AAAA-MM-GG." });

        // Il capo muove i ragazzi solo dentro la sua branca; il capogruppo può spostarli.
        const branca = BRANCHE.includes(body.branca) ? body.branca : ragazzo.branca;
        if (req.user.ruolo !== 'admin' && branca !== ragazzo.branca)
            return res.status(403).json({ error: "Solo i capigruppo spostano un ragazzo in un'altra branca." });

        const annoBranca = Number(body.anno_branca);
        const anno = Number.isInteger(annoBranca) && annoBranca >= 1 && annoBranca <= (ANNI_DI_BRANCA[branca] || 5)
            ? annoBranca : null;

        // Il codice censimento si può mettere adesso, se nel frattempo è arrivato.
        const { errore: erroreCodice, codice } = await leggiCodiceLibero(body.codice_censimento, ragazzo.id);
        if (erroreCodice) return res.status(400).json({ error: erroreCodice });

        // Il tesoriere esiste solo nel clan: cambiando branca il ruolo si perde.
        const tesoriere = branca === 'clan' && body.tesoriere === true ? 1 : 0;

        const email = emailDaSalvare(testo(body.email, 120).toLowerCase() || null);
        const salvato = codiceDaSalvare(codice);
        await dbRun(`UPDATE utenti SET codice_censimento = ?, codice_impronta = ?, nome = ?, cognome = ?,
                     data_nascita = ?, branca = ?, anno_branca = ?, telefono = ?, email = ?, email_impronta = ?,
                     tesoriere = ? WHERE id = ?`,
            [salvato.codice, salvato.impronta, nome, cognome, cripta(dataNascita || null), branca, anno,
             cripta(testo(body.telefono, 20) || null), email.email, email.impronta,
             tesoriere, ragazzo.id]);
        const aggiornato = await dbGet(`SELECT * FROM utenti WHERE id = ?`, [ragazzo.id]);
        res.json({ ragazzo: { ...utentePubblico(aggiornato), anno_branca: aggiornato.anno_branca,
                              tappa: tappaDi(aggiornato.branca, aggiornato.anno_branca) } });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.delete('/api/ragazzi/:id', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const ragazzo = await ragazzoGestibile(req, res);
        if (!ragazzo) return;
        const documenti = await dbAll(`SELECT file FROM scheda_allegato WHERE rif_utente = ?`, [ragazzo.id]);
        await dbRun(`DELETE FROM utenti WHERE id = ?`, [ragazzo.id]);
        // La scheda se ne va col ragazzo (ON DELETE CASCADE); i PDF si tolgono anche dal disco.
        for (const d of documenti) eliminaFile(CARTELLA_SCHEDE, d.file);
        res.json({ message: "Ragazzo rimosso dall'elenco." });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// ---------- Scheda personale dei ragazzi ----------
// Indirizzo, genitori e note sanitarie, più i PDF allegati (es. la scheda medica). La vedono e
// la cambiano solo i capi della branca del ragazzo e i capigruppo; il ragazzo no.
// Tutto è cifrato: i campi nel database, i PDF su disco, fuori dalle cartelle pubbliche.

const CARTELLA_SCHEDE = path.join(__dirname, 'documenti-riservati', 'schede');
fs.mkdirSync(CARTELLA_SCHEDE, { recursive: true, mode: 0o700 });
const MAX_ALLEGATI_SCHEDA = 10;
const CAMPI_SCHEDA = {
    indirizzo: MAX_INDIRIZZO,
    genitore1_nome: MAX_NOME, genitore1_cognome: MAX_NOME, genitore1_telefono: 20, genitore1_email: 120,
    genitore2_nome: MAX_NOME, genitore2_cognome: MAX_NOME, genitore2_telefono: 20, genitore2_email: 120,
    note_sanitarie: 1000,
    note: MAX_NOTE_RICHIESTA,
};

/** Il ragazzo della scheda, se chi chiede può vederla: capo della sua branca o capogruppo. */
async function ragazzoDellaScheda(req, res) {
    const riga = await dbGet(`SELECT * FROM utenti WHERE id = ? AND ruolo = 'ragazzo'`, [req.params.id]);
    if (!riga) {
        res.status(404).json({ error: "Ragazzo non trovato." });
        return null;
    }
    if (req.user.ruolo !== 'admin' && (await brancaDelCapo(req.user.id)) !== riga.branca) {
        res.status(403).json({ error: "La scheda la vedono solo i capi della sua branca e i capigruppo." });
        return null;
    }
    return riga;
}

const chiaveNome = (nome, cognome) => `${nome} ${cognome}`.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Se il ragazzo aveva fatto una richiesta di iscrizione poi accettata (stessi nome, cognome e
 * data di nascita), la sua scheda prende indirizzo, genitori e contatti da lì. Succede una
 * volta sola e riempie solo i campi vuoti: quello che hanno scritto i capi non si tocca.
 */
async function riempiSchedaDaRichiesta(ragazzo, richieste = null) {
    if (!ragazzo?.data_nascita) return false;
    const scheda = await dbGet(`SELECT * FROM scheda_ragazzo WHERE rif_utente = ?`, [ragazzo.id]);
    if (scheda?.rif_richiesta) return false;
    // Le date di nascita sono cifrate: il confronto si fa qui, già decifrate.
    const tutte = richieste ?? await dbAll(`SELECT * FROM richiesta_iscrizione WHERE esito = 'accettata'`);
    const richiesta = tutte.find(r => r.data_nascita === ragazzo.data_nascita
        && chiaveNome(r.nome, r.cognome) === chiaveNome(ragazzo.nome, ragazzo.cognome));
    if (!richiesta) return false;

    // Il contatto lasciato nel modulo è quasi sempre quello di un genitore.
    const daRichiesta = {
        indirizzo: richiesta.indirizzo, genitore1_nome: richiesta.genitore1_nome,
        genitore1_cognome: richiesta.genitore1_cognome, genitore1_telefono: richiesta.telefono,
        genitore1_email: richiesta.email, genitore2_nome: richiesta.genitore2_nome,
        genitore2_cognome: richiesta.genitore2_cognome, note: richiesta.note,
    };
    const valori = {};
    for (const campo of Object.keys(CAMPI_SCHEDA))
        valori[campo] = scheda?.[campo] || daRichiesta[campo] || null;
    await salvaScheda(ragazzo.id, valori, { rifRichiesta: richiesta.id });
    return true;
}

/**
 * Una volta sola: le schede riempite da una richiesta prima che esistesse il campo "Note"
 * prendono anche le note di quella richiesta (se c'è ancora e se la nota è vuota).
 */
async function completaNoteDalleRichieste() {
    const fatto = await dbGet(`SELECT valore FROM impostazioni WHERE chiave = 'note_schede_copiate'`);
    if (fatto) return;
    const schede = await dbAll(`SELECT s.rif_utente, r.note FROM scheda_ragazzo s
                                JOIN richiesta_iscrizione r ON r.id = s.rif_richiesta
                                WHERE s.note IS NULL AND r.note IS NOT NULL`);
    for (const s of schede)
        await dbRun(`UPDATE scheda_ragazzo SET note = ? WHERE rif_utente = ? AND note IS NULL`, [cripta(s.note), s.rif_utente]);
    await dbRun(`INSERT INTO impostazioni (chiave, valore) VALUES ('note_schede_copiate', ?)
                 ON CONFLICT (chiave) DO NOTHING`, [new Date().toISOString()]);
    if (schede.length) console.log(`📝 Note delle richieste copiate in ${schede.length} schede`);
}
completaNoteDalleRichieste().catch(err => console.error('❌ Note delle schede:', err.message));

/** Per tutti i ragazzi di una branca (dopo il file del censimento). */
async function riempiSchedeDaRichieste(branca) {
    const richieste = await dbAll(`SELECT * FROM richiesta_iscrizione WHERE esito = 'accettata'`);
    if (!richieste.length) return 0;
    const ragazzi = await dbAll(`SELECT * FROM utenti WHERE ruolo = 'ragazzo' AND branca = ?`, [branca]);
    let riempite = 0;
    for (const r of ragazzi) if (await riempiSchedaDaRichiesta(r, richieste)) riempite++;
    return riempite;
}

/** Scrive la scheda (cifrata), che ci fosse già o no. */
async function salvaScheda(idRagazzo, valori, { rifRichiesta = null, autore = null } = {}) {
    const campi = Object.keys(CAMPI_SCHEDA);
    await dbRun(`INSERT INTO scheda_ragazzo (rif_utente, ${campi.join(', ')}, rif_richiesta, data_modifica, rif_modificato_da)
                 VALUES (?, ${campi.map(() => '?').join(', ')}, ?, ?, ?)
                 ON CONFLICT (rif_utente) DO UPDATE SET
                   ${campi.map(c => `${c} = EXCLUDED.${c}`).join(', ')},
                   rif_richiesta = COALESCE(scheda_ragazzo.rif_richiesta, EXCLUDED.rif_richiesta),
                   data_modifica = EXCLUDED.data_modifica,
                   rif_modificato_da = COALESCE(EXCLUDED.rif_modificato_da, scheda_ragazzo.rif_modificato_da)`,
        [idRagazzo, ...campi.map(c => cripta(valori[c] || null)), rifRichiesta,
         new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), autore]);
}

function allegatoSchedaPubblico(a) {
    return { id: a.id, nome: a.nome_originale, dimensione: a.dimensione, data_caricamento: a.data_caricamento };
}

app.get('/api/ragazzi/:id/scheda', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const ragazzo = await ragazzoDellaScheda(req, res);
        if (!ragazzo) return;
        await riempiSchedaDaRichiesta(ragazzo).catch(err => console.error('❌ Scheda dalla richiesta:', err.message));
        const scheda = await dbGet(`SELECT s.*, u.nome AS autore_nome, u.cognome AS autore_cognome
                                    FROM scheda_ragazzo s LEFT JOIN utenti u ON u.id = s.rif_modificato_da
                                    WHERE s.rif_utente = ?`, [ragazzo.id]);
        const allegati = await dbAll(`SELECT * FROM scheda_allegato WHERE rif_utente = ? ORDER BY id`, [ragazzo.id]);
        const campi = {};
        for (const campo of Object.keys(CAMPI_SCHEDA)) campi[campo] = scheda?.[campo] ?? '';
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            ragazzo: {
                id: ragazzo.id, nome: ragazzo.nome, cognome: ragazzo.cognome,
                codice_censimento: ragazzo.codice_censimento, data_nascita: ragazzo.data_nascita || null,
                eta: etaDiOggi(ragazzo), branca: ragazzo.branca, tappa: tappaDi(ragazzo.branca, ragazzo.anno_branca),
                telefono: ragazzo.telefono, email: ragazzo.email,
            },
            scheda: {
                ...campi,
                // Da una richiesta di iscrizione accettata (una volta sola).
                da_richiesta: !!scheda?.rif_richiesta,
                data_modifica: scheda?.data_modifica ?? null,
                modificata_da: scheda?.autore_nome ? `${scheda.autore_nome} ${scheda.autore_cognome}` : null,
            },
            allegati: allegati.map(allegatoSchedaPubblico),
        });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.put('/api/ragazzi/:id/scheda', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const ragazzo = await ragazzoDellaScheda(req, res);
        if (!ragazzo) return;
        const body = req.body || {};
        const valori = {};
        for (const [campo, massimo] of Object.entries(CAMPI_SCHEDA))
            valori[campo] = String(body[campo] ?? '').trim().slice(0, massimo);
        for (const n of [1, 2]) {
            const telefono = valori[`genitore${n}_telefono`];
            const email = valori[`genitore${n}_email`].toLowerCase();
            valori[`genitore${n}_email`] = email;
            if (telefono && !/^[0-9+\s().-]{6,20}$/.test(telefono))
                return res.status(400).json({ error: `Il telefono del genitore ${n} non sembra giusto.` });
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
                return res.status(400).json({ error: `L'email del genitore ${n} non sembra giusta.` });
        }
        await salvaScheda(ragazzo.id, valori, { autore: req.user.id });
        res.json({ message: "Scheda salvata." });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// Un PDF alla volta, inviato così com'è; il nome originale arriva in X-Nome-File.
app.post('/api/ragazzi/:id/scheda/allegati', verificaRuolo('capo', 'admin'),
    express.raw({ type: () => true, limit: MAX_BYTE_ALLEGATO }),
    async (req, res) => {
        let nome;
        try { nome = decodeURIComponent(String(req.headers['x-nome-file'] ?? '')); } catch { nome = ''; }
        nome = path.basename(nome).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(-MAX_NOME_FILE);
        const dati = Buffer.isBuffer(req.body) ? req.body : null;
        if (!nome) return res.status(400).json({ error: "Il file non ha un nome valido." });
        if (path.extname(nome).toLowerCase() !== '.pdf')
            return res.status(400).json({ error: "Nella scheda si allegano solo file PDF." });
        if (!dati || !dati.length) return res.status(400).json({ error: `"${nome}" è vuoto.` });
        // Un PDF vero comincia con "%PDF-": niente altri file travestiti.
        if (!dati.subarray(0, 5).equals(Buffer.from('%PDF-')))
            return res.status(400).json({ error: `"${nome}" non è un PDF valido.` });
        try {
            const ragazzo = await ragazzoDellaScheda(req, res);
            if (!ragazzo) return;
            const { numero } = await dbGet(`SELECT COUNT(*) AS numero FROM scheda_allegato WHERE rif_utente = ?`, [ragazzo.id]);
            if (numero >= MAX_ALLEGATI_SCHEDA)
                return res.status(400).json({ error: `Una scheda può avere al massimo ${MAX_ALLEGATI_SCHEDA} PDF.` });
            const file = `${crypto.randomUUID()}.pdf.cif`;
            await fs.promises.writeFile(path.join(CARTELLA_SCHEDE, file), criptaFile(dati), { mode: 0o600 });
            try {
                const esito = await dbRun(`INSERT INTO scheda_allegato (rif_utente, nome_originale, file, dimensione, rif_autore)
                                           VALUES (?, ?, ?, ?, ?)`, [ragazzo.id, cripta(nome), file, dati.length, req.user.id]);
                const allegato = await dbGet(`SELECT * FROM scheda_allegato WHERE id = ?`, [esito.lastID]);
                res.status(201).json({ allegato: allegatoSchedaPubblico(allegato) });
            } catch (err) {
                eliminaFile(CARTELLA_SCHEDE, file);
                throw err;
            }
        } catch (err) {
            erroreInterno(res, err);
        }
    });

// Si scarica solo con l'accesso fatto (niente link da girare): il PDF esce decifrato e il
// browser non lo tiene in memoria.
app.get('/api/ragazzi/:id/scheda/allegati/:idAllegato', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const ragazzo = await ragazzoDellaScheda(req, res);
        if (!ragazzo) return;
        const allegato = await dbGet(`SELECT * FROM scheda_allegato WHERE id = ? AND rif_utente = ?`,
            [req.params.idAllegato, ragazzo.id]);
        if (!allegato) return res.status(404).json({ error: "Documento non trovato." });
        let dati;
        try {
            dati = decriptaFile(await fs.promises.readFile(path.join(CARTELLA_SCHEDE, path.basename(allegato.file))));
        } catch {
            return res.status(404).json({ error: "Il file del documento non c'è più sul server." });
        }
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(allegato.nome_originale)}`);
        res.setHeader('Cache-Control', 'no-store');
        res.send(dati);
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.delete('/api/ragazzi/:id/scheda/allegati/:idAllegato', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const ragazzo = await ragazzoDellaScheda(req, res);
        if (!ragazzo) return;
        const allegato = await dbGet(`SELECT * FROM scheda_allegato WHERE id = ? AND rif_utente = ?`,
            [req.params.idAllegato, ragazzo.id]);
        if (!allegato) return res.status(404).json({ error: "Documento non trovato." });
        await dbRun(`DELETE FROM scheda_allegato WHERE id = ?`, [allegato.id]);
        eliminaFile(CARTELLA_SCHEDE, allegato.file);
        res.json({ message: "Documento eliminato." });
    } catch (err) {
        erroreInterno(res, err);
    }
});

/**
 * I PDF di chi non c'è più (ragazzo tolto in altri modi, es. a fine clan): ogni giorno si
 * cancellano dal disco i file che nessuna scheda usa.
 */
async function pulisciDocumentiOrfani() {
    try {
        const usati = new Set((await dbAll(`SELECT file FROM scheda_allegato`)).map(a => a.file));
        for (const file of await fs.promises.readdir(CARTELLA_SCHEDE))
            if (file.endsWith('.pdf.cif') && !usati.has(file)) eliminaFile(CARTELLA_SCHEDE, file);
    } catch (err) {
        console.error('❌ Pulizia dei documenti delle schede:', err.message);
    }
}
setTimeout(pulisciDocumentiOrfani, 60 * 1000);
setInterval(pulisciDocumentiOrfani, 24 * 60 * 60 * 1000);

// La tabella in un file da aprire con Excel (punto e virgola, come vuole Excel in italiano).
app.get('/api/ragazzi/csv', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const branca = await brancaDelCapo(req.user.id);
        if (!branca) return res.status(403).json({ error: "Non risulti in nessuna branca." });

        const { anno, attivita, ragazzi } = await elencoRagazzi(branca);
        const campo = (valore) => {
            const t = String(valore ?? '');
            return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
        };
        const euro = (n) => Number(n || 0).toFixed(2).replace('.', ',');
        const intestazioni = ['Codice', 'Cognome', 'Nome', 'Data di nascita', 'Età', 'Branca', 'Anno',
            'Telefono', 'Email', ...attivita.map(a => `${a.nome} (${euro(a.importo)} a testa)`),
            'Totale dovuto', 'Totale versato', 'Resta da dare'];

        const righe = ragazzi.map(r => {
            const versati = attivita.map(a => {
                const q = r.quote.find(q => q.attivita === a.id);
                if (q && !q.partecipa) return 'non partecipa';
                return q && q.versato ? euro(q.versato) : '';
            });
            // Deve solo chi partecipa, e ognuno la sua quota.
            const dovuto = attivita.reduce((somma, a) => {
                const q = r.quote.find(q => q.attivita === a.id);
                if (q && !q.partecipa) return somma;
                return somma + Number(q?.quota ?? a.importo ?? 0);
            }, 0);
            const versato = r.quote.reduce((somma, q) => somma + Number(q.versato || 0), 0);
            return [r.codice_censimento, r.cognome, r.nome, r.data_nascita || '', r.eta ?? '',
                r.branca || '', r.tappa || '', r.telefono || '', r.email || '',
                ...versati, euro(dovuto), euro(versato), euro(Math.max(0, dovuto - versato))]
                .map(campo).join(';');
        });

        const nomeFile = `censiti-${branca || 'gruppo'}-${(anno?.etichetta || '').replace('/', '-')}.csv`;
        // Il segno iniziale dice a Excel che il file è in UTF-8: così le accentate si vedono giuste.
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${nomeFile}"`);
        res.send('﻿' + [intestazioni.map(campo).join(';'), ...righe].join('\r\n'));
    } catch (err) {
        erroreInterno(res, err);
    }
});

// ---------- Attività e quote ----------

app.post('/api/quote/attivita', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const anno = await annoCorrente();
        if (!anno) return res.status(409).json({ error: "Nessun anno scout aperto." });
        const branca = await brancaDiLavoro(req, String(req.body?.branca ?? ''));
        if (!branca) return res.status(403).json({ error: "Scegli una branca che puoi gestire." });

        const nome = testo(req.body?.nome, 60);
        if (!nome) return res.status(400).json({ error: "Scrivi il nome dell'attività." });
        const importo = Number(req.body?.importo);
        if (!Number.isFinite(importo) || importo < 0 || importo > 100000)
            return res.status(400).json({ error: "L'importo non è valido." });

        const ultimo = await dbGet(`SELECT COALESCE(MAX(ordine), 0) AS massimo FROM attivita_quota
                                    WHERE rif_anno = ? AND branca = ?`, [anno.id, branca]);
        const esito = await dbRun(`INSERT INTO attivita_quota (rif_anno, branca, nome, importo, ordine)
                                   VALUES (?, ?, ?, ?, ?)`,
            [anno.id, branca, nome, importo, (ultimo?.massimo ?? 0) + 1]);
        res.status(201).json({ attivita: { id: esito.lastID, branca, nome, importo } });
    } catch (err) {
        erroreInterno(res, err);
    }
});

/** L'attività esiste, è dell'anno in corso ed è della mia branca? */
async function attivitaGestibile(req, res) {
    const anno = await annoCorrente();
    const riga = await dbGet(`SELECT * FROM attivita_quota WHERE id = ?`, [req.params.id]);
    if (!riga || !anno || riga.rif_anno !== anno.id) {
        res.status(404).json({ error: "Attività non trovata." });
        return null;
    }
    const branca = await brancaDiLavoro(req, riga.branca);
    if (branca !== riga.branca) {
        res.status(403).json({ error: "Questa attività è di un'altra branca." });
        return null;
    }
    return riga;
}

app.put('/api/quote/attivita/:id', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const attivita = await attivitaGestibile(req, res);
        if (!attivita) return;
        const nome = testo(req.body?.nome, 60) || attivita.nome;
        const importo = Number(req.body?.importo);
        const nuovo = Number.isFinite(importo) && importo >= 0 && importo <= 100000 ? importo : attivita.importo;
        await dbRun(`UPDATE attivita_quota SET nome = ?, importo = ? WHERE id = ?`, [nome, nuovo, attivita.id]);
        res.json({ attivita: { id: attivita.id, branca: attivita.branca, nome, importo: nuovo } });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.delete('/api/quote/attivita/:id', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const attivita = await attivitaGestibile(req, res);
        if (!attivita) return;
        // I pagamenti e i movimenti di cassa collegati se ne vanno con lei (ON DELETE CASCADE).
        await dbRun(`DELETE FROM attivita_quota WHERE id = ?`, [attivita.id]);
        res.json({ message: "Attività eliminata." });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// Segna quanto ha versato un ragazzo per un'attività. Quando la quota risulta pagata,
// il versamento entra da solo nella cassa della sua branca (branco e reparto).
app.put('/api/quote/pagamenti', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const anno = await annoCorrente();
        if (!anno) return res.status(409).json({ error: "Nessun anno scout aperto." });
        const attivita = await dbGet(`SELECT * FROM attivita_quota WHERE id = ? AND rif_anno = ?`,
            [req.body?.attivita, anno.id]);
        if (!attivita) return res.status(404).json({ error: "Attività non trovata." });
        const branca = await brancaDiLavoro(req, attivita.branca);
        if (branca !== attivita.branca)
            return res.status(403).json({ error: "Questa attività è di un'altra branca." });

        const ragazzo = await dbGet(`SELECT * FROM utenti WHERE id = ? AND ruolo = 'ragazzo' AND branca = ?`,
            [req.body?.ragazzo, attivita.branca]);
        if (!ragazzo) return res.status(404).json({ error: "Ragazzo non trovato in questa branca." });

        // Chi non partecipa non deve niente: la sua quota esce dai conti.
        const partecipa = req.body?.partecipa !== false;
        const quotaChiesta = Number(req.body?.quota);
        // Quota su misura solo se diversa da quella a testa dell'attività.
        const quota = Number.isFinite(quotaChiesta) && quotaChiesta >= 0 && quotaChiesta !== attivita.importo
            ? quotaChiesta : null;
        const dovuto = quota ?? attivita.importo;

        const versatoChiesto = Number(req.body?.versato);
        const versato = !partecipa ? 0
            : (Number.isFinite(versatoChiesto) && versatoChiesto >= 0 ? versatoChiesto
                : (req.body?.pagato === true ? dovuto : 0));
        // "Pagata" vuol dire che ha versato almeno quanto doveva.
        const pagato = partecipa && versato > 0 && versato + 0.005 >= dovuto;

        await dbRun(`INSERT INTO pagamento_quota (rif_attivita, rif_utente, versato, pagato, partecipa, quota)
                     VALUES (?, ?, ?, ?, ?, ?)
                     ON CONFLICT (rif_attivita, rif_utente) DO UPDATE SET
                       versato = EXCLUDED.versato, pagato = EXCLUDED.pagato,
                       partecipa = EXCLUDED.partecipa, quota = EXCLUDED.quota,
                       data_modifica = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
            [attivita.id, ragazzo.id, versato, pagato ? 1 : 0, partecipa ? 1 : 0, quota]);
        const pagamento = await dbGet(`SELECT * FROM pagamento_quota WHERE rif_attivita = ? AND rif_utente = ?`,
            [attivita.id, ragazzo.id]);

        // Il movimento in cassa segue il versamento: si crea, si aggiorna o sparisce.
        if (CASSE.includes(attivita.branca)) {
            const descrizione = `${attivita.nome} — ${ragazzo.nome} ${ragazzo.cognome}`;
            if (versato > 0) {
                const esistente = await dbGet(`SELECT id FROM movimento_cassa WHERE rif_pagamento = ?`, [pagamento.id]);
                if (esistente) {
                    await dbRun(`UPDATE movimento_cassa SET importo = ?, descrizione = ?, data = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') WHERE id = ?`,
                        [versato, descrizione, esistente.id]);
                } else {
                    await dbRun(`INSERT INTO movimento_cassa (rif_anno, cassa, data, descrizione, importo,
                                 rif_pagamento, rif_autore) VALUES (?, ?, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), ?, ?, ?, ?)`,
                        [anno.id, attivita.branca, descrizione, versato, pagamento.id, req.user.id]);
                }
            } else {
                await dbRun(`DELETE FROM movimento_cassa WHERE rif_pagamento = ?`, [pagamento.id]);
            }
        }

        res.json({
            pagamento: {
                attivita: attivita.id, ragazzo: ragazzo.id, versato, pagato, partecipa, quota: dovuto,
            },
        });
    } catch (err) {
        erroreInterno(res, err);
    }
});

/**
 * Ogni richiesta di iscrizione campa 10 mesi da quando è arrivata, decisa o no, poi
 * sparisce da sola: sono dati di ragazzi (nomi, date di nascita, contatti dei genitori)
 * e non ha senso tenerli per sempre. Così all'apertura dell'anno nuovo il file delle
 * richieste accettate porta solo i ragazzi di quest'anno.
 * Si controlla all'avvio e poi una volta al giorno.
 */
const MESI_DI_VITA_RICHIESTA = 10;
async function pulisciRichiesteVecchie() {
    try {
        // data_creazione è "AAAA-MM-GGTHH:MM:SSZ": si confronta con lo stesso formato.
        const esito = await dbRun(`DELETE FROM richiesta_iscrizione
                                   WHERE data_creazione <= to_char((now() AT TIME ZONE 'UTC') - make_interval(months => ?::int), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
            [MESI_DI_VITA_RICHIESTA]);
        if (esito.changes) console.log(`🧹 Richieste arrivate da oltre ${MESI_DI_VITA_RICHIESTA} mesi rimosse: ${esito.changes}`);
    } catch (err) {
        console.error('Pulizia delle richieste vecchie:', err.message);
    }
}
setTimeout(pulisciRichiesteVecchie, 5000);
setInterval(pulisciRichiesteVecchie, 24 * 60 * 60 * 1000);

// ---------- Cassa: bilancio di branco, reparto e gruppo ----------

/**
 * Chi può guardare una cassa e chi può muoverla.
 * Branco e reparto: i loro capi. Gruppo: i capigruppo.
 * Clan: la guardano tutti quelli del clan (anche i ragazzi), ma la muovono solo
 * i capi clan e il tesoriere, cioè un ragazzo del clan scelto dai capi.
 */
async function permessiCassa(req, cassa) {
    const nessuno = { vede: false, modifica: false };
    if (!CASSE.includes(cassa)) return nessuno;

    const utente = await dbGet('SELECT ruolo, branca, tesoriere FROM utenti WHERE id = ?', [req.user.id]);
    if (!utente) return nessuno;
    const capo = utente.ruolo === 'capo' || utente.ruolo === 'admin';

    if (cassa === 'gruppo') {
        const suo = utente.ruolo === 'admin';
        return { vede: suo, modifica: suo };
    }
    if (utente.branca !== cassa) return nessuno;
    if (cassa === 'clan') return { vede: true, modifica: capo || utente.tesoriere === 1 };
    // Branco e reparto restano cose da capi.
    return { vede: capo, modifica: capo };
}

app.get('/api/cassa/:cassa', verificaUtenteCensito, async (req, res) => {
    try {
        const cassa = req.params.cassa;
        const permessi = await permessiCassa(req, cassa);
        if (!permessi.vede) return res.status(403).json({ error: "Questa cassa non è tua." });
        const anno = await annoCorrente();
        if (!anno) return res.json({
            cassa, anno: null, movimenti: [], entrate: 0, uscite: 0, saldo: 0,
            puoModificare: permessi.modifica,
        });

        const movimenti = await dbAll(`SELECT m.*, u.nome AS autore_nome, u.cognome AS autore_cognome
                                       FROM movimento_cassa m LEFT JOIN utenti u ON u.id = m.rif_autore
                                       WHERE m.rif_anno = ? AND m.cassa = ?
                                       ORDER BY m.data DESC, m.id DESC`, [anno.id, cassa]);
        // Gli anni che questa cassa ha alle spalle: servono per scaricarne il bilancio.
        const anni = await dbAll(`SELECT a.id, a.etichetta, a.corrente,
                                         (SELECT COUNT(*) FROM movimento_cassa m
                                          WHERE m.rif_anno = a.id AND m.cassa = ?) AS movimenti
                                  FROM anno_scout a ORDER BY a.id DESC`, [cassa]);
        const entrate = movimenti.filter(m => m.importo > 0).reduce((s, m) => s + m.importo, 0);
        const uscite = movimenti.filter(m => m.importo < 0).reduce((s, m) => s + m.importo, 0);
        res.json({
            cassa, anno,
            // Il clan lo guardano tutti, ma lo muovono solo capi clan e tesoriere.
            puoModificare: permessi.modifica,
            anni: anni.map(a => ({
                id: a.id, etichetta: a.etichetta, corrente: a.corrente === 1, movimenti: a.movimenti,
            })),
            entrate, uscite: Math.abs(uscite), saldo: entrate + uscite,
            movimenti: movimenti.map(m => ({
                id: m.id, data: m.data, descrizione: m.descrizione, importo: m.importo,
                // I movimenti nati da una quota pagata non si modificano a mano.
                automatico: m.rif_pagamento !== null,
                // La foto dello scontrino si apre solo col link firmato (vedi soloConFirma).
                scontrino_url: m.scontrino ? linkFirmato(m.scontrino) : null,
                autore: m.autore_nome ? `${m.autore_nome} ${m.autore_cognome}` : null,
            })),
        });
    } catch (err) {
        erroreInterno(res, err);
    }
});

/**
 * Il bilancio di una cassa in un file Excel: un anno per volta, dal movimento più vecchio
 * al più recente, con il saldo che si aggiorna riga per riga e i totali in fondo.
 * Si può chiedere l'anno in corso o uno di quelli passati.
 */
app.get('/api/cassa/:cassa/excel', verificaUtenteCensito, async (req, res) => {
    try {
        const cassa = req.params.cassa;
        if (!(await permessiCassa(req, cassa)).vede)
            return res.status(403).json({ error: "Questa cassa non è tua." });

        const anno = req.query.anno
            ? await dbGet('SELECT * FROM anno_scout WHERE id = ?', [req.query.anno])
            : await annoCorrente();
        if (!anno) return res.status(404).json({ error: "Anno scout non trovato." });

        const movimenti = await dbAll(`SELECT m.*, u.nome AS autore_nome, u.cognome AS autore_cognome
                                       FROM movimento_cassa m LEFT JOIN utenti u ON u.id = m.rif_autore
                                       WHERE m.rif_anno = ? AND m.cassa = ?
                                       ORDER BY m.data ASC, m.id ASC`, [anno.id, cassa]);

        const euro = (n) => Number(n || 0).toFixed(2).replace('.', ',');
        const italiana = (data) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data ?? ''))) return '';
            const [a, m, g] = data.split('-');
            return `${g}/${m}/${a}`;
        };
        const nomeCassa = cassa === 'gruppo' ? 'gruppo'
            : cassa === 'clan' ? 'clan' : cassa;

        let saldo = 0;
        let entrate = 0;
        let uscite = 0;
        const righe = movimenti.map(m => {
            saldo += m.importo;
            if (m.importo > 0) entrate += m.importo; else uscite += Math.abs(m.importo);
            return [
                italiana(m.data),
                m.descrizione,
                m.importo > 0 ? euro(m.importo) : '',
                m.importo < 0 ? euro(Math.abs(m.importo)) : '',
                euro(saldo),
                m.rif_pagamento ? 'da una quota' : (m.autore_nome ? `${m.autore_nome} ${m.autore_cognome}` : ''),
                m.scontrino ? 'sì' : '',
            ];
        });

        const contenuto = [
            [`Cassa ${cassa === 'gruppo' || cassa === 'clan' ? 'di ' + nomeCassa : 'del ' + nomeCassa}`,
             `Anno scout ${anno.etichetta}`],
            [],
            ['Data', 'Descrizione', 'Entrata', 'Uscita', 'Saldo', 'Segnato da', 'Scontrino'],
            ...righe,
            [],
            ['', 'Totale entrate', euro(entrate)],
            ['', 'Totale uscite', euro(uscite)],
            ['', 'Saldo finale', euro(entrate - uscite)],
        ];

        const file = creaXlsx(contenuto, `Cassa ${anno.etichetta.replace('/', '-')}`);
        const nomeFile = `cassa-${cassa}-${anno.etichetta.replace('/', '-')}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${nomeFile}"`);
        res.send(file);
    } catch (err) {
        erroreInterno(res, err);
    }
});

function validaMovimento(body) {
    const data = testo(body?.data, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { errore: "Scegli la data del movimento." };
    const descrizione = testo(body?.descrizione, 120);
    if (!descrizione) return { errore: "Scrivi a cosa si riferisce." };
    const importo = Number(body?.importo);
    if (!Number.isFinite(importo) || importo === 0 || Math.abs(importo) > 1000000)
        return { errore: "L'importo non è valido." };
    // "uscita" rende l'importo negativo: in cassa i segni bastano da soli.
    const segno = body?.tipo === 'uscita' ? -1 : 1;
    return { dati: { data, descrizione, importo: Math.abs(importo) * segno } };
}

app.post('/api/cassa/:cassa', verificaUtenteCensito, async (req, res) => {
    try {
        const cassa = req.params.cassa;
        if (!(await permessiCassa(req, cassa)).modifica)
            return res.status(403).json({ error: "Questa cassa puoi solo guardarla." });
        const anno = await annoCorrente();
        if (!anno) return res.status(409).json({ error: "Nessun anno scout aperto." });
        const { errore, dati } = validaMovimento(req.body);
        if (errore) return res.status(400).json({ error: errore });

        let scontrino = null;
        if (req.body?.scontrino) {
            const foto = leggiScontrino(req.body.scontrino);
            if (!foto) return res.status(400).json({ error: "La foto dello scontrino non va bene: max 3 MB." });
            scontrino = salvaScontrino(foto);
        }

        const esito = await dbRun(`INSERT INTO movimento_cassa (rif_anno, cassa, data, descrizione, importo,
                                   rif_autore, scontrino) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [anno.id, cassa, dati.data, dati.descrizione, dati.importo, req.user.id, scontrino]);
        res.status(201).json({
            movimento: {
                id: esito.lastID, ...dati, automatico: false,
                scontrino_url: scontrino ? linkFirmato(scontrino) : null,
            },
        });
    } catch (err) {
        erroreInterno(res, err);
    }
});

/** Il movimento esiste, è dell'anno in corso, è di una cassa mia e non è automatico? */
async function movimentoGestibile(req, res) {
    const anno = await annoCorrente();
    const riga = await dbGet(`SELECT * FROM movimento_cassa WHERE id = ?`, [req.params.id]);
    if (!riga || !anno || riga.rif_anno !== anno.id) {
        res.status(404).json({ error: "Movimento non trovato." });
        return null;
    }
    if (!(await permessiCassa(req, riga.cassa)).modifica) {
        res.status(403).json({ error: "Questa cassa puoi solo guardarla." });
        return null;
    }
    if (riga.rif_pagamento !== null) {
        res.status(409).json({ error: "Questo movimento arriva da una quota: si cambia dalla tabella dei ragazzi." });
        return null;
    }
    return riga;
}

app.put('/api/cassa/movimenti/:id', verificaUtenteCensito, async (req, res) => {
    try {
        const movimento = await movimentoGestibile(req, res);
        if (!movimento) return;
        const { errore, dati } = validaMovimento(req.body);
        if (errore) return res.status(400).json({ error: errore });

        let scontrino = movimento.scontrino;
        if (req.body?.scontrino) {
            const foto = leggiScontrino(req.body.scontrino);
            if (!foto) return res.status(400).json({ error: "La foto dello scontrino non va bene: max 3 MB." });
            eliminaFile(CARTELLA_SCONTRINI, movimento.scontrino);
            scontrino = salvaScontrino(foto);
        } else if (req.body?.rimuovi_scontrino === true) {
            eliminaFile(CARTELLA_SCONTRINI, movimento.scontrino);
            scontrino = null;
        }

        await dbRun(`UPDATE movimento_cassa SET data = ?, descrizione = ?, importo = ?, scontrino = ? WHERE id = ?`,
            [dati.data, dati.descrizione, dati.importo, scontrino, movimento.id]);
        res.json({
            movimento: {
                id: movimento.id, ...dati, automatico: false,
                scontrino_url: scontrino ? linkFirmato(scontrino) : null,
            },
        });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.delete('/api/cassa/movimenti/:id', verificaUtenteCensito, async (req, res) => {
    try {
        const movimento = await movimentoGestibile(req, res);
        if (!movimento) return;
        await dbRun(`DELETE FROM movimento_cassa WHERE id = ?`, [movimento.id]);
        eliminaFile(CARTELLA_SCONTRINI, movimento.scontrino);
        res.json({ message: "Movimento eliminato." });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// ---------- Comunità capi: la gestiscono i capigruppo ----------

// L'elenco dei capi lo vedono tutti: chi segue quale branca è una cosa che si dice.
// Ma di ognuno escono solo nome, cognome e branca: contatti, codice censimento, età e
// data di nascita restano al capogruppo, che è l'unico a gestire la comunità capi.
app.get('/api/capi', async (req, res) => {
    try {
        const capogruppo = utenteDaToken(req)?.ruolo === 'admin';
        const capi = await dbAll(`SELECT id, codice_censimento, nome, cognome, eta, data_nascita, branca, ruolo,
                                         telefono, email, livello_foca, (password IS NOT NULL)::int AS attivato
                                  FROM utenti WHERE ruolo IN ('capo', 'admin')
                                  ORDER BY lower(cognome), lower(nome)`);
        res.json({
            puoGestire: capogruppo,
            capi: capi.map(c => ({
                id: c.id, nome: c.nome, cognome: c.cognome, branca: c.branca, ruolo: c.ruolo,
                // Contatti, codice censimento, età e "non è ancora entrato": solo al capogruppo.
                telefono: capogruppo ? c.telefono : null,
                email: capogruppo ? c.email : null,
                codice_censimento: capogruppo ? c.codice_censimento : null,
                eta: capogruppo ? etaDiOggi(c) : null,
                data_nascita: capogruppo ? (c.data_nascita || null) : null,
                attivato: capogruppo ? c.attivato === 1 : true,
                livello_foca: capogruppo ? (c.livello_foca || null) : null,
            })),
        });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// Cambio di branca di un capo (anche "a disposizione del gruppo", cioè senza branca) e suoi dati.
app.put('/api/capi/:id', verificaRuolo('admin'), async (req, res) => {
    try {
        const capo = await dbGet(`SELECT * FROM utenti WHERE id = ? AND ruolo IN ('capo', 'admin')`, [req.params.id]);
        if (!capo) return res.status(404).json({ error: "Capo non trovato." });
        const body = req.body || {};
        const nome = testo(body.nome, MAX_NOME) || capo.nome;
        const cognome = testo(body.cognome, MAX_NOME) || capo.cognome;
        const dataNascita = testo(body.data_nascita, 10);
        if (dataNascita && !/^\d{4}-\d{2}-\d{2}$/.test(dataNascita))
            return res.status(400).json({ error: "La data di nascita va scritta come AAAA-MM-GG." });
        // branca vuota = a disposizione del gruppo.
        const branca = BRANCHE.includes(body.branca) ? body.branca : null;
        const ruolo = body.ruolo === 'admin' || body.ruolo === 'capo' ? body.ruolo : capo.ruolo;
        // Un capogruppo non può rimuoversi da solo il ruolo: resterebbe il gruppo senza nessuno.
        if (capo.id === req.user.id && ruolo !== 'admin')
            return res.status(400).json({ error: "Non puoi rimuovere a te stesso il ruolo di capogruppo." });

        // Se l'email cambia da qui, vale questa: il file del censimento non la tocca più.
        const email = testo(body.email, 120).toLowerCase() || null;
        const emailCambiata = email !== (capo.email || null);
        const salvata = emailDaSalvare(email);
        await dbRun(`UPDATE utenti SET nome = ?, cognome = ?, data_nascita = ?, branca = ?, ruolo = ?,
                     telefono = ?, email = ?, email_impronta = ?,
                     email_a_mano = CASE WHEN ? = 1 THEN 1 ELSE email_a_mano END
                     WHERE id = ?`,
            [nome, cognome, cripta(dataNascita || capo.data_nascita || null), branca, ruolo,
             cripta(testo(body.telefono, 20) || null), salvata.email, salvata.impronta, emailCambiata ? 1 : 0, capo.id]);
        const aggiornato = await dbGet(`SELECT * FROM utenti WHERE id = ?`, [capo.id]);
        res.json({ capo: utentePubblico(aggiornato) });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.delete('/api/capi/:id', verificaRuolo('admin'), async (req, res) => {
    try {
        if (Number(req.params.id) === req.user.id)
            return res.status(400).json({ error: "Non puoi eliminare te stesso." });
        const esito = await dbRun(`DELETE FROM utenti WHERE id = ? AND ruolo IN ('capo', 'admin')`, [req.params.id]);
        if (esito.changes === 0) return res.status(404).json({ error: "Capo non trovato." });
        res.json({ message: "Capo rimosso dalla comunità capi." });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// ---------- Foto dello sfondo della home ----------

// Le vedono tutti (la home è aperta a chiunque), le cambiano i capi.
const MAX_SFONDI = 12;

app.get('/api/sfondi', async (req, res) => {
    try {
        const righe = await dbAll(`SELECT id, percorso FROM sfondo_home ORDER BY ordine, id`);
        res.json({ sfondi: righe.map(r => ({ id: r.id, url: r.percorso })) });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.post('/api/sfondi', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const quante = await dbGet(`SELECT COUNT(*) AS quante FROM sfondo_home`);
        if (quante.quante >= MAX_SFONDI)
            return res.status(409).json({ error: `Al massimo ${MAX_SFONDI} foto: rimuovine una prima di aggiungerne un'altra.` });

        const foto = leggiFoto(req.body?.foto);
        if (!foto) return res.status(400).json({ error: "La foto non va bene: max 5 MB." });

        const nomeFile = `${crypto.randomUUID()}.${foto.estensione}`;
        fs.writeFileSync(path.join(CARTELLA_SFONDI, nomeFile), foto.dati);
        const ultimo = await dbGet(`SELECT COALESCE(MAX(ordine), 0) AS massimo FROM sfondo_home`);
        const esito = await dbRun(`INSERT INTO sfondo_home (percorso, ordine, rif_autore) VALUES (?, ?, ?)`,
            [`/uploads/sfondi/${nomeFile}`, (ultimo?.massimo ?? 0) + 1, req.user.id]);
        res.status(201).json({ sfondo: { id: esito.lastID, url: `/uploads/sfondi/${nomeFile}` } });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.delete('/api/sfondi/:id', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const riga = await dbGet(`SELECT * FROM sfondo_home WHERE id = ?`, [req.params.id]);
        if (!riga) return res.status(404).json({ error: "Foto non trovata." });
        const quante = await dbGet(`SELECT COUNT(*) AS quante FROM sfondo_home`);
        // Almeno una foto deve restare, altrimenti la home resta senza sfondo.
        if (quante.quante <= 1)
            return res.status(409).json({ error: "È l'ultima foto rimasta: prima aggiungine un'altra." });

        await dbRun(`DELETE FROM sfondo_home WHERE id = ?`, [riga.id]);
        eliminaFile(CARTELLA_SFONDI, riga.percorso);
        res.json({ message: "Foto rimossa dallo sfondo." });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// ---------- Squadriglie del Reparto ----------

// Le squadriglie le leggono tutti (la sezione Reparto è aperta a chiunque); le chiudono,
// le riaprono e le aggiungono i capi reparto, compreso un capogruppo che fa anche il capo reparto.
const MAX_NOME_SQUADRIGLIA = 40;
// La foto dell'animale: arriva dal browser già rimpicciolita, sta in uploads/squadriglie
// ed è pubblica come la sezione Reparto.
const CARTELLA_SQUADRIGLIE = path.join(__dirname, 'uploads', 'squadriglie');
fs.mkdirSync(CARTELLA_SQUADRIGLIE, { recursive: true });

async function puoGestireSquadriglie(req) {
    const chi = utenteDaToken(req);
    if (!chi) return false;
    const utente = await dbGet('SELECT ruolo, branca FROM utenti WHERE id = ?', [chi.id]);
    return !!utente && (utente.ruolo === 'capo' || utente.ruolo === 'admin') && utente.branca === 'reparto';
}

/** Salva la foto dell'animale e torna il suo percorso. */
function salvaFotoSquadriglia(foto) {
    const nomeFile = `${crypto.randomUUID()}.${foto.estensione}`;
    fs.writeFileSync(path.join(CARTELLA_SQUADRIGLIE, nomeFile), foto.dati);
    return `/uploads/squadriglie/${nomeFile}`;
}

function squadrigliaPubblica(sq) {
    return {
        id: sq.id,
        nome: sq.nome,
        foto_url: sq.foto,
        attiva: sq.attiva === 1,
        data_chiusura: sq.data_chiusura,
    };
}

app.get('/api/squadriglie', async (req, res) => {
    try {
        // In ordine alfabetico, senza badare a maiuscole e minuscole.
        const righe = await dbAll('SELECT * FROM squadriglia ORDER BY lower(nome)');
        const tutte = righe.map(squadrigliaPubblica);
        res.json({
            attive: tutte.filter(s => s.attiva),
            chiuse: tutte.filter(s => !s.attiva),
            puoGestire: await puoGestireSquadriglie(req),
        });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.post('/api/squadriglie', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        if (!(await puoGestireSquadriglie(req)))
            return res.status(403).json({ error: "Le squadriglie le gestiscono i capi reparto." });

        const nome = testo(req.body?.nome, MAX_NOME_SQUADRIGLIA);
        if (!nome) return res.status(400).json({ error: "Serve il nome della squadriglia." });
        // La foto è facoltativa: si può aggiungere dopo dal riquadro della squadriglia.
        let foto = null;
        if (req.body?.foto) {
            const letta = leggiFoto(req.body.foto);
            if (!letta) return res.status(400).json({ error: "La foto non va bene: JPG, PNG o WebP, max 5 MB." });
            foto = letta;
        }

        const esiste = await dbGet('SELECT id, attiva FROM squadriglia WHERE lower(nome) = lower(?)', [nome]);
        if (esiste) return res.status(409).json({
            error: esiste.attiva === 1
                ? `La squadriglia ${nome} c'è già.`
                : `La squadriglia ${nome} sta nell'archivio: riaprila da lì.`,
        });

        const chi = utenteDaToken(req);
        const percorso = foto ? salvaFotoSquadriglia(foto) : null;
        const esito = await dbRun('INSERT INTO squadriglia (nome, foto, attiva, rif_autore) VALUES (?, ?, 1, ?)',
            [nome, percorso, chi.id]);
        const riga = await dbGet('SELECT * FROM squadriglia WHERE id = ?', [esito.lastID]);
        res.status(201).json({ squadriglia: squadrigliaPubblica(riga) });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// Chiude una squadriglia (finisce nell'archivio) o la riapre. Si possono cambiare anche
// il nome e la foto dell'animale.
app.put('/api/squadriglie/:id', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        if (!(await puoGestireSquadriglie(req)))
            return res.status(403).json({ error: "Le squadriglie le gestiscono i capi reparto." });
        const squadriglia = await dbGet('SELECT * FROM squadriglia WHERE id = ?', [req.params.id]);
        if (!squadriglia) return res.status(404).json({ error: "Squadriglia non trovata." });

        const body = req.body || {};
        const attiva = typeof body.attiva === 'boolean' ? (body.attiva ? 1 : 0) : squadriglia.attiva;
        const nome = testo(body.nome, MAX_NOME_SQUADRIGLIA) || squadriglia.nome;
        if (nome !== squadriglia.nome) {
            const doppia = await dbGet('SELECT id FROM squadriglia WHERE lower(nome) = lower(?) AND id <> ?',
                [nome, squadriglia.id]);
            if (doppia) return res.status(409).json({ error: `La squadriglia ${nome} c'è già.` });
        }

        // Foto nuova, oppure via quella che c'era.
        let percorso = squadriglia.foto;
        if (body.foto) {
            const letta = leggiFoto(body.foto);
            if (!letta) return res.status(400).json({ error: "La foto non va bene: JPG, PNG o WebP, max 5 MB." });
            percorso = salvaFotoSquadriglia(letta);
        } else if (body.rimuovi_foto === true) {
            percorso = null;
        }

        // La data di chiusura si scrive quando si chiude e si cancella quando si riapre.
        const chiusura = attiva === 1 ? null
            : (squadriglia.data_chiusura ?? new Date().toISOString().slice(0, 19) + 'Z');

        await dbRun('UPDATE squadriglia SET nome = ?, attiva = ?, foto = ?, data_chiusura = ? WHERE id = ?',
            [nome, attiva, percorso, chiusura, squadriglia.id]);
        // Il file vecchio si butta solo dopo che il database ha accettato il nuovo.
        if (squadriglia.foto && squadriglia.foto !== percorso)
            eliminaFile(CARTELLA_SQUADRIGLIE, squadriglia.foto);
        const riga = await dbGet('SELECT * FROM squadriglia WHERE id = ?', [squadriglia.id]);
        res.json({ squadriglia: squadrigliaPubblica(riga) });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// ---------- Guidoncini in vetta: le specialità di squadriglia ----------

// Le specialità di squadriglia dell'AGESCI (Regolamento metodologico E/G, art. 17).
// La chiave è quella salvata nel database; nome e ambito sono quelli che si leggono sul sito.
const SPECIALITA_SQUADRIGLIA = [
    { chiave: 'alpinismo', nome: 'Alpinismo', ambito: "La montagna: sentieri, orientamento in quota, nodi e sicurezza, il rispetto dell'ambiente alpino." },
    { chiave: 'artigianato', nome: 'Artigianato', ambito: "Le mani che sanno fare: legno, cuoio, metallo, stoffa. Progettare un oggetto e costruirlo davvero." },
    { chiave: 'campismo', nome: 'Campismo', ambito: "La vita al campo: tende, costruzioni con pali e corde, cucina trapper, fuochi e un campo che funziona." },
    { chiave: 'civitas', nome: 'Civitas', ambito: "La città e chi la abita: conoscere il proprio territorio, le sue istituzioni, e fare qualcosa di utile per tutti." },
    { chiave: 'esplorazione', nome: 'Esplorazione', ambito: "Partire per scoprire: carte e bussola, hike, osservare e raccontare un luogo che non si conosceva." },
    { chiave: 'espressione', nome: 'Espressione', ambito: "Teatro, musica, danza, immagini: raccontare qualcosa agli altri con i linguaggi dell'arte." },
    { chiave: 'giornalismo', nome: 'Giornalismo', ambito: "Cercare le notizie, verificarle e raccontarle: giornale, radio, video, fotografia." },
    { chiave: 'internazionale', nome: 'Internazionale', ambito: "Lo scautismo nel mondo: altre lingue, altre culture, gemellaggi e amicizie oltre il confine." },
    { chiave: 'natura', nome: 'Natura', ambito: "Piante, animali, cielo e stagioni: osservare, riconoscere e prendersi cura dell'ambiente." },
    { chiave: 'nautica', nome: 'Nautica', ambito: "L'acqua: canoa, vela, remi, nodi marinari e la sicurezza di chi va per mare, fiumi e laghi." },
    { chiave: 'olympia', nome: 'Olympia', ambito: "Lo sport e il corpo: allenarsi, giocare lealmente, organizzare gare e tornei." },
    { chiave: 'pronto-intervento', nome: 'Pronto intervento', ambito: "Essere pronti: primo soccorso, protezione civile, sapere cosa fare quando qualcuno ha bisogno." },
];
const CHIAVI_SPECIALITA = new Set(SPECIALITA_SQUADRIGLIA.map(s => s.chiave));
/** Il primo anno scout che si può segnare: più indietro è difficile avere memoria certa. */
const PRIMO_ANNO_GUIDONCINI = 1975;

/** L'anno scout in corso: da settembre comincia quello nuovo. */
function annoScoutCorrente() {
    const oggi = new Date();
    return oggi.getMonth() >= 8 ? oggi.getFullYear() : oggi.getFullYear() - 1;
}

function guidoncinoPubblico(g) {
    return {
        id: g.id,
        squadriglia_id: g.rif_squadriglia,
        specialita: g.specialita,
        anno: g.anno,
        confermata: g.confermata === 1,
    };
}

// Li leggono tutti, come il resto della sezione Reparto.
app.get('/api/guidoncini', async (req, res) => {
    try {
        const righe = await dbAll('SELECT * FROM guidoncino ORDER BY anno DESC, id DESC');
        res.json({
            specialita: SPECIALITA_SQUADRIGLIA,
            guidoncini: righe.map(guidoncinoPubblico),
            annoCorrente: annoScoutCorrente(),
            puoGestire: await puoGestireSquadriglie(req),
        });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// Un capo reparto segna la specialità conquistata da una squadriglia in un anno scout.
app.post('/api/guidoncini', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        if (!(await puoGestireSquadriglie(req)))
            return res.status(403).json({ error: "I guidoncini li segnano i capi reparto." });
        const body = req.body ?? {};
        const idSquadriglia = Number(body.squadriglia_id);
        const anno = Number(body.anno);
        const specialita = String(body.specialita ?? '');
        if (!CHIAVI_SPECIALITA.has(specialita))
            return res.status(400).json({ error: "Questa specialità non esiste." });
        if (!Number.isInteger(anno) || anno < PRIMO_ANNO_GUIDONCINI || anno > annoScoutCorrente())
            return res.status(400).json({ error: "L'anno scout non è valido." });
        const squadriglia = Number.isInteger(idSquadriglia)
            ? await dbGet('SELECT id, nome FROM squadriglia WHERE id = ?', [idSquadriglia])
            : null;
        if (!squadriglia) return res.status(404).json({ error: "Squadriglia non trovata." });

        // Il Regolamento dice una sola specialità per anno scout.
        const gia = await dbGet('SELECT id FROM guidoncino WHERE rif_squadriglia = ? AND anno = ?',
            [squadriglia.id, anno]);
        if (gia) return res.status(409).json({
            error: `${squadriglia.nome} ha già un guidoncino per il ${anno}/${String(anno + 1).slice(-2)}: se ne conquista uno all'anno.`,
        });

        const esito = await dbRun(
            'INSERT INTO guidoncino (rif_squadriglia, specialita, anno, confermata, rif_autore) VALUES (?, ?, ?, ?, ?)',
            [squadriglia.id, specialita, anno, body.confermata === true ? 1 : 0, utenteDaToken(req).id]);
        const riga = await dbGet('SELECT * FROM guidoncino WHERE id = ?', [esito.lastID]);
        res.status(201).json({ guidoncino: guidoncinoPubblico(riga) });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// La conferma: la squadriglia l'anno dopo ha rinnovato la specialità con una nuova impresa.
app.put('/api/guidoncini/:id', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        if (!(await puoGestireSquadriglie(req)))
            return res.status(403).json({ error: "I guidoncini li segnano i capi reparto." });
        const guidoncino = await dbGet('SELECT * FROM guidoncino WHERE id = ?', [req.params.id]);
        if (!guidoncino) return res.status(404).json({ error: "Guidoncino non trovato." });
        if (typeof req.body?.confermata !== 'boolean')
            return res.status(400).json({ error: "Richiesta non valida." });
        await dbRun('UPDATE guidoncino SET confermata = ? WHERE id = ?',
            [req.body.confermata ? 1 : 0, guidoncino.id]);
        const riga = await dbGet('SELECT * FROM guidoncino WHERE id = ?', [guidoncino.id]);
        res.json({ guidoncino: guidoncinoPubblico(riga) });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.delete('/api/guidoncini/:id', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        if (!(await puoGestireSquadriglie(req)))
            return res.status(403).json({ error: "I guidoncini li segnano i capi reparto." });
        const esito = await dbRun('DELETE FROM guidoncino WHERE id = ?', [req.params.id]);
        if (!esito.changes) return res.status(404).json({ error: "Guidoncino non trovato." });
        res.json({ message: "Guidoncino tolto." });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// ---------- La nostra storia ----------

// La pagina della storia la leggono tutti; la cambiano i capi (e i capigruppo): le tappe
// della linea in alto e le parti sotto, che si aggiungono, si spostano e si tolgono.
const ICONE_STORIA = new Set([
    'bandiera', 'casa', 'luogo', 'tempo', 'persone', 'scuola', 'cuore', 'mondo',
    'fuoco', 'foglia', 'barca', 'trofeo', 'calendario', 'passi', 'stella', 'libro',
]);
const MAX_TAPPE_STORIA = 40;
const MAX_PARTI_STORIA = 30;
const MAX_ETICHETTE_STORIA = 15;

/** Le pagine che hanno parti scritte dai capi. */
const PAGINE_CON_PARTI = new Set(['storia', 'marco']);

const TIPI_STORIA = {
    tappe: { tabella: 'storia_tappa', massimo: MAX_TAPPE_STORIA, nome: 'tappa' },
    parti: { tabella: 'storia_parte', massimo: MAX_PARTI_STORIA, nome: 'parte' },
};

function puoGestireStoria(req) {
    const ruolo = ruoloDaToken(req);
    return ruolo === 'capo' || ruolo === 'admin';
}

function tappaPubblica(t) {
    return {
        id: t.id, quando: t.quando, titolo: t.titolo, icona: t.icona,
        testo: t.testo, nota: t.nota || null, adesso: t.adesso === 1,
    };
}

function partePubblica(p) {
    let etichette = [];
    try { etichette = p.etichette ? JSON.parse(p.etichette) : []; } catch { etichette = []; }
    return {
        id: p.id, titolo: p.titolo, icona: p.icona, testo: p.testo,
        evidenza: p.evidenza || null, etichette, mostra_branche: p.mostra_branche === 1,
    };
}

/** I dati di una tappa o di una parte, puliti; se manca qualcosa di obbligatorio torna l'errore. */
function datiStoria(tipo, body) {
    const icona = ICONE_STORIA.has(body?.icona) ? body.icona : null;
    if (!icona) return { errore: "Scegli un'icona." };
    const titolo = testo(body.titolo, 100);
    if (!titolo) return { errore: 'Serve il titolo.' };
    const corpo = testo(body.testo, 5000);
    if (tipo === 'tappe') {
        const quando = testo(body.quando, 60);
        if (!quando) return { errore: 'Scrivi quando (es. "1983" o "Adesso").' };
        return { dati: { quando, titolo, icona, testo: corpo, nota: testo(body.nota, 1500) || null, adesso: body.adesso === true ? 1 : 0 } };
    }
    if (!corpo) return { errore: 'Serve il testo.' };
    const etichette = Array.isArray(body.etichette)
        ? body.etichette.map(e => testo(e, 60)).filter(Boolean).slice(0, MAX_ETICHETTE_STORIA)
        : [];
    return {
        dati: {
            titolo, icona, testo: corpo,
            evidenza: testo(body.evidenza, 2000) || null,
            etichette: etichette.length ? JSON.stringify(etichette) : null,
            mostra_branche: body.mostra_branche === true ? 1 : 0,
        },
    };
}

/** Il tipo dall'indirizzo (tappe o parti); se non esiste risponde 404 e torna null. */
function tipoStoria(req, res) {
    const tipo = TIPI_STORIA[req.params.tipo];
    if (!tipo) res.status(404).json({ error: 'Parte della storia non trovata.' });
    return tipo ?? null;
}

app.get('/api/storia', async (req, res) => {
    try {
        const tappe = await dbAll('SELECT * FROM storia_tappa ORDER BY ordine, id');
        const parti = await dbAll(`SELECT * FROM storia_parte WHERE pagina = 'storia' ORDER BY ordine, id`);
        res.json({
            tappe: tappe.map(tappaPubblica),
            parti: parti.map(partePubblica),
            puoGestire: puoGestireStoria(req),
        });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// La pagina di Marco "Orso Giocoso": solo parti, scritte dai capi come quelle della storia.
app.get('/api/marco', async (req, res) => {
    try {
        const parti = await dbAll(`SELECT * FROM storia_parte WHERE pagina = 'marco' ORDER BY ordine, id`);
        res.json({ parti: parti.map(partePubblica), puoGestire: puoGestireStoria(req) });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.post('/api/storia/:tipo', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const tipo = tipoStoria(req, res);
        if (!tipo) return;
        const { dati, errore } = datiStoria(req.params.tipo, req.body);
        if (errore) return res.status(400).json({ error: errore });
        // Le parti dicono in che pagina vanno (la storia, se non lo dicono).
        let dove = '';
        const valori = [];
        if (req.params.tipo === 'parti') {
            const pagina = req.body?.pagina ?? 'storia';
            if (!PAGINE_CON_PARTI.has(pagina)) return res.status(400).json({ error: 'Pagina non valida.' });
            dati.pagina = pagina;
            dove = ' WHERE pagina = ?';
            valori.push(pagina);
        }
        const { quante, ultimo } = await dbGet(
            `SELECT COUNT(*) AS quante, MAX(ordine) AS ultimo FROM ${tipo.tabella}${dove}`, valori);
        if (quante >= tipo.massimo)
            return res.status(400).json({ error: `Si possono avere al massimo ${tipo.massimo} voci qui.` });
        // Una nuova tappa "di oggi" prende il posto di quella di prima.
        if (dati.adesso) await dbRun('UPDATE storia_tappa SET adesso = 0');
        const campi = Object.keys(dati);
        const esito = await dbRun(
            `INSERT INTO ${tipo.tabella} (ordine, rif_autore, ${campi.join(', ')}) VALUES (?, ?, ${campi.map(() => '?').join(', ')})`,
            [(ultimo ?? 0) + 1, utenteDaToken(req).id, ...campi.map(c => dati[c])]);
        const riga = await dbGet(`SELECT * FROM ${tipo.tabella} WHERE id = ?`, [esito.lastID]);
        res.status(201).json({ voce: req.params.tipo === 'tappe' ? tappaPubblica(riga) : partePubblica(riga) });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.put('/api/storia/:tipo/:id', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const tipo = tipoStoria(req, res);
        if (!tipo) return;
        const esistente = await dbGet(`SELECT id FROM ${tipo.tabella} WHERE id = ?`, [req.params.id]);
        if (!esistente) return res.status(404).json({ error: `Questa ${tipo.nome} non c'è più.` });
        const { dati, errore } = datiStoria(req.params.tipo, req.body);
        if (errore) return res.status(400).json({ error: errore });
        if (dati.adesso) await dbRun('UPDATE storia_tappa SET adesso = 0 WHERE id <> ?', [esistente.id]);
        const campi = Object.keys(dati);
        await dbRun(
            `UPDATE ${tipo.tabella} SET ${campi.map(c => `${c} = ?`).join(', ')}, rif_autore = ?,
             data_modifica = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE id = ?`,
            [...campi.map(c => dati[c]), utenteDaToken(req).id, esistente.id]);
        const riga = await dbGet(`SELECT * FROM ${tipo.tabella} WHERE id = ?`, [esistente.id]);
        res.json({ voce: req.params.tipo === 'tappe' ? tappaPubblica(riga) : partePubblica(riga) });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// Sposta una voce di un posto in su o in giù, scambiandola con quella accanto.
app.post('/api/storia/:tipo/:id/sposta', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const tipo = tipoStoria(req, res);
        if (!tipo) return;
        const verso = req.body?.verso;
        if (verso !== 'su' && verso !== 'giu') return res.status(400).json({ error: 'Richiesta non valida.' });
        // Le parti si spostano solo fra quelle della stessa pagina.
        const voce = await dbGet(`SELECT * FROM ${tipo.tabella} WHERE id = ?`, [req.params.id]);
        if (!voce) return res.status(404).json({ error: `Questa ${tipo.nome} non c'è più.` });
        const righe = voce.pagina
            ? await dbAll(`SELECT id, ordine FROM ${tipo.tabella} WHERE pagina = ? ORDER BY ordine, id`, [voce.pagina])
            : await dbAll(`SELECT id, ordine FROM ${tipo.tabella} ORDER BY ordine, id`);
        const qui = righe.findIndex(r => r.id === voce.id);
        if (qui < 0) return res.status(404).json({ error: `Questa ${tipo.nome} non c'è più.` });
        const la = verso === 'su' ? qui - 1 : qui + 1;
        if (la < 0 || la >= righe.length) return res.json({ message: 'È già in fondo.' });
        // Si rinumera tutto da 1, così anche ordini doppi di prima tornano a posto.
        [righe[qui], righe[la]] = [righe[la], righe[qui]];
        for (let i = 0; i < righe.length; i++)
            await dbRun(`UPDATE ${tipo.tabella} SET ordine = ? WHERE id = ?`, [i + 1, righe[i].id]);
        res.json({ message: 'Spostata.' });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.delete('/api/storia/:tipo/:id', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const tipo = tipoStoria(req, res);
        if (!tipo) return;
        const esito = await dbRun(`DELETE FROM ${tipo.tabella} WHERE id = ?`, [req.params.id]);
        if (!esito.changes) return res.status(404).json({ error: `Questa ${tipo.nome} non c'è più.` });
        res.json({ message: 'Tolta.' });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// ---------- Carta di Clan ----------

// La Carta di Clan è un PDF. Quella in vigore (corrente = 1) si vede nel riquadro della
// sezione Clan; le precedenti restano nell'archivio. La leggono tutti, come la sezione Clan;
// la cambiano i capi clan (compreso un capogruppo che fa anche il capo clan).
const CARTELLA_CARTE = path.join(__dirname, 'uploads', 'carte');
fs.mkdirSync(CARTELLA_CARTE, { recursive: true });
const MAX_BYTE_CARTA = 20 * 1024 * 1024;
const MAX_TITOLO_CARTA = 120;

/** Un PDF vero comincia con "%PDF-": un file rinominato non passa. */
function eUnPdf(dati) {
    return Buffer.isBuffer(dati) && dati.length > 8 && dati.subarray(0, 5).toString('latin1') === '%PDF-';
}

/** Solo i capi del clan toccano le Carte: capi clan e capigruppo che fanno anche il capo clan. */
async function puoGestireCarta(req) {
    const chi = utenteDaToken(req);
    if (!chi) return false;
    const utente = await dbGet('SELECT ruolo, branca FROM utenti WHERE id = ?', [chi.id]);
    return !!utente && (utente.ruolo === 'capo' || utente.ruolo === 'admin') && utente.branca === 'clan';
}

function cartaPubblica(c) {
    return {
        id: c.id,
        titolo: c.titolo,
        anno: c.anno,
        url: c.percorso,
        nome_file: c.nome_originale,
        dimensione: c.dimensione,
        corrente: c.corrente === 1,
        autore: c.autore_nome ? `${c.autore_nome} ${c.autore_cognome}` : null,
        data_creazione: c.data_creazione,
    };
}

app.get('/api/carta-clan', async (req, res) => {
    try {
        const righe = await dbAll(`SELECT c.*, u.nome AS autore_nome, u.cognome AS autore_cognome
                                   FROM carta_clan c LEFT JOIN utenti u ON u.id = c.rif_autore
                                   ORDER BY c.corrente DESC, c.data_creazione DESC, c.id DESC`);
        const carte = righe.map(cartaPubblica);
        res.json({
            corrente: carte.find(c => c.corrente) ?? null,
            archivio: carte.filter(c => !c.corrente),
            puoGestire: await puoGestireCarta(req),
        });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// Il PDF arriva così com'è (niente base64), col nome nell'intestazione X-Nome-File.
// Quella che era in vigore scende nell'archivio e al suo posto va la nuova.
app.post('/api/carta-clan', verificaRuolo('capo', 'admin'),
    express.raw({ type: () => true, limit: MAX_BYTE_CARTA }),
    async (req, res) => {
        try {
            if (!(await puoGestireCarta(req)))
                return res.status(403).json({ error: "La Carta di Clan la cambiano i capi clan." });

            const dati = Buffer.isBuffer(req.body) ? req.body : null;
            if (!dati || !dati.length) return res.status(400).json({ error: "Il file è vuoto." });
            if (!eUnPdf(dati)) return res.status(400).json({ error: "La Carta di Clan dev'essere un PDF." });

            let nome;
            try { nome = decodeURIComponent(String(req.headers['x-nome-file'] ?? '')); } catch { nome = ''; }
            nome = path.basename(nome).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(-MAX_NOME_FILE) || 'carta-di-clan.pdf';
            let titolo, anno;
            try { titolo = decodeURIComponent(String(req.headers['x-titolo'] ?? '')); } catch { titolo = ''; }
            try { anno = decodeURIComponent(String(req.headers['x-anno'] ?? '')); } catch { anno = ''; }
            titolo = testo(titolo, MAX_TITOLO_CARTA) || 'Carta di Clan';
            anno = testo(anno, 20) || null;

            const nomeSuDisco = `${crypto.randomUUID()}.pdf`;
            await fs.promises.writeFile(path.join(CARTELLA_CARTE, nomeSuDisco), dati);
            const percorso = `/uploads/carte/${nomeSuDisco}`;
            try {
                await dbRun('UPDATE carta_clan SET corrente = 0 WHERE corrente = 1');
                const esito = await dbRun(`INSERT INTO carta_clan
                    (titolo, anno, percorso, nome_originale, dimensione, corrente, rif_autore)
                    VALUES (?, ?, ?, ?, ?, 1, ?)`,
                    [titolo, anno, percorso, nome, dati.length, req.user.id]);
                const riga = await dbGet(`SELECT c.*, u.nome AS autore_nome, u.cognome AS autore_cognome
                                          FROM carta_clan c LEFT JOIN utenti u ON u.id = c.rif_autore
                                          WHERE c.id = ?`, [esito.lastID]);
                res.status(201).json({ carta: cartaPubblica(riga) });
            } catch (err) {
                eliminaFile(CARTELLA_CARTE, percorso);
                throw err;
            }
        } catch (err) {
            erroreInterno(res, err);
        }
    });

// Cambia titolo e anno, o riporta nel riquadro una Carta che stava nell'archivio.
app.put('/api/carta-clan/:id', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        if (!(await puoGestireCarta(req)))
            return res.status(403).json({ error: "La Carta di Clan la cambiano i capi clan." });
        const carta = await dbGet('SELECT * FROM carta_clan WHERE id = ?', [req.params.id]);
        if (!carta) return res.status(404).json({ error: "Carta di Clan non trovata." });

        const body = req.body || {};
        const titolo = testo(body.titolo, MAX_TITOLO_CARTA) || carta.titolo;
        const anno = body.anno === null || body.anno === '' ? null : (testo(body.anno, 20) || carta.anno);
        // Metterla in vigore fa scendere nell'archivio quella che c'era.
        if (body.corrente === true && carta.corrente !== 1)
            await dbRun('UPDATE carta_clan SET corrente = 0 WHERE corrente = 1');
        const corrente = body.corrente === true ? 1 : carta.corrente;

        await dbRun('UPDATE carta_clan SET titolo = ?, anno = ?, corrente = ? WHERE id = ?',
            [titolo, anno, corrente, carta.id]);
        const riga = await dbGet(`SELECT c.*, u.nome AS autore_nome, u.cognome AS autore_cognome
                                  FROM carta_clan c LEFT JOIN utenti u ON u.id = c.rif_autore
                                  WHERE c.id = ?`, [carta.id]);
        res.json({ carta: cartaPubblica(riga) });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.delete('/api/carta-clan/:id', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        if (!(await puoGestireCarta(req)))
            return res.status(403).json({ error: "La Carta di Clan la rimuovono i capi clan." });
        const carta = await dbGet('SELECT * FROM carta_clan WHERE id = ?', [req.params.id]);
        if (!carta) return res.status(404).json({ error: "Carta di Clan non trovata." });

        await dbRun('DELETE FROM carta_clan WHERE id = ?', [carta.id]);
        eliminaFile(CARTELLA_CARTE, carta.percorso);
        // Se se ne va quella in vigore, torna nel riquadro la più recente dell'archivio.
        if (carta.corrente === 1) {
            const erede = await dbGet('SELECT id FROM carta_clan ORDER BY data_creazione DESC, id DESC LIMIT 1');
            if (erede) await dbRun('UPDATE carta_clan SET corrente = 1 WHERE id = ?', [erede.id]);
        }
        res.json({ message: "Carta di Clan rimossa." });
    } catch (err) {
        erroreInterno(res, err);
    }
});

// ---------- Avvisi sui contenuti (per ora: i capi clan sui ragazzi del clan) ----------

/** Segna che un ragazzo ha aggiunto o cambiato qualcosa: lo vedranno i capi della sua branca. */
async function segnalaContenuto(req, tipo, azione, titolo, idOggetto) {
    try {
        if (req.user?.ruolo !== 'ragazzo') return;
        const autore = await dbGet(`SELECT branca FROM utenti WHERE id = ?`, [req.user.id]);
        if (!autore?.branca) return;
        await dbRun(`INSERT INTO notifica_contenuto (tipo, azione, titolo, rif_oggetto, rif_autore, branca)
                     VALUES (?, ?, ?, ?, ?, ?)`,
            [tipo, azione, testo(titolo, 120) || 'Senza titolo', idOggetto ?? null, req.user.id, autore.branca]);
    } catch (err) {
        console.error('Avviso contenuto non salvato:', err.message);
    }
}

app.get('/api/notifiche-contenuti', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const branca = await brancaDelCapo(req.user.id);
        if (!branca) return res.json({ branca: null, notifiche: [] });
        const conLette = String(req.query.lette ?? '') === '1';
        const righe = await dbAll(`SELECT n.*, u.nome AS autore_nome, u.cognome AS autore_cognome
                                   FROM notifica_contenuto n LEFT JOIN utenti u ON u.id = n.rif_autore
                                   WHERE n.branca = ? ${conLette ? '' : 'AND n.letta = 0'}
                                   ORDER BY n.data_creazione DESC LIMIT 100`, [branca]);
        res.json({
            branca,
            notifiche: righe.map(n => ({
                id: n.id, tipo: n.tipo, azione: n.azione, titolo: n.titolo, rif_oggetto: n.rif_oggetto,
                autore: n.autore_nome ? `${n.autore_nome} ${n.autore_cognome}` : 'Un ragazzo',
                letta: n.letta === 1, data_creazione: n.data_creazione,
            })),
        });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.put('/api/notifiche-contenuti/:id/letta', verificaRuolo('capo', 'admin'), async (req, res) => {
    try {
        const branca = await brancaDelCapo(req.user.id);
        const riga = await dbGet(`SELECT * FROM notifica_contenuto WHERE id = ?`, [req.params.id]);
        if (!riga) return res.status(404).json({ error: "Avviso non trovato." });
        if (!branca || riga.branca !== branca)
            return res.status(403).json({ error: "Questo avviso è di un'altra branca." });
        const letta = req.body?.letta === false ? 0 : 1;
        await dbRun(`UPDATE notifica_contenuto SET letta = ? WHERE id = ?`, [letta, riga.id]);
        res.json({ id: riga.id, letta: letta === 1 });
    } catch (err) {
        erroreInterno(res, err);
    }
});

app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
        const conFoto = ROTTE_CON_FOTO.some(r => req.path.startsWith(r));
        return res.status(413).json({ error: req.path.includes('/allegati')
            ? "File troppo grande: il massimo è 15 MB."
            : req.path.startsWith('/api/carta-clan') ? "La Carta di Clan è troppo grande: il massimo è 20 MB."
                : /^\/api\/post\/\d+\/video/.test(req.path) ? "Video troppo grande: il massimo è 50 MB (circa un minuto)."
                : conFoto ? "File troppo grande: carica una foto più leggera."
                    : "Richiesta troppo grande." });
    }
    // JSON scritto male: è un errore di chi manda, non del server.
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: "Richiesta non valida." });
    erroreInterno(res, err);
});

// ---------- Accensione ----------
// ---------- Avvio ----------
//
// Password e token non devono mai passare in chiaro su una rete. Quindi:
//  - con HTTPS_KEY e HTTPS_CERT il server parla HTTPS e si fa raggiungere da tutta la rete;
//  - con DIETRO_PROXY=1 l'HTTPS lo fa il proxy (o il servizio di hosting) che sta davanti;
//  - altrimenti parla in chiaro, ma ascolta SOLO sul computer stesso (localhost): dal Wi-Fi
//    non lo raggiunge nessuno, e il traffico non esce mai dalla macchina.
// In produzione la terza strada non esiste: senza HTTPS il server non parte.
const http = require('http');

if (process.env.NODE_ENV === 'production' && !HTTPS_ACCESO && !DIETRO_PROXY) {
    console.error('❌ In produzione il backend non parte senza HTTPS: password e token viaggerebbero in chiaro.');
    console.error('   Metti HTTPS_KEY e HTTPS_CERT nel file .env, oppure un proxy HTTPS davanti con DIETRO_PROXY=1.');
    process.exit(1);
}

/** Mette il server in ascolto su un indirizzo; se quell'indirizzo non esiste (niente IPv6), pazienza. */
function ascolta(server, indirizzo, poi) {
    server.once('error', (err) => {
        if (err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT') return;
        console.error(`❌ Non riesco ad ascoltare su ${indirizzo}:${PORT}:`, err.message);
        process.exit(1);
    });
    server.listen(PORT, indirizzo, poi);
}

if (HTTPS_ACCESO) {
    let credenziali;
    try {
        credenziali = { key: fs.readFileSync(process.env.HTTPS_KEY), cert: fs.readFileSync(process.env.HTTPS_CERT) };
    } catch (err) {
        console.error('❌ Non riesco a leggere il certificato HTTPS:', err.message);
        process.exit(1);
    }
    ascolta(https.createServer(credenziali, app), '0.0.0.0', () => {
        console.log(`🔒 Backend agescipalermo11 in ascolto su https://${HOST}:${PORT} (e https://localhost:${PORT})`);
    });
} else if (DIETRO_PROXY) {
    ascolta(http.createServer(app), '0.0.0.0', () => {
        console.log(`🔒 Backend agescipalermo11 dietro al proxy HTTPS, porta ${PORT}`);
    });
} else {
    // Due volte: "localhost" può voler dire 127.0.0.1 o ::1, a seconda del browser.
    ascolta(http.createServer(app), '127.0.0.1', () => {
        console.log(`🚀 Backend agescipalermo11 in ascolto su http://localhost:${PORT} (solo da questo computer)`);
    });
    ascolta(http.createServer(app), '::1');
}

// Dice subito nel terminale se le email partono o no (password per le app sbagliata, ecc.).
controllaPosta();
