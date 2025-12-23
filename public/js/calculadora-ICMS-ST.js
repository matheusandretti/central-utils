// arquivo sugerido: public/js/calculadora-icms-st.js

document.addEventListener('DOMContentLoaded', () => {
    // id deve existir em MENU_CONFIG (sidebar.js)
    inicializarSidebar('calculadora-icms-st');

    inicializarPagina();
});

function inicializarPagina() {
    const form = document.getElementById('form-calculadora-icms-st');
    const xmlInput = document.getElementById('xmlInput');

    const vendedorSimples = document.getElementById('vendedorSimples');
    const compradorSimples = document.getElementById('compradorSimples');
    const produtosAutopecas = document.getElementById('produtosAutopecas');
    const aliquotaDestino = document.getElementById('aliquotaDestino');

    const autoMvaOriginal = document.getElementById('autoMvaOriginal');
    const autoMvaAjustada12 = document.getElementById('autoMvaAjustada12');
    const autoMvaAjustada4 = document.getElementById('autoMvaAjustada4');

    // Defaults autopeças (editável)
    autoMvaOriginal.value = '71,78';
    autoMvaAjustada12.value = '87,78';
    autoMvaAjustada4.value = '104,86';

    if (form) {
        form.addEventListener('submit', enviarFormulario);
    }

    // Recalcular ao alterar parâmetros
    [vendedorSimples, compradorSimples, produtosAutopecas].forEach(el => {
        el?.addEventListener('change', () => {
            atualizarUIAutopecas();
            atualizarModoMvaEReferencias();
            reconstruirTabelaCombosSeNecessario();
            recalcularTudo();
        });
    });

    aliquotaDestino?.addEventListener('input', () => {
        atualizarModoMvaEReferencias();
        recalcularTudo();
    });

    [autoMvaOriginal, autoMvaAjustada12, autoMvaAjustada4].forEach(el => {
        el?.addEventListener('input', () => recalcularTudo());
    });

    // Se o usuário trocar o arquivo, já limpa mensagens e (opcionalmente) permite processar
    xmlInput?.addEventListener('change', () => {
        setMsgEntrada('');
        log('Arquivo selecionado. Clique em “Carregar XML”.');
    });

    atualizarUIAutopecas();
}

/** Estado em memória */
let estadoNfe = null;
/** Map comboKey -> { ncm, pIcms, mvaPct } */
let estadoCombos = new Map();

async function enviarFormulario(event) {
    event.preventDefault();

    const xmlInput = document.getElementById('xmlInput');
    const msgEntrada = document.getElementById('msgEntrada');

    if (!xmlInput?.files?.length) {
        msgEntrada.textContent = 'Selecione um XML.';
        return;
    }

    try {
        const file = xmlInput.files[0];
        const xmlText = await lerArquivoComoTexto(file);

        estadoNfe = parseNfeXml(xmlText);

        preencherCabecalhoUFs(estadoNfe);
        preencherTotais(estadoNfe);

        // PR = 19,5% (regra do usuário)
        aplicarRegraAliquotaDestino(estadoNfe);

        // Monta combos (se não for autopeças) e tabela de itens
        reconstruirTabelaItens(estadoNfe);
        reconstruirTabelaCombosSeNecessario();

        atualizarUIAutopecas();
        atualizarModoMvaEReferencias();

        recalcularTudo();

        setMsgEntrada('XML carregado com sucesso.');
        log(`XML carregado. Chave: ${estadoNfe.chave || '(não encontrada)'}`);
    } catch (err) {
        console.error(err);
        setMsgEntrada(`Erro ao ler XML: ${err.message || err}`);
        log(`Erro ao processar XML: ${err.message || err}`);
    }
}

/** =========================
 *  Parsing XML NF-e
 *  ========================= */
