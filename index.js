const express = require("express");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const app = express();

app.get("/", (req, res) => {
  res.send("API funcionando");
});

app.get("/valor-referencia", async (req, res) => {
  const { dni, soporte } = req.query;
  const ejercicio = req.query.ejercicio || "2026";

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

    await page.goto(
      `https://www.sedecatastro.gob.es/Accesos/SECAccDNI.aspx?Dest=3&ejercicio=${ejercicio}`,
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );

    // Espera a que cargue bien
    await page.waitForTimeout(5000);

    // Rellenar campos
    await page.waitForSelector('input[name="ctl00$Contenido$nif"]', { timeout: 20000 });
    await page.type('input[name="ctl00$Contenido$nif"]', dni);

    await page.waitForSelector('input[name="ctl00$Contenido$soporte"]', { timeout: 20000 });
    await page.type('input[name="ctl00$Contenido$soporte"]', soporte);

    // Click en botón REAL
    await page.waitForSelector("#ctl00_Contenido_bAceptar", { timeout: 20000 });

    const navigationPromise = page.waitForNavigation({
      waitUntil: "domcontentloaded",
      timeout: 60000
    }).catch(() => null);

    await page.click("#ctl00_Contenido_bAceptar");

    await navigationPromise;

    // Esperar a que cargue bien después del submit
    await page.waitForTimeout(5000);

    const html = await page.content();

    await browser.close();

    res.json({
      ok: true,
      url: page.url(),
      html: html.substring(0, 1500)
    });

  } catch (error) {
    if (browser) {
      await browser.close().catch(() => {});
    }

    res.json({
      ok: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Servidor en puerto " + PORT));
