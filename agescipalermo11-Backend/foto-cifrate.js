// Le foto in cui si vedono i ragazzi non vanno in chiaro nel repository (che è pubblico):
// lì c'è solo una copia cifrata con la DB_KEY, accanto all'originale ("foto.jpg.cif").
// Gli originali restano sul computer e sono esclusi da Git (vedi .gitignore).
//
//   node foto-cifrate.js cifra     → crea/aggiorna le copie cifrate degli originali (prima del push)
//   node foto-cifrate.js decifra   → rimette gli originali a partire dalle copie cifrate
const fs = require('fs');
const path = require('path');
const { criptaFile, decriptaFile } = require('./cifratura');

const ESTENSIONE = '.cif';
const IMMAGINE = /\.(jpe?g|png|webp)$/i;
// Dove stanno le foto da proteggere e quali sono.
const CARTELLE = [
    { cartella: path.join(__dirname, 'dati', 'sfondi-iniziali'), protetta: (nome) => IMMAGINE.test(nome) },
    { cartella: path.join(__dirname, '..', 'agescipalermo11', 'src', 'assets', 'sfondo'),
      protetta: (nome) => nome.startsWith('campo-di-gruppo') && IMMAGINE.test(nome) },
];

function elenco(cartella) {
    try { return fs.readdirSync(cartella); } catch { return []; }
}

function cifra() {
    let fatte = 0;
    for (const { cartella, protetta } of CARTELLE) {
        for (const nome of elenco(cartella).filter(protetta)) {
            const originale = fs.readFileSync(path.join(cartella, nome));
            const destinazione = path.join(cartella, nome + ESTENSIONE);
            // Se la copia cifrata c'è già ed è della stessa foto non si rifà: ogni cifratura
            // viene diversa e Git la vedrebbe come una modifica.
            if (fs.existsSync(destinazione)) {
                try { if (decriptaFile(fs.readFileSync(destinazione)).equals(originale)) continue; } catch { /* si rifà */ }
            }
            fs.writeFileSync(destinazione, criptaFile(originale));
            console.log('🔒', path.relative(path.join(__dirname, '..'), destinazione));
            fatte++;
        }
    }
    console.log(fatte ? `Copie cifrate aggiornate: ${fatte}` : 'Le copie cifrate sono già aggiornate.');
}

function decifra() {
    let fatte = 0;
    for (const { cartella } of CARTELLE) {
        for (const nome of elenco(cartella).filter(n => n.endsWith(ESTENSIONE))) {
            const originale = path.join(cartella, nome.slice(0, -ESTENSIONE.length));
            const dati = decriptaFile(fs.readFileSync(path.join(cartella, nome)));
            if (fs.existsSync(originale) && fs.readFileSync(originale).equals(dati)) continue;
            fs.writeFileSync(originale, dati);
            console.log('🔓', path.relative(path.join(__dirname, '..'), originale));
            fatte++;
        }
    }
    console.log(fatte ? `Foto rimesse in chiaro: ${fatte}` : 'Le foto in chiaro ci sono già tutte.');
}

const comando = process.argv[2];
if (comando === 'cifra') cifra();
else if (comando === 'decifra') decifra();
else {
    console.log('Uso: node foto-cifrate.js cifra | decifra');
    process.exit(1);
}
