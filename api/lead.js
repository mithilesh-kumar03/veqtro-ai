// ==============================================================================
// VEQTRO AI — PRODUCTION INGESTION & LEAD STORAGE ENDPOINT
// ==============================================================================
// Serverless Edge / Node.js Endpoint deployed on Vercel
// Routes: POST /api/lead, GET /api/lead (Health check)

function escapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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
    const isTelegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
    const isSheetsConfigured = Boolean(process.env.SHEETDB_URL || process.env.GOOGLE_SHEETS_WEBHOOK_URL || true);
    return res.status(200).json({
      status: 'online',
      service: 'VEQTRO Autonomous Revenue Intake Bridge',
      version: '2.4.3',
      telegram_configured: isTelegramConfigured,
      sheets_configured: isSheetsConfigured,
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

    // Validation
    if (type === 'speed_test') {
      const rawPhone = String(payload.phone || '').trim();
      const digits = rawPhone.replace(/\D/g, '');
      if (!digits || digits.length < 8 || digits.length > 15) {
        return res.status(400).json({
          ok: false,
          error: 'A valid business contact number with country code (8 to 15 digits) is required.',
          latency_ms: Date.now() - startTime
        });
      }
    } else if (type === 'audit_request') {
      const company = String(payload.company || '').trim();
      const email = String(payload.email || '').trim();
      const phone = String(payload.phone || '').trim();
      if (!company || (!email && !phone)) {
        return res.status(400).json({
          ok: false,
          error: 'Company name and at least one contact method (email or phone) are required.',
          latency_ms: Date.now() - startTime
        });
      }
    }

    // Safe structured logging for Vercel Runtime Logs (preserves lead in serverless logs)
    try {
      const logRecord = {
        event: 'VEQTRO_INBOUND_INTAKE',
        type,
        timestamp: nowIST,
        company: payload.company ? String(payload.company).slice(0, 100) : null,
        url: payload.url ? String(payload.url).slice(0, 150) : null,
        email: payload.email ? String(payload.email).slice(0, 100) : null,
        phone: payload.phone ? String(payload.phone).slice(0, 30) : null,
        budget: payload.budget ? String(payload.budget).slice(0, 50) : null,
        package: payload.package ? String(payload.package).slice(0, 50) : null,
        page: payload.page ? String(payload.page).slice(0, 150) : null
      };
      console.log(JSON.stringify(logRecord));
    } catch (_) {
      // Non-blocking
    }

    // -------------------------------------------------------------------------
    // 1. Google Sheets Persistent Lead Storage (SheetDB / Webhook)
    // -------------------------------------------------------------------------
    const sheetsWebhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL || 'https://sheetdb.io/api/v1/q4wba2cyyt3wr';
    let sheetsSaved = false;

    if (sheetsWebhookUrl) {
      try {
        const rawPhone = String(payload.phone || '').trim();
        const formattedPhone = rawPhone.startsWith('+') ? `'${rawPhone}` : rawPhone;
        const defaultCompany = type === 'speed_test' ? 'Speed Test Benchmark' : 'Website Lead';

        let sheetBody;
        if (sheetsWebhookUrl.includes('sheetdb.io')) {
          sheetBody = JSON.stringify({
            data: [
              {
                "Timestamp": nowIST,
                "Company": payload.company || defaultCompany,
                "Email": payload.email || '',
                "Phone Number": formattedPhone,
                "Ad Budget": payload.budget ? (payload.package ? `${payload.budget} [${payload.package}]` : payload.budget) : (payload.package || 'Not specified')
              }
            ]
          });
        } else {
          sheetBody = JSON.stringify({
            timestamp: nowIST,
            type,
            company: payload.company || defaultCompany,
            email: payload.email || '',
            phone: rawPhone,
            website: payload.url || '',
            budget: payload.budget || '',
            package: payload.package || '',
            page: payload.page || 'https://veqtro.vercel.app'
          });
        }

        const sheetRes = await fetch(sheetsWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          redirect: 'follow',
          body: sheetBody
        });

        if (sheetRes.ok) {
          sheetsSaved = true;
        } else {
          console.warn('[VEQTRO API] Google Sheets responded with status:', sheetRes.status);
        }
      } catch (err) {
        console.warn('[VEQTRO API] Google Sheets write network error:', err.message);
      }

      // If persistent storage is configured but write failed, return error response
      if (!sheetsSaved) {
        return res.status(502).json({
          ok: false,
          error: 'Lead storage temporarily unavailable. Please retry or email growth.veqtro@gmail.com directly.',
          latency_ms: Date.now() - startTime
        });
      }
    } else {
      console.warn('[VEQTRO API] GOOGLE_SHEETS_WEBHOOK_URL is not configured in environment variables.');
    }

    // -------------------------------------------------------------------------
    // 2. Telegram Bot Mobile Alert
    // -------------------------------------------------------------------------
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    let telegramDelivered = false;

    if (botToken && chatId) {
      let telegramText = '';

      if (type === 'speed_test') {
        const phone = escapeHtml(String(payload.phone || 'Not provided').slice(0, 30));
        const originPage = escapeHtml(String(payload.page || 'https://veqtro.vercel.app').slice(0, 150));
        telegramText = [
          `⚡ <b>VEQTRO INTAKE BENCHMARK TRIGGERED</b>`,
          `━━━━━━━━━━━━━━━━━━━━━━━━`,
          `📱 <b>Phone:</b> <code>${phone}</code>`,
          `🕒 <b>Time:</b> ${nowIST} IST`,
          `🌐 <b>Origin:</b> ${originPage}`,
          `━━━━━━━━━━━━━━━━━━━━━━━━`,
          `🎯 <i>Action: Ingestion benchmark recorded. Qualified for manual review.</i>`
        ].join('\n');
      } else if (type === 'audit_request') {
        const company = escapeHtml(String(payload.company || 'Not provided').slice(0, 100));
        const siteUrl = escapeHtml(String(payload.url || 'Not provided').slice(0, 150));
        const email = escapeHtml(String(payload.email || 'Not provided').slice(0, 100));
        const phone = escapeHtml(String(payload.phone || 'Not provided').slice(0, 30));
        const budget = escapeHtml(String(payload.budget || 'Not specified').slice(0, 50));
        const pkg = escapeHtml(String(payload.package || 'General Forensic Audit').slice(0, 50));
        telegramText = [
          `📑 <b>NEW EXECUTIVE INTAKE: ${pkg.toUpperCase()}</b>`,
          `━━━━━━━━━━━━━━━━━━━━━━━━`,
          `📦 <b>Target Package:</b> <code>${pkg}</code>`,
          `🏢 <b>Company:</b> <b>${company}</b>`,
          `📱 <b>Phone/WhatsApp:</b> <code>${phone}</code>`,
          `🌐 <b>Website:</b> ${siteUrl}`,
          `✉️ <b>Work Email:</b> <code>${email}</code>`,
          `💰 <b>Ad Spend:</b> ${budget}`,
          `🕒 <b>Time:</b> ${nowIST} IST`,
          `━━━━━━━━━━━━━━━━━━━━━━━━`,
          `🚀 <i>Action: Review audit request and dispatch calendar invitation within 2 business hours!</i>`
        ].join('\n');
      } else {
        telegramText = [
          `🔔 <b>VEQTRO GENERAL INGESTION ALERT</b>`,
          `━━━━━━━━━━━━━━━━━━━━━━━━`,
          `<b>Event:</b> ${escapeHtml(type)}`,
          `<b>Details:</b> <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`,
          `🕒 <b>Time:</b> ${nowIST} IST`
        ].join('\n');
      }

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
          console.warn('[VEQTRO API] Telegram dispatch API error:', teleData.description || teleRes.statusText);
        }
      } catch (err) {
        console.warn('[VEQTRO API] Telegram network dispatch failed:', err.message);
      }
    } else {
      console.warn('[VEQTRO API] Telegram credentials not configured in server environment variables.');
    }

    const latencyMs = Date.now() - startTime;

    // Lead is confirmed: storage succeeded (or was unconfigured during dev), regardless of Telegram status
    return res.status(200).json({
      ok: true,
      type,
      latency_ms: latencyMs,
      lead_stored: Boolean(sheetsSaved || !sheetsWebhookUrl),
      telegram_dispatched: telegramDelivered,
      status: 'received',
      message: 'Intake payload securely received.',
      timestamp: nowIST
    });
  } catch (error) {
    console.error('[VEQTRO API] Unhandled server error in lead ingestion:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'Internal server error processing intake payload.',
      latency_ms: Date.now() - startTime
    });
  }
}
