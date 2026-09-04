# Inevitable Elite League — Production Website

Production frontend for the Inevitable Elite League (IEL), connected directly to the dedicated IEL Supabase project.

## Production architecture

- **Frontend:** static HTML/CSS/JavaScript
- **Database/Auth/Storage:** Supabase
- **Public data:** approved teams, active rosters, matches, standings, seasons, featured players, partners, site settings
- **Private staff data:** registrations, scoreboard uploads, staff-only writes
- **Deployment:** GitHub Pages workflow from `main`
- **Supabase project:** `qbgmqakdxissnsjazjws`

The browser uses only the Supabase **publishable** key. No service-role or secret key is committed to this repository.

## Included public pages

- Home
- Qualifiers
- Majors
- Schedule
- Teams / rosters
- Standings
- Featured Players
- Sponsors / Partners
- Hall of Champions
- Team Registration
- Reserved routes for Merch, Promo, and Leaderboard

## Team registration

The public registration form submits:

- Team name
- Division: Entry, Elite, or Masters
- Region
- Captain name + Discord
- Four starters
- Two reserves
- Activision IDs for all six players
- Optional promo code
- Optional team logo

Team logos upload only to the `team-logos/registrations` storage path. Anonymous users can submit a pending registration but cannot read the private registration review queue.

## Staff Command

Open `#staff` or `?page=staff`.

Staff features include:

- Discord OAuth sign-in through Supabase Auth
- Staff authorization through `public.staff_members`
- Approve/reject team registrations
- Approval automatically creates the published team and roster
- Assign team seeds
- Generate qualifier matchups by week/division
- Report/reopen match results
- Upload COD scoreboards to the review queue
- Manually review/apply map reports and player map stats
- Publish Featured Players
- Publish Sponsors / Partners
- Edit public site settings and open/close registration

## Scoreboard / OCR pipeline

The website currently supports the complete storage/review/data path:

1. Staff uploads a scoreboard image.
2. A `scoreboard_uploads` row is created.
3. Staff can manually review the screenshot and apply a `map_reports` row plus `player_map_stats` rows.
4. Public/league stats use the same stored map data.

The automated OCR processor is intentionally a separate hook. No fake OCR output is generated. An IEL Edge Function can later populate `ocr_raw`, `review_json`, confidence, and `review_required` using the same queue without redesigning the website.

## First staff account

The new IEL Supabase project starts with no Auth users and no active `staff_members` records.

Before Staff Command can be used:

1. Configure Discord as an OAuth provider in the IEL Supabase project.
2. Add the production website URL to Supabase Auth redirect URLs.
3. Sign in once through `/index.html#staff` (or `?page=staff`) so the Auth user is created.
4. Add that Auth user's UUID to `public.staff_members` with an active staff role.
5. Refresh Staff Command.

Do **not** create a public "first user becomes admin" bootstrap route. Staff authorization must remain explicit.

## GitHub Pages

`.github/workflows/pages.yml` deploys this static website whenever `main` changes.

GitHub Pages must be enabled once in the repository's **Settings → Pages** and the publishing source set to **GitHub Actions**. After that, pushes to `main` deploy automatically.

If a custom IEL domain is used later, configure the domain in GitHub Pages and add that exact HTTPS URL to the Supabase Auth redirect allow-list.

## Security notes

- Supabase Row Level Security is enabled on exposed IEL tables.
- Public views use `security_invoker=true`.
- Anonymous registrations are INSERT-only; the review queue is private.
- Storage uploads are restricted by bucket/folder/file type policies.
- Staff mutations require `private.is_staff()` through RLS.
- Service-role/secret keys must never be placed in browser code.

## Main files

- `index.html` — application shell
- `styles.css` — IEL black/gold/teal production design system
- `app.js` — router/bootstrap
- `js/core.js` — Supabase client, shared state, data loading, auth helpers
- `js/public.js` — public league pages
- `js/registration.js` — RLS-safe registration submission
- `js/staff.js` — Staff Command and league operations

## Current Season 1 configuration

The database currently has:

- `Season 1 · Founders Season`
- 4 qualifier weeks
- 2 matches per team per week
- Entry / Elite / Masters divisions
- Registration open

Public pages intentionally show empty states until real teams, matches, Featured Players, or partners are added.
