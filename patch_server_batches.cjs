const fs = require('fs');

let js = fs.readFileSync('server.js', 'utf8');

js = js.replace(
`// GET /api/monitor/tracks — liste paginée avec filtres`,
`// GET /api/monitor/batch-status
app.get('/api/monitor/batch-status', adminAuth, (req, res) => {
  const path = require('path');
  const fs = require('fs');
  const dirIn = path.join(__dirname, 'batches_in');
  const dirOut = path.join(__dirname, 'batches_out');
  const dirDone = path.join(__dirname, 'batches_done');
  const dirRej = path.join(__dirname, 'batches_rejected');
  
  const countIn = fs.existsSync(dirIn) ? fs.readdirSync(dirIn).filter(f => f.endsWith('.json')).length : 0;
  const countOut = fs.existsSync(dirOut) ? fs.readdirSync(dirOut).filter(f => f.endsWith('.json')).length : 0;
  const countDone = fs.existsSync(dirDone) ? fs.readdirSync(dirDone).filter(f => f.endsWith('.json')).length : 0;
  const countRej = fs.existsSync(dirRej) ? fs.readdirSync(dirRej).filter(f => f.endsWith('.json')).length : 0;
  
  res.json({
    in: countIn,
    out: countOut,
    done: countDone,
    rejected: countRej,
    total: 40
  });
});

// GET /api/monitor/tracks — liste paginée avec filtres`
);

fs.writeFileSync('server.js', js);
console.log('patched server batches');
