# Hacksaw Donator Bot — safe deployment guide

This guide is written for a live bot using a production MongoDB Atlas database.
The update is additive: it does not delete, rename, or rewrite existing collections.
It adds `supportorders`, `supportevents`, and `playerprofiles` as new collections.
The existing `donations` and `steamlinks` collections remain authoritative.

## 1. Prepare a rollback folder

Do not overwrite the currently running folder first.

1. Stop making manual support adjustments for the few minutes used to deploy.
2. In File Explorer, copy the complete current bot folder to a dated backup, for example:

   `D:\Backups\hsdonobot-before-playerinfo-2026-07-24`

3. Confirm that the copied folder contains your current source and package files.
4. Copy the current `.env` separately. Do not upload or commit `.env` to GitHub.
5. If the source is in Git, create a rollback branch before copying the update:

   ```powershell
   git status
   git switch -c backup-before-playerinfo
   git push -u origin backup-before-playerinfo
   git switch main
   ```

If the working tree is not clean, commit or copy the changes before proceeding.

## 2. Take a MongoDB Atlas backup

### Option A — Atlas on-demand snapshot

Use this when the cluster has Atlas Cloud Backup enabled.

1. Sign in to MongoDB Atlas.
2. Select the organization and project containing the live Hacksaw database.
3. Open **Database** / **Clusters**.
4. Locate the production cluster used by `MONGODB_URI`.
5. Open the cluster actions menu and choose **Take Snapshot Now**.
6. Use a description such as:

   `Before Hacksaw playerinfo and support lookup deployment 2026-07-24`

7. Choose a retention period long enough to complete deployment and monitoring; seven days or more is sensible.
8. Start the snapshot.
9. Open the cluster backup/snapshots page and wait until the snapshot status is complete. Do not rely only on seeing it queued.
10. Save a screenshot or note of the snapshot time and identifier.

### Option B — `mongodump` for a Free cluster or when snapshots are unavailable

Atlas Free clusters do not provide Atlas backup snapshots. Use MongoDB Database Tools.

1. Install MongoDB Database Tools on the Windows machine used for deployment.
2. Open a new PowerShell terminal and check:

   ```powershell
   mongodump --version
   ```

3. Create a private backup directory:

   ```powershell
   New-Item -ItemType Directory -Force D:\Backups\HacksawMongo | Out-Null
   ```

4. Copy the exact production `MONGODB_URI` from the bot's `.env` into a temporary PowerShell environment variable. Keep the single quotes:

   ```powershell
   $env:HACKSAW_MONGODB_URI = 'mongodb+srv://USERNAME:PASSWORD@CLUSTER/...'
   ```

5. For the cleanest manual dump, stop the bot briefly so no support writes or claims occur while the dump runs.
6. Create a compressed archive:

   ```powershell
   $stamp = Get-Date -Format 'yyyy-MM-dd-HHmmss'
   $backup = "D:\Backups\HacksawMongo\hacksaw-$stamp.archive.gz"
   mongodump --uri="$env:HACKSAW_MONGODB_URI" --archive="$backup" --gzip
   ```

7. Confirm that the command ends without an error and the file is not empty:

   ```powershell
   Get-Item $backup | Format-List FullName,Length,LastWriteTime
   ```

8. Copy the archive to a second secure location that is not inside the bot project folder.
9. Clear the temporary PowerShell variable when finished:

   ```powershell
   Remove-Item Env:HACKSAW_MONGODB_URI
   ```

Do not post the connection string or backup archive in Discord or commit either to Git.

## 3. Prepare the updated source

1. Extract the supplied ZIP into a new folder, for example:

   `D:\Code\hsdonobot-playerinfo-update`

2. Do not copy the new files directly over the running folder until you have inspected them.
3. Copy only your existing `.env` into the new folder.
4. Do not replace the new `package.json`, `package-lock.json`, `commands`, `models`, `services`, or `tasks` directories with old copies.
5. Open the new folder in VS Code:

   ```powershell
   cd D:\Code\hsdonobot-playerinfo-update
   code .
   ```

## 4. Review environment variables

Open `.env.example` beside your private `.env`. Preserve every existing value and add or confirm:

```env
SUPPORT_TERMS_URL=https://hacksawdayz.vercel.app/support-terms.html
SUPPORT_TERMS_VERSION=2026-07-24
CLAIM_CHANNEL_URL=https://discord.com/channels/1217816664268083220/1442660928171806853
SUPPORT_ORDER_EXPIRY_HOURS=72
SUPPORT_RECEIPT_SECRET=YOUR_STABLE_RANDOM_SECRET
SUPPORT_ROLE_DIAMOND_ID=1359232541965422662
```

Generate a receipt secret once if you do not already have one:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copy the output into `SUPPORT_RECEIPT_SECRET` and keep it stable. Do not regenerate it at every deployment. Changing it does not damage MongoDB, but future receipt signatures would no longer use the same key.

Check these points carefully:

