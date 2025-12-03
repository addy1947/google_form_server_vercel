import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const GEMINI_KEY = process.env.GEMINI_API_KEY;

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const payload = req.body || {};
    const questions = Array.isArray(payload.questions)
        ? payload.questions
        : payload.question
            ? [payload]
            : [];

    if (!GEMINI_KEY || GEMINI_KEY === 'YOUR_API_KEY_HERE') {
        const results = questions.map(q => ({
            questionId: q.id || null,
            questionType: q.type,
            gemini: { ok: false, error: 'No GEMINI_KEY - fallback used' },
            answer: Array.isArray(q.options) && q.options.length ? q.options[0] : (q.type === 'text' ? '' : null),
            fallback: true,
        }));
        return res.json({ received: true, results });
    }

    const prompt = `You are given questions in JSON format. Each question has a "type" field that can be:
                    - "multiple_choice": Select one option from the provided options
                    - "checkbox": Select one or more options from the provided options (answer should be an array)
                    - "dropdown": Select one option from the provided options
                    - "text": Provide a text answer (no options provided)

                    Respond with a JSON array containing objects with ONLY two keys: "id" and "answer".
                    The "id" must match the input question id exactly.
                    
                    For multiple_choice, dropdown: "answer" must be exactly one of the provided options.
                    For checkbox: "answer" should be an array with one or more of the provided options.
                    For text questions: 
                      - If the question asks for personal information like Name, Enrollment Number, Roll Number, Email, Phone, Address, Class, Group, ID, Registration, Student Number, etc., return an empty string "".
                      - Otherwise, provide a relevant factual answer based on the question content.

                    Input questions:
                    ${JSON.stringify(questions, null, 2)}

                    Respond ONLY with a JSON array in this exact format:
                    [
                    {"id": "question_id_1", "answer": "option text"},
                    {"id": "question_id_2", "answer": ["option1", "option2"]},
                    {"id": "question_id_3", "answer": ""},
                    {"id": "question_id_4", "answer": "factual answer"}
                    ]

                    Do not include any explanations, markdown formatting, or extra text.`;

    const url = `${GEMINI_URL}?key=${encodeURIComponent(GEMINI_KEY)}`;
    const headers = { 'Content-Type': 'application/json' };
    const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.0,
            maxOutputTokens: 4096,
        },
    };

    try {
        const resp = await axios.post(url, body, { headers, timeout: 30000 });
        const candidates = resp.data?.candidates;
        let text = candidates?.[0]?.content?.parts?.[0]?.text || '';
        text = text.trim().replace(/^```json\s*/m, '').replace(/```\s*$/m, '');
        let answersArray = null;
        try {
            answersArray = JSON.parse(text);
        } catch (err) {
            const match = text.match(/\[[\s\S]*\]/);
            if (match) {
                try {
                    answersArray = JSON.parse(match[0]);
                } catch {
                    answersArray = null;
                }
            }
        }
        const results = [];
        if (Array.isArray(answersArray)) {
            for (const q of questions) {
                const geminiAnswer = answersArray.find(a => a.id === q.id);
                if (geminiAnswer && geminiAnswer.answer) {
                    results.push({
                        questionId: q.id,
                        questionType: q.type,
                        gemini: { ok: true, parsed: geminiAnswer },
                        answer: geminiAnswer.answer,
                        fallback: false,
                    });
                } else {
                    results.push({
                        questionId: q.id,
                        questionType: q.type,
                        gemini: { ok: false, error: 'No answer from Gemini for this question' },
                        answer: Array.isArray(q.options) && q.options.length ? q.options[0] : (q.type === 'text' ? '' : null),
                        fallback: true,
                    });
                }
            }
        } else {
            for (const q of questions) {
                results.push({
                    questionId: q.id,
                    questionType: q.type,
                    gemini: { ok: false, error: 'Failed to parse Gemini response' },
                    answer: Array.isArray(q.options) && q.options.length ? q.options[0] : (q.type === 'text' ? '' : null),
                    fallback: true,
                });
            }
        }
        res.json({ received: true, results });
    } catch (err) {
        const results = questions.map(q => ({
            questionId: q.id || null,
            questionType: q.type,
            gemini: {
                ok: false,
                error: err.message,
                status: err.response?.status,
                data: err.response?.data,
            },
            answer: Array.isArray(q.options) && q.options.length ? q.options[0] : (q.type === 'text' ? '' : null),
            fallback: true,
        }));
        res.json({ received: true, results });
    }
}
