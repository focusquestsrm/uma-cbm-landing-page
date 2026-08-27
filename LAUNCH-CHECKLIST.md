# Launch checklist

## Before launch

- Confirm the final public URL from Jordan is documented.
- Configure Jordan’s Meta Pixel ID in Netlify environment variables.
- Configure the approved Google Maps/Places browser key in Netlify environment variables.
- Confirm Netlify allowed origins list includes the final host.
- Confirm the final domain and subdomain are approved.
- Confirm there is written authorization to enable production submissions.
- Confirm a test lead was actually received and reviewed.

## Runtime configuration to set in Netlify

- LEADHOOP_AUTHORIZATION
- LEADHOOP_ENDPOINT
- LEADHOOP_CAMPAIGN_CODE
- LEADHOOP_CAMPUS_ID
- LEADHOOP_FIXED_FIELDS
- ACCEPTED_LEAD_REDIRECT_URL
- FAILED_LEAD_REDIRECT_URL
- PROGRAM_AVAILABILITY_ADMIN_SECRET
- GOOGLE_MAPS_BROWSER_KEY
- META_PIXEL_ID
- LEAD_SIGNUP_URL
- LEAD_SUBMISSION_ENABLED
- LEAD_TEST_MODE
- LEADHOOP_CAMPAIGN_ENABLED
- ALLOWED_ORIGINS

## Launch gate

- Do not enable production submission without written direction.
- Keep test mode active until explicit authorization is received.
- Do not create a Netlify site or site configuration outside the approved setup.
- Keep the repo isolated and do not connect it to any existing production site.
