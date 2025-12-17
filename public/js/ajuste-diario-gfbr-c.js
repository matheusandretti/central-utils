// public/js/ajuste-diario-gfbr-c.js

document.addEventListener('DOMContentLoaded', () => {
  inicializarSidebar('ajuste-diario-gfbr-c');
  inicializarPaginaAjusteDiarioGfbrC();
});

let ajusteProgressIntervalC = null;

function inicializarPaginaAjusteDiarioGfbrC() {
  const form = document.getElementById('formAjusteDiarioGfbrC');
  const statusEl = document.getElementById('ajusteStatusC');
  const btnDownload = document.getElementById('btnDownloadAjustadoC');
  const btnDownloadBackup = document.getElementById('btnDownloadBackupC');
  const btnProcessar = document.getElementById('btnProcessarAjusteC');

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!statusEl) return;

      const fileInput = document.getElementById('arquivoDiarioC');
      if (!fileInput || !fileInput.files || !fileInput.files.length) {
        statusEl.textContent = 'Selecione um arquivo .xlsx antes de processar.';
        return;
      }

      statusEl.textContent = 'Processando diário...';
      resetarMetricasC();
      iniciarProgressoC();

      // desabilita botões
      if (btnDownload) {
        btnDownload.disabled = true;
        btnDownload.dataset.downloadUrl = '';
        btnDownload.classList.remove('btn-primary');
        btnDownload.classList.add('btn-secondary');
      }
      if (btnDownloadBackup) {
        btnDownloadBackup.disabled = true;
        btnDownloadBackup.dataset.downloadUrl = '';
      }
      if (btnProcessar) {
        btnProcessar.disabled = true;
        btnProcessar.textContent = 'Processando...';
      }

      const formData = new FormData();
      formData.append('arquivoDiario', fileInput.files[0]);

      const abaOrigemInput = document.getElementById('abaOrigemC');
      const abaOrigem = abaOrigemInput ? (abaOrigemInput.value || '').trim() : '';
      if (abaOrigem) formData.append('abaOrigem', abaOrigem);

      const criarBackupCheckbox = document.getElementById('criarBackupC');
      const criarBackup = criarBackupCheckbox && criarBackupCheckbox.checked ? 'true' : 'false';
      formData.append('criarBackup', criarBackup);

      let sucesso = false;

      try {
        const response = await fetch('/api/ajuste-diario-gfbr-c/processar', {
          method: 'POST',
          body: formData,
        });

        let data = null;
        try {
          data = await response.json();
        } catch (_) {
          throw new Error('Não foi possível interpretar a resposta do servidor.');
        }

        if (!response.ok || !data || data.error || data.ok === false) {
          throw new Error((data && data.error) || 'Erro ao processar o diário.');
        }

        sucesso = true;
        statusEl.textContent = data.message || 'Processamento concluído com sucesso.';

        // resumo
        const resumo = data.resumo || data.resultado || null;
        if (resumo) atualizarResumoAjusteC(resumo);

        // NOVO: URLs separadas (ajustado/backup)
        const downloadAjustado =
          data.download_url_ajustado ||
          (data.download_id
            ? `/api/ajuste-diario-gfbr-c/download/ajustado/${encodeURIComponent(data.download_id)}`
            : '');

        const downloadBackup =
          data.download_url_backup ||
          (data.download_id
            ? `/api/ajuste-diario-gfbr-c/download/backup/${encodeURIComponent(data.download_id)}`
            : '');

        if (btnDownload && downloadAjustado) {
          btnDownload.disabled = false;
          btnDownload.classList.remove('btn-secondary');
          btnDownload.classList.add('btn-primary');
          btnDownload.dataset.downloadUrl = downloadAjustado;
        }

        // só habilita backup se backend realmente devolveu URL de backup
        if (btnDownloadBackup && downloadBackup && downloadBackup !== '') {
          btnDownloadBackup.disabled = false;
          btnDownloadBackup.dataset.downloadUrl = downloadBackup;
        } else if (btnDownloadBackup) {
          btnDownloadBackup.disabled = true;
          btnDownloadBackup.dataset.downloadUrl = '';
        }
      } catch (err) {
        console.error(err);
        statusEl.textContent = err?.message || 'Erro inesperado ao processar.';
      } finally {
        finalizarProgressoC(sucesso);
        if (btnProcessar) {
          btnProcessar.disabled = false;
          btnProcessar.textContent = 'Processar diário';
        }
      }
    });
  }

  if (btnDownload) {
    btnDownload.addEventListener('click', () => {
      const url = btnDownload.dataset.downloadUrl;
      if (!url) return;
      window.open(url, '_blank');
    });
  }

  if (btnDownloadBackup) {
    btnDownloadBackup.addEventListener('click', () => {
      const url = btnDownloadBackup.dataset.downloadUrl;
      if (!url) return;
      window.open(url, '_blank');
    });
  }
}

