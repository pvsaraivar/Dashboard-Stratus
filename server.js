const express = require('express');
const path = require('path');
const multer = require('multer');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// Aumentamos o limite para 50mb para suportar o upload de comprovantes em Base64
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// URL do Firebase Realtime Database (Cole a sua URL aqui e adicione /store.json no final)
const FIREBASE_URL = process.env.FIREBASE_URL || 'https://painelstratus-default-rtdb.firebaseio.com/store.json';

// Configuração do Multer (mantido para compatibilidade)
const upload = multer({ storage: multer.memoryStorage() });

// CONFIGURAÇÃO DO GOOGLE DRIVE / SHEETS (Mantido intacto)
const SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets.readonly'];
let authClient;
try {
  // No Vercel, você precisará carregar as credenciais via variável de ambiente,
  // pois não é seguro subir o credentials.json no GitHub.
  authClient = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: SCOPES,
  });
} catch (e) {
  console.log("Credenciais locais não encontradas. Verifique as variáveis de ambiente no Vercel.");
}

const drive = google.drive({ version: 'v3', auth: authClient });
const sheets = google.sheets({ version: 'v4', auth: authClient });

// --- NOVOS ENDPOINTS DO BANCO DE DADOS (CONECTADOS AO FIREBASE) ---

app.get('/api/store', async (req, res) => {
  try {
    const response = await fetch(FIREBASE_URL);
    const data = await response.json();
    // Se o banco estiver vazio, retorna um objeto vazio para não quebrar o frontend
    res.json(data || {});
  } catch (err) {
    res.status(500).json({ error: 'Erro ao ler banco de dados: ' + err.message });
  }
});

app.put('/api/store', async (req, res) => {
  try {
    const response = await fetch(FIREBASE_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    
    if (!response.ok) throw new Error('Falha ao salvar no Firebase');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar no banco de dados: ' + err.message });
  }
});

// --- ENDPOINTS DE PLANILHAS (MANTIDOS INTACTOS) ---

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

// Exportar a app para o Vercel (obrigatório para Serverless Functions)
module.exports = app;

// Inicia o servidor localmente apenas se não estiver no Vercel
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Stratus Hub a correr na porta ${PORT}`);
  });
}