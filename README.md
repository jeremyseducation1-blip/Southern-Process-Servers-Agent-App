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

## Intake and Search Cases -- both live under "Case" now

Manual entry — case number, document type, plaintiff, defendant(s), attorney,
alias checkbox. "Log intake" is just a button at the bottom of the Case
card (not its own section) -- fills in the case record, clears the fields
afterward so it's ready for the next paper. Search Cases is right below
that, in the same card -- one place for entering a case and finding one.

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

## Return (Genius Scan → PDF upload, no email) -- currently hidden

This whole section is hidden right now (Jeremy's using "Mark returned" from
Search Cases instead — simpler, no PDF upload needed). The code and the
Netlify functions behind it are untouched, just not shown — remove the
`hidden` attribute on `#returnCard` in `public/index.html` to bring it back.

Original behavior, if re-enabled:

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
- **Upload return & send to Kevin** — pick the Genius Scan PDF from your
  phone; the app emails it to Kevin FIRST, and only if that send succeeds
  does it save the PDF to the case and mark it returned. If Gmail fails
  (e.g. expired token) you get an on-screen "EMAIL DID NOT SEND" alert and
  nothing is marked. Subject is always `<all defendants, first + last> /
  <attorney last name>`. PDFs over 4 MB are refused (Netlify's request
  limit) -- re-export smaller from Genius Scan. After picking the PDF, one
  form asks for return date, outcome, which defendant(s) it covers, and
  **notes for Kevin** -- the notes go in the email body (under "Notes:") and
  are saved on the case. Notes are REQUIRED for any outcome other than
  "Served" (e.g. Return Not Found), enforced on the screen and server-side.
- **Mark returned (no email)** — for backlog cases handled outside the app
  (e.g. before this version existed); closes the case out without sending
  anything. Tapping it first shows a checkpoint: "Did you already scan the
  return and email it to Kevin?" -- OK continues, Cancel stops with nothing
  marked. A return isn't complete until Kevin has it.
- **Edit** — fix a typo'd field after the fact (case number itself isn't
  editable — it's the lookup key; log a fresh entry if it was genuinely
  wrong).
- Multi-defendant cases show a per-defendant breakdown (✓/○ with return
  dates) instead of one case-wide status word.

## Reports (all downloadable PDFs, no email)

- **My Weekly Log** — every case grouped by the week it was *received*
  (intake date). Tap a week to download a PDF listing everything logged that
  week. (The old Monthly Open-Case Report was removed — redundant next to
  this.)
- **Weekly Invoice** — grouped by the week a paper was actually *returned/
  served* (not received), each entry showing its outcome. A case logged
  months ago that gets served this week lands on *this* week's invoice.
- **Inventory (On Demand)** — every case still open, right now, as a
  download — the same list Kevin gets automatically every Sunday (see
  below), just generated on demand instead of waiting.

All of these paginate correctly past 12+ entries (multi-page PDFs), and none
of them send email — they're for your own records or to hand off manually.

## Weekly invoice + inventory email (automatic, Sunday 8am)

A single scheduled function (`weekly-inventory.js`) emails Kevin every Sunday
at 8am: ONE combined PDF with the invoice for the week that just finished
(page 1) followed by the current open-case inventory (page 2+). This used to
be two separate things (a Friday invoice email and a Sunday inventory email)
-- Kevin asked for it back to one Sunday send with a single attached PDF, so
that's what this does now.

Invoice page: same $60-per-case billing as the on-demand "Weekly Invoice"
button, logged the same way (shows up in Kevin's invoice history on his
share link — the app's own "My Invoices" list was removed as redundant next
to "Weekly Invoice"). Inventory page: numbered list of every case still open, case style
+ case number + attorney's last name, with outstanding defendant(s) called
out for multi-defendant cases and a note when a return's already gone out
but the affidavit's still pending.

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

## Attempts are logged from Search Cases, not a separate section

Every case can have up to 3 attempts logged (date + note, optional photo),
independent of whether it ever needs an affidavit -- a case served on the
first try never gets any attempts logged at all; a case that takes 3 tries
gets all 3 before it's ever an alias/affidavit matter.

