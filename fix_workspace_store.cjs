const fs = require('fs');
let p = 'src/stores/workspace.store.ts';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(/workspaceHandleStorage/g, 'workspaceHandle');

fs.writeFileSync(p, c);
console.log('Fixed workspace.store.ts');
