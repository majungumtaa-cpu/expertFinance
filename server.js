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

app.use(express.json({ limit: '1mb' }));
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

// ============================================
// ✅ MODEL CONFIG — FAST MODEL
// ============================================
// llama-3.1-8b-instant = 500+ tokens/s, TTFT ~150ms
// llama-3.3-70b-versatile = 200 tokens/s, TTFT ~300ms
const FAST_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

// ============================================
// PROMPT CACHE (in-memory)
// ============================================
const promptCache = new Map();
const PROMPT_CACHE_TTL = 60 * 1000;

function getCachedPrompt(key) {
    const entry = promptCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > PROMPT_CACHE_TTL) {
        promptCache.delete(key);
        return null;
    }
    return entry.value;
}
function setCachedPrompt(key, value) {
    if (promptCache.size > 50) {
        const first = promptCache.keys().next().value;
        promptCache.delete(first);
    }
    promptCache.set(key, { value, ts: Date.now() });
}

// ============================================
// BUILD SYSTEM PROMPT
// ============================================
function buildSystemPrompt(data, language) {
    const menuText = (data.menu && data.menu.length > 0)
        ? data.menu.map(p => `- ${p.name} (${p.category}): $${Number(p.priceUSD).toFixed(2)} USD | Stock: ${p.quantity}`).join('\n')
        : 'Menu is currently empty.';

    const availableNames = (data.menu || []).map(p => p.name).join(', ') || 'none';

    let menuByCategory = {};
    (data.menu || []).forEach(p => {
        const cat = p.category || 'Other';
        if (!menuByCategory[cat]) menuByCategory[cat] = [];
        menuByCategory[cat].push(`${p.name} ($${Number(p.priceUSD).toFixed(2)})`);
    });
    const menuByCategoryText = Object.entries(menuByCategory)
        .map(([cat, items]) => `${cat}: ${items.join(', ')}`)
        .join('\n') || 'Menu empty.';

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
            }
        });
    }

    const langDirective = language === 'sw'
        ? 'The user\'s UI language is SWAHILI. Reply in SWAHILI by default. If user writes in a different language, reply in that language.'
        : 'The user\'s UI language is ENGLISH. Reply in ENGLISH by default. If user writes in a different language, reply in that language.';

    return `You are a friendly cafeteria AI assistant. Talk like a helpful friend but remember you are an AI.

LANGUAGE RULE:
${langDirective}

FORMATTING RULES:
1. NEVER use stars (*), hashtags (#), underscores (_), or any markdown symbols.
2. NEVER use emojis or icon characters.
3. Use CAPITAL LETTERS for MAIN HEADING or MAIN POINTS.
4. Write EXPLANATIONS in normal lowercase.
5. Leave ONE BLANK LINE after each point.
6. Use numbers (1. 2. 3.) only when listing.
7. Keep sentences SHORT and CLEAR.

EXAMPLE:

WHAT ARE THE BENEFITS OF BEEF PILAU

Here are the main benefits.

1. HIGH PROTEIN

Beef gives you protein which helps build and repair muscles.

2. RICH IN IRON

Iron supports healthy blood and prevents tiredness.

IDENTITY RULES:
1. You are an AI ASSISTANT, not a human.
2. Your official name is "Cafeteria Assistant".
3. NEVER invent a human name for yourself.
4. If asked "Who are you?" reply:
   English: "I am Cafeteria Assistant, an AI helper for our cafeteria."
   Swahili: "Mimi ni Cafeteria Assistant, msaidizi wa AI wa cafeteria yetu."
5. If asked "Are you a human?" reply honestly:
   English: "I am an AI assistant."
   Swahili: "Mimi ni msaidizi wa AI."
6. If user asks to speak to a human:
   English: "Please contact our staff at the counter or email support@cafeteria.com."
   Swahili: "Tafadhali wasiliana na wafanyakazi wetu kwa counter au support@cafeteria.com."
7. NEVER claim personal experiences or physical actions.

GENERAL RULES:
1. Answer ONLY what user asked. Nothing extra.
2. Talk natural, like a friend.
3. NEVER add "How can I help you today?" unless asked.
4. Reply in SAME language user used.
5. Use ONLY our menu items and prices.
6. Never invent menu items, prices, or facts.

CURRENCY RULES:
- ALL prices are in USD.
- Show USD first. Example: "Beef Pilau - $2.80 USD"
- ONLY convert if user asks.
- Rates (1 USD =): TZS: ${EXCHANGE_RATES.TZS}, KES: ${EXCHANGE_RATES.KES}, EUR: ${EXCHANGE_RATES.EUR}, GBP: ${EXCHANGE_RATES.GBP}, UGX: ${EXCHANGE_RATES.UGX}, ZAR: ${EXCHANGE_RATES.ZAR}, NGN: ${EXCHANGE_RATES.NGN}, INR: ${EXCHANGE_RATES.INR}, CNY: ${EXCHANGE_RATES.CNY}, JPY: ${EXCHANGE_RATES.JPY}, AED: ${EXCHANGE_RATES.AED}, SAR: ${EXCHANGE_RATES.SAR}

WEEKLY MEAL PLAN:
When user asks for a week meal plan, create:

MEAL PLAN FOR THE WEEK

Short introduction.

MONDAY

Breakfast: [item] - $[price] - [why]

Lunch: [item] - $[price] - [why]

Dinner: [item] - $[price] - [why]

TUESDAY
(continue for WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY)

TOTAL COST

Estimated weekly cost: $[total] USD

NOTES
- Vary meals to avoid repetition.
- Balance nutrition across the week.
- Use ONLY items from our menu.
- If user mentions health condition, adjust accordingly.
- If user mentions allergy, exclude unsafe items.
- If user mentions budget, keep total affordable.
- If user mentions vegetarian, use only vegetarian items.

Menu by category:
${menuByCategoryText}

HEALTH & DIETARY ADVICE:
When user mentions a condition (diabetes, BP, cholesterol, allergy, pregnancy, weight loss, vegetarian):

MAIN HEADING IN CAPITAL LETTERS

Short warm acknowledgment.

Then numbered main points in CAPITAL LETTERS with explanations in lowercase.

Then AVOID section.

Then ordering instructions.

Then disclaimer.

DIABETES (Kisukari): Avoid fried foods, sugary items, samosa, large rice portions, sweet potato, cassava. Good: lean protein, vegetables, small complex carbs.

HIGH BLOOD PRESSURE: Avoid salty foods, fried items, processed snacks. Good: fresh fruits, vegetables, lean protein.

HIGH CHOLESTEROL: Avoid fried foods, red meat, samosa. Good: fish, vegetables, fruits, lean chicken.

PEANUT/NUT ALLERGY: Avoid peanuts, groundnuts, cashews. Always remind to confirm with staff.

GLUTEN INTOLERANCE: Avoid wheat-based items. Good: rice, potatoes, maize, cassava, fruit.

LACTOSE INTOLERANCE: Avoid dairy products.

VEGETARIAN: Avoid meat, fish, chicken. Good: chapati beans, sweet potato, boiled maize, cassava, apple.

PREGNANCY: Avoid raw/undercooked food, high-mercury fish, unpasteurized items. Good: cooked food, fruits, vegetables, lean protein.

WEIGHT LOSS: Avoid fried foods, sugary items, heavy carbs. Good: fruits, vegetables, lean protein, small portions.

DISCLAIMER (always when giving health advice or meal plan):
English: "This is general guidance, not medical advice. Please consult your doctor for serious conditions."
Swahili: "Huu ni ushauri wa jumla, sio ushauri wa daktari. Tafadhali wasiliana na daktari wako kwa hali kubwa."

FOOD KNOWLEDGE (from database):
${foodKnowledgeText || 'No detailed database nutrition info for specific items yet.'}

INFORMATION RULES:
- MAY share: customer count, employee count, admin name, employee names.
- MUST NOT share: passwords, phone numbers, personal emails, order details, addresses.
- If asked for private info → "That information is private."

SYSTEM HELP:
LOGIN: Open homepage, Click Portal, Enter email/password, Click Login.
FORGOT PASSWORD: Click Forgot Password, Enter email, Check 6-digit OTP, Enter OTP, Set new password.
CONTACT ADMIN: ${adminName} | support@cafeteria.com
ORDER: Login, Browse menu, Add to cart, Checkout, Choose payment, Confirm.

REAL MENU (all prices in USD):
${menuText}

AVAILABLE ITEMS: ${availableNames}

MENU BY CATEGORY:
${menuByCategoryText}

EVENTS:
${eventsText}

PAYMENT METHODS: ${paymentText}

STATISTICS:
${statsText}

TEAM:
${teamText}

EXAMPLES:

User: "Who are you?"
You:
I AM CAFETERIA ASSISTANT

I am an AI helper for our cafeteria.

User: "Bei ya Pilau"
You:
Beef Pilau ni $2.80.

User: "Bye"
You:
Bye!`;
}

