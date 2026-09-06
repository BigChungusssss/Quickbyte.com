// signin.js
const API_BASE_URL = "https://quickbyte-com-food-ordering-website.onrender.com";
const HOME_PAGE = "../index.html";

// Set to true to require 2FA (matches REQUIRE_2FA on the backend — keep both
// in sync, or the frontend will show/skip steps that the backend disagrees with).
const REQUIRE_2FA = false;

const stepLogin = document.getElementById('step-login');
const stepEnroll = document.getElementById('step-enroll');
const stepChallenge = document.getElementById('step-challenge');
const msg = document.getElementById('msg');
//
let pendingFactorId = null;
let pendingChallengeId = null;

function showStep(step) {
  stepLogin.style.display = step === 'login' ? 'block' : 'none';
  stepEnroll.style.display = step === 'enroll' ? 'block' : 'none';
  stepChallenge.style.display = step === 'challenge' ? 'block' : 'none';
}

async function whoAmI() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/whoami`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

/**
 * Handles the MFA routing flow and access control checks after initial OAuth login.
 */
async function routeAfterAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    showStep('login');
    return;
  }

  // Which "assurance level" is this session at right now vs. the highest available?
  if (REQUIRE_2FA) {
    const { data: aalData } = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
    const { data: factorsData } = await supabaseClient.auth.mfa.listFactors();

    const allTotpFactors = factorsData?.totp || [];
    const verifiedTotp = allTotpFactors.find(f => f.status === 'verified');
    const unverifiedTotp = allTotpFactors.find(f => f.status === 'unverified');

    // If no verified factor exists, handle enrollment or resume an unverified factor
    if (!verifiedTotp) {
      let enrollmentData;

      if (unverifiedTotp) {
        const { data: challengeData, error: challengeErr } = await supabaseClient.auth.mfa.challenge({ factorId: unverifiedTotp.id });
        if (challengeErr) {
          msg.textContent = challengeErr.message;
          return;
        }
        pendingFactorId = unverifiedTotp.id;
        pendingChallengeId = challengeData.id;

        const { data: reEnrollData, error: reEnrollErr } = await supabaseClient.auth.mfa.enroll({ factorType: 'totp' });
        if (!reEnrollErr) {
          pendingFactorId = reEnrollData.id;
          enrollmentData = reEnrollData.totp;
        }
      } else {
        const { data: newEnrollData, error: newEnrollErr } = await supabaseClient.auth.mfa.enroll({ factorType: 'totp' });
        if (newEnrollErr) {
          msg.textContent = newEnrollErr.message;
          return;
        }
        pendingFactorId = newEnrollData.id;
        enrollmentData = newEnrollData.totp;
      }

      if (enrollmentData) {
        const qrWrap = document.getElementById('qr-wrap');
        qrWrap.innerHTML = '';
        qrWrap.style.flexDirection = 'column';

        const qrImg = document.createElement('img');
        qrImg.src = enrollmentData.qr_code;
        qrImg.alt = "Scan with your authenticator app";
        qrWrap.appendChild(qrImg);

        const userEmail = encodeURIComponent(session.user.email || 'user');
        const issuerName = encodeURIComponent('QuickByte');
        const otpauthUrl = `otpauth://totp/${issuerName}:${userEmail}?secret=${enrollmentData.secret}&issuer=${issuerName}`;

        const mobileLink = document.createElement('a');
        mobileLink.href = otpauthUrl;
        mobileLink.className = "mobile-only-link";
        mobileLink.textContent = "📱 Open in Authenticator App";
        mobileLink.style.cssText = `
          display: inline-block;
          margin-top: 12px;
          font-family: var(--font-mono);
          font-size: 14px;
          color: var(--copper);
          text-decoration: none;
          font-weight: 500;
          padding: 6px 12px;
          border: 1px dashed var(--line);
          border-radius: 4px;
          background: var(--card);
        `;
        mobileLink.onmouseover = () => mobileLink.style.color = 'var(--copper-dk)';
        mobileLink.onmouseout = () => mobileLink.style.color = 'var(--copper)';

        qrWrap.appendChild(mobileLink);
      }

      showStep('enroll');
      return;
    }

    // Factor exists and is verified, but this session hasn't completed 2FA yet
    if (aalData.currentLevel !== 'aal2') {
      const { data, error } = await supabaseClient.auth.mfa.challenge({ factorId: verifiedTotp.id });
      if (error) {
        msg.textContent = error.message;
        return;
      }
      pendingFactorId = verifiedTotp.id;
      pendingChallengeId = data.id;
      showStep('challenge');
      return;
    }
  }

  // Fully authenticated (Google OAuth, plus 2FA if REQUIRE_2FA is on). Figure
  // out who they are and send them to the right place.
  const who = await whoAmI();
  if (!who || !who.ok) {
    msg.textContent = "This account isn't approved for access. Contact the site admin.";
    await supabaseClient.auth.signOut();
    showStep('login');
    return;
  }

  if (who.kind === 'profile' && who.role === 'student') {
    window.location.href = '../student-dashboard.html';
  } else if (who.kind === 'profile' && (who.role === 'supplier' || who.role === 'admin')) {
    window.location.href = '../supplier-dashboard.html';
  } else {
    window.location.href = HOME_PAGE; // class leader → main ordering site
  }
}

// Event Listeners
document.getElementById('googleBtn').addEventListener('click', async () => {
  msg.textContent = '';
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href },
  });
  if (error) msg.textContent = error.message;
});

document.getElementById('enrollVerifyBtn').addEventListener('click', async () => {
  msg.textContent = '';
  const code = document.getElementById('enrollCode').value.trim();

  const { data: challenge, error: challengeErr } = await supabaseClient.auth.mfa.challenge({ factorId: pendingFactorId });
  if (challengeErr) {
    msg.textContent = challengeErr.message;
    return;
  }

  const { error } = await supabaseClient.auth.mfa.verify({
    factorId: pendingFactorId,
    challengeId: challenge.id,
    code,
  });

  if (error) {
    msg.textContent = 'Incorrect code — try again.';
    return;
  }
  await routeAfterAuth();
});

document.getElementById('challengeVerifyBtn').addEventListener('click', async () => {
  msg.textContent = '';
  const code = document.getElementById('challengeCode').value.trim();

  const { error } = await supabaseClient.auth.mfa.verify({
    factorId: pendingFactorId,
    challengeId: pendingChallengeId,
    code,
  });

  if (error) {
    msg.textContent = 'Incorrect code — try again.';
    return;
  }
  await routeAfterAuth();
});

// Runs on initial load AND right after Supabase redirects back from Google OAuth.
routeAfterAuth();