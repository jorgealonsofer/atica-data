const express = require("express");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const app = express();

app.get("/", (req, res) => res.send("API funcionando"));

const DNI = process.env.CATASTRO_DNI;
const SOPORTE = process.env.CATASTRO_SOPORTE;

let browserGlobal = null;
let consultaEnCurso = false;

/*
|--------------------------------------------------------------------------
| UTILIDADES
|--------------------------------------------------------------------------
*/

async function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function crearIdConsulta() {
  return Date.now().toString(36).toUpperCase();
}

function log(id, mensaje) {
  console.log(`[${new Date().toISOString()}] [${id}] ${mensaje}`);
}

async function cerrarContextoSeguro(context, page, id) {
  try {
    if (context) {
      log(id, "Cerrando contexto");

      await Promise.race([
        context.close(),
        esperar(3000)
      ]);

      log(id, "Contexto cerrado");
      return;
    }

    if (page) {
      await Promise.race([
        page.close(),
        esperar(3000)
      ]);
    }
  } catch (error) {
    log(id, `Error cerrando contexto: ${error.message}`);
  }
}

/*
|--------------------------------------------------------------------------
| BROWSER
|--------------------------------------------------------------------------
*/

async function getBrowser() {
  if (browserGlobal && browserGlobal.isConnected()) {
    return browserGlobal;
  }

  console.log("Arrancando Chromium...");

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
    console.log("Chromium desconectado");
    browserGlobal = null;
  });

  console.log("Chromium preparado");

  return browserGlobal;
}

/*
|--------------------------------------------------------------------------
| CONTEXTO AISLADO
|--------------------------------------------------------------------------
*/

async function crearContextoAislado(browser) {
  if (typeof browser.createBrowserContext === "function") {
    return await browser.createBrowserContext();
  }

  if (typeof browser.createIncognitoBrowserContext === "function") {
    return await browser.createIncognitoBrowserContext();
  }

  throw new Error(
    "La versión de Puppeteer no permite crear un contexto aislado"
  );
}

/*
|--------------------------------------------------------------------------
| COLA
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function cookiesToHeader(cookies) {
  return cookies
    .map(c => `${c.name}=${c.value}`)
    .join("; ");
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

  const match = limpio.match(
    /Valor de Referencia\s*([\d.,]+)/i
  );

  return match ? match[1] : null;
}

/*
|--------------------------------------------------------------------------
| FETCH CON TIMEOUT REAL
|--------------------------------------------------------------------------
*/

async function fetchTextoConTimeout(
  url,
  options = {},
  timeout = 15000
) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    /*
     * También esperamos el body dentro del timeout.
     * No basta con recibir únicamente las cabeceras.
     */
    const texto = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      texto
    };

  } catch (error) {

    if (error.name === "AbortError") {
      throw new Error(
        `Timeout consultando Catastro después de ${timeout / 1000} segundos`
      );
    }

    throw error;

  } finally {
    clearTimeout(timer);
  }
}

/*
|--------------------------------------------------------------------------
| WARMUP
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| VALOR DE REFERENCIA
|--------------------------------------------------------------------------
*/

