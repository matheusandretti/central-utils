// src/queue.js
const { v4: uuidv4 } = require('uuid');

const jobs = new Map(); // id -> job
const queue = [];       // array de ids em ordem de chegada

const JOB_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  WAITING_CAPTCHA: 'waiting_captcha',
  DONE: 'done',
  ERROR: 'error',
};

function createJobsFromKeys(keysArray) {
  const created = [];
  keysArray.forEach((key) => {
    const trimmed = String(key || '').trim();
    if (!trimmed) return;

    const id = uuidv4();
    const job = {
      id,
      key: trimmed,
      status: JOB_STATUS.PENDING,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    jobs.set(id, job);
    queue.push(id);
    created.push(job);
  });
  return created;
}

function getNextJob() {
  while (queue.length > 0) {
    const id = queue.shift();
    const job = jobs.get(id);
    if (job && job.status === JOB_STATUS.PENDING) {
      return job;
    }
    // se job não existir ou não estiver mais pendente, ignora e vai pro próximo
  }
  return null;
}

function updateJob(id, updates) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, updates, { updatedAt: new Date() });
  return job;
}

function getAllJobs() {
  // retorna um array novo, não a estrutura interna
  return Array.from(jobs.values());
}

function getSummary() {
  const summary = {
    pending: 0,
    processing: 0,
    waiting_captcha: 0,
    done: 0,
    error: 0,
  };
  for (const job of jobs.values()) {
    if (job.status === JOB_STATUS.PENDING) summary.pending++;
    if (job.status === JOB_STATUS.PROCESSING) summary.processing++;
    if (job.status === JOB_STATUS.WAITING_CAPTCHA) summary.waiting_captcha++;
    if (job.status === JOB_STATUS.DONE) summary.done++;
    if (job.status === JOB_STATUS.ERROR) summary.error++;
  }
  return summary;
}

function findJobByKey(key) {
  key = String(key).trim();
  for (const job of jobs.values()) {
    if (job.key === key) return job;
  }
  return null;
}

/**
 * Apaga definitivamente todos os jobs cujo status esteja em `statuses`.
 * Também remove o id da fila `queue` se ainda estiver lá.
 * Retorna quantos jobs foram removidos.
 */
function deleteJobsByStatus(statuses) {
  const statusSet = new Set(statuses);
  const idsToDelete = [];

  for (const [id, job] of jobs.entries()) {
    if (statusSet.has(job.status)) {
      idsToDelete.push(id);
    }
  }

  idsToDelete.forEach((id) => {
    jobs.delete(id);
    const idx = queue.indexOf(id);
    if (idx !== -1) {
      queue.splice(idx, 1);
    }
  });

  return idsToDelete.length;
}

module.exports = {
  JOB_STATUS,
  createJobsFromKeys,
  getNextJob,
  updateJob,
  getAllJobs,
  getSummary,
  findJobByKey,
  deleteJobsByStatus,
};