- `MONGODB_URI` is the live database URI you intended to use.
- `BOT_TOKEN` is the existing live bot token.
- `SUPPORT_TERMS_VERSION` exactly matches the version shown on the live terms page.
- `SUPPORT_ROLE_DIAMOND_ID` is `1359232541965422662` unless the role changes.
- `.env` is listed in `.gitignore`.

## 5. Install dependencies and run offline checks

From the new project folder:

```powershell
npm ci
npm run test:support
```

Then syntax-check every JavaScript file:

```powershell
Get-ChildItem -Recurse -Filter *.js | ForEach-Object {
    node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $($_.FullName)" }
}
```

Do not deploy if any command returns an error.

## 6. Recommended staging test

The safest full test uses:

- a separate Discord test bot,
- a private test Discord server, and
- a cloned/staging MongoDB database.

Never run two copies of the same Discord bot token at once.

On staging, verify:

1. `/playerinfo player:@TestUser`
2. `/playerinfo name:<test username>`
3. `/playerinfo discord_id:<test ID>`
4. `/playerinfo steam_id:<test SteamID64>`
5. `/donate player:@TestUser amount:20 reference:TEST-UNIQUE-REFERENCE`
6. The pending message shows the expected tokens, PQ and Rank ID Card result.
7. Only the named player can press **Confirm**.
8. Confirmation updates totals once and creates an Order ID.
9. `/playerinfo` lists that Order ID.
10. `/playerinfo reference:TEST-UNIQUE-REFERENCE` resolves the same player and highlights the matching Order ID.
11. `/supportreceipt order:<Order ID>` produces PDF and JSON attachments.
12. Restart the bot and confirm `/playerinfo name:` and `/playerinfo reference:` still work.

## 7. Low-risk production smoke test

If a full staging environment is not available:

1. Stop the old bot process.
2. Start the updated bot from the new folder.
3. Watch the console for:

   - `Connected to MongoDB`
   - bot login success
   - command registration success
   - no schema or duplicate-index errors

4. In a staff-only Discord channel, run `/playerinfo` on a known current player.
5. Confirm it returns their Discord ID, Steam ID and existing account data.
6. Search that same current player by `name` to create/update their stored name profile.
7. To test pending-order creation without changing balances, create a pending order using a clearly unique test reference and then have the named test account click **Something is wrong**. This creates/cancels the staged record but does not add tokens, PQ, rank cards or support total.
8. Do not click **Confirm** against production unless the amount and reference represent a real verified payment.

## 8. Switch the live bot

How you restart depends on hosting.

### Local Windows process

Stop the old terminal with `Ctrl+C`, then from the new folder:

```powershell
npm start
```

### PM2

From the deployed folder:

```powershell
pm2 restart donatorbot --update-env
pm2 logs donatorbot
```

Use the actual PM2 process name if it differs.

### Hosted dashboard

Upload/push the updated source, preserve the existing environment variables, add the new values, and trigger one deployment. Ensure the old instance stops before the new instance logs in.

## 9. Verify MongoDB after startup

In Atlas Data Explorer, confirm that:

- existing `donations` documents remain present,
- existing `steamlinks` documents remain present,
- no totals or token fields were reset,
- `playerprofiles` appears after a player is looked up, linked, or used in `/donate`,
- `supportorders` appears after a staged order is created,
- `supportevents` contains append-only events after staged activity.

The update does not require a migration command.

## 10. Finding Order IDs

Order IDs are shown in:

- the staff reply immediately after `/donate`,
- the player's pending confirmation message,
- the completed confirmation receipt, and
- `/playerinfo`.

Examples:

```text
/playerinfo player:@Player
/playerinfo name:matess912
/playerinfo discord_id:701464760578998382
/playerinfo steam_id:76561198147709978
/playerinfo reference:8AB12345CD678901E
```

Then generate evidence with:

```text
/supportreceipt order:HS-2026-XXXXXXXX
```

Reference lookup uses the exact payment reference recorded by the staged `/donate` workflow. It ignores letter case and repeated spaces, but it is not a partial search. Legacy support entries created before the staged workflow have no stored payment reference.

Name lookup works for current guild members and names stored by this update or a staged support order. The old database did not store Discord usernames, so a legacy player who left before this update and has no staged order may require lookup by Discord ID or Steam ID.

## 11. Monitor after deployment

For the first 24–48 hours, check:

- bot console errors,
- MongoDB connection errors,
- duplicate payment-reference errors,
- Discord role update failures,
- CF Tools PQ sync failures,
- weekly backup delivery,
- `/playerinfo` results for current and departed test accounts.

Do not delete the pre-deployment source copy or database backup until the bot has run normally through several real support purchases and at least one backup cycle.

## 12. Code rollback

Because the database changes are additive, a code rollback is straightforward:

1. Stop the updated bot.
2. Start the dated pre-update source folder with the original `.env`.
3. Leave `supportorders`, `supportevents`, and `playerprofiles` in MongoDB. The old bot will ignore them.
4. Do not delete those collections; they contain evidence and may be useful later.

Only restore the MongoDB snapshot if actual data was corrupted. Prefer restoring to a separate test cluster/database first and comparing records before replacing production data.
