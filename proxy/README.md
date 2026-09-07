# Activate Scores proxy

Activate Scores only accepts browser requests from its own site. This narrow Cloudflare Worker forwards the three read-only endpoints used by Activate Tracker and allows requests only from `https://djsmartyp.github.io` by default.

Deploy from this directory with Wrangler, then place the resulting Worker URL in `config.js` as `activateScoresApiBase`. No secrets are required.

The proxy accepts only:

- player-location lookups;
- per-location player scores;
- player badge progress.
