const DAILY_LIMIT = 50;
const DEMO_IP_LIMIT = 50; // Max 50 Demo-Generierungen pro IP pro Tag
const ADMIN_KEY = "Zyn#Bwh4zUtTbq5bxtb9!2024";
const RESEND_API_KEY = "re_8mjBwLuV_Am8uVR5REkd8t6n5gdouEqn7";
const FROM_EMAIL = "jan@zyntevo.de";

const PRODUCT_MAP = {
  "697893": "makler-premium",
  "696900": "handwerker-premium",
  "696579": "makler-starter",
  "696887": "handwerker-starter",
  "698384": "steuerberater-premium",
  "698395": "steuerberater-starter",
  // Enterprise – Digistore IDs eintragen sobald Produkte erstellt:
  // "XXXXX": "makler-enterprise",
  // "XXXXX": "handwerker-enterprise",
  // "XXXXX": "steuerberater-enterprise",
};

const PRODUCT_LABELS = {
  "makler-premium": "Makler Premium",
  "makler-starter": "Makler Starter",
  "handwerker-premium": "Handwerker Premium",
  "handwerker-starter": "Handwerker Starter",
  "steuerberater-premium": "Steuerberater Premium",
  "steuerberater-starter": "Steuerberater Starter",
};

const TOOL_URLS = {
  "makler-premium": "https://zyntevo.github.io/zyntevo/zyntevo-makler-tool.html",
  "makler-starter": "https://zyntevo.github.io/zyntevo/zyntevo-makler-tool.html",
  "handwerker-premium": "https://zyntevo.github.io/zyntevo/zyntevo-handwerker-tool.html",
  "handwerker-starter": "https://zyntevo.github.io/zyntevo/zyntevo-handwerker-tool.html",
  "steuerberater-premium": "https://zyntevo.github.io/zyntevo/zyntevo-steuerberater-tool.html",
  "steuerberater-starter": "https://zyntevo.github.io/zyntevo/zyntevo-steuerberater-tool.html",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {

      // === DIGISTORE WEBHOOK ===
      if (url.pathname === "/api/webhook/digistore" && request.method === "POST") {
        const contentType = request.headers.get("Content-Type") || "";
        let body;
        if (contentType.includes("application/json")) {
          body = await request.json();
        } else {
          const text = await request.text();
          const params = new URLSearchParams(text);
          body = Object.fromEntries(params.entries());
        }
        const event = body.event || body.order_event || "";
        if (event !== "order_completed" && event !== "on_payment_received" && event !== "order") {
          return new Response("OK", { status: 200 });
        }
        const productId = String(body.product_id || body.order_product_id || "");
        const buyerEmail = body.customer_email || body.buyer_email || body.email || "";
        const buyerName = body.customer_name || body.buyer_firstname || "Kunde";
        if (!buyerEmail || !productId) return new Response("Missing data", { status: 400 });
        const product = PRODUCT_MAP[productId];
        if (!product) return new Response("Unknown product", { status: 200 });
        if (product.includes("premium")) {
          const code = generateCode();
          const days = 30;
          const expiresAt = Date.now() + (days * 24 * 60 * 60 * 1000);
          await env.ZYNTEVO_DB.put(`code:${code}`, JSON.stringify({ product, created: Date.now(), expiresAt }), { expirationTtl: days * 24 * 60 * 60 });
          await sendWelcomeEmail(buyerEmail, buyerName, code, product);
        } else {
          await sendWelcomeEmail(buyerEmail, buyerName, null, product);
        }
        return new Response("OK", { status: 200 });
      }

      // === CODE FÜR KÄUFER GENERIEREN ===
      if (url.pathname === "/api/generate-code-for-buyer" && request.method === "POST") {
        const { email, product } = await request.json();
        if (!email || !product) return json({ error: "Fehlende Daten" }, 400, corsHeaders);
        const existingKey = `pending:${email}:${product}`;
        const existing = await env.ZYNTEVO_DB.get(existingKey);
        if (existing) return json({ success: true, code: existing }, 200, corsHeaders);
        const code = generateCode();
        const days = 30;
        const expiresAt = Date.now() + (days * 24 * 60 * 60 * 1000);
        await env.ZYNTEVO_DB.put(`code:${code}`, JSON.stringify({ product, created: Date.now(), expiresAt }), { expirationTtl: days * 24 * 60 * 60 });
        await env.ZYNTEVO_DB.put(existingKey, code, { expirationTtl: days * 24 * 60 * 60 });
        return json({ success: true, code }, 200, corsHeaders);
      }

      // === REGISTER ===
      if (url.pathname === "/api/register" && request.method === "POST") {
        const { code, email, password } = await request.json();
        const codeData = await env.ZYNTEVO_DB.get(`code:${code}`);
        if (!codeData) return json({ error: "Ungültiger oder bereits verwendeter Code" }, 400, corsHeaders);
        const codeObj = JSON.parse(codeData);
        if (codeObj.expiresAt && Date.now() > codeObj.expiresAt) {
          await env.ZYNTEVO_DB.delete(`code:${code}`);
          return json({ error: "Registrierungscode ist abgelaufen" }, 400, corsHeaders);
        }
        const { product } = codeObj;
        const existing = await env.ZYNTEVO_DB.get(`user:${email}`);
        if (existing) return json({ error: "E-Mail bereits registriert" }, 400, corsHeaders);
        const hash = await hashPassword(password);
        await env.ZYNTEVO_DB.put(`user:${email}`, JSON.stringify({ email, hash, product, blocked: false, created: Date.now(), totalRequests: 0 }));
        await env.ZYNTEVO_DB.delete(`code:${code}`);
        const indexRaw = await env.ZYNTEVO_DB.get("index:users");
        const index = indexRaw ? JSON.parse(indexRaw) : [];
        if (!index.includes(email)) index.push(email);
        await env.ZYNTEVO_DB.put("index:users", JSON.stringify(index));
        return json({ success: true, message: "Account erstellt!" }, 200, corsHeaders);
      }

      // === LOGIN ===
      if (url.pathname === "/api/login" && request.method === "POST") {
        const { email, password } = await request.json();
        const userData = await env.ZYNTEVO_DB.get(`user:${email}`);
        if (!userData) return json({ error: "Ungültige Zugangsdaten" }, 401, corsHeaders);
        const user = JSON.parse(userData);
        if (user.blocked) return json({ error: "Account gesperrt" }, 403, corsHeaders);
        const valid = await verifyPassword(password, user.hash);
        if (!valid) return json({ error: "Ungültige Zugangsdaten" }, 401, corsHeaders);
        const token = await createToken(email, user.product, env.JWT_SECRET);
        return json({ success: true, token, product: user.product }, 200, corsHeaders);
      }

      // === ADMIN: Trial-User sperren/entsperren ===
      if (url.pathname === "/api/admin/trial/block" && request.method === "POST") {
        const { adminKey, email, blocked } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        const raw = await env.ZYNTEVO_DB.get(`trial:${email}`);
        if (!raw) return json({ error: "Trial-User nicht gefunden" }, 404, corsHeaders);
        const trial = JSON.parse(raw);
        trial.blocked = blocked;
        await env.ZYNTEVO_DB.put(`trial:${email}`, JSON.stringify(trial));
        return json({ success: true, message: `Trial ${blocked ? 'gesperrt' : 'entsperrt'}` }, 200, corsHeaders);
      }

      // === ADMIN: Trial-User löschen ===
      if (url.pathname === "/api/admin/trial/delete" && request.method === "POST") {
        const { adminKey, email } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        await env.ZYNTEVO_DB.delete(`trial:${email}`);
        await env.ZYNTEVO_DB.delete(`trial-total:${email}`);
        const indexRaw = await env.ZYNTEVO_DB.get("index:trials");
        const index = indexRaw ? JSON.parse(indexRaw) : [];
        await env.ZYNTEVO_DB.put("index:trials", JSON.stringify(index.filter(e => e !== email)));
        return json({ success: true, message: `Trial ${email} gelöscht` }, 200, corsHeaders);
      }

      // === ADMIN: Trial-Liste mit vollständigen Stats ===
      if (url.pathname === "/api/admin/trial/list" && request.method === "POST") {
        const { adminKey } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        const indexRaw = await env.ZYNTEVO_DB.get("index:trials");
        const index = indexRaw ? JSON.parse(indexRaw) : [];
        const today = new Date().toISOString().split("T")[0];
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        const trials = await Promise.all(index.map(async (email) => {
          const raw = await env.ZYNTEVO_DB.get(`trial:${email}`);
          if (!raw) return null;
          const t = JSON.parse(raw);
          const elapsed = Date.now() - t.startDate;
          const daysUsed = Math.min(7, Math.floor(elapsed / (24 * 60 * 60 * 1000)));
          const daysLeft = Math.max(0, Math.ceil((sevenDays - elapsed) / (24 * 60 * 60 * 1000)));
          const totalRaw = await env.ZYNTEVO_DB.get(`trial-total:${email}`);
          const todayRaw = await env.ZYNTEVO_DB.get(`rate-trial:${email}:${today}`);
          return {
            email: t.email,
            branche: t.branche,
            startDate: t.startDate,
            daysUsed,
            daysLeft,
            blocked: t.blocked || false,
            totalRequests: totalRaw ? parseInt(totalRaw) : 0,
            todayRequests: todayRaw ? parseInt(todayRaw) : 0,
          };
        }));
        return json({ success: true, trials: trials.filter(Boolean) }, 200, corsHeaders);
      }

      // === TRIAL CONVERSION MAILS (täglich von n8n aufgerufen) ===
      if (url.pathname === "/api/trial/send-conversions" && request.method === "POST") {
        const { adminKey } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        const indexRaw = await env.ZYNTEVO_DB.get("index:trials");
        const index = indexRaw ? JSON.parse(indexRaw) : [];
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        let sent = 0, skipped = 0;
        await Promise.all(index.map(async (email) => {
          const raw = await env.ZYNTEVO_DB.get(`trial:${email}`);
          if (!raw) return;
          const trial = JSON.parse(raw);
          if (trial.conversionEmailSent) { skipped++; return; }
          const elapsed = Date.now() - trial.startDate;
          if (elapsed < sevenDays) { skipped++; return; }
          // Trial abgelaufen, noch keine Mail → senden
          try {
            await sendTrialConversionEmail(trial.email, trial.branche);
            trial.conversionEmailSent = true;
            await env.ZYNTEVO_DB.put(`trial:${email}`, JSON.stringify(trial));
            sent++;
          } catch(e) { /* silent */ }
        }));
        return json({ success: true, sent, skipped }, 200, corsHeaders);
      }

      // === TRIAL START ===
      if (url.pathname === "/api/trial/start" && request.method === "POST") {
        const { email, branche } = await request.json();
        if (!email || !email.includes("@")) return json({ error: "Ungültige E-Mail" }, 400, corsHeaders);
        const key = `trial:${email}`;
        const existing = await env.ZYNTEVO_DB.get(key);
        if (!existing) {
          await env.ZYNTEVO_DB.put(key, JSON.stringify({ email, branche, startDate: Date.now() }));
          const indexRaw = await env.ZYNTEVO_DB.get("index:trials");
          const index = indexRaw ? JSON.parse(indexRaw) : [];
          if (!index.includes(email)) { index.push(email); await env.ZYNTEVO_DB.put("index:trials", JSON.stringify(index)); }
        }
        return json({ success: true }, 200, corsHeaders);
      }

      // === TRIAL CHECK ===
      if (url.pathname === "/api/trial/check" && request.method === "POST") {
        const { email } = await request.json();
        if (!email) return json({ error: "Keine E-Mail" }, 400, corsHeaders);
        const raw = await env.ZYNTEVO_DB.get(`trial:${email}`);
        if (!raw) return json({ active: false, daysLeft: 0 }, 200, corsHeaders);
        const trial = JSON.parse(raw);
        const elapsed = Date.now() - trial.startDate;
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        const daysLeft = Math.max(0, Math.ceil((sevenDays - elapsed) / (24 * 60 * 60 * 1000)));
        return json({ active: daysLeft > 0, daysLeft }, 200, corsHeaders);
      }

      // === TRIAL LIST (Admin, für n8n) ===
      if (url.pathname === "/api/trial/list" && request.method === "GET") {
        const adminKey = request.headers.get("Authorization");
        if (adminKey !== `Bearer ${ADMIN_KEY}`) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        const indexRaw = await env.ZYNTEVO_DB.get("index:trials");
        const index = indexRaw ? JSON.parse(indexRaw) : [];
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        const trials = await Promise.all(index.map(async (email) => {
          const raw = await env.ZYNTEVO_DB.get(`trial:${email}`);
          if (!raw) return null;
          const t = JSON.parse(raw);
          const elapsed = Date.now() - t.startDate;
          const daysLeft = Math.max(0, Math.ceil((sevenDays - elapsed) / (24 * 60 * 60 * 1000)));
          return { email: t.email, branche: t.branche, startDate: t.startDate, daysLeft };
        }));
        return json(trials.filter(Boolean), 200, { ...corsHeaders, "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
      }

      // === QUERY (KI-Anfrage) ===
      if (url.pathname === "/api/query" && request.method === "POST") {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader) return json({ error: "Kein Token" }, 401, corsHeaders);

        // === TRIAL TOKEN ===
        if (authHeader.startsWith("Bearer trial:")) {
          const trialEmail = authHeader.replace("Bearer trial:", "");
          const raw = await env.ZYNTEVO_DB.get(`trial:${trialEmail}`);
          if (!raw) return json({ error: "Testversion nicht gefunden" }, 401, corsHeaders);
          const trial = JSON.parse(raw);
          if (trial.blocked) return json({ error: "Testversion gesperrt" }, 403, corsHeaders);
          const elapsed = Date.now() - trial.startDate;
          if (elapsed > 7 * 24 * 60 * 60 * 1000) return json({ error: "Testversion abgelaufen" }, 403, corsHeaders);
          const today = new Date().toISOString().split("T")[0];
          const rateKey = `rate-trial:${trialEmail}:${today}`;
          const countRaw = await env.ZYNTEVO_DB.get(rateKey);
          const count = countRaw ? parseInt(countRaw) : 0;
          if (count >= 20) return json({ error: "Tageslimit für Testversion erreicht (20 Anfragen/Tag)" }, 429, corsHeaders);
          await env.ZYNTEVO_DB.put(rateKey, String(count + 1), { expirationTtl: 86400 });
          const totalRaw = await env.ZYNTEVO_DB.get(`trial-total:${trialEmail}`);
          await env.ZYNTEVO_DB.put(`trial-total:${trialEmail}`, String((totalRaw ? parseInt(totalRaw) : 0) + 1));
          const body = await request.json();
          const langSystem = buildLangSystem(body.language);
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1000, system: langSystem, messages: [{ role: "user", content: body.prompt }] })
          });
          const data = await response.json();
          return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (authHeader === "Bearer demo-token") {
          const body = await request.json();
          if (!body.demo) return json({ error: "Nicht autorisiert" }, 401, corsHeaders);

          // === IP-LIMIT FÜR DEMO ===
          const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
          const today = new Date().toISOString().split("T")[0];
          const ipKey = `demo-ip:${ip}:${today}`;
          const ipCountRaw = await env.ZYNTEVO_DB.get(ipKey);
          const ipCount = ipCountRaw ? parseInt(ipCountRaw) : 0;
          if (ipCount >= DEMO_IP_LIMIT) {
            return json({ error: "Demo-Limit erreicht. Bitte teste das vollständige Tool." }, 429, corsHeaders);
          }
          await env.ZYNTEVO_DB.put(ipKey, String(ipCount + 1), { expirationTtl: 86400 });

          const langSystem = buildLangSystem(body.language);
          const demoResponse = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1000, system: langSystem, messages: [{ role: "user", content: body.prompt || "" }] })
          });
          const demoData = await demoResponse.json();
          return json({ success: true, content: demoData.content }, 200, corsHeaders);
        }

        const token = authHeader.replace("Bearer ", "");
        let payload;
        try { payload = await verifyToken(token, env.JWT_SECRET); } catch { return json({ error: "Ungültiger Token" }, 401, corsHeaders); }
        const { email } = payload;
        const userData = await env.ZYNTEVO_DB.get(`user:${email}`);
        if (!userData) return json({ error: "User nicht gefunden" }, 401, corsHeaders);
        const user = JSON.parse(userData);
        if (user.blocked) return json({ error: "Account gesperrt" }, 403, corsHeaders);
        const today = new Date().toISOString().split("T")[0];
        const rateKey = `rate:${email}:${today}`;
        const countRaw = await env.ZYNTEVO_DB.get(rateKey);
        const count = countRaw ? parseInt(countRaw) : 0;
        if (count >= DAILY_LIMIT) return json({ error: "Tageslimit erreicht (50 Anfragen/Tag)" }, 429, corsHeaders);
        await env.ZYNTEVO_DB.put(rateKey, String(count + 1), { expirationTtl: 86400 });
        user.totalRequests = (user.totalRequests || 0) + 1;
        user.lastActive = Date.now();
        await env.ZYNTEVO_DB.put(`user:${email}`, JSON.stringify(user));
        const body = await request.json();
        const langSystem = buildLangSystem(body.language);
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1000, system: langSystem, messages: [{ role: "user", content: body.prompt }] })
        });
        const data = await response.json();
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // === QUERY-BULK (KI-Anfrage ohne IP-Limit, nur für Admin) ===
      if (url.pathname === "/api/query-bulk" && request.method === "POST") {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || authHeader !== `Bearer ${ADMIN_KEY}`) {
          return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        }
        const body = await request.json();
        if (!body.prompt) return json({ error: "Kein Prompt" }, 400, corsHeaders);
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1000, messages: [{ role: "user", content: body.prompt }] })
        });
        const data = await response.json();
        return json({ success: true, content: data.content }, 200, corsHeaders);
      }

      // === DEMO LEAD ERFASSEN ===
      if (url.pathname === "/api/demo-lead" && request.method === "POST") {
        const { email, branche, tool, resultText } = await request.json();
        if (!email || !email.includes('@')) return json({ error: "Ungültige E-Mail" }, 400, corsHeaders);
        const key = `demo:${email}`;
        const existing = await env.ZYNTEVO_DB.get(key);
        const lead = existing ? JSON.parse(existing) : { email, branche, tool, created: Date.now(), nutzungen: 0, blocked: false };
        lead.nutzungen = (lead.nutzungen || 0) + 1;
        lead.lastUsed = Date.now();
        if (!lead.branche) lead.branche = branche;
        await env.ZYNTEVO_DB.put(key, JSON.stringify(lead));
        const indexRaw = await env.ZYNTEVO_DB.get("index:demo-leads");
        const index = indexRaw ? JSON.parse(indexRaw) : [];
        if (!index.includes(email)) index.push(email);
        await env.ZYNTEVO_DB.put("index:demo-leads", JSON.stringify(index));

        // Send result email to demo user
        try {
          await sendDemoEmail(email, branche, tool, resultText);
        } catch(e) { /* silent fail */ }

        // Notify n8n for instant lead alert
        try {
          await fetch("https://zyntevo.app.n8n.cloud/webhook/bdcb9932-a702-4601-9dad-08cb3774a890", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, branche, tool, timestamp: new Date().toISOString() })
          });
        } catch(e) { /* silent fail */ }

        return json({ success: true }, 200, corsHeaders);
      }

      // === DEMO LEAD SPERREN ===
      if (url.pathname === "/api/demo-block" && request.method === "POST") {
        const { adminKey, email, blocked } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        const key = `demo:${email}`;
        const existing = await env.ZYNTEVO_DB.get(key);
        if (!existing) return json({ error: "Lead nicht gefunden" }, 404, corsHeaders);
        const lead = JSON.parse(existing);
        lead.blocked = blocked;
        await env.ZYNTEVO_DB.put(key, JSON.stringify(lead));
        return json({ success: true, message: `Demo ${blocked ? 'gesperrt' : 'entsperrt'}` }, 200, corsHeaders);
      }

      // === DEMO ADMIN: Alle Leads abrufen ===
      if (url.pathname === "/api/demo-admin" && request.method === "POST") {
        const { adminKey } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        const indexRaw = await env.ZYNTEVO_DB.get("index:demo-leads");
        const index = indexRaw ? JSON.parse(indexRaw) : [];
        const leads = await Promise.all(index.map(async (email) => {
          const data = await env.ZYNTEVO_DB.get(`demo:${email}`);
          return data ? JSON.parse(data) : null;
        }));
        return json({ success: true, leads: leads.filter(Boolean) }, 200, corsHeaders);
      }

      // === ADMIN: Account sperren ===
      if (url.pathname === "/api/admin/block" && request.method === "POST") {
        const { adminKey, email, blocked } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        const userData = await env.ZYNTEVO_DB.get(`user:${email}`);
        if (!userData) return json({ error: "User nicht gefunden" }, 404, corsHeaders);
        const user = JSON.parse(userData);
        user.blocked = blocked;
        await env.ZYNTEVO_DB.put(`user:${email}`, JSON.stringify(user));
        return json({ success: true, message: `Account ${blocked ? 'gesperrt' : 'entsperrt'}` }, 200, corsHeaders);
      }

      // === ADMIN: Code generieren ===
      if (url.pathname === "/api/admin/generate-code" && request.method === "POST") {
        const { adminKey, product, count = 1, days = 30 } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        const codes = [];
        for (let i = 0; i < count; i++) {
          const code = generateCode();
          const expiresAt = Date.now() + (days * 24 * 60 * 60 * 1000);
          await env.ZYNTEVO_DB.put(`code:${code}`, JSON.stringify({ product, created: Date.now(), expiresAt }), { expirationTtl: days * 24 * 60 * 60 });
          codes.push(code);
        }
        return json({ success: true, codes, expiresIn: days + " Tage" }, 200, corsHeaders);
      }

      // === ADMIN: Account löschen ===
      if (url.pathname === "/api/admin/delete-user" && request.method === "POST") {
        const { adminKey, email } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        const userData = await env.ZYNTEVO_DB.get(`user:${email}`);
        if (!userData) return json({ error: "User nicht gefunden" }, 404, corsHeaders);
        await env.ZYNTEVO_DB.delete(`user:${email}`);
        const indexRaw = await env.ZYNTEVO_DB.get("index:users");
        const index = indexRaw ? JSON.parse(indexRaw) : [];
        const newIndex = index.filter(e => e !== email);
        await env.ZYNTEVO_DB.put("index:users", JSON.stringify(newIndex));
        return json({ success: true, message: `Account ${email} wurde gelöscht` }, 200, corsHeaders);
      }

      // === ADMIN: Alle User abrufen ===
      if (url.pathname === "/api/admin/users" && request.method === "POST") {
        const { adminKey } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        const indexRaw = await env.ZYNTEVO_DB.get("index:users");
        const index = indexRaw ? JSON.parse(indexRaw) : [];
        const today = new Date().toISOString().split("T")[0];
        const users = await Promise.all(index.map(async (email) => {
          const userData = await env.ZYNTEVO_DB.get(`user:${email}`);
          if (!userData) return null;
          const user = JSON.parse(userData);
          const rateKey = `rate:${email}:${today}`;
          const todayCountRaw = await env.ZYNTEVO_DB.get(rateKey);
          const todayCount = todayCountRaw ? parseInt(todayCountRaw) : 0;
          return { email: user.email, product: user.product, blocked: user.blocked, created: user.created, totalRequests: user.totalRequests || 0, todayRequests: todayCount, lastActive: user.lastActive || null };
        }));
        return json({ success: true, users: users.filter(Boolean) }, 200, corsHeaders);
      }

      // === ADMIN: IP-Rate-Limit zurücksetzen ===
      if (url.pathname === "/api/admin/reset-ip" && request.method === "POST") {
        const { adminKey, ip } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        const callerIp = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
        const targetIp = ip || callerIp;
        const today = new Date().toISOString().split("T")[0];
        const ipKey = `demo-ip:${targetIp}:${today}`;
        await env.ZYNTEVO_DB.put(ipKey, "0", { expirationTtl: 86400 });
        return json({ success: true, message: `IP-Limit zurückgesetzt`, ip: targetIp, callerIp }, 200, corsHeaders);
      }

      // === DEBUG: Eigene IP anzeigen ===
      if (url.pathname === "/api/debug/myip") {
        const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
        return json({ ip }, 200, corsHeaders);
      }

      // === ADMIN: Tagesstatistiken ===
      if (url.pathname === "/api/admin/stats" && request.method === "POST") {
        const { adminKey } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);

        const today = new Date().toISOString().split("T")[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

        // Demo Leads heute und gestern
        const indexRaw = await env.ZYNTEVO_DB.get("index:demo-leads");
        const index = indexRaw ? JSON.parse(indexRaw) : [];
        const leads = await Promise.all(index.map(async (email) => {
          const data = await env.ZYNTEVO_DB.get(`demo:${email}`);
          return data ? JSON.parse(data) : null;
        }));
        const validLeads = leads.filter(Boolean);

        const todayLeads = validLeads.filter(l => l.lastUsed && new Date(l.lastUsed).toISOString().split("T")[0] === today);
        const yesterdayLeads = validLeads.filter(l => l.lastUsed && new Date(l.lastUsed).toISOString().split("T")[0] === yesterday);

        // Leads nach Branche heute
        const byBranche = { makler: 0, handwerker: 0, steuerberater: 0 };
        todayLeads.forEach(l => { if (l.branche && byBranche[l.branche] !== undefined) byBranche[l.branche]++; });

        // Gesamtstatistiken
        const totalLeads = validLeads.length;
        const totalByBranche = { makler: 0, handwerker: 0, steuerberater: 0 };
        validLeads.forEach(l => { if (l.branche && totalByBranche[l.branche] !== undefined) totalByBranche[l.branche]++; });

        // User (Käufer)
        const userIndexRaw = await env.ZYNTEVO_DB.get("index:users");
        const userIndex = userIndexRaw ? JSON.parse(userIndexRaw) : [];
        const totalKaeufer = userIndex.length;

        // Detail-Listen für Nachfassen
        const gesternDetails = yesterdayLeads.map(l => ({
          email: l.email,
          branche: l.branche,
          nutzungen: l.nutzungen || 1
        }));
        const heuteDetails = todayLeads.map(l => ({
          email: l.email,
          branche: l.branche,
          nutzungen: l.nutzungen || 1
        }));

        return json({
          success: true,
          datum: today,
          heute: {
            demoNutzer: todayLeads.length,
            nachBranche: byBranche,
            details: heuteDetails,
          },
          gestern: {
            demoNutzer: yesterdayLeads.length,
            details: gesternDetails,
          },
          gesamt: {
            demoLeads: totalLeads,
            kaeufer: totalKaeufer,
            nachBranche: totalByBranche,
          }
        }, 200, corsHeaders);
      }


      // === LEADS SPEICHERN (von n8n Apify Workflow) ===
      if (url.pathname === "/api/leads/save" && request.method === "POST") {
        const { adminKey, leads } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        if (!leads || !Array.isArray(leads)) return json({ error: "Keine Leads" }, 400, corsHeaders);

        const today = new Date().toISOString().split("T")[0];
        const key = `apify-leads:${today}`;
        await env.ZYNTEVO_DB.put(key, JSON.stringify(leads), { expirationTtl: 7 * 24 * 60 * 60 }); // 7 Tage

        return json({ success: true, count: leads.length, date: today }, 200, corsHeaders);
      }

      // === LEADS ABRUFEN (für Personalisierungs-Agent) ===
      if (url.pathname === "/api/leads/today" && request.method === "POST") {
        const { adminKey } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);

        const today = new Date().toISOString().split("T")[0];
        const key = `apify-leads:${today}`;
        const raw = await env.ZYNTEVO_DB.get(key);
        const leads = raw ? JSON.parse(raw) : [];

        // Nur Leads mit Website und Email filtern
        const filtered = leads.filter(l => l.website && l.emails);

        return json({ success: true, leads: filtered, total: leads.length, withWebsite: filtered.length }, 200, corsHeaders);
      }


      // === WEBSITE SCRAPEN (direkter Fetch) ===
      if (url.pathname === "/api/scrape" && request.method === "POST") {
        const { website } = await request.json();
        if (!website) return json({ error: "Keine URL" }, 400, corsHeaders);

        try {
          const cleanUrl = website.startsWith('http') ? website.split('?')[0] : `https://${website.split('?')[0]}`;

          const siteRes = await fetch(cleanUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml",
              "Accept-Language": "de-DE,de;q=0.9"
            },
            redirect: "follow"
          });

          if (!siteRes.ok) {
            return json({ error: `Website nicht erreichbar: ${siteRes.status}` }, 400, corsHeaders);
          }

          const html = await siteRes.text();

          // Extract text from HTML - remove tags and scripts
          const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 3000);

          if (text.length < 50) {
            return json({ error: "Zu wenig Inhalt" }, 400, corsHeaders);
          }

          return json({ success: true, text }, 200, corsHeaders);
        } catch(e) {
          return json({ error: "Scraping fehlgeschlagen: " + e.message }, 500, corsHeaders);
        }
      }

      // === ENTERPRISE: CREATE (Admin) ===
      if (url.pathname === "/api/enterprise/create" && request.method === "POST") {
        const { adminKey, branch, buyerEmail, buyerName } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        if (!branch || !buyerEmail) return json({ error: "branch und buyerEmail erforderlich" }, 400, corsHeaders);
        const enterpriseId = 'ENT-' + Math.random().toString(36).substr(2, 8).toUpperCase();
        const prefix = branch.toUpperCase().substring(0, 3);
        const codes = [1,2,3,4,5].map(() => `${prefix}-${Math.random().toString(36).substr(2, 4).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`);
        const ent = { id: enterpriseId, branch, buyerEmail, buyerName: buyerName || '', created: Date.now(), codes, bausteine: [] };
        await env.ZYNTEVO_DB.put(`ent-id:${enterpriseId}`, JSON.stringify(ent));
        for (let i = 0; i < codes.length; i++) {
          await env.ZYNTEVO_DB.put(`ent-code:${codes[i]}`, JSON.stringify({ enterpriseId, branch, userId: i + 1 }));
        }
        const idxRaw = await env.ZYNTEVO_DB.get("ent-index");
        const idx = idxRaw ? JSON.parse(idxRaw) : [];
        if (!idx.includes(enterpriseId)) idx.push(enterpriseId);
        await env.ZYNTEVO_DB.put("ent-index", JSON.stringify(idx));
        await sendEnterpriseWelcomeEmail(buyerEmail, buyerName || 'Kunde', branch, codes);
        return json({ success: true, enterpriseId, codes }, 200, corsHeaders);
      }

      // === ENTERPRISE: LOGIN ===
      if (url.pathname === "/api/enterprise/login" && request.method === "POST") {
        const { code } = await request.json();
        if (!code) return json({ error: "Kein Code" }, 400, corsHeaders);
        const raw = await env.ZYNTEVO_DB.get(`ent-code:${code.trim().toUpperCase()}`);
        if (!raw) return json({ error: "Ungültiger Enterprise-Code" }, 401, corsHeaders);
        const data = JSON.parse(raw);
        return json({ success: true, enterpriseId: data.enterpriseId, userId: data.userId, branch: data.branch }, 200, corsHeaders);
      }

      // === ENTERPRISE: QUERY ===
      if (url.pathname === "/api/enterprise/query" && request.method === "POST") {
        const { prompt, enterpriseId, userId, language } = await request.json();
        if (!prompt || !enterpriseId || !userId) return json({ error: "Fehlende Parameter" }, 400, corsHeaders);
        const entRaw = await env.ZYNTEVO_DB.get(`ent-id:${enterpriseId}`);
        if (!entRaw) return json({ error: "Enterprise nicht gefunden" }, 401, corsHeaders);
        const ent = JSON.parse(entRaw);
        const userCodeKey = `ent-user:${enterpriseId}:${userId}`;
        const userRaw = await env.ZYNTEVO_DB.get(userCodeKey);
        const userData = userRaw ? JSON.parse(userRaw) : { generierungen: 0 };
        userData.generierungen = (userData.generierungen || 0) + 1;
        userData.letzteNutzung = Date.now();
        await env.ZYNTEVO_DB.put(userCodeKey, JSON.stringify(userData));
        let fullPrompt = prompt;
        const bausteine = ent.bausteine || [];
        if (bausteine.length > 0) {
          const bausteineText = bausteine.map(b => b.text).join('\n- ');
          fullPrompt = prompt + `\n\nWichtig: Integriere folgende Unternehmens-Textbausteine natürlich in den Text:\n- ${bausteineText}`;
        }
        const langSystem = buildLangSystem(language);
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, system: langSystem, messages: [{ role: "user", content: fullPrompt }] })
        });
        const data = await response.json();
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // === ENTERPRISE: STATS (Admin) ===
      if (url.pathname === "/api/enterprise/stats" && request.method === "POST") {
        const { adminKey } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        const idxRaw = await env.ZYNTEVO_DB.get("ent-index");
        const idx = idxRaw ? JSON.parse(idxRaw) : [];
        const enterprises = await Promise.all(idx.map(async (id) => {
          const raw = await env.ZYNTEVO_DB.get(`ent-id:${id}`);
          if (!raw) return null;
          const ent = JSON.parse(raw);
          const users = await Promise.all([1,2,3,4,5].map(async (uid) => {
            const uRaw = await env.ZYNTEVO_DB.get(`ent-user:${id}:${uid}`);
            const u = uRaw ? JSON.parse(uRaw) : { generierungen: 0, letzteNutzung: null };
            return { userId: uid, code: ent.codes[uid - 1], generierungen: u.generierungen || 0, letzteNutzung: u.letzteNutzung || null };
          }));
          return { id, branch: ent.branch, buyerEmail: ent.buyerEmail, buyerName: ent.buyerName, created: ent.created, users, bausteineCount: (ent.bausteine || []).length, bausteine: ent.bausteine || [] };
        }));
        return json({ success: true, enterprises: enterprises.filter(Boolean) }, 200, corsHeaders);
      }

      // === ENTERPRISE: BAUSTEINE (Admin) ===
      if (url.pathname === "/api/enterprise/bausteine" && request.method === "POST") {
        const { adminKey, enterpriseId, action, text, bausteineId } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        const raw = await env.ZYNTEVO_DB.get(`ent-id:${enterpriseId}`);
        if (!raw) return json({ error: "Enterprise nicht gefunden" }, 404, corsHeaders);
        const ent = JSON.parse(raw);
        if (!ent.bausteine) ent.bausteine = [];
        if (action === "add" && text) {
          ent.bausteine.push({ id: Date.now(), text });
        } else if (action === "delete" && bausteineId) {
          ent.bausteine = ent.bausteine.filter(b => b.id !== bausteineId);
        } else if (action === "edit" && bausteineId && text) {
          const b = ent.bausteine.find(b => b.id === bausteineId);
          if (b) b.text = text;
        }
        await env.ZYNTEVO_DB.put(`ent-id:${enterpriseId}`, JSON.stringify(ent));
        return json({ success: true, bausteine: ent.bausteine }, 200, corsHeaders);
      }

      // === ENTERPRISE: DELETE (Admin) ===
      if (url.pathname === "/api/enterprise/delete" && request.method === "POST") {
        const { adminKey, enterpriseId } = await request.json();
        if (adminKey !== ADMIN_KEY) return json({ error: "Nicht autorisiert" }, 403, corsHeaders);
        const raw = await env.ZYNTEVO_DB.get(`ent-id:${enterpriseId}`);
        if (!raw) return json({ error: "Nicht gefunden" }, 404, corsHeaders);
        const ent = JSON.parse(raw);
        for (const code of ent.codes) await env.ZYNTEVO_DB.delete(`ent-code:${code}`);
        await env.ZYNTEVO_DB.delete(`ent-id:${enterpriseId}`);
        const idxRaw = await env.ZYNTEVO_DB.get("ent-index");
        const idx = idxRaw ? JSON.parse(idxRaw) : [];
        await env.ZYNTEVO_DB.put("ent-index", JSON.stringify(idx.filter(i => i !== enterpriseId)));
        return json({ success: true }, 200, corsHeaders);
      }

      return new Response("Zyntevo Tool API", { headers: corsHeaders });

    } catch (err) {
      return json({ error: "Server Fehler: " + err.message }, 500, corsHeaders);
    }
  }
};

