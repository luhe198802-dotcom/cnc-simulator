import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

app.post("/api/simulate", (req, res) => {
  const { gcode } = req.body;
  const lines = gcode.split("\n").filter(l => l.trim());
  const path = [];
  let pos = { x: 0, y: 0 }, scale = 10;
  
  for (const line of lines) {
    const x = line.match(/X(-?[\d.]+)/);
    const y = line.match(/Y(-?[\d.]+)/);
    if (x || y) {
      pos = {
        x: x ? parseFloat(x[1]) * scale : pos.x,
        y: y ? parseFloat(y[1]) * scale : pos.y
      };
      path.push({ ...pos });
    }
  }
  res.json({ success: true, path, total: path.length });
});

app.get("*", (req, res) => res.sendFile(join(__dirname, "public/index.html")));

app.listen(PORT, () => console.log("Running on " + PORT));
