const fs = require('fs');
let server = fs.readFileSync('server.js', 'utf8');

server = server.replace(/deezerID: t\.deezerID \|\| 0,/g, 'deezerID: t.providers?.deezer?.trackId || 0,');
server = server.replace(/deezerID: Number\(id\)/g, '"providers.deezer.trackId": Number(id)');
server = server.replace(/t\.deezerID/g, 't.providers?.deezer?.trackId');

fs.writeFileSync('server.js', server);
console.log('patched server.js deezer id refs');
