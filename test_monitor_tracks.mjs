import http from 'http';

const req = http.request({
  hostname: 'localhost',
  port: 3069,
  path: '/api/monitor/tracks?filter=needs_review&limit=50',
  method: 'GET',
  headers: {
    'x-admin-token': 'socialmix-admin-2026'
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('STATUS:', res.statusCode);
    if (res.statusCode !== 200) console.log('ERROR:', data);
    else console.log('OK, bytes:', data.length);
  });
});
req.end();
