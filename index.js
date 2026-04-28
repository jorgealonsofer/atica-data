const express = require("express");

const app = express();

app.get("/", (req, res) => {
  res.send("API funcionando");
});

function decodeHtml(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function collectCookies(response, oldCookies = "") {
  const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  const cookies = oldCookies ? oldCookies.split(";").map(c => c.trim()).filter(Boolean) : [];

  for (const c of setCookie) cookies.push(c.split(";")[0]);

  const map = new Map();
  for (const c of cookies) {
    const [k, ...v] = c.split("=");
    if (k) map.set(k, v.join("="));
  }

  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

app.get("/valor-referencia", async (req, res) => {
  const dni = req.query.dni;
  const soporte = req.query.soporte;
  const ejercicio = req.query.ejercicio || "2026";

  if (!dni || !soporte) {
    return res.json({ ok: false, error: "Faltan parámetros dni o soporte" });
  }

  try {
    const base = "https://www.sedecatastro.gob.es";
    const url = `${base}/Accesos/SECAccDNI.aspx?Dest=3&ejercicio=${encodeURIComponent(ejercicio)}`;

    const commonHeaders = {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "es-ES,es;q=0.9"
    };

    const getResp = await fetch(url, { headers: commonHeaders });

    let cookies = collectCookies(getResp);
    const html = await getResp.text();

    const form = new URLSearchParams();
    const inputs = html.match(/<input\b[^>]*>/gi) || [];

    for (const input of inputs) {
      const nameMatch = input.match(/\bname=["']([^"']+)["']/i);
      if (!nameMatch) continue;

      const name = decodeHtml(nameMatch[1]);
      const valueMatch = input.match(/\bvalue=["']([^"']*)["']/i);
      const value = valueMatch ? decodeHtml(valueMatch[1]) : "";

      form.set(name, value);
    }

    form.set("__EVENTTARGET", "ctl00$Contenido$bAceptar");
    form.set("__EVENTARGUMENT", "");
    form.set("ctl00$Contenido$nif", dni);
    form.set("ctl00$Contenido$soporte", soporte);
    form.set("ctl00$Contenido$nombre", "");
    form.set("ctl00$Contenido$apellido", "");

    const postResp = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        ...commonHeaders,
        "cache-control": "no-cache",
        "content-type": "application/x-www-form-urlencoded",
        "origin": base,
        "pragma": "no-cache",
        "referer": url,
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
        "cookie": cookies
      },
      body: form.toString()
    });

    cookies = collectCookies(postResp, cookies);

    let finalUrl = url;
    let finalHtml = "";

    const location = postResp.headers.get("location");

    if ((postResp.status === 301 || postResp.status === 302 || postResp.status === 303) && location) {
      finalUrl = location.startsWith("http") ? location : base + location;

      const finalResp = await fetch(finalUrl, {
        headers: {
          ...commonHeaders,
          "cookie": cookies,
          "referer": url
        }
      });

      cookies = collectCookies(finalResp, cookies);
      finalHtml = await finalResp.text();
    } else {
      finalHtml = await postResp.text();
    }

    const texto = cleanText(finalHtml);

    return res.json({
      ok: true,
      post_status: postResp.status,
      location,
      finalUrl,
      has_valores: finalHtml.includes("VALORES DE REFERENCIA") || finalHtml.includes("Valor de Referencia"),
      has_catastral: finalHtml.includes("Referencia Catastral") || finalHtml.includes("Referencia catastral"),
      texto: texto.substring(0, 3000)
    });

  } catch (error) {
    return res.json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Servidor en puerto " + PORT));
