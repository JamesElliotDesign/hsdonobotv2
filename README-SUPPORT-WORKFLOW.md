# Hacksaw support workflow update

This update is additive and does not migrate, rename or delete existing MongoDB records.
The existing `Donation` collection remains the live balance and entitlement record.
New records are written to:

- `supportorders` — one purchase record per payment reference.
- `supportevents` — append-only confirmation, fulfilment, claim and receipt events.
- `playerprofiles` — stored Discord name snapshots and aliases for staff lookup.

## Player flow

1. Staff verifies the incoming payment and runs:

   `/donate player:@Player amount:20 reference:PAYMENT_REFERENCE`

2. The bot posts one concise **Confirm your support** message in the ticket.
3. Only the named player can click **Confirm** or **Something is wrong**.
4. Confirming records the current Support Terms version and snapshot, updates the existing
   Donation record, applies tokens/cards/PQ, updates the Discord role and posts a receipt.

The payment reference is method-neutral and can be a PayPal transaction ID, bank reference,
Revolut transfer ID, Ko-fi order ID or crypto transaction hash.

## Finding players and Order IDs

Use one lookup option at a time:

- `/playerinfo player:@Player`
- `/playerinfo name:KnownName`
- `/playerinfo discord_id:701464760578998382`
- `/playerinfo steam_id:76561198147709978`
- `/playerinfo reference:8AB12345CD678901E`

The command shows Discord ID, linked Steam ID, current support account information and recent
Order IDs. A reference lookup also highlights the exact Order ID matched by that reference. It attaches
a text file containing the full order list, reference match and legacy entries.

Reference lookup is exact after trimming, space normalisation and case normalisation. It works even
when the player has left Discord because the reference is stored in `supportorders`. Legacy payments
recorded before the staged workflow do not have searchable references.

Name lookup works for current guild members and names stored by this update or staged support
orders. Legacy records did not contain Discord names, so a player who left before this update
and has no staged order may still require a Discord ID or Steam ID lookup.

## Evidence commands

- `/supportreceipt order:HS-...` produces a staff-only PDF and JSON evidence receipt.
- `/supportretry order:HS-...` retries an interrupted CF Tools or Discord role action.

Receipts include the full payment reference, Discord and Steam IDs, stored Discord names,
terms acceptance, delivery timestamps, token/card credits, PQ records, external sync results
and later account-level token/card claim events.

Set `SUPPORT_RECEIPT_SECRET` to a long stable random secret. Without it, receipts contain a
SHA-256 checksum rather than a keyed HMAC signature.

## Safe deployment

Read `README-DEPLOYMENT.md` before replacing the live bot. It contains detailed Windows,
MongoDB Atlas snapshot, `mongodump`, validation, staging, smoke-test and rollback steps.

## Backups

The weekly backup task reads MongoDB directly. It sends compatible plain JSON backups for
Donation and SteamLink plus compressed snapshots of every database collection and a manifest.

## Compatibility notes

- Amethyst and monthly PQ consistently begin at GBP 20.
- Diamond role defaults to `1359232541965422662` and can be overridden by environment variable.
- Existing Donation and SteamLink documents are not rewritten.
- Existing historical entries remain legacy records and do not gain invented terms acceptance.
- `/removedono` remains a manual total adjustment; it is not an automatic payment-reversal
  workflow and does not reverse consumed tokens or historic PQ usage.
- The source keeps `/donate` as the command name so staff do not need to learn a replacement.

## Local checks

```powershell
npm ci
npm run test:support
Get-ChildItem -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
```
