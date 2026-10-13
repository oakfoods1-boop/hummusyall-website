// Password protection for the private /admin pages and /api/admin routes.
// The password is the ADMIN_PASSWORD setting in Cloudflare. The browser shows its own sign-in box.
export async function requireAdmin({ request, env, next }) {
  const expected = env.ADMIN_PASSWORD || '';
  const header = request.headers.get('Authorization') || '';
  let given = '';
  if (header.startsWith('Basic ')) {
    try { given = atob(header.slice(6)).split(':').slice(1).join(':'); } catch { given = ''; }
  }
  if (expected && (await same(given, expected))) return next();
  return new Response(expected ? 'Sign in required.' : 'Set ADMIN_PASSWORD in Cloudflare to use this page.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Hummus Yall orders", charset="UTF-8"', 'Cache-Control': 'no-store' },
  });
}

// Constant-time comparison so the password can't be guessed by timing.
async function same(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const ax = new Uint8Array(x), ay = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ax.length; i++) diff |= ax[i] ^ ay[i];
  return diff === 0;
}
