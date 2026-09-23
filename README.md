# Southern Process Servers Agent App

A private tool for tracking process-serving cases: intake, returns, affidavits,
weekly/monthly reports, and read-only status links for Kevin and law firms.

Static site in `public/`, serverless functions in `netlify/functions/`. Deploy
by dragging this whole folder onto Netlify's Deploys page (or connect it to a
Git repo for automatic deploys).

## Environment variables (Netlify → Site settings → Environment variables)

**Gmail (used only for affidavit emails to Kevin — see "How email works" below):**
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `GMAIL_SENDER_EMAIL` — the mailbox that appears as the sender
- `KEVIN_EMAIL` — Kevin Williams's inbox

To get the client id/secret/refresh token: create an OAuth client in Google Cloud
Console for the sending Gmail account, grant it the `gmail.send` scope, publish
the app (Google Auth Platform → Audience → Publish App) so refresh tokens don't
expire after 7 days, and run through the OAuth consent flow once to mint a
refresh token.

**Supabase (case storage + file storage):**
- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — your Supabase **service_role** key (not anon)

Setup:
1. Create a free project at supabase.com.
2. In the SQL Editor, paste in the full contents of `supabase-schema.sql`
   (included in this folder) and run it. This creates the `cases` and
   `share_links` tables, plus the one-time migration that makes case numbers
   non-unique (see "Case numbers repeat" below).
3. Project Settings → API. Copy the Project URL → `SUPABASE_URL`. Copy the
   **service_role** secret key (never the anon/publishable one) →
   `SUPABASE_SERVICE_ROLE_KEY`.
4. Two private Storage buckets (`returns`, `affidavits`) get created
   automatically by the app the first time they're needed — nothing to set up
   manually for those.

**Important:** the service role key bypasses all database security rules.
Never put it in front-end code — it only belongs in Netlify's environment
variables, read only by the serverless functions.

## How email works

Only **one** action in this app ever sends an email: completing an affidavit
("Send affidavit to Kevin"). Everything else — intake, returns, marking a case
returned manually — is silent, local record-keeping only.

- **Return PDFs** attach directly to the case (storage + status update) with
  no email at all.
- **Exception:** for an alias case where the attorney is Scott Weiss, an
  already-attached return gets automatically bundled into the affidavit email
  when that gets sent — so it still reaches Kevin, just riding along with the
  affidavit instead of firing on its own.

## Intake

Manual entry — case number, document type, plaintiff, defendant(s), attorney,
alias checkbox. Creates the case record everything else hangs off of. Fields
clear automatically after a successful log so the form's ready for the next
paper.

## Case numbers repeat — papers, not cases

Case numbers are **not** unique. A case with 2 defendants gets logged as 2
separate intake entries (same case number, different defendant each time),
and the same case number can legitimately resurface later (a reissued alias
summons for the same defendant, after the earlier paper already closed).
Every entry — every "paper" — has its own internal id (case number +
defendant name), so nothing overwrites anything else.

If you're setting this up fresh, the migration in `supabase-schema.sql`
handles this automatically. If you ever see errors like "column cases.id does
not exist" or "No case found with that id," it means that migration hasn't
fully run — see the MIGRATION section in that file.

## Return (Genius Scan → PDF upload, no email)

Scan the served/returned paper in Genius Scan, export it as a PDF, and upload
it in the Return section (no in-app camera/scanning — Genius Scan already does
that better than a browser can). It attaches to the case the moment you
upload it: storage + status update, no email.

For a multi-defendant case, a checklist shows up so you can say exactly which
defendant(s) this specific return covers — only those get marked served, the
rest stay open. A case only closes once every defendant on it is served.

**Return outcome** — a dropdown next to the upload: *Served*, *Return Not
Found*, or *Return Requested per Plaintiff*. Whatever you pick replaces the
generic "Closed" label everywhere the case's status shows (Search Cases,
Weekly Log, the Kevin/firm share link).

## Affidavit

Gated on all three attempts (date + note) being filled in, with no future
dates. Once that's true, the status dropdown (No response / Evading service /
Vacant home / Bad address) unlocks. Hit "Preview affidavit" to see the actual
PDF before sending — the send button stays locked until a matching preview
exists. Sending is the completion event: it stamps your saved signature onto
the PDF, emails it to Kevin, closes the case, and bundles in an already-
attached return if there is one.

**Signature & stamp** — set up once on the "Server signature & stamp" card
(signature, name, phone, PO box, city/state/zip). Saved to that device's
local storage and reused automatically on every affidavit. Signing again is
only needed if you switch devices.

## Search Cases

Live search across defendant, plaintiff, case number, address, and document
type — matches everything ever logged, open or closed. Each result shows:

- **View return PDF / View affidavit PDF** — when one's on file.
- **No return on file — still open** — a clear red flag when a case is open
  with nothing attached yet.
