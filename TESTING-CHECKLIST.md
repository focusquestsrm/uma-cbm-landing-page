# Testing checklist

## Required automated checks

- All four program IDs and campaign-specific names
- Campus ID 30776
- Campaign code hSCYBuJmFkpd2uz2nijD0A with media type noncallcenter
- Graduation years restricted to 1996-2023
- Campaign-wide state exclusions validated
- Program-specific state restrictions validated
- Education-level mapping and no-high-school flow validated
- Phone, email, ZIP, and name validation validated
- TCPA checkbox required and submission gated
- Jornaya LeadID length and mapping validated
- TrustedForm certificate mapping validated when present
- Test mode always true in development
- Production submission disabled by default
- Meta disabled until Pixel ID is configured
- Meta Lead event not fired in test mode
- fbc, fbp, and fbclid mapping preserved end to end
- Accepted, unmatched, and technical-error paths validated
- Program cap and inactive behavior validated
- Manual address entry still works without Google Places
- No references to the production site remain in the public bundle

## Manual QA

- Confirm the page loads without console errors
- Confirm form steps advance correctly
- Confirm program selection is filtered by state
- Confirm fallback/unmatched message is respectful and not rejection wording
- Confirm submission remains server-side only
- Confirm no live leads are submitted
- Confirm no secrets are in runtime-config.js or source files

## Required commands

- `npm.cmd run check`
- `npm.cmd run build` (if run locally after editing)
