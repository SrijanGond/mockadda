// Encrypts the pack ZIP so it is safe to keep in a public GitHub repo.
// Usage:  PACK_KEY=<64 hex characters> node tools/encrypt-pack.js  input.zip  api/_pack/pack.enc
// Make a new key with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// Keep the key ONLY in Vercel (PACK_KEY environment variable) and in your own password manager.
const crypto = require('crypto'), fs = require('fs');
const [input, output] = process.argv.slice(2);
const keyHex = process.env.PACK_KEY || '';
if (!/^[a-f0-9]{64}$/i.test(keyHex) || !input || !output) {
  console.error('Usage: PACK_KEY=<64 hex> node encrypt-pack.js input.zip output.enc'); process.exit(1);
}
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
const data = Buffer.concat([cipher.update(fs.readFileSync(input)), cipher.final()]);
fs.writeFileSync(output, Buffer.concat([iv, cipher.getAuthTag(), data]));   // iv(12) | tag(16) | ciphertext
console.log('Encrypted', input, '->', output, '(' + (data.length + 28) + ' bytes)');
