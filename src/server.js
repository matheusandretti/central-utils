const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const multer = require('multer');
const { Server } = require('socket.io');
const cors = require('cors'); // <<< NOVO
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const axios = require('axios'); // para chamar a API Integra Contador
const { autenticarSerpro } = require("./serpro-auth");
const { Pool } = require('pg'); // << ADICIONE ESTA LINHA
const archiver = require('archiver');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

const FERIAS_FUNC_DIR = path.join(DATA_DIR, 'ferias-funcionario');
if (!fs.existsSync(FERIAS_FUNC_DIR)) {
  fs.mkdirSync(FERIAS_FUNC_DIR, { recursive: true });
}

// Arquivo de resumo do SN (apenas um)
const SN_SUMMARY_FILE = path.join(DATA_DIR, 'sn_summary.json');

const {
  JOB_STATUS,
  createJobsFromKeys,
  getAllJobs,
  getSummary,
  getNextJob,
  updateJob,
  findJobByKey,
  deleteJobsByStatus,
} = require('./queue');

const { parseFileToKeys } = require('./parsers');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const MAIN_UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(MAIN_UPLOAD_DIR)) {
  fs.mkdirSync(MAIN_UPLOAD_DIR, { recursive: true });
}

const upload = multer({
  dest: MAIN_UPLOAD_DIR,
  storage: multer.memoryStorage(),
});

const EXCEL_ABAS_PDF_DIR = path.join(DATA_DIR, 'excel-abas-pdf');
if (!fs.existsSync(EXCEL_ABAS_PDF_DIR)) {
  fs.mkdirSync(EXCEL_ABAS_PDF_DIR, { recursive: true });
}

// Próximo de outras configurações, usando o mesmo DATA_DIR se já existir
const uploadsDir = path.join(DATA_DIR, 'uploads', 'separador-ferias');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const extratorZipRarUploadsDir = path.join(DATA_DIR, 'uploads', 'extrator-zip-rar');
if (!fs.existsSync(extratorZipRarUploadsDir)) {
  fs.mkdirSync(extratorZipRarUploadsDir, { recursive: true });
}

const uploadExtratorZipRar = multer({
  dest: extratorZipRarUploadsDir,
});

const uploadSeparadorFerias = multer({
  dest: uploadsDir,
});

const uploadMadreScp = multer({
  dest: path.join(DATA_DIR, 'uploads', 'madre-scp'),
});

// Diretório para uploads do Ajuste Diário GFBR
const ajusteDiarioGfbrUploadsDir = path.join(DATA_DIR, 'uploads', 'ajuste-diario-gfbr');
if (!fs.existsSync(ajusteDiarioGfbrUploadsDir)) {
  fs.mkdirSync(ajusteDiarioGfbrUploadsDir, { recursive: true });
}

const storageAjusteDiarioGfbr = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, ajusteDiarioGfbrUploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '.xlsx';
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + ext);
  },
});

const uploadAjusteDiarioGfbr = multer({
  storage: storageAjusteDiarioGfbr,
});

const SEPARADOR_CSV_BASE_DIR = path.join(DATA_DIR, 'separador-csv-baixa-automatica');
const SEPARADOR_CSV_UPLOAD_DIR = path.join(SEPARADOR_CSV_BASE_DIR, 'uploads');
const SEPARADOR_CSV_OUTPUT_DIR = path.join(SEPARADOR_CSV_BASE_DIR, 'outputs');

// Middleware de upload exclusivo para esta ferramenta
const uploadSeparadorCsv = multer({
  dest: SEPARADOR_CSV_UPLOAD_DIR,
});
// ---------- MIDDLEWARES GERAIS ----------

// CORS liberado para a extensão (Chrome/Firefox)
app.use(
  cors({
    origin: '*', // se quiser, depois restringe pra 'http://localhost:3000' ou similar
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);

// servir arquivos estáticos (index.html, styles.css, etc.)
app.use(express.static(path.join(__dirname, '..', 'public')));

const publicDir = path.join(__dirname, '..', 'public');

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'home.html')); // sua tela de cards
});

app.get('/nfe', (req, res) => {
  res.sendFile(path.join(publicDir, 'nfe.html'));  // nova tela modernizada
});

// para conseguir ler JSON do body (usado em /api/mark-done e SN)
app.use(express.json());

// <<< ROTAS DA EXTENSÃO / API >>>

// teste simples (usado no popup da extensão)
app.get('/api/ping', (req, res) => {
  res.send('ok');
});

// devolve a próxima chave pendente para a extensão
app.get('/api/next-key', (req, res) => {
  const job = getNextJob();

  if (!job) {
    return res.json({ key: null });
  }

  // marcamos como PROCESSING para não ser pego de novo
  updateJob(job.id, { status: JOB_STATUS.PROCESSING });
  broadcastJobUpdate(job);

  res.json({ key: job.key });
});

// marca uma chave como concluída (quando o XML já foi baixado)
app.post('/api/mark-done', (req, res) => {
  const { key } = req.body;

  if (!key) {
    return res.status(400).json({ error: 'Chave não informada' });
  }

  const job = findJobByKey(key);
  if (!job) {
    return res.status(404).json({ error: 'Job não encontrado para essa chave' });
  }

  updateJob(job.id, {
    status: JOB_STATUS.DONE,
    errorMessage: null,
  });

  broadcastJobUpdate(job);

  res.json({ ok: true });
});

// <<< ROTAS JÁ EXISTENTES >>>

app.post('/api/clear-pending', (req, res) => {
  try {
    // removemos jobs PENDING e PROCESSING de vez
    const removedCount = deleteJobsByStatus([
      JOB_STATUS.PENDING,
      JOB_STATUS.PROCESSING,
    ]);

    io.emit('queue_update', {
      summary: getSummary(),
      jobs: getAllJobs(),
    });

    res.json({ ok: true, removed: removedCount });
  } catch (err) {
    console.error("Erro ao limpar pendentes:", err);
    res.status(500).json({ error: "Erro ao limpar chaves pendentes." });
  }
});

app.post('/api/clear-done', (req, res) => {
  try {
    const removedCount = deleteJobsByStatus([JOB_STATUS.DONE]);

    io.emit('queue_update', {
      summary: getSummary(),
      jobs: getAllJobs(),
    });

    res.json({ ok: true, removed: removedCount });
  } catch (err) {
    console.error("Erro ao limpar concluídos:", err);
    res.status(500).json({ error: "Erro ao limpar chaves concluídas." });
  }
});

app.post('/api/clear-errors', (req, res) => {
  try {
    const removedCount = deleteJobsByStatus([JOB_STATUS.ERROR]);

    io.emit('queue_update', {
      summary: getSummary(),
      jobs: getAllJobs(),
    });

    res.json({ ok: true, removed: removedCount });
  } catch (err) {
    console.error("Erro ao limpar erros:", err);
    res.status(500).json({ error: "Erro ao limpar chaves com erro." });
  }
});


// endpoint de upload do arquivo com chaves
// endpoint de upload do arquivo com chaves
app.post('/upload', upload.single('file'), async (req, res) => {
  let tempFilePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo não enviado' });
    }

    // garante que a pasta de uploads exista (já foi criada lá em cima, mas por segurança)
    if (!fs.existsSync(MAIN_UPLOAD_DIR)) {
      fs.mkdirSync(MAIN_UPLOAD_DIR, { recursive: true });
    }

    // cria um arquivo temporário a partir do buffer em memória (memoryStorage)
    tempFilePath = path.join(
      MAIN_UPLOAD_DIR,
      `${Date.now()}-${req.file.originalname}`
    );

    fs.writeFileSync(tempFilePath, req.file.buffer);

    // agora o parser continua igual, baseado em caminho de arquivo
    const keys = parseFileToKeys(tempFilePath, req.file.originalname);
    const createdJobs = createJobsFromKeys(keys);

    // emitir atualização da fila para todos conectados
    io.emit('queue_update', {
      summary: getSummary(),
      jobs: getAllJobs(),
    });

    return res.json({
      message: `Arquivo processado. ${createdJobs.length} chaves adicionadas à fila.`,
      count: createdJobs.length,
    });
  } catch (err) {
    console.error('Erro ao processar upload:', err);
    return res.status(500).json({ error: 'Erro ao processar arquivo' });
  } finally {
    // tenta apagar o arquivo temporário, se foi criado
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlink(tempFilePath, (unlinkErr) => {
        if (unlinkErr) {
          console.error(
            'Não foi possível apagar arquivo temporário de upload:',
            unlinkErr
          );
        }
      });
    }
  }
});

