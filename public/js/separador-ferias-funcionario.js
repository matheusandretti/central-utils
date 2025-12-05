// public/js/separador-ferias-funcionario.js

document.addEventListener('DOMContentLoaded', function () {
  // Inicializa a sidebar com a página atual
  if (typeof inicializarSidebar === 'function') {
    inicializarSidebar('ferias-funcionario');
  }

  const form = document.getElementById('feriasForm');
  const pdfInput = document.getElementById('pdfInput');
  const statusEl = document.getElementById('feriasStatus');

  const resultadoCard = document.getElementById('feriasResultadoCard');
  const empresaLabel = document.getElementById('feriasEmpresaLabel');
  const totalPaginasEl = document.getElementById('feriasTotalPaginas');
  const totalFuncionariosEl = document.getElementById('feriasTotalFuncionarios');
  const arquivosTbody = document.getElementById('feriasArquivosTbody');
  const btnDownloadZip = document.getElementById('btnDownloadZipFerias');

  const btnProcessar = document.getElementById('btnProcessarFerias');

  if (!form || !pdfInput || !statusEl) {
    return;
  }

  function setLoading(isLoading) {
    if (!btnProcessar) return;
    btnProcessar.disabled = isLoading;
    btnProcessar.textContent = isLoading ? 'Processando...' : 'Processar PDF';
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    statusEl.textContent = '';
    resultadoCard.style.display = 'none';
    arquivosTbody.innerHTML = '';
    btnDownloadZip.href = '#';

    const file = pdfInput.files[0];
    if (!file) {
      statusEl.textContent = 'Selecione um arquivo PDF antes de processar.';
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    setLoading(true);
    statusEl.textContent = 'Enviando e processando o PDF de férias...';

    try {
      const resp = await fetch('/api/separador-ferias-funcionario/process', {
        method: 'POST',
        body: formData,
      });

      const data = await resp.json();

      if (!resp.ok || !data.ok) {
        statusEl.textContent =
          data.error || 'Erro ao processar o PDF de férias no servidor.';
        return;
      }

      // Preencher resumo
      empresaLabel.textContent = data.empresa || 'sem_empresa';
      totalPaginasEl.textContent = data.total_paginas ?? 0;
      totalFuncionariosEl.textContent = data.total_funcionarios ?? 0;

      // Preencher tabela de arquivos
      if (Array.isArray(data.arquivos)) {
        data.arquivos.forEach((nome, idx) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${idx + 1}</td>
            <td>${nome}</td>
          `;
          arquivosTbody.appendChild(tr);
        });
      }

      // Link para download do ZIP
      if (data.download_url) {
        btnDownloadZip.href = data.download_url;
        btnDownloadZip.setAttribute('download', '');
        btnDownloadZip.style.pointerEvents = 'auto';
      } else {
        btnDownloadZip.href = '#';
        btnDownloadZip.style.pointerEvents = 'none';
      }

      resultadoCard.style.display = 'block';
      statusEl.textContent = data.message || 'Processamento concluído com sucesso.';
    } catch (err) {
      console.error('Erro na chamada /api/separador-ferias-funcionario/process:', err);
      statusEl.textContent = 'Erro de comunicação com o servidor.';
    } finally {
      setLoading(false);
    }
  });
});
