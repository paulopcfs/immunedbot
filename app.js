const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const sql = require('mssql');
require('dotenv').config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const apiKey = process.env.Z_API_KEY;
const apiUrl = process.env.Z_API_URL;

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: true,
        enableArithAbort: true
    }
};

const questions = [
    { question: "Nos últimos 7 dias, com que frequência você sentiu dor nas articulações?", options: ["1. Nunca", "2. Ocasionalmente", "3. Frequentemente", "4. Diariamente"] },
    { question: "Nos últimos 7 dias, com que intensidade você classificaria sua dor nas articulações em uma escala de 0 a 10?", options: ["1. 0", "2. 1-3", "3. 4-6", "4. 7-10"] },
    { question: "Você teve dificuldade em realizar suas atividades diárias devido à rigidez nas articulações?", options: ["1. Nenhuma", "2. Leve", "3. Moderada", "4. Grave"] },
    { question: "Você se sentiu cansado ou exausto sem motivo aparente nos últimos 7 dias?", options: ["1. Nunca", "2. Ocasionalmente", "3. Frequentemente", "4. Diariamente"] },
    { question: "Você notou algum inchaço em suas articulações nos últimos 7 dias?", options: ["1. Nenhum", "2. Leve", "3. Moderado", "4. Grave"] },
    { question: "Você conseguiu realizar tarefas como abrir um pote ou subir escadas nos últimos 7 dias?", options: ["1. Sem dificuldade", "2. Com alguma dificuldade", "3. Com muita dificuldade", "4. Incapaz de realizar"] },
    { question: "Como você classificaria a qualidade do seu sono nos últimos 7 dias?", options: ["1. Excelente", "2. Boa", "3. Regular", "4. Ruim"] },
    { question: "Você se sentiu ansioso ou deprimido nos últimos 7 dias?", options: ["1. Nunca", "2. Ocasionalmente", "3. Frequentemente", "4. Diariamente"] }
];

let responses = {};
let introMessageSent = false;

async function sendQuestion(phoneNumber, question) {
    const optionsText = question.options.join('\n');

    try {
        await axios.post(`${apiUrl}/send-message`, {
            phone: phoneNumber,
            message: `${question.question}\nPor favor, responda com o número correspondente:\n${optionsText}`
        }, {
            headers: {
                'Content-Type': 'application/json',
                'apiKey': apiKey
            }
        });
    } catch (err) {
        console.error(`Erro ao enviar mensagem para ${phoneNumber}: ${err.response ? err.response.data : err.message}`);
    }
}

app.post('/webhook', async (req, res) => {
    const incomingMsg = req.body.Body.trim();
    const phoneNumber = req.body.From.replace('whatsapp:', '');

    if (!introMessageSent) {
        try {
            await axios.post(`${apiUrl}/send-message`, {
                phone: phoneNumber,
                message: "Olá! Este é um questionário sobre saúde reumatológica realizado pela Immuned. Por favor, responda às perguntas a seguir para que possamos avaliar sua condição."
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'apiKey': apiKey
                }
            });
            introMessageSent = true;
            responses[phoneNumber] = { currentQuestion: 0, answers: [] };
            sendQuestion(phoneNumber, questions[0]);
        } catch (err) {
            console.error(`Erro ao enviar mensagem para ${phoneNumber}: ${err.response ? err.response.data : err.message}`);
        }
        return res.sendStatus(200);
    }

    const userResponses = responses[phoneNumber];
    if (userResponses.currentQuestion < questions.length) {
        const question = questions[userResponses.currentQuestion];
        const selectedOption = parseInt(incomingMsg, 10);

        if (selectedOption > 0 && selectedOption <= question.options.length) {
            userResponses.answers.push(question.options[selectedOption - 1]);
            userResponses.currentQuestion++;

            if (userResponses.currentQuestion < questions.length) {
                sendQuestion(phoneNumber, questions[userResponses.currentQuestion]);
            } else {
                // Lógica de cálculo do score e mensagem final
                let score = 0;
                userResponses.answers.forEach((answer, index) => {
                    score += answer.startsWith(index + 1) ? index : 0;
                });

                let condition = "Leve";
                if (score >= 8 && score <= 14) condition = "Moderada";
                else if (score >= 15 && score <= 21) condition = "Grave";
                else if (score >= 22) condition = "Muito Grave";

                let finalMessage = "Obrigado por responder às perguntas!";
                if (condition === "Muito Grave") {
                    finalMessage += " Recomendamos que você consulte um médico imediatamente devido à gravidade da sua condição.";
                }

                try {
                    await axios.post(`${apiUrl}/send-message`, {
                        phone: phoneNumber,
                        message: finalMessage
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'apiKey': apiKey
                        }
                    });
                } catch (err) {
                    console.error(`Erro ao enviar mensagem para ${phoneNumber}: ${err.response ? err.response.data : err.message}`);
                }

                // Armazenar as respostas no banco de dados
                try {
                    await sql.connect(dbConfig);
                    for (const answer of userResponses.answers) {
                        await sql.query`INSERT INTO Responses (phoneNumber, question, response) VALUES (${phoneNumber}, ${questions[responses[phoneNumber].currentQuestion].question}, ${answer})`;
                    }
                } catch (err) {
                    console.error('Erro ao conectar ou inserir no banco de dados:', err);
                }

                // Reiniciar o questionário
                delete responses[phoneNumber];
                introMessageSent = false;
            }
        } else {
            sendQuestion(phoneNumber, question);
        }
    }

    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
