// public/js/excel-abas-pdf.js

document.addEventListener('DOMContentLoaded', () => {
  // inicializa a sidebar com o ID da página (deve existir em MENU_CONFIG)
  inicializarSidebar('excel-abas-pdf');

  inicializarPaginaExcelAbasPdf();
});

function inicializarPaginaExcelAbasPdf() {
  const form = document.getElementById('form-excel-abas-pdf');
  const btnBaixarZip = document.getElementById('btnBaixarZipExcelAbasPdf');

  if (form) {
    form.addEventListener('submit', enviarFormularioExcelAbasPdf);
  }

  if (btnBaixarZip) {
    btnBaixarZip.addEventListener('click', () => {
      const url = btnBaixarZip.dataset.zipUrl;
      if (!url) return;
      // abre o download do ZIP em nova aba/janela
      window.open(url, '_blank');
    });
  }
}

async function enviarFormularioExcelAbasPdf(event) {
  event.preventDefault();

  const inputArquivos = document.getElementById('excelFiles');
  const statusEl = document.getElementById('excelAbasPdfStatus');
  const btnProcessar = document.getElementById('btnProcessarExcelAbasPdf');
  const btnBaixarZip = document.getElementById('btnBaixarZipExcelAbasPdf');
  const tabelaBody = document.querySelector(
    '#tabelaResultadosExcelAbasPdf tbody'
  );

  if (!inputArquivos || !inputArquivos.files || inputArquivos.files.length === 0) {
    exibirStatusExcelAbasPdf('Selecione ao menos um arquivo Excel.', true);
    return;
  }

  const formData = new FormData();
  for (const file of inputArquivos.files) {
    formData.append('files', file);
  }

  // limpa tabela
  if (tabelaBody) {
    tabelaBody.innerHTML = '';
  }

  // estado de carregamento
  if (btnProcessar) {
    btnProcessar.disabled = true;
    btnProcessar.textContent = 'Processando...';
  }
  if (btnBaixarZip) {
    btnBaixarZip.disabled = true;
    btnBaixarZip.dataset.zipUrl = '';
  }
  exibirStatusExcelAbasPdf('Enviando arquivos e gerando PDFs, aguarde...', false);

  try {
    const resposta = await fetch('/api/excel-abas-pdf/processar', {
      method: 'POST',
      body: formData
    });

    const data = await resposta.json().catch(() => ({}));

    if (!resposta.ok || !data.ok) {
      const msgErro =
        (data && (data.error || data.message)) ||
        'Erro ao processar as planilhas.';
      throw new Error(msgErro);
    }

    exibirStatusExcelAbasPdf('Processamento concluído com sucesso!', false);

    // Preenche tabela com os resultados (arquivo, aba, nome do PDF, status)
    if (Array.isArray(data.resultados) && tabelaBody) {
      data.resultados.forEach((item) => {
        const tr = document.createElement('tr');

        const tdArquivo = document.createElement('td');
        tdArquivo.textContent = item.arquivo_excel || '-';

        const tdAba = document.createElement('td');
        tdAba.textContent = item.aba || '-';

        const tdPdf = document.createElement('td');
        tdPdf.textContent = item.nome_pdf || item.pdf || '-';

        const tdStatus = document.createElement('td');
        tdStatus.textContent = item.sucesso ? 'OK' : 'Erro';
        if (!item.sucesso && item.erro) {
          tdStatus.title = item.erro;
        }

        tr.appendChild(tdArquivo);
        tr.appendChild(tdAba);
        tr.appendChild(tdPdf);
        tr.appendChild(tdStatus);

        tabelaBody.appendChild(tr);
      });
    }

    // Habilita botão de download do ZIP
    if (btnBaixarZip && data.zipUrl) {
      btnBaixarZip.disabled = false;
      btnBaixarZip.dataset.zipUrl = data.zipUrl;
    }
  } catch (err) {
    console.error(err);
    exibirStatusExcelAbasPdf(
      err && err.message ? err.message : 'Erro inesperado ao gerar os PDFs.',
      true
    );
  } finally {
    if (btnProcessar) {
      btnProcessar.disabled = false;
      btnProcessar.textContent = 'Gerar PDFs das abas';
    }
  }
}

function exibirStatusExcelAbasPdf(mensagem, isErro) {
  const statusEl = document.getElementById('excelAbasPdfStatus');
  if (!statusEl) return;

  statusEl.textContent = mensagem || '';
  statusEl.style.color = isErro ? '#b91c1c' : '#111827';
}
