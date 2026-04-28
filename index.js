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

    await page.waitForTimeout(5000);

    const debugAntes = await page.evaluate(() => {
      return {
        url: location.href,
        title: document.title,
        inputs: Array.from(document.querySelectorAll("input")).map(el => ({
          type: el.type,
          name: el.name,
          id: el.id,
          value: el.value,
          placeholder: el.placeholder
        })),
        buttons: Array.from(document.querySelectorAll("input, button, a")).map(el => ({
          tag: el.tagName,
          type: el.type || "",
          name: el.name || "",
          id: el.id || "",
          value: el.value || "",
          text: (el.innerText || el.textContent || "").trim()
        }))
      };
    });

    await browser.close();

    return res.json({
      ok: true,
      fase: "debug_inicial",
      debugAntes
    });

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    return res.json({
      ok: false,
      fase: "error",
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Servidor en puerto " + PORT));
