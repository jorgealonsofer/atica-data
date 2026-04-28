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

    const ejercicio = req.query.ejercicio || "2026";
    
    await page.goto(
      `https://www.sedecatastro.gob.es/Accesos/SECAccDNI.aspx?Dest=3&ejercicio=${ejercicio}`,
      { waitUntil: "networkidle2", timeout: 60000 }
    );

    await page.waitForTimeout(5000);
    
    const frames = page.frames();
    
    const infoFrames = frames.map((f, index) => ({
      index,
      url: f.url(),
      name: f.name()
    }));
    
    const frame = frames.find(f =>
      f.url().includes("Accesos") ||
      f.url().includes("SECAccDNI") ||
      f.url().includes("CYCBienInmueble") ||
      f.url().includes("sedecatastro")
    );
    
    if (!frame) {
      return res.json({
        error: "No se encontró frame válido",
        frames: infoFrames
      });
    }
    
    await page.waitForSelector("#ctl00_Contenido_IdNIF", { timeout: 15000 });
    await page.type("#ctl00_Contenido_IdNIF", dni);
    
    await page.waitForSelector("#ctl00_Contenido_soporte", { timeout: 15000 });
    await page.type("#ctl00_Contenido_soporte", soporte);

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
