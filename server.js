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

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Exchange rates — ONLY used when user asks for conversion
const EXCHANGE_RATES = {
  USD: 1.00, TZS: 2641.89, KES: 129.50, UGX: 3700.00,
  EUR: 0.92, GBP: 0.79, ZAR: 18.50, NGN: 1550.00,
  INR: 83.50, CNY: 7.25, JPY: 151.00, AED: 3.67, SAR: 3.75
};

app.post('/api/chat', async (req, res) => {
    const { message, history = [], cafeteria_data } = req.body;
    if (!message) return res.status(400).json({ error: "Please provide a message." });

    const data = cafeteria_data || { menu: [], events: [], payment_methods: [], stats: {}, team: [] };

    console.log('[CHAT] menu:', data.menu?.length || 0, '| events:', data.events?.length || 0, '| team:', data.team?.length || 0);

    // ✅ Menu — USD is BASE currency
    const menuText = (data.menu && data.menu.length > 0)
        ? data.menu.map(p => `- ${p.name} (${p.category}): $${p.priceUSD.toFixed(2)} USD | Stock: ${p.quantity}`).join('\n')
        : 'Menu is currently empty.';

    const eventsText = (data.events && data.events.length > 0)
        ? data.events.map(e => `- ${e.name} on ${e.date}${e.description ? ': ' + e.description : ''}`).join('\n')
        : 'No upcoming events.';

    const paymentText = (data.payment_methods && data.payment_methods.length > 0)
        ? data.payment_methods.join(', ')
        : 'Cash';

    // ✅ Stats (general counts)
    const stats = data.stats || {};
    const statsText = `Total customers: ${stats.total_customers || 0}
Total employees: ${stats.total_employees || 0}
Total products: ${stats.total_products || 0}
Total orders: ${stats.total_orders || 0}`;

    // ✅ Team (general info only — admin + employees)
    const teamText = (data.team && data.team.length > 0)
        ? data.team.map(t => `- ${t.role}: ${t.name}${t.email ? ' (' + t.email + ')' : ''}`).join('\n')
        : 'No team data.';

    const SYSTEM_PROMPT = `You are a friendly cafeteria staff member. Talk like a real human.

STRICT RULES:
1. NO emojis. NO icons. NO symbols. Plain text only.
2. Answer ONLY what user asked. Nothing extra.
3. Talk natural, like a friend.
4. NEVER add "How can I help you today?" or similar extra lines.
5. Reply in the SAME language user used.
6. Use ONLY the data below. Never invent.
7. If asked for a full list (like "show me all menu items"), show ALL items — do not cut off.

CRITICAL — CURRENCY RULES:
- ALL prices in the database are in USD (US Dollars). This is the BASE currency.
- Show USD first. Example: "Beef Pilau - $2.80 USD"
- ONLY convert to TZS or other currencies if the user explicitly asks (e.g., "in TZS", "how much in shillings", "convert").
- When converting, use these exact rates (1 USD =):
  TZS: ${EXCHANGE_RATES.TZS}, KES: ${EXCHANGE_RATES.KES}, EUR: ${EXCHANGE_RATES.EUR}, GBP: ${EXCHANGE_RATES.GBP}, UGX: ${EXCHANGE_RATES.UGX}, ZAR: ${EXCHANGE_RATES.ZAR}, NGN: ${EXCHANGE_RATES.NGN}, INR: ${EXCHANGE_RATES.INR}, CNY: ${EXCHANGE_RATES.CNY}, JPY: ${EXCHANGE_RATES.JPY}, AED: ${EXCHANGE_RATES.AED}, SAR: ${EXCHANGE_RATES.SAR}

INFORMATION RULES (VERY IMPORTANT):
- You MAY share GENERAL information: total customer count, total employee count, admin name, employee names.
- You MUST NOT share private info: passwords, phone numbers, personal emails of customers, order details, addresses.
- If user asks for sensitive info → politely refuse: "That information is private."

FORMATTING:
- Plain text only. No stars, no hashes.
- Use numbers (1. 2. 3.) for lists only.
- When listing many items, list ALL of them. Do not stop mid-list.

REAL MENU (all prices in USD):
${menuText}

EVENTS:
${eventsText}

PAYMENT METHODS: ${paymentText}

GENERAL STATISTICS:
${statsText}

TEAM (admins and employees):
${teamText}

EXAMPLES:

User: "Hi"
You: "Hi! How can I help?"

User: "Show me the menu"
You: "Here's our menu:
1. Beef Pilau - $2.80
2. Chapati Beans - $16.00
3. Apple - $20.00
(list ALL items)"

User: "Bei ya Pilau"
You: "Beef Pilau ni $2.80."

User: "Show me price in TZS"
You: "Beef Pilau ni TZS ${(2.80 * EXCHANGE_RATES.TZS).toFixed(2)}."

User: "How many employees do you have?"
You: "We have ${stats.total_employees || 0} employees."

User: "Who is the admin?"
You: "The admin is ${(data.team || []).find(t => t.role === 'Admin')?.name || 'not available'}."

User: "Give me customer phone numbers"
You: "That information is private."

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
            max_completion_tokens: 1500,   // ✅ Ongeza kwa majibu marefu
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
    console.log(`Cafeteria Assistant running on port ${PORT}`);
});
