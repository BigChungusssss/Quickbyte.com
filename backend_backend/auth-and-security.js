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
  }
}

/* ---------------- shared token verification ---------------- */

const REQUIRE_2FA = String(process.env.REQUIRE_2FA ?? 'true').toLowerCase() !== 'false';

async function getVerifiedUser(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { errorType: 'auth_missing_token', message: 'No bearer token supplied' };

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return { errorType: 'auth_invalid_token', message: error?.message };

  if (REQUIRE_2FA) {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    if (payload.aal !== 'aal2') return { errorType: 'auth_2fa_incomplete', message: 'Session missing aal2', email: user.email };
  }

  return { user };
}

/* ---------------- auth middleware ---------------- */

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

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    logSecurityEvent({ req, type: 'admin_route_denied', detail: 'Non-admin attempted admin route', email: req.user?.email });
    return res.status(403).json({ error: 'Admins only' });
  }
  next();
}

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

/* ---------------- dev-only gate (Now also allows Admins) ---------------- */

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

  // 1. Check if user is in DEV_EMAILS
  if (DEV_EMAILS.includes(user.email.toLowerCase())) {
    req.user = { id: user.id, email: user.email, isDev: true };
    return next();
  }

  // 2. Check if user has an 'admin' role in profiles table
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (!error && profile && profile.role === 'admin') {
    req.user = { id: user.id, email: user.email, isAdmin: true };
    return next();
  }

  await logSecurityEvent({ req, type: 'dev_area_denied', detail: 'Non-dev/non-admin attempted dev route', email: user.email });
  return res.status(403).json({ error: 'Dev or Admin access only' });
}

/* ---------------- general hardening ---------------- */

const authRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  handler: async (req, res) => {
    await logSecurityEvent({ req, type: 'rate_limited', detail: 'Too many requests' });
    res.status(429).json({ error: 'Too many requests, slow down.' });
  },
});

function applyHardening(app, { allowedOrigin }) {
  const allowedOrigins = (allowedOrigin || '').split(',').map(o => o.trim()).filter(Boolean);
  app.use(helmet());
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
  }));
  app.set('trust proxy', 1);
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