function parseNfeXml(xmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

    const parseError = xmlDoc.getElementsByTagName('parsererror')?.[0];
    if (parseError) {
        throw new Error('XML inválido ou malformado.');
    }

    const infNFe = xmlDoc.getElementsByTagName('infNFe')?.[0];
    if (!infNFe) throw new Error('Não encontrei a tag infNFe no XML.');

    const idAttr = infNFe.getAttribute('Id') || '';
    const chave = idAttr.startsWith('NFe') ? idAttr.slice(3) : idAttr;

    const ufOrig = textOfFirst(infNFe, ['emit', 'enderEmit', 'UF']);
    const ufDest = textOfFirst(infNFe, ['dest', 'enderDest', 'UF']);

    const totNode = infNFe.getElementsByTagName('ICMSTot')?.[0];

    const totals = {
        vProd: numberFromNode(totNode, 'vProd'),
        vIPI: numberFromNode(totNode, 'vIPI'),
        vFrete: numberFromNode(totNode, 'vFrete'),
        vSeg: numberFromNode(totNode, 'vSeg'),
        vDesc: numberFromNode(totNode, 'vDesc'),
        vOutro: numberFromNode(totNode, 'vOutro'),
        vICMS: numberFromNode(totNode, 'vICMS'),
        vST: numberFromNode(totNode, 'vST'),
    };

    const detNodes = Array.from(infNFe.getElementsByTagName('det') || []);
    const itens = detNodes.map((det, idx) => {
        const prod = det.getElementsByTagName('prod')?.[0];
        if (!prod) return null;

        const imposto = det.getElementsByTagName('imposto')?.[0];

        // ICMS
        const icmsWrap = imposto?.getElementsByTagName('ICMS')?.[0] || null;
        const pICMS = findFirstNumberDeep(icmsWrap, ['pICMS']); // pode faltar em alguns casos
        const vICMS = findFirstNumberDeep(icmsWrap, ['vICMS']);
        const vBC = findFirstNumberDeep(icmsWrap, ['vBC']);
        const vICMSST = findFirstNumberDeep(icmsWrap, ['vICMSST']); // destacado por item (quando existir)

        // IPI (por item)
        const ipiWrap = imposto?.getElementsByTagName('IPI')?.[0] || null;
        const vIPI = findFirstNumberDeep(ipiWrap, ['vIPI']);

        return {
            idx,
            nItem: det.getAttribute('nItem') || String(idx + 1),
            xProd: textFromTag(prod, 'xProd') || '(sem descrição)',
            ncm: textFromTag(prod, 'NCM') || '',
            vProd: numberFromTag(prod, 'vProd'),
            vFrete: numberFromTag(prod, 'vFrete'),
            vSeg: numberFromTag(prod, 'vSeg'),
            vDesc: numberFromTag(prod, 'vDesc'),
            vOutro: numberFromTag(prod, 'vOutro'),
            vIPI,
            pICMS,
            vICMS,
            vBC,
            vICMSST,
        };
    }).filter(Boolean);

    return { chave, ufOrig, ufDest, totals, itens };
}

function textOfFirst(root, pathTags) {
    // path: ['emit','enderEmit','UF']
    let current = root;
    for (const tag of pathTags) {
        const found = current?.getElementsByTagName(tag)?.[0];
        if (!found) return '';
        current = found;
    }
    return (current?.textContent || '').trim();
}

function textFromTag(node, tag) {
    const el = node?.getElementsByTagName(tag)?.[0];
    return (el?.textContent || '').trim();
}

function numberFromTag(node, tag) {
    return parsePtNumber(textFromTag(node, tag));
}

function numberFromNode(node, tag) {
    if (!node) return 0;
    const el = node.getElementsByTagName(tag)?.[0];
    return parsePtNumber((el?.textContent || '').trim());
}

function findFirstNumberDeep(root, tags) {
    if (!root) return 0;
    for (const tag of tags) {
        const el = root.getElementsByTagName(tag)?.[0];
        const n = parsePtNumber((el?.textContent || '').trim());
        if (Number.isFinite(n) && n !== 0) return n;
        // se for 0, ainda pode ser válido; mas aqui priorizamos achar algum não-zero
        if (el && Number.isFinite(n)) return n;
    }
    return 0;
}

/** =========================
 *  UI (preenchimento)
 *  ========================= */
function preencherCabecalhoUFs(nfe) {
    setVal('ufOrigem', nfe.ufOrig || '');
    setVal('ufDestino', nfe.ufDest || '');
}

