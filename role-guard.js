// role-guard.js
// Include after supabaseClient.js on any page that should only be reachable
// by a specific role. Usage:
//   const accessToken = await requireRole(['student']);
//   if (!accessToken) return; // already redirected, stop running the page's own code

const API_BASE_URL = "https://quickbyte-com-food-ordering-website.onrender.com";
const SIGNIN_PAGE = 'Sign/signin.html';

const DASHBOARD_BY_ROLE = {
  student: 'student-dashboard.html',
  supplier: 'supplier-dashboard.html',
  admin: 'supplier-dashboard.html', // admins use the supplier view too
};

async function requireRole(allowedRoles) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = SIGNIN_PAGE; return null; }

  const res = await fetch(`${API_BASE_URL}/auth/whoami`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) { window.location.href = SIGNIN_PAGE; return null; }

  const who = await res.json();
  const actualRole = who.kind === 'profile' ? who.role : null;

  if (!actualRole || !allowedRoles.includes(actualRole)) {
    // Signed in, just not allowed on THIS page — send them to wherever they
    // actually belong instead of a dead end.
    window.location.href = DASHBOARD_BY_ROLE[actualRole] || SIGNIN_PAGE;
    return null;
  }

  return session.access_token;
}
