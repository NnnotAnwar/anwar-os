# Shiftella — case study draft

A ready-to-paste draft for **/app/projects → New project**. Nothing here is in
the database yet: copy each field into the editor, fill the `[[TODO: …]]`
placeholders with real facts (no invented numbers), upload the screenshots and
publish. Steps are at the end.

Screenshots in this folder (public pages only, nothing filled in, taken
2026-11-24 from https://shiftella.app):

| File | What it shows |
|---|---|
| `shiftella-login-dark.png` | Sign-in, desktop, dark theme, CS/EN switch |
| `shiftella-signup.png` | "Create your organization" (owner sign-up) |
| `shiftella-login-phone.png` | Sign-in on a phone (390 px) |

Screenshots from inside the app (schedule, availability, the phone app) would
make the gallery much stronger. Take them from a demo organization with made-up
people, never a real customer's data.

---

## Fields

| Field | Value |
|---|---|
| **Title** | Shiftella |
| **Address** | `shiftella` (→ /projects/shiftella) |
| **Summary** | Shift scheduling for small teams: owners build the rota, staff see their shifts and swap them from the phone. Web and mobile from one React codebase. |
| **Status** | Live |
| **Your role** | Founder, design and full-stack development |
| **Stack** | React 19, Vite 7, TypeScript, Tailwind CSS 4, Supabase, Postgres + RLS, Supabase Realtime, Edge Functions, pg_cron, Capacitor 8, Stripe Billing, Caddy, Hetzner |
| **Live site** | https://shiftella.app |
| **Repository** | (leave empty unless the repo is public) |
| **Demo** | [[TODO: a demo organization link, if there is one — otherwise leave empty]] |
| **Cover image** | URL of `shiftella-login-dark.png` after uploading (16:9 crop works best) |
| **Published** | on, once the TODOs are filled |
| **Featured** | on (it's the flagship project) |
| **Service in Ops** | `shiftella.web` only if it ever runs as a container; it's a static site today, so leave empty |

---

## Case study (paste into "Case study")

```markdown
## The problem

Small teams — cafés, shops, clinics — still plan shifts in spreadsheets and
group chats. The owner rebuilds the week by hand, people miss changes posted in
a chat, and a swap means three messages and a phone call.
[[TODO: one or two sentences from your own experience: where you saw this, who
asked for it.]]

## What I built

Shiftella is a shift planner with two sides:

- **Owners and managers** create an organization, invite the team and build the
  schedule for the week.
- **Staff** see their own shifts, get changes as they happen and handle swaps
  from the phone. [[TODO: confirm the exact staff features — availability,
  swaps, check-ins — and list only the ones that are live.]]

It runs in Czech and English, in light and dark, in the browser and as a phone
app built from the same code.

![Sign in, desktop](UPLOAD_URL/shiftella-login-dark.png)
![Creating an organization](UPLOAD_URL/shiftella-signup.png)
![Sign in on a phone](UPLOAD_URL/shiftella-login-phone.png)

## How it works

- **One React codebase, three targets.** React 19 + TypeScript, built with
  Vite 7 and styled with Tailwind CSS 4. Capacitor 8 wraps the same build as the
  iOS and Android app. [[TODO: are the store apps published? Say where.]]
- **Supabase as the backend.** Auth for sign-in and invites; Postgres with
  row-level security, so every query is scoped to the user's organization by
  the database itself, not by app code; Realtime so a schedule change shows up
  on everyone's screen without a refresh.
- **Server-side jobs.** Edge Functions handle the work that can't run in the
  browser [[TODO: e.g. invites, notifications, Stripe webhooks]], and pg_cron
  runs the scheduled ones [[TODO: e.g. reminders, cleanup]].
- **Billing.** Stripe Billing for subscriptions [[TODO: plans and trial, if
  public]], with the subscription state synced back into Postgres.
- **Hosting.** The web app is a static build served by the shared Caddy on my
  own Hetzner server (the same box as this site). Each deploy uploads a new
  release folder and swaps a `current` symlink atomically, so rolling back is
  one command; HTTPS certificates are automatic.

## What I did

Everything: product idea, UX and visual design, the React front end, the
database schema and RLS policies, Edge Functions, billing, the mobile builds,
and the server and deploy pipeline. [[TODO: mention anyone who helped — testers,
a first customer, a designer — if they did.]]

## Outcome

[[TODO: real facts only. For example: launch date; how many organizations or
people use it; a quote from a first user; what changed for them (time saved on
planning, fewer missed shifts). Leave this section out rather than guess.]]

## What I learned

[[TODO: two or three honest lessons — e.g. designing RLS policies first, what
Capacitor made easy or hard, pricing.]]
```

---

## Publishing it (in anwar.os)

1. **Put the screenshots somewhere public** so they have stable https URLs.
   Files in `/app/files` are private (their links are signed and expire), so
   don't use those. Simplest: copy the PNGs to `public/case-studies/` in this
   repo and deploy; they're then at `https://<your domain>/case-studies/…png`
   (in the case study a same-site path like `/case-studies/shiftella-signup.png`
   works too; the cover field needs the full https URL). Any public image host
   you trust works as well.
2. **/app/projects → New project.** Paste the title (the address fills in as
   `shiftella`), summary, role, stack (comma separated), links and the cover
   image URL from the table above.
3. **Paste the case study** into "Case study" and replace every `UPLOAD_URL/…`
   with the real image URLs. Image lines that follow each other with no blank
   line between them become a two-column screenshot gallery; a single image
   line is a full-width figure; the text in `![…]` is its caption.
4. Fill or delete every `[[TODO: …]]`.
5. Turn on **Published** (and **Featured** for the landing page). It saves on
   the spot; open **View** to check /projects/shiftella on the phone too.
