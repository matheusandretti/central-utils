// public/js/nfe.js

document.addEventListener('DOMContentLoaded', function () {
  // Inicializa a sidebar com a página atual (id "nfe" definido no sidebar.js)
  if (typeof inicializarSidebar === 'function') {
    inicializarSidebar('nfe');
  }

  // ------------------ INÍCIO DA LÓGICA ORIGINAL DA NF-E ------------------

  const socket = io();

  const jobsTableBody = document.getElementById('jobsTableBody');
  const uploadForm = document.getElementById('uploadForm');
  const uploadMessage = document.getElementById('uploadMessage');
  const captchaNotification = document.getElementById('captchaNotification');

  const btnUpload = document.getElementById('btnUpload');

  const cards = {
    pending: document.getElementById('cardPending'),
    processing: document.getElementById('cardProcessing'),
    waiting_captcha: document.getElementById('cardWaitingCaptcha'),
    done: document.getElementById('cardDone'),
    error: document.getElementById('cardError'),
  };

  // Botão / status da extensão e URL do portal
  const btnOpenPortal = document.getElementById('btnOpenPortal');
  const extStatus = document.getElementById('extStatus');
  const PORTAL_CONSULTA_URL =
    'https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g=';

  // Controle de extensão / fila
  let lastSummary = null;
  let extensionStatusKnown = false;
  let extensionAvailable = false;

  // ---- Controles de limpar filas ----
  const btnClearPending = document.getElementById('btnClearPending');
  const btnClearDone = document.getElementById('btnClearDone');
  const btnClearErrors = document.getElementById('btnClearErrors');

  // ----------- FUNÇÃO DE LOADING DO UPLOAD -----------

  function setUploadLoading(isLoading) {
    if (!btnUpload) return;
    if (isLoading) {
      btnUpload.disabled = true;
      btnUpload.textContent = 'Enviando...';
    } else {
      btnUpload.disabled = false;
      btnUpload.textContent = 'Enviar arquivo';
    }
  }

  if (uploadForm) {
    uploadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      uploadMessage.textContent = 'Enviando...';
      setUploadLoading(true);

      const formData = new FormData(uploadForm);

      try {
        const resp = await fetch('/upload', {
          method: 'POST',
          body: formData,
        });
        const data = await resp.json();
        if (resp.ok) {
          uploadMessage.textContent = data.message || 'Upload concluído.';
        } else {
          uploadMessage.textContent = data.error || 'Erro no upload.';
        }
      } catch (err) {
        uploadMessage.textContent = 'Erro de comunicação com o servidor.';
      } finally {
        setUploadLoading(false);
      }
    });
  }

  // Clique no botão para abrir o portal em nova aba
  if (btnOpenPortal) {
    btnOpenPortal.addEventListener('click', () => {
      window.open(PORTAL_CONSULTA_URL, '_blank');
    });
  }

  function renderSummary(summary) {
    cards.pending.textContent = summary.pending;
    cards.processing.textContent = summary.processing;
    cards.waiting_captcha.textContent = summary.waiting_captcha;
    cards.done.textContent = summary.done;
    cards.error.textContent = summary.error;

    // mostra aviso de captcha se tiver pelo menos um
    captchaNotification.style.display =
      summary.waiting_captcha > 0 ? 'block' : 'none';
  }

  function renderJobs(jobs) {
    jobsTableBody.innerHTML = '';
    jobs
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .forEach((job) => {
        const tr = document.createElement('tr');

        const statusLabel = {
          pending: 'Pendente',
          processing: 'Processando',
          waiting_captcha: 'Aguardando Captcha',
          done: 'Concluído',
          error: 'Erro',
        }[job.status] || job.status;

        tr.innerHTML = `
          <td>${job.key}</td>
          <td>${statusLabel}</td>
          <td>${job.errorMessage || ''}</td>
          <td>${new Date(job.updatedAt).toLocaleString('pt-BR')}</td>
        `;
        jobsTableBody.appendChild(tr);
      });
  }

  // Gera o HTML com instruções de instalação quando a extensão NÃO é encontrada
  function gerarHtmlInstrucoesExtensao() {
    return `
      Extensão NFe Helper <strong>não encontrada</strong> neste navegador.<br><br>

      <strong>1) Baixar extensão (uso interno):</strong><br>
      - <a href="/extensao-nfe-helper.zip" download>Baixar arquivo extensao-nfe-helper.zip</a><br>
      - Descompacte o .zip em uma pasta qualquer (ex.: Documentos\\NFeHelper).<br><br>

      <strong>2) Instalar no Chrome (Windows):</strong><br>
      1. Abra <code>chrome://extensions</code> na barra de endereços.<br>
      2. Ative a opção <em>"Modo do desenvolvedor"</em> (canto superior direito).<br>
      3. Clique em <em>"Carregar sem compactação"</em>.<br>
      4. Selecione a pasta onde você descompactou a extensão.<br><br>

      <strong>3) Instalar no Firefox (uso manual):</strong><br>
      1. Abra <code>about:debugging</code> na barra de endereços.<br>
      2. Clique em <em>"Este Firefox"</em>.<br>
      3. Clique em <em>"Carregar add-on temporário"</em>.<br>
      4. Escolha o arquivo <code>manifest.json</code> dentro da pasta da extensão.<br>
      (para uso permanente, o ideal é configurar uma distribuição interna ou assinar o add-on).<br><br>

      Após instalar, recarregue esta página (F5) para que o painel reconheça a extensão.
    `;
  }

  function atualizarEstadoExtensaoESbotao(summary) {
    lastSummary = summary;

    const haPendentes = summary.pending > 0;

    if (!haPendentes) {
      // sem chaves pendentes, não faz sentido abrir portal
      btnOpenPortal.disabled = true;
      extStatus.textContent = 'Nenhuma chave pendente na fila.';
      return;
    }

    // já sabemos o status da extensão? só atualiza botão
    if (extensionStatusKnown) {
      btnOpenPortal.disabled = !extensionAvailable;
      return;
    }

    // primeira vez com pendentes: vamos checar a extensão
    extStatus.textContent = 'Verificando extensão NFe Helper...';
    btnOpenPortal.disabled = true;

    detectarExtensaoNFeHelper().then((ok) => {
      extensionStatusKnown = true;
      extensionAvailable = ok;

      if (ok) {
        extStatus.textContent =
          'Extensão NFe Helper detectada. Clique em "Iniciar consultas no Portal NF-e".';
        btnOpenPortal.disabled = false;
      } else {
        extStatus.innerHTML = gerarHtmlInstrucoesExtensao();
        btnOpenPortal.disabled = true;
      }
    });
  }

  socket.on('queue_update', ({ summary, jobs }) => {
    renderSummary(summary);
    renderJobs(jobs);
    atualizarEstadoExtensaoESbotao(summary);
  });

  socket.on('job_update', (job) => {
    // opcional, se quiser tratar job a job
  });

  // Função de detecção da extensão (PING/PONG)
  function detectarExtensaoNFeHelper(timeoutMs = 800) {
    return new Promise((resolve) => {
      let respondeu = false;

      function handler(event) {
        if (event.source !== window) return;
        if (!event.data || event.data.type !== 'NFE_HELPER_PONG') return;
        respondeu = true;
        window.removeEventListener('message', handler);
        resolve(true);
      }

      window.addEventListener('message', handler);

      // envia o PING
      window.postMessage({ type: 'NFE_HELPER_PING' }, '*');

      // se ninguém responder, consideramos que a extensão não está instalada
      setTimeout(() => {
        if (!respondeu) {
          window.removeEventListener('message', handler);
          resolve(false);
        }
      }, timeoutMs);
    });
  }

  // ---- Botão "Limpar pendentes" ----
  if (btnClearPending) {
    btnClearPending.addEventListener('click', async () => {
      if (
        !confirm(
          'Tem certeza que deseja REMOVER TODAS as chaves pendentes/processando da fila?'
        )
      ) {
        return;
      }

      try {
        const resp = await fetch('/api/clear-pending', { method: 'POST' });
        const data = await resp.json();

        if (data.ok) {
          alert('Chaves pendentes/processando removidas da fila.');
        } else {
          alert('Erro: ' + (data.error || 'Falha desconhecida'));
        }
      } catch (err) {
        alert('Erro ao comunicar com o servidor.');
      }
    });
  }

  // ---- Botão "Limpar concluídos" ----
  if (btnClearDone) {
    btnClearDone.addEventListener('click', async () => {
      if (
        !confirm(
          'Tem certeza que deseja remover TODOS os registros concluídos da fila?'
        )
      ) {
        return;
      }

      try {
        const resp = await fetch('/api/clear-done', { method: 'POST' });
        const data = await resp.json();

        if (data.ok) {
          alert('Registros concluídos removidos da fila.');
        } else {
          alert('Erro: ' + (data.error || 'Falha desconhecida'));
        }
      } catch (err) {
        alert('Erro ao comunicar com o servidor.');
      }
    });
  }

  // ---- Botão "Limpar erros" ----
  if (btnClearErrors) {
    btnClearErrors.addEventListener('click', async () => {
      if (
        !confirm(
          'Tem certeza que deseja remover TODOS os registros com erro da fila?'
        )
      ) {
        return;
      }

      try {
        const resp = await fetch('/api/clear-errors', { method: 'POST' });
        const data = await resp.json();

        if (data.ok) {
          alert('Registros com erro removidos da fila.');
        } else {
          alert('Erro: ' + (data.error || 'Falha desconhecida'));
        }
      } catch (err) {
        alert('Erro ao comunicar com o servidor.');
      }
    });
  }
});
