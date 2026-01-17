// server.js
const express = require("express");
const puppeteerExtra = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const app = express();
const PORT = process.env.PORT || 3500;



// ⭐ MPORTANT: Set CORS headers BEFORE other middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Private-Network', 'true'); // ⭐ KEY for localhost
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json());

puppeteerExtra.use(StealthPlugin());
const log = (...args) => console.log(new Date().toISOString(), ...args);

app.get("/health", (req, res) => {
  res.json({ status: "ok", server: "Rabit, a product of Edmondie.com",  timestamp: new Date().toISOString() });
});

app.post("/scrape", async (req, res) => {
  // Set SSE headers (these override previous headers for this route)
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Private-Network": "true", // ⭐ Also set here for SSE
  });
  res.flushHeaders();

  const sendEvent = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const startTime = Date.now();

  let { country, degree, fields, range } = req.body;

  const startPage = Array.isArray(range) && range[0] > 0 ? range[0] : 1;
  const endPage = Array.isArray(range) && range[1] > 0 ? range[1] : Infinity;

  log("Request payload:", { country, degree, fields });
  sendEvent("progress", {
    message: `Scraping ${degree} programs in ${country}...`,
  });

  try {
    // ——— Validate inputs ———
    if (!country || !degree) throw new Error("country and degree are required");
    if (!Array.isArray(fields) || fields.length === 0) {
      sendEvent("progress", { message: `No valid fields requested` });
      throw new Error("fields must be a non-empty array");
    }
    const portalMap = { msc: "master", bsc: "bachelor", phd: "phd" };
    const portal = portalMap[degree.toLowerCase()];
    if (!portal) throw new Error(`unsupported degree: ${degree}`);

    const allowed = new Set([
      "id",
      "programName",
      "university",
      "city_country",
      "studyPortalsLink",
      "degreeLevel",
      "studyMode",
      "tuitionFee",
      "duration",
    ]);
    fields = fields.filter((f) => allowed.has(f));
    if (fields.length === 0) throw new Error("no valid fields requested");

    // All data comes from cards - no detail page needed
    const needDetail = false;

    const customUA =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36";

    // Geolocation settings (optional - uncomment to use)
    // You can set this based on the country parameter
    const geolocations = {
      germany: { latitude: 52.52, longitude: 13.405, accuracy: 100 },
      usa: { latitude: 40.7128, longitude: -74.006, accuracy: 100 },
      uk: { latitude: 51.5074, longitude: -0.1278, accuracy: 100 },
      canada: { latitude: 45.4215, longitude: -75.6972, accuracy: 100 },
    };
    Browserlocation = "usa";
    const geolocation = geolocations[Browserlocation.toLowerCase()];

    const results = [];
    let pageIndex = startPage;
    const cardSelector = "a.SearchStudyCard";

    // ——— Pagination loop ———
    while (pageIndex <= endPage) {
      // 1) LIST PAGE: fresh browser → scrape → close
      const listBrowser = await puppeteerExtra.launch({
        headless: true,
        args: ["--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage", 
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          "--mute-audio"],
      });
      const page = await listBrowser.newPage();
      await page.setUserAgent(customUA);
      await page.setDefaultNavigationTimeout(60000);

      // Set geolocation if available
      if (geolocation) {
        const context = listBrowser.defaultBrowserContext();
        await context.overridePermissions("https://www.masterportal.com", [
          "geolocation",
        ]);
        await context.overridePermissions("https://www.bachelorportal.com", [
          "geolocation",
        ]);
        await context.overridePermissions("https://www.phdportal.com", [
          "geolocation",
        ]);
        await page.setGeolocation(geolocation);
      }

      // Set timezone and locale based on country
      if (country.toLowerCase() === "germany") {
        await page.emulateTimezone("Europe/Berlin");
        await page.setExtraHTTPHeaders({ "Accept-Language": "de-DE,de;q=0.9" });
      } else if (country.toLowerCase() === "usa") {
        await page.emulateTimezone("America/New_York");
        await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
      } else if (country.toLowerCase() === "uk") {
        await page.emulateTimezone("Europe/London");
        await page.setExtraHTTPHeaders({ "Accept-Language": "en-GB,en;q=0.9" });
      }

      const listUrl = `https://www.${portal}sportal.com/search/${portal}/${encodeURIComponent(
        country.toLowerCase()
      )}?page=${pageIndex}`;
      log("Loading list page:", listUrl);
      sendEvent("progress", { message: `Loading page ${listUrl}` });

      // retry wrapper for detached‐frame
      try {
        await page.goto(listUrl, { waitUntil: "networkidle2" });
      } catch (err) {
        if (err.message.includes("detached")) {
          log("Frame detached on list‐page goto, retrying…");
          await page.goto(listUrl, { waitUntil: "networkidle2" });
        } else {
          throw err;
        }
      }

      // check if any cards exist
      let exists = await page.$(cardSelector);
      if (!exists) {
        log("No cards found on page", pageIndex, "-- retrying once");
        await page.reload({ waitUntil: "networkidle2" });
        exists = await page.$(cardSelector);
      }
      if (!exists) {
        log("No cards again on page", pageIndex);
        sendEvent("warning", {
          message: `No more cards found on page ${pageIndex}`,
        });
        await page.close();
        await listBrowser.close();
        break;
      }

      // extract all cards with all available data
      const cards = await page.$$eval(cardSelector, (els) =>
        els.map((a) => {
          // Get program name
          const programName = a.querySelector("h2.StudyName")?.innerText.trim() || null;
          
          // Get university
          const university = a.querySelector(".OrganisationName")?.innerText.trim() || null;
          
          // Get city & country
          const city_country = a.querySelector(".OrganisationLocation")?.innerText.trim() || null;
          
          // Get degree level and study mode from SecondaryFacts (e.g., "M.B.A. / Part-time / Online")
          const secondaryFacts = a.querySelector(".SecondaryFacts")?.innerText.trim() || null;
          let degreeLevel = null;
          let studyMode = null;
          
          if (secondaryFacts) {
            const parts = secondaryFacts.split('/').map(p => p.trim());
            degreeLevel = parts[0] || null; // First part is degree level
            studyMode = parts.length > 1 ? parts.slice(1).join(' / ') : null; // Rest is study mode
          }
          
          // Get tuition fee (look for price/fee info on card)
          const tuitionFee =
            a.querySelector(".TuitionValue, .Fee, .Price, .Tuition")?.innerText.trim() || null;

          // Get duration
          const duration =
            a.querySelector(".DurationValue, .Duration")?.innerText.trim() || null;
          
          return {
            href: a.href,
            programName,
            university,
            city_country,
            degreeLevel,
            studyMode,
            tuitionFee,
            duration,
          };
        })
      );

      log(`Found ${cards.length} cards on page ${pageIndex}`);
      sendEvent("progress", {
        message: `Found ${cards.length} programs on page ${pageIndex}`,
      });

      await page.close();
      await listBrowser.close();

      // Process cards - no detail page scraping needed
      for (const card of cards) {
        const entry = { country };
        if (fields.includes("id")) {
          const m = card.href.match(/studies\/(\d+)/);
          entry.id = m ? m[1] : null;
        }
        if (fields.includes("programName"))
          entry.programName = card.programName;
        if (fields.includes("university")) 
          entry.university = card.university;
        if (fields.includes("city_country"))
          entry.city_country = card.city_country;
        if (fields.includes("studyPortalsLink"))
          entry.studyPortalsLink = card.href;
        if (fields.includes("degreeLevel"))
          entry.degreeLevel = card.degreeLevel;
        if (fields.includes("studyMode"))
          entry.studyMode = card.studyMode;
        if (fields.includes("tuitionFee"))
          entry.tuitionFee = card.tuitionFee;
        if (fields.includes("duration"))
          entry.duration = card.duration;

        results.push(entry);
        log("Scraped entry:", entry);
        sendEvent("entry", { entry });
      }

      pageIndex++;
      // if we hit the  endPage, stop here
      if (pageIndex > endPage) break;
    }

    const took = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Scraping complete: ${results.length} items in ${took}`);
    sendEvent("done", { count: results.length, results, took });
    res.end();
  } catch (err) {
    log("Error in /scrape:", err.message);
    sendEvent("error", { message: err.message });
    res.end();
  }
});

app.listen(PORT, () => log(`Server listening on port ${PORT}`));
