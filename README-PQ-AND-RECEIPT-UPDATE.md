# Priority Queue display and evidence-receipt update

This build includes every feature from the Channel Access Guard release and adds the following changes.

## Support confirmation messages

Priority Queue is now always visible in both the pending player confirmation and the completed support message. One of these outcomes is displayed:

- 30 days of Priority Queue will be added / added
- Priority Queue will be extended / extended to at least 1 year
- Lifetime Priority Queue will be unlocked / unlocked
- Lifetime Priority Queue is already active
- No Priority Queue included for an individual purchase below £20

A player with lifetime Priority Queue is always shown as `already_unlimited`, including purchases below £20. This is a presentation and evidence improvement; it does not add or remove an entitlement.

## Evidence receipts

The JSON receipt remains the complete, signed machine-readable record, including the captured Support Terms HTML and complete audit data.

The PDF is now a concise reviewer-facing summary:

- Currency is rendered as `GBP 20.00`, avoiding unsupported pound-sign glyphs.
- Internal values such as `already_unlimited` are replaced with plain-English descriptions.
- Rank-card class names are translated to their display labels.
- Priority Queue status before and after fulfilment is stated explicitly.
- Audit events are summarized into readable evidence lines rather than raw JSON blocks.
- Section headings and page numbering have been added.

## Deployment

No new environment variables or database migrations are required.

1. Take the usual MongoDB Atlas snapshot.
2. Push this source to the Railway-connected GitHub branch.
3. Confirm the Railway deployment becomes Active.
4. Test a staff-controlled `/donate` confirmation and verify the Priority Queue line.
5. Generate `/supportreceipt` for a test order and inspect both attachments.

Existing SupportOrder, SupportEvent, Donation, SteamLink, Vote, PlayerProfile and ClaimLock data is not rewritten.
