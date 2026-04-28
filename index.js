const express = require("express");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const app = express();

app.get("/", (req, res) => res.send("API funcionando"));

function cookiesToHeader(cookies) {
  return cookies.map(c => `${c.name}=${c.value}`).join("; ");
}

function limpiarTexto(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

app.get("/valor-referencia", async (req, res) => {
  const { dni, soporte, refcat } = req.query;
  const ejercicio = req.query.ejercicio || "2026";

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
      `https://www.sedecatastro.gob.es/Accesos/SECAccDNI.aspx?Dest=3&ejercicio=${encodeURIComponent(ejercicio)}`,
      { waitUntil: "networkidle2", timeout: 60000 }
    );

    await page.type("#ctl00_Contenido_nif", dni);
    await page.type("#ctl00_Contenido_soporte", soporte);

    await page.click("#ctl00_Contenido_bAceptar");
    await page.waitForTimeout(6000);

    if (!page.url().includes("OVCBusqueda")) {
      const textoError = await page.evaluate(() => document.body.innerText);
      await browser.close();

      return res.json({
        ok: false,
        error: "No ha pasado login",
        url: page.url(),
        texto: textoError.replace(/\s+/g, " ").substring(0, 2000),
      });
    }

    const segundaUrl = page.url();

    const formData = await page.evaluate((refcat) => {
      const form = new URLSearchParams();

      document.querySelectorAll("input").forEach(input => {
        if (input.name) form.set(input.name, input.value || "");
      });

      document.querySelectorAll("select").forEach(select => {
        if (select.name) form.set(select.name, select.value || "");
      });

      form.set("__EVENTTARGET", "");
      form.set("__EVENTARGUMENT", "");

      form.set("ctl00$Contenido$ddlFinalidad", "1");
      form.set("ctl00$Contenido$txtFechaConsulta", "28/04/2026");
      form.set("ctl00$Contenido$txtRC2", refcat);
      form.set("ctl00$Contenido$btnValorReferencia", "VALOR DE REFERENCIA");

      return form.toString();
    }, refcat);

    const cookieHeader = cookiesToHeader(await page.cookies());

    await browser.close();

    const postResp = await fetch(segundaUrl, {
      method: "POST",
      redirect: "follow",
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "es-ES,es;q=0.9",
        "content-type": "application/x-www-form-urlencoded",
        "origin": "https://www.sedecatastro.gob.es",
        "referer": segundaUrl,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        "cookie": cookieHeader,
      },
      body: formData,
    });

    const finalHtml = await postResp.text();
    const texto = limpiarTexto(finalHtml);

    return res.json({
      ok: true,
      status: postResp.status,
      url_final: postResp.url,
      tiene_valor:
        texto.includes("Valor de Referencia") ||
        texto.includes("VALOR DE REFERENCIA"),
      texto: texto.substring(0, 5000),
    });

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    return res.json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Servidor en puerto " + PORT));
