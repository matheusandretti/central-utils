// public/js/logs.js
document.addEventListener('DOMContentLoaded', async () => {
  inicializarSidebar('audit-logs');

  const whoami = document.getElementById('whoami');
  const btnLogout = document.getElementById('btnLogout');
  const form = document.getElementById('filterForm');
  const msg = document.getElementById('logsMessage');
  const btnClear = document.getElementById('btnClearFilters');

  btnLogout?.addEventListener('click', () => AuthClient.logoutAndRedirect());

  const ctx = await AuthClient.getAuthContext();
  if (!ctx) return;
  whoami.textContent = `Logado como: ${ctx.user.name} <${ctx.user.email}> (${ctx.user.role})`;

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    await carregarLogs();
  });

  btnClear?.addEventListener('click', async () => {
    document.getElementById('action').value = '';
    document.getElementById('username').value = '';
    document.getElementById('startDate').value = '';
    document.getElementById('endDate').value = '';
    msg.textContent = '';
    await carregarLogs();
  });

  await carregarLogs();
});

async function carregarLogs() {
  const tbody = document.getElementById('logsTableBody');
  const msg = document.getElementById('logsMessage');
  tbody.innerHTML = '';

  const action = document.getElementById('action').value.trim();
  const email = document.getElementById('username').value.trim(); // pode manter o id por enquanto
  const startDate = document.getElementById('startDate').value;
  const endDate = document.getElementById('endDate').value;

  const qs = new URLSearchParams();
  if (action) qs.set('action', action);
  if (email) qs.set('email', email); // <-- importante: enviar "email"
  if (startDate) qs.set('startDate', startDate);
  if (endDate) qs.set('endDate', endDate);

  try {
    const resp = await AuthClient.authFetch(`/api/admin/audit-logs?${qs.toString()}`, {
      method: 'GET',
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error) throw new Error(data.error || 'Erro ao buscar logs');

    const logs = data.logs || [];
    if (!logs.length) {
      tbody.innerHTML = `<tr><td colspan="6">Nenhum registro encontrado.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs
      .map((l) => {
        const when = l.created_at ? new Date(l.created_at).toLocaleString() : '-';

        const userLabel =
          (l.name && l.email) ? `${l.name} <${l.email}>` :
            (l.email || l.name || '-');

        const ip = (l.ip || '-').replace(/^::ffff:/, '');

        const details = l.meta ? escapeHtml(JSON.stringify(l.meta)) : '';

        return `
      <tr>
        <td>${when}</td>
        <td>${escapeHtml(userLabel)}</td>
        <td>${escapeHtml(l.action || '-')}</td>
        <td>${escapeHtml(l.status || '-')}</td>
        <td>${escapeHtml(ip)}</td>
        <td style="max-width:420px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          <span title="${details}">${details}</span>
        </td>
      </tr>
    `;
      })
      .join('');
    ;
  } catch (err) {
    console.error(err);
    msg.textContent = err.message || 'Erro inesperado';
    tbody.innerHTML = `<tr><td colspan="6">Erro ao carregar logs.</td></tr>`;
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
