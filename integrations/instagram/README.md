# Instagram automation

## Saturday market story
- `.github/workflows/instagram-story.yml` runs Saturday morning (≈6:30–7:30 AM New York) and posts a 1080×1920 story
  ("Find us at the market") listing that Saturday's markets from the operations sheet Plan tab
  (read through `/api/schedule`, same data as the homepage). No markets planned → nothing is posted.
- Design: `story.html` (brand colors/fonts from the site, photo `public/img/hero.webp`). Layout shrinks for 4 and 5+ markets.
  Town line: `town` from `data/markets.json`, or `storyTown` when set (Midtown → "North Hills, Raleigh").
- `story.mjs render` makes `public/ig/story-<date>.jpg`; the workflow commits it so Cloudflare serves it at
  `https://www.hummusyall.com/ig/story-<date>.jpg` (Instagram needs a public JPEG URL), then `story.mjs post` posts it
  through the Instagram Graph API (container `media_type=STORIES` → `media_publish`) and records it in `state.json`.
- Manual run: GitHub → Actions → "Instagram Saturday story" → Run workflow → `preview` (image only, download from the run)
  or `post` (posts now).

## Meta setup (done 2026-10-16)
- Meta developer app "Hummus Yall Posting" (app ID 1124727760515281, business portfolio hummusyall), use case
  "Manage messaging & content on Instagram". Owned by Alon's Facebook login (alonmantel@gmail.com).
- Token: Facebook-login route (no Instagram password needed). Graph API Explorer with pages_show_list, business_management,
  instagram_basic, instagram_content_publish, pages_read_engagement → extended in the Access Token Debugger → Page token
  for "Hummus y'all" (Page ID 325009424037078), which never expires. Stored as GitHub secret `IG_ACCESS_TOKEN`.
- Instagram account @hummusyall, IG user ID 17841467835833598 (`IG_USER_ID` in the workflow).
- If the token stops working (password change, app access removed in Facebook → Business integrations), repeat the token steps.
- Limits: stories can't have link/location/poll stickers through the API, and no Instagram music.
