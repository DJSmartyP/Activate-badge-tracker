# Activate Scores public API proxy

This narrow Cloudflare Worker forwards only the approved read-only `/api/public/activate` endpoints used by Activate Tracker. Browser requests are allowed only from `https://djsmartyp.github.io` by default.

The upstream `x-api-key` is stored as the encrypted Worker secret `ACTIVATE_API_KEY`; it must never be placed in this repository or browser code. The Worker fails closed when the secret or rate-limiter binding is unavailable.

The shared `ACTIVATE_RATE_LIMITER` binding permits 18 requests per 60 seconds. The app discovers a player's venues first, then loads games, scores and room highs for only the venue they explicitly choose.

Deploy from this directory with Wrangler, then place the Worker URL in `config.js` as `activateScoresApiBase`.
