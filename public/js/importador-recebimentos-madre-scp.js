// arquivo sugerido: public/js/importador-recebimentos-madre-scp.js

document.addEventListener('DOMContentLoaded', () => {
  // ID deve existir no MENU_CONFIG dentro de sidebar.js
  inicializarSidebar('importador-recebimentos-madre-scp');
  inicializarPaginaImportadorMadreScp();
});

function inicializarPaginaImportadorMadreScp() {
  const form = document.getElementById('madreForm');
  if (form) {
    form.addEventListener('submit', onMadreFormSubmit);
  }
}

async function onMadreFormSubmit(event) {
  event.preventDefault();

  const fileInput = document.getElementById('pdfFile');
  const statusEl = document.getElementById('madreStatus');
  const resumoEl = document.getElementById('madreResumo');
  const tableBody = document.querySelector('#madreResumoTable tbody');
  const downloadLink = document.getElementById('madreDownloadLink');
  const btn = document.getElementById('btnMadreUpload');

  clearStatus(statusEl);
  clearResumo(resumoEl, tableBody, downloadLink);

  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    setStatus(statusEl, 'Selecione um arquivo PDF antes de processar.', true);
    return;
  }

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('pdfFile', file);

  try {
    if (btn) btn.disabled = true;
    setStatus(statusEl, 'Processando PDF, aguarde...', false);

    const resp = await fetch('/api/importador-recebimentos-madre-scp/upload', {
      method: 'POST',
      body: formData
    });

    const data = await resp.json().catch(() => null);

    if (!resp.ok || !data || data.error || data.ok !== true) {
      const msg = (data && data.error) || 'Erro ao processar o PDF.';
      throw new Error(msg);
    }

    renderizarResumoMadre(resumoEl, tableBody, downloadLink, data);
    setStatus(statusEl, 'Processamento concluído com sucesso!', false);
  } catch (err) {
    console.error(err);
    setStatus(
      statusEl,
      err && err.message ? err.message : 'Erro inesperado ao processar o PDF.',
      true
    );
  } finally {
    if (btn) btn.disabled = false;
  }
}

function clearStatus(statusEl) {
  if (!statusEl) return;
  statusEl.textContent = '';
}

function clearResumo(resumoEl, tableBody, downloadLink) {
  if (resumoEl) {
    resumoEl.innerHTML = '<p>Aguardando envio do PDF.</p>';
  }
  if (tableBody) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="4">Nenhum dado processado ainda.</td>
      </tr>
    `;
  }
  if (downloadLink) {
    downloadLink.setAttribute('hidden', 'hidden');
    downloadLink.href = '#';
  }
}

/**
 * data esperado do backend Node:
 * {
 *   ok: true,
 *   resumo: {
 *     total_registros,
 *     total_clientes,
 *     totais: { vl_baixa, acrescimo, liquido },
 *     resumo_clientes: [
 *       { cliente, vl_baixa, acrescimo, liquido }, ...
 *     ]
 *   },
 *   downloadToken: "<nome-do-arquivo.xlsx>"
 * }
 */
function renderizarResumoMadre(resumoEl, tableBody, downloadLink, data) {
  if (!data || !data.resumo) return;

  const { resumo, downloadToken } = data;
  const totais = resumo.totais || {};

  if (resumoEl) {
    resumoEl.innerHTML = `
      <p><strong>Registros processados:</strong> ${resumo.total_registros ?? 0}</p>
      <p><strong>Clientes distintos:</strong> ${resumo.total_clientes ?? 0}</p>
      <p>
        <strong>Totais (R$):</strong>
        Vl. baixa = ${formatMoney(totais.vl_baixa)}
        · Acréscimo = ${formatMoney(totais.acrescimo)}
        · Líquido = ${formatMoney(totais.liquido)}
      </p>
    `;
  }

  if (tableBody) {
    const linhas = (resumo.resumo_clientes || []).slice(0, 100); // evita tabela gigante
    if (!linhas.length) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="4">Nenhum dado disponível no resumo por cliente.</td>
        </tr>
      `;
    } else {
      tableBody.innerHTML = linhas
        .map((row) => {
          return `
            <tr>
              <td>${escapeHtml(row.cliente || '')}</td>
              <td>${formatMoney(row.vl_baixa)}</td>
              <td>${formatMoney(row.acrescimo)}</td>
              <td>${formatMoney(row.liquido)}</td>
            </tr>
          `;
        })
        .join('');
    }
  }

  if (downloadLink && downloadToken) {
    downloadLink.href =
      '/api/importador-recebimentos-madre-scp/download/' +
      encodeURIComponent(downloadToken);
    downloadLink.removeAttribute('hidden');
  }
}

function setStatus(statusEl, msg, isError) {
  if (!statusEl) return;
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('nfe-upload-message-error', !!isError);
}

/** Formata número em estilo brasileiro simples (R$ X.XXX,XX) */
function formatMoney(value) {
  const num = typeof value === 'number' ? value : Number(value || 0);
  return num.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
