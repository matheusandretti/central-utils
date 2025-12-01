// src/server.js
const path = require('path');
const express = require('express');
const http = require('http');
const multer = require('multer');
const { Server } = require('socket.io');
const cors = require('cors'); // <<< NOVO
require('dotenv').config();
const axios = require('axios'); // para chamar a API Integra Contador
const { autenticarSerpro } = require("./serpro-auth");

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

// para conseguir ler JSON do body (usado em /api/mark-done)
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

let declarationCount = 0;

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

app.get('/sn', (req, res) => {
  res.sendFile(path.join(publicDir, 'sn.html'));
});

app.post('/api/sn/declaration', async (req, res) => {
  try {
    const {
      cnpj,
      pa,
      tipoDeclaracao = 1,
      receitaInterna = 0,
      receitaExterna = 0,
      indicadorTransmissao = true,
      indicadorComparacao = false,
      valoresParaComparacao = null,
      complemento = null,
      estabelecimentos: estabelecimentosEntrada = null, // opcional no body
    } = req.body;

    const contratante = process.env.CONTRATANTE_CNPJ;

    if (!cnpj || !pa) {
      return res
        .status(400)
        .json({ error: 'CNPJ e período de apuração (pa) são obrigatórios.' });
    }

    // 1) Autenticação SAPI (/authenticate) -> access_token + jwt_token
    const { access_token, jwt_token } = await autenticarSerpro();

    if (!access_token || !jwt_token) {
      return res.status(500).json({
        error:
          'access_token ou jwt_token não retornado pelo SERPRO. Verifique o endpoint /authenticate e as credenciais.',
      });
    }

    // 2) Montagem de "estabelecimentos"
    // Se o cliente mandar no body, usamos; senão, criamos um "sem movimento"
    let estabelecimentos;

    if (Array.isArray(estabelecimentosEntrada) && estabelecimentosEntrada.length > 0) {
      estabelecimentos = estabelecimentosEntrada;
    } else {
      // Declaração sem movimento: só o CNPJ, sem lista de atividades
      estabelecimentos = [
        {
          cnpjCompleto: cnpj,
          // NÃO enviamos "atividades" => sem movimento
        },
      ];
    }

    // 3) Objeto "declaracao" conforme schema da doc
    const declaracaoObj = {
      tipoDeclaracao,                         // 1 = original, etc.
      receitaPaCompetenciaInterno: receitaInterna,
      receitaPaCompetenciaExterno: receitaExterna,
      // receitasPaCaixa* / valorFixo* / receitasBrutasAnteriores / folhasSalario / etc. se precisar
      ...(complemento || {}),
      estabelecimentos,                      // <-- OBRIGATÓRIO
    };

    // 4) Objeto "dados" (campo pedidoDados.dados)
    const dadosPGDAS = {
      cnpjCompleto: cnpj,
      pa: Number(pa),             // a doc espera Number AAAAMM
      indicadorTransmissao,
      indicadorComparacao,
      declaracao: declaracaoObj,
    };

    if (valoresParaComparacao && indicadorComparacao) {
      dadosPGDAS.valoresParaComparacao = valoresParaComparacao;
    }

    // 5) Payload Integra Contador
    const payload = {
      contratante: { numero: contratante, tipo: 2 },
      autorPedidoDados: { numero: contratante, tipo: 2 },
      contribuinte: { numero: cnpj, tipo: 2 },
      pedidoDados: {
        idSistema: 'PGDASD',
        idServico: 'TRANSDECLARACAO11',
        versaoSistema: '1.0',
        dados: JSON.stringify(dadosPGDAS),
      },
    };

    // 6) Headers: Bearer + jwt_token
    const headers = {
      Authorization: 'Bearer ' + access_token,
      jwt_token: jwt_token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const url =
      'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Declarar';

    const apiResp = await axios.post(url, payload, { headers });

    // Se quiser manter o controle de consumo / preço, encaixa aqui:
    // declarationCount += 1;
    // const price = calculateDeclarationCost(declarationCount);

    res.json({
      status: apiResp.status,
      ...apiResp.data,
      // consumoAtual: declarationCount,
      // precoUnitario: price,
    });
  } catch (err) {
    console.error(
      'Erro ao chamar Integra Contador:',
      err.response ? err.response.data : err.message
    );

    if (err.response) {
      return res.status(err.response.status).json({
        error: 'Erro na API',
        status: err.response.status,
        mensagens: err.response.data && err.response.data.mensagens,
      });
    }

    res.status(500).json({ error: err.message });
  }
});

