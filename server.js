import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import Groq from 'groq-sdk';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3005;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(express.json());
app.use(express.static(__dirname));

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Exchange rates (only use if user asks for conversion)
const EXCHANGE_RATES = {
  USD: 1.00, TZS: 2641.89, KES: 129.50, UGX: 3700.00,
  EUR: 0.92, GBP: 0.79, ZAR: 18.50, NGN: 1550.00,
  INR: 83.50, CNY: 7.25, JPY: 151.00, AED: 3.67, SAR: 3.75
};

// ================================================
// CHAT ENDPOINT
// Receives: { message, history, cafeteria_data }
// cafeteria_data comes from the browser (fetched from menu_api.php)
// ================================================
app.post('/api/chat', async (req, res) => {
    const { message, history = [], cafeteria_data } = req.body;
    if (!message) return res.status(400).json({ error: "Please provide a message." });

    // ✅ Data inatoka kwa browser (kutoka menu_api.php)
    const data = cafeteria_data || { menu: [], events: [], payment_methods: [] };

    console.log('[CHAT] Received data - menu:', data.menu?.length || 0, '| events:', data.events?.length || 0, '| payments:', data.payment_methods?.length || 0);

    const menuText = (data.menu && data.menu.length > 0)
        ? data.menu.map(p => `- ${p.name} (${p.category}): TZS ${p.price} | Stock: ${p.quantity}`).join('\n')
        : 'Menu is currently empty.';

    const eventsText = (data.events && data.events.length > 0)
        ? data.events.map(e => `- ${e.name} on ${e.date}${e.description ? ': ' + e.description : ''}`).join('\n')
        : 'No upcoming events.';

    const paymentText = (data.payment_methods && data.payment_methods.length > 0)
        ? data.payment_methods.join(', ')
        : 'Cash';

    const SYSTEM_PROMPT = `You are a friendly cafeteria staff member. Talk like a real human.

STRICT RULES:
1. NO emojis. NO icons. NO symbols. Plain text only.
2. Answer ONLY what user asked. Nothing extra.
3. Keep replies SHORT. 1-3 lines max.
4. Talk natural, like a friend.
5. NEVER add "How can I help you today?" or similar extra lines.
6. NEVER add closing lines like "Let me know if you need anything".
7. Reply in the SAME language user used.
8. Use ONLY the real data below. Never invent.
9. If an item is not in the list, say it's not available.

FORMATTING:
- Plain text only. No stars, no hashes, no bullets with symbols.
- Use numbers (1. 2. 3.) for lists only.

REAL MENU (from our database):
${menuText}

EVENTS:
${eventsText}

PAYMENT METHODS: ${paymentText}

Exchange rates (use ONLY if user asks for conversion):
TZS: ${EXCHANGE_RATES.TZS}, KES: ${EXCHANGE_RATES.KES}, EUR: ${EXCHANGE_RATES.EUR}, GBP: ${EXCHANGE_RATES.GBP}

EXAMPLES:

User: "Hi"
You: "Hi! How can I help?"

User: "How are you"
You: "I'm good, thanks."

User: "Show me the menu"
You: "Here's what we have:
1. [item name] - TZS [price]
2. [item name] - TZS [price]"

User: "Bei ya Pilau"
You: "[Item name] ni TZS [price]."

User: "Bye"
You: "Bye!"`;

    const messagesPayload = [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.slice(-6),
        { role: "user", content: message }
    ];

    try {
        const stream = await groq.chat.completions.create({
            messages: messagesPayload,
            model: "openai/gpt-oss-120b",
            temperature: 0.2,
            max_completion_tokens: 400,
            stream: true
        });

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) res.write(content);
        }
        res.end();

    } catch (error) {
        console.error("GROQ ERROR:", error.message || error);
        if (!res.headersSent) {
            return res.status(500).json({ error: "AI error", details: error.message });
        }
        res.write("\nError occurred.");
        res.end();
    }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
    console.log(`Cafeteria Assistant running at http://localhost:${PORT}`);
});
