const express   = require("express");
const mongoose  = require("mongoose");
const multer    = require("multer");
const path      = require("path");
const fs        = require("fs");
const bcrypt    = require("bcryptjs");
require("dotenv").config();

const app  = express();
const PORT = process.env.PORT || 5000;

// ── MongoDB connection ────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB connected"))
    .catch(err => { console.error("❌ MongoDB connection error:", err); process.exit(1); });

// ── Schemas & Models ──────────────────────────────────────────────────────────

const materialSchema = new mongoose.Schema({
    name:     { type: String, required: true, unique: true },
    quantity: { type: Number, required: true, default: 0 }
});

const historySchema = new mongoose.Schema({
    type:     { type: String, enum: ["Added", "Used"], required: true },
    name:     { type: String, required: true },
    quantity: { type: Number, required: true },
    date:     String,
    time:     String,
    datetime: { type: Date, default: Date.now }
});

const reportSchema = new mongoose.Schema({
    date:        { type: String, required: true },
    location:    { type: String, required: true },
    workType:    { type: String, default: "Other" },
    description: { type: String, required: true },
    issues:      { type: String, default: "" },
    actions:     { type: String, required: true },
    engineer:    { type: String, required: true },
    image:       { type: String, default: null },
    submittedAt: { type: Date,   default: Date.now }
});

const userSchema = new mongoose.Schema({
    name:      { type: String, required: true },
    email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
    password:  { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const Material = mongoose.model("Material", materialSchema);
const History  = mongoose.model("History",  historySchema);
const Report   = mongoose.model("Report",   reportSchema);
const User     = mongoose.model("User",     userSchema);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "client")));

// Serve uploaded images
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use("/uploads", express.static(uploadsDir));

// ── Multer ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
        cb(null, "image_" + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp/;
        if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype))
            cb(null, true);
        else
            cb(new Error("Only image files are allowed"));
    }
});

// ── Page Routes ───────────────────────────────────────────────────────────────

app.get("/",            (req, res) => res.sendFile(path.join(__dirname, "..", "client", "pages", "index.html")));
app.get("/login",       (req, res) => res.sendFile(path.join(__dirname, "..", "client", "pages", "login.html")));
app.get("/about",       (req, res) => res.sendFile(path.join(__dirname, "..", "client", "pages", "about.html")));
app.get("/gallery",     (req, res) => res.sendFile(path.join(__dirname, "..", "client", "pages", "gallery.html")));
app.get("/success",     (req, res) => res.sendFile(path.join(__dirname, "..", "client", "pages", "success.html")));
app.get("/materiallog", (req, res) => res.sendFile(path.join(__dirname, "..", "client", "pages", "materiallog.html")));

// ── API: Reports ──────────────────────────────────────────────────────────────

// GET all reports (newest first)
app.get("/api/reports", async (req, res) => {
    try {
        const reports = await Report.find().sort({ submittedAt: -1 }).lean();
        res.json({ reports });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch reports" });
    }
});

// POST submit a new report
app.post("/api/reports/submit", upload.single("image"), async (req, res) => {
    const { date, location, workType, description, issues, actions, engineer } = req.body;

    if (!date || !location || !description || !actions || !engineer)
        return res.status(400).json({ error: "Missing required fields" });

    try {
        await Report.create({
            date,
            location,
            workType:    workType || "Other",
            description,
            issues:      issues   || "",
            actions,
            engineer,
            image:       req.file ? req.file.filename : null
        });
        res.json({ message: "Report submitted successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to save report" });
    }
});

// ── API: Materials ────────────────────────────────────────────────────────────

// GET materials + history + insights
app.get("/materials", async (req, res) => {
    try {
        const data    = await Material.find().lean();
        const history = await History.find().sort({ datetime: -1 }).lean();

        let insights = [];
        let alerts   = [];

        if (data.length > 0) insights.push("Material tracking active.");
        if (data.length > 3) insights.push("Managing multiple materials.");

        const totalQty = data.reduce((sum, item) => sum + item.quantity, 0);
        if (totalQty > 100) insights.push("Stock levels are good.");

        data.forEach(item => {
            if (item.quantity < 10) alerts.push(`Low stock: ${item.name}`);
        });

        const summary = {};
        history.forEach(h => {
            if (!summary[h.name]) summary[h.name] = { added: 0, used: 0 };
            if (h.type === "Added") summary[h.name].added += h.quantity;
            if (h.type === "Used")  summary[h.name].used  += h.quantity;
        });

        res.json({ materials: data, insights, alerts, history, summary });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch materials" });
    }
});

// POST add material
app.post("/add", async (req, res) => {
    const { name, quantity } = req.body;

    if (!name || quantity === undefined)
        return res.status(400).json({ error: "Invalid data" });

    try {
        // $setOnInsert sets name only when creating a new doc
        // $inc handles quantity for both new and existing docs
        await Material.findOneAndUpdate(
            { name: new RegExp(`^${name}$`, "i") },
            {
                $inc: { quantity: Number(quantity) },
                $setOnInsert: { name }
            },
            { upsert: true, new: true }
        );

        await History.create({
            type:     "Added",
            name,
            quantity: Number(quantity),
            date:     new Date().toLocaleDateString(),
            time:     new Date().toLocaleTimeString(),
            datetime: new Date()
        });

        res.json({ message: "Material added successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to add material" });
    }
});

// POST use material
app.post("/use", async (req, res) => {
    const { name, quantity } = req.body;

    if (!name || quantity === undefined)
        return res.status(400).json({ error: "Invalid data" });

    try {
        const material = await Material.findOne({ name: new RegExp(`^${name}$`, "i") });

        if (!material)
            return res.status(404).json({ error: "Material not found" });
        if (material.quantity < Number(quantity))
            return res.status(400).json({ error: "Not enough stock" });

        material.quantity -= Number(quantity);
        await material.save();

        await History.create({
            type:     "Used",
            name,
            quantity: Number(quantity),
            date:     new Date().toLocaleDateString(),
            time:     new Date().toLocaleTimeString(),
            datetime: new Date()
        });

        res.json({ message: "Material used successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to use material" });
    }
});


// DELETE a report by id
app.delete("/api/reports/:id", async (req, res) => {
    try {
        const report = await Report.findByIdAndDelete(req.params.id);
        if (!report) return res.status(404).json({ error: "Report not found" });

        // Also delete the image file if it exists
        if (report.image) {
            const imgPath = path.join(uploadsDir, report.image);
            if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        }

        res.json({ message: "Report deleted successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to delete report" });
    }
});

// ── API: Auth ─────────────────────────────────────────────────────────────────

// POST signup
app.post("/api/auth/signup", async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
        return res.status(400).json({ message: "All fields are required" });

    if (password.length < 6)
        return res.status(400).json({ message: "Password must be at least 6 characters" });

    try {
        const existing = await User.findOne({ email: email.toLowerCase().trim() });
        if (existing)
            return res.status(409).json({ message: "An account with this email already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({ name, email, password: hashedPassword });

        res.status(201).json({ name: user.name, email: user.email });
    } catch (err) {
        console.error("Signup error:", err);
        res.status(500).json({ message: "Server error. Please try again." });
    }
});

// POST login
app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password)
        return res.status(400).json({ message: "Email and password are required" });

    try {
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user)
            return res.status(401).json({ message: "Invalid email or password" });

        const match = await bcrypt.compare(password, user.password);
        if (!match)
            return res.status(401).json({ message: "Invalid email or password" });

        res.json({ name: user.name, email: user.email });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ message: "Server error. Please try again." });
    }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));