async function sendDemoEmail(toEmail, branche, tool, resultText) {
  const brancheLabels = { makler: 'Immobilienmakler', handwerker: 'Handwerksbetriebe', steuerberater: 'Steuerberater' };
  const kaufLinks = {
    makler: 'https://zyntevo.github.io/zyntevo/makler.html',
    handwerker: 'https://zyntevo.github.io/zyntevo/handwerker.html',
    steuerberater: 'https://zyntevo.github.io/zyntevo/steuerberater.html'
  };
  const demoLinks = {
    makler: 'https://zyntevo.de/demo-makler.html',
    handwerker: 'https://zyntevo.de/demo-handwerker.html',
    steuerberater: 'https://zyntevo.de/demo-steuerberater.html'
  };
  const unsubscribeLink = `mailto:jan@zyntevo.de?subject=Abmelden&body=Bitte%20tragen%20Sie%20mich%20aus%20dem%20Verteiler%20aus.%20E-Mail%3A%20${encodeURIComponent(toEmail)}`;
  const brancheLabel = brancheLabels[branche] || branche;
  const kaufLink = kaufLinks[branche] || 'https://zyntevo.de';
  const demoLink = demoLinks[branche] || 'https://zyntevo.de';

  const resultBlock = resultText ? `
    <div style="background:#F8F7FF;border:1px solid rgba(212,175,55,.25);border-radius:14px;padding:24px;margin:24px 0;font-size:13px;line-height:1.8;color:#1E293B;white-space:pre-wrap;">${resultText}</div>` : '';

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F0EEF8;font-family:Inter,Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#FFFFFF;border:1px solid rgba(212,175,55,.2);border-radius:24px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.08);">
    <div style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid rgba(212,175,55,.12);background:linear-gradient(135deg,rgba(240,238,248,1),rgba(255,255,255,1));">
      <div style="font-size:26px;font-weight:900;letter-spacing:3px;color:#D4AF37;">ZYNTEVO</div>
      <div style="color:#64748B;font-size:13px;margin-top:4px;">KI-Tool für ${brancheLabel}</div>
    </div>
    <div style="padding:36px 40px;">
      <p style="color:#1E293B;font-size:16px;font-weight:700;margin:0 0 8px;">Dein Ergebnis aus der kostenlosen Demo</p>
      <p style="color:#64748B;font-size:14px;line-height:1.7;margin:0 0 4px;">Hier ist der Text den ZYNTEVO für dich generiert hat:</p>
      ${resultBlock}
      <div style="background:rgba(212,175,55,.05);border:1px solid rgba(212,175,55,.2);border-radius:14px;padding:24px;margin-top:8px;">
        <p style="color:#1E293B;font-size:15px;font-weight:700;margin:0 0 8px;">Gefällt dir das Ergebnis?</p>
        <p style="color:#64748B;font-size:13px;line-height:1.7;margin:0 0 20px;">Mit dem vollständigen ZYNTEVO-Tool hast du Zugang zu allen 8 Generatoren – unbegrenzt, direkt im Browser, ohne Abo.</p>
        <div style="text-align:center;margin-bottom:12px;">
          <a href="${kaufLink}" style="display:inline-block;padding:14px 32px;background:#D4AF37;color:#000;font-weight:700;font-size:15px;text-decoration:none;border-radius:12px;">⚡ Jetzt Premium sichern – 297€</a>
        </div>
        <p style="text-align:center;color:#64748B;font-size:12px;margin:0;">Einmalzahlung · Kein Abo · Sofort einsatzbereit</p>
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:12px;padding:10px 16px;background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.2);border-radius:10px;">
          <span style="font-size:16px;">🛡️</span>
          <span style="font-size:12px;color:#16A34A;font-weight:700;">14 Tage Geld-zurück-Garantie – kein Risiko</span>
        </div>
      </div>
      <div style="margin-top:28px;padding-top:20px;border-top:1px solid rgba(0,0,0,.07);">
        <img src="https://zyntevo.github.io/zyntevo/css/images/header.png" alt="ZYNTEVO" style="height:40px;width:auto;margin-bottom:12px;display:block;filter:brightness(0);">
        <p style="color:#1E293B;font-size:13px;margin:0 0 4px;">Mit freundlichen Grüßen,<br><strong>Jan Wichmann</strong></p>
        <p style="color:#64748B;font-size:12px;margin:6px 0 0;line-height:1.6;">Gründer &amp; KI-Stratege<br>ZYNTEVO – KI-Systeme für Unternehmer</p>
        <p style="color:#64748B;font-size:12px;margin:8px 0 0;">✉ <a href="mailto:jan@zyntevo.de" style="color:#D4AF37;text-decoration:none;">jan@zyntevo.de</a> &nbsp;🌐 <a href="https://zyntevo.de" style="color:#D4AF37;text-decoration:none;">zyntevo.de</a></p>
        <div style="margin:14px 0;border-top:1px solid rgba(0,0,0,.07);padding-top:12px;">
          <p style="color:#64748B;font-size:11px;line-height:1.7;margin:0;">Wir helfen Immobilienmaklern, Steuerberatern und Handwerkern dabei, wiederkehrende Aufgaben mit KI zu automatisieren – ohne technisches Vorwissen. Spare 5+ Stunden pro Woche.</p>
        </div>
        <p style="color:#94A3B8;font-size:10px;margin:10px 0 0;font-style:italic;">Diese E-Mail ist vertraulich und ausschließlich für den Empfänger bestimmt.</p>
        <p style="color:#94A3B8;font-size:10px;margin:8px 0 0;">Keine weiteren Nachrichten gewünscht? <a href="${unsubscribeLink}" style="color:#64748B;text-decoration:underline;">Hier abmelden</a></p>
      </div>
    </div>
    <div style="padding:16px 40px;border-top:1px solid rgba(0,0,0,.06);background:#F8F7FF;text-align:center;">
      <p style="color:#64748B;font-size:11px;margin:0;">ZYNTEVO · <a href="https://zyntevo.de" style="color:#D4AF37;text-decoration:none;">zyntevo.de</a> · <a href="${demoLink}" style="color:#64748B;text-decoration:none;">Demo nochmal testen</a> · <a href="${unsubscribeLink}" style="color:#94A3B8;text-decoration:none;font-size:10px;">Abmelden</a></p>
    </div>
  </div>
