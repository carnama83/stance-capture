# Stance Capture — Environment Reference

Quick reference for working across Dev, UAT, and Prod. Keep this up to date as URLs/projects change.

## Admin test account
- **Email:** carnama83@gmail.com
- Used as the admin identity for QA/testing across all three environments (Dev, UAT, Prod). Sign in via "Continue with Google" — this Google account is already authorized in the browser profile used for testing.
- On Prod, this account was granted `admin_users` access during the Epic B QA pass (Sep 2026); it was not an admin by default.

## Environments

| Env  | Frontend URL | Supabase project ref | Git branch |
|------|--------------|----------------------|------------|
| Dev  | https://stance-capture-xde9.vercel.app/ | `essnvhvezxjcoqxvuxuq` | `dev` |
| UAT  | https://stance-capture-5nrb.vercel.app/ | `kodyqyqcuzmygtbzpebt` | `uat` |
| Prod | https://www.stancecapture.com/ | `yzxzpnomcarnxixhjlba` | `main` |

Notes:
- Dev frontend URL confirmed Sep 9 2026 by fetching the JS bundle and matching the embedded Supabase ref (`essnvhvezxjcoqxvuxuq`). It sits behind a Vercel Security Checkpoint, so plain `curl` gets HTTP 403 — a real browser clears the challenge automatically.
- The Supabase org is on the **free plan: only 2 projects can be active at once** (there are 3). Dev is normally left paused, so SQL against it times out until restored — and restoring Dev is refused while UAT and Prod are both active. Pause UAT (never Prod) to work on Dev, then swap back.
- All three Supabase projects are under the same organization (`xmryfuxqcadpmfediwok`).
- `config.toml` on each branch points `project_id` at that branch's own Supabase project — confirmed correct on `main` (points at `yzxzpnomcarnxixhjlba`, not accidentally overwritten during Dev→Prod merges).
- Prod is effectively pre-launch as of Sep 2026: only 8 real user accounts, real news sources disabled, 0 pipeline runs before the Epic B QA pass. Treat any change that populates real content or user-visible data on Prod as a launch-adjacent decision, not a routine QA action — confirm before doing it.
- Standard promotion path for fixes: `dev` → `uat` → `main`, applied to both the Supabase project (migrations, edge functions) and the git branch (frontend).
