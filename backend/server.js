const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const Groq = require("groq-sdk");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const FRONTEND_PATH = path.join(__dirname, "../frontend");
const DATA_PATH = path.join(__dirname, "data");
const MEMORY_FILE = path.join(__dirname, "memory.json");

app.use(express.static(FRONTEND_PATH));

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const mongoClient = new MongoClient(process.env.MONGO_URI);
let db = null;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureFile(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), "utf8");
  }
}

function readJsonFile(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), "utf8");
      return defaultValue;
    }

    const raw = fs.readFileSync(filePath, "utf8");
    return raw ? JSON.parse(raw) : defaultValue;
  } catch (error) {
    return defaultValue;
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function defaultMemory() {
  return {
    name: "",
    goal: "",
    work: "",
    notes: []
  };
}

function loadMemory() {
  return readJsonFile(MEMORY_FILE, defaultMemory());
}

function saveMemory(memory) {
  writeJsonFile(MEMORY_FILE, memory);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Request timeout"));
    })
  ]);
}

async function connectDB() {
  try {
    await mongoClient.connect();
    db = mongoClient.db("belal_ai");
    console.log("MongoDB connected ✅");
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
    db = null;
  }
}

function detectName(message) {
  const lower = message.toLowerCase();

  if (lower.startsWith("amar nam ")) {
    return message.substring(9).trim();
  }

  const match = message.match(/my name is\s+(.+)/i);
  return match ? match[1].trim() : "";
}

function detectGoal(message) {
  const lower = message.toLowerCase();

  if (lower.startsWith("ami ") && lower.includes(" hote chai")) {
    return message.substring(4).trim();
  }

  const match = message.match(/i want to be\s+(.+)/i);
  return match ? match[1].trim() : "";
}

function detectWork(message) {
  const lower = message.toLowerCase();

  if (lower.startsWith("amar kaj ")) {
    return message.substring(9).trim();
  }

  const match = message.match(/i work as\s+(.+)/i);
  return match ? match[1].trim() : "";
}

function detectNote(message) {
  const lower = message.toLowerCase();

  if (lower.startsWith("note rakho ")) {
    return message.substring(11).trim();
  }

  const match = message.match(/save this note[:\-\s]+(.+)/i);
  return match ? match[1].trim() : "";
}

function getCurrentUser(req) {
  return String(req.headers["x-user"] || "").trim();
}

async function saveChat(username, role, text) {
  try {
    if (!db || !username || !text) return;

    await db.collection("chats").insertOne({
      username,
      role,
      text,
      time: new Date()
    });
  } catch (error) {
    console.error("Save chat error:", error.message);
  }
}

function buildMemoryText(memory) {
  return `
User name: ${memory.name || "Not given"}
User goal: ${memory.goal || "Not given"}
User work: ${memory.work || "Not given"}
User notes: ${memory.notes.length ? memory.notes.join(", ") : "No notes"}
`.trim();
}

function replyFromMemoryQuery(memory, lowerMessage) {
  if (lowerMessage === "amar nam ki") {
    return memory.name
      ? `Tomar nam ${memory.name} 😎`
      : "Tumi ekhono tomar nam bolo nai Boss 🙂";
  }

  if (lowerMessage === "ami ki hote chai") {
    return memory.goal
      ? `Tumi ${memory.goal} 😎`
      : "Tumi ekhono tomar goal bolo nai Boss 🙂";
  }

  if (lowerMessage === "amar kaj ki") {
    return memory.work
      ? `Tomar kaj ${memory.work} 👍`
      : "Tumi ekhono tomar kaj bolo nai Boss 🙂";
  }

  if (lowerMessage === "show notes") {
    return memory.notes.length
      ? `Tomar notes:\n- ${memory.notes.join("\n- ")}`
      : "Kono note nai Boss 🙂";
  }

  return "";
}

function trySaveMemoryFromMessage(memory, message) {
  const name = detectName(message);
  const goal = detectGoal(message);
  const work = detectWork(message);
  const note = detectNote(message);

  let savedSomething = false;

  if (name) {
    memory.name = name;
    savedSomething = true;
  }

  if (goal) {
    memory.goal = goal;
    savedSomething = true;
  }

  if (work) {
    memory.work = work;
    savedSomething = true;
  }

  if (note) {
    memory.notes.push(note);
    savedSomething = true;
  }

  if (!savedSomething) {
    return { saved: false, reply: "" };
  }

  saveMemory(memory);

  let reply = "Memory save kora hoise ✅";

  if (name && !goal && !work && !note) {
    reply = `Thik ase Boss 😎 Ami mone rakhsi, tomar nam ${memory.name}.`;
  } else if (goal && !name && !work && !note) {
    reply = `Boss, ami mone rakhsi 😎 Tumi ${memory.goal}.`;
  } else if (work && !name && !goal && !note) {
    reply = `Thik ase Boss 👍 Ami mone rakhsi, tomar kaj ${memory.work}.`;
  } else if (note && !name && !goal && !work) {
    reply = "Note save kora hoise ✅";
  }

  return { saved: true, reply };
}