</body></html>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `ZYNTEVO <${FROM_EMAIL}>`,
      to: [toEmail],
      subject: `Dein ZYNTEVO Demo-Ergebnis – jetzt den vollen Zugang sichern`,
      headers: {
        "List-Unsubscribe": `<${unsubscribeLink}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
      },
      html
    })
  });
}

async function sendWelcomeEmail(toEmail, toName, code, product) {
  const productLabel = PRODUCT_LABELS[product] || product;
  const toolUrl = TOOL_URLS[product] || "https://zyntevo.de";
  const isPremium = product.includes("premium");
  const unsubscribeLink = `mailto:jan@zyntevo.de?subject=Abmelden&body=Bitte%20tragen%20Sie%20mich%20aus%20dem%20Verteiler%20aus.%20E-Mail%3A%20${encodeURIComponent(toEmail)}`;
  const codeBlock = isPremium && code ? `
      <div style="background:rgba(212,175,55,.06);border:1px solid rgba(212,175,55,.25);border-radius:14px;padding:24px;text-align:center;margin-bottom:24px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:#94A3B8;margin-bottom:10px;">DEIN REGISTRIERUNGSCODE</div>
        <div style="font-size:24px;font-weight:900;letter-spacing:4px;color:#D4AF37;font-family:monospace;">${code}</div>
        <div style="font-size:11px;color:#64748B;margin-top:10px;">Gültig für 30 Tage · Einmalig verwendbar</div>
      </div>
      <ol style="color:#475569;font-size:14px;line-height:2;margin:0 0 24px;padding-left:20px;">
        <li>Öffne das KI-Tool über den Button unten</li>
        <li>Klick auf <strong style="color:#1E293B;">Registrieren</strong></li>
        <li>Gib deinen Code ein und wähle E-Mail + Passwort</li>
        <li>Fertig – du hast vollen Zugang!</li>
      </ol>
      <div style="text-align:center;margin-bottom:24px;">
        <a href="${toolUrl}" style="display:inline-block;padding:16px 32px;background:#D4AF37;color:#000;font-weight:700;font-size:15px;text-decoration:none;border-radius:12px;">⚡ Jetzt KI-Tool öffnen</a>
      </div>` : `<p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 24px;">Deine Downloads findest du auf der Dankeseite.</p>`;
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F0EEF8;font-family:Inter,Arial,sans-serif;"><div style="max-width:560px;margin:40px auto;background:#FFFFFF;border:1px solid rgba(212,175,55,.2);border-radius:24px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.08);"><div style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid rgba(212,175,55,.12);background:linear-gradient(135deg,rgba(240,238,248,1),rgba(255,255,255,1));"><div style="font-size:26px;font-weight:900;letter-spacing:3px;color:#D4AF37;">ZYNTEVO</div><div style="color:#64748B;font-size:13px;margin-top:4px;">${productLabel}</div></div><div style="padding:36px 40px;"><p style="color:#1E293B;font-size:16px;font-weight:700;margin:0 0 10px;">Hallo ${toName},</p><p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 24px;">vielen Dank für deinen Kauf! Dein Zugang ist jetzt aktiv und sofort einsatzbereit.</p>${codeBlock}<p style="color:#475569;font-size:13px;margin:0 0 0;">Bei Fragen antworte einfach auf diese E-Mail.</p><div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(0,0,0,.07);"><p style="color:#475569;font-size:13px;margin:0 0 10px;">Wenn dir ZYNTEVO gefällt – eine ehrliche Bewertung hilft anderen Unternehmern enorm:</p><a href="https://de.trustpilot.com/review/zyntevo.de" target="_blank" style="display:inline-block;padding:9px 18px;background:#f5f5f5;border:1px solid #ddd;border-radius:8px;text-decoration:none;color:#1E293B;font-size:13px;font-weight:600;">⭐ Auf Trustpilot bewerten →</a></div><div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(0,0,0,.07);"><p style="color:#1E293B;font-size:13px;margin:0 0 3px;">Mit freundlichen Grüßen,<br><strong>Jan Wichmann</strong></p><p style="color:#64748B;font-size:12px;margin:4px 0 0;">Gründer & KI-Stratege · ZYNTEVO</p><p style="color:#64748B;font-size:12px;margin:6px 0 0;">✉ <a href="mailto:jan@zyntevo.de" style="color:#D4AF37;text-decoration:none;">jan@zyntevo.de</a> &nbsp;🌐 <a href="https://zyntevo.de" style="color:#D4AF37;text-decoration:none;">zyntevo.de</a></p></div><p style="color:#94A3B8;font-size:10px;margin:14px 0 0;">Keine weiteren Nachrichten? <a href="${unsubscribeLink}" style="color:#64748B;text-decoration:underline;">Abmelden</a></p></div><div style="padding:16px 40px;border-top:1px solid rgba(0,0,0,.06);text-align:center;background:rgba(240,238,248,.4);"><p style="color:#94A3B8;font-size:11px;margin:0;">ZYNTEVO · <a href="https://zyntevo.de" style="color:#D4AF37;text-decoration:none;">zyntevo.de</a></p></div></div></body></html>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `ZYNTEVO <${FROM_EMAIL}>`,
      to: [toEmail],
      subject: `Dein Kauf bei ZYNTEVO – ${productLabel}`,
      headers: {
        "List-Unsubscribe": `<${unsubscribeLink}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
      },
      html
    })
  });
}

async function sendEnterpriseWelcomeEmail(toEmail, toName, branch, codes) {
  const brancheLabels = { makler: 'Immobilienmakler', handwerker: 'Handwerksbetriebe', steuerberater: 'Steuerberater' };
  const toolUrls = {
    makler: 'https://zyntevo.github.io/zyntevo/ki-tool-makler-enterprise.html',
    handwerker: 'https://zyntevo.github.io/zyntevo/ki-tool-handwerker-enterprise.html',
    steuerberater: 'https://zyntevo.github.io/zyntevo/ki-tool-steuerberater-enterprise.html',
  };
  const brancheLabel = brancheLabels[branch] || branch;
  const toolUrl = toolUrls[branch] || 'https://zyntevo.de';
  const codesHtml = codes.map((c, i) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:rgba(212,175,55,.05);border:1px solid rgba(212,175,55,.2);border-radius:10px;margin-bottom:8px;"><span style="font-size:11px;font-weight:700;color:#94A3B8;">NUTZER ${i+1}</span><span style="font-size:16px;font-weight:900;letter-spacing:3px;color:#D4AF37;font-family:monospace;">${c}</span></div>`).join('');
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F0EEF8;font-family:Inter,Arial,sans-serif;"><div style="max-width:580px;margin:40px auto;background:#FFFFFF;border:1px solid rgba(212,175,55,.2);border-radius:24px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.08);"><div style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid rgba(212,175,55,.12);background:linear-gradient(135deg,rgba(240,238,248,1),rgba(255,255,255,1));"><div style="font-size:26px;font-weight:900;letter-spacing:3px;color:#D4AF37;">ZYNTEVO</div><div style="color:#64748B;font-size:13px;margin-top:4px;">Enterprise · ${brancheLabel}</div></div><div style="padding:36px 40px;"><div style="display:inline-block;padding:6px 16px;background:rgba(212,175,55,.1);border:1px solid rgba(212,175,55,.35);border-radius:999px;color:#B8962E;font-size:11px;font-weight:700;letter-spacing:2px;margin-bottom:20px;">🏢 ENTERPRISE ZUGANG AKTIV</div><p style="color:#1E293B;font-size:16px;font-weight:700;margin:0 0 10px;">Hallo ${toName},</p><p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 24px;">herzlich willkommen! Dein ZYNTEVO Enterprise-Zugang für 5 Nutzer ist jetzt aktiv. Hier sind deine 5 individuellen Zugangscodes:</p><div style="margin-bottom:24px;">${codesHtml}</div><p style="color:#475569;font-size:13px;line-height:1.7;margin:0 0 20px;">Jeder Nutzer in deinem Team gibt seinen persönlichen Code direkt im Tool ein – kein Passwort, kein Account nötig.</p><div style="text-align:center;margin-bottom:24px;"><a href="${toolUrl}" style="display:inline-block;padding:16px 32px;background:#D4AF37;color:#000;font-weight:700;font-size:15px;text-decoration:none;border-radius:12px;">⚡ Zum Enterprise-Tool →</a></div><div style="background:rgba(212,175,55,.04);border:1px solid rgba(212,175,55,.15);border-radius:14px;padding:20px;margin-bottom:20px;"><p style="color:#1E293B;font-size:13px;font-weight:700;margin:0 0 8px;">📞 Dein Onboarding-Call</p><p style="color:#475569;font-size:13px;line-height:1.6;margin:0;">Ich melde mich in den nächsten 24h persönlich bei dir, um deinen Team-Onboarding-Call zu vereinbaren.<br>Du kannst auch direkt antworten auf diese E-Mail.</p></div><p style="color:#475569;font-size:13px;margin:0 0 4px;">Mit freundlichen Grüßen,<br><strong style="color:#1E293B;">Jan Wichmann</strong></p><p style="color:#64748B;font-size:12px;margin:4px 0;">Gründer & KI-Stratege · ZYNTEVO</p><p style="color:#64748B;font-size:12px;margin:6px 0 0;">✉ <a href="mailto:jan@zyntevo.de" style="color:#D4AF37;text-decoration:none;">jan@zyntevo.de</a></p></div></div></body></html>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `ZYNTEVO <${FROM_EMAIL}>`,
      to: [toEmail],
      subject: `Dein ZYNTEVO Enterprise-Zugang – 5 Codes für dein Team`,
      html
    })
  });
}

