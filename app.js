require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');
const express = require('express');
const bodyParser = require('body-parser');
const sql = require('mssql');
const rateLimit = require('express-rate-limit').default;

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// Configuração de proxy
app.set('trust proxy', 1);

const instanceId = process.env.ZAPI_INSTANCE_ID;
const instanceToken = process.env.ZAPI_INSTANCE_TOKEN;
const clientToken = process.env.CLIENT_TOKEN;
const apiUrl = `https://api.z-api.io/instances/${instanceId}/token/${instanceToken}/send-text`;

const contactsFilePath = 'contacts.csv';

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: true,
        enableArithAbort: true
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    },
    connectionTimeout: 30000,
    requestTimeout: 30000
};

let pool;
const poolConnect = sql.connect(dbConfig)
    .then(p => {
        pool = p;
        console.log('Conectado ao banco de dados');
    })
    .catch(err => {
        console.error('Erro ao conectar ao banco de dados:', err);
    });

const questions = [
    { question: "Nos últimos 7 dias, com que frequência você sentiu dor nas articulações?", options: ["1. Nunca", "2. Ocasionalmente", "3. Frequentemente", "4. Diariamente"] },
    { question: "Nos últimos 7 dias, com que intensidade você classificaria sua dor nas articulações em uma escala de 0 a 10, considerando 0 sem dor e 10, muita dor?", options: ["1. 0", "2. 1-3", "3. 4-6", "4. 7-10"] },
    { question: "Você teve dificuldade em realizar suas atividades diárias devido à rigidez nas articulações?", options: ["1. Nenhuma", "2. Leve", "3. Moderada", "4. Grave"] },
    { question: "Você se sentiu cansado ou exausto sem motivo aparente nos últimos 7 dias?", options: ["1. Nunca", "2. Ocasionalmente", "3. Frequentemente", "4. Diariamente"] },
    { question: "Você notou algum inchaço em suas articulações nos últimos 7 dias?", options: ["1. Nenhum", "2. Leve", "3. Moderado", "4. Grave"] },
    { question: "Você conseguiu realizar tarefas como abrir um pote ou subir escadas nos últimos 7 dias?", options: ["1. Sem dificuldade", "2. Com alguma dificuldade", "3. Com muita dificuldade", "4. Incapaz de realizar"] },
    { question: "Como você classificaria a qualidade do seu sono nos últimos 7 dias?", options: ["1. Excelente", "2. Boa", "3. Regular", "4. Ruim"] },
    { question: "Você se sentiu ansioso ou deprimido nos últimos 7 dias?", options: ["1. Nunca", "2. Ocasionalmente", "3. Frequentemente", "4. Diariamente"] }
];

let responses = {};

const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 60, // Limita cada IP a 60 requisições por janela de tempo
    message: "Muitas requisições criadas a partir deste IP, por favor tente novamente após um minuto"
});

app.use(limiter);

function sendMessage(phoneNumber, message) {
    const url = apiUrl;
    const data = {
        phone: phoneNumber,
        message: message
    };

    const headers = {
        'Content-Type': 'application/json',
        'Client-Token': clientToken
    };

    return axios.post(url, data, { headers })
        .then(response => {
            console.log(`Mensagem enviada para ${phoneNumber}: ${message}`);
        })
        .catch(error => {
            console.error(`Erro ao enviar mensagem para ${phoneNumber}:`, error.response ? error.response.data : error.message);
        });
}

async function sendQuestion(phoneNumber, questionIndex) {
    const question = questions[questionIndex];
    const optionsText = question.options.join('\n');
    const message = `${question.question}\nPor favor, responda com o número correspondente:\n${optionsText}`;

    console.log(`Enviando pergunta ${questionIndex + 1} para ${phoneNumber}`);

    try {
        await sendMessage(phoneNumber, message);
    } catch (err) {
        console.error(`Erro ao enviar pergunta ${questionIndex + 1} para ${phoneNumber}: ${err.message}`);
    }
}

async function handleCompletion(phoneNumber, userResponses) {
    try {
        let score = 0;
        userResponses.answers.forEach((answer, index) => {
            const selectedAnswerIndex = questions[index].options.indexOf(answer) + 1;
            score += selectedAnswerIndex;
        });

        let condition = "Leve";
        if (score >= 8 && score <= 14) condition = "Moderada";
        else if (score >= 15 && score <= 21) condition = "Grave";
        else if (score >= 22) condition = "Muito Grave";

        let finalMessage = "Obrigado por responder às perguntas!";
        if (condition === "Muito Grave") {
            finalMessage += " Recomendamos que você consulte um médico imediatamente devido à gravidade da sua condição.";
        }

        await sendMessage(phoneNumber, finalMessage);
        await saveResponsesToDatabase(phoneNumber, userResponses.answers);

        delete responses[phoneNumber];
    } catch (error) {
        console.error(`Erro ao processar a conclusão do questionário para ${phoneNumber}:`, error);
    }
}

