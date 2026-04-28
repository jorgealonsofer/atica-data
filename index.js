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

    // Buscar y pulsar el botón de validar por texto/value
    await page.waitForSelector('input[type="submit"], button, a', { timeout: 20000 });

    const clicked = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('input[type="submit"], button, a'));

      const btn = els.find(el => {
        const txt = ((el.value || el.innerText || el.textContent || "") + "").toLowerCase();
        return txt.includes("validar");
      });

      if (!btn) return false;

      btn.click();
      return true;
    });

    if (!clicked) {
      const botones = await page.evaluate(() =>
        Array.from(document.querySelectorAll('input[type="submit"], button, a'))
          .map(el => ({
            tag: el.tagName,
            name: el.getAttribute("name"),
            id: el.getAttribute("id"),
            value: el.getAttribute("value"),
            text: el.innerText || el.textContent
          }))
      );

      await browser.close();

      return res.json({
        error: "No se encontró botón validar",
        botones
      });
    }

    try {
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 });
    } catch (e) {
      // Por si el botón valida con postback/ajax y no navegación normal
      await page.waitForTimeout(5000);
    }

    const html = await page.content();

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
