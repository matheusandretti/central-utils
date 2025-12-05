// public/js/separador-pdf-relatorio-de-ferias.js

document.addEventListener('DOMContentLoaded', () => {
  // Inicializa a sidebar com a página atual (ID definido no MENU_CONFIG de sidebar.js)
  if (typeof inicializarSidebar === 'function') {
    inicializarSidebar('relatorio-ferias');
  }

  inicializarPaginaSeparadorFerias();
});

function inicializarPaginaSeparadorFerias() {
  const form = document.getElementById('form-separador-ferias');
  if (form) {
    form.addEventListener('submit', handleSubmitSeparadorFerias);
  }
}

async function handleSubmitSeparadorFerias(event) {
  event.preventDefault();

  const inputPdf = document.getElementById('arquivoPdf');
  const inputCompetencia = document.getElementById('competencia');
  const statusMensagem = document.getElementById('statusMensagem');
  const logArea = document.getElementById('logArea');
  const btnProcessar = document.getElementById('btnProcessar');

  if (!inputPdf || !inputPdf.files || inputPdf.files.length === 0) {
    statusMensagem.textContent = 'Selecione um arquivo PDF para continuar.';
    return;
  }

  if (!inputCompetencia.value.trim()) {
    statusMensagem.textContent = 'Informe a competência (ex.: 112025).';
    return;
  }

  const formData = new FormData();
  formData.append('arquivoPdf', inputPdf.files[0]);
  formData.append('competencia', inputCompetencia.value.trim());

  statusMensagem.textContent = 'Enviando arquivo e processando...';
  if (logArea) {
    logArea.textContent = '';
  }

  if (btnProcessar) {
    btnProcessar.disabled = true;
    btnProcessar.textContent = 'Processando...';
  }

  try {
    const resp = await fetch('/api/separador-pdf-relatorio-de-ferias/processar', {
      method: 'POST',
      body: formData,
    });

    if (!resp.ok) {
      let msg = 'Falha ao processar o arquivo.';
      try {
        const maybeJson = await resp.json();
        if (maybeJson && maybeJson.error) {
          msg = maybeJson.error;
        }
      } catch (_) {
        // corpo não é JSON, mantém mensagem padrão
      }
      throw new Error(msg);
    }

    // Resposta é um ZIP (application/zip)
    const blob = await resp.blob();

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const competencia = inputCompetencia.value.trim();
    const filename = competencia
      ? `relatorios-ferias-separados-${competencia}.zip`
      : 'relatorios-ferias-separados.zip';

    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    statusMensagem.textContent = 'Processamento concluído. O download do ZIP foi iniciado.';
    if (logArea) {
      logArea.textContent =
        'ZIP gerado com sucesso.\nCaso o download não tenha começado automaticamente, verifique se o navegador bloqueou pop-ups ou downloads automáticos.';
    }
  } catch (err) {
    console.error(err);
    statusMensagem.textContent = err.message || 'Erro inesperado ao processar o relatório.';
    if (logArea) {
      logArea.textContent = `Erro:\n${err.message || String(err)}`;
    }
  } finally {
    if (btnProcessar) {
      btnProcessar.disabled = false;
      btnProcessar.textContent = 'Processar e baixar ZIP';
    }
  }
}
