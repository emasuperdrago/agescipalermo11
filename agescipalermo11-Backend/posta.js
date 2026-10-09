// Invio delle email del sito (per ora: la conferma dell'indirizzo alla registrazione).
// Il server di posta si sceglie nel file .env: per le prove in locale un account Gmail con
// una "password per le app", più avanti la casella del dominio del gruppo. Il codice resta
// uguale: cambiano solo SMTP_HOST, SMTP_PORT, SMTP_UTENTE, SMTP_PASSWORD e MAIL_MITTENTE.
const nodemailer = require('nodemailer');

const HOST = (process.env.SMTP_HOST || '').trim();
const PORTA = Number(process.env.SMTP_PORT || 465);
const UTENTE = (process.env.SMTP_UTENTE || '').trim();
// Gmail mostra la password per le app a gruppi di 4 lettere: gli spazi non contano.
const PASSWORD = (process.env.SMTP_PASSWORD || '').replace(/\s+/g, '');
const MITTENTE = (process.env.MAIL_MITTENTE || '').trim() || (UTENTE ? `Gruppo Scout Palermo 11 <${UTENTE}>` : '');

/** Vero quando nel .env c'è tutto quello che serve per mandare email. */
const postaPronta = !!(HOST && UTENTE && PASSWORD);

const trasporto = postaPronta
    ? nodemailer.createTransport({
        host: HOST,
        port: PORTA,
        // 465 = connessione cifrata da subito; con 587 si passa al cifrato subito dopo (STARTTLS),
        // e requireTLS impedisce di proseguire in chiaro.
        secure: PORTA === 465,
        requireTLS: PORTA !== 465,
        auth: { user: UTENTE, pass: PASSWORD },
        // Se la rete non risponde ci si arrende presto (di suo aspetterebbe minuti) e si riprova.
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 60000,
        // Niente file o indirizzi web dentro le email: si manda solo il testo che scriviamo noi.
        disableFileAccess: true,
        disableUrlAccess: true,
    })
    : null;

/** Controlla all'avvio che il server di posta risponda e che la password sia giusta. */
async function controllaPosta() {
    if (!trasporto) {
        console.warn('✉️  Invio email non impostato (SMTP_* nel .env): le email di conferma non partono.');
        return;
    }
    try {
        await trasporto.verify();
        console.log(`✉️  Email pronte: si inviano da ${UTENTE}`);
    } catch (err) {
        if (erroreDiRete(err))
            console.error(`❌ Il server di posta non è raggiungibile adesso (${descriviErrore(err)}): controlla la connessione a internet.`);
        else
            console.error(`❌ Il server di posta non accetta l'accesso (${descriviErrore(err)}). Controlla SMTP_UTENTE e SMTP_PASSWORD nel .env.`);
    }
}

