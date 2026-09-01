// signin.js
// Set this to wherever your backend actually runs (same as API_BASE_URL in script.js)
const API_BASE_URL = "https://quickbyte-com-food-ordering-website.onrender.com";
const HOME_PAGE = "../index.html";


const stepLogin = document.getElementById('step-login');
const stepEnroll = document.getElementById('step-enroll');
const stepChallenge = document.getElementById('step-challenge');
const msg = document.getElementById('msg');

let pendingFactorId = null;
let pendingChallengeId = null;

function showStep(step) {
  stepLogin.style.display = step === 'login' ? 'block' : 'none';
  stepEnroll.style.display = step === 'enroll' ? 'block' : 'none';
  stepChallenge.style.display = step === 'challenge' ? 'block' : 'none';
}

async function checkAllowedOnBackend() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return false;
  
  try {
    const res = await fetch(`${API_BASE_URL}/auth/check-allowed`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    
    const json = await res.json();
    console.log("Server JSON Payload Received:", json);
    
    // Accept either json.ok or json.allowed as valid approval indicators
    return json.ok === true || json.allowed === true;
  } catch (error) {
    console.error("Backend authorization check failed:", error);
    return false;
  }
}




async function routeAfterAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { showStep('login'); return; }

  // Which "assurance level" is this session at right now vs. the highest available?
  const { data: aalData } = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
  const { data: factorsData } = await supabaseClient.auth.mfa.listFactors();
  
  const allTotpFactors = factorsData?.totp || [];
  const verifiedTotp = allTotpFactors.find(f => f.status === 'verified');
  const unverifiedTotp = allTotpFactors.find(f => f.status === 'unverified');

  // If no verified factor exists, we must handle enrollment or resume an unverified one
  if (!verifiedTotp) {
    let enrollmentData;

    if (unverifiedTotp) {
      // An unverified factor exists. Challenge it to get a validation session instead of creating a conflict.
      const { data: challengeData, error: challengeErr } = await supabaseClient.auth.mfa.challenge({ factorId: unverifiedTotp.id });
      if (challengeErr) { msg.textContent = challengeErr.message; return; }
      
      pendingFactorId = unverifiedTotp.id;
      pendingChallengeId = challengeData.id;
      
      // Attempt to re-enroll to retrieve a fresh QR code payload for the user interface
      const { data: reEnrollData, error: reEnrollErr } = await supabaseClient.auth.mfa.enroll({ factorType: 'totp' });
      if (!reEnrollErr) {
        pendingFactorId = reEnrollData.id;
        enrollmentData = reEnrollData.totp;
      }
    } else {
      // First time this user has signed in — create a brand new enrollment factor.
      const { data: newEnrollData, error: newEnrollErr } = await supabaseClient.auth.mfa.enroll({ factorType: 'totp' });
      if (newEnrollErr) { msg.textContent = newEnrollErr.message; return; }
      
      pendingFactorId = newEnrollData.id;
      enrollmentData = newEnrollData.totp;
    }

    // Only render the UI components if we have valid QR/Secret registration data
    if (enrollmentData) {
      const qrWrap = document.getElementById('qr-wrap');
      qrWrap.innerHTML = ''; // Safely clear out any loading text
      qrWrap.style.flexDirection = 'column'; // Stack elements vertically

      // 1. Create and append the responsive QR Image
      const qrImg = document.createElement('img');
      qrImg.src = enrollmentData.qr_code;
      qrImg.alt = "Scan with your authenticator app";
      qrWrap.appendChild(qrImg);

      // 2. Build the native mobile deep link string
      const userEmail = encodeURIComponent(session.user.email || 'user');
      const issuerName = encodeURIComponent('QuickByte');
      const otpauthUrl = `otpauth://totp/${issuerName}:${userEmail}?secret=${enrollmentData.secret}&issuer=${issuerName}`;

      // 3. Create and append the mobile-friendly clickable link button
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
      
      // Optional hover effect via JS manipulation
      mobileLink.onmouseover = () => mobileLink.style.color = 'var(--copper-dk)';
      mobileLink.onmouseout = () => mobileLink.style.color = 'var(--copper)';

      qrWrap.appendChild(mobileLink);
    }

    showStep('enroll');
    return;
  }

  if (aalData.currentLevel !== 'aal2') {
    // Factor exists and is verified, but this session hasn't done the 2FA challenge yet.
    const { data, error } = await supabaseClient.auth.mfa.challenge({ factorId: verifiedTotp.id });
    if (error) { msg.textContent = error.message; return; }
    pendingFactorId = verifiedTotp.id;
    pendingChallengeId = data.id;
    showStep('challenge');
    return;
  }

  // Fully authenticated (Google + 2FA). Last check: are they actually on the allowlist?
  const allowed = await checkAllowedOnBackend();
  if (!allowed) {
    msg.textContent = "This account isn't approved for access. Contact the site admin.";
    await supabaseClient.auth.signOut();
    showStep('login');
    return;
  }

  window.location.href = HOME_PAGE;
}


document.getElementById('googleBtn').addEventListener('click', async () => {
  msg.textContent = '';
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href },
  });
  if (error) msg.textContent = error.message;
});
//
document.getElementById('enrollVerifyBtn').addEventListener('click', async () => {
  msg.textContent = '';
  const code = document.getElementById('enrollCode').value.trim();
  const { data: challenge, error: challengeErr } = await supabaseClient.auth.mfa.challenge({ factorId: pendingFactorId });
  if (challengeErr) { msg.textContent = challengeErr.message; return; }
  const { error } = await supabaseClient.auth.mfa.verify({
    factorId: pendingFactorId,
    challengeId: challenge.id,
    code,
  });
  if (error) { msg.textContent = 'Incorrect code — try again.'; return; }
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
  if (error) { msg.textContent = 'Incorrect code — try again.'; return; }
  await routeAfterAuth();
});

// Runs on initial load AND right after Supabase redirects back from Google.
routeAfterAuth();