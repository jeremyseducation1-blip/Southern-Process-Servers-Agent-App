# Return & Affidavit Log

Drag this whole folder into Netlify (or connect it to a repo) and it deploys as-is —
static site in `public/`, two serverless functions in `netlify/functions/`.

## Before it can send email, set four environment variables in Netlify

Site settings → Environment variables:

- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `GMAIL_SENDER_EMAIL` — the mailbox that will appear as the sender
- `KEVIN_EMAIL` — Kevin Williams's inbox
- `SUPABASE_URL` — your Supabase project URL (see below)
- `SUPABASE_SERVICE_ROLE_KEY` — your Supabase service role key (see below)

**Case storage now runs on Supabase, not Netlify Blobs.** This was switched
because law firms and Kevin now get their own read-only web views into the
data (see "Share Links" below), which needs a real queryable database, not
just a key-value store for one app's own use.

To set up Supabase:
1. Create a free project at supabase.com.
2. In the project, go to the SQL Editor, paste in the contents of
   `supabase-schema.sql` (included in this project folder), and run it. This
   creates the `cases` and `share_links` tables.
3. Go to Project Settings -> API. Copy the "Project URL" -> that's
   `SUPABASE_URL`. Copy the "service_role" secret key (NOT the "anon" key) ->
   that's `SUPABASE_SERVICE_ROLE_KEY`.
4. Add both as Netlify environment variables, same place as everything else,
   then redeploy.

**Important:** the service role key bypasses all database security rules.
Never put it in any front-end code or share it — it only ever belongs in
Netlify's environment variables, where only your serverless functions can
read it.

Both the return document and the affidavit go out to Kevin as PDFs. The return
photo goes through a manual scan-and-crop step in the browser first (drag the
corners onto the document's edges, it straightens/flattens the perspective,
then that gets wrapped into a single-page PDF before sending — Kevin never
gets a raw jpg).

To get the client id/secret/refresh token: create an OAuth client in Google Cloud
Console for the sending Gmail account, grant it the `gmail.send` scope, and run
through the OAuth consent flow once to mint a refresh token. Happy to walk through
that step by step when you're ready — it's a one-time setup.

## Intake

Manual entry only — no photo, no OCR. Type the case number, plaintiff, defendant(s),
and attorney in, hit "Log intake." This just creates the case record for your own
tracking (weekly log, weekly inventory to Kevin); nothing gets emailed at this step.

## Return PDF (no email)

Scan the served/returned paper in Genius Scan, export it as a PDF, and upload it
in the Return section. It attaches to the case (and marks the covered
defendant(s) served) the moment you upload it -- **no email gets sent to Kevin
from this step.** For a multi-defendant case, a checklist appears so you can say
exactly which defendant(s) this specific return covers.

For an alias case with Scott Weiss as attorney, this attached return still gets
bundled in automatically when you send the affidavit -- that's the only place
email fires from for these cases.

## How the triggers work

**Return photo** — independent. Upload a photo on any case, tap "Send return to
Kevin," it goes immediately. Doesn't touch the affidavit logic at all.

**Affidavit** — gated on all three attempts (date + note) being filled in, with no
future dates. Once that's true, the status dropdown unlocks. Picking a status is
the completion event: it stamps your saved signature onto the PDF and sends it to
Kevin. If a return photo has already been uploaded for that case in the same
session, it's bundled into the same email — no separate follow-up.

**Signature** — draw it once on the "Server signature & stamp" card at the bottom.
It's saved to the browser's local storage on that device and reused automatically
on every affidavit from then on. If you switch devices you'll need to sign again
on that device.

## What's still a placeholder

- Attorney defaults to "Scott Weiss" but is a free-text field, so it's ready for
  more attorneys without a code change.
