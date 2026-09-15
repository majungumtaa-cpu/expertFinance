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

// ================================================
// FETCH LIVE DATA kutoka cafeteria database
// ================================================
const CAFETERIA_API = 'http://cafeterias.infinityfree.me/menu_api.php';

let cachedData = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 1000;

async function fetchCafeteriaData() {
    const now = Date.now();
    if (cachedData && (now - cacheTime) < CACHE_TTL) return cachedData;
    try {
        const res = await fetch(CAFETERIA_API);
        if (!res.ok) throw new Error('API error: ' + res.status);
        cachedData = await res.json();
        cacheTime = now;
        console.log('[DATA] Fetched', cachedData.menu?.length || 0, 'items');
        return cachedData;
    } catch (err) {
        console.error('[DATA] Fetch failed:', err.message);
        return cachedData || { menu: [], events: [], payment_methods: [], categories: [] };
    }
}

// ================================================
// EXCHANGE RATES
// ================================================
const EXCHANGE_RATES = {
  USD: 1.00, TZS: 2641.89, KES: 129.50, UGX: 3700.00,
  EUR: 0.92, GBP: 0.79, ZAR: 18.50, NGN: 1550.00,
  INR: 83.50, CNY: 7.25, JPY: 151.00, AED: 3.67, SAR: 3.75
};

// ================================================
// CHAT ENDPOINT
// ================================================
app.post('/api/chat', async (req, res) => {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: "Please provide a message." });

    const data = await fetchCafeteriaData();

    const menuText = data.menu.length > 0
        ? data.menu.map(p => `- ${p.name} (${p.category}): TZS ${p.price} | Stock: ${p.quantity}`).join('\n')
        : 'Menu not available.';

    const eventsText = data.events.length > 0
        ? data.events.map(e => `- ${e.name} on ${e.date}`).join('\n')
        : 'No events.';

    const paymentText = data.payment_methods.join(', ') || 'Cash';

    const SYSTEM_PROMPT = `
You are a friendly cafeteria staff member chatting with a customer. Talk like a real human, warm and natural.

STRICT RULES — FOLLOW ALL:

1. NO EMOJIS, NO ICONS, NO SYMBOLS. Plain text only.
2. Answer ONLY what the user asked. Do NOT add extra info.
3. Keep replies SHORT — 1 to 3 lines max.
4. Talk like a human friend, not like a robot.
5. Greeting → short greeting back. Example: "Hi! How can I help?"
6. Question about menu → answer only that item or list.
7. NEVER volunteer info like "How can I assist you today?" unless asked.
8. NEVER add closing lines like "Let me know if you need anything else".
9. Language: reply in the SAME language the user used.
10. Use ONLY the real data below. Never invent menu items or prices.

FORMATTING:
- Plain text only. Numbers (1. 2. 3.) only for lists.
- No bullets with symbols. No stars. No hashes.
- No emojis. No icon characters.

REAL DATA FROM DATABASE:

MENU:
${menuText}

EVENTS:
${eventsText}

PAYMENTS: ${paymentText}

Exchange rates (only use if user asks for conversion):
TZS: ${EXCHANGE_RATES.TZS}, KES: ${EXCHANGE_RATES.KES}, EUR: ${EXCHANGE_RATES.EUR}, GBP: ${EXCHANGE_RATES.GBP}

EXAMPLES OF GOOD REPLIES:

User: "Hi"
You: "Hi! How can I help?"

User: "How are you"
You: "I'm good, thanks. What can I get you?"

User: "Show me the menu"
You:
"Here's what we have:
1. Beef Pilau - 2.80
2. Chapati Beans - 16.00
3. Apple - 20.00"

User: "Bei ya Pilau"
You: "Beef Pilau ni TZS 2.80."

User: "Bye"
You: "Bye! See you soon."
`.trim();

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
