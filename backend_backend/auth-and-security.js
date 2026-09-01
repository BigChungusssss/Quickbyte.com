// auth-and-security.js
// npm install @supabase/supabase-js helmet cors express-rate-limit

const { createClient } = require('@supabase/supabase-js');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Service-role key: full DB access, server-side ONLY — never send this to the browser.
// Both come from Supabase dashboard: Settings -> API.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ---------------- security event log ---------------- */

// In-memory counter to spot bursts of bad requests from one IP without hitting the DB every time.
const recentOffenses = new Map(); // ip -> { count, windowStart }
const ALERT_THRESHOLD = 10;   // offenses...
const ALERT_WINDOW_MS = 60_000; // ...within this many ms triggers an alert

async function logSecurityEvent({ req, type, detail, email }) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;

  try {
    await supabaseAdmin.from('security_log').insert({
      type,
      detail,
      ip,
      path: req.originalUrl,
      email: email || null,
    });
  } catch (e) {
    console.error('Failed to write security_log:', e.message);
  }

  const now = Date.now();
  const entry = recentOffenses.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > ALERT_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  recentOffenses.set(ip, entry);

  if (entry.count === ALERT_THRESHOLD) {
    console.warn(`ALERT: ${entry.count} flagged requests from ${ip} in the last minute (latest: ${type})`);
    // Optional: wire this to email.js/Resend to actually notify you, e.g.
    // const { sendOrderExpiredNotice } = require('./email'); // or a dedicated sendSecurityAlert()
  }
}

/* ---------------- shared token verification ---------------- */

// Verifies the bearer token is a real Supabase session that completed 2FA (aal2).
// Returns { user } on success, or { errorType, message } on failure — does NOT
// check class-leader/allowlist membership, so it can be reused by requireDev too.
async function getVerifiedUser(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { errorType: 'auth_missing_token', message: 'No bearer token supplied' };

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return { errorType: 'auth_invalid_token', message: error?.message };

  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
  if (payload.aal !== 'aal2') return { errorType: 'auth_2fa_incomplete', message: 'Session missing aal2', email: user.email };

  return { user };
}

/* ---------------- auth middleware ---------------- */

// Protects any route: verifies the Supabase JWT, requires a full (Google + 2FA) session,
// and checks the caller's email against the class-leader allowlist. Attaches req.user.
async function requireAuth(req, res, next) {
  const { user, errorType, message, email } = await getVerifiedUser(req);
  if (!user) {
    await logSecurityEvent({ req, type: errorType, detail: message, email });
    return res.status(401).json({ error: errorType === 'auth_2fa_incomplete' ? '2FA required' : 'Not authenticated' });
  }

  const { data: emailRow } = await supabaseAdmin
    .from('class_leader_emails')
    .select('email, class_leaders ( id, name, company_name, student_number, group_number, is_admin )')
    .eq('email', user.email)
    .maybeSingle();

  if (!emailRow) {
    await logSecurityEvent({ req, type: 'auth_not_allowlisted', detail: 'Valid login, no class leader account', email: user.email });
    return res.status(403).json({ error: 'Account not approved for access' });
  }

  req.user = {
    id: user.id,
    email: user.email,
    leaderId: emailRow.class_leaders.id,
    leaderName: emailRow.class_leaders.name,
    companyName: emailRow.class_leaders.company_name,
    studentNumber: emailRow.class_leaders.student_number,
    groupNumber: emailRow.class_leaders.group_number,
    isAdmin: emailRow.class_leaders.is_admin,
  };
  next();
}

// Extra gate for admin-only routes (e.g. the security log viewer). Use after requireAuth.
function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    logSecurityEvent({ req, type: 'admin_route_denied', detail: 'Non-admin attempted admin route', email: req.user?.email });
    return res.status(403).json({ error: 'Admins only' });
  }
  next();
}

// Gate for routes both admins AND devs should see (currently: the security log).
// Checks DEV_EMAILS first (no class_leaders row needed), then falls back to the
// is_admin flag on a class_leaders row. Either one is enough.
async function requireAdminOrDev(req, res, next) {
  const { user, errorType, message, email } = await getVerifiedUser(req);
  if (!user) {
    await logSecurityEvent({ req, type: errorType, detail: message, email });
    return res.status(401).json({ error: errorType === 'auth_2fa_incomplete' ? '2FA required' : 'Not authenticated' });
  }

  if (DEV_EMAILS.includes(user.email.toLowerCase())) {
    req.user = { id: user.id, email: user.email, isDev: true };
    return next();
  }

  const { data: emailRow } = await supabaseAdmin
    .from('class_leader_emails')
    .select('email, class_leaders ( is_admin )')
    .eq('email', user.email)
    .maybeSingle();

  if (!emailRow?.class_leaders?.is_admin) {
    await logSecurityEvent({ req, type: 'admin_route_denied', detail: 'Neither dev nor admin', email: user.email });
    return res.status(403).json({ error: 'Admins only' });
  }

  req.user = { id: user.id, email: user.email, isAdmin: true };
  next();
}

/* ---------------- dev-only gate ---------------- */

// The dev area (adding/removing class leaders) is restricted to a hardcoded list of
// emails set in the environment — completely separate from the class_leaders table,
// so it works even before any leader exists, and no class leader (even an admin one)
// can grant themselves this access by editing a database row.
// .env: DEV_EMAILS=you@gmail.com,you@wits.ac.za
const DEV_EMAILS = (process.env.DEV_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

async function requireDev(req, res, next) {
  const { user, errorType, message, email } = await getVerifiedUser(req);
  if (!user) {
    await logSecurityEvent({ req, type: errorType, detail: message, email });
    return res.status(401).json({ error: errorType === 'auth_2fa_incomplete' ? '2FA required' : 'Not authenticated' });
  }

  if (!DEV_EMAILS.includes(user.email.toLowerCase())) {
    await logSecurityEvent({ req, type: 'dev_area_denied', detail: 'Non-dev attempted dev-only route', email: user.email });
    return res.status(403).json({ error: 'Dev access only' });
  }

  req.user = { id: user.id, email: user.email, isDev: true };
  next();
}

/* ---------------- general hardening ---------------- */

// Rate limit anything sensitive — tune the numbers to your real traffic.
const authRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  handler: async (req, res) => {
    await logSecurityEvent({ req, type: 'rate_limited', detail: 'Too many requests' });
    res.status(429).json({ error: 'Too many requests, slow down.' });
  },
});

// Call this once in your main server file: applyHardening(app, { allowedOrigin: 'https://a.com,https://b.com' })
// allowedOrigin can be a single URL or a comma-separated list (e.g. your live
// site plus http://127.0.0.1:5500 for local testing with Live Server).
function applyHardening(app, { allowedOrigin }) {
  const allowedOrigins = (allowedOrigin || '').split(',').map(o => o.trim()).filter(Boolean);
  app.use(helmet());
  app.use(cors({
    origin: (origin, callback) => {
      // requests with no Origin header (e.g. curl, server-to-server) are allowed through
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
  }));
  app.set('trust proxy', 1); // needed for req.ip / x-forwarded-for to be accurate behind a proxy/host
}

module.exports = {
  supabaseAdmin,
  requireAuth,
  requireAdmin,
  requireAdminOrDev,
  requireDev,
  authRateLimiter,
  applyHardening,
  logSecurityEvent,
};