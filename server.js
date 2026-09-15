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

// ================================================
// ✅ CORS
// ================================================
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ================================================
// EXCHANGE RATES — Update mara kwa mara
// 1 USD = ... TZS (kutoka Wise, Sept 2026)
// ================================================
const EXCHANGE_RATES = {
  USD: 1.00,
  TZS: 2641.89,   // 1 USD = 2,641.89 TZS
  KES: 129.50,
  UGX: 3700.00,
  EUR: 0.92,
  GBP: 0.79,
  ZAR: 18.50,
  NGN: 1550.00,
  INR: 83.50,
  CNY: 7.25,
  JPY: 151.00,
  AED: 3.67,
  SAR: 3.75
};

const CURRENCY_NAMES = {
  USD: 'US Dollar',
  TZS: 'Tanzanian Shilling',
  KES: 'Kenyan Shilling',
  UGX: 'Ugandan Shilling',
  EUR: 'Euro',
  GBP: 'British Pound',
  ZAR: 'South African Rand',
  NGN: 'Nigerian Naira',
  INR: 'Indian Rupee',
  CNY: 'Chinese Yuan',
  JPY: 'Japanese Yen',
  AED: 'UAE Dirham',
  SAR: 'Saudi Riyal'
};

function convertCurrency(amount, from, to) {
  if (!EXCHANGE_RATES[from] || !EXCHANGE_RATES[to]) return null;
  const usdAmount = amount / EXCHANGE_RATES[from];
  const result = usdAmount * EXCHANGE_RATES[to];
  return Math.round(result * 100) / 100;
}

// ================================================
// CAFETERIA DATA — BEI ZOTE KWA USD
// ================================================
const CAFETERIA_DATA = {
  name: "Cafeteria Management System",
  hours: "7:00 AM – 9:00 PM daily",
  location: "Main campus, near the library",
  contact: { email: "support@cafeteria.com" },
  menu: [
    { name: "Beef Pilau", priceUSD: 0.0011, category: "Food" },
    { name: "Heated Maize", priceUSD: 0.0011, category: "Food" },
    { name: "Sweet Potato", priceUSD: 0.0004, category: "Food" },
    { name: "Fishes", priceUSD: 0.0009, category: "Food" },
    { name: "Irish Smart", priceUSD: 0.0011, category: "Food" },
    { name: "Chapati Beans", priceUSD: 0.0061, category: "Food" },
    { name: "Beef", priceUSD: 0.0008, category: "Food" },
    { name: "Boiled Maize", priceUSD: 0.0034, category: "Food" },
    { name: "Chicken Meat", priceUSD: 0.0068, category: "Food" },
    { name: "Samosa (3pcs)", priceUSD: 0.0053, category: "Snacks" },
    { name: "Donna Josia (Boiled Cassava)", priceUSD: 0.0019, category: "Breakfast" },
    { name: "Apple", priceUSD: 0.0076, category: "Snacks" }
  ],
  paymentMethods: ["Cash", "M-Pesa", "Tigo Pesa", "Airtel Money", "Bank Transfer", "Credit Card", "Debit Card"],
  dietaryOptions: ["Halal", "Vegetarian", "Vegan", "Gluten-Free", "Dairy-Free", "Nut-Free"],
  upcomingEvents: [
    { name: "CHRISTMAS DAY", date: "2026-12-25", description: "All customers welcome at Mlimani City" }
  ]
};

// Build menu text with USD prices
const menuTextUSD = CAFETERIA_DATA.menu
  .map(p => `- ${p.name} (${p.category}): «$${p.priceUSD.toFixed(4)}»`)
  .join('\n');

// Build menu text with TZS prices (for reference)
const menuTextTZS = CAFETERIA_DATA.menu
  .map(p => `- ${p.name}: «TZS ${(p.priceUSD * EXCHANGE_RATES.TZS).toFixed(2)}»`)
  .join('\n');

