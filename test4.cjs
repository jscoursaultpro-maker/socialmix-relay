const http = require('http');

const req = http.request({
  hostname: 'localhost',
  port: 3069,
  path: '/api/admin/generate-prompt?count=50',
  method: 'GET',
  headers: { 'x-admin-token': 'host_jeanse_2026' } // Wait, this doesn't work.
});
