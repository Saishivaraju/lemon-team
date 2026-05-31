const { normalizeEmail, normalizePhone, normalizeDate, normalizeTime } = require('../services/normalization');

console.log("Email:");
console.log(normalizeEmail("john dot smith at gmail dot com"));
console.log(normalizeEmail("jane underscore doe at yahoo dot com"));

console.log("\nPhone:");
console.log(normalizePhone("nine eight seven six five four three two one zero"));
console.log(normalizePhone("plus one two three four five"));
console.log(normalizePhone("+1 (234) 567-8901"));

console.log("\nDate:");
console.log(normalizeDate("tomorrow"));
console.log(normalizeDate("next friday"));

console.log("\nTime:");
console.log(normalizeTime("2 PM"));
console.log(normalizeTime("noon"));
console.log(normalizeTime("2:30 in the afternoon"));
