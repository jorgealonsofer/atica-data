const express = require("express");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const app = express();

// cache simple de sesión
let SESSION = {
  cookies: null,
  createdAt: 0
};

const SESSION_TTL = 10 * 60 * 1000; // 10 min

// =========================
// LOGIN 
// =========================
async function getSession(dni, soporte) {
  const now = Date.now();

  if (SESSION.cookies && (now - SESSION.createdAt < SESSION_TTL)) {
    return SESSION.cookies;
  }

  const browser = await puppeteer.launch({
    args: [...chromium.args, "--disable-dev-shm-usage"],
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  const page = await browser.newPage();

  await page.goto(
    "https://www.sedecatastro.gob.es/Accesos/SECAccDNI.aspx?Dest=3&ejercicio=2026",
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
    createdAt: now
  };

  return cookieString;
}

// =========================
// ENDPOINT PRINCIPAL
// =========================
app.get("/valor-referencia", async (req, res) => {
  const { dni, soporte, refcat } = req.query;

  if (!dni || !soporte || !refcat) {
    return res.json({ ok: false, error: "Faltan parámetros" });
  }

  try {
    const cookies = await getSession(dni, soporte);

    // =========================
    // GET página final (rápido)
    // =========================
    const url = `https://www.sedecatastro.gob.es/CYCBienInmueble/OVCConsultaValorReferencia.aspx?RefC=${refcat}&ejercicio=2026`;

    const resp = await fetch(url, {
      headers: {
        "cookie": cookies,
        "user-agent": "Mozilla/5.0",
      }
    });

    const html = await resp.text();

    const texto = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // =========================
    // EXTRAER VALOR
    // =========================
    const match = texto.match(/Valor de Referencia\s+([\d.,]+)\s+euros/i);

    return res.json({
      ok: true,
      valor_referencia: match ? match[1] : null,
      encontrado: !!match,
    });

  } catch (error) {
    return res.json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Servidor en puerto " + PORT));
