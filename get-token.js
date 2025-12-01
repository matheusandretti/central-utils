// get-token.js
//
// Usa Consumer Key / Secret para obter o access_token (JWT) do Serpro
// e imprime no console. Depois você copia esse token e cola no .env
// em JWT_TOKEN.

const axios = require('axios');

const CONSUMER_KEY = 'YbRyRZv_WzRZE97QkVYwxtMsEj4a';
const CONSUMER_SECRET = 'bmmC9qVQiidjFYhQyRb7lqK_nksa';

async function getToken() {
  try {
    const basicAuth = Buffer.from(CONSUMER_KEY + ':' + CONSUMER_SECRET).toString('base64');

    const resp = await axios.post(
      'https://gateway.apiserpro.serpro.gov.br/token',
      'grant_type=client_credentials',
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + basicAuth,
        },
      }
    );

    console.log('access_token:', resp.data.access_token);
    console.log('expires_in:', resp.data.expires_in, 'segundos');
  } catch (err) {
    if (err.response) {
      console.error('Erro na resposta do Serpro:', err.response.status, err.response.data);
    } else {
      console.error('Erro na requisição:', err.message);
    }
  }
}

getToken();
