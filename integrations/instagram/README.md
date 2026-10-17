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

## Reels (from 2026-10-16)
Flow: Alon drops raw videos/photos in Drive **Hummus Y'all Instagram / IG inbox** (oakfoods1 Drive, folder ID
1WcRWVSW9_bKAS4Npqf63nHcsPrqgVVVx, shared "anyone with the link" so GitHub can download). A scheduled Claude task
(Tue & Thu morning) turns new material into a reel, sends Alon a preview + caption, and posts only after he says "post".
1. **Fetch**: list the inbox with the Drive connector, write `inbox-request.json` ({batch, files:[{id,name}]}) and push →
   `.github/workflows/instagram-inbox.yml` downloads, shrinks (photos ≤2048 px JPG, videos 1080p H.264) into branch
   `ig-inbox` under `inbox/<batch>/`. Read with `git fetch origin ig-inbox && git archive origin/ig-inbox inbox/<batch> | tar -x`.
2. **Edit**: write an edit list and run `python3 integrations/instagram/reel.py edit.json out.mp4` (needs ffmpeg, Pillow,
   fonttools+brotli). 15–25 s, 8–10 shots of 2–2.5 s, short brand-style text per shot, end card "Order online for Sunday
   delivery or pickup · hummusyall.com". Look at a contact sheet / sample frames before sending. Photos get slow zoom;
   pick `focus` so faces/bowls stay in frame. Skip AI-generated images and tiny/blurry photos. Don't invent claims
   (menu facts only from data/menu.json; every bowl has "tangy tahini sauce").
   **Look (Alon, 2026-10-16): don't always use the brand colors.** Set `"style"` per reel and vary it between reels
   (pop / bold / script / editorial / brand), mixing in a different style on 1–2 shots (e.g. a bold hook). Logo stays on the end card.
   Don't put `[skip ci]` in commits that should start a GitHub job (inbox/music requests, approved reels).
3. **Audio rule (Alon)**: if a clip has Alon clearly talking, keep that clip's sound (`keepAudio`) and no music;
   otherwise use a track from `music/` (Pixabay, not Content ID registered), alternating tracks between reels.
   New tracks: add to `music-request.json` and push (`instagram-music.yml` downloads them). Instagram's own music
   can't be added after posting.
4. **Preview**: send the MP4 + proposed caption (+ hashtags) to Alon and wait for "post" or changes.
5. **Post**: copy the MP4 to `public/ig/reels/<id>.mp4` (keep < 20 MB), write `reels/<id>.json`
   ({id, video, caption, music, status:"approved"}) + `reels/<id>.edit.json`, push → `instagram-reel.yml` posts it
   (media_type REELS, share_to_feed) and writes back status posted + permalink, or failed + error. Check the JSON after ~3 min.
   To post later instead: status "scheduled" + "postAt" (ISO time with -04:00/-05:00); the hourly run posts it after that time.
6. **Tidy**: move the used files from IG inbox to **IG used** (folder 1VMM-cvZKoDrxp26oFmh5Qwd-ggGYpoyt) with the Drive connector.
First reel posted 2026-10-16: https://www.instagram.com/reel/Dek66CdDj_B/ (photos batch 2026-10-16-b).
