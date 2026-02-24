
import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";
import { MongoClient, Db } from "mongodb";

const DATA_FILE = path.join(process.cwd(), "data.json");
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = "ndv_money";

let db: Db | null = null;
let connectionError: string | null = null;

async function connectToDatabase() {
  if (db) return db;
  if (MONGODB_URI) {
    if (MONGODB_URI.includes("ndv126")) {
      connectionError = "You are using an OLD MongoDB URI (ndv126). Please update MONGODB_URI on Vercel to use 'ndv26'.";
      console.error(connectionError);
      return null;
    }
    try {
      console.log("Attempting to connect to MongoDB...");
      const client = new MongoClient(MONGODB_URI, {
        connectTimeoutMS: 10000,
        serverSelectionTimeoutMS: 10000,
      });
      await client.connect();
      db = client.db(DB_NAME);
      connectionError = null;
      console.log("Successfully connected to MongoDB Atlas");
      return db;
    } catch (e: any) {
      connectionError = e.message;
      console.error("CRITICAL: Failed to connect to MongoDB:", e);
      console.log("Falling back to local file storage (Note: This will not persist on Vercel)");
      return null;
    }
  } else {
    connectionError = "MONGODB_URI environment variable is missing";
    console.warn(connectionError);
    return null;
  }
}

