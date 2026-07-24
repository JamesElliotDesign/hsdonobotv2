# CF Tools Priority Queue idempotency update

Hacksaw's MongoDB `pqExpiryAt` / `unlimitedPriorityQueue` values remain the source of truth for whether a player is entitled to Priority Queue. The CF Tools Priority Queue entry is persistent and may already exist when a repeat supporter receives more time.

This update changes only the interpretation of the CF Tools **add** response:

- A normal successful add is recorded as `priorityQueueSyncOutcome: added`.
- An "already exists", "already present", duplicate-entry, or HTTP 409 Conflict response is recorded as `priorityQueueSyncOutcome: already_present` and treated as a successful idempotent result.
- Authentication failures, network failures, missing configuration, unknown-server errors, and other responses remain genuine failures and continue to produce `fulfilment_attention_required`.

The existing MongoDB collections are not migrated or rewritten. A new optional `priorityQueueSyncOutcome` field is added only to newly processed/retried support orders.

## Existing attention-required order

After deploying, retry an order that was flagged only because the player already existed in CF Tools:

```text
/supportretry order:HS-2026-D699E0C8
```

The retry does not add tokens, support total, cards, or another 30 days. It retries only the external actions. If CF Tools returns the already-present response, the order will change to `fulfilled` and the audit timeline will record the idempotent success.
