const express = require('express');
const path = require('path');
const multer = require('multer');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// Aumentamos o limite para 50mb para suportar o upload de comprovantes em Base64
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Diz ao Express onde estão os ficheiros visuais (HTML)
app.use(express.static(path.join(__dirname, 'public')));

// Rota principal: entrega o index.html que está dentro da pasta public
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ATENÇÃO: A linha app.use(express.static(...)) foi REMOVIDA propositadamente.
// O Vercel vai tratar de entregar o index.html de forma nativa através do vercel.json.

// URL da Base de Dados Firebase (Realtime Database)
const FIREBASE_URL = process.env.FIREBASE_URL || 'https://painelstratus-default-rtdb.firebaseio.com/store.json';

// Configuração do Multer (mantido para compatibilidade)
const upload = multer({ storage: multer.memoryStorage() });

// CONFIGURAÇÃO DO GOOGLE DRIVE / SHEETS (somente leitura)
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/spreadsheets.readonly'];
let authClient = null, authError = null;

try {
  let creds = null;
  if (process.env.GOOGLE_CREDENTIALS_B64) {
    creds = JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_B64, 'base64').toString('utf8'));
  } else if (process.env.GOOGLE_CREDENTIALS) {
    creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  }
  if (creds) {
    creds.private_key = String(creds.private_key || '').replace(/\\n/g, '\n');
    authClient = new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
  } else {
    authClient = new google.auth.GoogleAuth({ keyFile: path.join(__dirname, 'credentials.json'), scopes: SCOPES });
  }
} catch (e) {
  authError = e.message;
  console.error('Erro crítico na autenticação do Google:', e.message);
}
const drive = google.drive({ version: 'v3', auth: authClient });
const sheets = google.sheets({ version: 'v4', auth: authClient });

// Responde com erro claro (em vez de lista vazia) quando as credenciais não estão configuradas
function needAuth(res) {
  if (authClient) return false;
  res.status(500).json({
    error: 'Credenciais do Google ausentes ou inválidas',
    details: (authError ? authError + ' · ' : '') + 'Defina GOOGLE_CREDENTIALS_B64 nas variáveis de ambiente da Vercel e faça um novo deploy.',
  });
  return true;
}

// --- ENDPOINTS DA BASE DE DADOS (LIGADOS AO FIREBASE) ---

app.get('/api/store', async (req, res) => {
  try {
    const response = await fetch(FIREBASE_URL);
    const data = await response.json();
    // Se a base estiver vazia, devolve um objeto vazio para não quebrar o frontend
    res.json(data || {});
  } catch (err) {
    res.status(500).json({ error: 'Erro ao ler a base de dados: ' + err.message });
  }
});

app.put('/api/store', async (req, res) => {
  try {
    const response = await fetch(FIREBASE_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    
    if (!response.ok) throw new Error('Falha ao guardar no Firebase');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao guardar na base de dados: ' + err.message });
  }
});

// --- ENDPOINTS DE PLANILHAS (GOOGLE SHEETS) ---

// Diagnóstico: abra /api/health no navegador para ver se o Google está conectado
app.get('/api/health', async (req, res) => {
  const out = { googleConfigurado: !!authClient, erroAuth: authError, firebaseConfigurado: !!FIREBASE_URL };
  try {
    if (authClient) {
      const c = await authClient.getCredentials();
      out.contaDeServico = c.client_email;
      const r = await drive.files.list({ q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false", fields: 'files(id)', pageSize: 5 });
      out.planilhasVisiveis = (r.data.files || []).length;
    }
  } catch (e) { out.erro = e.message; }
  res.json(out);
});

app.get('/api/sheets', async (req, res) => {
  try {
    if (needAuth(res)) return;
    const response = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: 'files(id, name)',
      pageSize: 1000,
    });
    res.json(response.data.files || []);
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.toString() });
  }
});

app.get('/api/sheet-data', async (req, res) => {
  try {
    const { id, tab } = req.query;
    if (!id) return res.status(400).json({ error: 'ID da planilha não informado' });
    if (needAuth(res)) return;

    const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
    const abas = meta.data.sheets.map((s) => s.properties.title);
    const targetTab = tab || abas[0];

    const rowsRes = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: `'${String(targetTab).replace(/'/g, "''")}'!A1:Z200`,
    });
    const grade = rowsRes.data.values || [];

    res.json({ abas, tab: targetTab, grade });
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.toString() });
  }
});

// Exportar a aplicação para o Vercel (Obrigatório para Serverless Functions)
module.exports = app;

// Inicia o servidor localmente apenas se não estiver a correr no Vercel
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Stratus Hub a correr na porta ${PORT}`);
  });
}