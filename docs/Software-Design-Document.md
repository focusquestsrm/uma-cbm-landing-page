# Software Design Document

## Purpose

The UMA landing page is a static Netlify site with server-side Netlify Functions. The maintained program catalog remains `src/data/uma-kayla-programs.csv`; runtime availability is stored separately in a site-wide Netlify Blobs store named `uma-program-availability`.

The public function entry points use Netlify's current Request/Response runtime so the platform supplies the Blob execution context required for strongly consistent site-store access. The tested business logic remains in non-routable shared handlers.

## Components

- `get-program-availability` reads each approved campaign/program record with strong consistency, initializes missing records as available, and returns only visitor-safe fields.
- `submit-lead` validates the origin, form fields, exact approved program ID, and current Blob status before sending the existing protected LeadHoop request. It normalizes the vendor result and returns only an outcome and configured redirect.
- `manage-program-availability` accepts authenticated header-based status reads and writes. It has no visitor UI and rejects unapproved campaigns and IDs.
- `reset-program-availability` runs daily at 07:15 UTC. It calculates the current month in `America/New_York` and restores only older capped records.
- `program-availability.js` hydrates program cards and form options from the same-site availability function. A storage/configuration failure leaves selection disabled and displays a controlled message.
- `google-places.js` adds U.S.-only address autocomplete when a build-time browser key is configured. Manual entry remains available on every failure path.
- `meta-pixel.js` loads Pixel `3178962768924361`, sends one PageView, and exposes a one-shot Lead event called only after a normalized accepted response.

## Trust boundaries

The browser never receives LeadHoop authorization, campaign routing, Blob administration credentials, or raw vendor responses. Blob keys are derived only from campaign `uma-health` and an ID validated against the generated program catalog. The store contains no prospective-student data.

All program-status reads that control display or submission use strong consistency. Updates are idempotent: repeating the same status, reason, and month does not rewrite or corrupt the record.

## Failure behavior

Missing configuration, Blob read/write errors, malformed vendor responses, timeouts, and connectivity errors fail closed and remain retryable. Business rejections use the separately configured failed redirect; only `status: success` uses the accepted path and fires conversion tracking.
