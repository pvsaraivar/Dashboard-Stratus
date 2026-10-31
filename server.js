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

// CONFIGURAÇÃO DO GOOGLE DRIVE / SHEETS
const SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets.readonly'];
let authClient;

try {
  if (process.env.GOOGLE_CREDENTIALS) {
    // Roda no Vercel puxando as chaves da Variável de Ambiente
    const keys = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    authClient = new google.auth.GoogleAuth({
      credentials: keys,
      scopes: SCOPES
    });
  } else {
    // Roda localmente puxando do arquivo
    authClient = new google.auth.GoogleAuth({
      keyFile: path.join(__dirname, 'credentials.json'),
      scopes: SCOPES,
    });
  }
} catch (e) {
  console.error("Erro crítico na autenticação do Google:", e.message);
}
const drive = google.drive({ version: 'v3', auth: authClient });
const sheets = google.sheets({ version: 'v4', auth: authClient });

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

app.get('/api/sheets', async (req, res) => {
  try {
    if (!authClient) return res.json([]);
    const response = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: 'files(id, name)',
    });
    res.json(response.data.files || []);
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.toString() });
  }
});

app.get('/api/sheet-data', async (req, res) => {
  try {
    const { id, tab } = req.query;
    if (!id || !authClient) return res.status(400).json({ error: 'ID inválido ou Drive não configurado' });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
    const abas = meta.data.sheets.map((s) => s.properties.title);
    const targetTab = tab || abas[0];

    const rowsRes = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: `${targetTab}!A1:Z200`,
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