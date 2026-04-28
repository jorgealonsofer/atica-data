const express = require('express');
const puppeteer = require('puppeteer');

const app = express();

app.get('/', (req, res) => {
  res.send('API funcionando');
});

app.get('/valor', async (req, res) => {
  const { ref, ejercicio } = req.query;

  if (!ref) {
    return res.json({ error: 'Falta referencia catastral' });
  }

  try {
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // 1. Ir a login
    await page.goto(`https://www.sedecatastro.gob.es/Accesos/SECAccDNI.aspx?Dest=3&ejercicio=${ejercicio || '2026'}`, {
      waitUntil: 'networkidle2'
    });

    // 2. Rellenar login
    await page.type('#ctl00_Contenido_IdNIF', process.env.DNI);
    await page.type('#ctl00_Contenido_soporte', process.env.SOPORTE);

    await Promise.all([
      page.click('#ctl00_Contenido_btnValidar'),
      page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);

    // 3. Rellenar formulario
    await page.select('#ctl00_Contenido_ddlFinalidad', '1'); // efectos informativos

    await page.type('#ctl00_Contenido_txtFecha', '01/01/2026');

    await page.type('#ctl00_Contenido_txtReferencia', ref);

    await Promise.all([
      page.click('#ctl00_Contenido_btnConsultar'),
      page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);

    // 4. Extraer valor
    const valor = await page.evaluate(() => {
      const text = document.body.innerText;
      const match = text.match(/Valor de Referencia\s*([\d.,]+)\s*€/i);
      return match ? match[1] : null;
    });

    await browser.close();

    res.json({ valor });

  } catch (error) {
    res.json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('Servidor iniciado en puerto ' + PORT);
});
