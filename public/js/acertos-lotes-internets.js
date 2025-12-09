// arquivo sugerido: public/js/acertos-lotes-internets.js

let ultimoResultadoLoteInternets = null;

document.addEventListener('DOMContentLoaded', () => {
  // Inicializa a sidebar com o ID da página
  if (typeof inicializarSidebar === 'function') {
    inicializarSidebar('acertos-lotes-internets');
  }

  inicializarPaginaAcertosLoteInternets();
});

function inicializarPaginaAcertosLoteInternets() {
  const form = document.getElementById('loteInternetsForm');
  const fileInput = document.getElementById('arquivoLote');

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        atualizarStatus('Selecione um arquivo TXT antes de processar.', true);
        return;
      }

      const file = fileInput.files[0];
      const btn = document.getElementById('btnProcessarLote');

      toggleLoading(true, btn);
      atualizarStatus('Processando arquivo, aguarde...', false);
      resetResultado();

      const formData = new FormData();
      formData.append('file', file);

      try {
        const resp = await fetch('/api/acertos-lotes-internets/process', {
          method: 'POST',
          body: formData,
        });

        const data = await resp.json().catch(() => null);

        if (!resp.ok || !data || data.ok === false) {
          const msg =
            (data && (data.error || data.message)) ||
            'Erro ao processar o arquivo.';
          throw new Error(msg);
        }

        ultimoResultadoLoteInternets = data;
        renderizarResultadoLoteInternets(data, file.name);
        atualizarStatus('Processamento concluído com sucesso.', false);
      } catch (err) {
        console.error(err);
        atualizarStatus(
          err.message || 'Erro inesperado ao processar o arquivo.',
          true
        );
      } finally {
        toggleLoading(false, btn);
      }
    });
  }

  const btnDownloadMantidas = document.getElementById('btnDownloadMantidas');
  const btnDownloadRemovidas = document.getElementById('btnDownloadRemovidas');

  if (btnDownloadMantidas) {
    btnDownloadMantidas.addEventListener('click', () => {
      if (!ultimoResultadoLoteInternets) return;
      const nome =
        ultimoResultadoLoteInternets.processedFileName ||
        'lancamentos-ajustado.txt';
      baixarTextoComoArquivo(
        ultimoResultadoLoteInternets.processedContent || '',
        nome
      );
    });
  }

  if (btnDownloadRemovidas) {
    btnDownloadRemovidas.addEventListener('click', () => {
      if (!ultimoResultadoLoteInternets) return;
      if (!ultimoResultadoLoteInternets.removedContent) return;
      const nome =
        ultimoResultadoLoteInternets.removedFileName ||
        'linhas-removidas.txt';
      baixarTextoComoArquivo(
        ultimoResultadoLoteInternets.removedContent || '',
        nome
      );
    });
  }
}

function toggleLoading(loading, btn) {
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = 'Processando...';
  } else if (btn.dataset.originalText) {
    btn.textContent = btn.dataset.originalText;
    delete btn.dataset.originalText;
  }
}

function atualizarStatus(msg, isError) {
  const statusEl = document.getElementById('aliStatus');
  if (!statusEl) return;
  statusEl.textContent = msg || '';
  statusEl.style.color = isError ? '#b91c1c' : '#111827';
}

function resetResultado() {
  atualizarMetricas(0, 0, 0, 0);

  const prevMantidas = document.getElementById('aliPreviewMantidas');
  const prevRemovidas = document.getElementById('aliPreviewRemovidas');
  if (prevMantidas) prevMantidas.textContent = '';
  if (prevRemovidas) prevRemovidas.textContent = '';

  const btnDownloadMantidas = document.getElementById('btnDownloadMantidas');
  const btnDownloadRemovidas = document.getElementById('btnDownloadRemovidas');
  if (btnDownloadMantidas) btnDownloadMantidas.disabled = true;
  if (btnDownloadRemovidas) btnDownloadRemovidas.disabled = true;
}

function atualizarMetricas(total, mantidas, removidas, pares) {
  const elTotal = document.getElementById('aliTotalLinhas');
  const elMantidas = document.getElementById('aliMantidas');
  const elRemovidas = document.getElementById('aliRemovidas');
  const elPares = document.getElementById('aliParesRemovidos');

  if (elTotal) elTotal.textContent = String(total);
  if (elMantidas) elMantidas.textContent = String(mantidas);
  if (elRemovidas) elRemovidas.textContent = String(removidas);
  if (elPares) elPares.textContent = String(pares);
}

function renderizarResultadoLoteInternets(data, originalName) {
  const total = data.totalLines ?? 0;
  const mantidas = data.keptLines ?? 0;
  const removidas = data.removedLines ?? 0;
  const pares = data.removedPairs ?? Math.floor(removidas / 2);

  atualizarMetricas(total, mantidas, removidas, pares);

  const previewMantidas = document.getElementById('aliPreviewMantidas');
  const previewRemovidas = document.getElementById('aliPreviewRemovidas');
  const previewLines = 80;

  if (previewMantidas && typeof data.processedContent === 'string') {
    previewMantidas.textContent = data.processedContent
      .split(/\r?\n/)
      .slice(0, previewLines)
      .join('\n');
  }

  if (previewRemovidas && typeof data.removedContent === 'string') {
    previewRemovidas.textContent = data.removedContent
      .split(/\r?\n/)
      .slice(0, previewLines)
      .join('\n');
  }

  const btnDownloadMantidas = document.getElementById('btnDownloadMantidas');
  const btnDownloadRemovidas = document.getElementById('btnDownloadRemovidas');

  if (btnDownloadMantidas && mantidas > 0) {
    btnDownloadMantidas.disabled = false;
  }
  if (btnDownloadRemovidas && removidas > 0) {
    btnDownloadRemovidas.disabled = false;
  }

  if (!ultimoResultadoLoteInternets) {
    ultimoResultadoLoteInternets = {};
  }

  ultimoResultadoLoteInternets.processedFileName =
    data.processedFileName || gerarNomeArquivo(originalName, 'ajustado');
  ultimoResultadoLoteInternets.removedFileName =
    data.removedFileName || gerarNomeArquivo(originalName, 'linhas-removidas');
}

function gerarNomeArquivo(originalName, sufixo) {
  const base =
    (originalName || 'lancamentos').replace(/\.[^/.]+$/, '') || 'lancamentos';
  return `${base}-${sufixo}.txt`;
}

function baixarTextoComoArquivo(texto, nomeArquivo) {
  const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo || 'arquivo.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}
