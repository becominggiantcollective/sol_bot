# Secret Rotation Checklist

Use after any exposure. Replace all real values in `.env` and restart services.

1) Wallet
- Generate a new Solana keypair (`solana-keygen new`) and fund (devnet/mainnet as needed).
- Update `WALLET_PRIVATE_KEY`/`WALLET_PUBLIC_KEY` (and any secondary wallet keys) in your secret manager, not in git.
- Revoke or abandon the old wallet; move remaining funds.

2) RPC / Infra keys
- Rotate Helius, Alchemy, QuickNode, and any other RPC API keys; update URLs in `.env`.
- Remove unused endpoints to reduce surface area.

3) Application tokens
- Rotate Telegram bot token and chat ID (if tied to a specific bot token).
- Rotate Jupiter API key, Mergify API key, Codecov token, Blockdaemon key, Yellowstone token, HF API key.

4) Storage & distribution
- Keep `.env` out of git (already in `.gitignore`). Store secrets in a vault/secret manager. Use per-env files or injected env vars.
- Avoid printing env vars in logs; scrub any logs that may contain secrets.

5) Cleanup traces
- Delete or invalidate old tokens in their provider consoles.
- Check shell history and temp files for accidental leaks; remove if present.

6) Validation
- With new secrets loaded, run a safe smoke test: `USE_DEVNET=true`, `DRY_RUN=true`, then `node devnet-test.mjs`.
- Start sentiment service (if used) and confirm HF key works: `uvicorn ml.sentiment_service.app:app --reload` and curl `/health`.

7) Ongoing hygiene
- Use unique keys per environment; least privilege where possible.
- Schedule periodic key rotations and access reviews.
