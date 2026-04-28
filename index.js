const express = require("express");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const app = express();

app.get("/", (req, res) => {
  res.send("API funcionando");
});

app.get("/valor-referencia", async (req, res) => {
  const { dni, soporte } = req.query;

  if (!dni || !soporte) {
    return res.json({ error: "Faltan parámetros" });
  }

  let browser;

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    const ejercicio = req.query.ejercicio || "2026";

    await page.goto(
      `https://www.sedecatastro.gob.es/Accesos/SECAccDNI.aspx?Dest=3&ejercicio=${ejercicio}`,
      { waitUntil: "networkidle2", timeout: 60000 }
    );

    await page.waitForSelector('input[name="ctl00$Contenido$nif"]', { timeout: 20000 });
    await page.type('input[name="ctl00$Contenido$nif"]', dni);

    await page.waitForSelector('input[name="ctl00$Contenido$soporte"]', { timeout: 20000 });
    await page.type('input[name="ctl00$Contenido$soporte"]', soporte);


// Buscar botón validar
await page.waitForSelector('input, button, a', { timeout: 20000 });

const validarSelector = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('input, button, a'));

  const el = els.find(el => {
    const txt = ((el.value || el.innerText || el.textContent || "") + "").toLowerCase();
    return txt.includes("validar");
  });

  if (!el) return null;

  el.setAttribute("data-validar-puppeteer", "1");
  return "[data-validar-puppeteer='1']";
});

if (!validarSelector) {
  return res.json({ error: "No se encontró botón validar" });
}

// Preparar espera ANTES del click
const navigationPromise = page.waitForNavigation({
  waitUntil: "domcontentloaded",
  timeout: 60000
}).catch(() => null);

// Click
await page.click(validarSelector);

// Esperar navegación o postback
await navigationPromise;

// Esperar a que el documento esté listo
await page.waitForFunction(
  () => document.readyState === "complete" || document.readyState === "interactive",
  { timeout: 30000 }
).catch(() => null);

// Pequeña pausa de seguridad
await page.waitForTimeout(3000);

// Leer HTML de forma segura
let html = "";
for (let i = 0; i < 5; i++) {
  try {
    html = await page.content();
    break;
  } catch (e) {
    await page.waitForTimeout(1000);
  }
}

if (!html) {
  return res.json({ error: "No se pudo leer el HTML después de validar" });
}

    
    await browser.close();

    res.json({
      ok: true,
      url: page.url(),
      html: html.substring(0, 1200)
    });

  } catch (error) {
    if (browser) {
      await browser.close().catch(() => {});
    }

    res.json({ error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Servidor en puerto " + PORT));
