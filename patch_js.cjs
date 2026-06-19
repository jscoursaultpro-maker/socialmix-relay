const fs = require('fs');

let js = fs.readFileSync('admin/monitor.js', 'utf8');

js = js.replace(
  "makeCb('inp-caliente', 'Caliente (C)', t.isCaliente, gpt.isCaliente, 'isCaliente');",
  "makeCb('inp-caliente', 'Caliente (C)', t.isCaliente, gpt.isCaliente, 'isCaliente');\n  makeCb('inp-hardcore', 'Hardcore (X)', t.isHardcore, gpt.isHardcore, 'isHardcore');"
);

js = js.replace(
  "isCaliente: document.getElementById('inp-caliente').checked,",
  "isCaliente: document.getElementById('inp-caliente').checked,\n    isHardcore: document.getElementById('inp-hardcore').checked,"
);

js = js.replace(
  "const cbC = document.getElementById('inp-caliente');",
  "const cbC = document.getElementById('inp-caliente');\n      const cbX = document.getElementById('inp-hardcore');"
);

js = js.replace(
  "if (cbC) cbC.checked = !cbC.checked;",
  "if (cbC) cbC.checked = !cbC.checked;\n      break;\n    case 'x':\n      if (cbX) cbX.checked = !cbX.checked;"
);

fs.writeFileSync('admin/monitor.js', js);
console.log('patched monitor.js');
