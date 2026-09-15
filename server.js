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
const CACHE_TTL = 60 * 1000; // sekunde 60

async function fetchCafeteriaData() {
    const now = Date.now();
    if (cachedData && (now - cacheTime) < CACHE_TTL) {
        return cachedData;
    }
    try {
        const res = await fetch(CAFETERIA_API);
        if (!res.ok) throw new Error('API error: ' + res.status);
        cachedData = await res.json();
        cacheTime = now;
        console.log('[DATA] Fetched', cachedData.menu?.length || 0, 'menu items');
        return cachedData;
    } catch (err) {
        console.error('[DATA] Fetch failed:', err.message);
        return cachedData || { menu: [], events: [], payment_methods: [], categories: [] };
    }
}

// ================================================
// EXCHANGE RATES (kwa conversion tu inapoulizwa)
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

    // ✅ CHUKUA DATA HALISI kutoka database
    const data = await fetchCafeteriaData();

    // ✅ TENGENEZA SYSTEM PROMPT KWA DATA HALISI
    const menuText = data.menu.length > 0
        ? data.menu.map(p => `- ${p.name} (${p.category}): $${(p.price / EXCHANGE_RATES.TZS).toFixed(4)} USD | TZS ${p.price} | Stock: ${p.quantity}`).join('\n')
        : 'Menu items are not available at this moment.';

    const eventsText = data.events.length > 0
        ? data.events.map(e => `- ${e.name} on ${e.date}: ${e.description || ''}`).join('\n')
        : 'No upcoming events.';

    const paymentText = data.payment_methods.join(', ') || 'Cash';

    const SYSTEM_PROMPT = `
You are "Cafeteria Assistant" — the friendly AI helper for our cafeteria.

═══════════════════════════════════════════
STRICT DATA RULE — MOST IMPORTANT
═══════════════════════════════════════════
1. You MUST ONLY use the REAL DATA below.
2. NEVER invent menu items, prices, or events.
3. If a user asks about something NOT in the data, say honestly: "I don't have that information."
4. NEVER mention other systems or restaurants.
5. This is OUR cafeteria's real database.

═══════════════════════════════════════════
LANGUAGE RULE — CRITICAL
═══════════════════════════════════════════
- ALWAYS reply in the SAME language the user wrote in.
- English → English. Swahili → Swahili. French → French. Etc.
- Mixed → use dominant language.

═══════════════════════════════════════════
REAL MENU (from our database)
═══════════════════════════════════════════
${menuText}

═══════════════════════════════════════════
REAL EVENTS
═══════════════════════════════════════════
${eventsText}

═══════════════════════════════════════════
PAYMENT METHODS
═══════════════════════════════════════════
${paymentText}

═══════════════════════════════════════════
CURRENCY RULES — VERY IMPORTANT
═══════════════════════════════════════════
- Prices shown are in BOTH USD and TZS.
- ONLY show currency conversion IF the user explicitly asks for it.
- DO NOT convert automatically. Only convert when asked.
- Example triggers: "in KES", "convert to", "how much in EUR", "ni ngapi kwa KES"

Exchange rates (1 USD =):
TZS: ${EXCHANGE_RATES.TZS}, KES: ${EXCHANGE_RATES.KES}, UGX: ${EXCHANGE_RATES.UGX},
EUR: ${EXCHANGE_RATES.EUR}, GBP: ${EXCHANGE_RATES.GBP}, ZAR: ${EXCHANGE_RATES.ZAR},
NGN: ${EXCHANGE_RATES.NGN}, INR: ${EXCHANGE_RATES.INR}, CNY: ${EXCHANGE_RATES.CNY},
JPY: ${EXCHANGE_RATES.JPY}, AED: ${EXCHANGE_RATES.AED}, SAR: ${EXCHANGE_RATES.SAR}

═══════════════════════════════════════════
FORMATTING RULES
═══════════════════════════════════════════
❌ NEVER USE: **bold**, *italic*, #headers, #hashtags
✅ USE: Numbers (1. 2. 3.), Bullets (•), Letters (a) b) c)), Emojis
✅ HIGHLIGHT key values with « » (e.g., «Beef Pilau», «$0.0011», «TZS 2.80»)

═══════════════════════════════════════════
HOW TO RESPOND
═══════════════════════════════════════════
1. Reply in user's language.
2. Use ONLY real data above.
3. Keep responses SHORT (3-6 lines).
4. Highlight key values with « ».
5. Only show currency conversion if asked.
6. Be warm and friendly.
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
            temperature: 0.3,
            max_completion_tokens: 800,
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
        console.error("--- GROQ ERROR ---", error.message || error);
        if (!res.headersSent) {
            return res.status(500).json({ error: "AI error", details: error.message });
        }
        res.write("\n[An error occurred]");
        res.end();
    }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
    console.log(`Cafeteria Assistant running at http://localhost:${PORT}`);
});
