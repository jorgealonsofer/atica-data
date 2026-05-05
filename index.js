const express = require("express");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const app = express();

app.get("/", (req, res) => res.send("API funcionando"));

const DNI = process.env.CATASTRO_DNI;
const SOPORTE = process.env.CATASTRO_SOPORTE;

let browserGlobal = null;
let consultaEnCurso = false;

async function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getBrowser() {
  if (browserGlobal && browserGlobal.isConnected()) {
    return browserGlobal;
  }

  browserGlobal = await puppeteer.launch({
    args: [
      ...chromium.args,
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-translate",
      "--hide-scrollbars",
      "--mute-audio"
    ],
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  browserGlobal.on("disconnected", () => {
    browserGlobal = null;
  });

  return browserGlobal;
}

async function ejecutarEnCola(fn) {
  while (consultaEnCurso) {
    await esperar(250);
  }

  consultaEnCurso = true;

  try {
    return await fn();
  } finally {
    consultaEnCurso = false;
  }
}

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

function extraerValor(texto) {
  const limpio = texto.replace(/\s+/g, " ");
  const match = limpio.match(/Valor de Referencia\s*([\d.,]+)/i);
  return match ? match[1] : null;
}

app.get("/warmup", async (req, res) => {
  try {
    await getBrowser();

    return res.json({
      ok: true,
      status: "browser_ready"
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get("/valor-referencia", async (req, res) => {
  return ejecutarEnCola(async () => {
    const { refcat } = req.query;
    const ejercicio = req.query.ejercicio || "2026";

    if (!DNI || !SOPORTE) {
      return res.json({
        ok: false,
        error: "Faltan variables CATASTRO_DNI o CATASTRO_SOPORTE en Render"
      });
    }

    if (!refcat) {
      return res.json({ ok: false, error: "Falta refcat" });
    }

    let page;

    try {
      const browser = await getBrowser();
      page = await browser.newPage();

      page.setDefaultTimeout(30000);
      page.setDefaultNavigationTimeout(60000);

      await page.setRequestInterception(true);

      page.on("request", request => {
        const type = request.resourceType();

        if (["image", "font", "media"].includes(type)) {
          request.abort();
        } else {
          request.continue();
        }
      });

      await page.goto(
        `https://www.sedecatastro.gob.es/Accesos/SECAccDNI.aspx?Dest=3&ejercicio=${encodeURIComponent(ejercicio)}`,
        { waitUntil: "domcontentloaded", timeout: 60000 }
      );

      await page.type("#ctl00_Contenido_nif", DNI);
      await page.type("#ctl00_Contenido_soporte", SOPORTE);

      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
        page.click("#ctl00_Contenido_bAceptar")
      ]);

      await page.waitForTimeout(2500);

      if (!page.url().includes("OVCBusqueda")) {
        const textoError = await page.evaluate(() => document.body.innerText).catch(() => "");
        const urlError = page.url();

        await page.close().catch(() => {});
        page = null;

        return res.json({
          ok: false,
          error: "No ha pasado login",
          url: urlError,
          texto: textoError.replace(/\s+/g, " ").substring(0, 2000),
        });
      }

      const segundaUrl = page.url();

      const formData = await page.evaluate((refcat, ejercicio) => {
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
        form.set("ctl00$Contenido$txtFechaConsulta", `28/04/${ejercicio}`);
        form.set("ctl00$Contenido$txtRC2", refcat);
        form.set("ctl00$Contenido$btnValorReferencia", "VALOR DE REFERENCIA");

        return form.toString();
      }, refcat, ejercicio);

      const cookieHeader = cookiesToHeader(await page.cookies());

      await page.close().catch(() => {});
      page = null;

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
      const valor = extraerValor(texto);

      return res.json({
        ok: true,
        ejercicio,
        refcat,
        encontrado: !!valor,
        valor_referencia: valor,
        valor_numero: valor ? Number(valor.replace(/\./g, "").replace(",", ".")) : null,
      });

    } catch (error) {
      if (page) await page.close().catch(() => {});

      return res.json({
        ok: false,
        error: error.message
      });
    }
  });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => console.log("Servidor en puerto " + PORT));
