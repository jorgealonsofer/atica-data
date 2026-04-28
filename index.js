const express = require("express");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const app = express();

// cache de sesión
let SESSION = {
  cookies: null,
  createdAt: 0,
  dni: null
};

const SESSION_TTL = 10 * 60 * 1000; // 10 min

async function getSession(dni, soporte, ejercicio) {
  const now = Date.now();

  if (
    SESSION.cookies &&
    SESSION.dni === dni &&
    now - SESSION.createdAt < SESSION_TTL
  ) {
    return SESSION.cookies;
  }

  const browser = await puppeteer.launch({
    args: [...chromium.args, "--disable-dev-shm-usage"],
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  const page = await browser.newPage();

  await page.goto(
    `https://www.sedecatastro.gob.es/Accesos/SECAccDNI.aspx?Dest=3&ejercicio=${ejercicio}`,
    { waitUntil: "networkidle2" }
  );

  await page.type("#ctl00_Contenido_nif", dni);
  await page.type("#ctl00_Contenido_soporte", soporte);

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }),
    page.click("#ctl00_Contenido_bAceptar"),
  ]);

  const cookies = await page.cookies();
  await browser.close();

  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join("; ");

  SESSION = {
    cookies: cookieString,
    createdAt: now,
    dni
  };

  return cookieString;
}

app.get("/valor-referencia", async (req, res) => {
  const { dni, soporte, refcat, ejercicio } = req.query;

  if (!dni || !soporte || !refcat || !ejercicio) {
    return res.json({ ok: false, error: "Faltan parámetros" });
  }

  try {
    const cookies = await getSession(dni, soporte, ejercicio);

    // URL correcta dinámica
    const url = `https://www.sedecatastro.gob.es/CYCBienInmueble/OVCBusqueda.aspx?VR=SI&ejercicio=${ejercicio}&RefC=${refcat}`;

    const resp = await fetch(url, {
      headers: {
        "cookie": cookies,
        "user-agent": "Mozilla/5.0"
      }
    });

    const html = await resp.text();

    const texto = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const match = texto.match(/Valor de Referencia\s+([\d.,]+)\s+euros/i);

    return res.json({
      ok: true,
      ejercicio,
      refcat,
      valor_referencia: match ? match[1] : null,
      encontrado: !!match
    });

  } catch (error) {
    return res.json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Servidor en puerto " + PORT));