async function readData() {
  try {
    const database = await connectToDatabase();
    if (database) {
      const users = await database.collection("users").find({}).toArray();
      const loans = await database.collection("loans").find({}).toArray();
      const notifications = await database.collection("notifications").find({}).sort({ id: -1 }).limit(200).toArray();
      const system = await database.collection("system").findOne({ id: "config" });
      
      return {
        users,
        loans,
        notifications,
        budget: system?.budget ?? 30000000,
        rankProfit: system?.rankProfit ?? 0
      };
    }
  } catch (e: any) {
    console.error("MongoDB Query Error, falling back to local:", e);
    connectionError = `Query Error: ${e.message}`;
  }

  try {
    if (!fs.existsSync(DATA_FILE)) {
      const initialData = {
        users: [],
        loans: [],
        notifications: [],
        budget: 30000000,
        rankProfit: 0
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
      return initialData;
    }
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

async function writeData(data: any) {
  if (db) {
    // In MongoDB mode, we usually update specific items, 
    // but for compatibility with existing logic that sends full arrays, 
    // we'll handle it in the routes.
    return;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function startServer() {
  await connectToDatabase();
  
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
  app.get("/api/status", (req, res) => {
    // Mask the URI for security but show enough to identify it
    const maskedUri = MONGODB_URI 
      ? MONGODB_URI.replace(/\/\/.*@/, "//****:****@").split('?')[0] 
      : "Not set";

    res.json({
      database: db ? "MongoDB Atlas (Connected)" : "Local File (Non-persistent)",
      current_uri_preview: maskedUri,
      error: connectionError,
      env: process.env.NODE_ENV || "development",
      mongodb_uri_set: !!MONGODB_URI,
      tip: !db ? "Check if MONGODB_URI is set in Vercel and IP 0.0.0.0/0 is whitelisted in Atlas. Ensure you are not using an old URI." : null
    });
  });

  app.get("/api/data", async (req, res) => {
    try {
      const data = await readData();
      res.json(data);
    } catch (e) {
      console.error("Lỗi trong /api/data:", e);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  app.post("/api/users/sync", async (req, res) => {
    const user = { ...req.body };
    delete user._id; // Remove MongoDB internal ID if present
    
    const database = await connectToDatabase();
    if (database) {
      await database.collection("users").updateOne({ id: user.id }, { $set: user }, { upsert: true });
    } else {
      const data = await readData();
      const index = data.users.findIndex((u: any) => u.id === user.id);
      if (index !== -1) {
        data.users[index] = { ...data.users[index], ...user };
      } else {
        data.users.push(user);
      }
      await writeData(data);
    }
    res.json({ success: true });
  });

  app.post("/api/loans/sync", async (req, res) => {
    const loan = { ...req.body };
    delete loan._id;
    
    const database = await connectToDatabase();
    if (database) {
      await database.collection("loans").updateOne({ id: loan.id }, { $set: loan }, { upsert: true });
    } else {
      const data = await readData();
      const index = data.loans.findIndex((l: any) => l.id === loan.id);
      if (index !== -1) {
        data.loans[index] = { ...data.loans[index], ...loan };
      } else {
        data.loans.push(loan);
      }
      await writeData(data);
    }
    res.json({ success: true });
  });

  app.post("/api/notifications/sync", async (req, res) => {
    const notif = { ...req.body };
    delete notif._id;
    
    const database = await connectToDatabase();
    if (database) {
      await database.collection("notifications").updateOne({ id: notif.id }, { $set: notif }, { upsert: true });
    } else {
      const data = await readData();
      const index = data.notifications.findIndex((n: any) => n.id === notif.id);
      if (index === -1) {
        data.notifications.unshift(notif);
        data.notifications = data.notifications.slice(0, 200);
      }
      await writeData(data);
    }
    res.json({ success: true });
  });

  app.post("/api/users", async (req, res) => {
    const incomingUsers = req.body;
    const database = await connectToDatabase();
    if (database) {
      for (const u of incomingUsers) {
        await database.collection("users").updateOne({ id: u.id }, { $set: u }, { upsert: true });
      }
    } else {
      const data = await readData();
      const userMap = new Map(data.users.map((u: any) => [u.id, u]));
      incomingUsers.forEach((u: any) => {
        const existing = userMap.get(u.id) as any;
        if (!existing || (u.updatedAt && (!existing.updatedAt || u.updatedAt > existing.updatedAt))) {
          userMap.set(u.id, u);
        }
      });
      data.users = Array.from(userMap.values());
      await writeData(data);
    }
    res.json({ success: true });
  });

  app.post("/api/loans", async (req, res) => {
    const incomingLoans = req.body;
    const database = await connectToDatabase();
    if (database) {
      for (const l of incomingLoans) {
        await database.collection("loans").updateOne({ id: l.id }, { $set: l }, { upsert: true });
      }
    } else {
      const data = await readData();
      const loanMap = new Map(data.loans.map((l: any) => [l.id, l]));
      incomingLoans.forEach((l: any) => {
        const existing = loanMap.get(l.id) as any;
        if (!existing || (l.updatedAt && (!existing.updatedAt || l.updatedAt > existing.updatedAt))) {
          loanMap.set(l.id, l);
        }
      });
      data.loans = Array.from(loanMap.values());
      await writeData(data);
    }
    res.json({ success: true });
  });

  app.post("/api/notifications", async (req, res) => {
    const incomingNotifs = req.body;
    const database = await connectToDatabase();
    if (database) {
      for (const n of incomingNotifs) {
        await database.collection("notifications").updateOne({ id: n.id }, { $set: n }, { upsert: true });
      }
    } else {
      const data = await readData();
      const notifMap = new Map(data.notifications.map((n: any) => [n.id, n]));
      incomingNotifs.forEach((n: any) => {
        notifMap.set(n.id, n);
      });
      data.notifications = Array.from(notifMap.values())
        .sort((a: any, b: any) => b.id.localeCompare(a.id))
        .slice(0, 200);
      await writeData(data);
    }
    res.json({ success: true });
  });

  app.post("/api/budget", async (req, res) => {
    const { budget } = req.body;
    const database = await connectToDatabase();
    if (database) {
      await database.collection("system").updateOne({ id: "config" }, { $set: { budget } }, { upsert: true });
    } else {
      const data = await readData();
      data.budget = budget;
      await writeData(data);
    }
    res.json({ success: true });
  });

  app.post("/api/rankProfit", async (req, res) => {
    const { rankProfit } = req.body;
    const database = await connectToDatabase();
    if (database) {
      await database.collection("system").updateOne({ id: "config" }, { $set: { rankProfit } }, { upsert: true });
    } else {
      const data = await readData();
      data.rankProfit = rankProfit;
      await writeData(data);
    }
    res.json({ success: true });
  });

  app.delete("/api/users/:id", async (req, res) => {
    const userId = req.params.id;
    const database = await connectToDatabase();
    if (database) {
      await database.collection("users").deleteOne({ id: userId });
      await database.collection("loans").deleteMany({ userId: userId });
      await database.collection("notifications").deleteMany({ userId: userId });
    } else {
      const data = await readData();
      data.users = data.users.filter((u: any) => u.id !== userId);
      data.loans = data.loans.filter((l: any) => l.userId !== userId);
      data.notifications = data.notifications.filter((n: any) => n.userId !== userId);
      await writeData(data);
    }
    res.json({ success: true });
  });

  // Vite middleware for development
  const distPath = path.join(process.cwd(), "dist");
  const useVite = process.env.NODE_ENV !== "production" || !fs.existsSync(distPath);

  if (useVite) {
    console.log("Using Vite middleware");
    const { createServer: createViteServer } = await import("vite");
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

  return app;
}

const appPromise = startServer();

export default async (req: any, res: any) => {
  const app = await appPromise;
  return app(req, res);
};
