const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuração do armazenamento de dados local (JSON)
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
if (!fs.existsSync(path.dirname(DATA_FILE))) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2));
}

// Configuração do Multer para upload temporário de arquivos em memória
const upload = multer({ storage: multer.memoryStorage() });

// CONFIGURAÇÃO DO GOOGLE DRIVE (Conta de Serviço / Service Account)
// Certifique-se de configurar o arquivo de credenciais (ex: credentials.json) ou variáveis de ambiente
const SCOPES = ['https://www.googleapis.com/auth/drive'];
let authClient;
try {
  authClient = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'), // Coloque sua chave JSON da Service Account se necessário
    scopes: SCOPES,
  });
} catch (e) {
  // Fallback caso use credenciais por ambiente
}

const drive = google.drive({ version: 'v3', auth: authClient });

// ID da pasta pai "Comprovantes Stratus Hub" - será buscado dinamicamente
let PARENT_FOLDER_ID = process.env.PARENT_FOLDER_ID || null;

// Função para buscar ou criar a pasta raiz "Comprovantes Stratus Hub"
async function getOrCreateParentFolder() {
  if (PARENT_FOLDER_ID) return PARENT_FOLDER_ID;

  try {
    // Busca a pasta "Comprovantes Stratus Hub" no Drive
    const searchResult = await drive.files.list({
      q: "name='Comprovantes Stratus Hub' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: 'files(id)',
      pageSize: 1,
    });

    if (searchResult.data.files && searchResult.data.files.length > 0) {
      PARENT_FOLDER_ID = searchResult.data.files[0].id;
      console.log('Pasta raiz encontrada:', PARENT_FOLDER_ID);
      return PARENT_FOLDER_ID;
    }

    // Se não existir, cria a pasta raiz
    const newFolder = await drive.files.create({
      resource: {
        name: 'Comprovantes Stratus Hub',
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });

    PARENT_FOLDER_ID = newFolder.data.id;
    console.log('Pasta raiz criada:', PARENT_FOLDER_ID);
    return PARENT_FOLDER_ID;
  } catch (error) {
    console.error('Erro ao buscar/criar pasta raiz:', error.message);
    throw error;
  }
}

// API para gerenciar o store.json local
app.get('/api/store', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/store', (req, res) => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API para listar planilhas do Google Drive (Operação de Bar)
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

// API para ler dados de uma planilha
app.get('/api/sheet-data', async (req, res) => {
  try {
    const { id, tab } = req.query;
    if (!id || !authClient) return res.status(400).json({ error: 'ID inválido ou Drive não configurado' });

    const meta = await drive.spreadsheets.get({ spreadsheetId: id });
    const abas = meta.data.sheets.map((s) => s.properties.title);
    const targetTab = tab || abas[0];

    const rowsRes = await drive.spreadsheets.values.get({
      spreadsheetId: id,
      range: `${targetTab}!A1:Z200`,
    });
    const grade = rowsRes.data.values || [];

    // Parse inteligente de DRE / Produtos / Resumo
    let resumo = {}, produtos = [], eventos = [];
    
    // Exemplo de parse de resumo e produtos para planilhas Stratus
    grade.forEach((r) => {
      const txt = (r[0] || '').toUpperCase();
      if (txt.includes('BRUTO')) resumo.bruto = parseFloat(r[1]) || 0;
      if (txt.includes('LUCRO LÍQUIDO') || txt.includes('LUCRO BAR')) resumo.lucroBar = parseFloat(r[1]) || 0;
      if (txt.includes('DESPESAS')) resumo.despesas = parseFloat(r[1]) || 0;
    });

    res.json({ abas, tab: targetTab, grade, resumo, produtos, eventos, extras: [] });
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.toString() });
  }
});

// 1. ROTA PARA CRIAR PASTAS FISICAMENTE NO GOOGLE DRIVE
app.post('/api/drive/folders', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome da pasta obrigatório' });

    if (!authClient) {
      // Modo simulação se o Drive não estiver conectado localmente por credentials.json
      return res.json({ success: true, folder: { id: 'local-' + Date.now(), name } });
    }

    // Busca ou cria a pasta raiz dinamicamente
    const parentId = await getOrCreateParentFolder();

    const fileMetadata = {
      name: name.toUpperCase(),
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      fields: 'id, name, webViewLink',
    });

    res.json({ success: true, folder: response.data });
  } catch (error) {
    console.error('Erro ao criar pasta:', error);
    res.status(500).json({ error: error.message, details: error.toString() });
  }
});

// 2. ROTA PARA UPLOAD DE COMPROVANTES NO GOOGLE DRIVE
app.post('/api/drive/upload', upload.single('arquivo'), async (req, res) => {
  try {
    const { pasta, evento, nome, categoria, valor, data } = req.body;

    if (!authClient) {
      return res.json({ success: true, driveUrl: '#' });
    }

    // Busca a pasta raiz "Comprovantes Stratus Hub"
    const parentId = await getOrCreateParentFolder();
    let targetFolderId = parentId;

    // Se uma pasta específica foi selecionada, tenta encontrá-la dentro da raiz
    if (pasta) {
      try {
        const folderQuery = await drive.files.list({
          q: `name='${pasta.toUpperCase()}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
          fields: 'files(id, name)',
        });
        if (folderQuery.data.files && folderQuery.data.files.length > 0) {
          targetFolderId = folderQuery.data.files[0].id;
        } else {
          // Se a pasta não existir, cria ela dentro da raiz
          const newFolder = await drive.files.create({
            resource: {
              name: pasta.toUpperCase(),
              mimeType: 'application/vnd.google-apps.folder',
              parents: [parentId],
            },
            fields: 'id',
          });
          targetFolderId = newFolder.data.id;
        }
      } catch (e) {
        console.error('Erro ao buscar/criar pasta de destino:', e);
      }
    }

    const fileMetadata = {
      name: req.file ? req.file.originalname : `${nome || 'comprovante'}.pdf`,
      parents: [targetFolderId],
    };

    const media = {
      mimeType: req.file ? req.file.mimetype : 'application/pdf',
      body: req.file ? req.file.buffer : Buffer.from('Comprovante Stratus Hub'),
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, webViewLink',
    });

    return res.json({ success: true, driveUrl: response.data.webViewLink || '#' });
  } catch (error) {
    console.error('Erro no upload:', error);
    res.status(500).json({ error: error.message, details: error.toString() });
  }
});

app.listen(PORT, () => {
  console.log(`Stratus Hub rodando na porta ${PORT}`);
});