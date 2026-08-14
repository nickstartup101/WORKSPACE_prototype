import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.get("/api/loyverse/*", (req, res, next) => {
    console.log(`[Server] Debug: Hit Loyverse API route: ${req.url}`);
    next();
  });

  // Loyverse API Proxy (DISABLED for now as requested)
  app.get("/api/loyverse/daily-sales/:date", (req, res) => {
    const { date } = req.params;
    res.json({
      date,
      totalAmount: 0,
      receiptCount: 0,
      categories: {},
      status: "disabled"
    });
  });

  // Google Sheets Proxy - Raw Movements
  app.get("/api/sheets/stock-data/:sheetId", async (req, res) => {
    const { sheetId } = req.params;
    const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: "GOOGLE_SHEETS_API_KEY not configured" });
    }

    try {
      const range = "'DAILY INVENTORY MOVEMENT'!A:E";
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;
      const response = await axios.get(url);
      res.json(response.data);
    } catch (error: any) {
      const gError = error.response?.data?.error;
      res.status(error.response?.status || 500).json({ 
        error: "Google Sheets API Error", 
        message: gError?.message || error.message,
        details: gError
      });
    }
  });

  // Google Sheets Proxy - Main Inventory
  app.get("/api/sheets/inventory/:sheetId", async (req, res) => {
    const { sheetId } = req.params;
    const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: "GOOGLE_SHEETS_API_KEY not configured" });
    }

    try {
      // Columns: Name, In, Out, Current, Min Stock, Status, Category
      const range = "'MAIN INVENTORY'!A:G";
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;
      const response = await axios.get(url);
      res.json(response.data);
    } catch (error: any) {
      const gError = error.response?.data?.error;
      res.status(error.response?.status || 500).json({ 
        error: "Google Sheets API Error", 
        message: gError?.message || error.message,
        details: gError
      });
    }
  });

  // Helper to fetch sheets data with robust sequenced fallback sheet names and full column scope
  const fetchSheetDataWithFallbacks = async (sheetId: string, apiKey: string, tabNames: string[], defaultRange: string = "A:O") => {
    let lastError: any = null;
    
    // First, let's try calling the spreadsheet metadata to get the actual sheets/tabs that exist.
    // This avoids throwing actual API errors/warnings when trying sheets that don't exist in sequence.
    let availableTabs: string[] = [];
    try {
      const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${apiKey}&fields=sheets.properties.title`;
      const metaResponse = await axios.get(metaUrl);
      if (metaResponse.data && Array.isArray(metaResponse.data.sheets)) {
        availableTabs = metaResponse.data.sheets.map((s: any) => s.properties?.title).filter(Boolean);
      }
    } catch (metaErr) {
      console.warn("[Server] Failed to fetch spreadsheet metadata, relying on fallbacks if needed.", metaErr);
    }

    // Determine the sequence to try
    let tabsToTry = tabNames;
    if (availableTabs.length > 0) {
      // Find which of our fallback tabNames is actually present in the sheet
      const matchingTabs = tabNames.filter(tab => availableTabs.includes(tab));
      if (matchingTabs.length > 0) {
        tabsToTry = matchingTabs;
      }
    }

    for (let i = 0; i < tabsToTry.length; i++) {
      const tab = tabsToTry[i];
      try {
        const range = `'${tab}'!${defaultRange}`;
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;
        const response = await axios.get(url);
        if (response.data) {
          if (!response.data.values) {
            response.data.values = [];
          }
          console.log(`[Server] Automatically selected and successfully pulled tab "${tab}" from Google Sheets.`);
          return response.data;
        }
      } catch (err: any) {
        lastError = err;
        const nextTab = tabsToTry[i + 1];
        if (nextTab) {
          console.log(`[Server] Tried tab "${tab}" but failed/not found, trying next: "${nextTab}"...`);
        } else {
          console.log(`[Server] Tab "${tab}" request failed: ${err.message || err}`);
        }
      }
    }
    throw lastError || new Error(`Tabs not found: ${tabNames.join(", ")}`);
  };

  // Google Sheets Proxy - HR Employees
  app.get("/api/sheets/hr-employees/:sheetId", async (req, res) => {
    const { sheetId } = req.params;
    const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: "GOOGLE_SHEETS_API_KEY not configured" });
    }

    try {
      const data = await fetchSheetDataWithFallbacks(sheetId, apiKey, ["HR_EMPLOYEES", "ຂໍ້ມູນພະນັກງານ", "ພະນັກງານ"]);
      return res.json(data);
    } catch (error: any) {
      const gError = error.response?.data?.error;
      return res.status(error.response?.status || 500).json({ 
        error: "Google Sheets API Error", 
        message: gError?.message || error.message,
        details: gError
      });
    }
  });

  // Google Sheets Proxy - HR Attendance
  app.get("/api/sheets/hr-attendance/:sheetId", async (req, res) => {
    const { sheetId } = req.params;
    const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: "GOOGLE_SHEETS_API_KEY not configured" });
    }

    try {
      const data = await fetchSheetDataWithFallbacks(sheetId, apiKey, ["HR_ATTENDANCE", "ການເຂົ້າວຽກ", "ການເຂົ້າ-ອອກວຽກ"]);
      return res.json(data);
    } catch (error: any) {
      const gError = error.response?.data?.error;
      return res.status(error.response?.status || 500).json({ 
        error: "Google Sheets API Error", 
        message: gError?.message || error.message,
        details: gError
      });
    }
  });

  // Google Sheets Proxy - HR Efforts / Productivity
  app.get("/api/sheets/hr-efforts/:sheetId", async (req, res) => {
    const { sheetId } = req.params;
    const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: "GOOGLE_SHEETS_API_KEY not configured" });
    }

    try {
      const data = await fetchSheetDataWithFallbacks(sheetId, apiKey, ["HR_EFFORTS", "ຄວາມພະຍາຍາມ"]);
      return res.json(data);
    } catch (error: any) {
      const gError = error.response?.data?.error;
      return res.status(error.response?.status || 500).json({ 
        error: "Google Sheets API Error", 
        message: gError?.message || error.message,
        details: gError
      });
    }
  });

  // Admin Pin Check
  app.post("/api/admin/verify", (req, res) => {
    const { pin } = req.body;
    if (pin === process.env.ADMIN_PIN) {
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, error: "Invalid PIN" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