// endpoint para pegar estado atual (útil quando entrar na página)
app.get('/status', (req, res) => {
  res.json({
    summary: getSummary(),
    jobs: getAllJobs(),
  });
});

// quando um cliente conecta via WebSocket
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);
  // manda estado atual
  socket.emit('queue_update', {
    summary: getSummary(),
    jobs: getAllJobs(),
  });
});

// função utilitária para o worker/qualquer um emitir atualizações
function broadcastJobUpdate(job) {
  io.emit('job_update', job);
  io.emit('queue_update', {
    summary: getSummary(),
    jobs: getAllJobs(),
  });
}

module.exports = {
  server,
  broadcastJobUpdate,
};

// ----------------------------------------------------------------------
// SIMPLES NACIONAL – CADASTRO, RESUMO E DECLARAÇÃO EM LOTE
// ----------------------------------------------------------------------

// pasta de dados (para empresas SN e resumo de consumo)

const SN_COMPANIES_FILE = path.join(DATA_DIR, 'sn_companies.json');

// ---------- FUNÇÕES AUXILIARES (EMPRESAS SN) ----------

function loadSnCompanies() {
  if (!fs.existsSync(SN_COMPANIES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SN_COMPANIES_FILE, 'utf-8'));
  } catch (e) {
    console.error('Erro ao ler sn_companies.json:', e);
    return [];
  }
}

function saveSnCompanies(companies) {
  fs.writeFileSync(SN_COMPANIES_FILE, JSON.stringify(companies, null, 2));
}

// ---------- FUNÇÕES AUXILIARES (RESUMO DE CONSUMO SN) ----------

function loadSnSummary() {
  if (!fs.existsSync(SN_SUMMARY_FILE)) {
    return {
      totalRequisicoes: 0,
      totalSucesso: 0,
      totalErro: 0,
      ultimaAtualizacao: null,
    };
  }
  try {
    return JSON.parse(fs.readFileSync(SN_SUMMARY_FILE, 'utf-8'));
  } catch (e) {
    console.error('Erro ao ler sn_summary.json:', e);
    return {
      totalRequisicoes: 0,
      totalSucesso: 0,
      totalErro: 0,
      ultimaAtualizacao: null,
    };
  }
}

function saveSnSummary(summary) {
  summary.ultimaAtualizacao = new Date().toISOString();
  fs.writeFileSync(SN_SUMMARY_FILE, JSON.stringify(summary, null, 2));
}

function registrarSnResultado(sucesso) {
  const summary = loadSnSummary();
  summary.totalRequisicoes += 1;
  if (sucesso) summary.totalSucesso += 1;
  else summary.totalErro += 1;
  saveSnSummary(summary);
  return summary;
}

// ----------------------------------------------------------------------
// SIMPLES NACIONAL – DB (Postgres), resumo e envio/consulta em lote
// ----------------------------------------------------------------------

// Pool do Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ---------- FUNÇÕES AUXILIARES: EMPRESAS (Postgres) ----------

async function dbGetSnCompanies() {
  const result = await pool.query(
    'SELECT id, cnpj, razao_social FROM sn_companies ORDER BY razao_social'
  );
  return result.rows.map((r) => ({
    id: r.id,
    cnpj: r.cnpj,
    razaoSocial: r.razao_social,
  }));
}

async function dbCreateSnCompany(cnpj, razaoSocial) {
  const result = await pool.query(
    'INSERT INTO sn_companies (cnpj, razao_social) VALUES ($1, $2) RETURNING id, cnpj, razao_social',
    [cnpj, razaoSocial]
  );
  const r = result.rows[0];
  return {
    id: r.id,
    cnpj: r.cnpj,
    razaoSocial: r.razao_social,
  };
}

// ---------- FUNÇÕES AUXILIARES: RECIBOS (Postgres) ----------

async function dbGetReceiptByCompanyAndPa(companyId, pa) {
  const result = await pool.query(
    'SELECT id FROM sn_receipts WHERE company_id = $1 AND pa = $2',
    [companyId, pa]
  );
  return result.rows[0] || null;
}

async function dbSaveReceipt(companyId, pa, pdfBuffer) {
  const result = await pool.query(
    'INSERT INTO sn_receipts (company_id, pa, pdf) VALUES ($1, $2, $3) RETURNING id',
    [companyId, pa, pdfBuffer]
  );
  return result.rows[0];
}

async function dbGetReceiptById(id) {
  const result = await pool.query(
    'SELECT pdf FROM sn_receipts WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

async function dbGetReceiptsByIds(ids) {
  if (!ids || ids.length === 0) return [];

  const result = await pool.query(
    `
      SELECT
        r.id,
        r.company_id,
        r.pa,
        r.pdf,
        c.cnpj,
        c.razao_social
      FROM sn_receipts r
      JOIN sn_companies c ON c.id = r.company_id
      WHERE r.id = ANY($1::int[])
    `,
    [ids]
  );

  return result.rows;
}

// ---------- FUNÇÕES AUXILIARES: RESUMO (JSON) ----------

function loadSnSummary() {
  if (!fs.existsSync(SN_SUMMARY_FILE)) {
    return {
      totalOperacoes: 0,      // declarações + consultas
      totalDeclaracoes: 0,
      totalConsultas: 0,
      totalSucesso: 0,
      totalErro: 0,
      valorTotal: 0,          // em R$
      ultimaAtualizacao: null,
    };
  }
  try {
    return JSON.parse(fs.readFileSync(SN_SUMMARY_FILE, 'utf-8'));
  } catch (e) {
    console.error('Erro ao ler sn_summary.json:', e);
    return {
      totalOperacoes: 0,
      totalDeclaracoes: 0,
      totalConsultas: 0,
      totalSucesso: 0,
      totalErro: 0,
      valorTotal: 0,
      ultimaAtualizacao: null,
    };
  }
}

function saveSnSummary(summary) {
  summary.ultimaAtualizacao = new Date().toISOString();
  fs.writeFileSync(SN_SUMMARY_FILE, JSON.stringify(summary, null, 2));
}

// mesma tabela de preço que você já tinha
function calculateDeclarationCost(consumption) {
  if (consumption <= 100) return 0.40;
  if (consumption <= 500) return 0.36;
  if (consumption <= 1_000) return 0.32;
  if (consumption <= 3_000) return 0.28;
  if (consumption <= 5_000) return 0.24;
  if (consumption <= 8_000) return 0.20;
  if (consumption <= 10_000) return 0.16;
  return 0.12;
}

/**
 * tipoOperacao: 'declaracao' | 'consulta'
 */
function registrarSnResultado(sucesso, tipoOperacao) {
  const summary = loadSnSummary();

  summary.totalOperacoes += 1;
  if (tipoOperacao === 'declaracao') summary.totalDeclaracoes += 1;
  if (tipoOperacao === 'consulta') summary.totalConsultas += 1;
  if (sucesso) summary.totalSucesso += 1;
  else summary.totalErro += 1;

  const unitPrice = calculateDeclarationCost(summary.totalOperacoes);
  summary.valorTotal += unitPrice;

  saveSnSummary(summary);
  return summary;
}

function buildResumoResponse() {
  const summary = loadSnSummary();
  const consumoAtual = summary.totalOperacoes;
  const precoUnitario = calculateDeclarationCost(consumoAtual);
  return {
    consumoAtual,
    totalDeclaracoes: summary.totalDeclaracoes,
    totalConsultas: summary.totalConsultas,
    totalSucesso: summary.totalSucesso,
    totalErro: summary.totalErro,
    precoUnitario,
    valorTotal: summary.valorTotal,
    ultimaAtualizacao: summary.ultimaAtualizacao,
  };
}

// ----------------------------------------------------------------------
// ACERTOS LOTES INTERNETS – CONTÁBIL
// ----------------------------------------------------------------------

// Palavras-chave iguais ao script Python original
const LOTE_INTERNETS_KEYWORDS = [
  'rendimento',
  'desconto obtido',
  'pagamento',
  'pagar',
  'adiantamento a fornecedor',
  'adiantamento ao fornecedor',
  'distribuicao',
  'transf. caixa',
  'cesta de relacionamento',
  'tarifa cobranca',
];

function loteInternetsHistoricoContemPalavra(linhaH) {
  if (!linhaH) return false;
  const texto = String(linhaH).toLowerCase();
  return LOTE_INTERNETS_KEYWORDS.some((palavra) => texto.includes(palavra));
}

function processarLoteInternetsConteudo(conteudo) {
  if (typeof conteudo !== 'string') {
    conteudo = conteudo ? String(conteudo) : '';
  }

  // Descobre se o arquivo original usava CRLF (\r\n) ou LF (\n)
  const usaCRLF = conteudo.includes('\r\n');
  const separador = usaCRLF ? '\r\n' : '\n';

  // Quebra em linhas (mantendo linhas vazias no array)
  const linhas = conteudo.split(/\r?\n/);

  const linhasMantidas = [];
  const linhasRemovidas = [];

  let i = 0;
  while (i < linhas.length) {
    const linhaAtual = linhas[i];

    if (linhaAtual && linhaAtual.startsWith('L') && i + 1 < linhas.length) {
      const proximaLinha = linhas[i + 1];

      if (
        proximaLinha &&
        proximaLinha.startsWith('H') &&
        loteInternetsHistoricoContemPalavra(proximaLinha)
      ) {
        // Remove L e H (adiciona ambas à lista de removidas)
        linhasRemovidas.push(linhaAtual, proximaLinha);
        i += 2;
        continue;
      }
    }

    // Caso não tenha sido removida, mantemos a linha atual
    linhasMantidas.push(linhaAtual);
    i += 1;
  }

  const processedContent = linhasMantidas.join(separador);
  const removedContent = linhasRemovidas.join(separador);

  return {
    totalLines: linhas.length,
    keptLines: linhasMantidas.length,
    removedLines: linhasRemovidas.length,
    removedPairs: Math.floor(linhasRemovidas.length / 2),
    processedContent,
    removedContent,
  };
}

function getTextFromUploadedFile(file) {
  if (!file) return '';
  // Preferencialmente memória (multer.memoryStorage)
  if (file.buffer) {
    return file.buffer.toString('utf-8');
  }
  // Fallback: se estiver gravado em disco
  if (file.path && fs.existsSync(file.path)) {
    return fs.readFileSync(file.path, 'utf-8');
  }
  return '';
}
// ---------- ROTAS DE PÁGINA ----------

async function criarZipComPdfs(pastaPdfs, destinoZip) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destinoZip);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(pastaPdfs, false);
    archive.finalize();
  });
}