function preencherTotais(nfe) {
    setVal('t_vProd', formatBRL(nfe.totals.vProd));
    setVal('t_vIPI', formatBRL(nfe.totals.vIPI));
    setVal('t_vFrete', formatBRL(nfe.totals.vFrete));
    setVal('t_vSeg', formatBRL(nfe.totals.vSeg));
    setVal('t_vDesc', formatBRL(nfe.totals.vDesc));
    setVal('t_vOutro', formatBRL(nfe.totals.vOutro));
    setVal('t_vICMS', formatBRL(nfe.totals.vICMS));
    setVal('t_vST', formatBRL(nfe.totals.vST));

    setVal('r_totalIcmsStXml', formatBRL(nfe.totals.vST));
}

function aplicarRegraAliquotaDestino(nfe) {
    const aliqDestinoEl = document.getElementById('aliquotaDestino');
    if (!aliqDestinoEl) return;

    const uf = (nfe.ufDest || '').toUpperCase();
    if (uf === 'PR') {
        aliqDestinoEl.value = '19,5';
        log('UF destino = PR → alíquota destino ajustada automaticamente para 19,5%.');
    } else if (!aliqDestinoEl.value) {
        aliqDestinoEl.value = '';
    }
}

function reconstruirTabelaItens(nfe) {
    const tbody = document.getElementById('stItensBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    nfe.itens.forEach(item => {
        const tr = document.createElement('tr');
        tr.dataset.idx = String(item.idx);

        const nomeCompleto = item.xProd || '(sem descrição)';
        const nomeCurto = truncateText(nomeCompleto, 50);

        tr.innerHTML = `
      <td><input type="checkbox" class="st-flag" checked /></td>
      <td title="${escapeHtml(nomeCompleto)}">${escapeHtml(nomeCurto)}</td>
      <td>${escapeHtml(item.ncm || '')}</td>
      <td>${formatPercent(item.pICMS, 2)}</td>
      <td class="cell-mva">—</td>
      <td class="cell-base">—</td>
      <td class="cell-st">—</td>
    `;

        tr.querySelector('.st-flag')?.addEventListener('change', () => recalcularTudo());
        tbody.appendChild(tr);
    });
}

function truncateText(text, max) {
    const s = String(text || '');
    return s.length > max ? s.slice(0, max) + '…' : s;
}


function reconstruirTabelaCombosSeNecessario() {
    const combosCard = document.getElementById('mvaCombosCard');
    const autopecas = document.getElementById('produtosAutopecas')?.checked;

    if (!estadoNfe) {
        combosCard.style.display = 'none';
        return;
    }

    if (autopecas) {
        combosCard.style.display = 'none';
        estadoCombos = new Map();
        return;
    }

    // Gera combos (NCM + pICMS)
    const combos = gerarCombosUnicos(estadoNfe.itens);
    estadoCombos = new Map();

    const tbody = document.getElementById('mvaCombosBody');
    tbody.innerHTML = '';

    combos.forEach(c => {
        estadoCombos.set(c.key, { ncm: c.ncm, pIcms: c.pIcms, mvaPct: 0 });

        const tr = document.createElement('tr');
        tr.dataset.key = c.key;

        tr.innerHTML = `
      <td>${escapeHtml(c.ncm)}</td>
      <td>${formatPercent(c.pIcms, 2)}</td>
      <td class="combo-tipo">—</td>
      <td>
        <input type="text" class="combo-mva" placeholder="Ex.: 40,00" />
      </td>
    `;

        const input = tr.querySelector('.combo-mva');
        input.addEventListener('input', () => {
            const mva = parsePtNumber(input.value);
            const current = estadoCombos.get(c.key) || { ncm: c.ncm, pIcms: c.pIcms, mvaPct: 0 };
            current.mvaPct = Number.isFinite(mva) ? mva : 0;
            estadoCombos.set(c.key, current);

            recalcularTudo();
        });

        tbody.appendChild(tr);
    });

    combosCard.style.display = '';
    atualizarModoMvaEReferencias(); // atualiza a coluna "Tipo de MVA esperado"
}

