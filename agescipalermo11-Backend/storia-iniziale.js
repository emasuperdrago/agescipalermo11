// Il testo della pagina "La nostra storia" com'era scritto nel sito, prima che i capi
// potessero cambiarlo da lì. Serve solo la prima volta, per riempire le tabelle vuote.

const TAPPE = [
    {
        quando: '11 novembre 1983',
        titolo: 'Nasce il Palermo 11',
        icona: 'bandiera',
        testo: 'Il Gruppo AGESCI Palermo 11 nasce l’11 Novembre dell’anno 1983 dallo sdoppiamento di un altro Gruppo, il Palermo 1.',
    },
    {
        quando: 'Per oltre 15 anni',
        titolo: 'Cuba – Calatafimi',
        icona: 'casa',
        testo: 'Il Gruppo fin dalla nascita ha operato nel Quartiere Cuba – Calatafimi, avendo la sede presso l’istituto dei Padri del Boccone del Povero in Via Quarto dei Mille, per oltre 15 anni.',
    },
    {
        quando: 'Poi',
        titolo: 'Santo Espedito, Quartiere Libertà',
        icona: 'luogo',
        testo: 'In seguito, con il cambio di destinazione, il Gruppo si è trasferito presso la Parrocchia di Santo Espedito, dove ha trovato accoglienza da parte del Parroco, nel Quartiere Libertà.',
        nota: 'Sebbene la lontananza con il vecchio Quartiere fosse molta, in questo trasferimento alcun ragazzo è stato perso, anche se molti venivano dalla parte alta di Corso Calatafimi.',
    },
    {
        quando: 'Adesso',
        titolo: 'Il Palermo 11 oggi',
        icona: 'tempo',
        testo: 'Qui va scritto com’è il gruppo oggi.',
        adesso: true,
    },
];

const PARTI = [
    {
        titolo: 'Chi accogliamo',
        icona: 'persone',
        testo: 'Il Gruppo ha sempre operato accogliendo bambini/e ragazzi/e giovani dai 7 ai 20 anni divisi nelle tre branche: L/C; E/G; R/S.',
        mostra_branche: true,
    },
    {
        titolo: 'I capi',
        icona: 'scuola',
        testo: [
            'Gli Adulti che si occupano dei ragazzi sono Responsabili che hanno o completato l’iter di formazione previsto dall’AGESCI per gli Educatori che operano con i ragazzi (tre corsi), o che lo stanno completando.',
            'Alcuni dei Capi della Comunità Capi fanno parte di Organismi Nazionali e Regionali, e sono Formatori sia Nazionali che Regionali nei Campi di Formazione per Educatori Scout.',
            'La Comunità Capi (così si definisce il gruppo degli educatori) opera nel territorio in cui è inserita, collaborando non solo con la Parrocchia, ma anche con tutti gli organismi sia Educativi come le Scuole o gli Osservatori per la dispersione scolastica, i Provveditorati, e con gli organismi civili quali le Amministrazioni, Comune, Provincia e Circoscrizione.',
        ].join('\n\n'),
    },
    {
        titolo: 'Un gruppo che accoglie',
        icona: 'cuore',
        testo: 'La storia del Gruppo è costellata da collaborazioni con questi Enti per l’inserimento di ragazzi segnalati, ma anche con la Neuropsichiatria Infantile per alcuni ragazzi portatori di Handicap, per la cui accoglienza il Gruppo è sempre stato disponibile.',
        evidenza: 'Attualmente sono presenti in Gruppo tre ragazzi/e con handicap gravi, che partecipano alle attività e crescono con gli altri, anzi con l’aiuto e la collaborazione degli altri.',
    },
    {
        titolo: 'In giro per il mondo',
        icona: 'mondo',
        testo: 'Inoltre il Gruppo ha partecipato ad eventi Nazionali e Internazionali di grande rilievo dalle GMG ai Jamboree, grandi raduni mondiali scout con presenze fino a 25.000 ragazzi/e provenienti da ogni Continente, ai Campi Internazionali sia in Francia che in Inghilterra che in Route particolari in Spagna, a Santiago De Compostela.',
        etichette: ['GMG', 'Jamboree', 'Campi Internazionali in Francia', 'Campi Internazionali in Inghilterra', 'Route a Santiago de Compostela'],
    },
];

module.exports = { TAPPE, PARTI };