app.get('/sn', (req, res) => {
  res.sendFile(path.join(publicDir, 'sn.html'));
});

// ---------- ROTAS API SN: EMPRESAS + RESUMO + RECIBO ----------

// lista empresas cadastradas (Postgres)
app.get('/api/sn/companies', async (req, res) => {
  try {
    const companies = await dbGetSnCompanies();
    res.json(companies);
  } catch (err) {
    console.error('Erro ao listar empresas SN:', err);
    res.status(500).json({ error: 'Erro ao listar empresas.' });
  }
});

// cadastra nova empresa SN
app.post('/api/sn/companies', async (req, res) => {
  try {
    const { cnpj, razaoSocial } = req.body;

    if (!cnpj || !razaoSocial) {
      return res
        .status(400)
        .json({ error: 'Campos obrigatórios: cnpj e razaoSocial.' });
    }

    const existing = await pool.query(
      'SELECT 1 FROM sn_companies WHERE cnpj = $1',
      [cnpj]
    );
    if (existing.rowCount > 0) {
      return res
        .status(400)
        .json({ error: 'Já existe empresa cadastrada com este CNPJ.' });
    }

    const newCompany = await dbCreateSnCompany(cnpj, razaoSocial);
    res.status(201).json(newCompany);
  } catch (err) {
    console.error('Erro ao cadastrar empresa SN:', err);
    res.status(500).json({ error: 'Erro ao cadastrar empresa.' });
  }
});

// resumo de consumo (inclui valor total em R$)
app.get('/api/sn/summary', (req, res) => {
  try {
    res.json(buildResumoResponse());
  } catch (err) {
    console.error('Erro ao carregar resumo SN:', err);
    res.status(500).json({ error: 'Erro ao carregar resumo.' });
  }
});

// download de recibo em PDF
app.get('/api/sn/receipt/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).send('ID inválido');

  try {
    const receipt = await dbGetReceiptById(id);
    if (!receipt) return res.status(404).send('Recibo não encontrado');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="recibo-sn-${receipt.cnpj || 'cnpj'}-${receipt.pa}.pdf"`
    );
    res.send(receipt.pdf); // Buffer do BYTEA
  } catch (err) {
    console.error('Erro ao buscar recibo:', err);
    res.status(500).send('Erro ao buscar recibo');
  }
});

// ---------- ROTA: DOWNLOAD ZIP COM VÁRIOS RECIBOS ----------
// ---------- ROTA: DOWNLOAD ZIP COM VÁRIOS RECIBOS ----------
app.post('/api/sn/receipts/batch-download', async (req, res) => {
  try {
    const { receiptIds } = req.body;

    if (!Array.isArray(receiptIds) || receiptIds.length === 0) {
      return res
        .status(400)
        .json({ error: 'Nenhum recibo selecionado para download.' });
    }

    const idsNum = receiptIds.map(Number).filter((n) => !isNaN(n));

    const receipts = await dbGetReceiptsByIds(idsNum);

    if (!receipts || receipts.length === 0) {
      return res.status(404).json({ error: 'Recibos não encontrados.' });
    }

    const nomeZip = `recibos-sn-${Date.now()}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${nomeZip}"`
    );

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
      console.error('Erro ao gerar ZIP:', err);
      if (!res.headersSent) {
        res.status(500).end();
      }
    });

    archive.pipe(res);

    for (const r of receipts) {
      const cnpj = (r.cnpj || '').replace(/\D/g, '') || `company${r.company_id}`;
      const paStr = String(r.pa);
      const filename = `RECIBO-${cnpj}-${paStr}.pdf`;

      archive.append(r.pdf, { name: filename });
    }

    archive.finalize();
  } catch (err) {
    console.error('Erro geral no batch-download de recibos SN:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erro ao gerar ZIP de recibos.' });
    }
  }
});

// ---------- ROTA: DECLARAÇÃO SN EM LOTE ----------

