// arquivo sugerido: public/js/separador-csv-baixa-automatica.js

document.addEventListener('DOMContentLoaded', () => {
  // ID precisa existir em MENU_CONFIG dentro de sidebar.js
  inicializarSidebar('separador-csv-baixa-automatica');
  inicializarPaginaSeparadorCsv();
});

function inicializarPaginaSeparadorCsv() {
  const form = document.getElementById('form-separador-csv-baixa-automatica');
  const statusEl = document.getElementById('statusMensagem');
  const resumoAnoBody = document.getElementById('resumoAnoBody');
  const arquivosBody = document.getElementById('arquivosGeradosBody');
  const btnDownloadZip = document.getElementById('btnDownloadZip');

  if (!form) {
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const fileInput = document.getElementById('inputExcel');
    const file = fileInput && fileInput.files && fileInput.files[0];

    if (!file) {
      if (statusEl) {
        statusEl.textContent = 'Selecione um arquivo Excel para processar.';
      }
      return;
    }

    if (statusEl) {
      statusEl.textContent = 'Enviando arquivo e processando...';
    }

    // limpa resultados anteriores
    if (resumoAnoBody) {
      resumoAnoBody.innerHTML = '';
    }
    if (arquivosBody) {
      arquivosBody.innerHTML = '';
    }
    if (btnDownloadZip) {
      btnDownloadZip.disabled = true;
      btnDownloadZip.dataset.downloadId = '';
    }

    const formData = new FormData();
    formData.append('arquivo', file);

    try {
      const response = await fetch('/api/separador-csv-baixa-automatica/processar', {
        method: 'POST',
        body: formData
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data || data.ok === false) {
        const errorMsg = (data && data.error) || 'Falha ao processar o arquivo.';
        throw new Error(errorMsg);
      }

      if (statusEl) {
        statusEl.textContent = 'Processamento concluído.';
      }

      const resumo = data.resumoPorAno || {};
      const arquivos = data.arquivosGerados || [];
      const downloadId = data.downloadId;

      preencherResumoPorAno(resumoAnoBody, resumo);
      preencherTabelaArquivos(arquivosBody, arquivos);

      if (btnDownloadZip && downloadId) {
        btnDownloadZip.disabled = false;
        btnDownloadZip.dataset.downloadId = String(downloadId);
      }
    } catch (err) {
      console.error(err);
      if (statusEl) {
        statusEl.textContent =
          (err && err.message) || 'Erro inesperado ao processar o arquivo.';
      }

      // se der erro, exibe mensagem padrão nas tabelas
      if (resumoAnoBody && resumoAnoBody.children.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 2;
        td.textContent = 'Não foi possível gerar o resumo.';
        tr.appendChild(td);
        resumoAnoBody.appendChild(tr);
      }

      if (arquivosBody && arquivosBody.children.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 3;
        td.textContent = 'Nenhum arquivo gerado.';
        tr.appendChild(td);
        arquivosBody.appendChild(tr);
      }
    }
  });

  if (btnDownloadZip) {
    btnDownloadZip.addEventListener('click', () => {
      const downloadId = btnDownloadZip.dataset.downloadId;
      if (!downloadId) return;

      const url = `/api/separador-csv-baixa-automatica/download/${encodeURIComponent(
        downloadId
      )}`;
      window.open(url, '_blank');
    });
  }
}

function preencherResumoPorAno(tbody, resumo) {
  if (!tbody) return;

  tbody.innerHTML = '';

  const anos = Object.keys(resumo || {}).sort();

  if (!anos.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 2;
    td.textContent = 'Nenhuma linha processada.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  anos.forEach((ano) => {
    const tr = document.createElement('tr');

    const tdAno = document.createElement('td');
    tdAno.textContent = ano;

    const tdLinhas = document.createElement('td');
    tdLinhas.textContent = resumo[ano];

    tr.appendChild(tdAno);
    tr.appendChild(tdLinhas);

    tbody.appendChild(tr);
  });
}

function preencherTabelaArquivos(tbody, arquivos) {
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!arquivos || !arquivos.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 3;
    td.textContent = 'Nenhum arquivo CSV gerado.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  arquivos.forEach((item) => {
    const tr = document.createElement('tr');

    const tdArquivo = document.createElement('td');
    tdArquivo.textContent = item.arquivo || '';

    const tdAno = document.createElement('td');
    tdAno.textContent = item.ano != null ? String(item.ano) : '';

    const tdLinhas = document.createElement('td');
    tdLinhas.textContent = item.linhas != null ? String(item.linhas) : '';

    tr.appendChild(tdArquivo);
    tr.appendChild(tdAno);
    tr.appendChild(tdLinhas);

    tbody.appendChild(tr);
  });
}
