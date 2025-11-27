// src/worker.js
const { server } = require('./server');
const {
  JOB_STATUS,
  getAllJobs,
  updateJob
} = require('./queue');

const PORT = process.env.PORT || 3000;

function startServer() {
  server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    console.log('Worker iniciado. Aguardando extensão Chrome...');
  });
}

// (Opcional) Função para marcar jobs PROCESSING como erro se ficarem parados tempo demais
function cleanupStalledJobs() {
  const jobs = getAllJobs();

  const now = Date.now();
  const MAX_PROCESSING_TIME = 5 * 60 * 1000; // 5 minutos

  for (const job of jobs) {
    if (job.status === JOB_STATUS.PROCESSING) {
      const age = now - new Date(job.updatedAt).getTime();
      if (age > MAX_PROCESSING_TIME) {
        updateJob(job.id, {
          status: JOB_STATUS.ERROR,
          errorMessage: 'Tempo excedido (sem retorno da extensão)'
        });
      }
    }
  }
}

setInterval(cleanupStalledJobs, 15000); // verifica a cada 15s

startServer();