function iniciarProgressoC() {
  const container = document.getElementById('ajusteProgressContainerC');
  const fill = document.getElementById('ajusteProgressFillC');
  const text = document.getElementById('ajusteProgressTextC');

  if (ajusteProgressIntervalC) {
    clearInterval(ajusteProgressIntervalC);
    ajusteProgressIntervalC = null;
  }
  if (!container || !fill || !text) return;

  container.style.display = 'flex';
  container.classList.remove('ajuste-progress-hidden');

  let pct = 0;
  fill.style.width = '0%';
  text.textContent = '0%';

  ajusteProgressIntervalC = setInterval(() => {
    pct += 2;
    if (pct >= 90) {
      pct = 90;
      clearInterval(ajusteProgressIntervalC);
      ajusteProgressIntervalC = null;
    }
    fill.style.width = pct + '%';
    text.textContent = pct + '%';
  }, 300);
}

function finalizarProgressoC(sucesso) {
  const container = document.getElementById('ajusteProgressContainerC');
  const fill = document.getElementById('ajusteProgressFillC');
  const text = document.getElementById('ajusteProgressTextC');

  if (ajusteProgressIntervalC) {
    clearInterval(ajusteProgressIntervalC);
    ajusteProgressIntervalC = null;
  }
  if (!container || !fill || !text) return;

  if (sucesso) {
    fill.style.width = '100%';
    text.textContent = '100%';
    setTimeout(() => {
      container.style.display = 'none';
      container.classList.add('ajuste-progress-hidden');
    }, 600);
  } else {
    container.style.display = 'none';
    container.classList.add('ajuste-progress-hidden');
  }
}

function atualizarResumoAjusteC(resumo) {
  const total = resumo.total_rows ?? 0;
  const finais = resumo.rows_final ?? 0;
  const removidas = resumo.rows_removed ?? 0;
  const estornos = resumo.num_linhas_estornos ?? 0;

  const metricTotal = document.getElementById('metricTotalLinhasC');
  const metricFinais = document.getElementById('metricLinhasFinaisC');
  const metricRemovidas = document.getElementById('metricLinhasRemovidasC');
  const metricEstornos = document.getElementById('metricLinhasEstornosC');

  if (metricTotal) metricTotal.textContent = String(total);
  if (metricFinais) metricFinais.textContent = String(finais);
  if (metricRemovidas) metricRemovidas.textContent = String(removidas);
  if (metricEstornos) metricEstornos.textContent = String(estornos);

  const tabelaBody = document.querySelector('#ajusteTabelaResumoC tbody');
  if (tabelaBody) {
    tabelaBody.innerHTML = '';

    const linhas = [
      ['Aba utilizada', resumo.aba_utilizada || '-'],
      [
        'Grupos de recebimento removidos',
        resumo.num_grupos_recebimento_removidos != null
          ? String(resumo.num_grupos_recebimento_removidos)
          : '-',
      ],
      [
        'Grupos removidos por palavras-chave',
        resumo.num_grupos_palavra_removidos != null
          ? String(resumo.num_grupos_palavra_removidos)
          : '-',
      ],
      ['Mensagem', resumo.mensagem || '-'],
    ];

    linhas.forEach(([k, v]) => {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      const td2 = document.createElement('td');
      td1.textContent = k;
      td2.textContent = v;
      tr.appendChild(td1);
      tr.appendChild(td2);
      tabelaBody.appendChild(tr);
    });
  }

  // NOVO: não mostrar caminho completo (backend pode mandar só o nome)
  const backupInfo = document.getElementById('ajusteBackupInfoC');
  if (backupInfo) {
    const bp = (resumo.backup_path || '').trim();
    backupInfo.textContent = bp ? `Backup criado: ${bp}` : 'Backup não criado para este processamento.';
  }
}

function resetarMetricasC() {
  const ids = [
    'metricTotalLinhasC',
    'metricLinhasFinaisC',
    'metricLinhasRemovidasC',
    'metricLinhasEstornosC',
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '0';
  });

  const tabelaBody = document.querySelector('#ajusteTabelaResumoC tbody');
  if (tabelaBody) tabelaBody.innerHTML = '';

  const backupInfo = document.getElementById('ajusteBackupInfoC');
  if (backupInfo) backupInfo.textContent = '';

  const btnDownload = document.getElementById('btnDownloadAjustadoC');
  if (btnDownload) {
    btnDownload.disabled = true;
    btnDownload.dataset.downloadUrl = '';
    btnDownload.classList.remove('btn-primary');
    btnDownload.classList.add('btn-secondary');
  }

  const btnDownloadBackup = document.getElementById('btnDownloadBackupC');
  if (btnDownloadBackup) {
    btnDownloadBackup.disabled = true;
    btnDownloadBackup.dataset.downloadUrl = '';
  }
}
