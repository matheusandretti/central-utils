// public/js/sn.js

document.addEventListener('DOMContentLoaded', () => {
  // Inicializa a sidebar compartilhada marcando esta página como ativa
  if (typeof inicializarSidebar === 'function') {
    inicializarSidebar('sn');
  }

  // Referências principais
  const paMes = document.getElementById('paMes');
  const paAno = document.getElementById('paAno');
  const btnEnviarDecl = document.getElementById('btnEnviarDecl');
  const btnConsultarRecibos = document.getElementById('btnConsultarRecibos');
  const snStatus = document.getElementById('snStatus');
  const consumoInfo = document.getElementById('consumoInfo');
  const resultsTbody = document.querySelector('#snResultsTable tbody');

  const companiesDropdown = document.getElementById('companiesDropdown');
  const companiesDropdownLabel = document.getElementById('companiesDropdownLabel');
  const companiesOptions = document.getElementById('companiesOptions');

  const openCompanyModalBtn = document.getElementById('openCompanyModal');
  const companyModal = document.getElementById('companyModal');
  const companyModalOverlay = document.getElementById('companyModalOverlay');
  const closeCompanyModalBtn = document.getElementById('closeCompanyModal');
  const snCompanyForm = document.getElementById('snCompanyForm');
  const snCompanyMessage = document.getElementById('snCompanyMessage');

  const btnDownloadTodos = document.getElementById('btnDownloadTodosRecibos');

  let isSending = false;
  let selectedCompanyIds = new Set();
  let selectAllCompanies = false;
  let lastSnResults = null;

  function setSending(flag) {
    isSending = flag;
    if (btnEnviarDecl) btnEnviarDecl.disabled = flag;
    if (btnConsultarRecibos) btnConsultarRecibos.disabled = flag;
    if (btnEnviarDecl) btnEnviarDecl.textContent = flag ? 'Enviando...' : 'Enviar declarações';
    if (btnConsultarRecibos) btnConsultarRecibos.textContent = flag ? 'Consultando...' : 'Consultar últimos recibos';
  }

  // Preencher anos (ano atual - 5 até ano atual + 1)
  (function preencherAnos() {
    if (!paAno) return;
    const anoAtual = new Date().getFullYear();
    const minAno = anoAtual - 5;
    const maxAno = anoAtual + 1;
    paAno.innerHTML = '<option value="">Selecione</option>';
    for (let a = maxAno; a >= minAno; a--) {
      const opt = document.createElement('option');
      opt.value = String(a);
      opt.textContent = String(a);
      paAno.appendChild(opt);
    }
  })();

  // Modal de cadastro
  function openCompanyModal() {
    if (!companyModal || !snCompanyMessage) return;
    snCompanyMessage.textContent = '';
    snCompanyMessage.style.color = '';
    const cadCnpj = document.getElementById('cadCnpj');
    const cadRazao = document.getElementById('cadRazao');
    if (cadCnpj) cadCnpj.value = '';
    if (cadRazao) cadRazao.value = '';
    companyModal.classList.remove('hidden');
  }

  function closeCompanyModal() {
    if (!companyModal) return;
    companyModal.classList.add('hidden');
  }

  if (openCompanyModalBtn) openCompanyModalBtn.addEventListener('click', openCompanyModal);
  if (companyModalOverlay) companyModalOverlay.addEventListener('click', closeCompanyModal);
  if (closeCompanyModalBtn) closeCompanyModalBtn.addEventListener('click', closeCompanyModal);

  // Multi-select de empresas
  function atualizarLabelEmpresas() {
    if (!companiesDropdownLabel) return;
    if (selectAllCompanies) {
      companiesDropdownLabel.textContent = 'Todas as empresas selecionadas';
    } else if (selectedCompanyIds.size === 0) {
      companiesDropdownLabel.textContent = 'Selecione as empresas';
    } else if (selectedCompanyIds.size === 1) {
      companiesDropdownLabel.textContent = '1 empresa selecionada';
    } else {
      companiesDropdownLabel.textContent = selectedCompanyIds.size + ' empresas selecionadas';
    }
  }

  function toggleCompaniesOptions() {
    if (!companiesOptions) return;
    companiesOptions.classList.toggle('open');
  }

  if (companiesDropdown) {
    companiesDropdown.addEventListener('click', toggleCompaniesOptions);
  }

  document.addEventListener('click', function (e) {
    if (!companiesOptions || !companiesDropdown) return;
    if (!companiesOptions.contains(e.target) && !companiesDropdown.contains(e.target)) {
      companiesOptions.classList.remove('open');
    }
  });

  async function carregarEmpresas() {
    if (!companiesOptions) return;
    try {
      const resp = await fetch('/api/sn/companies');
      if (!resp.ok) return;
      const empresas = await resp.json();

      companiesOptions.innerHTML = '';

      // opção "Todos"
      const labelAll = document.createElement('label');
      labelAll.className = 'multi-select-option';
      const checkAll = document.createElement('input');
      checkAll.type = 'checkbox';
      checkAll.value = 'all';
      checkAll.addEventListener('change', function () {
        selectAllCompanies = checkAll.checked;
        selectedCompanyIds.clear();

        const checks = companiesOptions.querySelectorAll('input[type="checkbox"]');
        checks.forEach((c) => {
          if (c === checkAll) return;
          c.checked = selectAllCompanies;
          if (selectAllCompanies) {
            selectedCompanyIds.add(Number(c.value));
          }
        });

        atualizarLabelEmpresas();
      });

      labelAll.appendChild(checkAll);
      labelAll.appendChild(document.createTextNode(' Todos'));
      companiesOptions.appendChild(labelAll);

      // demais empresas
      empresas.forEach((emp) => {
        const lbl = document.createElement('label');
        lbl.className = 'multi-select-option';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.value = emp.id;
        chk.addEventListener('change', function () {
          const id = Number(chk.value);
          if (chk.checked) {
            selectedCompanyIds.add(id);
          } else {
            selectedCompanyIds.delete(id);
          }
          // se desmarcar alguma, desmarca "Todos"
          if (!chk.checked && selectAllCompanies) {
            selectAllCompanies = false;
            checkAll.checked = false;
          }
          atualizarLabelEmpresas();
        });

        lbl.appendChild(chk);
        lbl.appendChild(document.createTextNode(' ' + emp.razaoSocial + ' (' + emp.cnpj + ')'));
        companiesOptions.appendChild(lbl);
      });

      atualizarLabelEmpresas();
    } catch (e) {
      console.error('Erro ao carregar empresas SN:', e);
    }
  }

  // Cadastro de empresa (modal)
  if (snCompanyForm) {
    snCompanyForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!snCompanyMessage) return;
      snCompanyMessage.textContent = '';
      snCompanyMessage.style.color = '';

      const cnpjInput = document.getElementById('cadCnpj');
      const razaoInput = document.getElementById('cadRazao');
      const cnpj = cnpjInput ? cnpjInput.value.trim() : '';
      const razaoSocial = razaoInput ? razaoInput.value.trim() : '';

      if (!cnpj || !razaoSocial) {
        snCompanyMessage.textContent = 'Preencha CNPJ e Razão Social.';
        snCompanyMessage.style.color = 'red';
        return;
      }

      try {
        const resp = await fetch('/api/sn/companies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cnpj, razaoSocial }),
        });

        const data = await resp.json();

        if (!resp.ok) {
          snCompanyMessage.textContent = data.error || 'Erro ao cadastrar empresa.';
          snCompanyMessage.style.color = 'red';
          return;
        }

        snCompanyMessage.textContent = 'Empresa cadastrada com sucesso.';
        snCompanyMessage.style.color = 'green';

        // recarrega lista do dropdown
        await carregarEmpresas();
        atualizarLabelEmpresas();
      } catch (e) {
        console.error(e);
        snCompanyMessage.textContent = 'Falha na comunicação com o servidor.';
        snCompanyMessage.style.color = 'red';
      }
    });
  }

  // Resumo de consumo
  function atualizarResumoConsumo(resumo) {
    if (!consumoInfo || !resumo) return;

    const consumoAtual = resumo.consumoAtual || 0;
    const totalDecl = resumo.totalDeclaracoes || 0;
    const totalCons = resumo.totalConsultas || 0;
    const totalSucesso = resumo.totalSucesso || 0;
    const totalErro = resumo.totalErro || 0;

    const precoUnitario =
      typeof resumo.precoUnitario === 'number' ? resumo.precoUnitario.toFixed(2) : '0,00';

    const valorTotal =
      typeof resumo.valorTotal === 'number' ? resumo.valorTotal.toFixed(2) : '0,00';

    consumoInfo.textContent =
      'Operações: ' + consumoAtual +
      ' (Declarações: ' + totalDecl +
      ' | Consultas: ' + totalCons +
      ') | Sucessos: ' + totalSucesso +
      ' | Erros: ' + totalErro +
      ' | Preço unitário atual: R$ ' + precoUnitario +
      ' | Valor total estimado: R$ ' + valorTotal;
  }

  async function carregarResumo() {
    try {
      const resp = await fetch('/api/sn/summary');
      if (!resp.ok) return;
      const resumo = await resp.json();
      atualizarResumoConsumo(resumo);
    } catch (e) {
      console.error('Erro ao carregar resumo SN:', e);
    }
  }

  // Utilitário para pegar período e empresas selecionadas
  function getPeriodoEEmpresas() {
    if (!paMes || !paAno || !snStatus) return null;

    const mes = paMes.value;
    const ano = paAno.value;

    if (!mes || !ano) {
      snStatus.textContent = 'Informe o mês e o ano da apuração.';
      return null;
    }

    if (!selectAllCompanies && selectedCompanyIds.size === 0) {
      snStatus.textContent = 'Selecione pelo menos uma empresa.';
      return null;
    }

    const pa = parseInt(String(ano) + String(mes).padStart(2, '0'), 10);

    return {
      pa,
      all: selectAllCompanies,
      companyIds: selectAllCompanies ? [] : Array.from(selectedCompanyIds),
    };
  }

  function renderResultados(resultados) {
    if (!resultsTbody) return;
    resultsTbody.innerHTML = '';

    (resultados || []).forEach((r) => {
      const tr = document.createElement('tr');

      const tdCnpj = document.createElement('td');
      tdCnpj.textContent = r.cnpj;

      const tdRazao = document.createElement('td');
      tdRazao.textContent = r.razaoSocial || '';

      const tdOp = document.createElement('td');
      tdOp.textContent = r.tipo === 'consulta' ? 'Consulta recibo' : 'Declaração';

      const tdStatus = document.createElement('td');
      tdStatus.textContent = r.sucesso ? 'Sucesso' : 'Erro';
      tdStatus.style.color = r.sucesso ? 'green' : 'red';

      const tdMsg = document.createElement('td');
      if (Array.isArray(r.mensagens) && r.mensagens.length) {
        tdMsg.textContent = r.mensagens
          .map((m) => '[' + m.codigo + '] ' + m.texto)
          .join(' | ');
      } else if (r.error) {
        tdMsg.textContent = r.error;
      } else if (r.fromCache) {
        tdMsg.textContent = 'Recibo obtido do cache.';
      } else {
        tdMsg.textContent = '-';
      }

      const tdRecibo = document.createElement('td');
      if (r.receiptId && r.sucesso) {
        const link = document.createElement('a');
        link.href = '/api/sn/receipt/' + r.receiptId;
        link.target = '_blank';
        link.textContent = 'Abrir recibo';
        tdRecibo.appendChild(link);
      } else {
        tdRecibo.textContent = '-';
      }

      tr.appendChild(tdCnpj);
      tr.appendChild(tdRazao);
      tr.appendChild(tdOp);
      tr.appendChild(tdStatus);
      tr.appendChild(tdMsg);
      tr.appendChild(tdRecibo);

      resultsTbody.appendChild(tr);
    });
  }

  // Handlers: enviar declarações e consultar recibos
  async function handleEnviarDeclaracoes() {
    const params = getPeriodoEEmpresas();
    if (!params || !snStatus) return;

    setSending(true);
    snStatus.textContent = 'Enviando declarações...';

    try {
      const resp = await fetch('/api/sn/declaration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pa: params.pa,
          all: params.all,
          companyIds: params.companyIds,
          tipoDeclaracao: 1,
          receitaInterna: 0,
          receitaExterna: 0,
          indicadorTransmissao: true,
          indicadorComparacao: false,
        }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        let msgErro = data.error || 'Erro ao enviar declarações.';
        if (data.status) msgErro += ' (HTTP ' + data.status + ')';
        snStatus.textContent = msgErro;
        setSending(false);
        return;
      }

      renderResultados(data.resultados);
      snStatus.textContent = 'Declarações processadas com sucesso.';
      if (data.resumoConsumo) {
        atualizarResumoConsumo(data.resumoConsumo);
      } else {
        carregarResumo();
      }
    } catch (e) {
      console.error(e);
      snStatus.textContent = 'Falha na comunicação com o servidor.';
    } finally {
      setSending(false);
    }
  }

  async function handleConsultarRecibos() {
    const params = getPeriodoEEmpresas();
    if (!params || !snStatus) return;

    setSending(true);
    snStatus.textContent = 'Consultando recibos...';

    try {
      const resp = await fetch('/api/sn/consult-last', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pa: params.pa,
          all: params.all,
          companyIds: params.companyIds,
        }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        let msgErro = data.error || 'Erro ao consultar recibos.';
        if (data.status) msgErro += ' (HTTP ' + data.status + ')';
        snStatus.textContent = msgErro;
        return;
      }

      // guarda o resultado da última consulta
      lastSnResults = data;

      // renderiza a tabela
      renderResultados(data.resultados);
      snStatus.textContent = 'Consultas de recibo concluídas.';

      // atualiza resumo
      if (data.resumoConsumo) {
        atualizarResumoConsumo(data.resumoConsumo);
      } else {
        carregarResumo();
      }

      // habilita ou desabilita o botão "Baixar todos os recibos"
      if (btnDownloadTodos) {
        const temAlgumRecibo =
          Array.isArray(data.resultados) &&
          data.resultados.some((r) => r.receiptId);

        btnDownloadTodos.disabled = !temAlgumRecibo;
      }
    } catch (e) {
      console.error(e);
      snStatus.textContent = 'Falha na comunicação com o servidor.';
    } finally {
      setSending(false);
    }
  }

  if (btnEnviarDecl) btnEnviarDecl.addEventListener('click', handleEnviarDeclaracoes);
  if (btnConsultarRecibos) btnConsultarRecibos.addEventListener('click', handleConsultarRecibos);

  // Inicialização
  carregarEmpresas();
  carregarResumo();

  if (btnDownloadTodos) {
    btnDownloadTodos.addEventListener('click', async function () {
      if (!lastSnResults || !Array.isArray(lastSnResults.resultados)) {
        alert('Nenhum resultado de consulta disponível.');
        return;
      }

      const receiptIds = lastSnResults.resultados
        .filter((r) => r.receiptId)
        .map((r) => r.receiptId);

      if (receiptIds.length === 0) {
        alert('Nenhum recibo disponível para download.');
        return;
      }

      try {
        btnDownloadTodos.disabled = true;
        btnDownloadTodos.textContent = 'Gerando ZIP...';

        const resp = await fetch('/api/sn/receipts/batch-download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ receiptIds }),
        });

        if (!resp.ok) {
          let err;
          try {
            err = await resp.json();
          } catch (_) {
            err = {};
          }
          console.error('Erro ao baixar ZIP:', err);
          alert('Erro ao gerar o arquivo ZIP de recibos.');
          return;
        }

        const arrayBuffer = await resp.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: 'application/zip' });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'recibos-sn.zip';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        console.error(e);
        alert('Erro ao baixar os recibos.');
      } finally {
        btnDownloadTodos.disabled = false;
        btnDownloadTodos.textContent = 'Baixar todos os recibos';
      }
    });
  }
});
