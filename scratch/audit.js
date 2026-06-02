const fs = require('fs');

const htmlContent = fs.readFileSync('/home/sai/Desktop/real-estate-web/real-estate-web-main/zorvo_dashboard.html', 'utf-8');

// 1. Extract all IDs
const idRegex = /id=["']([^"']+)["']/g;
const htmlIds = new Set();
let match;
while ((match = idRegex.exec(htmlContent)) !== null) {
  htmlIds.add(match[1]);
}

// 2. Extract all getElementById calls
const getElementRegex = /getElementById\(['"]([^'"]+)['"]\)/g;
const missingIds = new Set();
while ((match = getElementRegex.exec(htmlContent)) !== null) {
  const id = match[1];
  if (!htmlIds.has(id)) {
    missingIds.add(id);
  }
}

// 3. Extract all function calls in inline handlers (onclick, onchange, etc.)
const handlerRegex = /on[a-z]+=["']([^"']+)["']/gi;
const calledFunctions = new Set();
while ((match = handlerRegex.exec(htmlContent)) !== null) {
  const code = match[1];
  // Simple extraction of function names e.g., foo() -> foo
  const funcMatch = code.match(/([a-zA-Z0-9_]+)\s*\(/g);
  if (funcMatch) {
    funcMatch.forEach(f => {
      calledFunctions.add(f.replace('(', '').trim());
    });
  }
}

// 4. Extract all defined functions
const definedRegex = /(?:function\s+([a-zA-Z0-9_]+)\s*\()|(?:(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:function|\([^)]*\)\s*=>))/g;
const definedFunctions = new Set([
  'alert', 'console', 'document', 'window', 'setTimeout', 'setInterval', 
  'clearTimeout', 'clearInterval', 'fetch', 'Math', 'Date', 'JSON', 'localStorage',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Error', 'Promise', 'navigator', 'event', 'console.log'
]);

while ((match = definedRegex.exec(htmlContent)) !== null) {
  const funcName = match[1] || match[2];
  if (funcName) {
    definedFunctions.add(funcName);
  }
}

// 5. Find missing functions
const missingFunctions = new Set();
for (const fn of calledFunctions) {
  if (!definedFunctions.has(fn)) {
    // Check if it's a property on window or document or an object e.g., DB.get
    if (!fn.includes('.') && !['if', 'for', 'while', 'switch', 'catch'].includes(fn)) {
        missingFunctions.add(fn);
    }
  }
}

console.log("=== AUDIT RESULTS ===");
console.log("Missing Element IDs referenced by getElementById:");
console.log(Array.from(missingIds).join(', ') || "None");
console.log("\nPossible Missing Functions called in HTML handlers:");
console.log(Array.from(missingFunctions).join(', ') || "None");