function gerarCombosUnicos(itens) {
    const map = new Map();
    itens.forEach(it => {
        const ncm = (it.ncm || '').trim() || '(sem NCM)';
        const p = Number.isFinite(it.pICMS) ? it.pICMS : 0;
        const key = `${ncm}__${p.toFixed(4)}`;
        if (!map.has(key)) map.set(key, { key, ncm, pIcms: p });
    });
    return Array.from(map.values());
}

function atualizarUIAutopecas() {
    const autopecas = document.getElementById('produtosAutopecas')?.checked;
    const card = document.getElementById('autopecasCard');
    if (card) card.style.display = autopecas ? '' : 'none';
}

function atualizarModoMvaEReferencias() {
    const badge = document.getElementById('mvaModoBadge');
    const warnBox = document.getElementById('warnBox');

    if (!estadoNfe) {
        badge.textContent = 'Carregue um XML para ver o modo de MVA.';
        desmarcarDestaquesMvaRef();
        return;
    }

    const vendedorSN = !!document.getElementById('vendedorSimples')?.checked;
    const compradorSN = !!document.getElementById('compradorSimples')?.checked;
    const internal = isOperacaoInterna(estadoNfe.ufOrig, estadoNfe.ufDest);

    const rem = vendedorSN ? 'sn' : 'normal';
    const dest = compradorSN ? 'sn' : 'normal';
    const scope = internal ? 'interna' : 'inter';

    destacarLinhaMvaRef(scope, rem, dest);

    // Badge geral (e dica interestadual)
    if (internal) {
        badge.textContent = `Operação INTERNA • Remetente: ${vendedorSN ? 'SN' : 'Normal'} • Destinatário: ${compradorSN ? 'SN' : 'Normal'}`;
    } else {
        badge.textContent = `Operação INTERESTADUAL • Remetente: ${vendedorSN ? 'SN' : 'Normal'} • Destinatário: ${compradorSN ? 'SN' : 'Normal'} (itens podem usar 12% ou 4% conforme pICMS)`;
    }

    // Avisos úteis
    const aliqDest = parsePtNumber(document.getElementById('aliquotaDestino')?.value || '');
    const avisos = [];

    if (!Number.isFinite(aliqDest) || aliqDest <= 0) {
        avisos.push('Informe a alíquota do ICMS da UF de destino para calcular o ST.');
    }

    const faltaNcm = estadoNfe.itens.some(i => !i.ncm);
    if (faltaNcm) avisos.push('Alguns itens não possuem NCM no XML (a MVA por combinação pode ficar genérica).');

    const faltaAliqItem = estadoNfe.itens.some(i => !i.pICMS);
    if (faltaAliqItem) avisos.push('Alguns itens não possuem pICMS no XML (serão tratados como 0%).');

    if (avisos.length) {
        warnBox.style.display = '';
        warnBox.textContent = `Atenção: ${avisos.join(' ')}`;
    } else {
        warnBox.style.display = 'none';
        warnBox.textContent = '';
    }

    // Atualiza coluna "Tipo de MVA esperado" na tabela de combos (se existir)
    atualizarTipoMvaEsperadoNosCombos();
}

function atualizarTipoMvaEsperadoNosCombos() {
    const tbody = document.getElementById('mvaCombosBody');
    if (!tbody || !tbody.children?.length || !estadoNfe) return;

    const vendedorSN = !!document.getElementById('vendedorSimples')?.checked;
    const compradorSN = !!document.getElementById('compradorSimples')?.checked;
    const internal = isOperacaoInterna(estadoNfe.ufOrig, estadoNfe.ufDest);

    Array.from(tbody.children).forEach(tr => {
        const key = tr.dataset.key;
        const combo = estadoCombos.get(key);
        const pIcms = combo?.pIcms ?? 0;

        const tipo = tipoMvaEsperado({
            internal,
            vendedorSN,
            compradorSN,
            pIcms
        });

        const cell = tr.querySelector('.combo-tipo');
        if (cell) cell.textContent = tipo;
    });
}

function tipoMvaEsperado({ internal, vendedorSN, compradorSN, pIcms }) {
    if (vendedorSN) {
        return compradorSN ? 'MVA Original Reduzida' : 'MVA Original';
    }

    if (internal) {
        return compradorSN ? 'MVA Ajustada a 12% Reduzida' : 'MVA Ajustada a 12%';
    }

    // interestadual
    const is4 = isAliquota4(pIcms);
    if (compradorSN) return is4 ? 'MVA Ajustada a 4% Reduzida' : 'MVA Ajustada a 12% Reduzida';
    return is4 ? 'MVA Ajustada a 4%' : 'MVA Ajustada a 12%';
}

