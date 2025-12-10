// public/js/ajuste-diario-gfbr.js

document.addEventListener('DOMContentLoaded', () => {
    inicializarSidebar('ajuste-diario-gfbr');
    inicializarPaginaAjusteDiarioGfbr();
});

let ajusteProgressInterval = null;

function inicializarPaginaAjusteDiarioGfbr() {
    const form = document.getElementById('formAjusteDiarioGfbr');
    const statusEl = document.getElementById('ajusteStatus');
    const btnDownload = document.getElementById('btnDownloadAjustado');
    const btnDownloadBackup = document.getElementById('btnDownloadBackup');
    const btnProcessar = document.getElementById('btnProcessarAjuste');

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

    if (form) {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();

            if (!statusEl) return;

            const fileInput = document.getElementById('arquivoDiario');
            if (!fileInput || !fileInput.files || !fileInput.files.length) {
                statusEl.textContent = 'Selecione um arquivo .xlsx antes de processar.';
                return;
            }

            statusEl.textContent = 'Processando diário...';
            resetarMetricas();
            iniciarProgresso();

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

            const abaOrigemInput = document.getElementById('abaOrigem');
            const abaOrigem = abaOrigemInput ? (abaOrigemInput.value || '').trim() : '';
            if (abaOrigem) {
                formData.append('abaOrigem', abaOrigem);
            }

            const criarBackupCheckbox = document.getElementById('criarBackup');
            const criarBackup =
                criarBackupCheckbox && criarBackupCheckbox.checked ? 'true' : 'false';
            formData.append('criarBackup', criarBackup);

            let sucesso = false;

            try {
                const response = await fetch('/api/ajuste-diario-gfbr/processar', {
                    method: 'POST',
                    body: formData,
                });

                let data = null;
                try {
                    data = await response.json();
                } catch (parseErr) {
                    throw new Error('Não foi possível interpretar a resposta do servidor.');
                }

                if (!response.ok || !data || data.error || !data.ok) {
                    const msg = (data && data.error) || 'Erro ao processar o diário.';
                    throw new Error(msg);
                }

                sucesso = true;

                statusEl.textContent =
                    data.message || 'Processamento concluído com sucesso.';

                if (data.resumo) {
                    atualizarResumoAjuste(data.resumo);
                }

                // habilita botão de download do diário ajustado
                if (btnDownload && data.downloadUrl) {
                    btnDownload.disabled = false;
                    btnDownload.classList.remove('btn-secondary');
                    btnDownload.classList.add('btn-primary');
                    btnDownload.dataset.downloadUrl = data.downloadUrl;
                }

                // habilita botão de download do backup, se existir
                if (btnDownloadBackup) {
                    if (data.backupDownloadUrl) {
                        btnDownloadBackup.disabled = false;
                        btnDownloadBackup.dataset.downloadUrl = data.backupDownloadUrl;
                    } else {
                        btnDownloadBackup.disabled = true;
                        btnDownloadBackup.dataset.downloadUrl = '';
                    }
                }
            } catch (err) {
                console.error(err);
                statusEl.textContent =
                    err.message || 'Erro inesperado ao processar o diário.';
                resetarMetricas();
            } finally {
                finalizarProgresso(sucesso);
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

// Barra de progresso “fake”: vai até ~90% enquanto o backend trabalha
function iniciarProgresso() {
    const container = document.getElementById('ajusteProgressContainer');
    const fill = document.getElementById('ajusteProgressFill');
    const text = document.getElementById('ajusteProgressText');

    if (!container || !fill || !text) return;

    container.style.display = 'flex';
    let pct = 0;
    fill.style.width = '0%';
    text.textContent = '0%';

    if (ajusteProgressInterval) {
        clearInterval(ajusteProgressInterval);
    }

    ajusteProgressInterval = setInterval(() => {
        pct += 2;
        if (pct >= 90) {
            pct = 90;
            clearInterval(ajusteProgressInterval);
            ajusteProgressInterval = null;
        }
        fill.style.width = pct + '%';
        text.textContent = pct + '%';
    }, 300);
}

function finalizarProgresso(sucesso) {
    const container = document.getElementById('ajusteProgressContainer');
    const fill = document.getElementById('ajusteProgressFill');
    const text = document.getElementById('ajusteProgressText');

    if (ajusteProgressInterval) {
        clearInterval(ajusteProgressInterval);
        ajusteProgressInterval = null;
    }

    if (!container || !fill || !text) return;

    if (sucesso) {
        fill.style.width = '100%';
        text.textContent = '100%';
        setTimeout(() => {
            container.style.display = 'none';
        }, 800);
    } else {
        container.style.display = 'none';
    }
}

function atualizarResumoAjuste(resumo) {
    const total = resumo.total_rows ?? 0;
    const finais = resumo.rows_final ?? 0;
    const removidas = resumo.rows_removed ?? 0;
    const estornos = resumo.num_linhas_estornos ?? 0;

    const metricTotal = document.getElementById('metricTotalLinhas');
    const metricFinais = document.getElementById('metricLinhasFinais');
    const metricRemovidas = document.getElementById('metricLinhasRemovidas');
    const metricEstornos = document.getElementById('metricLinhasEstornos');

    if (metricTotal) metricTotal.textContent = String(total);
    if (metricFinais) metricFinais.textContent = String(finais);
    if (metricRemovidas) metricRemovidas.textContent = String(removidas);
    if (metricEstornos) metricEstornos.textContent = String(estornos);

    const tabelaBody = document.querySelector('#ajusteTabelaResumo tbody');
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
            ['Backup criado', resumo.backup_path ? 'Sim' : 'Não'],
            ['Caminho do backup', resumo.backup_path || '-'],
            ['Mensagem', resumo.mensagem || '-'],
        ];

        linhas.forEach(([nome, valor]) => {
            const tr = document.createElement('tr');
            const tdNome = document.createElement('td');
            const tdValor = document.createElement('td');
            tdNome.textContent = nome;
            tdValor.textContent = valor;
            tr.appendChild(tdNome);
            tr.appendChild(tdValor);
            tabelaBody.appendChild(tr);
        });
    }

    const backupInfo = document.getElementById('ajusteBackupInfo');
    if (backupInfo) {
        backupInfo.textContent = resumo.backup_path
            ? `Backup criado em: ${resumo.backup_path}`
            : 'Backup não criado para este processamento.';
    }
}

function resetarMetricas() {
  const ids = [
    'metricTotalLinhas',
    'metricLinhasFinais',
    'metricLinhasRemovidas',
    'metricLinhasEstornos',
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = '0';
    }
  });

  const tabelaBody = document.querySelector('#ajusteTabelaResumo tbody');
  if (tabelaBody) {
    tabelaBody.innerHTML = '';
  }

  const backupInfo = document.getElementById('ajusteBackupInfo');
  if (backupInfo) {
    backupInfo.textContent = '';
  }

  const container = document.getElementById('ajusteProgressContainer');
  if (container) {
    container.style.display = 'none';
  }

  // 🔹 TAMBÉM RESETA OS BOTÕES DE DOWNLOAD
  const btnDownload = document.getElementById('btnDownloadAjustado');
  if (btnDownload) {
    btnDownload.disabled = true;
    btnDownload.dataset.downloadUrl = '';
    btnDownload.classList.remove('btn-primary');
    btnDownload.classList.add('btn-secondary');
  }

  const btnDownloadBackup = document.getElementById('btnDownloadBackup');
  if (btnDownloadBackup) {
    btnDownloadBackup.disabled = true;
    btnDownloadBackup.dataset.downloadUrl = '';
  }
}

