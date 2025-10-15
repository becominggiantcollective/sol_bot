const dotenv = require('dotenv');
dotenv.config();

console.log('=== ENVIRONMENT DEBUG ===');
console.log('WALLET_PRIVATE_KEY exists:', !!process.env.WALLET_PRIVATE_KEY);
console.log('WALLET_PRIVATE_KEY length:', process.env.WALLET_PRIVATE_KEY?.length);
console.log('WALLET_PRIVATE_KEY first 50 chars:', process.env.WALLET_PRIVATE_KEY?.substring(0, 50));
console.log('WALLET_PUBLIC_KEY:', process.env.WALLET_PUBLIC_KEY);

console.log('\n=== CONFIG TEST ===');
const { config } = require('./dist/config');
console.log('Config wallet privateKey exists:', !!config.wallet.privateKey);
console.log('Config wallet privateKey length:', config.wallet.privateKey?.length);
console.log('Config wallet privateKey first 50 chars:', config.wallet.privateKey?.substring(0, 50));

try {
    const parsed = JSON.parse(config.wallet.privateKey);
    console.log('Parsed private key is array:', Array.isArray(parsed));
    console.log('Parsed private key length:', parsed.length);
} catch (e) {
    console.log('Error parsing private key:', e.message);
}