async function sendTrialConversionEmail(toEmail, branche) {
  const brancheLabels = { makler: 'Immobilienmakler', handwerker: 'Handwerksbetriebe', steuerberater: 'Steuerberater' };
  const toolUrls = {
    makler: 'https://www.checkout-ds24.com/product/696893?voucher=TESTER-X9K2',
    handwerker: 'https://www.checkout-ds24.com/product/696900?voucher=TESTER-X9K2',
    steuerberater: 'https://www.checkout-ds24.com/product/698384?voucher=TESTER-X9K2',
  };
  const brancheLabel = brancheLabels[branche] || 'Ihr Bereich';
  const kaufUrl = toolUrls[branche] || 'https://zyntevo.de';
  const unsubscribeLink = `mailto:jan@zyntevo.de?subject=Abmelden&body=Bitte%20tragen%20Sie%20mich%20aus%20dem%20Verteiler%20aus.%20E-Mail%3A%20${encodeURIComponent(toEmail)}`;

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F0EEF8;font-family:Inter,Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#FFFFFF;border:1px solid rgba(212,175,55,.2);border-radius:24px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.08);">
    <div style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid rgba(212,175,55,.12);background:linear-gradient(135deg,rgba(240,238,248,1),rgba(255,255,255,1));">
      <div style="font-size:26px;font-weight:900;letter-spacing:3px;color:#D4AF37;">ZYNTEVO</div>
      <div style="color:#64748B;font-size:13px;margin-top:4px;">KI-Tool für ${brancheLabel}</div>
    </div>
    <div style="padding:36px 40px;">
      <p style="color:#1E293B;font-size:16px;font-weight:700;margin:0 0 12px;">Dein kostenloser Test ist abgelaufen.</p>
      <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 24px;">Du hast ZYNTEVO 7 Tage lang getestet – wie war's? Falls das Tool dir Schreibarbeit erspart hat, gibt es jetzt die Chance, es dauerhaft zu sichern.</p>

      <div style="background:rgba(212,175,55,.06);border:1px solid rgba(212,175,55,.25);border-radius:16px;padding:28px;text-align:center;margin-bottom:24px;">
        <div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#94A3B8;margin-bottom:8px;">NUR FÜR TESTER</div>
        <div style="font-size:18px;color:#94A3B8;text-decoration:line-through;margin-bottom:4px;">297 €</div>
        <div style="font-size:48px;font-weight:900;color:#D4AF37;line-height:1;margin-bottom:8px;">197 €</div>
        <div style="font-size:13px;color:#475569;margin-bottom:20px;">Rabattcode <strong style="color:#D4AF37;letter-spacing:1px;">TESTER-X9K2</strong> wird automatisch angewendet</div>
        <a href="${kaufUrl}" style="display:inline-block;padding:16px 36px;background:#D4AF37;color:#000;font-weight:700;font-size:15px;text-decoration:none;border-radius:12px;">⚡ Jetzt für 197 € sichern →</a>
        <p style="color:#94A3B8;font-size:11px;margin:12px 0 0;">Einmalzahlung · Kein Abo · Sofort einsatzbereit</p>
      </div>

      <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.2);border-radius:10px;margin-bottom:24px;">
        <span style="font-size:18px;">🛡️</span>
        <span style="font-size:13px;color:#16A34A;font-weight:700;">14 Tage Geld-zurück-Garantie – kein Risiko</span>
      </div>

      <div style="margin-top:24px;padding-top:20px;border-top:1px solid rgba(0,0,0,.07);">
        <p style="color:#475569;font-size:13px;margin:0 0 12px;">Hast du ZYNTEVO 7 Tage getestet und es hat dir geholfen? Eine ehrliche Bewertung hilft anderen Unternehmern die richtige Entscheidung zu treffen:</p>
        <a href="https://de.trustpilot.com/review/zyntevo.de" target="_blank" style="display:inline-block;padding:10px 20px;background:#f5f5f5;border:1px solid #ddd;border-radius:8px;text-decoration:none;color:#1E293B;font-size:13px;font-weight:600;">⭐ Auf Trustpilot bewerten →</a>
      </div>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(0,0,0,.07);">
        <p style="color:#1E293B;font-size:13px;margin:0 0 4px;">Mit freundlichen Grüßen,<br><strong>Jan Wichmann</strong></p>
        <p style="color:#64748B;font-size:12px;margin:6px 0 0;">Gründer & KI-Stratege · ZYNTEVO</p>
        <p style="color:#64748B;font-size:12px;margin:8px 0 0;">✉ <a href="mailto:jan@zyntevo.de" style="color:#D4AF37;text-decoration:none;">jan@zyntevo.de</a> &nbsp;🌐 <a href="https://zyntevo.de" style="color:#D4AF37;text-decoration:none;">zyntevo.de</a></p>
        <p style="color:#94A3B8;font-size:10px;margin:12px 0 0;">Keine weiteren Nachrichten? <a href="${unsubscribeLink}" style="color:#64748B;text-decoration:underline;">Hier abmelden</a></p>
      </div>
    </div>
  </div>
