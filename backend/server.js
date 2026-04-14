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
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const mongoClient = new MongoClient(process.env.MONGO_URI);

let db = null;

const memoryFile = path.join(__dirname, "memory.json");

function defaultMemory() {
  return {
    name: "",
    goal: "",
    work: "",
    notes: []
  };
}

function loadMemory() {
  try {
    const raw = fs.readFileSync(memoryFile, "utf8");
    const parsed = JSON.parse(raw);
    return {
      name: parsed.name || "",
      goal: parsed.goal || "",
      work: parsed.work || "",
      notes: Array.isArray(parsed.notes) ? parsed.notes : []
    };
  } catch (error) {
    return defaultMemory();
  }
}

function saveMemory(memory) {
  fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2), "utf8");
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timeout")), ms)
    )
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

  const myNameMatch = message.match(/my name is\s+(.+)/i);
  if (myNameMatch) return myNameMatch[1].trim();

  return "";
}

function detectGoal(message) {
  const lower = message.toLowerCase();

  if (lower.startsWith("ami ") && lower.includes(" hote chai")) {
    return message.substring(4).trim();
  }

  const wantMatch = message.match(/i want to be\s+(.+)/i);
  if (wantMatch) return wantMatch[1].trim();

  return "";
}

function detectWork(message) {
  const lower = message.toLowerCase();

  if (lower.startsWith("amar kaj ")) {
    return message.substring(9).trim();
  }

  const workMatch = message.match(/i work as\s+(.+)/i);
  if (workMatch) return workMatch[1].trim();

  return "";
}

function detectNote(message) {
  const lower = message.toLowerCase();

  if (lower.startsWith("note rakho ")) {
    return message.substring(11).trim();
  }

  const noteMatch = message.match(/save this note[:\-\s]+(.+)/i);
  if (noteMatch) return noteMatch[1].trim();

  return "";
}

function getCurrentUser(req) {
  return req.headers["x-user"] || "";
}

async function saveChat(username, role, text) {
  if (!db || !username) return;

  await db.collection("chats").insertOne({
    username,
    role,
    text,
    time: new Date()
  });
}

app.get("/", (req, res) => {
  res.send("BELAL AI backend running 🚀");
});

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

    const existingUser = await db.collection("users").findOne({ username });

    if (existingUser) {
      return res.json({
        success: false,
        message: "Ei username age thekei ase ❌"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.collection("users").insertOne({
      username,
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

    const user = await db.collection("users").findOne({ username });

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

    res.json(data.map(item => ({
      role: item.role,
      text: item.text,
      time: item.time
    })));
  } catch (error) {
    console.error("History load error:", error);
    res.json([]);
  }
});

app.delete("/clear-history", async (req, res) => {
  try {
    const username = getCurrentUser(req);

    if (db && username) {
      await db.collection("chats").deleteMany({ username });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Clear history error:", error);
    res.json({ success: false });
  }
});

app.post("/chat", async (req, res) => {
  try {
    const username = getCurrentUser(req);
    const message = (req.body.message || "").trim();
    const lower = message.toLowerCase();
    const memory = loadMemory();

    if (!message) {
      return res.json({ reply: "Kisu likho boss 🙂" });
    }

    if (lower === "amar nam ki") {
      const reply = memory.name
        ? `Tomar nam ${memory.name} 😎`
        : "Tumi ekhono tomar nam bolo nai Boss 🙂";

      await saveChat(username, "user", message);
      await saveChat(username, "ai", reply);

      return res.json({ reply });
    }

    if (lower === "ami ki hote chai") {
      const reply = memory.goal
        ? `Tumi ${memory.goal} 😎`
        : "Tumi ekhono tomar goal bolo nai Boss 🙂";

      await saveChat(username, "user", message);
      await saveChat(username, "ai", reply);

      return res.json({ reply });
    }

    if (lower === "amar kaj ki") {
      const reply = memory.work
        ? `Tomar kaj ${memory.work} 👍`
        : "Tumi ekhono tomar kaj bolo nai Boss 🙂";

      await saveChat(username, "user", message);
      await saveChat(username, "ai", reply);

      return res.json({ reply });
    }

    if (lower === "show notes") {
      const reply = memory.notes.length
        ? `Tomar notes:\n- ${memory.notes.join("\n- ")}`
        : "Kono note nai Boss 🙂";

      await saveChat(username, "user", message);
      await saveChat(username, "ai", reply);

      return res.json({ reply });
    }

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

    if (savedSomething) {
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

      await saveChat(username, "user", message);
      await saveChat(username, "ai", reply);

      return res.json({ reply });
    }

    const memoryText = `
User name: ${memory.name || "Not given"}
User goal: ${memory.goal || "Not given"}
User work: ${memory.work || "Not given"}
User notes: ${memory.notes.length ? memory.notes.join(", ") : "No notes"}
`;

    const completion = await withTimeout(
      groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: `You are BELAL AI.
Reply in correct Bangla-English mix.
Be friendly, clear, and helpful.

Saved User Memory:
${memoryText}`
          },
          {
            role: "user",
            content: message
          }
        ]
      }),
      15000
    );

    const reply = completion.choices[0].message.content;

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

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} 🚀`);
  });
});