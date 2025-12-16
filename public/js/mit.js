// public/js/mit.js

document.addEventListener('DOMContentLoaded', () => {
  // ID precisa existir em MENU_CONFIG dentro de sidebar.js
  inicializarSidebar('mit');
  inicializarPaginaMitEnvio();
});

function inicializarPaginaMitEnvio() {
  const form = document.getElementById('mitForm');
  const fileInput = document.getElementById('mitFileInput');
  const statusDiv = document.getElementById('mitStatus');
  const logPre = document.getElementById('mitLog');
  const submitBtn = document.getElementById('mitSubmitBtn');

  if (!form || !fileInput) {
    console.error('[MIT] Elementos de formulário não encontrados na página.');
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!fileInput.files || fileInput.files.length === 0) {
      statusDiv.textContent = 'Selecione um arquivo JSON antes de enviar.';
      return;
    }

    const arquivo = fileInput.files[0];
    const formData = new FormData();
    formData.append('arquivo', arquivo);

    statusDiv.textContent = 'Enviando arquivo para o Integra Contador (MIT)...';
    if (logPre) logPre.textContent = '';
    if (submitBtn) submitBtn.disabled = true;

    try {
      const resposta = await fetch('/api/mit/enviar-declaracao', {
        method: 'POST',
        body: formData
      });

      let data;
      try {
        data = await resposta.json();
      } catch {
        data = null;
      }

      if (!resposta.ok || !data || data.ok === false) {
        const msgErro =
          (data && data.error) ||
          (data && data.detalhe) ||
          `Erro HTTP ${resposta.status}`;
        statusDiv.textContent = `Erro ao enviar apuração: ${msgErro}`;

        if (logPre) {
          logPre.textContent = JSON.stringify(
            data || { error: msgErro },
            null,
            2
          );
        }
        return;
      }

      // Sucesso
      if (data.sucessoEncerramento) {
        statusDiv.textContent =
          'Apuração enviada com sucesso e marcada para encerramento automático na DCTFWeb.';
      } else {
        statusDiv.textContent =
          'Requisição MIT concluída. Verifique as mensagens de retorno.';
      }

      const resumo = {
        statusHttp: data.serproStatus,
        responseId: data.serproResponseId,
        protocoloEncerramento: data.protocoloEncerramento || null,
        idApuracao: data.idApuracao || null,
        mensagens: data.serproMensagens || [],
        payloadResumo: data.payloadResumo || null
      };

      if (logPre) {
        logPre.textContent = JSON.stringify(
          {
            resumo,
            serproRaw: data.serproRaw || null,
            erroSerpro: data.serproErro || null
          },
          null,
          2
        );
      }
    } catch (err) {
      console.error('[MIT] Erro na chamada /api/mit/enviar-declaracao:', err);
      statusDiv.textContent =
        'Erro inesperado ao enviar apuração para o MIT. Veja detalhes no console.';

      if (logPre) {
        logPre.textContent = String(err && err.message
          ? err.message
          : err || 'Erro desconhecido');
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}
