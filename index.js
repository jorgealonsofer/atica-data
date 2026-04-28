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

    // =========================
    // 1. LOGIN
    // =========================
    await page.goto(
      "https://www.sedecatastro.gob.es/Accesos/SECAccDNI.aspx?Dest=3&ejercicio=2026",
      { waitUntil: "networkidle2" }
    );

    await page.type("#ctl00_Contenido_nif", dni);
    await page.type("#ctl00_Contenido_soporte", soporte);

    await page.click("#ctl00_Contenido_bAceptar");

    await page.waitForTimeout(6000);

    await page.select("#ctl00_Contenido_ddlFinalidad", "1");
    
    await page.click("#ctl00_Contenido_txtFechaConsulta");
    await page.type("#ctl00_Contenido_txtFechaConsulta", "28/04/2026");
    
    await page.click("#ctl00_Contenido_txtRC2");
    await page.type("#ctl00_Contenido_txtRC2", refcat);
    
    await page.click("#ctl00_Contenido_btnValorReferencia");
    
    await page.waitForTimeout(8000);
    
    const text = await page.evaluate(() => document.body.innerText);
    
    await browser.close();
    
    return res.json({
      ok: true,
      url_final: page.url(),
      tiene_valor: text.includes("Valor de Referencia") || text.includes("VALOR DE REFERENCIA"),
      texto: text.replace(/\s+/g, " ").substring(0, 4000)
    });

    
    // =========================
    // 2. YA ESTAMOS DENTRO
    // =========================

    const url2 = page.url();

    // Comprobación
    if (!url2.includes("OVCBusqueda")) {
      const html = await page.content();
      await browser.close();

      return res.json({
        ok: false,
        error: "No ha pasado login",
        url: url2,
        html: html.substring(0, 1000)
      });
    }

    // =========================
    // 3. RELLENAR SEGUNDO FORM
    // =========================

    // seleccionar finalidad (si no seleccionas esto, falla)
    await page.select("select[name='ctl00$Contenido$ddlFinalidad']", "CONSULTA");

    // meter referencia catastral
    await page.type("#ctl00_Contenido_txtRC", refcat);

    // fecha (muchas veces viene ya, pero por si acaso)
    await page.evaluate(() => {
      const f = document.querySelector("#ctl00_Contenido_txtFecha");
      if (f && !f.value) {
        const hoy = new Date();
        f.value = hoy.toLocaleDateString("es-ES");
      }
    });

    // botón buscar
    await page.click("#ctl00_Contenido_btnBuscar");

    await page.waitForTimeout(7000);

    // =========================
    // 4. RESULTADO
    // =========================

    const finalHtml = await page.content();
    const text = await page.evaluate(() => document.body.innerText);

    await browser.close();

    return res.json({
      ok: true,
      url_final: page.url(),
      tiene_valor: text.includes("Valor de Referencia"),
      texto: text.replace(/\s+/g, " ").substring(0, 3000)
    });

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    return res.json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Servidor en puerto " + PORT));
