const fs = require('fs');
const lines = fs.readFileSync('api/index.js', 'utf8').split('\n');

let balance = 0;
let inReport = false;
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("else if (type === 'end-of-call-report') {")) {
        inReport = true;
        balance = 1;
        console.log(`Started at line ${i+1}`);
        continue;
    }
    if (!inReport) continue;
    
    balance += (line.match(/\{/g) || []).length;
    balance -= (line.match(/\}/g) || []).length;
    
    if (balance === 0) {
        console.log(`Block ended at line ${i+1}: ${line.trim()}`);
        break;
    }
}