Attempts are logged directly from **Search Cases**: find the case, tap
"+ Log attempt N" (auto-numbered based on what's already logged, caps at
3), fill in date + note (required), optionally attach a photo of the
yellow notice, hit Save. Because this is tied directly to the case row
you're already looking at, there's no dropdown or manual case-number entry
to get wrong -- the exact bug that motivated this change (a typed
defendant name not matching the one from intake, causing "log intake
first" errors on a case that was already logged).

Photos are optional, saved immediately with the server's own timestamp
(not the phone's clock) as independent evidence, and have nothing to do
with the affidavit -- they don't gate anything and are never embedded in
the affidavit PDF.

Search Cases shows the full attempt history for every case (date, note,
and photo timestamp if one exists) directly in the result, so you can see
at a glance how many attempts a case took and when.

## Affidavit (reads attempts already logged, doesn't re-collect them)

The "Affidavit" card no longer has its own attempt-entry fields, and the
signature/stamp setup lives inside it too (not a separate section) --
type the case number + defendant into the Case section (same as always),
hit **"Check attempts for this case"** -- it pulls whatever's already been
logged via Search Cases, and if all 3 are valid (date + note, no future
dates), the status dropdown unlocks. From there it's the same as before:
pick a status, sign once (or reuse the saved signature), preview, send.

## Phone numbers (data collection)

Every case has a "Phone numbers" field (Case section, one per line) for any
number tied to that case -- a list an attorney like a medical-collections
firm hands you upfront, or a number that shows up when a defendant calls
back after finding a notice. Shown directly in Search Cases, searchable
like everything else, editable later via Edit if a new number turns up
mid-case.

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

The Weekly Invoice bills by case number, not by paper. **Everything
completed counts as billable** -- Served, Return Not Found, and Return
Requested per Plaintiff are all treated the same for billing (per Kevin:
he pays for completed work, not just successful service). Each billable
line shows the outcome next to it when it isn't a plain "Served," so it's
clear why it's on the invoice.

If a case has 2 or 3 defendants and each gets completed separately -- even
across different weeks, even with different outcomes -- that's still one
$60 charge, pinned to whichever defendant's paper was completed *first*.
Every later defendant on that same case number shows up as "Already
billed for this case," not a second charge -- that's the only thing that's
ever NOT billable now.

Layout: billable cases first (style, case number, attorney's **last
name**, outcome if not Served, $60 each), a running total, then any
already-billed duplicates listed underneath for the record.

The rate is a single constant (`RATE_PER_CASE` in
`netlify/functions/lib/buildWeekInvoicePdf.js`) if it ever needs to change.

## Collapsible sections

Every card's heading is click-to-expand/collapse (generic, not wired per
section — new cards get this automatically). Case and Intake start open
since those are used every time; everything else starts collapsed to cut
down on scrolling past sections that aren't needed right now.

## Kevin/firm share links now show attempt history too

The Share Links view (view.html) now includes each case's attempt history
(date, note, whether a photo exists and when it was taken) alongside the
case-level status. It does not expose the actual photo image or your
signature/stamp info -- just the record that an attempt happened and when.

## Invoices are logged, not just generated

Every invoice -- whether from the on-demand "Weekly Invoice" button or the
automatic Sunday email -- gets logged: the PDF saved to a private
`invoices` Storage bucket, and a row (week, case count, total, when it was
generated) saved to an `invoices` table. Kevin's share link (only the
`ALL`-scope one, not individual firm links -- invoices aren't firm-specific)
lists the full history with a "View PDF" button per week. (The app's own
"My Invoices" list was removed -- redundant next to "Weekly Invoice", which
already opens any week's PDF on demand.)

Regenerating the same week's invoice (e.g. re-running it on demand after
the automatic send already fired) just replaces that week's logged record
-- there's always exactly one invoice per week, not a pile of duplicates.

## Status color-coding (red/green)

Everywhere status shows -- Search Cases, Kevin's/firm share links, and the
Weekly Log PDF -- open cases show **red**, closed
(returned) cases show **green**, regardless of the specific outcome
(Served, Return Not Found, Return Requested per Plaintiff all read as
green once closed). No running tally/count anywhere -- just the color, so
it's a glance, not a count.

## Return + affidavit hand-off (Scott Weiss alias cases)

Marking a case returned in Search Cases does NOT automatically send an
affidavit email -- that would skip your judgment call on which status
applies (No response / Evading / Vacant / Bad address). Instead: if the
case is an alias summons with Scott Weiss as attorney AND all 3 attempts
are already logged, a confirmation prompt appears right after marking it
returned, offering to jump straight to the Affidavit section with that
case's info already filled in and its attempts already checked -- ready to
just pick a status and send. Declining the prompt, or a case that doesn't
meet both conditions, changes nothing; marking returned always completes
silently either way.

## Finding a case for the affidavit, and editing logged attempts

Search Cases now has an **"Affidavit"** button on any alias case -- tap it
and the Case section fields auto-fill, the Affidavit card expands, and
attempts get checked automatically. No more needing to retype a case
number or defendant name to get the status dropdown ready.

Every logged attempt in Search Cases now has an **"Edit"** link next to it
-- opens the same form used to log a new attempt, but pre-filled with the
existing date and note. Saving overwrites that attempt in place (uses the
same attempt number) rather than creating a new one. Leaving the photo
field blank while editing keeps whatever photo (or lack of one) was
already on file -- it only replaces the photo if a new one is picked.

## Weekly Invoice week-list count now matches the actual PDF

The number shown on each week button ("N billable cases") used to just
count raw returned papers, which could disagree with the actual invoice
PDF's total (that one dedupes multiple defendants on the same case
number down to one billable charge). Now both use the identical
dedup-by-case-number logic, so the number on the button always matches
what you'll see when you open that week's PDF. If you complete more
returns after loading the week list, tap "Load weeks" again to refresh
the count -- it's a snapshot from whenever you last loaded it, same as
the PDF itself always reflects live data at the moment you open it.

