const axios = require('axios');
const csv = require('csv-parser');
const fs = require('fs');
const iconv = require('iconv-lite');
require('dotenv').config();

const instanceId = process.env.Z_API_INSTANCE_ID;
const token = process.env.Z_API_TOKEN;
const apiUrl = process.env.Z_API_URL;
const clientToken = process.env.CLIENT_TOKEN;  // Adicionar o client token ao .env

async function sendMessage(phoneNumber, message) {
    try {
        const requestData = {
            phone: phoneNumber,
            message: message
        };
        console.log('Request Data:', requestData);

        const response = await axios.post(`${apiUrl}/${instanceId}/token/${token}/send-text`, requestData, {
            headers: {
                'Content-Type': 'application/json',
                'Client-Token': clientToken  // Adicionar o cabeçalho Client-Token
            }
        });
        console.log(`Mensagem enviada para ${phoneNumber}: ${response.data}`);
    } catch (err) {
        console.error(`Erro ao enviar mensagem para ${phoneNumber}: ${err.response ? err.response.data : err.message}`);
    }
}

function isValidPhoneNumber(phoneNumber) {
    // Remover o sinal + se estiver presente
    const sanitizedPhoneNumber = phoneNumber.replace(/^\+/, '');
    const phoneNumberPattern = /^\d{1,15}$/;  // Aceita apenas dígitos de 1 a 15 caracteres
    return phoneNumberPattern.test(sanitizedPhoneNumber);
}

function cleanHeader(header) {
    return header.replace(/[^\w]/gi, '').toLowerCase();
}

function readCsvAndSendMessages() {
    fs.createReadStream('contacts.csv')
        .pipe(iconv.decodeStream('utf-8'))
        .pipe(csv())
        .on('headers', (headers) => {
            headers.forEach((header, index) => {
                headers[index] = cleanHeader(header);
            });
            console.log('Cabeçalhos processados:', headers);
        })
        .on('data', (row) => {
            console.log(row);
            const phoneNumber = row['numero'];
            const message = "Olá! Este é um questionário sobre saúde reumatológica realizado pela Immuned. Por favor, responda às perguntas a seguir para que possamos avaliar sua condição.";
            if (phoneNumber && isValidPhoneNumber(phoneNumber)) {
                sendMessage(phoneNumber, message);
            } else if (phoneNumber) {
                console.error(`Número de telefone inválido: ${phoneNumber}`);
            } else {
                console.error('Linha vazia ou número de telefone ausente');
            }
        })
        .on('end', () => {
            console.log('Arquivo CSV processado com sucesso');
        });
}

readCsvAndSendMessages();