// ================================================
// SYSTEM PROMPT
// ================================================
const SYSTEM_PROMPT = `
You are "Cafeteria Assistant" — the friendly AI helper for our cafeteria.

═══════════════════════════════════════════
LANGUAGE RULE — CRITICAL
═══════════════════════════════════════════
- ALWAYS reply in the SAME language the user used.
- Supported: English, Swahili, French, Spanish, Arabic, Hindi, Chinese, etc.
- If mixed → use the dominant language.

═══════════════════════════════════════════
CURRENCY RULES — VERY IMPORTANT
═══════════════════════════════════════════
1. USD is the BASE currency for all prices.
2. Menu prices are shown in USD first, then local currency.
3. When user asks for conversion, use the EXACT rates below.
4. NEVER invent exchange rates.

Current Exchange Rates (1 USD =):
TZS: ${EXCHANGE_RATES.TZS}
KES: ${EXCHANGE_RATES.KES}
UGX: ${EXCHANGE_RATES.UGX}
EUR: ${EXCHANGE_RATES.EUR}
GBP: ${EXCHANGE_RATES.GBP}
ZAR: ${EXCHANGE_RATES.ZAR}
NGN: ${EXCHANGE_RATES.NGN}
INR: ${EXCHANGE_RATES.INR}
CNY: ${EXCHANGE_RATES.CNY}
JPY: ${EXCHANGE_RATES.JPY}
AED: ${EXCHANGE_RATES.AED}
SAR: ${EXCHANGE_RATES.SAR}

═══════════════════════════════════════════
FORMATTING RULES — VERY IMPORTANT
═══════════════════════════════════════════
❌ DO NOT USE: **bold**, *italic*, #headers, #hashtags, _underscores_
✅ USE INSTEAD:
- Numbers: 1. 2. 3.
- Roman: i. ii. iii. OR I. II. III.
- Letters: a) b) c)
- Bullets: • (for lists only)
- Emojis: 🍽️ 📋 💳 📅 ✅ 🥗 💱 🌍

✅ HIGHLIGHT KEY VALUES with « »:
- «$0.0011» for USD prices
- «TZS 2.80» for local prices
- «Halal», «Beef Pilau», «Customer Portal», etc.

═══════════════════════════════════════════
MENU (USD Base + TZS)
═══════════════════════════════════════════
${menuTextUSD}

TZS Equivalent:
${menuTextTZS}

═══════════════════════════════════════════
OTHER INFO
═══════════════════════════════════════════
Hours: ${CAFETERIA_DATA.hours}
Location: ${CAFETERIA_DATA.location}
Email: ${CAFETERIA_DATA.contact.email}
Payment: ${CAFETERIA_DATA.paymentMethods.join(', ')}
Dietary: ${CAFETERIA_DATA.dietaryOptions.join(', ')}
Events: ${CAFETERIA_DATA.upcomingEvents.map(e => `${e.name} (${e.date})`).join(', ')}

═══════════════════════════════════════════
HOW TO RESPOND
═══════════════════════════════════════════
1. Detect language → reply in that language.
2. USD is main currency, show TZS too.
3. If user asks for conversion, use EXACT rates above.
4. Keep responses SHORT (3-6 lines).
5. Use numbers, bullets, letters — NOT ** or #.
6. Highlight key values with « ».
7. NEVER invent prices or rates.
`.trim();

// ================================================
// HEALTH CHECK
// ================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'cafeteria-assistant' });
});

// ================================================
// CHAT ENDPOINT
// ================================================
app.post('/api/chat', async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: "Please provide a message." });

  const messagesPayload = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(-6),
    { role: "user", content: message }
  ];

  try {
    const stream = await groq.chat.completions.create({
      messages: messagesPayload,
      model: "openai/gpt-oss-120b",
      temperature: 0.4,
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
      return res.status(500).json({ error: "Failed to communicate with AI", details: error.message });
    }
    res.write("\n[An error occurred]");
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Cafeteria Assistant running at http://localhost:${PORT}`);
});