function isOperacaoInterna(ufOrig, ufDest) {
    return (ufOrig || '').toUpperCase() && (ufOrig || '').toUpperCase() === (ufDest || '').toUpperCase();
}

function isAliquota4(p) {
    // regra simples: considera 4% quando <= 4,01
    return Number.isFinite(p) && p > 0 && p <= 4.01;
}

function desmarcarDestaquesMvaRef() {
    const table = document.getElementById('mvaRefTable');
    if (!table) return;
    table.querySelectorAll('tr.is-active').forEach(tr => tr.classList.remove('is-active'));
}

function destacarLinhaMvaRef(scope, rem, dest) {
    const table = document.getElementById('mvaRefTable');
    if (!table) return;

    desmarcarDestaquesMvaRef();
    const tr = table.querySelector(`tr[data-scope="${scope}"][data-rem="${rem}"][data-dest="${dest}"]`);
    tr?.classList.add('is-active');
}

/** =========================
 *  Cálculos
 *  ========================= */
function recalcularTudo() {
    if (!estadoNfe) return;

    const aliqDest = parsePtNumber(document.getElementById('aliquotaDestino')?.value || '');
    const autopecas = !!document.getElementById('produtosAutopecas')?.checked;

    const vendedorSN = !!document.getElementById('vendedorSimples')?.checked;
    const compradorSN = !!document.getElementById('compradorSimples')?.checked;
    const internal = isOperacaoInterna(estadoNfe.ufOrig, estadoNfe.ufDest);

    const tbody = document.getElementById('stItensBody');
    if (!tbody) return;

    let totalBase = 0;
    let totalSt = 0;

    Array.from(tbody.children).forEach(tr => {
        const idx = Number(tr.dataset.idx);
        const item = estadoNfe.itens.find(i => i.idx === idx);
        if (!item) return;

        const stFlag = tr.querySelector('.st-flag')?.checked;

        const mvaPct = autopecas
            ? obterMvaAutopecas({ internal, vendedorSN, compradorSN, pIcms: item.pICMS })
            : obterMvaPorCombo(item);

        const base = calcularBaseSt(item, mvaPct);

        const icmsItem = obterIcmsDoItem(item);
        const icmsStDestacado = Number.isFinite(item.vICMSST) ? item.vICMSST : 0;

        const stValor = stFlag
            ? calcularValorIcmsSt(base, aliqDest, icmsItem, icmsStDestacado)
            : 0;

        // Render
        const cellMva = tr.querySelector('.cell-mva');
        const cellBase = tr.querySelector('.cell-base');
        const cellSt = tr.querySelector('.cell-st');

        if (cellMva) cellMva.textContent = formatPercent(mvaPct, 4);
        if (cellBase) cellBase.textContent = formatBRL(base);
        if (cellSt) cellSt.textContent = formatBRL(stValor);

        if (stFlag) {
            totalBase += base;
            totalSt += stValor;
        }
    });

    setVal('r_totalBaseSt', formatBRL(totalBase));
    setVal('r_totalIcmsSt', formatBRL(totalSt));

    const xmlSt = estadoNfe.totals?.vST ?? 0;
    setVal('r_totalIcmsStXml', formatBRL(xmlSt));

    const diff = totalSt - xmlSt;
    setVal('r_diff', formatBRL(diff));
}

function obterMvaPorCombo(item) {
    const ncm = (item.ncm || '').trim() || '(sem NCM)';
    const p = Number.isFinite(item.pICMS) ? item.pICMS : 0;
    const key = `${ncm}__${p.toFixed(4)}`;

    const combo = estadoCombos.get(key);
    return combo?.mvaPct ?? 0;
}

