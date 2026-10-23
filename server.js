const express = require('express');
const path = require('path');
const { google } = require('googleapis');
const multer = require('multer');
const stream = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({ storage: multer.memoryStorage() });

// COLOQUE AQUI O ID DA PASTA RAIZ (Comprovantes Stratus Hub)
const DRIVE_FOLDER_ID = '1Au6kCfi27i0ETzUM8uXzQ8uEFE9MfS9N'; 

app.use(express.static(path.join(__dirname)));
app.use(express.json());

// 1. Rota das Planilhas
app.get('/api/sheets', async (req, res) => {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: path.join(__dirname, 'credentials.json'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.readonly']
        });
        const drive = google.drive({ version: 'v3', auth: await auth.getClient() });
        const response = await drive.files.list({
            q: "mimeType = 'application/vnd.google-apps.spreadsheet'",
            pageSize: 50, fields: 'files(id, name, modifiedTime, mimeType)',
        });
        res.json(response.data.files || []);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 2. Resumo das Planilhas (Simplificado para manter o tamanho do código - mantenha a sua lógica anterior de DRE aqui se desejar)
app.get('/api/sheet/:id/summary', async (req, res) => {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: path.join(__dirname, 'credentials.json'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.readonly']
        });
        const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
        const meta = await sheets.spreadsheets.get({ spreadsheetId: req.params.id });
        const sheetTitle = meta.data.properties.title;
        const isLucroBarGeral = sheetTitle.toUpperCase().includes("LUCRO BAR GERAL");

        // ... [A sua lógica existente de leitura do DRE e Lucro Bar Geral entra aqui sem alterações] ...
        res.json({ isLucroBarGeral: false, title: sheetTitle, isClientRepass: false, bruto: "R$ 0,00", insumos: "R$ 0,00", maoDeObra: "R$ 0,00", operacional: "R$ 0,00", sistema: "R$ 0,00", lucroLiquido: "R$ 0,00", repasseCliente: "R$ 0,00" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 3. Rota para Listar Pastas e Comprovantes (Navegação)
app.get('/api/financial-docs', async (req, res) => {
    try {
        const folderId = req.query.folderId || DRIVE_FOLDER_ID;
        const auth = new google.auth.GoogleAuth({
            keyFile: path.join(__dirname, 'credentials.json'),
            scopes: ['https://www.googleapis.com/auth/drive.readonly']
        });
        const drive = google.drive({ version: 'v3', auth: await auth.getClient() });
        const response = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'files(id, name, mimeType, createdTime, webViewLink)',
            orderBy: 'folder, createdTime desc'
        });
        res.json(response.data.files || []);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 4. Rota para Criar uma Nova Pasta
app.post('/api/create-folder', async (req, res) => {
    try {
        const { folderName, parentId } = req.body;
        const targetParent = parentId || DRIVE_FOLDER_ID;
        const auth = new google.auth.GoogleAuth({
            keyFile: path.join(__dirname, 'credentials.json'),
            scopes: ['https://www.googleapis.com/auth/drive.file']
        });
        const drive = google.drive({ version: 'v3', auth: await auth.getClient() });

        const response = await drive.files.create({
            requestBody: {
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [targetParent]
            },
            fields: 'id, name, mimeType, createdTime'
        });
        res.json(response.data);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 5. Rota para Upload de Ficheiros na Pasta Atual
app.post('/api/upload-doc', upload.single('file'), async (req, res) => {
    try {
        const targetFolder = req.body.folderId || DRIVE_FOLDER_ID;
        const auth = new google.auth.GoogleAuth({
            keyFile: path.join(__dirname, 'credentials.json'),
            scopes: ['https://www.googleapis.com/auth/drive.file']
        });
        const drive = google.drive({ version: 'v3', auth: await auth.getClient() });
        const bufferStream = new stream.PassThrough();
        bufferStream.end(req.file.buffer);

        const response = await drive.files.create({
            requestBody: { name: req.file.originalname, parents: [targetFolder] },
            media: { mimeType: req.file.mimetype, body: bufferStream },
            fields: 'id, name, mimeType, createdTime, webViewLink'
        });
        res.json(response.data);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.listen(PORT, () => console.log(`Servidor a correr em http://localhost:${PORT}`));