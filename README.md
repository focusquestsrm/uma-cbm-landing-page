# UMA Back2Learn CBM landing page

Standalone production-safe landing page for the LV / Curious Behaviour Media campaign. This repository is separated from the existing UMA production site and keeps all protected campaign settings in Netlify environment variables.

## Campaign configuration

- Campaign code: `hSCYBuJmFkpd2uz2nijD0A`
- Media type: `noncallcenter`
- Campus: `Online`
- Campus ID: `30776`
- Test mode: enabled in development (`LEAD_TEST_MODE=true`)
- Production submission: disabled until explicit authorization (`LEAD_SUBMISSION_ENABLED=false`)

## Architecture

- `src/` holds the static applicant experience.
- `src/data/uma-kayla-programs.csv` is the maintained program source for this campaign.
- `scripts/build-programs.js` validates the CSV and writes `src/data/uma-kayla-programs.json` for browser and server reads.
- `netlify/functions/submit-lead.mjs` is the protected single lead-submission entry point.
- Netlify Blobs store program availability in a campaign-specific store; it must not read from or write to the production UMA site state.
- `netlify.toml` publishes the static app and function bundle.
- The landing page keeps the same application flow, address assistance, program filtering, consent handling, and LeadHoop gateway pattern used in the approved UMA experience.

## Required configuration

See `.env.example` for the required Netlify values. Real credentials and routing data stay only in Netlify config. This repo does not ship production secrets or domain state.

## Local verification

Run the project checks with `npm.cmd run check` from the repo root. The build validates the implemented program list, runtime config generation, security guardrails, and response contract logic.

## Deployment safeguards

- Do not create or connect a Netlify site.
- Do not run Netlify deployment commands.
- Do not submit live leads.
- Keep `LEAD_TEST_MODE=true` and `LEAD_SUBMISSION_ENABLED=false` unless authorized.
- Do not commit any secret or production-only value.

## Security and compliance

- Browser submission is never allowed directly to LeadHoop.
- All lead handling remains server-side through the Netlify function.
- Marketing attribution values are captured and preserved without exposing PII.
- Google Maps/Places remains optional and manual address entry always works without a configured browser key.

See also the campaign and launch docs in the repo root for environment, testing, and launch status tracking.