app.post('/api/sn/declaration', async (req, res) => {
  try {
    const {
      pa,                         // já no formato AAAAMM (montado no front a partir de mês/ano)
      tipoDeclaracao = 1,
      receitaInterna = 0,
      receitaExterna = 0,
      indicadorTransmissao = true,
      indicadorComparacao = false,
      valoresParaComparacao = null,
      complemento = null,
      estabelecimentos: estabelecimentosEntrada = null,
      companyIds = null,
      all = false,
    } = req.body;

    const contratante = process.env.CONTRATANTE_CNPJ;

    if (!pa) {
      return res
        .status(400)
        .json({ error: 'Período de apuração (pa) é obrigatório.' });
    }

    // empresas que serão processadas
    const empresasCadastradas = await dbGetSnCompanies();
    let empresasParaProcessar = [];

    if (all || (Array.isArray(companyIds) && companyIds.length > 0)) {
      if (all) {
        empresasParaProcessar = empresasCadastradas;
      } else {
        const idsNum = companyIds.map(Number);
        empresasParaProcessar = empresasCadastradas.filter((c) =>
          idsNum.includes(c.id)
        );
      }
    } else {
      return res
        .status(400)
        .json({ error: 'Selecione pelo menos uma empresa.' });
    }

    if (empresasParaProcessar.length === 0) {
      return res
        .status(400)
        .json({ error: 'Nenhuma empresa encontrada para processar.' });
    }

    // autenticação Serpro
    const { access_token, jwt_token } = await autenticarSerpro();

    if (!access_token || !jwt_token) {
      return res.status(500).json({
        error:
          'access_token ou jwt_token não retornado pelo SERPRO. Verifique o endpoint /authenticate e as credenciais.',
      });
    }

    const headers = {
      Authorization: 'Bearer ' + access_token,
      jwt_token: jwt_token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const url =
      'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Declarar';

    const resultados = [];

    for (const empresa of empresasParaProcessar) {
      try {
        let estabelecimentos;

        if (Array.isArray(estabelecimentosEntrada) && estabelecimentosEntrada.length > 0) {
          estabelecimentos = estabelecimentosEntrada;
        } else {
          estabelecimentos = [
            {
              cnpjCompleto: empresa.cnpj,
            },
          ];
        }

        const declaracaoObj = {
          tipoDeclaracao,
          receitaPaCompetenciaInterno: receitaInterna,
          receitaPaCompetenciaExterno: receitaExterna,
          ...(complemento || {}),
          estabelecimentos,
        };

        const dadosPGDAS = {
          cnpjCompleto: empresa.cnpj,
          pa: Number(pa),
          indicadorTransmissao,
          indicadorComparacao,
          declaracao: declaracaoObj,
        };

        if (valoresParaComparacao && indicadorComparacao) {
          dadosPGDAS.valoresParaComparacao = valoresParaComparacao;
        }

        const payload = {
          contratante: { numero: contratante, tipo: 2 },
          autorPedidoDados: { numero: contratante, tipo: 2 },
          contribuinte: { numero: empresa.cnpj, tipo: 2 },
          pedidoDados: {
            idSistema: 'PGDASD',
            idServico: 'TRANSDECLARACAO11',
            versaoSistema: '1.0',
            dados: JSON.stringify(dadosPGDAS),
          },
        };

        const apiResp = await axios.post(url, payload, { headers });

        registrarSnResultado(true, 'declaracao');

        resultados.push({
          tipo: 'declaracao',
          cnpj: empresa.cnpj,
          razaoSocial: empresa.razaoSocial || '',
          sucesso: true,
          status: apiResp.status,
          mensagens:
            apiResp.data && apiResp.data.mensagens ? apiResp.data.mensagens : [],
          receiptId: null,
          fromCache: false,
        });
      } catch (errEnvio) {
        console.error(
          'Erro ao declarar CNPJ',
          empresa.cnpj,
          errEnvio.response ? errEnvio.response.data : errEnvio.message
        );

        registrarSnResultado(false, 'declaracao');

        const status = errEnvio.response ? errEnvio.response.status : 500;
        const mensagens =
          errEnvio.response &&
            errEnvio.response.data &&
            errEnvio.response.data.mensagens
            ? errEnvio.response.data.mensagens
            : null;

        resultados.push({
          tipo: 'declaracao',
          cnpj: empresa.cnpj,
          razaoSocial: empresa.razaoSocial || '',
          sucesso: false,
          status,
          error: errEnvio.message,
          mensagens,
          receiptId: null,
          fromCache: false,
        });
      }
    }

    res.json({
      resultados,
      resumoConsumo: buildResumoResponse(),
    });
  } catch (err) {
    console.error('Erro geral ao enviar declarações SN:', err);
    res.status(500).json({ error: err.message || 'Erro ao enviar declarações.' });
  }
});

// ---------- ROTA: CONSULTA ÚLTIMO RECIBO POR PERÍODO ----------

// ---------- ROTA: CONSULTA ÚLTIMA DECLARAÇÃO / RECIBO POR PA ----------
app.post('/api/sn/consult-last', async (req, res) => {
  try {
    const {
      pa,                // AAAAMM, ex: 202511
      companyIds = null,
      all = false,
    } = req.body;

    const contratante = process.env.CONTRATANTE_CNPJ;

    if (!pa) {
      return res
        .status(400)
        .json({ error: 'Período de apuração (pa) é obrigatório.' });
    }

    // 1) Carrega empresas cadastradas
    const empresasCadastradas = await dbGetSnCompanies();
    let empresasParaProcessar = [];

    if (all) {
      empresasParaProcessar = empresasCadastradas;
    } else if (Array.isArray(companyIds) && companyIds.length > 0) {
      const idsNum = companyIds.map(Number);
      empresasParaProcessar = empresasCadastradas.filter((c) =>
        idsNum.includes(c.id)
      );
    } else {
      return res
        .status(400)
        .json({ error: 'Selecione pelo menos uma empresa.' });
    }

    if (empresasParaProcessar.length === 0) {
      return res
        .status(400)
        .json({ error: 'Nenhuma empresa encontrada para processar.' });
    }

    // 2) Autentica no SERPRO
    const { access_token, jwt_token } = await autenticarSerpro();

    if (!access_token) {
      return res.status(500).json({
        error:
          'access_token não retornado pelo SERPRO. Verifique o endpoint /authenticate e as credenciais.',
      });
    }

    // PRODUÇÃO:
    const url =
      'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Consultar';
    // Se quiser testar no ambiente trial, troque pela linha abaixo:
    // const url = 'https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1/Consultar';

    const headers = {
      Authorization: 'Bearer ' + access_token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (jwt_token) {
      headers.jwt_token = jwt_token;   // obrigatório em produção
    }

    const resultados = [];
    const paStr = String(pa); // "202511"

    // helper para tentar transformar data.dados em Buffer de PDF
    // helper para tentar transformar data.dados em Buffer de PDF
    // helper para tentar transformar data.dados em Buffer de PDF
    function decodePdfFromDados(dadosStr) {
      if (!dadosStr) return null;

      // 1) Tenta direto: dadosStr é base64 de PDF
      try {
        const bufBase64 = Buffer.from(dadosStr, 'base64');
        const sig1 = bufBase64.slice(0, 5).toString();
        if (sig1 === '%PDF-') {
          return bufBase64;
        }
      } catch (_) {
        // ignora, vamos tentar outras formas
      }

      // 2) Tenta interpretar dadosStr como JSON
      try {
        const jsonDados = JSON.parse(dadosStr);

        // 2.1 caminho mais provável: json.recibo.pdf
        if (
          jsonDados.recibo &&
          typeof jsonDados.recibo.pdf === 'string'
        ) {
          try {
            const buf = Buffer.from(jsonDados.recibo.pdf, 'base64');
            const sig = buf.slice(0, 5).toString();
            if (sig === '%PDF-') {
              return buf;
            }
          } catch (_) {
            // se der erro, cai pro restante da busca
          }
        }

        // 2.2 busca recursiva em qualquer campo string que seja base64 de PDF
        function buscaPdfEmObjeto(obj) {
          if (!obj || typeof obj !== 'object') return null;

          for (const [chave, val] of Object.entries(obj)) {
            if (typeof val === 'string') {
              try {
                const buf = Buffer.from(val, 'base64');
                const sig = buf.slice(0, 5).toString();
                if (sig === '%PDF-') {
                  return buf;
                }
              } catch (_) {
                // não era base64 válido, segue
              }
            } else if (val && typeof val === 'object') {
              const achou = buscaPdfEmObjeto(val);
              if (achou) return achou;
            }
          }
          return null;
        }

        const bufEncontrado = buscaPdfEmObjeto(jsonDados);
        if (bufEncontrado) return bufEncontrado;

      } catch (_) {
        // dadosStr não é JSON, segue
      }

      // 3) Por último, assume que dadosStr já é o texto do PDF
      try {
        const bufUtf8 = Buffer.from(String(dadosStr), 'utf8');
        const sig3 = bufUtf8.slice(0, 5).toString();
        if (sig3 === '%PDF-') {
          return bufUtf8;
        }
      } catch (_) {
        // nada a fazer
      }

      // Nenhuma das tentativas funcionou
      return null;
    }

    for (const empresa of empresasParaProcessar) {
      try {
        // 3) Checa se já existe recibo no banco
        let receiptRow = await dbGetReceiptByCompanyAndPa(empresa.id, pa);
        let fromCache = false;
        let receiptId = null;

        if (receiptRow) {
          fromCache = true;
          receiptId = receiptRow.id;
        } else {
          // 4) Monta payload conforme doc (CONSULTIMADECREC14)
          const payload = {
            contratante: { numero: contratante, tipo: 2 },
            autorPedidoDados: { numero: contratante, tipo: 2 },
            contribuinte: { numero: empresa.cnpj, tipo: 2 },
            pedidoDados: {
              idSistema: 'PGDASD',
              idServico: 'CONSULTIMADECREC14',
              versaoSistema: '1.0',
              dados: JSON.stringify({ periodoApuracao: paStr }),
            },
          };

          const apiResp = await axios.post(url, payload, { headers });
          const data = apiResp.data;

          console.log('--- RESPOSTA SERPRO CONSULTIMADECREC14 ---');
          console.log('status:', data.status);
          console.log('mensagens:', data.mensagens);
          console.log('dados (primeiros 200 chars):', String(data.dados).slice(0, 200));


          // Exemplo de retorno:
          // { status: 200, dados: "<string>", mensagens: [...] }

          if (data.status && data.status !== 200) {
            // a própria API está dizendo que deu erro de negócio
            registrarSnResultado(false, 'consulta');
            resultados.push({
              tipo: 'consulta',
              cnpj: empresa.cnpj,
              razaoSocial: empresa.razaoSocial || '',
              sucesso: false,
              status: data.status,
              error: 'Erro de negócio retornado pela API.',
              mensagens: data.mensagens || null,
              receiptId: null,
              fromCache: false,
            });
            continue;
          }

          // tenta extrair PDF de data.dados
          // tenta extrair PDF de data.dados
          const pdfBuffer = decodePdfFromDados(data.dados);

          if (!pdfBuffer) {
            // A API respondeu, mas não veio um PDF válido no campo "dados".
            // Podemos ter 2 cenários:
            //  - Mensagem de sucesso de negócio (ex: [[Sucesso-PGDASD]])
            //  - Algum outro erro lógico

            const statusApi = data.status || apiResp.status;
            const mensagensApi = data.mensagens || null;
            const temMensagemSucesso =
              Array.isArray(mensagensApi) &&
              mensagensApi.some(
                (m) =>
                  m &&
                  typeof m.texto === 'string' &&
                  m.texto.toLowerCase().includes('sucesso')
              );

            if (temMensagemSucesso || statusApi === 200) {
              // Consulta foi bem-sucedida do ponto de vista do SERPRO,
              // mas não há recibo em PDF para salvar.
              registrarSnResultado(true, 'consulta');

              resultados.push({
                tipo: 'consulta',
                cnpj: empresa.cnpj,
                razaoSocial: empresa.razaoSocial || '',
                sucesso: true,                 // <<< agora aparece "Sucesso" na tabela
                status: statusApi,
                error: null,
                mensagens: mensagensApi,
                receiptId: null,               // sem PDF, então sem link
                fromCache: false,
              });
            } else {
              // Aqui sim tratamos como erro de fato
              registrarSnResultado(false, 'consulta');

              resultados.push({
                tipo: 'consulta',
                cnpj: empresa.cnpj,
                razaoSocial: empresa.razaoSocial || '',
                sucesso: false,
                status: statusApi,
                error: 'Resposta não contém PDF válido em "dados".',
                mensagens: mensagensApi,
                receiptId: null,
                fromCache: false,
              });
            }

            continue;
          }


          // 5) Salva no banco
          const saved = await dbSaveReceipt(empresa.id, pa, pdfBuffer);
          receiptId = saved.id;

          registrarSnResultado(true, 'consulta');
        }

        resultados.push({
          tipo: 'consulta',
          cnpj: empresa.cnpj,
          razaoSocial: empresa.razaoSocial || '',
          sucesso: true,
          status: 200,
          mensagens: null,
          receiptId,
          fromCache,
        });
      } catch (errConsulta) {
        // 6) Tratamento de erro HTTP (403, 500, etc.)
        let status = 500;
        let mensagens = null;
        let errorMsg = errConsulta.message;
        let logText = null;

        if (errConsulta.response) {
          status = errConsulta.response.status || 500;

          const raw = errConsulta.response.data;
          if (Buffer.isBuffer(raw)) {
            logText = raw.toString('utf8');
          } else if (typeof raw === 'string') {
            logText = raw;
          } else if (typeof raw === 'object' && raw !== null) {
            logText = JSON.stringify(raw);
          }

          if (logText) {
            try {
              const json = JSON.parse(logText);
              if (Array.isArray(json.mensagens)) {
                mensagens = json.mensagens;
              }
            } catch (_) { }
          }
        }

        console.error(
          'Erro ao consultar recibo SN para CNPJ',
          empresa.cnpj,
          logText || errorMsg
        );

        registrarSnResultado(false, 'consulta');

        resultados.push({
          tipo: 'consulta',
          cnpj: empresa.cnpj,
          razaoSocial: empresa.razaoSocial || '',
          sucesso: false,
          status,
          error: errorMsg,
          mensagens,
          receiptId: null,
          fromCache: false,
        });
      }
    }

    res.json({
      resultados,
      resumoConsumo: buildResumoResponse(),
    });
  } catch (err) {
    console.error('Erro geral ao consultar últimos recibos SN:', err);
    res
      .status(500)
      .json({ error: err.message || 'Erro ao consultar recibos.' });
  }
});

// --- Nova página: separador-pdf-relatorio-de-ferias ---
app.get('/separador-pdf-relatorio-de-ferias', (req, res) => {
  res.sendFile(path.join(publicDir, 'separador-pdf-relatorio-de-ferias.html'));
});

// --- API da ferramenta separador-pdf-relatorio-de-ferias ---
app.post(
  '/api/separador-pdf-relatorio-de-ferias/processar',
  uploadSeparadorFerias.single('arquivoPdf'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo PDF enviado.' });
      }

      const competencia = (req.body.competencia || '').trim();
      if (!competencia) {
        return res.status(400).json({ error: 'Competência não informada.' });
      }

      const inputPdfPath = req.file.path;

      // Chamada ao backend Python (FastAPI)
      const pyUrl =
        process.env.SEPARADOR_FERIAS_API_URL ||
        'http://localhost:8001/api/separador-pdf-relatorio-de-ferias/processar';

      const pyResp = await axios.post(pyUrl, {
        input_pdf_path: inputPdfPath,
        competencia,
      });

      if (!pyResp.data || !pyResp.data.ok || !pyResp.data.zip_path) {
        console.error('Resposta inesperada do backend Python:', pyResp.data);
        return res.status(500).json({ error: 'Erro ao gerar ZIP no backend Python.' });
      }

      const zipPath = pyResp.data.zip_path;

      // Stream do ZIP para o navegador
      if (!fs.existsSync(zipPath)) {
        return res.status(500).json({ error: 'Arquivo ZIP não encontrado após processamento.' });
      }

      const zipFilename = path.basename(zipPath);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

      const stream = fs.createReadStream(zipPath);
      stream.on('error', (err) => {
        console.error('Erro ao ler ZIP gerado:', err);
        res.status(500).end('Erro ao enviar ZIP.');
      });

      stream.pipe(res);
    } catch (err) {
      console.error('Erro em /api/separador-pdf-relatorio-de-ferias/processar:', err);
      return res.status(500).json({ error: 'Erro ao processar requisição.' });
    }
  }
);

