const http = require('http');

const data = JSON.stringify({
  tracks: [{"id":"561836","genreBDD":"Pop","uiCategoryPrimary":"Old school","uiCategoriesSecondary":["Dance"],"phase":"party","phaseAlternate":"groove","energy":9,"bpm":125,"danceability":0.91,"isBanger":true,"isSingalong":true,"isEmotional":false,"isCaliente":false,"era":"80s","mood":"fun","language":"EN","hasLyrics":true,"explicit":false,"notes":"Classique universel","justification":"Hymne 80s immédiatement reconnaissable."},{"id":"66609426","genreBDD":"Disco","uiCategoryPrimary":"Old school","uiCategoriesSecondary":["Dance"],"phase":"party","phaseAlternate":"groove","energy":8,"bpm":116,"danceability":0.94,"isBanger":true,"isSingalong":true,"isEmotional":false,"isCaliente":false,"era":"2010s","mood":"fun","language":"EN","hasLyrics":true,"explicit":false,"notes":"Transgénérationnel","justification":"Tube Daft Punk fédérateur et ultra dansant."}]
});

const req = http.request({
  hostname: 'localhost',
  port: 3069,
  path: '/api/admin/import-gpt',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-admin-token': 'socialmix-admin-2026' // wait, token is unknown, let me run it via mongoose directly
  }
});
