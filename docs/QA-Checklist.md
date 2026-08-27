# QA Checklist

## Automated contracts

- Validate all four CSV programs, exact IDs, order, active filtering, duplicates, blank names, and malformed fields.
- Mock accepted, general failure, offer cap, campaign cap, inactive, combined reasons, duplicates, unknown IDs, missing reasons, malformed responses, timeout, Blob read/write failures, and current status enforcement.
- Confirm strong-consistency reads, capped restoration, inactive non-restoration, authorization failure, cross-campaign rejection, and manual restoration.
- Confirm one Meta PageView, accepted-only one-shot Meta Lead, unique event-ID forwarding, U.S. Places parsing, manual fallback, exact TCPA text, TrustedForm, and Jornaya source presence.
- Scan built/public files and reachable Git history for protected values before push.

## Production-safe verification

- Do not submit the form or call the production submission function.
- Confirm both production addresses use HTTPS and serve the same deployed commit.
- Confirm the public availability function returns four ordered programs on initialization and never calls Fallon storage.
- Confirm the protected management endpoint rejects a request without authorization.
- Confirm PageView, compliance scripts, responsive layout, address manual fallback, and limited existing form navigation at 390, 768, 1366, and 1440 pixels.
- Confirm no console errors, unexpected failed requests, horizontal overflow, broken imagery, protected values, PII, or LeadHoop requests.
- Google Places production verification remains blocked until an approved restricted browser key is supplied and deployed.
