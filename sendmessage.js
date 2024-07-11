const axios = require('axios');
const csv = require('csv-parser');
const fs = require('fs');
require('dotenv').config();

const apiKey = process.env.Z_API_KEY;
const apiUrl = process.env.Z_API_URL;

async function sendMessage(phoneNumber, message) {
    try {
        const response = await axios.post(`${apiUrl}/send-message`, {
            phone: phoneNumber,
            message: message
        }, {
            headers: {
                'Content-Type': 'application/json',
                'apiKey': apiKey
            }
        });
        console.log(`Mensagem enviada para ${phoneNumber}: ${response.data}`);
    } catch (err) {
        console.error(`Erro ao enviar mensagem para ${phoneNumber}: ${err.response ? err.response.data : err.message}`);
    }
}

function isValidPhoneNumber(phoneNumber) {
    const phoneNumberPattern = /^\+[\d]{1,15}$/;
    return phoneNumberPattern.test(phoneNumber);
}

function readCsvAndSendMessages() {
    fs.createReadStream('contacts.csv')
        .pipe(csv())
        .on('data', (row) => {
            const phoneNumber = row['Número'];
            const message = "Olá! Este é um questionário sobre saúde reumatológica realizado pela Immuned. Por favor, responda às perguntas a seguir para que possamos avaliar sua condição.";
            if (phoneNumber && isValidPhoneNumber(phoneNumber)) {
                sendMessage(phoneNumber, message);
            } else {
                console.error(`Número de telefone inválido: ${phoneNumber}`);
            }
        })
        .on('end', () => {
            console.log('Arquivo CSV processado com sucesso');
        });
}

readCsvAndSendMessages();