// Página: Separador Holerites por Empresa
app.get('/separador-holerites-por-empresa', (req, res) => {
  res.sendFile(path.join(publicDir, 'separador-holerites-por-empresa.html'));
});

// API: Separador de Holerites por Empresa (chama serviço FastAPI em Python)
app.post(
  '/api/separador-holerites-por-empresa',
  upload.single('pdf'),
  async (req, res) => {
    try {
      const file = req.file;
      const { competencia } = req.body;

      if (!file) {
        return res.status(400).json({ error: 'Arquivo PDF não enviado.' });
      }

      if (!competencia) {
        return res.status(400).json({ error: 'Competência é obrigatória.' });
      }

      // Monta form-data para enviar ao serviço Python
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('pdf', file.buffer, {
        filename: file.originalname,
        contentType: file.mimetype || 'application/pdf',
      });
      formData.append('competencia', competencia);

      // URL do serviço Python (ajuste se usar outra porta/host)
      const pythonUrl = process.env.HOLERITES_SERVICE_URL ||
        'http://127.0.0.1:8001/processar-holerites-por-empresa';

      const response = await axios.post(pythonUrl, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        responseType: 'stream',
      });

      // Repassa o ZIP (stream) para o cliente
      res.setHeader(
        'Content-Disposition',
        response.headers['content-disposition'] ||
        'attachment; filename="holerites_empresas.zip"'
      );
      res.setHeader(
        'Content-Type',
        response.headers['content-type'] || 'application/zip'
      );

      response.data.pipe(res);
    } catch (err) {
      console.error('Erro na API /api/separador-holerites-por-empresa:', err);

      // Se veio um erro HTTP do Python, tenta repassar mensagem
      if (err.response && err.response.data) {
        let errorMsg = 'Erro ao processar o PDF.';
        try {
          // caso a resposta do Python seja JSON {detail: "..."} ou {error: "..."}
          if (typeof err.response.data === 'string') {
            errorMsg = err.response.data;
          } else if (err.response.data.detail) {
            errorMsg = err.response.data.detail;
          } else if (err.response.data.error) {
            errorMsg = err.response.data.error;
          }
        } catch (_) { }

        return res.status(err.response.status || 500).json({ error: errorMsg });
      }

      return res
        .status(500)
        .json({ error: 'Erro interno ao chamar o serviço de holerites.' });
    }
  }
);

app.get('/separador-ferias-funcionario', (req, res) => {
  res.sendFile(path.join(publicDir, 'separador-ferias-funcionario.html'));
});

