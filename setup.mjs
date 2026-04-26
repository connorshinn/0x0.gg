#!/usr/bin/env node

// Generates a strong password you can store directly as the PASSWORD secret.
//
// Usage:
//   node setup.mjs
//   node setup.mjs <password>

const crypto = await import('node:crypto');

const password = process.argv[2] || crypto.randomBytes(24).toString('base64url');
const label = process.argv[2] ? 'Password to store:' : 'Generated password:';

console.log('\n──────────────────────────────────────────');
console.log(label);
console.log(password);
console.log('──────────────────────────────────────────');
console.log('Set the Worker secret with:');
console.log('  wrangler secret put PASSWORD');
console.log('──────────────────────────────────────────\n');

console.log('Upload retention is configured in wrangler.toml:');
console.log('  UPLOAD_TTL_HOURS = "168"');
console.log('──────────────────────────────────────────\n');