/* ---------- IMPORTANT ROUTES ---------- */

app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, "index.html"));
});

app.get("/api", (req, res) => {
  res.json({
    success: true,
    message: "Belal AI API running 🚀"
  });
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, "login.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, "dashboard.html"));
});

app.get("/notes", (req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, "notes.html"));
});

app.get("/tasks", (req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, "tasks.html"));
});

/* ---------- AUTH ---------- */

app.post("/register", async (req, res) => {
  try {
    if (!db) {
      return res.json({
        success: false,
        message: "Database connect hoy nai ❌"
      });
    }

    const { username, password } = req.body;

    if (!username || !password) {
      return res.json({
        success: false,
        message: "Username ar password dorkar ❌"
      });
    }

    const cleanedUsername = String(username).trim().toLowerCase();

    const existingUser = await db.collection("users").findOne({
      username: cleanedUsername
    });

    if (existingUser) {
      return res.json({
        success: false,
        message: "Ei username age thekei ase ❌"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.collection("users").insertOne({
      username: cleanedUsername,
      password: hashedPassword,
      createdAt: new Date()
    });

    return res.json({
      success: true,
      message: "Register success ✅"
    });
  } catch (error) {
    console.error("Register error:", error);
    return res.json({
      success: false,
      message: "Register e problem hoise ❌"
    });
  }
});

app.post("/login", async (req, res) => {
  try {
    if (!db) {
      return res.json({
        success: false,
        message: "Database connect hoy nai ❌"
      });
    }

    const { username, password } = req.body;

    if (!username || !password) {
      return res.json({
        success: false,
        message: "Username ar password dorkar ❌"
      });
    }

    const cleanedUsername = String(username).trim().toLowerCase();

    const user = await db.collection("users").findOne({
      username: cleanedUsername
    });

    if (!user) {
      return res.json({
        success: false,
        message: "User paoa jai nai ❌"
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.json({
        success: false,
        message: "Password vul ❌"
      });
    }

    return res.json({
      success: true,
      message: "Login success ✅",
      username: user.username
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.json({
      success: false,
      message: "Login e problem hoise ❌"
    });
  }
});

/* ---------- CHAT HISTORY ---------- */

app.get("/history", async (req, res) => {
  try {
    const username = getCurrentUser(req);

    if (!db || !username) {
      return res.json([]);
    }

    const data = await db
      .collection("chats")
      .find({ username })
      .sort({ time: 1 })
      .limit(300)
      .toArray();

    return res.json(
      data.map((item) => ({
        role: item.role,
        text: item.text,
        time: item.time
      }))
    );
  } catch (error) {
    console.error("History load error:", error);
    return res.json([]);
  }
});

app.delete("/clear-history", async (req, res) => {
  try {
    const username = getCurrentUser(req);

    if (db && username) {
      await db.collection("chats").deleteMany({ username });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Clear history error:", error);
    return res.json({ success: false });
  }
});

/* ---------- CHAT ---------- */

app.post("/chat", async (req, res) => {
  try {
    const username = getCurrentUser(req);
    const message = String(req.body.message || "").trim();
    const lower = message.toLowerCase();
    const memory = loadMemory();

    if (!message) {
      return res.json({ reply: "Kisu likho boss 🙂" });
    }

    const memoryReply = replyFromMemoryQuery(memory, lower);

    if (memoryReply) {
      await saveChat(username, "user", message);
      await saveChat(username, "ai", memoryReply);
      return res.json({ reply: memoryReply });
    }

    const memorySaveResult = trySaveMemoryFromMessage(memory, message);

    if (memorySaveResult.saved) {
      await saveChat(username, "user", message);
      await saveChat(username, "ai", memorySaveResult.reply);
      return res.json({ reply: memorySaveResult.reply });
    }

    const memoryText = buildMemoryText(memory);

    const completion = await withTimeout(
      groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: `You are BELAL AI.
Reply in a natural Bangla-English mix.
Be smart, friendly, helpful, confident, and practical.
Keep answers clear.
If the user asks something personal, use saved memory when relevant.

Saved User Memory:
${memoryText}`
          },
          {
            role: "user",
            content: message
          }
        ],
        temperature: 0.7,
        max_tokens: 1024
      }),
      15000
    );

    const reply =
      completion?.choices?.[0]?.message?.content ||
      "Boss, ekhon kono reply ashtese na 😥";

    await saveChat(username, "user", message);
    await saveChat(username, "ai", reply);

    return res.json({ reply });
  } catch (error) {
    console.error("Chat error:", error);
    return res.json({
      reply: "Server e ektu problem hoise Boss 😥 abar try koro."
    });
  }
});

/* ---------- 404 ---------- */

app.use((req, res) => {
  res.status(404).send("Page not found ❌");
});

/* ---------- BOOT ---------- */

async function bootServer() {
  ensureDir(DATA_PATH);
  ensureFile(MEMORY_FILE, defaultMemory());

  await connectDB();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} 🚀`);
  });
}

bootServer();