const fs = require('fs');

let js = fs.readFileSync('server.js', 'utf8');

js = js.replace(
  "isCaliente: up.isCaliente || false,",
  "isCaliente: up.isCaliente || false,\n          isHardcore: up.isHardcore || false,"
);

js = js.replace(
  '"isCaliente": <true si chaleur latine/salsa/reggaeton hot, false>,',
  '"isCaliente": <true si chaleur latine/salsa/reggaeton hot, false>,\n  "isHardcore": <true si titre très agressif/extrême/hardcore, false>,'
);

js = js.replace(
  '"isEmotional": false, "isCaliente": false, "era": "2010s",',
  '"isEmotional": false, "isCaliente": false, "isHardcore": false, "era": "2010s",'
);

js = js.replace(
  '"isEmotional": true, "isCaliente": false, "era": "90s",',
  '"isEmotional": true, "isCaliente": false, "isHardcore": false, "era": "90s",'
);

js = js.replace(
  '"isSingalong": true, "isEmotional": false, "isCaliente": false,',
  '"isSingalong": true, "isEmotional": false, "isCaliente": false, "isHardcore": false,'
);

js = js.replace(
  '"isEmotional": false, "isCaliente": false, "era": "80s",',
  '"isEmotional": false, "isCaliente": false, "isHardcore": false, "era": "80s",'
);

// We also need to add it to /api/admin/update-track
js = js.replace(
  'isCaliente: body.isCaliente,',
  'isCaliente: body.isCaliente,\n      isHardcore: body.isHardcore,'
);

// We also need to add it to GET /api/monitor/tracks
js = js.replace(
  'isCaliente: t.isCaliente,',
  'isCaliente: t.isCaliente,\n      isHardcore: t.isHardcore,'
);

fs.writeFileSync('server.js', js);
console.log('patched server.js');