## Editing a return

Search Cases now has an **"Edit return"** button on any case with a
return already on file. Opens an inline form (date, outcome, notes)
pre-filled with what's currently recorded -- fix a wrong date, change the
outcome, update the notes. This only corrects the return record itself;
it never touches which defendants are marked served or whether the case
is open/closed, since those were already handled correctly when the
return was first marked. Changing the return date can move a case onto a
different week's invoice the next time one's generated, since invoices
are keyed off that date.

## Marking an affidavit as already sent (outside the app)

Search Cases has a **"Affidavit already sent (close case)"** button on any
alias case that's still open with no affidavit recorded yet. For cases
handled outside the app (sent manually, or sent before the PDF generator
was fixed) -- confirms it, closes the case, no PDF generated, no email
sent. Asks for confirmation first since it can't be un-done from the app
itself.

## Weekly Invoice week-list count: corrected again

Reverted the week-button count back to counting every completed return
shown on that week's PDF (billable + "already billed for this case"
duplicates) -- not just the billable subset. The PDF lists everything
that happened that week; the button's count now matches that total, not
just the dollar-relevant subset. Billing itself is unaffected -- the
invoice still only charges once per case number.

## Sending an affidavit with fewer than 3 attempts

Normally all 3 attempts are required before the status dropdown unlocks
(that's what makes an Affidavit of Non-Service valid). There's now an
override checkbox in the Affidavit card -- "I already have enough
information to know service won't happen" -- for cases where Jeremy
learns early (e.g. the address is invalid) and doesn't need to burn 3
separate attempts first. Checking it unlocks the status dropdown with
whatever valid attempts are already logged (at least 1 required, even
with the override) instead of requiring all 3. The affidavit PDF handles
any number of attempts fine -- it only narrates whatever's actually there.

## Bug fix: court type / county blank when jumping to Affidavit from Search Cases

The "Affidavit" quick-jump button (and the mark-returned confirmation
prompt, which uses the same underlying function) was filling in case
number, plaintiff, defendant, address, and attorney, but NOT court type or
county -- leaving "IN THE ___ COURT OF ___ COUNTY, TENNESSEE" blank on the
generated affidavit even though that data was right there on the case
record. Fixed: both now get pulled across correctly.

## Return PDFs on share links

Any case with a stored return PDF shows a **View return PDF** button on the
share-link page (`view.html`). Kevin's `ALL` link can open any case's return;
a firm link can only open returns for its own attorney's cases (checked
server-side in `view-return-pdf.js`, which hands back a short-lived signed
URL). So if an email ever doesn't arrive, "check your link" works.

