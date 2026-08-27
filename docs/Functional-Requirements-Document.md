# Functional Requirements Document

1. Visitors see only CSV-active programs whose runtime status is `available`, in CSV `display_order`.
2. Missing, capped, or inactive programs cannot be submitted even if a browser request is altered.
3. Accepted LeadHoop responses display the neutral confirmation for three seconds, fire the successful analytics event and one Meta Lead event, then use `ACCEPTED_LEAD_REDIRECT_URL`.
4. Valid business failures first apply any recognized cap/inactive state, do not fire Meta Lead, display the same neutral confirmation, and use `FAILED_LEAD_REDIRECT_URL`.
5. Technical failures do not masquerade as acceptance; they display a retry message and do not redirect or fire conversion tracking.
6. Inactive takes precedence when both inactive and cap reasons exist. Structured codes take precedence over normalized text matching.
7. Capped records from an earlier New York campaign month are restored automatically; inactive records require an authorized manual restoration.
8. Google Places restricts suggestions to U.S. addresses and fills street, city, state, and ZIP. Manual address entry remains complete and usable without Google.
9. The displayed TCPA disclosure is the exact approved text and the Request Info action is the disclosed final submit action.
10. Existing form navigation, design, TrustedForm, Jornaya, routing, and production controls remain intact.
