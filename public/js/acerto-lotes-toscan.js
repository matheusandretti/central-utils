// public/js/acerto-lotes-toscan.js

document.addEventListener('DOMContentLoaded', () => {
  // Marca a página atual no menu lateral
  try {
    if (typeof inicializarSidebar === 'function') {
      inicializarSidebar('acerto-lotes-toscan');
    }
  } catch (err) {
    console.warn('Falha ao inicializar sidebar:', err);
  }

  inicializarAcertoLotesToscan();
});

function inicializarAcertoLotesToscan() {
  const form = document.getElementById('toscanForm');
  const fileInput = document.getElementById('toscanFile');
  const statusEl = document.getElementById('toscanStatus');

  const btnDownloadLimpo = document.getElementById('btnDownloadLimpo');
  const btnDownloadRemovidas = document.getElementById('btnDownloadRemovidas');

  const metricTotal = document.getElementById('metricTotalLinhas');
  const metricRemovidas = document.getElementById('metricLinhasRemovidas');
  const metricMantidas = document.getElementById('metricLinhasMantidas');

  const previewRemovidas = document.getElementById('previewRemovidas');

  if (!form || !fileInput) {
    console.warn('Formulário de Acerto Lotes Toscan não encontrado na página.');
    return;
  }

  let blobLimpoUrl = null;
  let blobRemovidasUrl = null;
  let nomeBaseArquivo = 'lancamentos-toscan';

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    if (!fileInput.files || !fileInput.files[0]) {
      atualizarStatus('Selecione um arquivo TXT para processar.', statusEl);
      return;
    }

    const file = fileInput.files[0];
    nomeBaseArquivo = removerExtensao(file.name) || 'lancamentos-toscan';

    // Limpa blobs antigos, se existirem
    if (blobLimpoUrl) {
      URL.revokeObjectURL(blobLimpoUrl);
      blobLimpoUrl = null;
    }
    if (blobRemovidasUrl) {
      URL.revokeObjectURL(blobRemovidasUrl);
      blobRemovidasUrl = null;
    }

    btnDownloadLimpo.disabled = true;
    btnDownloadRemovidas.disabled = true;
    atualizarStatus('Lendo e processando arquivo, aguarde...', statusEl);

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const conteudo = reader.result || '';
        const resultado = processarArquivoToscan(conteudo);

        // Atualiza métricas
        atualizarMetricas(resultado, metricTotal, metricRemovidas, metricMantidas);

        // Atualiza prévia
        atualizarPreview(resultado, previewRemovidas);

        // Cria blobs para download
        const blobLimpo = new Blob([resultado.conteudoMantido], {
          type: 'text/plain;charset=utf-8',
        });
        blobLimpoUrl = URL.createObjectURL(blobLimpo);

        btnDownloadLimpo.disabled = false;
        btnDownloadLimpo.onclick = () => {
          dispararDownload(blobLimpoUrl, `${nomeBaseArquivo}-ajustado-toscan.txt`);
        };

        if (resultado.linhasRemovidas > 0) {
          const blobRemovidas = new Blob([resultado.conteudoRemovido], {
            type: 'text/plain;charset=utf-8',
          });
          blobRemovidasUrl = URL.createObjectURL(blobRemovidas);

          btnDownloadRemovidas.disabled = false;
          btnDownloadRemovidas.onclick = () => {
            dispararDownload(
              blobRemovidasUrl,
              `${nomeBaseArquivo}-linhas-removidas-toscan.txt`
            );
          };

          atualizarStatus(
            `Processamento concluído: ${resultado.linhasRemovidas} linhas removidas.`,
            statusEl
          );
        } else {
          btnDownloadRemovidas.disabled = true;
          btnDownloadRemovidas.onclick = null;

          atualizarStatus(
            'Processamento concluído: nenhuma linha com histórico em branco encontrada.',
            statusEl
          );
        }
      } catch (err) {
        console.error(err);
        atualizarStatus(
          'Erro ao processar o arquivo. Verifique se o TXT está no formato esperado.',
          statusEl
        );
      }
    };

    reader.onerror = () => {
      console.error(reader.error);
      atualizarStatus('Não foi possível ler o arquivo selecionado.', statusEl);
    };

    reader.readAsText(file, 'utf-8');
  });
}

/**
 * Núcleo equivalente ao processar_arquivo do Python.
 *
 * - Normaliza quebras de linha
 * - Remove pares L + H com histórico em branco (regex /^H\s+\d+\s*$/)
 * - Retorna textos das linhas mantidas/removidas e contagens
 */
function processarArquivoToscan(conteudoBruto) {
  if (typeof conteudoBruto !== 'string') {
    conteudoBruto = conteudoBruto ? String(conteudoBruto) : '';
  }

  // Normaliza quebras de linha
  const normalizado = conteudoBruto.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const linhas = normalizado.split('\n');

  // Mesmo padrão do script Python: linha começando com H,
  // depois espaços, e terminando com dígitos (número da linha)
  const PADRAO_HISTORICO_VAZIO = /^H\s+\d+\s*$/;

  const mantidas = [];
  const removidas = [];

  let i = 0;
  while (i < linhas.length) {
    const linhaAtual = linhas[i] ?? '';

    if (linhaAtual.startsWith('L') && i + 1 < linhas.length) {
      const proximaLinha = linhas[i + 1] ?? '';

      if (PADRAO_HISTORICO_VAZIO.test(proximaLinha)) {
        // Remove L e H (adiciona ambas em "removidas")
        removidas.push(linhaAtual, proximaLinha);
        i += 2;
        continue;
      }
    }

    // Caso não tenha entrado na remoção, mantém a linha atual
    mantidas.push(linhaAtual);
    i += 1;
  }

  const conteudoMantido = mantidas.join('\n');
  const conteudoRemovido = removidas.join('\n');

  return {
    conteudoMantido,
    conteudoRemovido,
    totalLinhas: linhas.length,
    linhasRemovidas: removidas.length,
    linhasMantidas: mantidas.length,
  };
}

function atualizarMetricas(resultado, metricTotal, metricRemovidas, metricMantidas) {
  if (metricTotal) {
    metricTotal.textContent = String(resultado.totalLinhas);
  }
  if (metricRemovidas) {
    metricRemovidas.textContent = String(resultado.linhasRemovidas);
  }
  if (metricMantidas) {
    metricMantidas.textContent = String(resultado.linhasMantidas);
  }
}

function atualizarPreview(resultado, previewEl) {
  if (!previewEl) return;

  if (!resultado.conteudoRemovido || resultado.linhasRemovidas === 0) {
    previewEl.textContent =
      'Nenhuma linha removida (nenhum histórico em branco encontrado).';
    return;
  }

  const linhasPreview = resultado.conteudoRemovido.split('\n').slice(0, 100);
  previewEl.textContent = linhasPreview.join('\n');
}

function atualizarStatus(mensagem, el) {
  if (!el) return;
  el.textContent = mensagem;
}

function dispararDownload(url, nomeArquivo) {
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function removerExtensao(nomeArquivo) {
  if (!nomeArquivo) return '';
  const lastDot = nomeArquivo.lastIndexOf('.');
  if (lastDot <= 0) return nomeArquivo;
  return nomeArquivo.substring(0, lastDot);
}
