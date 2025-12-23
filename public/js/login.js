document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const msg = document.getElementById('loginMessage');
  const btn = document.getElementById('btnLogin');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    btn.disabled = true;

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error) throw new Error(data.error || 'Falha no login');

      window.location.href = '/';
    } catch (err) {
      msg.textContent = err.message || 'Erro inesperado';
    } finally {
      btn.disabled = false;
    }
  });
});
