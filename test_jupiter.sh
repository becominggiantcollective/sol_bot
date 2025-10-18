#!/bin/bash

echo "Ì¥ç Testing Jupiter API Connection..."
echo ""

# Test Jupiter Quote API
echo "1Ô∏è‚É£  Testing Jupiter Quote API (v6)"
curl -s -X GET "https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000&slippageBps=50" \
  -H "Accept: application/json" \
  | jq . | head -20

echo ""
echo "2Ô∏è‚É£  Testing Jupiter Price API"
curl -s -X GET "https://price.jup.ag/v4/price?ids=So11111111111111111111111111111111111111112,EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" \
  | jq . | head -20

echo ""
echo "‚úÖ API tests complete"
