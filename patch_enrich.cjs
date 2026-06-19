const fs = require('fs');
let content = fs.readFileSync('scripts/enrich_deezerid.mjs', 'utf8');
content = content.replace(
  '$or: [{ deezerID: null }, { deezerID: 0 }, { deezerID: { $exists: false } }]',
  '$or: [{ "providers.deezer.trackId": null }, { "providers.deezer.trackId": 0 }, { "providers.deezer.trackId": { $exists: false } }]'
);
content = content.replace('t.deezerID = best.id;', 't.providers = t.providers || {}; t.providers.deezer = t.providers.deezer || {}; t.providers.deezer.trackId = best.id;');
fs.writeFileSync('scripts/enrich_deezerid.mjs', content);
console.log('patched enrich');