</body></html>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `ZYNTEVO <${FROM_EMAIL}>`,
      to: [toEmail],
      subject: `Dein ZYNTEVO-Test ist abgelaufen – jetzt für 197 € sichern`,
      headers: { "List-Unsubscribe": `<${unsubscribeLink}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      html
    })
  });
}

function buildLangSystem(language) {
  const instructions = {
    en: "Reply exclusively in English. Use a professional, persuasive business tone suited for B2B communications. Write naturally — avoid literal translations from German.",
    fr: "Réponds exclusivement en français. Utilise un ton professionnel et commercial adapté aux communications B2B. Vouvoie toujours le destinataire. Écris de manière naturelle.",
    de: "Antworte ausschließlich auf Deutsch. Verwende einen professionellen, überzeugenden Geschäftston."
  };
  return instructions[language] || instructions.de;
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "zyntevo-salt-2024");
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

async function verifyPassword(password, hash) {
  const newHash = await hashPassword(password);
  return newHash === hash;
}

async function createToken(email, product, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const payload = { email, product, exp: Math.floor(Date.now() / 1000) + 86400 };
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`));
  return `${header}.${body}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
}

async function verifyToken(token, secret) {
  const [header, body, sig] = token.split('.');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, Uint8Array.from(atob(sig), c => c.charCodeAt(0)), encoder.encode(`${header}.${body}`));
  if (!valid) throw new Error('Invalid signature');
  const payload = JSON.parse(atob(body));
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}