// Errori della rete (connessione caduta, Wi-Fi che si riconnette, server che non risponde):
// passano da soli, quindi si riprova. Gli altri (password sbagliata, indirizzo rifiutato) no.
const ERRORI_DI_RETE = new Set(['ESOCKET', 'ECONNECTION', 'ETIMEDOUT', 'EDNS', 'ECONNRESET', 'ENETUNREACH',
                                'EHOSTUNREACH', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND']);
function erroreDiRete(err) {
    return !err.responseCode && (ERRORI_DI_RETE.has(err.code) || ERRORI_DI_RETE.has(err.cause?.code));
}

/** L'errore per il terminale: codice, fase e messaggio, senza gli indirizzi email. */
function descriviErrore(err) {
    const parti = [err.code, err.command && `durante ${err.command}`, err.message];
    return parti.filter(Boolean).join(' · ').replace(/[^\s@<>"']+@[^\s@<>"']+/g, '[email]');
}

const aspetta = (ms) => new Promise(fatto => setTimeout(fatto, ms));

/**
 * Manda un'email. Se la posta non è impostata lancia un errore: chi chiama decide cosa dire.
 * Se cade la rete riprova dopo le attese indicate: brevi per chi sta aspettando la risposta
 * sul sito (conferme, password), più lunghe per gli avvisi che partono in sottofondo.
 */
async function inviaEmail({ a, oggetto, testo, html }, attese = [2000]) {
    if (!trasporto) throw new Error('POSTA_NON_IMPOSTATA');
    for (let tentativo = 0; ; tentativo++) {
        try {
            await trasporto.sendMail({ from: MITTENTE, to: a, subject: oggetto, text: testo, html });
            if (tentativo) console.log(`✉️  Email partita al tentativo n. ${tentativo + 1}.`);
            return;
        } catch (err) {
            if (!erroreDiRete(err) || tentativo >= attese.length) throw err;
            console.warn(`✉️  Email non partita (${descriviErrore(err)}): riprovo tra ${attese[tentativo] / 1000} s…`);
            await aspetta(attese[tentativo]);
        }
    }
}

/** Per gli avvisi in sottofondo: si riprova più volte, fino a qualche minuto dopo. */
const ATTESE_SOTTOFONDO = [5000, 30000, 120000];

/** Il testo che finisce nell'HTML dell'email: niente tag dai nomi scritti dagli utenti. */
function sicuro(testo) {
    return String(testo ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** L'email con il link per confermare l'indirizzo. */
function emailDiConferma({ nome, link, ore }) {
    const oggetto = 'Conferma la tua email · Palermo 11';
    const testo = [
        `Ciao ${nome},`,
        '',
        'per finire la registrazione al sito del Gruppo Scout Palermo 11 apri questo link:',
        link,
        '',
        `Il link vale ${ore} ore. Se non ti sei registrato tu, ignora questa email: senza conferma l'account non si attiva.`,
        '',
        'Buona strada!',
    ].join('\n');
    const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0F172A">
  <h1 style="margin:0 0 12px;font-size:20px;color:#462678">Conferma la tua email</h1>
  <p style="margin:0 0 12px;line-height:1.6">Ciao ${sicuro(nome)},</p>
  <p style="margin:0 0 20px;line-height:1.6">per finire la registrazione al sito del
    <strong>Gruppo Scout Palermo 11</strong> tocca il pulsante qui sotto.</p>
  <p style="margin:0 0 24px">
    <a href="${sicuro(link)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#7D57C2;color:#fff;text-decoration:none;font-weight:bold">Conferma la mia email</a>
  </p>
  <p style="margin:0 0 8px;font-size:13px;color:#64748B;line-height:1.5">Se il pulsante non funziona, copia questo indirizzo nel browser:<br>
    <span style="word-break:break-all">${sicuro(link)}</span></p>
  <p style="margin:16px 0 0;font-size:13px;color:#64748B;line-height:1.5">Il link vale ${ore} ore. Se non ti sei registrato tu,
    ignora questa email: senza conferma l'account non si attiva.</p>
</div>`;
    return { oggetto, testo, html };
}

/** L'email con il link per scegliere una password nuova. */
function emailRecuperoPassword({ nome, link, minuti }) {
    const oggetto = 'Nuova password · Palermo 11';
    const testo = [
        `Ciao ${nome},`,
        '',
        'qualcuno (speriamo tu) ha chiesto di cambiare la password del sito del Gruppo Scout Palermo 11.',
        'Per sceglierne una nuova apri questo link:',
        link,
        '',
        `Il link vale ${minuti} minuti e si può usare una volta sola. Se non sei stato tu, ignora questa email: la tua password resta quella di prima.`,
    ].join('\n');
    const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0F172A">
  <h1 style="margin:0 0 12px;font-size:20px;color:#462678">Scegli una nuova password</h1>
  <p style="margin:0 0 12px;line-height:1.6">Ciao ${sicuro(nome)},</p>
  <p style="margin:0 0 20px;line-height:1.6">qualcuno (speriamo tu) ha chiesto di cambiare la password del sito del
    <strong>Gruppo Scout Palermo 11</strong>. Per sceglierne una nuova tocca il pulsante qui sotto.</p>
  <p style="margin:0 0 24px">
    <a href="${sicuro(link)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#7D57C2;color:#fff;text-decoration:none;font-weight:bold">Scegli la nuova password</a>
  </p>
  <p style="margin:0 0 8px;font-size:13px;color:#64748B;line-height:1.5">Se il pulsante non funziona, copia questo indirizzo nel browser:<br>
    <span style="word-break:break-all">${sicuro(link)}</span></p>
  <p style="margin:16px 0 0;font-size:13px;color:#64748B;line-height:1.5">Il link vale ${minuti} minuti e si può usare una volta sola.
    Se non sei stato tu, ignora questa email: la tua password resta quella di prima.</p>
</div>`;
    return { oggetto, testo, html };
}

/**
 * L'avviso ai capi di una branca: è arrivata una richiesta di iscrizione. Solo l'avviso:
 * nome e contatti del ragazzo restano nel sito, dove li vede solo chi è entrato.
 */
function emailNuovaRichiesta({ nome, branca, link }) {
    const oggetto = `Nuova richiesta di iscrizione · ${branca}`;
    const testo = [
        `Ciao ${nome},`,
        '',
        `è arrivata una nuova richiesta di iscrizione per il ${branca}.`,
        'La trovi nell\'Area capi del sito:',
        link,
    ].join('\n');
    const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0F172A">
  <h1 style="margin:0 0 12px;font-size:20px;color:#462678">Nuova richiesta di iscrizione</h1>
  <p style="margin:0 0 12px;line-height:1.6">Ciao ${sicuro(nome)},</p>
  <p style="margin:0 0 20px;line-height:1.6">è arrivata una nuova richiesta di iscrizione per il
    <strong>${sicuro(branca)}</strong>. La trovi nell'Area capi del sito.</p>
  <p style="margin:0">
    <a href="${sicuro(link)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#7D57C2;color:#fff;text-decoration:none;font-weight:bold">Apri l'Area capi</a>
  </p>
</div>`;
    return { oggetto, testo, html };
}

/** Il link per confermare la nuova email, mandato alla nuova casella. */
function emailCambioEmail({ nome, link, ore }) {
    const oggetto = 'Conferma la nuova email · Palermo 11';
    const testo = [
        `Ciao ${nome},`,
        '',
        'hai chiesto di usare questo indirizzo per il tuo account del sito del Gruppo Scout Palermo 11.',
        'Per confermarlo apri questo link:',
        link,
        '',
        `Il link vale ${ore} ore. Finché non lo apri resta l'email di prima. Se non sei stato tu, ignora questa email.`,
    ].join('\n');
    const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0F172A">
  <h1 style="margin:0 0 12px;font-size:20px;color:#462678">Conferma la nuova email</h1>
  <p style="margin:0 0 12px;line-height:1.6">Ciao ${sicuro(nome)},</p>
  <p style="margin:0 0 20px;line-height:1.6">hai chiesto di usare questo indirizzo per il tuo account del sito del
    <strong>Gruppo Scout Palermo 11</strong>. Per confermarlo tocca il pulsante qui sotto.</p>
  <p style="margin:0 0 24px">
    <a href="${sicuro(link)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#7D57C2;color:#fff;text-decoration:none;font-weight:bold">Conferma la nuova email</a>
  </p>
  <p style="margin:0 0 8px;font-size:13px;color:#64748B;line-height:1.5">Se il pulsante non funziona, copia questo indirizzo nel browser:<br>
    <span style="word-break:break-all">${sicuro(link)}</span></p>
  <p style="margin:16px 0 0;font-size:13px;color:#64748B;line-height:1.5">Il link vale ${ore} ore. Finché non lo apri resta l'email di prima.
    Se non sei stato tu, ignora questa email.</p>
</div>`;
    return { oggetto, testo, html };
}

/** L'avviso alla casella di prima: l'email dell'account è cambiata. */
function emailEmailCambiata({ nome, nuova }) {
    const oggetto = "L'email del tuo account è cambiata · Palermo 11";
    const testo = [
        `Ciao ${nome},`,
        '',
        `l'email del tuo account del sito del Gruppo Scout Palermo 11 adesso è ${nuova}.`,
        'Se non sei stato tu, avvisa subito i capigruppo.',
    ].join('\n');
    const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0F172A">
  <h1 style="margin:0 0 12px;font-size:20px;color:#462678">L'email del tuo account è cambiata</h1>
  <p style="margin:0 0 12px;line-height:1.6">Ciao ${sicuro(nome)},</p>
  <p style="margin:0 0 12px;line-height:1.6">l'email del tuo account del sito del <strong>Gruppo Scout Palermo 11</strong>
    adesso è <strong>${sicuro(nuova)}</strong>.</p>
  <p style="margin:0;line-height:1.6">Se non sei stato tu, avvisa subito i capigruppo.</p>
</div>`;
    return { oggetto, testo, html };
}

module.exports = {
    postaPronta, controllaPosta, inviaEmail, descriviErrore, ATTESE_SOTTOFONDO, emailDiConferma, emailRecuperoPassword, emailNuovaRichiesta,
    emailCambioEmail, emailEmailCambiata,
};
