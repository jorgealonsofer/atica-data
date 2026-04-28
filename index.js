const express = require("express");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const app = express();

app.get("/", (req, res) => res.send("API funcionando"));

app.get("/valor-referencia", async (req, res) => {
  const { dni, soporte } = req.query;
  const ejercicio = req.query.ejercicio || "2026";

  if (!dni || !soporte) {
    return res.json({ ok: false, error: "Faltan dni o soporte" });
  }

  let browser;

  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, "--disable-dev-shm-usage"],
      defaultViewport: { width: 1366, height: 900 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    await page.goto(
      `https://www.sedecatastro.gob.es/Accesos/SECAccDNI.aspx?Dest=3&ejercicio=${encodeURIComponent(ejercicio)}`,
      { waitUntil: "networkidle2", timeout: 60000 }
    );

    await page.type('input[name="ctl00$Contenido$nif"]', dni, { delay: 30 });
    await page.type('input[name="ctl00$Contenido$soporte"]', soporte, { delay: 30 });

    await page.click("#ctl00_Contenido_bAceptar");

    await page.waitForTimeout(8000);

    const url = page.url();
    const html = await page.content();
    const text = await page.evaluate(() => document.body.innerText);

    await browser.close();

    return res.json({
      ok: true,
      url,
      has_valores: text.includes("VALORES DE REFERENCIA") || text.includes("Valor de Referencia"),
      has_catastral: text.includes("Referencia Catastral") || text.includes("Referencia catastral"),
      texto: text.replace(/\s+/g, " ").substring(0, 3000),
      html: html.substring(0, 1000)
    });

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    return res.json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Servidor en puerto " + PORT));