app.get("/valor-referencia", async (req, res) => {

  return ejecutarEnCola(async () => {

    const id = crearIdConsulta();

    const { refcat } = req.query;

    const ejercicio =
      req.query.ejercicio || "2026";

    let context = null;
    let page = null;

    let paso = "inicio";

    log(
      id,
      `Nueva consulta - RC: ${refcat || "SIN RC"} - ejercicio: ${ejercicio}`
    );

    /*
    |--------------------------------------------------------------------------
    | VALIDACIONES
    |--------------------------------------------------------------------------
    */

    if (!DNI || !SOPORTE) {
      return res.json({
        ok: false,
        error:
          "Faltan variables CATASTRO_DNI o CATASTRO_SOPORTE en Render"
      });
    }

    if (!refcat) {
      return res.json({
        ok: false,
        error: "Falta refcat"
      });
    }

    try {

      /*
      |--------------------------------------------------------------------------
      | 1. BROWSER
      |--------------------------------------------------------------------------
      */

      paso = "obtener_browser";

      log(id, "1. Obteniendo browser");

      const browser = await getBrowser();

      /*
      |--------------------------------------------------------------------------
      | 2. CONTEXTO AISLADO
      |--------------------------------------------------------------------------
      */

      paso = "crear_contexto";

      log(id, "2. Creando contexto aislado");

      context = await crearContextoAislado(browser);

      /*
      |--------------------------------------------------------------------------
      | 3. NUEVA PÁGINA
      |--------------------------------------------------------------------------
      */

      paso = "crear_pagina";

      log(id, "3. Creando página");

      page = await context.newPage();

      page.setDefaultTimeout(15000);
      page.setDefaultNavigationTimeout(20000);

      /*
      |--------------------------------------------------------------------------
      | 4. BLOQUEAR RECURSOS INNECESARIOS
      |--------------------------------------------------------------------------
      */

      await page.setRequestInterception(true);

      page.on("request", request => {

        const type = request.resourceType();

        if (
          ["image", "font", "media"].includes(type)
        ) {
          request.abort().catch(() => {});
        } else {
          request.continue().catch(() => {});
        }
      });

      /*
      |--------------------------------------------------------------------------
      | 5. ABRIR CATastro
      |--------------------------------------------------------------------------
      */

      paso = "abrir_catastro";

      log(id, "4. Abriendo entrada de Catastro");

      const urlEntrada =
        `https://www.sedecatastro.gob.es/Accesos/SECAccvrTC.aspx?destino=3&ejercicio=${encodeURIComponent(ejercicio)}`;

      await page.goto(
        urlEntrada,
        {
          waitUntil: "domcontentloaded",
          timeout: 20000
        }
      );

      log(
        id,
        `5. Página cargada: ${page.url()}`
      );

      /*
      |--------------------------------------------------------------------------
      | 6. ESPERAR FORMULARIO LOGIN
      |--------------------------------------------------------------------------
      */

      paso = "esperar_formulario_login";

      log(id, "6. Esperando formulario DNI");

      await page.waitForSelector(
        "#ctl00_Contenido_nif",
        {
          timeout: 10000
        }
      );

      await page.waitForSelector(
        "#ctl00_Contenido_soporte",
        {
          timeout: 10000
        }
      );

      log(id, "7. Formulario DNI encontrado");

      /*
      |--------------------------------------------------------------------------
      | 7. INTRODUCIR CREDENCIALES
      |--------------------------------------------------------------------------
      */

      paso = "rellenar_login";

      await page.type(
        "#ctl00_Contenido_nif",
        DNI
      );

      await page.type(
        "#ctl00_Contenido_soporte",
        SOPORTE
      );

      log(id, "8. Credenciales introducidas");

      /*
      |--------------------------------------------------------------------------
      | 8. LOGIN
      |--------------------------------------------------------------------------
      */

      paso = "login";

      log(id, "9. Enviando login");

      const resultadoLogin =
        await Promise.allSettled([

          page.waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: 15000
          }),

          page.click(
            "#ctl00_Contenido_bAceptar"
          )
        ]);

      log(
        id,
        `10. Resultado navegación login: ${resultadoLogin[0].status}`
      );

      log(
        id,
        `11. Resultado click login: ${resultadoLogin[1].status}`
      );

      /*
       * Pequeña espera para permitir redirecciones adicionales
       * de Catastro.
       */
      await esperar(1500);

      log(
        id,
        `12. URL después del login: ${page.url()}`
      );

      /*
      |--------------------------------------------------------------------------
      | 9. COMPROBAR LOGIN
      |--------------------------------------------------------------------------
      */

      if (
        !page.url().includes("OVCBusqueda")
      ) {

        paso = "login_no_superado";

        const textoError =
          await page
            .evaluate(
              () => document.body.innerText
            )
            .catch(() => "");

        return res.json({
          ok: false,
          error: "No ha pasado login",
          paso,
          url: page.url(),
          texto: textoError
            .replace(/\s+/g, " ")
            .substring(0, 2000)
        });
      }

      log(id, "13. Login superado correctamente");

      /*
      |--------------------------------------------------------------------------
      | 10. PREPARAR FORMULARIO VALOR REFERENCIA
      |--------------------------------------------------------------------------
      */

      paso = "preparar_formulario_valor";

      const segundaUrl = page.url();

      log(
        id,
        `14. Preparando POST a ${segundaUrl}`
      );

      const formData =
        await page.evaluate(
          (refcat, ejercicio) => {

            const form =
              new URLSearchParams();

            document
              .querySelectorAll("input")
              .forEach(input => {

                if (input.name) {
                  form.set(
                    input.name,
                    input.value || ""
                  );
                }
              });

            document
              .querySelectorAll("select")
              .forEach(select => {

                if (select.name) {
                  form.set(
                    select.name,
                    select.value || ""
                  );
                }
              });

            form.set(
              "__EVENTTARGET",
              ""
            );

            form.set(
              "__EVENTARGUMENT",
              ""
            );

            form.set(
              "ctl00$Contenido$ddlFinalidad",
              "1"
            );

            form.set(
              "ctl00$Contenido$txtFechaConsulta",
              `28/04/${ejercicio}`
            );

            form.set(
              "ctl00$Contenido$txtRC2",
              refcat
            );

            form.set(
              "ctl00$Contenido$btnValorReferencia",
              "VALOR DE REFERENCIA"
            );

            return form.toString();

          },
          refcat,
          ejercicio
        );

      /*
      |--------------------------------------------------------------------------
      | 11. COOKIES
      |--------------------------------------------------------------------------
      */

      paso = "obtener_cookies";

      const cookies =
        await page.cookies();

      const cookieHeader =
        cookiesToHeader(cookies);

      log(
        id,
        `15. Cookies obtenidas: ${cookies.length}`
      );

      /*
      |--------------------------------------------------------------------------
      | 12. POST VALOR DE REFERENCIA
      |--------------------------------------------------------------------------
      */

      paso = "post_valor_referencia";

      log(
        id,
        "16. Enviando POST de valor de referencia"
      );

      const resultado =
        await fetchTextoConTimeout(
          segundaUrl,
          {
            method: "POST",

            redirect: "follow",

            headers: {
              "accept":
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

              "accept-language":
                "es-ES,es;q=0.9",

              "content-type":
                "application/x-www-form-urlencoded",

              "origin":
                "https://www.sedecatastro.gob.es",

              "referer":
                segundaUrl,

              "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",

              "cookie":
                cookieHeader
            },

            body: formData
          },

          /*
           * MUY IMPORTANTE:
           * nunca esperamos indefinidamente a Catastro.
           */
          15000
        );

      log(
        id,
        `17. POST respondido - HTTP ${resultado.status}`
      );

      /*
      |--------------------------------------------------------------------------
      | 13. EXTRAER RESULTADO
      |--------------------------------------------------------------------------
      */

      paso = "extraer_resultado";

      const texto =
        limpiarTexto(resultado.texto);

      const valor =
        extraerValor(texto);

      log(
        id,
        valor
          ? `18. Valor encontrado: ${valor}`
          : "18. No se ha encontrado valor en la respuesta"
      );

      /*
      |--------------------------------------------------------------------------
      | RESULTADO
      |--------------------------------------------------------------------------
      */

      return res.json({
        ok: true,
        ejercicio,
        refcat,
        encontrado: !!valor,
        valor_referencia: valor,
        valor_numero: valor
          ? Number(
              valor
                .replace(/\./g, "")
                .replace(",", ".")
            )
          : null
      });

    } catch (error) {

      log(
        id,
        `ERROR en paso "${paso}": ${error.message}`
      );

      return res.json({
        ok: false,
        error: error.message,
        paso
      });

    } finally {

      await cerrarContextoSeguro(
        context,
        page,
        id
      );

      log(id, "Consulta terminada");
    }
  });
});

/*
|--------------------------------------------------------------------------
| SERVIDOR
|--------------------------------------------------------------------------
*/

const PORT =
  process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(
    "Servidor en puerto " + PORT
  );
});
