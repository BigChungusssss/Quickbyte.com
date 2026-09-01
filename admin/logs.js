    const API_BASE_URL = "https://quickbyte-com-food-ordering-website.onrender.com";

    async function load() {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) { window.location.href = '../Sign/signin.html'; return; }

      const res = await fetch(`${API_BASE_URL}/admin/security-logs`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.status === 401) { window.location.href = '../Sign/signin.html'; return; }
      if (res.status === 403) { document.getElementById('msg').textContent = "You're signed in but not an admin."; return; }
      if (!res.ok) { document.getElementById('msg').textContent = 'Failed to load logs.'; return; }

      const { logs } = await res.json();
      document.getElementById('rows').innerHTML = logs.map(l => `
        <tr>
          <td>${new Date(l.created_at).toLocaleString()}</td>
          <td>${l.type}</td>
          <td>${l.detail || ''}</td>
          <td>${l.email || ''}</td>
          <td>${l.ip || ''}</td>
          <td>${l.path || ''}</td>
        </tr>
      `).join('');
    }

    load();