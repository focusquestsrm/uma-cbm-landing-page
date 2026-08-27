# System Requirements Document

## Runtime

- Existing Netlify site `back2learn-uma` and its site-wide Blobs capability.
- Node.js compatible with `@netlify/blobs` 11.x.
- Production-scoped, encrypted function variables listed in `.env.example`.
- A Google browser key is optional at runtime but required to enable autocomplete. It must be HTTP-referrer restricted to `https://uma.back2learn.com/*` and `https://back2learn-uma.netlify.app/*`, and API-restricted to Maps JavaScript API and Places API.

## Security

- HTTPS and the configured exact origin allowlist are mandatory for lead submission.
- `PROGRAM_AVAILABILITY_ADMIN_SECRET` must be generated randomly, passed only as an `Authorization: Bearer` header, and never placed in a URL, client asset, repository, or report.
- Protected LeadHoop values remain production-scoped and server-only.
- The Blob store must contain only approved program status records, never PII, credentials, compliance tokens, or full vendor responses.

## Availability and recovery

The application fails closed if approved program data, runtime program state, or required submission settings cannot be validated. The scheduled reset is production-only and idempotent. Emergency submission shutdown is performed by setting `LEAD_SUBMISSION_ENABLED=false` and redeploying.