// Processamento de PDF de férias por funcionário
app.post(
  '/api/separador-ferias-funcionario/process',
  uploadSeparadorFerias.single('file'), // usa disk storage (com .path)
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          error: 'Nenhum arquivo enviado.',
        });
      }

      // Se você criou o FERIAS_FUNC_DIR, mantém esse bloco:
      if (!fs.existsSync(FERIAS_FUNC_DIR)) {
        fs.mkdirSync(FERIAS_FUNC_DIR, { recursive: true });
      }

      const originalPath = req.file.path; // agora vem preenchido
      const finalPath = path.join(
        FERIAS_FUNC_DIR,
        `${Date.now()}-${req.file.originalname}`
      );

      fs.renameSync(originalPath, finalPath);

      const pyResp = await axios.post(
        'http://127.0.0.1:8001/api/ferias-funcionario/processar',
        {
          pdf_path: finalPath,
        }
      );

      const data = pyResp.data || {};
      if (!data.ok) {
        return res.status(500).json({
          ok: false,
          error:
            data.error || 'Falha ao processar o PDF de férias no backend Python.',
        });
      }

      const zipPath = data.zip_path;
      const zipName = path.basename(zipPath);
      const downloadUrl = `/api/separador-ferias-funcionario/download/${encodeURIComponent(
        zipName
      )}`;

      return res.json({
        ok: true,
        message: 'PDF de férias processado com sucesso.',
        empresa: data.empresa,
        total_paginas: data.total_paginas,
        total_funcionarios: data.total_funcionarios,
        arquivos: data.arquivos || [],
        download_url: downloadUrl,
      });
    } catch (err) {
      console.error('Erro em /api/separador-ferias-funcionario/process:', err);
      return res.status(500).json({
        ok: false,
        error: 'Erro interno ao processar o PDF de férias.',
      });
    }
  }
);

// Download do ZIP de férias por funcionário
// Download do ZIP de férias por funcionário
app.get(
  '/api/separador-ferias-funcionario/download/:zipName',
  (req, res) => {
    try {
      const zipName = req.params.zipName;
      const zipPath = path.join(FERIAS_FUNC_DIR, zipName);

      if (!fs.existsSync(zipPath)) {
        return res.status(404).json({
          ok: false,
          error: 'Arquivo ZIP não encontrado.',
        });
      }

      // AQUI é a mudança: usamos o callback do download para apagar o arquivo depois
      res.download(zipPath, zipName, (err) => {
        if (err) {
          console.error(
            'Erro ao enviar ZIP em /api/separador-ferias-funcionario/download:',
            err
          );
          return;
        }

        // Após envio bem-sucedido, apaga o arquivo ZIP do servidor
        fs.unlink(zipPath, (unlinkErr) => {
          if (unlinkErr) {
            console.error(
              'Erro ao apagar ZIP em /api/separador-ferias-funcionario/download:',
              unlinkErr
            );
          }
        });
      });
    } catch (err) {
      console.error(
        'Erro em /api/separador-ferias-funcionario/download:',
        err
      );
      return res.status(500).json({
        ok: false,
        error: 'Erro ao preparar download do ZIP.',
      });
    }
  }
);

// perto das outras rotas de página
app.get('/gerador-atas', (req, res) => {
  res.sendFile(path.join(publicDir, 'gerador-atas.html'));
});

// Config para backend Python FastAPI
const PY_BASE_URL = process.env.PY_BASE_URL || 'http://127.0.0.1:8001';

// Lista modelos
app.get('/api/atas/modelos', async (req, res) => {
  try {
    const { data } = await axios.get(`${PY_BASE_URL}/api/gerador-atas/modelos`);
    res.json(data);
  } catch (err) {
    console.error('Erro ao listar modelos de ata:', err.message);
    res.status(500).json({ ok: false, error: 'Erro ao listar modelos de ata' });
  }
});

// Campos de um modelo
app.get('/api/atas/modelos/:modeloId/campos', async (req, res) => {
  const { modeloId } = req.params;
  try {
    const { data } = await axios.get(
      `${PY_BASE_URL}/api/gerador-atas/modelos/${encodeURIComponent(modeloId)}`
    );
    res.json(data);
  } catch (err) {
    console.error('Erro ao obter campos do modelo de ata:', err.message);
    res.status(500).json({ ok: false, error: 'Erro ao obter campos do modelo' });
  }
});

// Geração da ata
app.post('/api/atas/gerar', async (req, res) => {
  try {
    const { data } = await axios.post(
      `${PY_BASE_URL}/api/gerador-atas/gerar`,
      req.body
    );
    res.json(data);
  } catch (err) {
    console.error('Erro ao gerar ata:', err.message);
    res.status(500).json({ ok: false, error: 'Erro ao gerar ata' });
  }
});

// Download do arquivo gerado
app.get('/api/atas/download/:fileName', (req, res) => {
  const { fileName } = req.params;
  const filePath = path.join(DATA_DIR, 'atas_geradas', fileName);
  res.download(filePath, fileName, (err) => {
    if (err) {
      console.error('Erro ao fazer download da ata:', err.message);
      if (!res.headersSent) {
        res.status(404).json({ ok: false, error: 'Arquivo não encontrado' });
      }
    }
  });
});

// Busca CEP na BrasilAPI
app.get('/api/cep/:cep', async (req, res) => {
  try {
    const cepRaw = req.params.cep || '';
    const cep = cepRaw.replace(/\D/g, '');

    if (!cep || cep.length !== 8) {
      return res.status(400).json({ ok: false, error: 'CEP deve ter 8 dígitos.' });
    }

    const { data } = await axios.get(`https://brasilapi.com.br/api/cep/v2/${cep}`);

    res.json({ ok: true, data });
  } catch (err) {
    if (err.response) {
      const status = err.response.status || 500;
      let msg = 'Erro ao consultar CEP.';

      if (status === 400) msg = 'CEP inválido ou mal formatado.';
      if (status === 404) msg = 'CEP não encontrado.';
      if (status === 500) msg = 'Erro interno no serviço de CEP.';

      return res.status(status).json({
        ok: false,
        error: msg,
        detail: err.response.data || null
      });
    }
    console.error('Erro ao chamar BrasilAPI CEP:', err.message);
    res.status(500).json({ ok: false, error: 'Erro interno ao consultar CEP.' });
  }
});

// Busca CNPJ na BrasilAPI
app.get('/api/cnpj/:cnpj', async (req, res) => {
  try {
    const cnpjRaw = req.params.cnpj || '';
    const cnpj = cnpjRaw.replace(/\D/g, '');

    if (!cnpj || cnpj.length !== 14) {
      return res.status(400).json({ ok: false, error: 'CNPJ deve ter 14 dígitos.' });
    }

    const { data } = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);

    res.json({ ok: true, data });
  } catch (err) {
    if (err.response) {
      const status = err.response.status || 500;
      let msg = 'Erro ao consultar CNPJ.';

      if (status === 400) msg = 'CNPJ inválido ou mal formatado.';
      if (status === 404) msg = 'CNPJ não encontrado.';
      if (status === 500) msg = 'Erro interno no serviço de CNPJ.';

      return res.status(status).json({
        ok: false,
        error: msg,
        detail: err.response.data || null
      });
    }
    console.error('Erro ao chamar BrasilAPI CNPJ:', err.message);
    res.status(500).json({ ok: false, error: 'Erro interno ao consultar CNPJ.' });
  }
});

// Página: Acertos Lotes Internets
app.get('/acertos-lotes-internets', (req, res) => {
  res.sendFile(path.join(publicDir, 'acertos-lotes-internets.html'));
});

// API: processamento do arquivo TXT de lotes
app.post('/api/acertos-lotes-internets/process',
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          error: 'Nenhum arquivo enviado.',
        });
      }

      const conteudo = getTextFromUploadedFile(req.file);
      if (!conteudo) {
        return res.status(400).json({
          ok: false,
          error: 'Não foi possível ler o conteúdo do arquivo enviado.',
        });
      }

      const resultado = processarLoteInternetsConteudo(conteudo);

      const originalName = req.file.originalname || 'lancamentos.txt';
      const baseName =
        originalName.replace(/\.[^/.]+$/, '') || 'lancamentos';
      const processedFileName = `${baseName}-ajustado.txt`;
      const removedFileName = `${baseName}-linhas-removidas.txt`;

      return res.json({
        ok: true,
        ...resultado,
        processedFileName,
        removedFileName,
      });
    } catch (err) {
      console.error('Erro ao processar lote de internets:', err);
      return res.status(500).json({
        ok: false,
        error: 'Erro interno ao processar o arquivo de lote.',
      });
    }
  }
);