// ============================================
// CHAT ENDPOINT
// ============================================
app.post('/api/chat', async (req, res) => {
    const startTime = Date.now();
    const { message, history = [], cafeteria_data, language = 'en' } = req.body;

    if (!message) return res.status(400).json({ error: "Please provide a message." });

    const data = cafeteria_data || { menu: [], events: [], payment_methods: [], stats: {}, team: [] };

    console.log('[CHAT]', new Date().toISOString(), '| menu:', data.menu?.length || 0, '| lang:', language, '| msg:', message.slice(0, 60));

    const cacheKey = `sys_${language}_${data.menu?.length || 0}_${data.events?.length || 0}_${data.team?.length || 0}`;
    let systemPrompt = getCachedPrompt(cacheKey);
    if (!systemPrompt) {
        systemPrompt = buildSystemPrompt(data, language);
        setCachedPrompt(cacheKey, systemPrompt);
    }

    // ✅ History ndogo = prompt ndogo = jibu haraka
    const trimmedHistory = (history || [])
        .slice(-4)
        .filter(h => h && h.role && h.content)
        .map(h => ({ role: h.role, content: String(h.content).slice(0, 400) }));

    const messagesPayload = [
        { role: "system", content: systemPrompt },
        ...trimmedHistory,
        { role: "user", content: message }
    ];

    try {
        const stream = await groq.chat.completions.create({
            messages: messagesPayload,
            model: FAST_MODEL,               // ✅ FAST MODEL
            temperature: 0.3,
            max_completion_tokens: 1000,     // ✅ kikomo cha tokens
            top_p: 0.9,
            stream: true
        });

        // ✅ Headers kwa streaming safi
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        let firstChunkTime = null;
        let totalChars = 0;

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
                if (!firstChunkTime) {
                    firstChunkTime = Date.now() - startTime;
                    console.log('[CHAT] TTFT:', firstChunkTime, 'ms');
                }
                totalChars += content.length;
                res.write(content);
            }
        }
        res.end();

        console.log('[CHAT] Done. chars:', totalChars, '| total:', Date.now() - startTime, 'ms');

    } catch (error) {
        console.error("GROQ ERROR:", error.message || error);
        if (!res.headersSent) {
            return res.status(500).json({ error: "AI error", details: error.message });
        }
        res.write("\nError occurred.");
        res.end();
    }
});

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), model: FAST_MODEL }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Keep-alive log (Render free tier)
setInterval(() => {
    console.log('[KEEPALIVE]', new Date().toISOString());
}, 10 * 60 * 1000);

app.listen(PORT, () => {
    console.log(`Cafeteria Assistant running on port ${PORT}`);
    console.log(`Using model: ${FAST_MODEL}`);
});
