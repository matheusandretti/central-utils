// src/server.js
const path = require('path');
const express = require('express');
const http = require('http');
const multer = require('multer');
const { Server } = require('socket.io');
const cors = require('cors'); // <<< NOVO

const {
  JOB_STATUS,
  createJobsFromKeys,
  getAllJobs,
  getSummary,
  getNextJob,
  updateJob,
  findJobByKey,
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
    const jobs = getAllJobs();

    jobs.forEach((job) => {
      if (job.status === JOB_STATUS.PENDING || job.status === JOB_STATUS.PROCESSING) {
        updateJob(job.id, {
          status: JOB_STATUS.DONE,
          errorMessage: null,
        });
      }
    });

    io.emit('queue_update', {
      summary: getSummary(),
      jobs: getAllJobs(),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao limpar pendentes:", err);
    res.status(500).json({ error: "Erro ao limpar chaves pendentes." });
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
