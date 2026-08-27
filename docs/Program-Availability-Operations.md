# Program Availability Operations

## Automatic monthly restoration

Netlify invokes `reset-program-availability` daily at 07:15 UTC. The function restores only records with `status=capped` and an `effectiveMonth` earlier than the current `America/New_York` month. It clears the reason/month, sets `updatedBy=monthly_reset`, and leaves inactive programs unchanged. Repeated runs are safe.

## Protected manual status management

Use the existing production function and provide the secret only through the header. Never paste a real secret into a shell history, URL, ticket, or report. These examples deliberately use placeholders:

```text
POST https://back2learn-uma.netlify.app/.netlify/functions/manage-program-availability
Authorization: Bearer <ADMIN_SECRET>
Content-Type: application/json

{"action":"get","campaign":"uma-health","programId":"227756"}
```

To mark or restore a program, use action `set` with `status` equal to `available`, `capped`, or `inactive`. A capped request may specify `reasonCategory` as `monthly_offer_cap` or `monthly_campaign_cap`. Only the four approved IDs are accepted.

```json
{"action":"set","campaign":"uma-health","programId":"227756","status":"available"}
```

Manual restoration is the recovery procedure for inactive programs and for a capped program that must return before the next month.

## Safe audit data

Status-change logs contain only program ID, old status, new status, timestamp, and update source. They must never include vendor reasons, authorization values, leads, or compliance tokens.

## Emergency shutdown and rollback

Set the production-scoped `LEAD_SUBMISSION_ENABLED=false` and trigger a production deploy to stop new LeadHoop transmission. For application rollback, publish the last known-good deploy in Netlify. Do not change DNS, create a replacement site, or rewrite Git history.
