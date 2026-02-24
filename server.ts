
import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import cors from "cors";

const DATA_FILE = path.join(process.cwd(), "data.json");

// Initialize data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    users: [],
    loans: [],
    notifications: [],
    budget: 30000000,
    rankProfit: 0
  }, null, 2));
}

function readData() {
  try {
    const data = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    return {
      users: [],
      loans: [],
      notifications: [],
      budget: 30000000,
      rankProfit: 0
    };
  }
}

function writeData(data: any) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  console.log(`Starting server in ${process.env.NODE_ENV || 'development'} mode`);

  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Health check
  app.get("/health", (req, res) => {
    res.send("OK");
  });

  // API Routes
  app.get("/api/data", (req, res) => {
    try {
      const data = readData();
      res.json(data);
    } catch (e) {
      console.error("Lỗi trong /api/data:", e);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  app.post("/api/users/sync", (req, res) => {
    const data = readData();
    const user = req.body;
    
    const index = data.users.findIndex((u: any) => u.id === user.id);
    if (index !== -1) {
      data.users[index] = { ...data.users[index], ...user };
    } else {
      data.users.push(user);
    }
    
    writeData(data);
    res.json({ success: true });
  });

  app.post("/api/loans/sync", (req, res) => {
    const data = readData();
    const loan = req.body;
    
    const index = data.loans.findIndex((l: any) => l.id === loan.id);
    if (index !== -1) {
      data.loans[index] = { ...data.loans[index], ...loan };
    } else {
      data.loans.push(loan);
    }
    
    writeData(data);
    res.json({ success: true });
  });

  app.post("/api/users", (req, res) => {
    const data = readData();
    const incomingUsers = req.body;
    
    // Merge users by ID and updatedAt
    const userMap = new Map(data.users.map((u: any) => [u.id, u]));
    incomingUsers.forEach((u: any) => {
      const existing = userMap.get(u.id) as any;
      if (!existing || (u.updatedAt && (!existing.updatedAt || u.updatedAt > existing.updatedAt))) {
        userMap.set(u.id, u);
      }
    });
    
    // Enforce unique phone numbers (keep the most recently updated one)
    const mergedUsers = Array.from(userMap.values());
    mergedUsers.sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0));
    
    const uniqueUsers: any[] = [];
    const seenPhones = new Set();
    
    for (const u of mergedUsers) {
      const user = u as any;
      if (!user.phone || !seenPhones.has(user.phone)) {
        if (user.phone) seenPhones.add(user.phone);
        uniqueUsers.push(user);
      }
    }
    
    data.users = uniqueUsers;
    writeData(data);
    res.json({ success: true, count: data.users.length });
  });

  app.post("/api/loans", (req, res) => {
    const data = readData();
    const incomingLoans = req.body;
    
    // Merge loans by ID and updatedAt
    const loanMap = new Map(data.loans.map((l: any) => [l.id, l]));
    incomingLoans.forEach((l: any) => {
      const existing = loanMap.get(l.id) as any;
      if (!existing || (l.updatedAt && (!existing.updatedAt || l.updatedAt > existing.updatedAt))) {
        loanMap.set(l.id, l);
      }
    });
    
    data.loans = Array.from(loanMap.values());
    writeData(data);
    res.json({ success: true, count: data.loans.length });
  });

  app.post("/api/notifications", (req, res) => {
    const data = readData();
    const incomingNotifs = req.body;
    
    // Merge notifications by ID
    const notifMap = new Map(data.notifications.map((n: any) => [n.id, n]));
    incomingNotifs.forEach((n: any) => {
      notifMap.set(n.id, n);
    });
    
    data.notifications = Array.from(notifMap.values())
      .sort((a: any, b: any) => b.id.localeCompare(a.id))
      .slice(0, 200); // Keep more notifications in full-stack
      
    writeData(data);
    res.json({ success: true });
  });

  app.post("/api/budget", (req, res) => {
    const data = readData();
    data.budget = req.body.budget;
    writeData(data);
    res.json({ success: true });
  });

  app.post("/api/rankProfit", (req, res) => {
    const data = readData();
    data.rankProfit = req.body.rankProfit;
    writeData(data);
    res.json({ success: true });
  });

  app.delete("/api/users/:id", (req, res) => {
    const data = readData();
    const userId = req.params.id;
    data.users = data.users.filter((u: any) => u.id !== userId);
    data.loans = data.loans.filter((l: any) => l.userId !== userId);
    data.notifications = data.notifications.filter((n: any) => n.userId !== userId);
    writeData(data);
    res.json({ success: true });
  });

  // Vite middleware for development
  const distPath = path.join(process.cwd(), "dist");
  const useVite = process.env.NODE_ENV !== "production" || !fs.existsSync(distPath);

  if (useVite) {
    console.log("Using Vite middleware");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Serving static files from dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