async function saveResponsesToDatabase(phoneNumber, answers) {
    try {
        const poolRequest = pool.request();

        // Adicione todos os parâmetros necessários com nomes únicos
        poolRequest.input('phone', sql.VarChar, phoneNumber);
        poolRequest.input('answer1', sql.VarChar, answers[0] || null);
        poolRequest.input('answer2', sql.VarChar, answers[1] || null);
        poolRequest.input('answer3', sql.VarChar, answers[2] || null);
        poolRequest.input('answer4', sql.VarChar, answers[3] || null);
        poolRequest.input('answer5', sql.VarChar, answers[4] || null);
        poolRequest.input('answer6', sql.VarChar, answers[5] || null);
        poolRequest.input('answer7', sql.VarChar, answers[6] || null);
        poolRequest.input('answer8', sql.VarChar, answers[7] || null);

        // Execute a consulta com os parâmetros nomeados
        await poolRequest.query(`
            INSERT INTO Responses (Phone, Answer1, Answer2, Answer3, Answer4, Answer5, Answer6, Answer7, Answer8)
            VALUES (@phone, @answer1, @answer2, @answer3, @answer4, @answer5, @answer6, @answer7, @answer8)
        `);

        console.log('Respostas salvas com sucesso');
    } catch (error) {
        console.error('Erro ao inserir no banco de dados:', error);
    }
}

fs.createReadStream(contactsFilePath)
    .pipe(csv())
    .on('headers', (headers) => {
        console.log('Cabeçalhos processados:', headers);
    })
    .on('data', (row) => {
        const phoneNumber = row['numero'] ? row['numero'].replace('+', '') : '';
        if (phoneNumber) {
            sendMessage(phoneNumber, 'Olá! Este é um questionário sobre saúde reumatológica realizado pela Immuned. Por favor, responda às perguntas a seguir para que possamos avaliar sua condição.')
                .then(() => {
                    responses[phoneNumber] = { currentQuestion: 0, answers: [] };
                    sendQuestion(phoneNumber, 0);
                });
        } else {
            console.log('Linha vazia ou número de telefone ausente');
        }
    })
    .on('end', () => {
        console.log('Arquivo CSV processado com sucesso');
    });

app.post('/webhook', async (req, res) => {
    console.log('Requisição recebida no webhook:', req.body);

    const { phone, type, text } = req.body;

    // Verifica se o tipo de mensagem é suportado e se contém um texto válido
    if (type !== 'Message' || !text || (typeof text !== 'string' && (!text.body || typeof text.body !== 'string'))) {
        console.log(`Tipo de mensagem não suportado ou texto vazio: Type: ${type}, Text: ${JSON.stringify(text)}`);
        return res.sendStatus(200);
    }

    // Se o texto for um objeto com a propriedade message, utilize-a
    const body = typeof text === 'string' ? text : text.message;

    if (!body || !phone) {
        console.log(`Parâmetros do corpo da mensagem inválidos: Body: ${body}, From: ${phone}`);
        return res.sendStatus(400);
    }

    console.log(`Recebendo mensagem de ${phone}: ${body}`);

    const phoneNumber = phone.replace('-', '');
    if (!responses[phoneNumber]) {
        console.log(`Iniciando nova conversa para o número ${phoneNumber}`);
        responses[phoneNumber] = {
            currentQuestion: 0,
            answers: []
        };
        await sendQuestion(phoneNumber, 0);  // Envia a primeira pergunta
        return res.sendStatus(200);
    }

    const userResponses = responses[phoneNumber];
    console.log(`Resposta atual do usuário ${phoneNumber}:`, userResponses);

    if (userResponses.currentQuestion < questions.length) {
        const question = questions[userResponses.currentQuestion];
        const selectedOption = parseInt(body);

        if (selectedOption && selectedOption >= 1 && selectedOption <= question.options.length) {
            userResponses.answers.push(question.options[selectedOption - 1]);
            userResponses.currentQuestion++;

            if (userResponses.currentQuestion < questions.length) {
                await sendQuestion(phoneNumber, userResponses.currentQuestion);
            } else {
                await handleCompletion(phoneNumber, userResponses);
            }
        } else {
            await sendMessage(phoneNumber, `Resposta inválida. Por favor, responda com um número de 1 a ${question.options.length}`);
        }
    } else {
        console.log(`Todas as perguntas já foram respondidas para o número ${phoneNumber}`);
    }

    res.sendStatus(200);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

