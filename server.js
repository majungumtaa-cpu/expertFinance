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
// LIVE DATA kutoka cafeteria database
// ================================================
const CAFETERIA_API = 'http://cafeterias.infinityfree.me/menu_api.php';

let cachedData = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 1000; // 30 sekunde

async function fetchCafeteriaData() {
    const now = Date.now();
    if (cachedData && (now - cacheTime) < CACHE_TTL) {
        return cachedData;
    }
    try {
        console.log('[DATA] Fetching:', CAFETERIA_API);
        const res = await fetch(CAFETERIA_API);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        cachedData = JSON.parse(text);
        cacheTime = now;
        console.log('[DATA] Menu items:', cachedData.menu?.length || 0);
        console.log('[DATA] Events:', cachedData.events?.length || 0);
        console.log('[DATA] Payment methods:', cachedData.payment_methods?.length || 0);
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
        : 'Menu not loaded.';

    const eventsText = data.events.length > 0
        ? data.events.map(e => `- ${e.name} on ${e.date}`).join('\n')
        : 'No events.';

    const paymentText = data.payment_methods.length > 0
        ? data.payment_methods.join(', ')
        : 'Cash';

    const SYSTEM_PROMPT = `You are a friendly cafeteria staff member. Talk like a real human.

STRICT RULES:
1. NO emojis. NO icons. NO symbols. Plain text only.
2. Answer ONLY what user asked. Nothing extra.
3. Keep replies SHORT. 1-3 lines max.
4. Talk natural, like a friend. Not like a robot.
5. NEVER add "How can I help you today?" or similar extra lines.
6. NEVER add closing lines like "Let me know if you need anything".
7. Reply in the SAME language user used (English, Swahili, French, etc).
8. Use ONLY the data below. Never invent items or prices.
9. If asked about an item not in the list, say it's not available.

FORMATTING:
- Plain text only. No stars, no hashes, no bullets.
- Use numbers (1. 2. 3.) for lists only.

REAL MENU (from our database):
${menuText}

EVENTS:
${eventsText}

PAYMENT METHODS: ${paymentText}

Exchange rates (use ONLY if user asks for conversion):
TZS: ${EXCHANGE_RATES.TZS}, KES: ${EXCHANGE_RATES.KES}, EUR: ${EXCHANGE_RATES.EUR}, GBP: ${EXCHANGE_RATES.GBP}

EXAMPLES OF GOOD REPLIES:

User: "Hi"
You: "Hi! How can I help?"

User: "How are you"
You: "I'm good, thanks."

User: "Show me the menu"
You: "Here's what we have:
1. Beef Pilau - TZS 2.80
2. Chapati Beans - TZS 16.00
3. Apple - TZS 20.00"

User: "Bei ya Pilau"
You: "Beef Pilau ni TZS 2.80."

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
app.get('/data', async (req, res) => {
    const data = await fetchCafeteriaData();
    res.json(data);
});
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
    console.log(`Cafeteria Assistant running at http://localhost:${PORT}`);
});
