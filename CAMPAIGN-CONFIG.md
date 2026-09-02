# Campaign configuration

## Core campaign data

- Publisher: LV – Curious Behaviour Media
- Internal publisher/contact: Jordan B. McKoy
- LeadHoop campaign ID: 12196
- Offer: B2L – Ultimate Medical Academy (297)
- LeadHoop campaign code: hSCYBuJmFkpd2uz2nijD0A
- Media type: noncallcenter
- Campus: Online
- Campus ID: 30776
- Geographic scope: United States only
- Schedule: 24 hours a day, 7 days a week
- Test mode: true
- Production submission: disabled

## Required LeadHoop submit fields

- campaign_code
- lead[firstname]
- lead[lastname]
- lead[phone1]
- lead[email]
- lead_address[address]
- lead_address[city]
- lead_address[state]
- lead_address[zip]
- lead_education[education_level_id]
- lead_education[program_id]
- lead_education[campus_id]
- lead_education[grad_year]
- lead_background[internet_pc]
- lead_consent[tcpa_consent]
- lead[service_leadid]
- lead[test]
- lead[media_type]

## Program configuration

1. 227753 — A.A.S. – Health and Human Services
   - Long title: Associate of Applied Science (A.A.S.) in Health and Human Services
   - Campus: Online
   - Degree: Associate’s

2. 227754 — A.A.S. – Healthcare Management
   - Long title: Associate of Applied Science (A.A.S.) in Healthcare Management
   - Campus: Online
   - Degree: Associate’s

3. 227755 — A.A.S. – Medical Administrative Assistant
   - Long title: Associate of Applied Science (A.A.S.) in Medical Administrative Assistant
   - Campus: Online
   - Degree: Associate’s

4. 227756 — A.A.S. – Medical Billing and Coding
   - Long title: Associate of Applied Science (A.A.S.) in Medical Billing and Coding
   - Campus: Online
   - Degree: Associate’s

## State restrictions

Campaign-wide exclusions:
- AA
- AE
- AP
- PR
- VI
- AS
- GU
- MP
- CO

Program-specific exclusions:
- Program 227753: CT, MA, NY, ND, RI
- Programs 227754, 227755, 227756: AS, CT, MA, NY, ND, PR, RI

## Education levels

LeadHoop values:
- 2330 — No High School Diploma — rejected/ineligible
- 2331 — GED — accepted
- 2332 — High School Diploma — accepted
- 2333 — Some College — accepted
- 2334 — Associate’s degree or higher — accepted

## Graduation years

- Accepted range: 1996-2023
- Validation in browser and server: required
- No future years allowed
- No value outside 1996-2023 may be posted

## TCPA disclosure

"By clicking the Request Info button below, I am providing my eSIGN signature and express written consent for Ultimate Medical Academy (UMA), Back2Learn, and parties calling on its behalf, to call or text me at the number provided above for purposes relating to educational opportunities with UMA, including through the use of automatic telephone dialing technology and pre-recorded messages. I am authorized to consent to receive these communications at the phone number provided. I understand that I am consenting to receive calls and text messages regardless of whether the number provided is on any do not call list, either now or in the future. I acknowledge that my consent is not required to enroll, and I may revoke my consent at any time. I acknowledge that all calls may be recorded."

- Checkbox ID: leadid_tcpa_disclosure
- Submitted value: Y only when checked
- Must be displayed before form submission

## Meta and compliance requirements

- Do not initialize a placeholder Meta Pixel.
- Do not fire a Lead event during test mode.
- Fire only after an accepted production LeadHoop response.
- Preserve subid2, subid3, and subid4 mapped from _fbc, _fbp, and fbclid.
- Keep Google Maps browser key runtime-controlled from Netlify configuration only.

## Outcome paths

- Accepted -> /thank-you
- Unmatched/rejection -> /next-steps
- Technical problem -> stay on the form with retry messaging
