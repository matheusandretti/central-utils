// public/js/separador-holerites-por-empresa.js

document.addEventListener('DOMContentLoaded', () => {
  // Inicializa a sidebar com o ID desta página no MENU_CONFIG (sidebar.js)
  if (typeof inicializarSidebar === 'function') {
    inicializarSidebar('holerites-empresa');
  }

  inicializarSeparadorHolerites();
});

function inicializarSeparadorHolerites() {
  const form = document.getElementById('holeritesForm');
  const pdfInput = document.getElementById('pdfInput');
  const competenciaInput = document.getElementById('competenciaInput');
  const btnProcessar = document.getElementById('btnProcessarHolerites');
  const statusEl = document.getElementById('holeritesStatus');
  const resultadoEl = document.getElementById('holeritesResultado');
  const downloadArea = document.getElementById('holeritesDownloadArea');
  const btnDownloadZip = document.getElementById('btnDownloadZipHolerites');
  const logEl = document.getElementById('holeritesLog');

  let ultimoBlobZip = null;
  let ultimoNomeZip = null;

  if (!form) return;

  function log(msg) {
    const agora = new Date().toLocaleString('pt-BR');
    logEl.textContent += `[${agora}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setLoading(flag) {
    if (flag) {
      btnProcessar.disabled = true;
      btnProcessar.textContent = 'Processando...';
    } else {
      btnProcessar.disabled = false;
      btnProcessar.textContent = 'Processar e gerar ZIP';
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    statusEl.textContent = '';
    resultadoEl.textContent = '';
    downloadArea.style.display = 'none';
    ultimoBlobZip = null;
    ultimoNomeZip = null;

    const file = pdfInput.files[0];
    const competencia = (competenciaInput.value || '').trim();

    if (!file) {
      statusEl.textContent = 'Selecione um arquivo PDF.';
      return;
    }

    if (!competencia) {
      statusEl.textContent = 'Informe a competência.';
      return;
    }

    const formData = new FormData();
    formData.append('pdf', file);
    formData.append('competencia', competencia);

    try {
      setLoading(true);
      log(`Iniciando envio do PDF "${file.name}" com competência ${competencia}...`);
      statusEl.textContent = 'Enviando arquivo para processamento...';

      const resp = await fetch('/api/separador-holerites-por-empresa', {
        method: 'POST',
        body: formData,
      });

      if (!resp.ok) {
        let errText = 'Erro ao processar arquivo.';
        try {
          const dataErr = await resp.json();
          if (dataErr && dataErr.error) errText = dataErr.error;
        } catch (_) {
          // ignora erro de parse
        }
        statusEl.textContent = errText;
        log(`Falha no processamento: ${errText}`);
        return;
      }

      // Sucesso: receber o ZIP como blob
      const contentDisposition = resp.headers.get('Content-Disposition') || '';
      const matchName = /filename="?([^"]+)"?/.exec(contentDisposition);
      const filename = matchName ? matchName[1] : 'holerites_empresas.zip';

      const blob = await resp.blob();
      ultimoBlobZip = blob;
      ultimoNomeZip = filename;

      statusEl.textContent = 'Processamento concluído com sucesso.';
      resultadoEl.textContent = `Arquivo ZIP gerado: ${filename}`;
      downloadArea.style.display = 'block';
      log(`Processamento concluído. Arquivo ZIP pronto para download: ${filename}`);
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'Erro de comunicação com o servidor.';
      log(`Erro de comunicação com o servidor: ${err}`);
    } finally {
      setLoading(false);
    }
  });

  btnDownloadZip.addEventListener('click', () => {
    if (!ultimoBlobZip) {
      statusEl.textContent = 'Nenhum arquivo ZIP disponível para download.';
      return;
    }

    const url = URL.createObjectURL(ultimoBlobZip);
    const a = document.createElement('a');
    a.href = url;
    a.download = ultimoNomeZip || 'holerites_empresas.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    log(`Download do ZIP efetuado: ${ultimoNomeZip || 'holerites_empresas.zip'}`);
  });
}
