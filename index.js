const express = require("express");

const app = express();

app.get("/", (req, res) => {
  res.send("API funcionando");
});

function getInputValue(html, name) {
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  let re = new RegExp(`<input[^>]*name=["']${safeName}["'][^>]*value=["']([^"']*)["'][^>]*>`, "i");
  let m = html.match(re);
  if (m) return decodeHtml(m[1]);

  re = new RegExp(`<input[^>]*value=["']([^"']*)["'][^>]*name=["']${safeName}["'][^>]*>`, "i");
  m = html.match(re);
  if (m) return decodeHtml(m[1]);

  return "";
}

function decodeHtml(str) {
  return String(str)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function collectCookies(response, oldCookies = "") {
  const setCookie = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [];

  const cookieParts = oldCookies
    ? oldCookies.split(";").map(c => c.trim()).filter(Boolean)
    : [];

  for (const c of setCookie) {
    cookieParts.push(c.split(";")[0]);
  }

  const map = new Map();

  for (const c of cookieParts) {
    const [k, ...rest] = c.split("=");
    map.set(k, rest.join("="));
  }

  return Array.from(map.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

app.get("/valor-referencia", async (req, res) => {
  const dni = req.query.dni;
  const soporte = req.query.soporte;
  const ejercicio = req.query.ejercicio || "2026";

  if (!dni || !soporte) {
    return res.json({ ok: false, error: "Faltan parámetros dni o soporte" });
  }

  try {
    const url = `https://www.sedecatastro.gob.es/Accesos/SECAccDNI.aspx?Dest=3&ejercicio=${encodeURIComponent(ejercicio)}`;

    const getResp = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,application/xhtml+xml"
      }
    });

    let cookies = collectCookies(getResp);
    const html = await getResp.text();

    const form = new URLSearchParams();

    form.set("__EVENTTARGET", "");
    form.set("__EVENTARGUMENT", "");
    form.set("__VIEWSTATE", getInputValue(html, "__VIEWSTATE"));
    form.set("__VIEWSTATEGENERATOR", getInputValue(html, "__VIEWSTATEGENERATOR"));
    form.set("__VIEWSTATEENCRYPTED", getInputValue(html, "__VIEWSTATEENCRYPTED"));
    form.set("__EVENTVALIDATION", getInputValue(html, "__EVENTVALIDATION"));

    form.set("ctl00$hdIdioma", getInputValue(html, "ctl00$hdIdioma") || "es");
    form.set("ctl00$hdFinalidadMaestra", getInputValue(html, "ctl00$hdFinalidadMaestra"));
    form.set("ctl00$hdVerModal", getInputValue(html, "ctl00$hdVerModal") || "N");

    form.set("ctl00$Contenido$hdNumeroNombres", getInputValue(html, "ctl00$Contenido$hdNumeroNombres"));
    form.set("ctl00$Contenido$apell", getInputValue(html, "ctl00$Contenido$apell"));
    form.set("ctl00$Contenido$codigoSIA", getInputValue(html, "ctl00$Contenido$codigoSIA"));
    form.set("ctl00$Contenido$procedimientoSIA", getInputValue(html, "ctl00$Contenido$procedimientoSIA"));
    form.set("ctl00$Contenido$hdRequiereDNI", getInputValue(html, "ctl00$Contenido$hdRequiereDNI") || "1");
    form.set("ctl00$Contenido$hdCSV", getInputValue(html, "ctl00$Contenido$hdCSV"));

    form.set("ctl00$Contenido$nif", dni);
    form.set("ctl00$Contenido$soporte", soporte);
    form.set("ctl00$Contenido$nombre", "");
    form.set("ctl00$Contenido$apellido", "");

    // Botón real encontrado en debug:
    form.set("ctl00$Contenido$bAceptar", "Validar DNI / Soporte");

    const postResp = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,application/xhtml+xml",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": cookies,
        "Referer": url
      },
      body: form.toString()
    });

    cookies = collectCookies(postResp, cookies);

    const location = postResp.headers.get("location");
    const postHtml = await postResp.text();

    return res.json({
      ok: true,
      status: postResp.status,
      location,
      cookies_ok: Boolean(cookies),
      has_valores: postHtml.includes("VALORES DE REFERENCIA"),
      has_catastral: postHtml.includes("Referencia Catastral"),
      has_error_dni: postHtml.toLowerCase().includes("dni") && postHtml.toLowerCase().includes("soporte"),
      texto: postHtml
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .substring(0, 3000)
    });

  } catch (error) {
    return res.json({
      ok: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Servidor en puerto " + PORT));