- **Mark returned (no email)** — for backlog cases handled outside the app
  (e.g. before this version existed); closes the case out without sending
  anything.
- **Edit** — fix a typo'd field after the fact (case number itself isn't
  editable — it's the lookup key; log a fresh entry if it was genuinely
  wrong).
- Multi-defendant cases show a per-defendant breakdown (✓/○ with return
  dates) instead of one case-wide status word.

## Reports (all downloadable PDFs, no email)

- **My Weekly Log** — every case grouped by the week it was *received*
  (intake date). Tap a week to download a PDF listing everything logged that
  week.
- **Monthly Open-Case Report** — grouped by intake month, only cases still
  open. Tap a month to download.
- **Weekly Invoice** — grouped by the week a paper was actually *returned/
  served* (not received), each entry showing its outcome. A case logged
  months ago that gets served this week lands on *this* week's invoice.
- **Inventory (On Demand)** — every case still open, right now, as a
  download — the same list Kevin gets automatically every Sunday (see
  below), just generated on demand instead of waiting.

All of these paginate correctly past 12+ entries (multi-page PDFs), and none
of them send email — they're for your own records or to hand off manually.

## Weekly inventory email (automatic, Sunday 8am)

A scheduled function (`weekly-inventory.js`) emails Kevin every Sunday: a
numbered list of every case still open, case style + case number + attorney's
last name, with outstanding defendant(s) called out for multi-defendant cases
and a note when a return's already gone out but the affidavit's still
pending.

Cron is `0 13 * * 0`, targeting 8:00 AM Central. Cron doesn't auto-adjust for
DST, so this needs a manual flip twice a year: `0 14 * * 0` for 8am CST
(roughly early November–mid March), back to `0 13 * * 0` for 8am CDT
(roughly mid-March–early November).

## Share Links (Kevin / law firm read-only views)

In the app, "Share Links" creates a view-only link:
- **Scope `ALL`** — sees every case (Kevin's link).
- **Scope = an attorney name** (e.g. `Scott Weiss`) — sees only that firm's
  cases.

Each link is a random token in the URL
(`yoursite.netlify.app/view.html?token=...`) — reusable forever, no login,
always shows live current data (not a snapshot). "Show existing links" lists
ones already made, with a "Revoke" button to kill one instantly. The linked
page has its own search box (defendant/plaintiff/attorney/address) and a
date filter.

The view only ever shows case style, case number, attorney, document type,
address, and status — never signatures, photos, or your stamp info.

## What's still a placeholder

- Attorney is a free-text field defaulting to "Scott Weiss" — ready for more
  attorneys without a code change.
- The affidavit PDF layout mirrors your court form's fields but isn't a
  pixel-for-pixel match. Send the exact form if you want it adjusted in
  `netlify/functions/lib/buildAffidavitPdf.js`.
- Signature storage is per-device — each device needs its own one-time setup.

## Attempt photo evidence (yellow door notices)

Each of the 3 attempts on an alias case can optionally have a photo attached
— e.g. the yellow notice left on the door. It saves immediately (storage +
case record) the moment you take the photo, stamped with the server's own
timestamp (not just the phone's clock), so there's independent evidence of
when the attempt actually happened, not just the handwritten date and note.
Written notes stay as the required primary record; photos are backup
evidence layered on top, optional per attempt. Search Cases shows a "View
attempt N photo" button for any case that has one.

## Special notes (intake and return)

Two separate note fields, both persisted on the case record and shown
directly in Search Cases (not buried behind Edit):

- **Case notes** (on the Case section, saved at intake or added later via
  Edit) — for anything a firm or Kevin tells you that isn't written down
  anywhere else. The whole point is not having to ask the same question
  twice because there was nowhere to record the answer the first time.
- **Return notes** (on the Return section, saved when you attach a return)
  — anything specific to that particular return (who it was left with, a
  gate code, whatever's worth remembering about that visit).

Both are searchable in Search Cases along with everything else.

## Billing ($60 flat rate, once per CASE NUMBER, not per defendant)

The Weekly Invoice bills by case number, not by paper. If a case has 2 or 3
defendants and each gets served separately -- even across different weeks --
that's still one $60 charge, pinned to whichever defendant was served
*first*. Every later defendant served on that same case number shows up as
"Already billed for this case," not a second charge.

Layout matches how Kevin wants it: billable cases first (style, case
number, attorney's **last name**, $60 each), a running total, then
everything not billable (Return Not Found, Return Requested per Plaintiff,
or an already-billed additional defendant) listed underneath for the
record, clearly separated from the actual invoice total.

The rate is a single constant (`RATE_PER_CASE` in
`netlify/functions/week-invoice-pdf.js`) if it ever needs to change.
