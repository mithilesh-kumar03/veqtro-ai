// ==============================================================================
// VEQTRO AI — PRODUCTION INGESTION & TELEGRAM DISPATCH ENDPOINT
// ==============================================================================
// Serverless Edge / Node.js Endpoint deployed on Vercel
// Routes: POST /api/lead, GET /api/lead (Health check)

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Health check endpoint
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      service: 'VEQTRO Autonomous Revenue Intake Bridge',
      version: '2.4.0',
      bot: '@Veqtro_Client_Bot',
      telegram_configured: true,
      timestamp: new Date().toISOString()
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const startTime = Date.now();

  try {
    let payload = req.body;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (_) {
        payload = { raw: payload };
      }
    }
    payload = payload || {};

    const type = payload.type || 'speed_test';
    const nowIST = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'medium'
    });

    let telegramText = '';

    if (type === 'speed_test') {
      const phone = payload.phone || 'Not provided';
      const originPage = payload.page || 'https://veqtro.vercel.app';
      telegramText = [
        `⚡ <b>VEQTRO LIVE SPEED TEST TRIGGERED</b>`,
        `━━━━━━━━━━━━━━━━━━━━━━━━`,
        `📱 <b>Phone:</b> <code>${phone}</code>`,
        `🕒 <b>Time:</b> ${nowIST} IST`,
        `🌐 <b>Origin:</b> ${originPage}`,
        `━━━━━━━━━━━━━━━━━━━━━━━━`,
        `🎯 <i>Action: Send instant WhatsApp revenue-leak audit message within 8s!</i>`
      ].join('\n');
    } else if (type === 'audit_request') {
      const company = payload.company || 'Not provided';
      const siteUrl = payload.url || 'Not provided';
      const email = payload.email || 'Not provided';
      const budget = payload.budget || 'Not specified';
      telegramText = [
        `📑 <b>NEW EXECUTIVE FORENSIC AUDIT REQUEST</b>`,
        `━━━━━━━━━━━━━━━━━━━━━━━━`,
        `🏢 <b>Company:</b> <b>${company}</b>`,
        `🌐 <b>Website:</b> ${siteUrl}`,
        `✉️ <b>Work Email:</b> <code>${email}</code>`,
        `💰 <b>Ad Spend:</b> ${budget}`,
        `🕒 <b>Time:</b> ${nowIST} IST`,
        `━━━━━━━━━━━━━━━━━━━━━━━━`,
        `🚀 <i>Action: Compile 3-page A4 Obsidian Dossier and dispatch to prospect!</i>`
      ].join('\n');
    } else {
      telegramText = [
        `🔔 <b>VEQTRO GENERAL INGESTION ALERT</b>`,
        `━━━━━━━━━━━━━━━━━━━━━━━━`,
        `<b>Event:</b> ${type}`,
        `<b>Details:</b> <pre>${JSON.stringify(payload, null, 2)}</pre>`,
        `🕒 <b>Time:</b> ${nowIST} IST`
      ].join('\n');
    }

    // Telegram Bot Dispatch
    const botToken = process.env.TELEGRAM_BOT_TOKEN || '9245152540:AAFHNfVVBwlXeH5diUJVWetFCykzsf_wIIc';
    const chatId = process.env.TELEGRAM_CHAT_ID || '1815943955';
    let telegramDelivered = false;
    let telegramError = null;

    if (botToken && chatId) {
      try {
        const teleUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const teleRes = await fetch(teleUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: telegramText,
            parse_mode: 'HTML',
            disable_web_page_preview: true
          })
        });

        const teleData = await teleRes.json();
        if (teleRes.ok && teleData.ok) {
          telegramDelivered = true;
        } else {
          telegramError = teleData.description || 'Telegram API returned error';
        }
      } catch (err) {
        telegramError = err.message;
      }
    } else {
      telegramError = 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured in Vercel environment variables';
    }

    const latencyMs = Date.now() - startTime;

    return res.status(200).json({
      ok: true,
      type,
      latency_ms: latencyMs,
      telegram_dispatched: telegramDelivered,
      note: telegramDelivered ? 'Instant Telegram alert dispatched' : telegramError,
      timestamp: nowIST
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Internal server error',
      latency_ms: Date.now() - startTime
    });
  }
}
