// src/serpro-auth.js
const fs = require("fs");
const https = require("https");
const axios = require("axios");
require("dotenv").config();

async function autenticarSerpro() {
  // ⚠️ AGORA usando o endpoint CORRETO da documentação:
  // https://autenticacao.sapi.serpro.gov.br/authenticate
  const url = process.env.SERPRO_AUTH_URL;

  const consumerKey = process.env.CONSUMER_KEY;
  const consumerSecret = process.env.CONSUMER_SECRET;

  const certPath = process.env.CERT_PFX_PATH;      // caminho do .pfx / .p12
  const certPassword = process.env.CERT_PFX_PASSWORD;

  if (!url || !consumerKey || !consumerSecret || !certPath || !certPassword) {
    throw new Error("Faltam variáveis no .env (SERPRO_AUTH_URL, CONSUMER_KEY, CONSUMER_SECRET, CERT_PFX_PATH, CERT_PFX_PASSWORD)");
  }

  const certBuffer = fs.readFileSync(certPath);

  // Authorization: Basic base64(consumerKey:consumerSecret)
  const basic = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  const httpsAgent = new https.Agent({
    pfx: certBuffer,
    passphrase: certPassword
  });

  const headers = {
    "Authorization": "Basic " + basic,
    "Role-Type": "TERCEIROS",
    "Content-Type": "application/x-www-form-urlencoded"
  };

  const body = new URLSearchParams({ grant_type: "client_credentials" });

  const resp = await axios.post(url, body, { headers, httpsAgent });

  console.log("Token recebido do SERPRO:", resp.data);

  // AQUI, pela doc, devem vir:
  // access_token + jwt_token
  return resp.data;
}

module.exports = { autenticarSerpro };
