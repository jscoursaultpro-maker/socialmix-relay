const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./editorial_seed.json', 'utf8'));
console.log(typeof data, Array.isArray(data));
if (typeof data === 'object' && !Array.isArray(data)) {
    console.log(Object.keys(data).slice(0, 5));
    const firstKey = Object.keys(data)[0];
    console.log(data[firstKey]);
}