function obterMvaAutopecas({ internal, vendedorSN, compradorSN, pIcms }) {
    // Valores vindos dos inputs (editáveis)
    const mvaOrig = parsePtNumber(document.getElementById('autoMvaOriginal')?.value || '');
    const mva12 = parsePtNumber(document.getElementById('autoMvaAjustada12')?.value || '');
    const mva4 = parsePtNumber(document.getElementById('autoMvaAjustada4')?.value || '');

    // Pela sua tabela: se remetente é SN → usa MVA Original (mesmo em interestadual)
    if (vendedorSN) return Number.isFinite(mvaOrig) ? mvaOrig : 0;

    // Remetente normal:
    if (internal) return Number.isFinite(mva12) ? mva12 : 0;

    // interestadual: 12% ou 4% conforme pICMS do item
    const is4 = isAliquota4(pIcms);
    return is4 ? (Number.isFinite(mva4) ? mva4 : 0) : (Number.isFinite(mva12) ? mva12 : 0);
}

function calcularBaseSt(item, mvaPct) {
    const vProd = num(item.vProd);
    const vIPI = num(item.vIPI);
    const vOutro = num(item.vOutro);
    const vFrete = num(item.vFrete);
    const vSeg = num(item.vSeg);
    const vDesc = num(item.vDesc);

    const baseSemMva = (vProd + vIPI + vOutro + vFrete + vSeg - vDesc);
    const fator = 1 + (num(mvaPct) / 100);

    return arred2(baseSemMva * fator);
}

function obterIcmsDoItem(item) {
    // Prioriza vICMS se existir; senão tenta vBC * pICMS
    const vICMS = num(item.vICMS);
    if (vICMS !== 0) return vICMS;

    const vBC = num(item.vBC);
    const pICMS = num(item.pICMS);
    if (vBC > 0 && pICMS > 0) {
        return arred2(vBC * (pICMS / 100));
    }
    return 0;
}

function calcularValorIcmsSt(baseSt, aliqDestPct, icmsItem) {
    const aliq = num(aliqDestPct) / 100;
    const valor = (num(baseSt) * aliq) - num(icmsItem)
    return arred2(valor);
}

/** =========================
 *  Utils
 *  ========================= */
function lerArquivoComoTexto(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsText(file);
    });
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function setMsgEntrada(msg) {
    const el = document.getElementById('msgEntrada');
    if (el) el.textContent = msg || '';
}

function log(msg) {
    const el = document.getElementById('logBox');
    if (!el) return;
    const time = new Date().toLocaleTimeString('pt-BR');
    el.textContent = `[${time}] ${msg}`;
}

function parsePtNumber(value) {
    if (typeof value === 'number') return value;

    let s = String(value ?? '').trim();
    if (!s) return 0;

    // remove espaços
    s = s.replace(/\s/g, '');

    const hasComma = s.includes(',');
    const hasDot = s.includes('.');

    // Caso 1: tem vírgula -> geralmente PT-BR (1.234,56)
    if (hasComma) {
        // remove separadores de milhar (.)
        s = s.replace(/\./g, '');
        // vírgula vira decimal
        s = s.replace(/,/g, '.');
        const n = Number(s);
        return Number.isFinite(n) ? n : 0;
    }

    // Caso 2: não tem vírgula, mas tem ponto -> pode ser decimal do XML (123.45)
    if (hasDot) {
        // Heurística: se o último bloco tiver 3 dígitos, é provável milhar (1.234)
        const parts = s.split('.');
        const last = parts[parts.length - 1];
        if (last.length === 3 && parts.length > 1) {
            s = s.replace(/\./g, ''); // trata como milhar
        } else {
            s = s.replace(/,/g, ''); // remove vírgula caso exista como milhar (raro)
        }
        const n = Number(s);
        return Number.isFinite(n) ? n : 0;
    }

    // Caso 3: só dígitos (ou com sinal)
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
}


function formatBRL(n) {
    const v = Number.isFinite(n) ? n : 0;
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercent(n, maxFrac = 2) {
    const v = Number.isFinite(n) ? n : 0;
    return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: maxFrac })}%`;
}

function arred2(n) {
    const v = Number.isFinite(n) ? n : 0;
    return Math.round(v * 100) / 100;
}

function num(n) {
    return Number.isFinite(n) ? n : 0;
}

function escapeHtml(str) {
    return String(str || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}
