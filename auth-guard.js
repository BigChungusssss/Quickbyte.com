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
    if (greetingEl) {
      try {
        const res = await fetch(`${AUTH_API_BASE_URL}/auth/check-allowed`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const profile = await res.json();
        greetingEl.textContent = `${profile.name}, ${profile.companyName} — Student #${profile.studentNumber}, Group ${profile.groupNumber}`;
      } catch (e) {
        greetingEl.textContent = '';
      }
    }

    // Quiet check: only devs get this link injected — everyone else, this
    // silently does nothing. Not a new access point, just a shortcut for you.
    try {
      const devCheck = await fetch(`${AUTH_API_BASE_URL}/dev/check`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (devCheck.ok && !document.getElementById('devShortcutLink')) {
        const link = document.createElement('a');
        link.id = 'devShortcutLink';
        link.href = 'dev/leaders.html';
        link.textContent = 'dev';
        link.style.cssText = 'position:fixed;bottom:8px;left:8px;font-family:monospace;font-size:11px;color:#999;text-decoration:none;z-index:999;opacity:0.6;';
        document.body.appendChild(link);
      }
    } catch (e) { /* not a dev, or offline — either way, show nothing */ }
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