// Página: Acerto Lotes Toscan (separada do Acertos Lotes Internets)
app.get('/acerto-lotes-toscan', (req, res) => {
  res.sendFile(path.join(publicDir, 'acerto-lotes-toscan.html'));
});

app.get('/comprimir-pdf', (req, res) => {
  res.sendFile(path.join(publicDir, 'comprimir-pdf.html'));
});

app.post(
  '/api/comprimir-pdf/processar',
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          error: 'Nenhum arquivo foi enviado.',
        });
      }

      // 1) Lê o conteúdo do arquivo
      let fileBuffer;

      // Com a configuração atual (memoryStorage), o arquivo vem aqui:
      if (req.file.buffer) {
        fileBuffer = req.file.buffer;
      }
      // Se no futuro você trocar para diskStorage, esse bloco passa a funcionar:
      else if (req.file.path) {
        fileBuffer = await fs.promises.readFile(req.file.path);
      } else {
        return res.status(400).json({
          ok: false,
          error: 'Não foi possível ler o arquivo enviado.',
        });
      }

      // 2) Converte para base64 para enviar para o backend Python
      const fileBase64 = fileBuffer.toString('base64');

      const jpegQuality = Number(req.body.jpegQuality) || 50;
      const dpiScale = Number(req.body.dpiScale) || 1.0;

      const payload = {
        file_name: req.file.originalname,
        file_base64: fileBase64,
        jpeg_quality: jpegQuality,
        dpi_scale: dpiScale,
      };

      // 3) Chama a API Python
      const apiResponse = await axios.post(
        'http://127.0.0.1:8001/api/comprimir-pdf/processar',
        payload,
        { timeout: 600000 } // até 10 minutos
      );

      // 4) Se um dia você usar diskStorage, pode apagar o arquivo físico aqui,
      // MAS só se req.file.path existir:
      if (req.file.path) {
        fs.promises.unlink(req.file.path).catch(() => { });
      }

      return res.json(apiResponse.data);
    } catch (err) {
      console.error('Erro na compressão de PDF:', err);
      return res.status(500).json({
        ok: false,
        error: 'Erro no servidor ao comprimir o PDF.',
      });
    }
  }
);

// server.js

app.get('/extrator-zip-rar', (req, res) => {
  res.sendFile(path.join(publicDir, 'extrator-zip-rar.html'));
});

// server.js (após configurar multer, DATA_DIR, axios, archiver etc.)

const extratorZipRarRouter = express.Router();

// POST /api/extrator-zip-rar/process
extratorZipRarRouter.post('/process', uploadExtratorZipRar.array('archives'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ ok: false, error: 'Nenhum arquivo enviado.' });
    }

    // cria pasta de trabalho para este job
    const jobId = Date.now().toString();
    const jobDir = path.join(DATA_DIR, 'extrator-zip-rar', jobId);

    await fs.promises.mkdir(jobDir, { recursive: true });

    // move arquivos enviados para a pasta de trabalho com o nome original
    for (const file of req.files) {
      const destPath = path.join(jobDir, file.originalname);
      await fs.promises.rename(file.path, destPath); // agora file.path existe
    }

    // chama o backend Python (FastAPI)
    const pyResponse = await axios.post(
      'http://127.0.0.1:8001/api/extrator-zip-rar/process',
      {
        base_dir: jobDir,
        max_depth: 5,
      },
    );

    const resultado = pyResponse.data?.resultado || {};
    const destDir = resultado.dest_dir || path.join(jobDir, 'ARQUIVOS');

    // gera um ZIP consolidado dos arquivos extraídos
    const zipOutputPath = path.join(jobDir, 'resultado.zip');

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipOutputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', resolve);
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(destDir, false);
      archive.finalize();
    });

    return res.json({
      ok: true,
      downloadUrl: `/api/extrator-zip-rar/download/${jobId}`,
      stats: resultado,
    });
  } catch (error) {
    console.error('Erro em /api/extrator-zip-rar/process:', error);
    return res.status(500).json({
      ok: false,
      error: 'Erro ao processar arquivos ZIP/RAR.',
    });
  }
});

// GET /api/extrator-zip-rar/download/:jobId
extratorZipRarRouter.get('/download/:jobId', (req, res) => {
  const { jobId } = req.params;
  const zipPath = path.join(DATA_DIR, 'extrator-zip-rar', jobId, 'resultado.zip');

  if (!fs.existsSync(zipPath)) {
    return res.status(404).json({
      ok: false,
      error: 'Arquivo de resultado não encontrado.',
    });
  }

  return res.download(zipPath, `resultado-extrator-zip-rar-${jobId}.zip`);
});

// registra o router
app.use('/api/extrator-zip-rar', extratorZipRarRouter);

// Página Excel → Abas em PDF
app.get('/excel-abas-pdf', (req, res) => {
  res.sendFile(path.join(publicDir, 'excel-abas-pdf.html'));
});

// Upload de Excel + chamada ao backend Python para exportar abas em PDF
// Rota: upload + chamada ao backend Python
app.post(
  '/api/excel-abas-pdf/processar',
  upload.array('files'), // usa o mesmo "upload" com memoryStorage
  async (req, res) => {
    try {
      const files = req.files || [];
      if (!files.length) {
        return res
          .status(400)
          .json({ ok: false, error: 'Nenhum arquivo Excel enviado.' });
      }

      const jobId = Date.now().toString();
      const jobDir = path.join(EXCEL_ABAS_PDF_DIR, jobId);
      const inputDir = path.join(jobDir, 'input'); // onde vou salvar os .xlsx
      const outputDir = path.join(jobDir, 'pdfs'); // onde o Python vai gravar os PDFs

      fs.mkdirSync(inputDir, { recursive: true });
      fs.mkdirSync(outputDir, { recursive: true });

      const arquivos = [];

      for (const f of files) {
        // nome original ou fallback
        const originalName = f.originalname || `arquivo-${Date.now()}.xlsx`;
        // simplifica/limpa nome para evitar problemas em path
        const safeName = originalName.replace(/[^\w\-.]/g, '_');
        const destPath = path.join(inputDir, safeName);

        if (f.buffer) {
          // memoryStorage → grava o conteúdo em disco
          fs.writeFileSync(destPath, f.buffer);
        } else if (f.path) {
          // se em algum momento usar diskStorage, garante cópia
          fs.copyFileSync(f.path, destPath);
        } else {
          // sem buffer e sem path → ignora esse arquivo
          continue;
        }

        arquivos.push(destPath);
      }

      if (!arquivos.length) {
        return res.status(400).json({
          ok: false,
          error: 'Não foi possível salvar os arquivos Excel no servidor.',
        });
      }

      // Chama o FastAPI passando caminhos válidos
      const response = await axios.post(
        'http://127.0.0.1:8001/api/excel-abas-pdf/processar',
        {
          arquivos,
          pasta_destino: outputDir,
        }
      );

      const data = response.data || {};
      if (!data.ok) {
        return res.status(500).json({
          ok: false,
          error: data.error || 'Falha ao gerar PDFs no backend Python.',
        });
      }

      // Cria o ZIP com todos os PDFs gerados
      const zipPath = path.join(EXCEL_ABAS_PDF_DIR, `${jobId}.zip`);
      await criarZipComPdfs(outputDir, zipPath);

      const zipUrl = `/api/excel-abas-pdf/download/${jobId}`;

      return res.json({
        ok: true,
        jobId,
        zipUrl,
        resultados: data.resultados || [],
      });
    } catch (err) {
      console.error('Erro em /api/excel-abas-pdf/processar', err);
      return res.status(500).json({
        ok: false,
        error: 'Erro interno ao processar os arquivos Excel.',
      });
    }
  }
);

// Download do ZIP gerado
app.get('/api/excel-abas-pdf/download/:jobId', (req, res) => {
  const { jobId } = req.params;
  const zipPath = path.join(EXCEL_ABAS_PDF_DIR, `${jobId}.zip`);

  if (!fs.existsSync(zipPath)) {
    return res
      .status(404)
      .json({ ok: false, error: 'Arquivo ZIP não encontrado.' });
  }

  res.download(zipPath, `excel-abas-pdf-${jobId}.zip`);
});

// --- Nova página: importador-recebimentos-madre-scp ---
app.get('/importador-recebimentos-madre-scp', (req, res) => {
  res.sendFile(path.join(publicDir, 'importador-recebimentos-madre-scp.html'));
});

