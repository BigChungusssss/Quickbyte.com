// auth-guard.js
// Include AFTER supabaseClient.js on every page that requires a logged-in, 2FA'd user.
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// <script src="supabaseClient.js"></script>
// <script src="auth-guard.js"></script>

const SIGNIN_PAGE = 'Sign/signin.html';
const AUTH_API_BASE_URL = 'https://quickbyte-com-food-ordering-website.onrender.com';

// Returns the current access token if the session is fully authenticated (Google + 2FA),
// otherwise redirects to sign-in and returns null. Call this before rendering anything
// that needs auth, and use the returned token on your fetch() calls to the backend.
async function requireSignedIn() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = SIGNIN_PAGE; return null; }

  const { data: aalData } = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalData.currentLevel !== 'aal2') { window.location.href = SIGNIN_PAGE; return null; }

  return session.access_token;
}

async function applySignInUI(accessToken) {
  const signInBtn = document.getElementById('SignIN');
  const greetingEl = document.getElementById('greeting');
  if (!signInBtn) return;

  if (accessToken) {
    signInBtn.textContent = 'Sign out';
    signInBtn.onclick = async () => {
      await supabaseClient.auth.signOut();
      window.location.href = SIGNIN_PAGE;
    };
    let isDev = false;
    let profileIsAdmin = false;

    if (greetingEl) {
      try {
        const res = await fetch(`${AUTH_API_BASE_URL}/auth/check-allowed`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const profile = await res.json();
        greetingEl.textContent = `${profile.name}, ${profile.companyName} — Student #${profile.studentNumber}, Group ${profile.groupNumber}`;
        profileIsAdmin = !!profile.isAdmin;
      } catch (e) {
        greetingEl.textContent = '';
      }
    }

    // Quiet checks: links only appear for the right people — everyone else,
    // this silently shows nothing. Not new access points, just shortcuts.
    try {
      const devCheck = await fetch(`${AUTH_API_BASE_URL}/dev/check`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      isDev = devCheck.ok;
    } catch (e) { /* not a dev, or offline */ }

    const addSecretLink = (id, href, label, bottomPx) => {
      if (document.getElementById(id)) return;
      const link = document.createElement('a');
      link.id = id;
      link.href = href;
      link.textContent = label;
      link.style.cssText = `position:fixed;bottom:${bottomPx}px;left:8px;font-family:monospace;font-size:11px;color:#999;text-decoration:none;z-index:999;opacity:0.6;`;
      document.body.appendChild(link);
    };

    if (isDev) {
      // Devs get both: leaders management and the security log.
      addSecretLink('devShortcutLink', 'dev/leaders.html', 'dev', 8);
      addSecretLink('adminLogsShortcutLink', 'admin/logs.html', 'logs', 24);
    } else if (profileIsAdmin) {
      // Admin class leaders (not devs) only get the security log.
      addSecretLink('adminLogsShortcutLink', 'admin/logs.html', 'logs', 8);
    }
  } else {
    signInBtn.textContent = 'Sign IN';
    signInBtn.onclick = () => { window.location.href = SIGNIN_PAGE; };
    if (greetingEl) greetingEl.textContent = '';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const accessToken = await requireSignedIn(); // redirects away if not fully authenticated
  await applySignInUI(accessToken);
});