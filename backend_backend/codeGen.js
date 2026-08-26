// codeGen.js
const crypto = require('crypto');
const { getOrdersByStatus } = require('./store');

// Cryptographically random 4-digit code, "0000"-"9999".
// crypto.randomInt is unbiased (unlike Math.random() % 10000).
function randomFourDigitCode() {
  const n = crypto.randomInt(0, 10000);
  return String(n).padStart(4, '0');
}

// With ~100 boxes live at once out of 10,000 possible codes, collisions
// are rare but not impossible — this guarantees uniqueness among
// currently-active codes (orders that are "ready" and unpicked).
function generateUniqueCode() {
  const activeCodes = new Set(
    getOrdersByStatus('ready').map(o => o.code).filter(Boolean)
  );

  let code;
  do {
    code = randomFourDigitCode();
  } while (activeCodes.has(code));

  return code;
}

module.exports = { generateUniqueCode };