// --- API da ferramenta importador-recebimentos-madre-scp ---
app.post(
  '/api/importador-recebimentos-madre-scp/upload',
  uploadMadreScp.single('pdfFile'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum PDF enviado.' });
      }

      const axios = require('axios');
      const pythonBase =
        process.env.PYTHON_API_URL || 'http://127.0.0.1:8001';
      const pythonUrl =
        pythonBase + '/api/importador-recebimentos-madre-scp/processar';

      const outputDir = path.join(DATA_DIR, 'outputs', 'madre-scp');

      const payload = {
        pdf_path: req.file.path,
        output_dir: outputDir,
      };

      const resposta = await axios.post(pythonUrl, payload);
      const data = resposta.data || {};

      if (!data.ok) {
        return res
          .status(500)
          .json({ error: 'Falha ao processar PDF no backend Python.' });
      }

      const resultado = data.resultado || {};

      // devolve apenas o necessário para o front-end
      return res.json({
        ok: true,
        resumo: {
          total_registros: resultado.total_registros,
          total_clientes: resultado.total_clientes,
          totais: resultado.totais,
          resumo_clientes: resultado.resumo_clientes,
        },
        // token simples baseado no nome do arquivo; o download usará a pasta outputDir
        downloadToken: resultado.output_excel_name,
      });
    } catch (err) {
      console.error(
        'Erro em /api/importador-recebimentos-madre-scp/upload:',
        err.message || err
      );
      return res
        .status(500)
        .json({ error: 'Erro ao processar requisição no servidor.' });
    }
  }
);

// Rota para download do Excel gerado
app.get(
  '/api/importador-recebimentos-madre-scp/download/:fileName',
  (req, res) => {
    const fileName = req.params.fileName;
    const filePath = path.join(
      DATA_DIR,
      'outputs',
      'madre-scp',
      fileName
    );

    return res.download(filePath, fileName, (err) => {
      if (err) {
        console.error(
          'Erro ao enviar Excel MADRE SCP para download:',
          err.message || err
        );
        if (!res.headersSent) {
          return res
            .status(404)
            .json({ error: 'Arquivo gerado não encontrado.' });
        }
      }
    });
  }
);

// --- Nova página: ajuste-diario-gfbr ---
app.get('/ajuste-diario-gfbr', (req, res) => {
  res.sendFile(path.join(publicDir, 'ajuste-diario-gfbr.html'));
});

// --- API da ferramenta ajuste-diario-gfbr ---
app.post(
  '/api/ajuste-diario-gfbr/processar',
  uploadAjusteDiarioGfbr.single('arquivoDiario'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo Excel enviado.' });
      }

      const abaOrigem = (req.body.abaOrigem || '').trim();
      const criarBackupRaw = (req.body.criarBackup || '').toString().toLowerCase();
      // Considera backup = true quando checkbox marcado (on/true) ou não enviado
      const criarBackup =
        criarBackupRaw === '' ||
        criarBackupRaw === 'true' ||
        criarBackupRaw === 'on';

      const inputXlsxPath = req.file.path;

      const pyUrl =
        process.env.AJUSTE_DIARIO_GFBR_API_URL ||
        'http://localhost:8001/api/ajuste-diario-gfbr/processar';

      const pyResp = await axios.post(pyUrl, {
        input_xlsx_path: inputXlsxPath,
        aba_origem: abaOrigem || null,
        criar_backup: criarBackup,
      });

      const data = pyResp.data; // 👈 agora "data" existe

      if (!data || !data.ok || !data.resumo) {
        console.error(
          'Resposta inesperada do backend Python (ajuste-diario-gfbr):',
          pyResp.data
        );
        return res
          .status(500)
          .json({ error: 'Erro ao ajustar diário no backend Python.' });
      }

      const resumo = data.resumo;
      const backupFileName = resumo.backup_path
        ? path.basename(resumo.backup_path)
        : null;

      return res.json({
        ok: true,
        resumo,
        fileId: req.file.filename,
        downloadUrl: `/api/ajuste-diario-gfbr/download/${req.file.filename}`,
        backupDownloadUrl: backupFileName
          ? `/api/ajuste-diario-gfbr/download-backup/${backupFileName}`
          : null,
        message: resumo.mensagem || 'Diário ajustado com sucesso.',
      });

    } catch (err) {
      console.error('Erro em /api/ajuste-diario-gfbr/processar:', err);
      return res.status(500).json({ error: 'Erro ao processar diário.' });
    }
  }
);

// --- Download do diário ajustado (ajuste-diario-gfbr) ---
app.get('/api/ajuste-diario-gfbr/download/:fileId', (req, res) => {
  try {
    const fileId = req.params.fileId;
    const filePath = path.join(ajusteDiarioGfbrUploadsDir, fileId);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Arquivo ajustado não encontrado.' });
    }

    const downloadName = 'diario-ajustado.xlsx';
    res.download(filePath, downloadName);
  } catch (err) {
    console.error('Erro em /api/ajuste-diario-gfbr/download:', err);
    return res.status(500).json({ error: 'Erro ao baixar arquivo ajustado.' });
  }
});

// download do backup (arquivo original .backup.xlsx)
app.get('/api/ajuste-diario-gfbr/download-backup/:fileName', (req, res) => {
  try {
    const fileName = req.params.fileName;
    const filePath = path.join(ajusteDiarioGfbrUploadsDir, fileName);

    if (!fs.existsSync(filePath)) {
      return res
        .status(404)
        .json({ error: 'Arquivo de backup não encontrado.' });
    }

    const downloadName = 'diario-original.backup.xlsx';
    res.download(filePath, downloadName);
  } catch (err) {
    console.error('Erro em /api/ajuste-diario-gfbr/download-backup:', err);
    return res
      .status(500)
      .json({ error: 'Erro ao baixar arquivo de backup.' });
  }
});

// --- Nova página: separador-csv-baixa-automatica ---
app.get('/separador-csv-baixa-automatica', (req, res) => {
  res.sendFile(path.join(publicDir, 'separador-csv-baixa-automatica.html'));
});

// --- API da ferramenta separador-csv-baixa-automatica ---
app.post(
  '/api/separador-csv-baixa-automatica/processar',
  uploadSeparadorCsv.single('arquivo'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          error: 'Nenhum arquivo recebido.',
        });
      }

      const pythonBaseUrl =
        process.env.PYTHON_API_URL || 'http://127.0.0.1:8001';

      const jobId = Date.now().toString();
      const outputDir = path.join(SEPARADOR_CSV_OUTPUT_DIR, jobId);

      const payload = {
        input_path: req.file.path,
        output_dir: outputDir,
        sheet_name: 'BAIXAS',
        year_source_column: 'DATA EMISSÃO',
        max_linhas_por_arquivo: 50,
        csv_sep: ';',
      };

      const pyResponse = await axios.post(
        `${pythonBaseUrl}/api/separador-csv-baixa-automatica/processar`,
        payload
      );

      const data = pyResponse.data || {};

      if (!data.ok || !data.resultado) {
        return res.status(500).json({
          ok: false,
          error: data.error || 'Falha ao processar no backend Python.',
        });
      }

      const resultado = data.resultado;
      const arquivosGerados = resultado.arquivos_gerados || [];
      const resumoPorAno = resultado.resumo_por_ano || {};

      // Gera o ZIP com os CSVs
      fs.mkdirSync(outputDir, { recursive: true });

      const zipPath = path.join(outputDir, 'resultado.zip');

      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', resolve);
        archive.on('error', reject);

        archive.pipe(output);

        for (const arq of arquivosGerados) {
          const fullPath = path.join(outputDir, arq.arquivo);
          // espera-se que o Python tenha gravado os arquivos em output_dir
          archive.file(fullPath, { name: arq.arquivo });
        }

        archive.finalize();
      });

      return res.json({
        ok: true,
        resumoPorAno,
        arquivosGerados,
        downloadId: jobId,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        ok: false,
        error: 'Erro inesperado ao processar o arquivo.',
      });
    }
  }
);

// Endpoint para download do ZIP gerado
app.get('/api/separador-csv-baixa-automatica/download/:jobId', (req, res) => {
  const { jobId } = req.params;

  const zipPath = path.join(
    SEPARADOR_CSV_OUTPUT_DIR,
    jobId,
    'resultado.zip'
  );

  if (!fs.existsSync(zipPath)) {
    return res.status(404).json({
      ok: false,
      error: 'Arquivo ZIP não encontrado.',
    });
  }

  return res.download(zipPath, `separador-csv-baixa-automatica-${jobId}.zip`);
});