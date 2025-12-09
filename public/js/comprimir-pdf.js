// arquivo sugerido: public/js/comprimir-pdf.js

let ultimoResultadoCompressao = null;

document.addEventListener('DOMContentLoaded', () => {
  // inicializa a sidebar com o ID da página (deve existir em MENU_CONFIG)
  if (typeof inicializarSidebar === 'function') {
    inicializarSidebar('comprimir-pdf');
  }

  inicializarPaginaComprimirPdf();
});

function inicializarPaginaComprimirPdf() {
  const form = document.getElementById('compressForm');
  const downloadBtn = document.getElementById('btnDownloadCompressed');

  if (form) {
    form.addEventListener('submit', onSubmitCompressForm);
  }
  if (downloadBtn) {
    downloadBtn.addEventListener('click', onDownloadCompressedClick);
  }
}

async function onSubmitCompressForm(event) {
  event.preventDefault();

  const fileInput = document.getElementById('pdfFile');
  const jpegQualityInput = document.getElementById('jpegQuality');
  const dpiScaleInput = document.getElementById('dpiScale');

  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    atualizarStatusCompressao('Selecione um arquivo PDF para continuar.', true);
    return;
  }

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('file', file);
  formData.append('jpegQuality', jpegQualityInput.value || '50');
  formData.append('dpiScale', dpiScaleInput.value || '1.0');

  atualizarStatusCompressao('Processando arquivo, aguarde...', false);
  toggleFormDisabled(true);

  try {
    const response = await fetch('/api/comprimir-pdf/processar', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      const msg = data && data.error ? data.error : 'Falha ao comprimir o PDF.';
      throw new Error(msg);
    }

    ultimoResultadoCompressao = data;
    renderizarResumoCompressao(data);
    atualizarStatusCompressao(
      'PDF comprimido com sucesso. Clique em "Baixar PDF comprimido".',
      false
    );
  } catch (err) {
    console.error(err);
    atualizarStatusCompressao(
      err.message || 'Erro inesperado ao comprimir o PDF.',
      true
    );
    ultimoResultadoCompressao = null;
    renderizarResumoCompressao(null);
  } finally {
    toggleFormDisabled(false);
  }
}

function renderizarResumoCompressao(data) {
  const nomeEl = document.getElementById('metricFileName');
  const origEl = document.getElementById('metricOriginalSize');
  const compEl = document.getElementById('metricCompressedSize');
  const redEl = document.getElementById('metricReduction');
  const downloadBtn = document.getElementById('btnDownloadCompressed');

  if (!data) {
    if (nomeEl) nomeEl.textContent = '—';
    if (origEl) origEl.textContent = '—';
    if (compEl) compEl.textContent = '—';
    if (redEl) redEl.textContent = '—';
    if (downloadBtn) downloadBtn.disabled = true;
    return;
  }

  const originalMB = (data.original_size / (1024 * 1024)).toFixed(2);
  const compressedMB = (data.compressed_size / (1024 * 1024)).toFixed(2);
  const reductionPct = data.reduction_percent.toFixed(1);

  if (nomeEl) nomeEl.textContent = data.file_name || '(sem nome)';
  if (origEl) origEl.textContent = `${originalMB} MB`;
  if (compEl) compEl.textContent = `${compressedMB} MB`;
  if (redEl) redEl.textContent = `${reductionPct}%`;

  if (downloadBtn) downloadBtn.disabled = !data.compressed_base64;
}

function atualizarStatusCompressao(mensagem, isError) {
  const statusEl = document.getElementById('compressStatus');
  if (!statusEl) return;

  statusEl.textContent = mensagem;
  statusEl.style.color = isError ? '#b91c1c' : '#111827';
}

function toggleFormDisabled(disabled) {
  const form = document.getElementById('compressForm');
  if (!form) return;

  const elements = form.querySelectorAll('input, button');
  elements.forEach((el) => {
    el.disabled = disabled;
  });
}

function onDownloadCompressedClick() {
  if (!ultimoResultadoCompressao || !ultimoResultadoCompressao.compressed_base64) {
    return;
  }

  const base64 = ultimoResultadoCompressao.compressed_base64;
  const fileName = gerarNomeArquivoSaida(
    ultimoResultadoCompressao.file_name || 'arquivo.pdf'
  );

  const byteString = atob(base64);
  const len = byteString.length;
  const bytes = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    bytes[i] = byteString.charCodeAt(i);
  }

  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function gerarNomeArquivoSaida(nomeOriginal) {
  const dotIndex = nomeOriginal.lastIndexOf('.');
  if (dotIndex === -1) {
    return `${nomeOriginal}_comprimido.pdf`;
  }
  const base = nomeOriginal.slice(0, dotIndex);
  return `${base}_comprimido.pdf`;
}
