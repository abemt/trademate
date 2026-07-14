# TradeMate

Your AI trading buddy, mentor and journal for XAUUSD price action.
Full product plan: [../PLAN.md](../PLAN.md).

## Local development

```bash
npm install
npm run db:migrate:local   # creates + seeds the local D1 database
npm run dev                # http://localhost:5173  (dev passcode: trademate-dev)
```

## First deploy (one-time, all free)

1. Create a free Cloudflare account, then `npx wrangler login`.
2. `npx wrangler d1 create trademate-db` → paste the printed `database_id` into `wrangler.jsonc`.
3. `npm run db:migrate:remote`
4. Set production secrets (pick a strong passcode; JWT secret = any long random string):
   ```bash
   npx wrangler secret put PASSCODE
   npx wrangler secret put JWT_SECRET
   ```
5. `npm run deploy`
6. Custom domain: Cloudflare dashboard → add your domain as a site (free plan) →
   at your registrar replace the nameservers with the two Cloudflare gives you → update
   the `routes` pattern in `wrangler.jsonc` to your hostname and deploy again.

Screenshots are stored as D1 blobs — no R2 bucket (and no billing profile) required.

## API keys needed in later phases (all free tiers, no card)

| Key | Where | Used for |
|---|---|---|
| `GEMINI_API_KEY` | aistudio.google.com | Setup analysis (vision), chat, briefings |
| `GROQ_API_KEY` | console.groq.com | Fallback LLM |
| `TWELVEDATA_API_KEY` | twelvedata.com | XAUUSD / DXY candles |

Add each with `npx wrangler secret put <NAME>` (and to `.dev.vars` for local dev).
