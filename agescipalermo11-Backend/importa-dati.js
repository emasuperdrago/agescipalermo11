// Carica nel database dell'hosting i dati preparati sul Mac con "npm run server:prepara"
// (il file dati-palermo11.json.cif, caricato nella cartella del backend).
// Succede da solo al primo avvio del backend, se il file c'è (vedi db.js); si può anche
// lanciare a mano con "npm run dati:importa", se il pannello dell'hosting lo permette.
//
// ATTENZIONE: prende il posto di tutto quello che c'è nel database del server. Per questo:
//  - la seconda volta non parte, a meno di scrivere FORZA_IMPORTAZIONE=1 nel .env;
//  - finito, il file viene rinominato (".importato"), così non si ricarica per sbaglio.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('./configurazione');
const { decriptaFile, sigilloChiave } = require('./cifratura');
const { creaSchema, ORDINE_TABELLE } = require('./schema');

const FILE = path.join(__dirname, 'dati-palermo11.json.cif');

/**
 * Importa i dati, se il file c'è. Torna { importato: true, righe } se li ha caricati,
 * { importato: false, motivo } se non c'era niente da fare; lancia un errore se il file
 * c'è ma non si può usare (DB_KEY diversa, file rovinato, database che rifiuta i dati).
 */
async function importaDati() {
    if (!fs.existsSync(FILE)) return { importato: false, motivo: 'nessun file da importare' };
    let pacchetto;
    try {
        pacchetto = JSON.parse(decriptaFile(fs.readFileSync(FILE)).toString('utf8'));
    } catch {
        throw new Error('il file dei dati non si apre: la DB_KEY nel .env non è quella del Mac (o il file è rovinato)');
    }
    if (pacchetto.sigillo !== sigilloChiave())
        throw new Error('la DB_KEY nel .env non è quella del Mac: i dati cifrati non si leggerebbero');

    const client = new Client({
        host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
        ...(process.env.DB_SSL === '1' ? { ssl: { rejectUnauthorized: true } } : {}),
    });
    await client.connect();
    try {
        // Le tabelle ci sono già se il backend è partito almeno una volta; se no si creano.
        await creaSchema(sql => client.query(sql));
        const gia = await client.query(`SELECT valore FROM impostazioni WHERE chiave = 'dati_importati_il'`);
        if (gia.rows.length && process.env.FORZA_IMPORTAZIONE !== '1') {
            return {
                importato: false,
                motivo: `i dati sono già stati importati il ${gia.rows[0].valore}: rifarlo cancellerebbe quello che è `
                    + `stato fatto online da allora (se è proprio quello che vuoi: FORZA_IMPORTAZIONE=1 nel .env)`,
            };
        }

        await client.query('BEGIN');
        try {
            // Via quello che il backend ha messo da solo al primo avvio (canti, storia, sfondi…):
            // al suo posto arrivano i dati veri del Mac, con gli stessi numeri (id).
            await client.query(`TRUNCATE ${ORDINE_TABELLE.join(', ')} RESTART IDENTITY CASCADE`);
            let righe = 0;
            for (const tabella of ORDINE_TABELLE) {
                const dati = pacchetto.tabelle[tabella];
                if (!dati || !dati.righe.length) continue;
                const colonne = dati.colonne.map(c => `"${c}"`).join(', ');
                const segnaposti = dati.colonne.map((_, i) => `$${i + 1}`).join(', ');
                for (const riga of dati.righe) {
                    await client.query(`INSERT INTO ${tabella} (${colonne}) VALUES (${segnaposti})`, riga);
                    righe++;
                }
                // I prossimi id ripartono dopo l'ultimo importato.
                if (dati.colonne.includes('id'))
                    await client.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), (SELECT MAX(id) FROM ${tabella}))`, [tabella]);
            }
            await client.query(
                `INSERT INTO impostazioni (chiave, valore) VALUES ('dati_importati_il', $1)
                 ON CONFLICT (chiave) DO UPDATE SET valore = EXCLUDED.valore`, [new Date().toISOString()]);
            await client.query('COMMIT');
            fs.renameSync(FILE, `${FILE}.importato`);
            return { importato: true, righe, creato: pacchetto.creato };
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw new Error(`importazione non riuscita, il database è rimasto com'era: ${err.message}`);
        }
    } finally {
        await client.end();
    }
}

module.exports = { importaDati };

// Lanciato a mano: "npm run dati:importa".
if (require.main === module) {
    importaDati().then(esito => {
        if (esito.importato) {
            console.log(`✅ Dati importati: ${esito.righe} righe (preparati sul Mac il ${esito.creato}).`);
            console.log('   Ora riavvia la app e cancella dal server il file .importato.');
        } else {
            console.error(`❌ Niente da importare: ${esito.motivo}.`);
            process.exitCode = 1;
        }
    }).catch(err => {
        console.error('❌', err.message);
        process.exitCode = 1;
    });
}
