const express = require("express");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const app = express();

app.get("/", (req, res) => res.send("API funcionando"));

app.get("/valor-referencia", async (req, res) => {
  const { dni, soporte, refcat } = req.query;

  if (!dni || !soporte || !refcat) {
    return res.json({ ok: false, error: "Faltan dni, soporte o refcat" });
  }

  let browser;

  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, "--disable-dev-shm-usage"],
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();

    await page.goto(
      "https://www.sedecatastro.gob.es/Accesos/SECAccDNI.aspx?Dest=3&ejercicio=2026",
      { waitUntil: "networkidle2", timeout: 60000 }
    );

    await page.type("#ctl00_Contenido_nif", dni);
    await page.type("#ctl00_Contenido_soporte", soporte);

    await page.click("#ctl00_Contenido_bAceptar");
    await page.waitForTimeout(6000);

    const url2 = page.url();

    if (!url2.includes("OVCBusqueda")) {
      const textoError = await page.evaluate(() => document.body.innerText);
      await browser.close();

      return res.json({
        ok: false,
        error: "No ha pasado login",
        url: url2,
        texto: textoError.replace(/\s+/g, " ").substring(0, 2000),
      });
    }

    await page.select("#ctl00_Contenido_ddlFinalidad", "1");

 await page.$eval("#ctl00_Contenido_txtFechaConsulta", el => el.value = "");
await page.type("#ctl00_Contenido_txtFechaConsulta", "28/04/2026");

await page.$eval("#ctl00_Contenido_txtRC2", el => el.value = "");
await page.type("#ctl00_Contenido_txtRC2", refcat);

    const resultadoTexto = await page.evaluate(() => {
      return document.body ? document.body.innerText : "";
    });

    const urlFinal = page.url();

    await browser.close();

    return res.json({
      ok: true,
      url_final: urlFinal,
      tiene_valor:
        resultadoTexto.includes("Valor de Referencia") ||
        resultadoTexto.includes("VALOR DE REFERENCIA"),
      texto: resultadoTexto.replace(/\s+/g, " ").substring(0, 4000),
    });
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    return res.json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Servidor en puerto " + PORT));
