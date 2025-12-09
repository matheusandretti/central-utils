// public/js/upload-helper.js

(function () {
  const enhancedInputs = [];
  let pageDnDInitialized = false;

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function enhanceFileInput(input) {
    if (!input || input.dataset.wlUploadEnhanced === '1') return;
    input.dataset.wlUploadEnhanced = '1';

    enhancedInputs.push(input);

    // Área de drop "local": tenta usar o label estilizado; se não achar, usa o pai
    const area =
      input.closest('.nfe-input-file-label') ||
      input.closest('.wl-upload-area') ||
      input.parentElement;

    if (!area) return;

    // Cria (ou reaproveita) um elemento para mostrar os arquivos selecionados
    let summaryEl = area.nextElementSibling;
    if (!summaryEl || !summaryEl.classList.contains('wl-upload-summary')) {
      summaryEl = document.createElement('div');
      summaryEl.className = 'wl-upload-summary';
      summaryEl.textContent = 'Nenhum arquivo selecionado.';
      area.insertAdjacentElement('afterend', summaryEl);
    }

    function formatFiles(files) {
      if (!files || files.length === 0) {
        return 'Nenhum arquivo selecionado.';
      }
      if (files.length === 1) {
        return files[0].name;
      }
      if (files.length <= 5) {
        const names = Array.from(files).map((f) => f.name).join(', ');
        return `${files.length} arquivos: ${names}`;
      }
      const names = Array.from(files)
        .slice(0, 5)
        .map((f) => f.name)
        .join(', ');
      return `${files.length} arquivos selecionados (mostrando 5): ${names}`;
    }

    function updateSummary() {
      summaryEl.textContent = formatFiles(input.files);
    }

    // Deixa acessível para o drop global
    input.__wlUpdateSummary = updateSummary;

    input.addEventListener('change', updateSummary);

    // -----------------------
    // Drag & Drop LOCAL (no botão/label)
    // -----------------------
    ['dragenter', 'dragover'].forEach((eventName) => {
      area.addEventListener(eventName, (e) => {
        preventDefaults(e);
        area.classList.add('wl-upload-area--dragover');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      area.addEventListener(eventName, (e) => {
        preventDefaults(e);
        if (eventName === 'drop') {
          const dt = e.dataTransfer;
          if (dt && dt.files && dt.files.length) {
            const droppedFiles = dt.files;

            if (window.DataTransfer) {
              const dataTransfer = new DataTransfer();
              const max = input.multiple ? droppedFiles.length : 1;
              for (let i = 0; i < max; i += 1) {
                dataTransfer.items.add(droppedFiles[i]);
              }
              input.files = dataTransfer.files;
            } else {
              try {
                input.files = droppedFiles;
              } catch (err) {
                console.warn('Não foi possível atribuir files via drop:', err);
              }
            }

            updateSummary();
          }
        }
        area.classList.remove('wl-upload-area--dragover');
      });
    });

    // Estado inicial
    updateSummary();
  }

  function getPrimaryFileInput() {
    if (!enhancedInputs.length) return null;

    // Se algum input estiver marcado como "primário", usa ele
    const preferred = enhancedInputs.find(
      (inp) => inp.dataset.wlPrimaryUpload === '1'
    );
    if (preferred) return preferred;

    // Senão, usa o primeiro da página (na maioria das telas só existe um mesmo)
    return enhancedInputs[0];
  }

  // -----------------------
  // Drag & Drop GLOBAL (qualquer lugar da página)
  // -----------------------
  function initGlobalPageDragDrop() {
    if (pageDnDInitialized) return;
    pageDnDInitialized = true;

    let dragCounter = 0;

    document.addEventListener('dragenter', (e) => {
      preventDefaults(e);
      dragCounter += 1;
      document.body.classList.add('wl-page-dragover');
    });

    document.addEventListener('dragover', (e) => {
      preventDefaults(e);
    });

    document.addEventListener('dragleave', (e) => {
      preventDefaults(e);
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) {
        document.body.classList.remove('wl-page-dragover');
      }
    });

    document.addEventListener('drop', (e) => {
      preventDefaults(e);
      dragCounter = 0;
      document.body.classList.remove('wl-page-dragover');

      // Se o drop foi dentro de uma área de upload específica,
      // ela já tratou o evento (por causa do stopPropagation)
      // Aqui tratamos o drop "no resto da página"
      const dt = e.dataTransfer;
      if (!dt || !dt.files || !dt.files.length) return;

      const input = getPrimaryFileInput();
      if (!input) return;

      const droppedFiles = dt.files;

      if (window.DataTransfer) {
        const dataTransfer = new DataTransfer();
        const max = input.multiple ? droppedFiles.length : 1;
        for (let i = 0; i < max; i += 1) {
          dataTransfer.items.add(droppedFiles[i]);
        }
        input.files = dataTransfer.files;
      } else {
        try {
          input.files = droppedFiles;
        } catch (err) {
          console.warn('Não foi possível atribuir files via drop (global):', err);
        }
      }

      if (typeof input.__wlUpdateSummary === 'function') {
        input.__wlUpdateSummary();
      } else {
        const event = new Event('change', { bubbles: true });
        input.dispatchEvent(event);
      }
    });
  }

  function initAllFileUploads() {
    const fileInputs = document.querySelectorAll('input[type="file"]');
    fileInputs.forEach(enhanceFileInput);

    if (fileInputs.length > 0) {
      initGlobalPageDragDrop();
    }
  }

  document.addEventListener('DOMContentLoaded', initAllFileUploads);
})();
