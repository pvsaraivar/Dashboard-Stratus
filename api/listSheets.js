const { google } = require('googleapis');
const path = require('path');

async function listSpreadsheetsInDrive() {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: path.join(__dirname, '../credentials.json'),
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets.readonly',
                'https://www.googleapis.com/auth/drive.readonly'
            ],
        });

        const client = await auth.getClient();
        const drive = google.drive({ version: 'v3', auth: client });

        // Pesquisa apenas por Google Sheets no Drive partilhado com a conta de serviço
        const response = await drive.files.list({
            q: "mimeType = 'application/vnd.google-apps.spreadsheet'",
            pageSize: 50,
            fields: 'files(id, name, modifiedTime)',
        });

        const files = response.data.files;
        if (!files || files.length === 0) {
            console.log('Nenhuma planilha encontrada na pasta partilhada.');
            return [];
        }

        console.log('Planilhas encontradas no Google Drive:');
        files.forEach((file) => {
            console.log(`- Nome: ${file.name} (ID:${file.id})`);
        });

        return files;
    } catch (error) {
        console.error("Erro ao listar planilhas do Google Drive:", error);
        throw error;
    }
}

// Execução de teste local via terminal
if (require.main === module) {
    listSpreadsheetsInDrive();
}

module.exports = { listSpreadsheetsInDrive };