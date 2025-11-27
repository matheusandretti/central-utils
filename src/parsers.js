const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// chave NFe = 44 dígitos
const NFE_KEY_REGEX = /^\d{44}$/;

function parseFileToKeys(filePath, originalName) {
  const nameForExt = originalName || filePath;
  const ext = path.extname(nameForExt).toLowerCase();

  if (ext === '.xls' || ext === '.xlsx') {
    return parseExcel(filePath);
  }
  if (ext === '.csv') {
    return parseCsvOuTxt(filePath);
  }
  if (ext === '.txt') {
    return parseCsvOuTxt(filePath);
  }
  throw new Error(`Extensão não suportada: ${ext}`);
}

function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath);

  console.log('Abas encontradas no Excel:', workbook.SheetNames);

  const sheetNames = workbook.SheetNames;
  if (!sheetNames || sheetNames.length === 0) {
    throw new Error('Arquivo Excel sem abas (sheet)');
  }

  const firstSheetName = sheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];

  if (!sheet) {
    throw new Error(`Não consegui acessar a aba "${firstSheetName}" do arquivo.`);
  }

  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const foundKeys = new Set();

  data.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) return;

    row.forEach((cell, colIndex) => {
      if (cell == null) return;

      // converte pra string e pega só dígitos
      const raw = String(cell);
      const onlyDigits = raw.replace(/\D/g, '');

      if (NFE_KEY_REGEX.test(onlyDigits)) {
        foundKeys.add(onlyDigits);
      }
    });
  });

  const keys = Array.from(foundKeys);
  console.log('Total de possíveis chaves NFe encontradas no Excel:', keys.length);
  if (keys.length > 0) {
    console.log('Exemplo de chave(s) encontrada(s):', keys.slice(0, 5));
  }

  return keys;
}

function parseCsvOuTxt(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const foundKeys = new Set();

  lines.forEach((line) => {
    const raw = String(line || '');
    const onlyDigits = raw.replace(/\D/g, '');
    if (NFE_KEY_REGEX.test(onlyDigits)) {
      foundKeys.add(onlyDigits);
    }
  });

  const keys = Array.from(foundKeys);
  console.log('Total de possíveis chaves NFe encontradas no arquivo texto:', keys.length);
  if (keys.length > 0) {
    console.log('Exemplo de chave(s) encontrada(s):', keys.slice(0, 5));
  }

  return keys;
}

module.exports = {
  parseFileToKeys,
};