## Inventory is every open case, grouped by week

The inventory PDF (Sunday email page 2+, and the on-demand button) lists
EVERY case still open, from every week -- not just the current one. Cases
are grouped under "Week of <Monday>" headings by the week they were
received, oldest week first, each heading showing its open count, with a
total ("43 open cases across 5 weeks") at the top. Numbering runs straight
through the whole list.

## Invoice week = the day it was entered, not the typed return date

A return can be backdated (written up Oct 1, entered in the app Oct 7).
Each time a return is marked/sent, the app stamps `completedDate` (today,
Central time). The Weekly Invoice list and PDF bucket by `completedDate`,
falling back to the return date for older records that don't have one. So
a backlogged return lands on the week it was entered, and the return date
shown on the case stays whatever was typed. To pull an already-entered
return onto this week's invoice: Search Cases -> Edit return -> tick "Put
this on this week's invoice" -> Save (return date is left alone). Then
re-tap that week in Weekly Invoice to regenerate the PDF.

## Invoice outcome labels + breakdown

Every case line on the weekly invoice shows its outcome in parentheses --
"(Served)", "(Return Not Found)", "(Return Requested per Plaintiff)". Under
the title is a one-line breakdown of the billed cases, e.g. "7 Served   8
Return Not Found   1 Return Requested per Plaintiff" (outcomes with none
that week are left out), which adds up to the "N cases @ $60" total.

## "I'm here" (GPS-stamped stops) + Route

**📍 I'm here** (Search Cases rows and the Route list): one tap at the door
records the time and the phone's GPS location -- car on or off, no photo
needed. The TIME is stamped on the server (`log-arrival.js`), not the
phone's clock, and every tap is appended to the case's `visits` log (never
edited). The tap also fills the next open attempt slot (1-3) with the
Central date, GPS point and accuracy; the attempt line then shows "GPS-
verified <time> (±N m)" with a map link, and Kevin's share link shows the
GPS-verified time too. The note is left for you to type (offered right
after the tap, or via Edit) because the affidavit prints it word for word.
A second tap within 2 minutes is treated as the same stop. Editing an
attempt later keeps its GPS proof.

Limits: a web page can only read GPS while it's open on screen -- this is a
tap, not background tracking (that would need a real installed app).

**Route** card: "Load open cases", tap "Add to route" in the order you'll
drive (Stop 1, 2, ...), then "Open route in Maps" (Google Maps, starts from
where you are, max 10 stops). Each row also has Navigate (single stop) and
I'm here. `completedDate`/billing is unaffected.

## No default attorney; Scott Weiss asks "alias?"

The attorney field starts blank (and resets blank after each intake). A blank
attorney stays blank everywhere -- intake, the affidavit email, subjects --
instead of being filled in as Scott Weiss. When "Scott Weiss" is typed in
and "alias summons" isn't checked, a pop-up asks whether it's an alias
(OK checks the box; Cancel leaves it as a regular summons). It asks once per
typed value, and again at "Log intake" if the field was never left.

