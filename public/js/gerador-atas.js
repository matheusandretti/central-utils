// public/js/gerador-atas.js
(function () {
  // Cidades pré-definidas (espelho do CIDADES_PREDEFINIDAS do Python)
  const CIDADES_PREDEFINIDAS = {
    "Francisco Beltrão": "PR",
    // Se quiser mais, é só ir adicionando:
    // "Curitiba": "PR",
    // "Pato Branco": "PR",
  };

  let lucrosPlaceholders = [];
  let camposDefinicoes = [];

  document.addEventListener('DOMContentLoaded', () => {
    // Sidebar
    if (typeof inicializarSidebar === 'function') {
      inicializarSidebar('gerador-atas');
    }

    const modeloSelect = document.getElementById('modeloSelect');
    const btnAddLucro = document.getElementById('btnAddLucro');
    const btnAddSocioPF = document.getElementById('btnAddSocioPF');
    const btnAddSocioPJ = document.getElementById('btnAddSocioPJ');
    const ataForm = document.getElementById('ataForm');

    carregarModelos();

    modeloSelect.addEventListener('change', () => {
      const id = modeloSelect.value;
      if (id) {
        carregarCampos(id);
      } else {
        limparCampos();
      }
    });

    if (btnAddLucro) {
      btnAddLucro.addEventListener('click', () => adicionarLinhaLucro());
    }

    if (btnAddSocioPF) {
      btnAddSocioPF.addEventListener('click', () => adicionarSocioPF());
    }

    if (btnAddSocioPJ) {
      btnAddSocioPJ.addEventListener('click', () => adicionarSocioPJ());
    }

    if (ataForm) {
      ataForm.addEventListener('submit', onSubmitForm);
    }
  });

  async function carregarModelos() {
    const select = document.getElementById('modeloSelect');
    const status = document.getElementById('ataStatus');
    try {
      const resp = await fetch('/api/atas/modelos');
      if (!resp.ok) throw new Error('Não foi possível carregar os modelos');
      const data = await resp.json();

      const modelos = data.modelos || [];
      select.innerHTML = '<option value="">Selecione um modelo...</option>';
      modelos.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.displayName || m.fileName || m.id;
        select.appendChild(opt);
      });

      if (modelos.length === 0 && status) {
        status.textContent = 'Nenhum modelo encontrado. Coloque seus .docx em data/atas_modelos.';
      }
    } catch (err) {
      console.error(err);
      if (status) {
        status.textContent = 'Erro ao carregar modelos: ' + err.message;
      }
    }
  }

  async function carregarCampos(modeloId) {
    const container = document.getElementById('camposContainer');
    const status = document.getElementById('ataStatus');
    const lucrosBody = document.getElementById('lucrosBody');

    limparCampos();
    if (lucrosBody) lucrosBody.innerHTML = '';

    try {
      const resp = await fetch(`/api/atas/modelos/${encodeURIComponent(modeloId)}/campos`);
      if (!resp.ok) throw new Error('Falha ao carregar campos do modelo');

      const data = await resp.json();
      camposDefinicoes = data.campos || [];
      lucrosPlaceholders = data.lucrosPlaceholders || [];

      // Montar inputs
      camposDefinicoes.forEach((campo) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'ata-field-row';

        const label = document.createElement('label');
        label.className = 'ata-field-label';
        label.htmlFor = `campo-${campo.name}`;
        label.textContent = campo.label || campo.name;

        const input = document.createElement('input');

        input.addEventListener('input', () => {
          if (input.setCustomValidity) {
            input.setCustomValidity('');
          }
        });
        input.id = `campo-${campo.name}`;
        input.name = campo.name;
        input.className = 'ata-field-input';
        input.required = true;

        switch (campo.tipo) {
          case 'data':
            input.type = 'text';
            input.placeholder = 'DD/MM/AAAA';
            break;
          case 'cpf':
          case 'cnpj':
          case 'cep':
            input.type = 'text';
            break;
          case 'money':
            input.type = 'text';
            input.placeholder = '0,00';
            break;
          default:
            input.type = 'text';
        }

        const nomeCampo = campo.name;

        // ===== CIDADE com datalist (mantém) =====
        if (nomeCampo === 'CIDADE') {
          input.setAttribute('list', 'ata-cidades-list');
          input.autocomplete = 'off';

          let datalist = document.getElementById('ata-cidades-list');
          if (!datalist) {
            datalist = document.createElement('datalist');
            datalist.id = 'ata-cidades-list';
            document.body.appendChild(datalist);
          }

          datalist.innerHTML = '';
          if (typeof CIDADES_PREDEFINIDAS !== 'undefined') {
            Object.keys(CIDADES_PREDEFINIDAS)
              .sort()
              .forEach((nome) => {
                const opt = document.createElement('option');
                opt.value = nome;
                datalist.appendChild(opt);
              });
          }
        }

        // ===== NÃO DEIXAR ENTER SUBMETER O FORM EM CNPJ/CEP =====
        if (nomeCampo === 'CNPJ' || nomeCampo === 'CEP') {
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();   // não envia o form
              input.blur();         // só tira o foco (dispara o blur)
            }
          });
        }

        // ===== Máscaras + formatação + consultas CEP/CNPJ =====
        if (campo.tipo === 'cpf' || nomeCampo.includes('CPF')) {
          aplicarMascaraCpf(input);
          input.addEventListener('blur', () => {
            formatarCampoSimples(nomeCampo, 'cpf', input);
          });

        } else if (campo.tipo === 'cnpj' || nomeCampo === 'CNPJ') {
          aplicarMascaraCnpj(input);
          input.addEventListener('blur', () => {
            formatarCampoSimples(nomeCampo, 'cnpj', input);
            consultarCnpj(input);          // <<< aqui chama a API
          });

        } else if (campo.tipo === 'cep' || nomeCampo === 'CEP') {
          aplicarMascaraCep(input);
          input.addEventListener('blur', () => {
            formatarCampoSimples(nomeCampo, 'cep', input);
            consultarCep(input);           // <<< aqui chama a API
          });

        } else {
          input.addEventListener('blur', () => {
            formatarCampoSimples(nomeCampo, campo.tipo, input);
          });
        }

        wrapper.appendChild(label);
        wrapper.appendChild(input);
        container.appendChild(wrapper);
      });

      // no final da função carregarCampos:
      sugerirLinhasLucros();

    } catch (err) {
      console.error(err);
      if (status) status.textContent = 'Erro ao carregar campos: ' + err.message;
    }
  }

  function limparCampos() {
    const container = document.getElementById('camposContainer');
    if (container) container.innerHTML = '';
    camposDefinicoes = [];
    lucrosPlaceholders = [];
  }

  function sugerirLinhasLucros() {
    const anos = new Set();
    lucrosPlaceholders.forEach((nome) => {
      const m = /^LUCRO_(\d{4})$/.exec(nome);
      if (m) {
        anos.add(parseInt(m[1], 10));
      }
      if (nome === 'LUCRO_2021_E_OUTROS') {
        anos.add(2021);
      }
    });

    if (anos.size === 0) {
      // Sugestão padrão
      const now = new Date();
      const anoAtual = now.getFullYear();
      [anoAtual, anoAtual - 1, anoAtual - 2].forEach((a) => anos.add(a));
    }

    Array.from(anos)
      .sort((a, b) => b - a)
      .forEach((ano) => adicionarLinhaLucro(ano.toString()));
  }

  function adicionarLinhaLucro(anoValor) {
    const tbody = document.getElementById('lucrosBody');
    if (!tbody) return;

    const tr = document.createElement('tr');

    const tdAno = document.createElement('td');
    const inputAno = document.createElement('input');
    inputAno.type = 'number';
    inputAno.name = 'lucroAno';
    inputAno.min = '1900';
    inputAno.max = '2100';
    inputAno.required = true;
    if (anoValor) inputAno.value = anoValor;
    tdAno.appendChild(inputAno);

    const tdValor = document.createElement('td');
    const inputValor = document.createElement('input');
    inputValor.type = 'text';
    inputValor.name = 'lucroValor';
    inputValor.placeholder = '0,00';
    inputValor.required = true;

    inputValor.addEventListener('input', () => {
      let txt = inputValor.value;
      const negativo = txt.trim().startsWith('-');

      // mantém somente dígitos, para calcular
      let raw = apenasDigitos(txt);

      if (!raw) {
        inputValor.value = negativo ? '-' : '';
        return;
      }

      // garante pelo menos 3 dígitos (1 inteiro + 2 centavos)
      if (raw.length === 1) raw = '00' + raw;
      else if (raw.length === 2) raw = '0' + raw;

      let cent = parseInt(raw, 10);
      if (negativo) cent = -cent;

      inputValor.value = formatarMoedaDeCentavos(cent);
    });

    tdValor.appendChild(inputValor);

    const tdAcao = document.createElement('td');
    const btnRemover = document.createElement('button');
    btnRemover.type = 'button';
    btnRemover.className = 'btn btn-ghost-danger btn-small';
    btnRemover.textContent = 'X';
    btnRemover.addEventListener('click', () => {
      tr.remove();
    });
    tdAcao.appendChild(btnRemover);

    tr.appendChild(tdAno);
    tr.appendChild(tdValor);
    tr.appendChild(tdAcao);

    tbody.appendChild(tr);
  }

  function adicionarSocioPF() {
    const container = document.getElementById('assinaturasPF');
    if (!container) return;

    const card = document.createElement('div');
    card.className = 'ata-socio-card socio-pf';

    card.innerHTML = `
      <div class="ata-socio-row">
        <div class="ata-socio-field">
          <label>Nome do sócio PF</label>
          <input type="text" name="pfNome" />
        </div>
        <div class="ata-socio-field">
          <label>CPF</label>
          <input type="text" name="pfCpf" placeholder="000.000.000-00" />
        </div>
      </div>
      <div class="ata-socio-row">
        <div class="ata-socio-field">
          <label>Qualificação</label>
          <input type="text" name="pfQualificacao" placeholder="Sócio Administrador, Sócia, ..." />
        </div>
        <button type="button" class="btn btn-ghost-danger btn-small ata-socio-remove">Remover</button>
      </div>
    `;

    const btnRemove = card.querySelector('.ata-socio-remove');
    btnRemove.addEventListener('click', () => card.remove());

    const cpfInput = card.querySelector('input[name="pfCpf"]');
    aplicarMascaraCpf(cpfInput);

    cpfInput.addEventListener('input', () => {
      if (cpfInput.setCustomValidity) {
        cpfInput.setCustomValidity('');
      }
    });

    container.appendChild(card);
  }

  function adicionarSocioPJ() {
    const container = document.getElementById('assinaturasPJ');
    if (!container) return;

    const card = document.createElement('div');
    card.className = 'ata-socio-card socio-pj';

    card.innerHTML = `
      <div class="ata-socio-row">
        <div class="ata-socio-field">
          <label>Nome da empresa (PJ)</label>
          <input type="text" name="pjNome" />
        </div>
      </div>
      <div class="ata-socio-row">
        <div class="ata-socio-field">
          <label>Representante</label>
          <input type="text" name="pjRepresentante" />
        </div>
        <div class="ata-socio-field">
          <label>CPF do representante</label>
          <input type="text" name="pjCpf" placeholder="000.000.000-00" />
        </div>
      </div>
      <div class="ata-socio-row">
        <div class="ata-socio-field">
          <label>Qualificação</label>
          <input type="text" name="pjQualificacao" placeholder="Sócio Administrador, ..." />
        </div>
        <button type="button" class="btn btn-ghost-danger btn-small ata-socio-remove">Remover</button>
      </div>
    `;

    const btnRemove = card.querySelector('.ata-socio-remove');
    btnRemove.addEventListener('click', () => card.remove());

    const cpfInput = card.querySelector('input[name="pjCpf"]');
    aplicarMascaraCpf(cpfInput);

    cpfInput.addEventListener('input', () => {
      if (cpfInput.setCustomValidity) {
        cpfInput.setCustomValidity('');
      }
    });

    container.appendChild(card);
  }

  async function onSubmitForm(event) {
    event.preventDefault();

    const modeloSelect = document.getElementById('modeloSelect');
    const status = document.getElementById('ataStatus');
    const loading = document.getElementById('ataLoading');
    const downloadWrapper = document.getElementById('ataDownloadWrapper');
    const downloadLink = document.getElementById('ataDownloadLink');

    // validação de CPF/CNPJ: CPF com dígitos verificadores e CNPJ por quantidade de dígitos
    for (const campo of camposDefinicoes) {
      if (campo.tipo === 'cpf' || campo.tipo === 'cnpj') {
        const input = document.getElementById(`campo-${campo.name}`);
        if (!input) continue;

        const valor = (input.value || '').trim();
        const dig = apenasDigitos(valor);

        console.log('Validando campo', campo.name, {
          bruto: valor,
          soDigitos: dig,
          resultado: campo.tipo === 'cpf' ? validarCpf(valor) : dig.length
        });

        // se o campo estiver em branco, deixa passar (se quiser exigir preenchimento, é outra regra)
        if (!dig) {
          if (input.setCustomValidity) input.setCustomValidity('');
          continue;
        }

        let msg = '';

        if (campo.tipo === 'cpf') {
          if (!validarCpf(valor)) {
            msg = 'CPF inválido.';
          }
        } else {
          // cnpj
          if (dig.length !== 14) {
            msg = 'CNPJ deve ter 14 dígitos.';
          }
        }

        if (msg) {
          if (input.setCustomValidity) {
            input.setCustomValidity(msg);
            input.reportValidity(); // balãozinho nativo do browser
          } else {
            alert(msg); // fallback
          }
          input.focus();
          return; // não deixa enviar o formulário
        } else if (input.setCustomValidity) {
          // limpa mensagem anterior, se estiver tudo certo
          input.setCustomValidity('');
        }
      }
    }

    if (status) status.textContent = '';
    if (downloadWrapper) downloadWrapper.style.display = 'none';

    if (!modeloSelect.value) {
      if (status) status.textContent = 'Selecione um modelo antes de gerar a ata.';
      return;
    }

    // validação de CPF/CNPJ/CEP dos campos principais
    for (const campo of camposDefinicoes) {
      if (campo.tipo === 'cpf' || campo.tipo === 'cnpj' || campo.tipo === 'cep') {
        const input = document.getElementById(`campo-${campo.name}`);
        if (!input) continue;

        const dig = apenasDigitos(input.value);
        if (!dig) continue; // campo em branco é permitido

        let expected;
        let labelTipo;
        if (campo.tipo === 'cpf') {
          expected = 11;
          labelTipo = 'CPF';
        } else if (campo.tipo === 'cnpj') {
          expected = 14;
          labelTipo = 'CNPJ';
        } else {
          expected = 8;
          labelTipo = 'CEP';
        }

        if (dig.length !== expected) {
          const msg = `${labelTipo} deve ter ${expected} dígitos.`;

          if (input.setCustomValidity) {
            input.setCustomValidity(msg);
            input.reportValidity();
          } else {
            alert(msg);
          }
          input.focus();
          return;
        } else if (input.setCustomValidity) {
          input.setCustomValidity('');
        }
      }
    }

    // validação dos CPFs dos sócios (PF e PJ)
    const sociosCpfInputs = document.querySelectorAll(
      '.socio-pf input[name="pfCpf"], .socio-pj input[name="pjCpf"]'
    );

    for (const input of sociosCpfInputs) {
      const valor = (input.value || '').trim();
      console.log('Validando CPF sócio', input.name, { bruto: valor, soDigitos: apenasDigitos(valor), resultado: validarCpf(valor) });

      // Se o campo estiver vazio, não valida (só valida se você preencher algum número)
      if (!valor) {
        if (input.setCustomValidity) input.setCustomValidity('');
        continue;
      }

      if (!validarCpf(valor)) {
        const msg = 'CPF do sócio inválido.';

        if (input.setCustomValidity) {
          input.setCustomValidity(msg);
          input.reportValidity();   // mostra o balãozinho em cima do campo
        } else {
          alert(msg);
        }

        input.focus();
        return; // NÃO deixa gerar a ata
      } else if (input.setCustomValidity) {
        input.setCustomValidity('');
      }
    }

    const campos = {};
    camposDefinicoes.forEach((campo) => {
      const input = document.getElementById(`campo-${campo.name}`);
      if (!input) return;
      const val = (input.value || '').trim();
      campos[campo.name] = val;
    });

    const lucros = [];
    const lucrosBody = document.getElementById('lucrosBody');
    if (lucrosBody) {
      lucrosBody.querySelectorAll('tr').forEach((tr) => {
        const ano = tr.querySelector('input[name="lucroAno"]');
        const valor = tr.querySelector('input[name="lucroValor"]');
        if (!ano || !valor) return;
        const anoVal = (ano.value || '').trim();
        const valVal = (valor.value || '').trim();
        if (anoVal && valVal) {
          lucros.push({ ano: parseInt(anoVal, 10), valor: valVal });
        }
      });
    }

    const assinaturasPF = [];
    document.querySelectorAll('.socio-pf').forEach((card) => {
      const nome = (card.querySelector('input[name="pfNome"]')?.value || '').trim();
      const cpf = (card.querySelector('input[name="pfCpf"]')?.value || '').trim();
      const qualificacao = (card.querySelector('input[name="pfQualificacao"]')?.value || '').trim();
      if (nome || cpf || qualificacao) {
        assinaturasPF.push({ nome, cpf, qualificacao });
      }
    });

    const assinaturasPJ = [];
    document.querySelectorAll('.socio-pj').forEach((card) => {
      const pj = (card.querySelector('input[name="pjNome"]')?.value || '').trim();
      const representante = (card.querySelector('input[name="pjRepresentante"]')?.value || '').trim();
      const cpf = (card.querySelector('input[name="pjCpf"]')?.value || '').trim();
      const qualificacao = (card.querySelector('input[name="pjQualificacao"]')?.value || '').trim();
      if (pj || representante || cpf || qualificacao) {
        assinaturasPJ.push({ pj, representante, cpf, qualificacao });
      }
    });

    const payload = {
      modelo_id: modeloSelect.value,
      campos,
      lucros,
      assinaturasPF,
      assinaturasPJ
    };

    try {
      if (loading) loading.style.display = 'inline';
      const resp = await fetch('/api/atas/gerar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        throw new Error('Erro HTTP ' + resp.status);
      }

      const data = await resp.json();
      if (!data.ok) {
        throw new Error(data.error || 'Erro ao gerar ata');
      }

      if (status) {
        status.textContent = 'Ata gerada com sucesso!';
      }
      if (downloadWrapper && downloadLink) {
        downloadWrapper.style.display = 'block';
        downloadLink.href = `/api/atas/download/${encodeURIComponent(data.fileName)}`;
        downloadLink.textContent = `Baixar ${data.fileName}`;
      }
    } catch (err) {
      console.error(err);
      if (status) {
        status.textContent = 'Erro ao gerar ata: ' + err.message;
      }
    } finally {
      if (loading) loading.style.display = 'none';
    }
  }

  // =========================
  // Formatação de campos (frontend) - espelhando o Tkinter
  // =========================

  function apenasDigitos(texto) {
    return (texto || '').replace(/\D+/g, '');
  }

  function formatarCnpj(texto) {
    const dig = apenasDigitos(texto);
    if (dig.length !== 14) return texto;
    return `${dig.slice(0, 2)}.${dig.slice(2, 5)}.${dig.slice(5, 8)}/${dig.slice(8, 12)}-${dig.slice(12)}`;
  }

  function aplicarMascaraCpf(input) {
    if (!input) return;
    input.maxLength = 14; // 000.000.000-00

    input.addEventListener('input', () => {
      let dig = apenasDigitos(input.value).slice(0, 11);
      let out = '';

      if (dig.length > 0) out = dig.slice(0, 3);
      if (dig.length >= 4) out += '.' + dig.slice(3, 6);
      if (dig.length >= 7) out += '.' + dig.slice(6, 9);
      if (dig.length >= 10) out += '-' + dig.slice(9, 11);

      input.value = out;
    });
  }

  function aplicarMascaraCnpj(input) {
    if (!input) return;
    input.maxLength = 18; // 00.000.000/0000-00

    input.addEventListener('input', () => {
      let dig = apenasDigitos(input.value).slice(0, 14);
      let out = '';

      if (dig.length > 0) out = dig.slice(0, 2);
      if (dig.length >= 3) out += '.' + dig.slice(2, 5);
      if (dig.length >= 6) out += '.' + dig.slice(5, 8);
      if (dig.length >= 9) out += '/' + dig.slice(8, 12);
      if (dig.length >= 13) out += '-' + dig.slice(12, 14);

      input.value = out;
    });
  }

  function aplicarMascaraCep(input) {
    if (!input) return;
    input.maxLength = 9; // 00000-000

    input.addEventListener('input', () => {
      let dig = apenasDigitos(input.value).slice(0, 8);
      let out = '';

      if (dig.length > 0) out = dig.slice(0, 5);
      if (dig.length >= 6) out += '-' + dig.slice(5, 8);

      input.value = out;
    });
  }

  function formatarCpf(texto) {
    const dig = apenasDigitos(texto);
    if (dig.length !== 11) return texto;
    return `${dig.slice(0, 3)}.${dig.slice(3, 6)}.${dig.slice(6, 9)}-${dig.slice(9)}`;
  }

  function validarCpf(cpfTexto) {
    const dig = apenasDigitos(cpfTexto);
    if (dig.length !== 11) return false;

    // rejeita CPFs com todos os dígitos iguais (111.111.111-11 etc.)
    if (/^(\d)\1{10}$/.test(dig)) return false;

    // 1º dígito verificador
    let soma = 0;
    for (let i = 0; i < 9; i++) {
      soma += parseInt(dig[i], 10) * (10 - i);
    }
    let resto = (soma * 10) % 11;
    if (resto === 10) resto = 0;
    if (resto !== parseInt(dig[9], 10)) return false;

    // 2º dígito verificador
    soma = 0;
    for (let i = 0; i < 10; i++) {
      soma += parseInt(dig[i], 10) * (11 - i);
    }
    resto = (soma * 10) % 11;
    if (resto === 10) resto = 0;
    if (resto !== parseInt(dig[10], 10)) return false;

    return true;
  }

  function formatarCep(texto) {
    const dig = apenasDigitos(texto);
    if (dig.length !== 8) return texto;
    return `${dig.slice(0, 5)}-${dig.slice(5)}`;
  }

  function converterMoedaParaCentavos(texto) {
    const txt = (texto || '').trim();
    if (!txt) return 0;
    const sinal = txt.startsWith('-') ? -1 : 1;
    const digitos = apenasDigitos(txt);
    if (!digitos) return 0;
    return sinal * parseInt(digitos, 10);
  }

  function formatarMoedaDeCentavos(centavos) {
    let sinal = '';
    if (centavos < 0) {
      sinal = '-';
      centavos = Math.abs(centavos);
    }
    const inteiro = Math.floor(centavos / 100);
    const frac = centavos % 100;

    let s = String(inteiro);
    const partes = [];
    while (s.length > 3) {
      partes.unshift(s.slice(-3));
      s = s.slice(0, -3);
    }
    partes.unshift(s);
    const inteiroFmt = partes.join('.');
    return `${sinal}${inteiroFmt},${String(frac).padStart(2, '0')}`;
  }

  function formatarMoedaTexto(texto) {
    const cent = converterMoedaParaCentavos(texto);
    return formatarMoedaDeCentavos(cent);
  }

  function normalizarData(texto) {
    const txt = (texto || '').trim();
    if (!txt) return texto;

    const txt2 = txt.replace(/-/g, '/');
    const partes = txt2.split('/');

    let dia, mes, ano;

    if (partes.length === 3) {
      dia = parseInt(partes[0], 10);
      mes = parseInt(partes[1], 10);
      ano = parseInt(partes[2], 10);
    } else {
      const dig = apenasDigitos(txt);
      if (dig.length !== 8) return texto;
      dia = parseInt(dig.slice(0, 2), 10);
      mes = parseInt(dig.slice(2, 4), 10);
      ano = parseInt(dig.slice(4, 8), 10);
    }

    if (!dia || !mes || !ano) return texto;
    const dt = new Date(ano, mes - 1, dia);
    if (isNaN(dt.getTime())) return texto;

    // confere se a data é válida mesmo (29/02, etc.)
    if (
      dt.getFullYear() !== ano ||
      dt.getMonth() !== mes - 1 ||
      dt.getDate() !== dia
    ) {
      return texto;
    }

    return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${String(ano).padStart(4, '0')}`;
  }

  function formatarCidade(texto) {
    return (texto || '')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map(p => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ');
  }

  function formatarCampoSimples(nomeCampo, tipo, input) {
    if (!input) return;
    let texto = (input.value || '').trim();
    if (!texto) return;

    try {
      if (nomeCampo === 'NOME_EMPRESA') {
        input.value = texto.toUpperCase();
        return;
      }

      if (nomeCampo === 'NIRE') {
        input.value = texto.toUpperCase();
        return;
      }

      if (nomeCampo === 'CIDADE') {
        const cidadeFmt = formatarCidade(texto);
        input.value = cidadeFmt;

        // tenta preencher UF automaticamente
        if (typeof CIDADES_PREDEFINIDAS !== 'undefined') {
          const uf = CIDADES_PREDEFINIDAS[cidadeFmt];
          if (uf) {
            const ufInput = document.getElementById('campo-ESTADO');
            if (ufInput) {
              ufInput.value = uf;
            }
          }
        }
        return;
      }

      if (nomeCampo === 'ESTADO') {
        const letras = (texto || '')
          .toUpperCase()
          .replace(/[^A-Z]/g, '')
          .slice(0, 2);
        input.value = letras;
        return;
      }

      // >>> ADICIONE ISTO <<<
      if (nomeCampo === 'RUA' || nomeCampo === 'BAIRRO') {
        input.value = formatarCidade(texto);
        return;
      }

      // Regras por TIPO de campo
      switch (tipo) {
        case 'money':
          input.value = formatarMoedaTexto(texto);
          break;

        case 'cnpj': {
          const dig = apenasDigitos(texto);
          if (dig.length === 14) {
            input.value = formatarCnpj(texto);
          }
          // se não tiver 14 dígitos, não formata e não mostra alerta
          break;
        }

        case 'cpf': {
          const dig = apenasDigitos(texto);
          if (dig.length === 11) {
            input.value = formatarCpf(texto);
          }
          break;
        }

        case 'cep': {
          const dig = apenasDigitos(texto);
          if (dig.length === 8) {
            input.value = formatarCep(texto);
          }
          break;
        }

        case 'data':
          input.value = normalizarData(texto);
          break;

        default:
          // texto normal, não faz nada
          break;
      }
    } catch (e) {
      console.error('Erro ao formatar campo', nomeCampo, e);
    }
  }

  async function consultarCep(inputCep) {
    const status = document.getElementById('ataStatus');
    if (!inputCep) return;
    const cep = apenasDigitos(inputCep.value);

    if (!cep || cep.length !== 8) {
      return; // deixa o usuário editar
    }

    try {
      if (status) status.textContent = 'Consultando CEP...';

      const resp = await fetch(`/api/cep/${cep}`);
      const data = await resp.json();

      if (!resp.ok || !data.ok) {
        if (status) status.textContent = data.error || 'CEP não encontrado. Preencha manualmente.';
        return;
      }

      const info = data.data || {};

      const estadoInput = document.getElementById('campo-ESTADO');
      const cidadeInput = document.getElementById('campo-CIDADE');
      const bairroInput = document.getElementById('campo-BAIRRO');
      const ruaInput = document.getElementById('campo-RUA');
      const cepInput = document.getElementById('campo-CEP');

      if (estadoInput && info.state) {
        estadoInput.value = info.state;
        formatarCampoSimples('ESTADO', 'texto', estadoInput);
      }

      if (cidadeInput && info.city) {
        cidadeInput.value = info.city;
        formatarCampoSimples('CIDADE', 'texto', cidadeInput);
      }

      if (bairroInput && info.neighborhood) {
        bairroInput.value = info.neighborhood;
        formatarCampoSimples('BAIRRO', 'texto', bairroInput);
      }

      if (ruaInput && info.street) {
        ruaInput.value = info.street;
        formatarCampoSimples('RUA', 'texto', ruaInput);
      }

      if (cepInput && info.cep) {
        cepInput.value = info.cep;
        formatarCampoSimples('CEP', 'cep', cepInput);
      }

      if (status) status.textContent = '';
    } catch (err) {
      console.error('Erro ao consultar CEP:', err);
      if (status) status.textContent = 'Erro ao consultar CEP. Preencha manualmente.';
    }
  }

  async function consultarCnpj(inputCnpj) {
    const status = document.getElementById('ataStatus');
    if (!inputCnpj) return;
    const cnpj = apenasDigitos(inputCnpj.value);

    if (!cnpj || cnpj.length !== 14) {
      return;
    }

    try {
      if (status) status.textContent = 'Consultando CNPJ...';

      const resp = await fetch(`/api/cnpj/${cnpj}`);
      const data = await resp.json();

      if (!resp.ok || !data.ok) {
        if (status) status.textContent = data.error || 'CNPJ não encontrado. Preencha manualmente.';
        return;
      }

      const info = data.data || {};

      const nomeEmpresaInput =
        document.getElementById('campo-NOME_EMPRESA') ||
        document.getElementById('campo-NOME EMPRESA');

      const cidadeInput = document.getElementById('campo-CIDADE');
      const estadoInput = document.getElementById('campo-ESTADO');
      const bairroInput = document.getElementById('campo-BAIRRO');
      const ruaInput = document.getElementById('campo-RUA');
      const numeroInput =
        document.getElementById('campo-NUMERO_RUA') ||
        document.getElementById('campo-NUMERO');
      const cepInput = document.getElementById('campo-CEP');

      if (nomeEmpresaInput && info.razao_social) {
        nomeEmpresaInput.value = info.razao_social;
        formatarCampoSimples('NOME_EMPRESA', 'texto', nomeEmpresaInput);
      }

      if (estadoInput && info.uf) {
        estadoInput.value = info.uf;
        formatarCampoSimples('ESTADO', 'texto', estadoInput);
      }

      if (cidadeInput && info.municipio) {
        cidadeInput.value = info.municipio;
        formatarCampoSimples('CIDADE', 'texto', cidadeInput);
      }

      if (bairroInput && info.bairro) {
        bairroInput.value = info.bairro;
        formatarCampoSimples('BAIRRO', 'texto', bairroInput);
      }

      let logradouro = '';
      if (info.descricao_tipo_de_logradouro) {
        logradouro += info.descricao_tipo_de_logradouro + ' ';
      }
      if (info.logradouro) {
        logradouro += info.logradouro;
      }
      if (ruaInput && logradouro) {
        ruaInput.value = logradouro.trim();
        formatarCampoSimples('RUA', 'texto', ruaInput);
      }

      if (numeroInput && info.numero) {
        numeroInput.value = String(info.numero);
      }

      if (cepInput && info.cep) {
        cepInput.value = info.cep;
        formatarCampoSimples('CEP', 'cep', cepInput);
      }

      popularSociosAPartirDoCnpj(info);

      if (status) status.textContent = '';

    } catch (err) {
      console.error('Erro ao consultar CNPJ:', err);
      if (status) status.textContent = 'Erro ao consultar CNPJ. Preencha manualmente.';
    }
  }

  function popularSociosAPartirDoCnpj(info) {
    // se não tiver QSA, não faz nada
    if (!info || !Array.isArray(info.qsa)) return;

    const containerPF = document.getElementById('assinaturasPF');
    const containerPJ = document.getElementById('assinaturasPJ');
    if (!containerPF || !containerPJ) return;

    // limpa o que já existia (opcional, mas costuma ser o desejado)
    containerPF.innerHTML = '';
    containerPJ.innerHTML = '';

    info.qsa.forEach((socio) => {
      const nome = (socio.nome_socio || socio.nome || '').trim();
      const qualificacao = (socio.qualificacao_socio || socio.qualificacao || '').trim();
      const docSocio = (socio.cnpj_cpf_do_socio || '').trim();

      if (!nome) return;

      // regra simples: se o documento tiver 14+ dígitos, consideramos PJ
      const digitosDoc = apenasDigitos(docSocio);
      const ehPJ = digitosDoc.length === 14;

      if (ehPJ) {
        // adiciona card PJ e preenche
        adicionarSocioPJ();
        const cardsPJ = containerPJ.querySelectorAll('.socio-pj');
        const card = cardsPJ[cardsPJ.length - 1];
        if (!card) return;

        const pjNomeInput = card.querySelector('input[name="pjNome"]');
        const pjQualInput = card.querySelector('input[name="pjQualificacao"]');

        if (pjNomeInput) pjNomeInput.value = nome;
        if (pjQualInput && qualificacao) pjQualInput.value = qualificacao;

        // representante/CPF do representante continuam em branco para o usuário preencher
      } else {
        // adiciona card PF e preenche
        adicionarSocioPF();
        const cardsPF = containerPF.querySelectorAll('.socio-pf');
        const card = cardsPF[cardsPF.length - 1];
        if (!card) return;

        const pfNomeInput = card.querySelector('input[name="pfNome"]');
        const pfQualInput = card.querySelector('input[name="pfQualificacao"]');
        const pfCpfInput = card.querySelector('input[name="pfCpf"]');

        if (pfNomeInput) pfNomeInput.value = nome;
        if (pfQualInput && qualificacao) pfQualInput.value = qualificacao;

        // CPF vem mascarado (***.***.***-**) → deixa em branco para digitar manualmente
        if (pfCpfInput) pfCpfInput.value = '';
      }
    });
  }


})();
