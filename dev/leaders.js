const API_BASE_URL = "https://quickbyte-com-food-ordering-website.onrender.com";
let accessToken = null;

function authHeaders() {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
}

async function loadLeaders() {
  const res = await fetch(`${API_BASE_URL}/dev/leaders`, { headers: authHeaders() });
  if (res.status === 401) { window.location.href = '../Sign/signin.html'; return; }
  if (res.status === 403) { document.getElementById('msg').textContent = "You're signed in but not an admin."; return; }
  const { leaders } = await res.json();

  document.getElementById('leaders').innerHTML = leaders.map(l => `
    <div class="leader" data-id="${l.id}">
      <h3>${l.name} ${l.is_admin ? '(admin)' : ''} — <strong>Role: ${l.role || 'student'}</strong></h3>
      <div class="meta" style="margin-bottom:8px;">
        <label style="display:inline-flex; align-items:center; gap:6px; font-family:var(--font-mono); font-size:12px;">
          Set Role:
          <select data-field="role-select" data-id="${l.id}" style="padding:4px; font-family:var(--font-mono);">
            <option value="student" ${l.role === 'student' ? 'selected' : ''}>Student</option>
            <option value="supplier" ${l.role === 'supplier' ? 'selected' : ''}>Supplier</option>
          </select>
        </label>
        <button data-action="save-role" data-id="${l.id}">Update Role</button>
      </div>
      <div class="meta">
        Company: <input data-field="company_name" data-id="${l.id}" value="${l.company_name}" />
        Student #: <input data-field="student_number" data-id="${l.id}" value="${l.student_number}" />
        Group: <input data-field="group_number" data-id="${l.id}" value="${l.group_number}" />
        <button data-action="save-meta" data-id="${l.id}">save</button>
      </div>
      ${l.emails.map(e => `
        <div class="email-row">
          <span>${e}</span>
          <button data-action="remove-email" data-id="${l.id}" data-email="${e}">remove</button>
        </div>
      `).join('')}
      <div class="email-row" style="margin-top:6px;">
        <input placeholder="add another email" id="add-email-${l.id}" style="flex:1;margin-right:6px;" />
        <button data-action="add-email" data-id="${l.id}">add</button>
      </div>
      <button data-action="remove-leader" data-id="${l.id}">Remove person entirely</button>
    </div>
  `).join('');

  document.querySelectorAll('[data-action="remove-email"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`${API_BASE_URL}/dev/leaders/${btn.dataset.id}/emails/${encodeURIComponent(btn.dataset.email)}`, {
        method: 'DELETE', headers: authHeaders(),
      });
      loadLeaders();
    });
  });

  document.querySelectorAll('[data-action="add-email"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const input = document.getElementById(`add-email-${btn.dataset.id}`);
      const email = input.value.trim();
      if (!email) return;
      const res = await fetch(`${API_BASE_URL}/dev/leaders/${btn.dataset.id}/emails`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ email }),
      });
      if (!res.ok) { document.getElementById('msg').textContent = 'Could not add that email (maybe already in use).'; return; }
      loadLeaders();
    });
  });

  document.querySelectorAll('[data-action="remove-leader"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this person and all their emails?')) return;
      await fetch(`${API_BASE_URL}/dev/leaders/${btn.dataset.id}`, { method: 'DELETE', headers: authHeaders() });
      loadLeaders();
    });
  });

  document.querySelectorAll('[data-action="save-role"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const personEl = document.querySelector(`.leader[data-id="${id}"]`);
      const role = personEl.querySelector('[data-field="role-select"]').value;
      const res = await fetch(`${API_BASE_URL}/dev/leaders/${id}`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ role }),
      });
      if (!res.ok) { 
        const err = await res.json().catch(() => ({}));
        document.getElementById('msg').textContent = err.error || 'Could not update role.'; 
        return; 
      }
      document.getElementById('msg').textContent = '';
      loadLeaders();
    });
  });

  document.querySelectorAll('[data-action="save-meta"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const leaderEl = document.querySelector(`.leader[data-id="${id}"]`);
      const body = {
        companyName: leaderEl.querySelector('[data-field="company_name"]').value.trim(),
        studentNumber: leaderEl.querySelector('[data-field="student_number"]').value.trim(),
        groupNumber: leaderEl.querySelector('[data-field="group_number"]').value.trim(),
      };
      const res = await fetch(`${API_BASE_URL}/dev/leaders/${id}`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body),
      });
      if (!res.ok) { document.getElementById('msg').textContent = 'Could not save changes.'; return; }
      loadLeaders();
    });
  });
}

document.getElementById('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  document.getElementById('msg').textContent = '';
  const name = document.getElementById('newName').value.trim();
  const companyName = document.getElementById('newCompany').value.trim();
  const studentNumber = document.getElementById('newStudentNumber').value.trim();
  const groupNumber = document.getElementById('newGroupNumber').value.trim();
  const emails = document.getElementById('newEmails').value.split(',').map(s => s.trim()).filter(Boolean);
  const isAdmin = document.getElementById('newIsAdmin').checked;

  const res = await fetch(`${API_BASE_URL}/dev/leaders`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ name, companyName, studentNumber, groupNumber, emails, isAdmin }),
  });
  if (!res.ok) { document.getElementById('msg').textContent = 'Could not add person (check required fields / duplicate emails).'; return; }
  e.target.reset();
  loadLeaders();
});

(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = '../Sign/signin.html'; return; }
  accessToken = session.access_token;

  const check = await fetch(`${API_BASE_URL}/dev/check`, { headers: authHeaders() });
  if (!check.ok) {
    document.body.innerHTML = '<p id="msg" style="color:var(--danger);font-family:var(--font-mono);">Not authorized.</p>';
    return;
  }

  loadLeaders();
})();