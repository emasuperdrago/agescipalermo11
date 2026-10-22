// Dove stanno i file caricati (foto, video, PDF). Sul Mac e su un server normale: nelle cartelle
// uploads/ e documenti-riservati/, come sempre. Su Vercel il disco si cancella da solo, quindi
// gli stessi file vanno in Vercel Blob, in uno spazio PRIVATO: nessun file si apre col suo
// indirizzo su Blob, passano tutti dal backend, che controlla i permessi come per il disco.
//
// Le rotte del server non cambiano: parlano di "cartella" (il percorso su disco di prima) e
// "nome del file"; su Blob la cartella diventa il prefisso, es. "uploads/post/<nome>".
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const BASE = __dirname;
// Su Vercel, collegando uno spazio Blob al progetto, arriva da solo il suo token.
const SU_BLOB = !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const blob = SU_BLOB ? require('@vercel/blob') : null;

/** "uploads/post/abc.jpg": il nome del file su Blob, uguale al percorso relativo su disco. */
function nomeSuBlob(cartella, nome) {
    const relativa = path.relative(BASE, cartella).split(path.sep).join('/');
    return `${relativa}/${path.basename(nome)}`;
}

/** Crea la cartella sul disco (su Blob le cartelle non esistono: non serve niente). */
function prepara(cartella, opzioni = {}) {
    if (!SU_BLOB) fs.mkdirSync(cartella, { recursive: true, ...opzioni });
}

async function scrivi(cartella, nome, dati, opzioni = {}) {
    if (!SU_BLOB) return fs.promises.writeFile(path.join(cartella, path.basename(nome)), dati, opzioni);
    await blob.put(nomeSuBlob(cartella, nome), dati, {
        access: 'private', addRandomSuffix: false, allowOverwrite: true,
    });
}

async function leggi(cartella, nome) {
    if (!SU_BLOB) return fs.promises.readFile(path.join(cartella, path.basename(nome)));
    const esito = await blob.get(nomeSuBlob(cartella, nome), { access: 'private' });
    if (!esito || esito.statusCode !== 200) throw Object.assign(new Error('File non trovato'), { code: 'ENOENT' });
    return Buffer.from(await new Response(esito.stream).arrayBuffer());
}

/** Toglie un file. Non aspetta e non si ferma se il file non c'è già più. */
function elimina(cartella, nome) {
    if (!nome) return;
    if (!SU_BLOB) return fs.unlink(path.join(cartella, path.basename(nome)), () => {});
    blob.del(nomeSuBlob(cartella, nome)).catch(() => {});
}

/** I nomi dei file nella cartella. */
async function elenca(cartella) {
    if (!SU_BLOB) return fs.promises.readdir(cartella);
    const prefisso = `${path.relative(BASE, cartella).split(path.sep).join('/')}/`;
    const nomi = [];
    let cursore;
    do {
        const pagina = await blob.list({ prefix: prefisso, cursor: cursore, limit: 1000 });
        for (const b of pagina.blobs) nomi.push(b.pathname.slice(prefisso.length));
        cursore = pagina.hasMore ? pagina.cursor : undefined;
    } while (cursore);
    return nomi;
}

/**
 * Manda un file al browser. Da Blob arriva "a pezzi" (stream), così anche un file più grande
 * di quanto Vercel lascia mandare tutto in una volta passa senza problemi.
 * `scaricaCome`: il nome con cui il browser lo salva (se manca, il file si apre e basta).
 */
async function invia(res, cartella, nome, { scaricaCome, cache } = {}) {
    nome = path.basename(nome);
    res.type(path.extname(nome) || 'application/octet-stream');
    if (scaricaCome) res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(scaricaCome)}`);
    if (cache) res.setHeader('Cache-Control', cache);
    if (!SU_BLOB) {
        return new Promise((ok, ko) => res.sendFile(path.join(cartella, nome), { dotfiles: 'deny' },
            err => err ? ko(Object.assign(err, { code: err.code || 'ENOENT' })) : ok()));
    }
    const esito = await blob.get(nomeSuBlob(cartella, nome), { access: 'private' });
    if (!esito || esito.statusCode !== 200) throw Object.assign(new Error('File non trovato'), { code: 'ENOENT' });
    if (esito.blob.size != null) res.setHeader('Content-Length', String(esito.blob.size));
    await new Promise((ok, ko) => Readable.fromWeb(esito.stream).on('error', ko).pipe(res).on('finish', ok).on('error', ko));
}

/** Manda dati già in memoria a pezzi (vedi `invia`): serve per i PDF decifrati delle schede. */
function inviaDati(res, dati) {
    res.setHeader('Content-Length', String(dati.length));
    Readable.from([dati]).pipe(res);
}

// ---------- Caricamenti grandi (solo su Vercel) ----------
// Vercel non fa arrivare al backend richieste più grandi di 4,5 MB. Per i file più grossi il
// browser li mette prima in Blob, in "tmp/<id utente>/<codice>", e poi manda la richiesta
// vera senza corpo, col nome di quel file: il backend lo riprende da lì e lo toglie.

/** Il file messo dal browser in tmp/: lo legge e lo toglie subito. */
async function prendiCaricato(percorso) {
    const esito = await blob.get(percorso, { access: 'private' });
    if (!esito || esito.statusCode !== 200) throw Object.assign(new Error('Caricamento non trovato'), { code: 'ENOENT' });
    const dati = Buffer.from(await new Response(esito.stream).arrayBuffer());
    blob.del(percorso).catch(() => {});
    return dati;
}

/** Toglie i caricamenti rimasti a metà (il browser li ha messi in tmp/ ma poi non li ha usati). */
async function pulisciCaricati() {
    if (!SU_BLOB) return;
    const limite = Date.now() - 24 * 60 * 60 * 1000;
    let cursore;
    do {
        const pagina = await blob.list({ prefix: 'tmp/', cursor: cursore, limit: 1000 });
        const vecchi = pagina.blobs.filter(b => new Date(b.uploadedAt).getTime() < limite).map(b => b.pathname);
        if (vecchi.length) await blob.del(vecchi);
        cursore = pagina.hasMore ? pagina.cursor : undefined;
    } while (cursore);
}

module.exports = {
    SU_BLOB, prepara, scrivi, leggi, elimina, elenca, invia, inviaDati, nomeSuBlob, prendiCaricato, pulisciCaricati,
};
