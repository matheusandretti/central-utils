// public/js/sidebar.js

// Configuração única do menu lateral
const MENU_CONFIG = [
  {
    id: 'pessoal',
    label: 'Pessoal',
    icon: '🙂',
    items: [
      {
        id: 'ferias-funcionario',
        label: 'Férias por Funcionário',
        href: '/separador-ferias-funcionario',
        icon: '🏖️',
      },
      {
        id: 'holerites-empresa',
        label: 'Holerites por Empresa',
        href: '/separador-holerites-por-empresa',
        icon: '📄',
      },
      {
        id: 'relatorio-ferias',
        label: 'Relatório de Férias por Empresa',
        href: '/separador-pdf-relatorio-de-ferias',
        icon: '📑',
      },
    ],
  },
  {
    id: 'fiscal',
    label: 'Fiscal',
    icon: '📁',
    items: [
      {
        id: 'nfe',
        label: 'Consulta NF-e',
        href: '/nfe',
        icon: '🧾',
      },
      {
        id: 'sn',
        label: 'Declaração SN',
        href: '/sn',
        icon: '📄',
      },
    ],
  },
  {
    id: 'contabil',
    label: 'Contábil',
    icon: '📊',
    items: [
      {
        id: 'acertos-lotes-internets',
        label: 'Acertos Lotes Internets',
        href: '/acertos-lotes-internets',
        icon: '📊',
      },
      {
        id: 'acerto-lotes-toscan',
        label: 'Acerto Lotes Toscan',
        href: '/acerto-lotes-toscan',
        icon: '📄',
      },
      {
        id: 'importador-recebimentos-madre-scp',
        label: 'Importador Recebimentos Madre SCP',
        href: '/importador-recebimentos-madre-scp',
        icon: '📊',
      },
    ],
  },
  {
    id: 'financeiro',
    label: 'Financeiro',
    icon: '💰',
    items: [
      {
        id: 'financeiro-home',
        label: 'Ver ferramentas na home',
        href: '/home.html#financeiro',
        icon: '🏷️',
      },
    ],
  },
  {
    id: 'geral',
    label: 'Geral',
    icon: '🧰',
    items: [
      {
        id: 'gerador-atas',
        label: 'Gerador de Atas',
        icon: '📑',
        href: '/gerador-atas'
      },
      {
        id: 'comprimir-pdf',
        label: 'Comprimir PDF',
        icon: '🧩',
        href: '/comprimir-pdf'
      },
      {
        id: 'extrator-zip-rar',
        label: 'Extrator ZIP/RAR',
        href: '/extrator-zip-rar',
        icon: '📦',
      },
      {
        id: 'excel-abas-pdf',
        label: 'Excel → Abas em PDF',
        icon: '📄',
        href: '/excel-abas-pdf',
      },
    ],
  },
  {
    id: 'ti',
    label: 'Desenvolvendo',
    icon: '🛠️',
    items: [
      {
        id: 'ti-home',
        label: 'Ver ferramentas na home',
        href: '/home.html#ti',
        icon: '🏷️',
      },
    ],
  },
];

function gerarSidebarHtml(activePageId) {
  let html = `
    <a href="/home.html" class="nfe-menu-item">
      <span class="icon">🏠</span>
      <span class="label">Início</span>
    </a>
  `;

  MENU_CONFIG.forEach((group) => {
    const hasActive = group.items.some((item) => item.id === activePageId);
    const openClass = hasActive ? 'open' : '';

    html += `
      <div class="nfe-menu-group ${openClass}" data-group="${group.id}">
        <button type="button" class="nfe-menu-group-header">
          <span class="icon">${group.icon}</span>
          <span class="label">${group.label}</span>
          <span class="chevron">›</span>
        </button>
        <div class="nfe-menu-subitems">
    `;

    group.items.forEach((item) => {
      const activeClass = item.id === activePageId ? ' active' : '';
      html += `
        <a href="${item.href}"
           class="nfe-menu-item nfe-menu-subitem${activeClass}">
          <span class="icon">${item.icon}</span>
          <span class="label">${item.label}</span>
        </a>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  return html;
}

// Função global para ser chamada em cada página
function inicializarSidebar(activePageId) {
  const nav = document.getElementById('sidebarMenu');
  if (!nav) return;

  // Monta o HTML do menu
  nav.innerHTML = gerarSidebarHtml(activePageId);

  const layout = document.querySelector('.nfe-layout');
  const sidebarToggle = document.getElementById('sidebarToggle');

  // Botão hamburguer (recolher/expandir)
  if (layout && sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      layout.classList.toggle('collapsed');
    });
  }

  // Abre/fecha grupo ao clicar no departamento
  nav.querySelectorAll('.nfe-menu-group-header').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.nfe-menu-group');
      if (group) {
        group.classList.toggle('open');
      }
    });
  });
}
