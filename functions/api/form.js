// POST /api/form  — catering inquiries and job applications.
// Forwards each submission to a Google Apps Script web app (see integrations/forms-to-sheet.gs),
// which adds it to a Google Sheet and emails Alon.
//
// Needs in Cloudflare Pages settings:  FORM_WEBHOOK_URL  (the Apps Script web app URL)
//                                       FORM_SECRET       (any long random text; same value set in the Apps Script)
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const FORMS = { catering: 'Catering inquiry', jobs: 'Job application' };

export async function onRequestPost({ request, env }) {
  let data;
  try { data = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (data.website) return json({ ok: true }); // spam trap filled in by bots
  if (!FORMS[data.form]) return json({ error: 'Unknown form.' }, 400);
  if (!data.firstName || !data.email || !/^\S+@\S+\.\S+$/.test(data.email)) return json({ error: 'Missing required fields.' }, 400);
  if (!env.FORM_WEBHOOK_URL) return json({ error: 'Forms are not connected yet.' }, 503);

  const clean = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'website') continue;
    clean[k] = (Array.isArray(v) ? v.join(', ') : String(v)).slice(0, 4000);
  }
  clean.formTitle = FORMS[data.form];
  clean.submittedAt = new Date().toISOString();

  const res = await fetch(env.FORM_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.FORM_SECRET || '', submission: clean }),
    redirect: 'follow',
  });
  if (!res.ok) return json({ error: 'Could not save your message.' }, 502);
  return json({ ok: true });
}
