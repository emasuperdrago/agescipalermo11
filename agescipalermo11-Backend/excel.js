// Scrive un file .xlsx senza librerie in più: un foglio solo, tutto testo.
// Serve per far scaricare ai capi un file che si possa ricaricare tale e quale
// nella pagina dei codici censimento.
const zlib = require('zlib');

// ---------- Zip ----------

// Tabella del CRC32, quella che vuole il formato zip.
const TABELLA_CRC = (() => {
    const tabella = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        tabella[i] = c;
    }
    return tabella;
})();

function crc32(dati) {
    let c = 0 ^ (-1);
    for (let i = 0; i < dati.length; i++) c = (c >>> 8) ^ TABELLA_CRC[(c ^ dati[i]) & 0xFF];
    return (c ^ (-1)) >>> 0;
}

/** Mette insieme i file in un archivio zip (è quello che è un .xlsx). */
function creaZip(file) {
    const pezzi = [];
    const indice = [];
    let posizione = 0;

    for (const { nome, contenuto } of file) {
        const dati = Buffer.from(contenuto, 'utf8');
        const compresso = zlib.deflateRawSync(dati);
        const nomeBuf = Buffer.from(nome, 'utf8');
        const crc = crc32(dati);

        const testa = Buffer.alloc(30);
        testa.writeUInt32LE(0x04034b50, 0);   // firma
        testa.writeUInt16LE(20, 4);           // versione minima
        testa.writeUInt16LE(0, 6);            // niente bandiere
        testa.writeUInt16LE(8, 8);            // deflate
        testa.writeUInt16LE(0, 10);           // ora
        testa.writeUInt16LE(0x21, 12);        // data (1° gennaio 1980)
        testa.writeUInt32LE(crc, 14);
        testa.writeUInt32LE(compresso.length, 18);
        testa.writeUInt32LE(dati.length, 22);
        testa.writeUInt16LE(nomeBuf.length, 26);
        testa.writeUInt16LE(0, 28);
        pezzi.push(testa, nomeBuf, compresso);

        const voce = Buffer.alloc(46);
        voce.writeUInt32LE(0x02014b50, 0);
        voce.writeUInt16LE(20, 4);
        voce.writeUInt16LE(20, 6);
        voce.writeUInt16LE(0, 8);
        voce.writeUInt16LE(8, 10);
        voce.writeUInt16LE(0, 12);
        voce.writeUInt16LE(0x21, 14);
        voce.writeUInt32LE(crc, 16);
        voce.writeUInt32LE(compresso.length, 20);
        voce.writeUInt32LE(dati.length, 24);
        voce.writeUInt16LE(nomeBuf.length, 28);
        voce.writeUInt32LE(posizione, 42);
        indice.push(voce, nomeBuf);

        posizione += testa.length + nomeBuf.length + compresso.length;
    }

    const corpo = Buffer.concat(pezzi);
    const elenco = Buffer.concat(indice);
    const chiusura = Buffer.alloc(22);
    chiusura.writeUInt32LE(0x06054b50, 0);
    chiusura.writeUInt16LE(file.length, 8);
    chiusura.writeUInt16LE(file.length, 10);
    chiusura.writeUInt32LE(elenco.length, 12);
    chiusura.writeUInt32LE(corpo.length, 16);
    return Buffer.concat([corpo, elenco, chiusura]);
}

// ---------- Foglio ----------

function testoXml(valore) {
    return String(valore ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Lettera della colonna: 1 = A, 27 = AA. */
function colonna(numero) {
    let nome = '';
    while (numero > 0) {
        const resto = (numero - 1) % 26;
        nome = String.fromCharCode(65 + resto) + nome;
        numero = Math.floor((numero - 1) / 26);
    }
    return nome;
}

/**
 * Un .xlsx con un foglio solo. `righe` è un elenco di elenchi: la prima è quella
 * delle intestazioni. Tutte le celle sono testo, così le date restano come scritte.
 */
function creaXlsx(righe, nomeFoglio = 'Foglio1') {
    const corpo = righe.map((riga, i) => {
        const celle = riga.map((valore, j) => {
            const dove = `${colonna(j + 1)}${i + 1}`;
            if (valore === null || valore === undefined || valore === '') return `<c r="${dove}"/>`;
            return `<c r="${dove}" t="inlineStr"><is><t xml:space="preserve">${testoXml(valore)}</t></is></c>`;
        }).join('');
        return `<row r="${i + 1}">${celle}</row>`;
    }).join('');

    const foglio = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + `<sheetData>${corpo}</sheetData></worksheet>`;

    return creaZip([
        {
            nome: '[Content_Types].xml',
            contenuto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                + '<Default Extension="xml" ContentType="application/xml"/>'
                + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                + '</Types>',
        },
        {
            nome: '_rels/.rels',
            contenuto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                + '</Relationships>',
        },
        {
            nome: 'xl/workbook.xml',
            contenuto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                + `<sheets><sheet name="${testoXml(nomeFoglio)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        },
        {
            nome: 'xl/_rels/workbook.xml.rels',
            contenuto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
                + '</Relationships>',
        },
        { nome: 'xl/worksheets/sheet1.xml', contenuto: foglio },
    ]);
}

module.exports = { creaXlsx };