- The PDF layout is a plain reproduction of the fields from your existing
  affidavit template — not a pixel-for-pixel match of the court form. If you want
  it to visually match the exact form (red stamp block styling, notary lines,
  etc.), send that over and I'll adjust the layout in
  `netlify/functions/lib/buildAffidavitPdf.js`.
- Signature storage is per-device local storage, not synced across servers. If
  multiple people serve process, each signs on their own device once.

## Case pipeline (added)

Three trigger points now feed one case record, stored in Netlify Blobs (no setup needed — works automatically once deployed on Netlify):

1. **Intake** — as soon as you receive a warrant/summons, photograph it and log it. This creates the case record (case number, style, attorney, alias flag) and emails Kevin the intake photo. This is what everything else hangs off of.
2. **Return** — unchanged from before: photograph the served/returned paper any time, sends to Kevin immediately. If the case doesn't need affidavit tracking, sending the return also closes the case out.
3. **Affidavit** — unchanged trigger logic (3 attempts + status selection), but now only applies when a case is both marked "alias summons" AND the attorney is Scott Weiss. Completing it closes the case.

**Weekly inventory** — a new scheduled function (`weekly-inventory.js`) runs every Sunday and emails Kevin a numbered list of every case still open (intake logged, not yet closed by a return or affidavit). Each line shows: case style (Plaintiff v. Defendant), case number, and the attorney's last name. For multi-defendant cases, only the defendant(s) still outstanding are listed — served defendants are dropped from the line.

Cron is set to `0 13 * * 0`, targeting 8:00 AM Central (currently correct, since
we're in CDT). **Note:** cron doesn't auto-adjust for the DST switch — when clocks
fall back in early November, change the cron string in `weekly-inventory.js` from
`0 13 * * 0` to `0 14 * * 0` to keep it landing at 8:00 AM CST. Switch it back to
`0 13 * * 0` when clocks spring forward in March.

**Multi-defendant note:** the intake form has an "Additional defendants" field (comma-separated). Marking individual defendants as served isn't wired into the UI yet — right now all listed defendants show as outstanding until the case is closed entirely. Let me know if you want a control to mark just one defendant served while the case stays open.

## Share Links (Kevin / law firm read-only views)

In the app, the "Share Links" section lets you create a view-only link:
- **Scope `ALL`** — sees every case (this is what you'd give Kevin).
- **Scope = an attorney name** (e.g. `Scott Weiss`) — sees only that firm's cases.

Each link is a random token in the URL, like `yoursite.netlify.app/view.html?token=abc123...`.
No login needed — anyone with the link can view (so don't post it anywhere public,
just send it directly to Kevin or the firm). "Show existing links" lists ones
you've already made, with a "Revoke" button that kills a link immediately if it
ever gets shared somewhere it shouldn't.

The view only shows case style, case number, attorney, and status — never
signatures, photos, or your stamp info.

## Returns and affidavits are now attached to the case

When a return or affidavit gets sent, the actual PDF is also saved (in private
Supabase Storage buckets, `returns` and `affidavits` -- created automatically,
nothing to set up) and linked to that case. In Search Cases, any case with a
saved PDF shows a "View return PDF" / "View affidavit PDF" button that opens
it. Any case that's still open with no return on file yet is flagged clearly
("No return on file — still open") so it's obvious at a glance what's
actually outstanding, not just a status word.

## Case numbers can repeat -- important one-time database update

Case numbers are NOT treated as unique. A case with 2 defendants gets logged
as 2 separate intake entries (same case number, different defendant each
time), and the same case number can legitimately resurface later (a
reissue). Every entry -- every "paper" -- has its own internal unique id
built from case number + defendant name; the case number itself is just a
searchable label now, not the database key.

**Before this version will work, run the migration in `supabase-schema.sql`**
(the section near the bottom titled "MIGRATION (run once)") in Supabase's
SQL Editor. It's safe to run even with existing data -- it backfills the new
id for anything already logged, then switches the primary key over. Skipping
this will cause every case-related action to fail.
