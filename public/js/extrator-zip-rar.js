// public/js/extrator-zip-rar.js

document.addEventListener('DOMContentLoaded', () => {
  // Inicializa sidebar compartilhada
  // O ID 'extrator-zip-rar' deve existir no MENU_CONFIG em sidebar.js
  inicializarSidebar('extrator-zip-rar');

  const form = document.getElementById('zipRarForm');
  const input = document.getElementById('zipRarInput');
  const statusEl = document.getElementById('zipRarStatus');
  const metricsWrapper = document.getElementById('zipRarMetrics');
  const metricTotalArchives = document.getElementById('metricTotalArchives');
  const metricTotalUniqueFiles = document.getElementById('metricTotalUniqueFiles');
  const metricTotalNewFiles = document.getElementById('metricTotalNewFiles');
  const messageExtra = document.getElementById('zipRarMessageExtra');
  const logEl = document.getElementById('zipRarLog');
  const btnProcessar = document.getElementById('btnProcessarZipRar');
  const btnDownload = document.getElementById('btnDownloadResultadoZip');

  let currentDownloadUrl = null;

  function setStatus(msg) {
    statusEl.textContent = msg || '';
  }

  function appendLog(line) {
    if (!line) return;
    logEl.textContent += (logEl.textContent ? '\n' : '') + line;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const files = input.files;
    if (!files || files.length === 0) {
      setStatus('Selecione pelo menos um arquivo ZIP ou RAR.');
      return;
    }

    setStatus('Enviando arquivos para processamento...');
    messageExtra.textContent = '';
    logEl.textContent = '';
    metricsWrapper.style.display = 'none';
    btnDownload.disabled = true;
    currentDownloadUrl = null;

    btnProcessar.disabled = true;
    btnProcessar.textContent = 'Processando...';

    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append('archives', file);
      }

      const response = await fetch('/api/extrator-zip-rar/process', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Falha ao processar arquivos ZIP/RAR.');
      }

      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.error || 'Erro retornado pela API.');
      }

      setStatus('Processamento concluído com sucesso.');

      // Atualiza métricas, se vierem do backend
      const stats = data.stats || {};
      if (typeof stats.total_archives === 'number') {
        metricTotalArchives.textContent = stats.total_archives;
      }
      if (typeof stats.total_unique_files === 'number') {
        metricTotalUniqueFiles.textContent = stats.total_unique_files;
      }
      if (typeof stats.total_new_files === 'number') {
        metricTotalNewFiles.textContent = stats.total_new_files;
      }

      metricsWrapper.style.display = 'grid';

      if (stats.message) {
        messageExtra.textContent = stats.message;
      }

      if (Array.isArray(stats.logs)) {
        stats.logs.forEach((line) => appendLog(line));
      }

      if (data.downloadUrl) {
        currentDownloadUrl = data.downloadUrl;
        btnDownload.disabled = false;
      } else {
        appendLog('Aviso: downloadUrl não informado pela API.');
      }
    } catch (err) {
      console.error(err);
      setStatus('Erro ao processar arquivos.');
      appendLog(String(err.message || err));
    } finally {
      btnProcessar.disabled = false;
      btnProcessar.textContent = 'Processar arquivos';
    }
  });

  btnDownload.addEventListener('click', () => {
    if (!currentDownloadUrl) return;
    // Abre o link em nova aba para disparar o download
    window.open(currentDownloadUrl, '_blank');
  });
});
