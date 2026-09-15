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

// Initialize Groq SDK
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(express.json());
app.use(express.static(__dirname));

// ================================================
// CAFETERIA DATA — Weka data yako hapa
// ================================================
const CAFETERIA_DATA = {
  name: "Cafeteria Management System",
  hours: "7:00 AM – 9:00 PM daily",
  location: "Main campus, near the library",
  contact: {
    phone: "Available in Staff Portal",
    email: "support@cafeteria.com"
  },
  menu: [
    { name: "Beef Pilau", price: 2.80, category: "Food", available: true },
    { name: "Heated maize", price: 2.90, category: "Food", available: true },
    { name: "Sweet potato", price: 1.00, category: "Food", available: true },
    { name: "Fishes", price: 2.50, category: "Food", available: true },
    { name: "Irish smart", price: 3.00, category: "Food", available: true },
    { name: "Chapati Beans", price: 16.00, category: "Food", available: true },
    { name: "Beef", price: 2.00, category: "Food", available: true },
    { name: "Boiled Maize", price: 9.00, category: "Food", available: true },
    { name: "Chicken meat", price: 18.00, category: "Food", available: true },
    { name: "Samosa (3pcs)", price: 14.00, category: "Snacks", available: true },
    { name: "Donna Josia (Boiled cassava)", price: 5.00, category: "Breakfast", available: true },
    { name: "Apple", price: 20.00, category: "Snacks", available: true }
  ],
  paymentMethods: [
    "Cash", "M-Pesa", "Tigo Pesa", "Airtel Money",
    "Bank Transfer", "Credit Card", "Debit Card"
  ],
  dietaryOptions: [
    "Halal", "Vegetarian", "Vegan", "Gluten-Free",
    "Dairy-Free", "Nut-Free"
  ],
  upcomingEvents: [
    { name: "CHRISTMAS DAY", date: "2026-12-25", description: "All customers welcome at Mlimani City" }
  ]
};

// ================================================
// BUILD SYSTEM PROMPT
// ================================================
const menuText = CAFETERIA_DATA.menu
  .filter(p => p.available)
  .map(p => `- ${p.name} (${p.category}): TZS ${p.price.toFixed(2)}`)
  .join('\n');

const SYSTEM_PROMPT = `
You are "Cafeteria Assistant" — the friendly AI helper for our cafeteria management system.

═══════════════════════════════════════════
YOUR ROLE
═══════════════════════════════════════════
You help customers with:
1. Menu questions and prices
2. Order tracking
3. Dietary information (halal, vegetarian, vegan, gluten-free)
4. Pre-orders and reservations
5. Special requests and feedback
6. General cafeteria information

═══════════════════════════════════════════
LANGUAGE RULE — VERY IMPORTANT
═══════════════════════════════════════════
- Detect the language the user writes in.
- If they write in ENGLISH → respond in ENGLISH.
- If they write in SWAHILI → respond in SWAHILI.
- If they mix → respond in the dominant language.
- Be natural and friendly in both languages.

═══════════════════════════════════════════
CAFETERIA INFORMATION
═══════════════════════════════════════════
Name: ${CAFETERIA_DATA.name}
Hours: ${CAFETERIA_DATA.hours}
Location: ${CAFETERIA_DATA.location}
Contact: ${CAFETERIA_DATA.contact.email}

═══════════════════════════════════════════
TODAY'S MENU (available items)
═══════════════════════════════════════════
${menuText}

═══════════════════════════════════════════
PAYMENT METHODS
═══════════════════════════════════════════
${CAFETERIA_DATA.paymentMethods.join(', ')}

═══════════════════════════════════════════
DIETARY OPTIONS
═══════════════════════════════════════════
${CAFETERIA_DATA.dietaryOptions.join(', ')}

═══════════════════════════════════════════
UPCOMING EVENTS
═══════════════════════════════════════════
${CAFETERIA_DATA.upcomingEvents.map(e => `- ${e.name} on ${e.date}: ${e.description}`).join('\n')}

═══════════════════════════════════════════
HOW TO RESPOND
═══════════════════════════════════════════
- Be warm, friendly, and helpful.
- Use emojis occasionally (🍽️ 📋 💳 📅 ✅).
- Format answers clearly with bullet points or short paragraphs.
- For order tracking: tell them to log in to Customer Portal.
- For pre-orders: explain the 4-step process.
- For special requests: mention the Feedback section.
- If asked something you don't know, politely say so and offer alternatives.
- Keep responses SHORT and clear — no long essays.
- NEVER invent menu items or prices. Use only the menu above.

═══════════════════════════════════════════
EXAMPLES
═══════════════════════════════════════════
User: "Show me the menu"
You: List the top menu items with prices.

User: "Nina bei ngapi ya Pilau?"
You: "Bei ya Beef Pilau ni TZS 2.80. 🍽️ Inapatikana kwa sasa."

User: "Where is my order?"
You: Direct them to Customer Portal for order tracking.

User: "Do you have halal food?"
You: Yes, and mention halal options.

User: "Habari"
You: Greet warmly in Swahili.
`.trim();

// ================================================
// CHAT ENDPOINT
// ================================================
app.post('/api/chat', async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Please provide a message." });
  }

  const messagesPayload = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(-6),
    { role: "user", content: message }
  ];

  try {
    const stream = await groq.chat.completions.create({
      messages: messagesPayload,
      model: "openai/gpt-oss-120b",
      temperature: 0.6,
      max_completion_tokens: 800,
      stream: true
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        res.write(content);
      }
    }
    res.end();

  } catch (error) {
    console.error("--- GROQ API ERROR ---");
    console.error(error.message || error);

    if (!res.headersSent) {
      return res.status(500).json({
        error: "Failed to communicate with AI",
        details: error.message
      });
    }
    res.write("\n[An error occurred]");
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Cafeteria Assistant running at http://localhost:${PORT}`);
});
