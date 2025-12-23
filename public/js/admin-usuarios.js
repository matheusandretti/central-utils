document.addEventListener('DOMContentLoaded', async () => {
  inicializarSidebar('admin-usuarios');

  const whoami = document.getElementById('whoami');

  document.getElementById('btnLogout')?.addEventListener('click', () => AuthClient.logoutAndRedirect());
  document.getElementById('btnReloadUsers')?.addEventListener('click', carregarUsuarios);

  const ctx = await AuthClient.getAuthContext();
  if (!ctx) return;

  if (whoami) {
    whoami.textContent = `Logado como: ${ctx.user.name} <${ctx.user.email}> (${ctx.user.role})`;
  }

  // IMPORTAÇÃO
  document.getElementById('importForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const importMsg = document.getElementById('importMessage');
    if (importMsg) importMsg.textContent = '';

    const fileInput = document.getElementById('fileInput');
    const usersText = document.getElementById('usersText');

    const fd = new FormData();
    if (fileInput?.files?.[0]) fd.append('file', fileInput.files[0]);
    if (usersText?.value?.trim()) fd.append('usersText', usersText.value.trim());

    try {
      const resp = await AuthClient.authFetch('/api/admin/users/import', { method: 'POST', body: fd });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error) throw new Error(data.error || 'Erro ao importar');

      if (importMsg) {
        importMsg.textContent = `Importação OK: ${data.created} criados, ${data.updated} atualizados, ${data.skipped} ignorados.`;
      }

      // opcional: limpar inputs
      if (fileInput) fileInput.value = '';
      if (usersText) usersText.value = '';

      await carregarUsuarios();
    } catch (err) {
      if (importMsg) importMsg.textContent = err.message || 'Erro inesperado';
    }
  });

  // NOVO USUÁRIO (manual)
  document.getElementById('btnNewUser')?.addEventListener('click', async () => {
    try {
      const name = prompt('Nome:', '') ?? '';
      if (!name.trim()) return;

      const email = prompt('E-mail (login):', '') ?? '';
      if (!email.trim()) return;

      const password = prompt('Senha inicial (mínimo 6):', '') ?? '';
      if (!password) return;

      let role = (prompt('Role (ADMIN/USER):', 'USER') ?? 'USER').toUpperCase().trim();
      role = role === 'ADMIN' ? 'ADMIN' : 'USER';

      const resp = await AuthClient.authFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, role }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error) throw new Error(data.error || 'Falha ao criar usuário');

      await carregarUsuarios();
    } catch (err) {
      alert(err.message || 'Erro');
    }
  });

  await carregarUsuarios();
});

async function carregarUsuarios() {
  const tbody = document.getElementById('usersTableBody');
  tbody.innerHTML = '';

  try {
    const resp = await AuthClient.authFetch('/api/admin/users', { method: 'GET' });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error) throw new Error(data.error || 'Erro ao carregar');

    const users = data.users || [];
    if (!users.length) {
      tbody.innerHTML = `<tr><td colspan="6">Nenhum usuário cadastrado.</td></tr>`;
      return;
    }

    tbody.innerHTML = users
      .map((u) => {
        return `
          <tr data-id="${u.id}">
            <td>${esc(u.name)}</td>
            <td>${esc(u.email)}</td>
            <td>${esc(u.role)}</td>
            <td>${u.is_active ? 'Sim' : 'Não'}</td>
            <td>${u.created_at ? new Date(u.created_at).toLocaleString() : '-'}</td>
            <td>
              <button class="btn btn-secondary btn-sm" data-action="edit">Editar</button>
              <button class="btn btn-secondary btn-sm" data-action="pass">Senha</button>
              <button class="btn btn-secondary btn-sm" data-action="toggle">${u.is_active ? 'Desativar' : 'Ativar'}</button>
              <button class="btn btn-ghost-danger btn-sm" data-action="delete">Excluir</button>
            </td>
          </tr>
        `;
      })
      .join('');

    // bind actions
    tbody.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', onRowAction);
    });
  } catch (_) {
    tbody.innerHTML = `<tr><td colspan="6">Erro ao carregar usuários.</td></tr>`;
  }
}

async function onRowAction(e) {
  const btn = e.currentTarget;
  const action = btn.getAttribute('data-action');
  const tr = btn.closest('tr');
  const id = Number(tr?.getAttribute('data-id'));
  if (!id) return;

  const nameCell = tr.children[0]?.textContent || '';
  const emailCell = tr.children[1]?.textContent || '';
  const roleCell = tr.children[2]?.textContent || 'USER';
  const activeCell = tr.children[3]?.textContent?.trim() === 'Sim';

  try {
    if (action === 'edit') {
      const name = prompt('Nome:', nameCell) ?? '';
      if (!name.trim()) return;

      const email = prompt('E-mail (login):', emailCell) ?? '';
      if (!email.trim()) return;

      const role = (prompt('Role (ADMIN/USER):', roleCell) ?? 'USER').toUpperCase();

      const resp = await AuthClient.authFetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error) throw new Error(data.error || 'Falha ao editar');
      await carregarUsuarios();
    }

    if (action === 'pass') {
      const pw = prompt('Nova senha (mínimo 6):', '') ?? '';
      if (!pw) return;

      const resp = await AuthClient.authFetch(`/api/admin/users/${id}/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error) throw new Error(data.error || 'Falha ao alterar senha');
      alert('Senha alterada e sessões do usuário foram encerradas.');
    }

    if (action === 'toggle') {
      const resp = await AuthClient.authFetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !activeCell }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error) throw new Error(data.error || 'Falha ao alterar status');
      await carregarUsuarios();
    }

    if (action === 'delete') {
      if (!confirm(`Excluir o usuário ${emailCell}?`)) return;

      const resp = await AuthClient.authFetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error) throw new Error(data.error || 'Falha ao excluir');
      await carregarUsuarios();
    }
  } catch (err) {
    alert(err.message || 'Erro');
  }
}

function esc(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
