// Su Vercel il backend non si accende da solo: Vercel chiama questa funzione per ogni richiesta
// a /api/... e /uploads/... (vedi vercel.json), e lei la passa all'app di sempre (server.js).
module.exports = require('../server');
