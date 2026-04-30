#!/usr/bin/env node
/**
 * Quick token lookup - search for specific tokens
 */

import axios from 'axios';

const GECKO_API = 'https://api.geckoterminal.com/api/v2';
const JUPITER_API = 'https://api.jup.ag/swap/v1';
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;

const searchTerms = ['dickbutt', 'HOUSEMAID', 'official 67', '67'];

console.log('\n🔍 SEARCHING FOR SPECIFIC TOKENS...\n');

async function searchToken(query) {
  try {
    // Search GeckoTerminal
    const response = await axios.get(`${GECKO_API}/search/pools`, {
      params: { query, network: 'solana' },
      timeout: 10000,
    });
    
    const pools = response.data?.data || [];
    return pools.slice(0, 3); // Top 3 results
  } catch (err) {
    return [];
  }
}

async function getTokenInfo(address) {
  try {
    const response = await axios.get(`${GECKO_API}/networks/solana/tokens/${address}`, {
      timeout: 10000,
    });
    return response.data?.data?.attributes || null;
  } catch (err) {
    return null;
  }
}

async function main() {
  for (const term of searchTerms) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Searching: "${term}"`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    const results = await searchToken(term);
    
    if (results.length === 0) {
      console.log('  No results found\n');
      continue;
    }
    
    for (const pool of results) {
      const attrs = pool.attributes || {};
      const rels = pool.relationships || {};
      
      const name = attrs.name || '?';
      const address = rels.base_token?.data?.id?.replace('solana_', '') || '';
      const price = parseFloat(attrs.base_token_price_usd || '0');
      const change24h = parseFloat(attrs.price_change_percentage?.h24 || '0');
      const volume = parseFloat(attrs.volume_usd?.h24 || '0');
      const liquidity = parseFloat(attrs.reserve_in_usd || '0');
      const dex = rels.dex?.data?.id || '?';
      
      console.log(`\n  📌 ${name}`);
      console.log(`     Address:   ${address}`);
      console.log(`     Price:     $${price < 0.0001 ? price.toExponential(4) : price.toFixed(6)}`);
      console.log(`     24h:       ${change24h > 0 ? '+' : ''}${change24h.toFixed(1)}%`);
      console.log(`     Volume:    $${volume.toLocaleString()}`);
      console.log(`     Liquidity: $${liquidity.toLocaleString()}`);
      console.log(`     DEX:       ${dex}`);
    }
    console.log('\n');
    
    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }
}

main().catch(console.error);