## One button: Log attempt (I'm here) + Remove attempt
- Each open case now has a single **📍 Log attempt N (I'm here)** button. One tap grabs the phone's GPS, the server stamps the time, and attempt N is created with that proof. The note form then opens for that same attempt, so there is never a second, duplicate attempt. The separate "I'm here" button on case rows is gone (the Route card's button does the same single thing).
- If the phone can't give a location, you're asked whether to log the attempt without a GPS stamp.
- Each attempt in the history has a **Remove** link (`remove-attempt` function). The attempt disappears from the case and the affidavit. The underlying GPS visit stays in the append-only `visits` log, flagged `removed`, so tapping again right after an accidental tap works.

## Court dates, expirations, and inventory priority
- New optional fields on every case: **Court date** and **Issued on** (the date printed on the summons/warrant). Both are on the intake form and in Edit. Changing a court date in Edit keeps a trail (`courtDateHistory`: old date, new date, when).
- Expiration = Issued on + 60 days for General Sessions, + 90 days for everything else. If Issued on is blank, the received date is used and the expiration is marked "(est.)".
- Priority (open cases only; rules live in `public/js/priority.js`, with an identical copy at `netlify/functions/lib/priority.js` that the server uses -- keep them the same):
  - PAST DUE: court date or expiration already passed.
  - HIGH: court within 7 days, or expires within 14 days.
  - SOON: court within 14 days, or expires within 30 days.
- The inventory PDF (on-demand and the Sunday email) now opens with a "Needs attention first" block sorted by urgency, and every case lists its court date / expiration.
- Case rows in Search Cases show the court date and expiration with a colored flag.

## Route fixes (Oct 20)
- **Open route in Maps** now uses Google Maps' path-style link (`/maps/dir//A/B/C`, empty first slot = your location). The older `?api=1&waypoints=` form could leave the Maps app on its stop-editing screen ("N stops") without drawing the route.
- New **Navigate to next stop** button: directions to the first stop in your order that has no attempt logged today. Always works, since it's a single destination.
- **Log attempt (I'm here)** on a Route row now opens the same note form as Search Cases (date, required note, optional photo) attached to the attempt it just stamped. Replaces the old pop-up dialogs, which phones can silently suppress. The form code is shared (`buildAttemptForm`).
- Your route order is remembered on the phone, so it survives going out to Maps and coming back.

## Attempt notes are now a pop-up (Oct 20)
Tapping **Log attempt (I'm here)** (Search Cases or Route) stamps the visit and immediately opens a pop-up over the page with the date, a REQUIRED note box (cursor already in it) and an optional photo. Before, the form opened inline underneath the case's button list, which on a phone could be below the visible screen. Cancel keeps the stamped attempt; the note can be added later with Edit.

## Fix: Weekly Log "Invalid Date" (Oct 21)
A case's received date (`intakeDate`) is a full timestamp (e.g. `2026-10-21T15:30:12.345Z`), but the Oct 7 week-grouping fix assumed a plain `YYYY-MM-DD`, so the Weekly Log and the Weekly Log PDF failed with "Invalid Date". `mondayOfWeek` now accepts either form (timestamps are converted to the Central calendar day, so a Sunday-evening case lands in the week it was actually received), and unreadable dates are skipped instead of breaking the whole list. The inventory's week grouping uses the same Central-day rule. Weekly Invoice was not affected (it uses plain dates).

## Schedule (meetings with defendants)

- New **Schedule** card at the top of the app (starts open). Shows overdue meetings (red), Today, Tomorrow, then later dates, each with address, case no., plaintiff/attorney, case notes, tap-to-call phone numbers, and a Navigate button.
- On any open case in Search Cases tap **📅 Schedule meeting** (date, time defaulting to 10:00, optional note). Nothing is re-typed -- it is saved on the case.
- Buttons per meeting: Done, Reschedule, Cancel meeting. Closed cases drop off the schedule. Case rows show a "📅 Meeting:" line.
- Backend: `netlify/functions/appointment.js` (add / update / done / cancel / delete). Times are Central wall-clock.
- **Add to calendar** button on each meeting: `netlify/functions/meeting-ics.js` returns a .ics file (30 min, address, case info, 1-hour alert) that the phone adds to its own calendar.

## Redesign: tabbed app, blue + yellow (Oct 23)

- Bottom tab bar: **Today · Cases · + New · Route · Paperwork**.
- **Today**: counts (open / meetings today / need attention), Next Stop card with a big Log attempt button (uses your saved route order), meetings, needs-attention list.
- **Cases**: compact rows (priority dot, address, attempt bars). Search matches every case; chips: Open / Priority / Meetings / Closed. Tap a row for the **case page**: Log attempt pinned at the top; tabs Info / Attempts / Return / Papers holding every existing button (Edit, Schedule meeting, Remove attempt, photos, Upload return, Mark returned, Edit return, View PDFs, Affidavit, etc.).
- **+ New**: the intake form split into 3 steps.
- **Route**: unchanged features (auto-loads when opened). **Paperwork**: Logs, Weekly Invoice, Inventory, Share Links, Affidavit (tap a row to expand).
- Files: `public/index.html` (restructured), `public/css/app-ui.css` (new, scoped to the app so view.html is unchanged), `public/js/app.js` (new shell section + compact rows). The pre-redesign version is the previous zip (`sps-app-scheduler2.zip`).
- Script/CSS links carry `?v=20261023` so phones fetch the new files.

## Long names in PDFs (Oct 23)

- Weekly Invoice, Inventory and Weekly Log PDFs now wrap long plaintiff/defendant names onto extra lines instead of running into the $ column or off the page. Shared helper: `netlify/functions/lib/pdfText.js`.

## Shared-link page restyled (Oct 24)

- `public/view.html` (what Kevin / firms see from a share link) now uses the same blue + yellow look as the app (loads `css/app-ui.css`). Same data and same token check -- layout only: header with search and date filter, case cards, invoices section (Kevin's ALL link only).

## Photos from the library + intake grouping (Oct 26)

- Attempt form: two buttons, **Take photo** (camera) and **Choose from photos** (phone library). Photos are shrunk to max 1600px JPEG before upload so big library photos fit the server's size limit.
- New case step 1 now holds the case no., plaintiff, attorney, defendant(s), service address, court date and issue date together. Step 2: court details (court type, county, state, document type, alias). Step 3: notes and phone numbers.

## Given to another agent
A case's **Return** tab has a "Given to another agent" button (also an option under *Edit return*). It closes the paper off your inventory, records who has it (optional), emails nothing, and the paper is **never billed or listed** on the weekly invoice (`billingDate()` returns null for it). Multi-defendant cases: pick which defendants moved; the rest stay open.

## Mileage
Route tab: save a **home address**, build the route, and "Open route in Maps" now always ends back home. **Calculate miles** measures home → stops (in order) → home using free OpenStreetMap services (Nominatim geocoding + OSRM road distance) straight from the phone; the number is editable (e.g. to match the odometer) before **Save trip**. Trips and the home address are stored as one private JSON file in a Supabase Storage bucket `mileage` (auto-created, no SQL). Paperwork → Mileage lists trips by year with totals, delete, and a CSV download (`mileage-csv`) for taxes.

## Fill in from scanned papers
New case → **Choose scanned PDFs** reads Genius Scan PDFs of the court's *Return of Service* sheet **on the phone** (OCR via self-hosted tesseract.js + pdf.js in `public/vendor/`; nothing is uploaded to be read, no API key). Each page becomes one case card (docket no., plaintiff, defendant, address, phone, county, court type) to check and save; the docket's grey print gets a second zoomed-in pass if the first misses it. Attorney is suggested from earlier cases with the same plaintiff, else from the file name tag (`Name-Fox.pdf` → Fox). `public/js/rosParser.js` is the text parser.

## Login + AI paper reading (needs Netlify settings)
**Login:** set `APP_PASSWORD` in Netlify (Site configuration → Environment variables). Until it's set the app stays open as before; once set, every function except the share-link pages requires a signed-in device (60 days). Optional `AUTH_SECRET` signs tokens. Changing the password signs everyone out.

**AI reading (any form):** set `ANTHROPIC_API_KEY` (create a dedicated key in the Anthropic console and put a monthly spend limit on it). Optional `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`). New case → *Choose scanned PDFs* sends the page images to `read-paper-start` → background function `read-paper-background` calls Claude (forced tool call → structured fields) → `read-paper-result`. Page images and results are deleted from the private `readings` bucket as soon as the app picks them up (anything left is purged after a day). The AI endpoints refuse to run unless the login is configured. If the key or login isn't set up, or the AI call fails, the app falls back to the free on-phone reader.

## Case notes (Kevin ↔ Jeremy)

Each case has a **Notes** tab: a running, append-only log (who, when, what). Notes can't be edited or deleted, so "it's in the notes" settles it.

- **Kevin** leaves notes from his all-cases share link (`view.html?token=…`) — open a case's "💬 Notes" box, type, **Send note**. Law-firm links never see or add notes.
- **Jeremy** sees new notes on the **Today** tab (a "New notes" card plus a number badge on the tab) and replies from the case's Notes tab. Opening the tab marks them read.
- **Notification:** every note from Kevin is also emailed to `NOTIFY_EMAIL` (optional; defaults to `GMAIL_SENDER_EMAIL`) using the existing Gmail settings, so it arrives as a normal phone notification. Real push notifications would need the app installed to the Home Screen as a web app — a possible later step.
- Functions: `add-note` (Kevin via ALL-scope token, Jeremy via login), `mark-notes-read`; `view-cases` includes notes only for ALL-scope links.
