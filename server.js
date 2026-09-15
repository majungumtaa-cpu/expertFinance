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

const EXCHANGE_RATES = {
  USD: 1.00, TZS: 2641.89, KES: 129.50, UGX: 3700.00,
  EUR: 0.92, GBP: 0.79, ZAR: 18.50, NGN: 1550.00,
  INR: 83.50, CNY: 7.25, JPY: 151.00, AED: 3.67, SAR: 3.75
};

app.post('/api/chat', async (req, res) => {
    const { message, history = [], cafeteria_data } = req.body;
    if (!message) return res.status(400).json({ error: "Please provide a message." });

    const data = cafeteria_data || { menu: [], events: [], payment_methods: [], stats: {}, team: [] };

    console.log('[CHAT] menu:', data.menu?.length || 0, '| events:', data.events?.length || 0);

    // Menu — USD is BASE
    const menuText = (data.menu && data.menu.length > 0)
        ? data.menu.map(p => `- ${p.name} (${p.category}): $${p.priceUSD.toFixed(2)} USD | Stock: ${p.quantity}`).join('\n')
        : 'Menu is currently empty.';

    const eventsText = (data.events && data.events.length > 0)
        ? data.events.map(e => `- ${e.name} on ${e.date}${e.description ? ': ' + e.description : ''}`).join('\n')
        : 'No upcoming events.';

    const paymentText = (data.payment_methods && data.payment_methods.length > 0)
        ? data.payment_methods.join(', ')
        : 'Cash';

    const stats = data.stats || {};
    const statsText = `Total customers: ${stats.total_customers || 0}
Total employees: ${stats.total_employees || 0}
Total products: ${stats.total_products || 0}
Total orders: ${stats.total_orders || 0}`;

    const teamText = (data.team && data.team.length > 0)
        ? data.team.map(t => `- ${t.role}: ${t.name}${t.email ? ' (' + t.email + ')' : ''}`).join('\n')
        : 'No team data.';

    const adminName = (data.team || []).find(t => t.role === 'Admin')?.name || 'the admin';

    // ✅ FOOD KNOWLEDGE — DYNAMIC kutoka database
    let foodKnowledgeText = '';
    if (data.menu && data.menu.length > 0) {
        data.menu.forEach(p => {
            if (p.food_info && (p.food_info.benefits || p.food_info.nutrition || p.food_info.best_for)) {
                foodKnowledgeText += `\n--- ${p.name} ---\n`;
                if (p.food_info.benefits) foodKnowledgeText += `Benefits: ${p.food_info.benefits}\n`;
                if (p.food_info.side_effects) foodKnowledgeText += `Side effects: ${p.food_info.side_effects}\n`;
                if (p.food_info.nutrition) foodKnowledgeText += `Nutrition: ${p.food_info.nutrition}\n`;
                if (p.food_info.best_for) foodKnowledgeText += `Best for: ${p.food_info.best_for}\n`;
                if (p.food_info.avoid_if) foodKnowledgeText += `Avoid if: ${p.food_info.avoid_if}\n`;
                foodKnowledgeText += `Available: ${p.quantity > 0 ? 'Yes (' + p.quantity + ' in stock)' : 'No'}\n`;
            }
        });
    }

    const SYSTEM_PROMPT = `You are a friendly cafeteria staff member. Talk like a real human.

STRICT RULES:
1. NO emojis. NO icons. NO symbols. Plain text only.
2. Answer ONLY what user asked. Nothing extra.
3. Talk natural, like a friend.
4. NEVER add "How can I help you today?" or similar extra lines.
5. Reply in the SAME language user used.
6. Use ONLY the data below. Never invent.
7. If asked for a full list, show ALL items.

CRITICAL — CURRENCY RULES:
- ALL prices in the database are in USD.
- Show USD first. Example: "Beef Pilau - $2.80 USD"
- ONLY convert if user asks.
- Rates (1 USD =): TZS: ${EXCHANGE_RATES.TZS}, KES: ${EXCHANGE_RATES.KES}, EUR: ${EXCHANGE_RATES.EUR}, GBP: ${EXCHANGE_RATES.GBP}

CRITICAL — FOOD KNOWLEDGE RULES:
- The FOOD KNOWLEDGE section below is updated daily from our database.
- ONLY share this info when user asks about it.
- Examples that trigger sharing:
  - "What are the benefits of X?" / "Faida za X?"
  - "Is X healthy?"
  - "Nutrition of X?" / "Virutubisho vya X?"
  - "Can I eat X if I have diabetes?"
  - "Hasara za X?" / "Side effects of X?"
- Do NOT volunteer nutrition info if user just asks for the menu.
- If food is not in FOOD KNOWLEDGE section, say: "I don't have detailed nutrition info for that item."
- NEVER invent nutrition facts.

INFORMATION RULES:
- MAY share: total customers count, total employees count, admin name, employee names.
- MUST NOT share: passwords, phone numbers, personal emails, order details, addresses.
- If asked for private info → "That information is private."

SYSTEM HELP:

HOW TO LOGIN:
1. Open the homepage
2. Click Customer Portal (customers) or Staff Portal (staff)
3. Enter email and password
4. Click Login

FORGOT PASSWORD:
1. Click Forgot Password on login page
2. Enter your email
3. Check for 6-digit OTP code
4. Enter OTP
5. Set new password
6. Login

CONTACT ADMIN:
- Admin: ${adminName}
- Email: support@cafeteria.com
- Use Feedback section

HOW TO ORDER:
1. Login to Customer Portal
2. Browse menu
3. Add to cart
4. Checkout
5. Choose payment
6. Confirm

FORMATTING:
- Plain text only. No stars, no hashes.
- Use numbers (1. 2. 3.) for lists.

REAL MENU (all prices in USD):
${menuText}

EVENTS:
${eventsText}

PAYMENT METHODS: ${paymentText}

GENERAL STATISTICS:
${statsText}

TEAM:
${teamText}

FOOD KNOWLEDGE (share ONLY when asked):
${foodKnowledgeText || 'No detailed nutrition info available yet. Please ask the admin to update the food_info table.'}

EXAMPLES:

User: "Hi"
You: "Hi! How can I help?"

User: "Show me the menu"
You: "Here's our menu:
1. Beef Pilau - $2.80
(list all)"

User: "What are the benefits of Beef Pilau?"
You: "Beef Pilau is high in protein from beef and gives energy from rice. Rich in iron and B vitamins."

User: "Faida za Apple?"
You: "Apple ni tajiri wa fiber na antioxidants. Inasaidia mmeng'enyo na kinga ya mwili."

User: "Is Samosa healthy?"
You: "Samosa is fried, so it's high in oil and calories. It's fine as an occasional snack but not for daily eating."

User: "Do you have Apple?"
You: "Yes, we have Apple in stock."

User: "Bei ya Pilau"
You: "Beef Pilau ni $2.80."

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
            max_completion_tokens: 1500,
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
