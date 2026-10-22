// Il passaggio a Vercel, dal Mac. Due comandi:
//
//   npm run vercel:variabili   prepara per-il-server/vercel-variabili.env: le impostazioni del
//                              backend (chiavi comprese) da incollare su Vercel, in
//                              Settings → Environment Variables → "Import .env".
//
//   npm run vercel:carica      copia i dati del Mac nel database di Vercel (Neon) e le foto e i
//                              PDF in Vercel Blob. Prima scrivi in per-il-server/vercel.env le
//                              due righe DATABASE_URL=… e BLOB_READ_WRITE_TOKEN=… prese da Vercel.
//
// Tutti e due i file stanno in per-il-server/, che non va su GitHub: dentro ci sono le chiavi.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const CARTELLA = path.join(__dirname, 'per-il-server');
const FILE_VARIABILI = path.join(CARTELLA, 'vercel-variabili.env');
const FILE_ACCESSI = path.join(CARTELLA, 'vercel.env');
// I domini veri: il giorno che il DNS punta a Vercel valgono già. Gli indirizzi *.vercel.app
// li aggiunge da solo il backend (vedi ALLOWED_ORIGINS in server.js).
const ORIGINI = ['https://newsite.palermo11.it', 'https://palermo11.it', 'https://www.palermo11.it'];
// Le cartelle con i file caricati: su Blob finiscono con lo stesso percorso.
const CARTELLE_FILE = ['uploads', 'documenti-riservati'];

function variabili() {
    require('./configurazione');
    const e = process.env;
    const riga = (nome, valore) => `${nome}=${valore ?? ''}`;
    const testo = [
        '# Impostazioni del backend su Vercel. Da incollare in Settings → Environment Variables',
        '# → "Import .env" (per Production). NON va su GitHub e non va mandato a nessuno.',
        riga('DIETRO_PROXY', '1'),
        riga('ALLOWED_ORIGINS', ORIGINI.join(',')),
        '# Le stesse chiavi del Mac: con chiavi diverse i dati cifrati non si leggerebbero più.',
        riga('JWT_SECRET', e.JWT_SECRET),
        riga('DB_KEY', e.DB_KEY),
        '# La chiave con cui Vercel chiama le pulizie di ogni notte (nuova, solo per Vercel).',
        riga('CRON_SECRET', crypto.randomBytes(32).toString('base64url')),
        riga('SMTP_HOST', e.SMTP_HOST),
        riga('SMTP_PORT', e.SMTP_PORT),
        riga('SMTP_UTENTE', e.SMTP_UTENTE),
        riga('SMTP_PASSWORD', e.SMTP_PASSWORD),
        `MAIL_MITTENTE="${String(e.MAIL_MITTENTE || '').replace(/"/g, '')}"`,
        '',
    ].join('\n');
    fs.mkdirSync(CARTELLA, { recursive: true, mode: 0o700 });
    fs.writeFileSync(FILE_VARIABILI, testo, { mode: 0o600 });
    console.log('🔐 Pronto: per-il-server/vercel-variabili.env (da incollare su Vercel, poi puoi cancellarlo).');
}

/** Le righe NOME=valore di per-il-server/vercel.env. */
function leggiAccessi() {
    if (!fs.existsSync(FILE_ACCESSI)) {
        fs.writeFileSync(FILE_ACCESSI, '# Incolla qui le due righe prese da Vercel:\nDATABASE_URL=\nBLOB_READ_WRITE_TOKEN=\n', { mode: 0o600 });
        throw new Error('ho creato per-il-server/vercel.env: scrivici DATABASE_URL e BLOB_READ_WRITE_TOKEN e rilancia');
    }
    const valori = {};
    for (const riga of fs.readFileSync(FILE_ACCESSI, 'utf8').split('\n')) {
        const m = riga.trim().match(/^(DATABASE_URL|BLOB_READ_WRITE_TOKEN)\s*=\s*["']?(.*?)["']?$/);
        if (m && m[2]) valori[m[1]] = m[2];
    }
    for (const nome of ['DATABASE_URL', 'BLOB_READ_WRITE_TOKEN'])
        if (!valori[nome]) throw new Error(`in per-il-server/vercel.env manca ${nome}`);
    return valori;
}

/** Tutti i file di una cartella, anche nelle sottocartelle (percorsi relativi al backend). */
function fileIn(cartella) {
    const assoluta = path.join(__dirname, cartella);
    if (!fs.existsSync(assoluta)) return [];
    const trovati = [];
    for (const voce of fs.readdirSync(assoluta, { withFileTypes: true })) {
        if (voce.name.startsWith('.')) continue;
        const relativo = path.join(cartella, voce.name);
        if (voce.isDirectory()) trovati.push(...fileIn(relativo));
        else if (voce.isFile()) trovati.push(relativo);
    }
    return trovati;
}

async function carica() {
    const accessi = leggiAccessi();

    // 1. I dati del Mac, come per un server normale: un pacchetto cifrato con la DB_KEY.
    //    (Si prepara col database del Mac, quindi in un processo a parte, senza DATABASE_URL.)
    console.log('📦 Preparo i dati del Mac…');
    execFileSync(process.execPath, [path.join(__dirname, 'prepara-server.js')], { stdio: 'inherit' });

    // Da qui in poi si parla con Vercel: database Neon e spazio Blob.
    process.env.DATABASE_URL = accessi.DATABASE_URL;
    process.env.BLOB_READ_WRITE_TOKEN = accessi.BLOB_READ_WRITE_TOKEN;

    console.log('🗄️  Carico i dati nel database di Vercel…');
    const { importaDati } = require('./importa-dati');
    const esito = await importaDati(path.join(CARTELLA, 'dati-palermo11.json.cif'));
    if (esito.importato) console.log(`✅ Dati importati: ${esito.righe} righe.`);
    else console.log(`ℹ️  Dati non importati: ${esito.motivo}.`);

    // 2. Foto e PDF: su Blob con lo stesso percorso che hanno qui (i PDF delle schede restano cifrati).
    const archivio = require('./archivio');
    const tutti = CARTELLE_FILE.flatMap(fileIn);
    console.log(`🖼️  Carico ${tutti.length} file su Blob…`);
    let fatti = 0;
    for (const relativo of tutti) {
        await archivio.scrivi(path.join(__dirname, path.dirname(relativo)), path.basename(relativo),
            fs.readFileSync(path.join(__dirname, relativo)));
        if (++fatti % 20 === 0 || fatti === tutti.length) console.log(`   ${fatti}/${tutti.length}`);
    }
    console.log('🎉 Fatto: il sito su Vercel ha i dati e i file del Mac.');
}

const comando = process.argv[2];
(comando === 'variabili' ? Promise.resolve().then(variabili) : comando === 'carica' ? carica()
    : Promise.reject(new Error('uso: node passa-a-vercel.js variabili | carica')))
    .catch(err => {
        console.error('❌', err.message);
        process.exitCode = 1;
    });
