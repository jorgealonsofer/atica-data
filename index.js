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
    
    // coger TODOS los inputs reales del HTML
    const inputs = html.match(/<input\b[^>]*>/gi) || [];
    
    for (const input of inputs) {
      const nameMatch = input.match(/\bname=["']([^"']+)["']/i);
      if (!nameMatch) continue;
    
      const name = decodeHtml(nameMatch[1]);
    
      const valueMatch = input.match(/\bvalue=["']([^"']*)["']/i);
      const value = valueMatch ? decodeHtml(valueMatch[1]) : "";
    
      form.set(name, value);
    }
    
    // Sobrescribir solo los datos que queremos enviar
    form.set("ctl00$Contenido$nif", dni);
    form.set("ctl00$Contenido$soporte", soporte);
    form.set("ctl00$Contenido$nombre", "");
    form.set("ctl00$Contenido$apellido", "");
    
    // Botón ASP.NET real
    form.set("__EVENTTARGET", "ctl00$Contenido$bAceptar");
    form.set("__EVENTARGUMENT", "");

    const postResp = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://www.sedecatastro.gob.es",
        "Referer": url,
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Cookie": cookies
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
  boton_html: (html.match(/<button[\s\S]{0,1000}?ctl00_Contenido_bAceptar[\s\S]{0,1000}?<\/button>/i) || ["NO ENCONTRADO"])[0],
  form_tag: (html.match(/<form[^>]+>/i) || ["NO FORM"])[0],
  action: (html.match(/<form[^>]+action=["']([^"']+)["']/i) || [null, null])[1],
  preview: postHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .substring(0, 1500)
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
