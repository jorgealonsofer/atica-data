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

  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    await page.goto(
      "https://www1.sedecatastro.gob.es/OVCFrames.aspx?TIPO=CONSULTA",
      { waitUntil: "networkidle2" }
    );

    await page.waitForTimeout(5000);
    
    // buscar el frame correcto
    const frames = page.frames();
    
    // debug (opcional)
    console.log(frames.map(f => f.url()));
    
    // normalmente el segundo frame es el bueno
    const frame = frames.find(f => f.url().includes("OVCFrames") === false);
    
    // ahora dentro del frame buscamos el input
    await frame.waitForSelector("input");
    
    await frame.type("input", dni);

    await page.waitForTimeout(5000);

    const html = await page.content();

    await browser.close();

    res.json({ ok: true, html: html.substring(0, 500) });

  } catch (error) {
    res.json({ error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Servidor en puerto " + PORT));
