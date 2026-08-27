# Program Availability Data Model

Store: `uma-program-availability`

Key: `uma-health:<approved-program-id>`

```json
{
  "campaign": "uma-health",
  "programId": "227756",
  "programName": "Medical Billing and Coding",
  "status": "available",
  "reasonCategory": null,
  "effectiveMonth": null,
  "updatedAt": "2026-08-26T12:00:00.000Z",
  "updatedBy": "initialization"
}
```

Allowed statuses are `available`, `capped`, and `inactive`. Allowed update sources are `initialization`, `leadhoop_response`, `monthly_reset`, and `authorized_admin`.

`reasonCategory` is null for available records, `monthly_offer_cap` or `monthly_campaign_cap` for capped records, and `program_inactive` for inactive records. `effectiveMonth` is `YYYY-MM` only for capped records and is based on `America/New_York`.

Names and IDs must match the validated CSV. Arbitrary keys, campaigns, IDs, and malformed stored records are rejected. Runtime state never modifies the CSV.
