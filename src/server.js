const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const multer = require('multer');
const { Server } = require('socket.io');
const cors = require('cors'); // <<< NOVO
require('dotenv').config();
const axios = require('axios'); // para chamar a API Integra Contador
const { autenticarSerpro } = require("./serpro-auth");
const { Pool } = require('pg'); // << ADICIONE ESTA LINHA
const archiver = require('archiver');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
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

const upload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  storage: multer.memoryStorage()
});

// Próximo de outras configurações, usando o mesmo DATA_DIR se já existir
const uploadsDir = path.join(DATA_DIR, 'uploads', 'separador-ferias');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const uploadSeparadorFerias = multer({
  dest: uploadsDir,
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
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo não enviado' });
    }

    const keys = parseFileToKeys(req.file.path, req.file.originalname);
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

// ---------- ROTAS DE PÁGINA ----------

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
        } catch (_) {}

        return res.status(err.response.status || 500).json({ error: errorMsg });
      }

      return res
        .status(500)
        .json({ error: 'Erro interno ao chamar o serviço de holerites.' });
    }
  }
);
