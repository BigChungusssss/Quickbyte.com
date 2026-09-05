const API_BASE_URL = "https://quickbyte-com-food-ordering-website.onrender.com";
let accessToken = null;
let cachedUsers = [];

function authHeaders() {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
}

/* ============ ROLE-BASED FORM SWITCHING ============ */
function updateFormForRole() {
  const role = document.getElementById('roleSelect').value;
  const classLeaderSelect = document.getElementById('personClassLeaderId');
  
  // Only students need to be linked to another group/leader if applicable
  if (classLeaderSelect) {
    classLeaderSelect.style.display = role === 'student' ? 'block' : 'none';
    if (role === 'student') {
      classLeaderSelect.innerHTML = cachedUsers
        .map(u => `<option value="${u.id}">${u.full_name || u.email} (id ${u.id})</option>`).join('');
    }
  }
}
document.getElementById('roleSelect').addEventListener('change', updateFormForRole);

/* ============ LOAD & RENDER ============ */
async function loadAll() {
  const res = await fetch(`${API_BASE_URL}/dev/users`, { headers: authHeaders() });
  if (res.status === 401) { window.location.href = '../Frontend/Sign/signin.html'; return; }
  if (res.status === 403) { document.getElementById('msg').textContent = "You're signed in but not a dev."; return; }
  const { users } = await res.json();
  cachedUsers = users;
  updateFormForRole();

  renderUsers(users);
}

function renderUsers(users) {
  document.getElementById('users').innerHTML = users.map(u => `
    <div class="user-card" data-id="${u.id}">
      <h3>${u.full_name || '(no name)'} — ${u.role} ${u.is_admin ? '(Admin)' : ''}</h3>
      <div class="meta">
        <span>Email: ${u.email}</span>
        <label>
          <input type="checkbox" data-field="is_admin" data-id="${u.id}" ${u.is_admin ? 'checked' : ''} /> Admin
        </label>
        <button data-action="save-admin" data-id="${u.id}">save</button>
      </div>
      <button data-action="remove-user" data-id="${u.id}">Remove user role</button>
    </div>
  `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">None yet.</p>';

  document.querySelectorAll('[data-action="save-admin"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const cardEl = document.querySelector(`.user-card[data-id="${id}"]`);
      const isAdmin = cardEl.querySelector('[data-field="is_admin"]').checked;
      
      const res = await fetch(`${API_BASE_URL}/dev/users/${id}`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ isAdmin }),
      });
      if (!res.ok) { document.getElementById('msg').textContent = 'Could not save changes.'; return; }
      loadAll();
    });
  });

  document.querySelectorAll('[data-action="remove-user"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this user role assignment?')) return;
      const res = await fetch(`${API_BASE_URL}/dev/users/${btn.dataset.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) {
        document.getElementById('msg').textContent = 'Could not remove this user.';
        return;
      }
      loadAll();
    });
  });
}

/* ============ ADD FORM SUBMIT ============ */
document.getElementById('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  document.getElementById('msg').textContent = '';
  const role = document.getElementById('roleSelect').value;

  const body = {
    role,
    email: document.getElementById('personEmail').value.trim(),
    fullName: document.getElementById('personFullName').value.trim(),
    isAdmin: document.getElementById('newIsAdmin')?.checked || false,
    classLeaderId: role === 'student' ? Number(document.getElementById('personClassLeaderId').value) : null,
  };

  const res = await fetch(`${API_BASE_URL}/dev/users`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    document.getElementById('msg').textContent = errBody.error || 'Could not add this user.';
    return;
  }

  e.target.reset();
  updateFormForRole();
  loadAll();
});

(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = '../Frontend/Sign/signin.html'; return; }
  accessToken = session.access_token;

  const check = await fetch(`${API_BASE_URL}/dev/check`, { headers: authHeaders() });
  if (!check.ok) {
    document.body.innerHTML = '<p id="msg" style="color:var(--danger);font-family:var(--font-mono);">Not authorized.</p>';
    return;
  }

  loadAll();
})();