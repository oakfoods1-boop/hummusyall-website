// Posts every reel (or video story, "type": "story") in integrations/instagram/reels/*.json whose status is "approved", or "scheduled" with postAt in the past.
// The video must be committed under public/ig/reels/ (served by Cloudflare at https://www.hummusyall.com/ig/reels/…).
// Needs IG_ACCESS_TOKEN (permanent Facebook Page token) and IG_USER_ID. Marks each one "posted" (or "failed").
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SITE = process.env.SITE_URL || 'https://www.hummusyall.com';
const GRAPH = 'https://graph.facebook.com/v26.0';
const token = process.env.IG_ACCESS_TOKEN, ig = process.env.IG_USER_ID;
if (!token || !ig) throw new Error('IG_ACCESS_TOKEN / IG_USER_ID missing');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = join(here, 'reels');

async function api(path, params, method = 'POST') {
  const url = `${GRAPH}/${path}`;
  const r = method === 'POST'
    ? await fetch(url, { method, body: new URLSearchParams({ ...params, access_token: token }) })
    : await fetch(`${url}?${new URLSearchParams({ ...params, access_token: token })}`);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`${path}: ${j.error ? j.error.message : r.status}`);
  return j;
}

let posted = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.json') && !n.endsWith('.edit.json'))) {
  const p = join(dir, f); const reel = JSON.parse(readFileSync(p, 'utf8'));
  const due = reel.status === 'scheduled' && reel.postAt && Date.parse(reel.postAt) <= Date.now();
  if (reel.status !== 'approved' && !due) continue;
  const videoUrl = `${SITE}/${reel.video.replace(/^public\//, '')}`;
  try {
    for (let i = 0; ; i++) {          // wait for Cloudflare to deploy the video
      const r = await fetch(videoUrl, { method: 'HEAD' }).catch(() => null);
      if (r && r.ok && (r.headers.get('content-type') || '').includes('video')) break;
      if (i > 40) throw new Error('video never went live: ' + videoUrl);
      await sleep(15000);
    }
    // "type": "story" → a video story (no caption); "tags": ["handle", ...] → people tagged (retried without tags if Instagram refuses them)
    const isStory = reel.type === 'story';
    const params = isStory ? { media_type: 'STORIES', video_url: videoUrl }
      : { media_type: 'REELS', video_url: videoUrl, caption: reel.caption || '', share_to_feed: 'true' };
    // "thumbOffset": milliseconds → which frame Instagram uses as the reel cover (default is the first frame)
    if (!isStory && reel.thumbOffset != null) params.thumb_offset = String(reel.thumbOffset);
    const tags = (reel.tags || []).map((u) => String(u).replace(/^@/, ''));
    if (tags.length) params.user_tags = JSON.stringify(tags.map((username) => (isStory ? { username } : { username, x: 0.5, y: 0.5 })));
    // "collaborators": ["handle", ...] → Collab invites (reels/feed only, max 3; they must accept). Retried without if refused.
    const collabs = isStory ? [] : (reel.collaborators || []).map((u) => String(u).replace(/^@/, '')).slice(0, 3);
    if (collabs.length) params.collaborators = JSON.stringify(collabs);
    let container;
    try { ({ id: container } = await api(`${ig}/media`, params)); }
    catch (e) {
      if (!params.user_tags && !params.collaborators) throw e;
      reel.tagError = String(e.message || e); delete params.user_tags; delete params.collaborators;
      ({ id: container } = await api(`${ig}/media`, params));
    }
    let status = '';
    for (let i = 0; i < 60; i++) {    // Instagram processes the video (usually 30 s – 3 min)
      await sleep(10000);
      status = (await api(container, { fields: 'status_code,status' }, 'GET')).status_code;
      if (status === 'FINISHED') break;
      if (status === 'ERROR' || status === 'EXPIRED') throw new Error('Instagram could not process the video (' + status + ')');
    }
    if (status !== 'FINISHED') throw new Error('Instagram processing timed out');
    let id;                            // media_publish sometimes fails with a passing "Fatal" error: wait and retry
    for (let i = 0; ; i++) {
      try { ({ id } = await api(`${ig}/media_publish`, { creation_id: container })); break; }
      catch (e) { if (i >= 3) throw e; console.log('publish retry', i + 1, String(e.message || e)); await sleep(30000 * (i + 1)); }
    }
    const info = await api(id, { fields: 'permalink' }, 'GET').catch(() => ({}));
    Object.assign(reel, { status: 'posted', postedAt: new Date().toISOString(), mediaId: id, permalink: info.permalink || '' });
    posted++;
    console.log(JSON.stringify({ reel: reel.id, status: 'posted', permalink: reel.permalink }));
  } catch (e) {
    Object.assign(reel, { status: 'failed', error: String(e.message || e) });
    console.log(JSON.stringify({ reel: reel.id, status: 'failed', error: reel.error }));
  }
  writeFileSync(p, JSON.stringify(reel, null, 1) + '\n');
}
console.log(`posted ${posted}`);
