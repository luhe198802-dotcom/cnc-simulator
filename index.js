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
  try {
    const { gcode, scale = 10 } = req.body;
    if (!gcode) return res.status(400).json({ success: false, error: "请输入G代码" });
    
    const lines = gcode.split("`n").map(l => l.trim()).filter(l => l && !l.startsWith(";") && !l.startsWith("("));
    const pathSegments = [];
    let pos = { x: 0, y: 0, z: 50 };
    let isAbs = true;
    
    for (const line of lines) {
      const codeLine = line.split(";")[0].split("(")[0].trim().toUpperCase();
      if (!codeLine) continue;
      const parts = codeLine.split(/\s+/);
      let cmd = "";
      const params = {};
      for (const p of parts) {
        const m = p.match(/^([A-Z])(-?[\d.]+)$/);
        if (m) {
          if (m[1] === "G" || m[1] === "M") cmd = m[1] + Math.floor(parseFloat(m[2]));
          else params[m[1]] = parseFloat(m[2]);
        }
      }
      if (cmd === "G90") isAbs = true;
      else if (cmd === "G91") isAbs = false;
      else if (cmd === "G0" || cmd === "G00" || cmd === "G1" || cmd === "G01") {
        const end = { ...pos };
        if (isAbs) { if (params.X !== undefined) end.x = params.X; if (params.Y !== undefined) end.y = params.Y; if (params.Z !== undefined) end.z = params.Z; }
        else { if (params.X !== undefined) end.x += params.X; if (params.Y !== undefined) end.y += params.Y; if (params.Z !== undefined) end.z += params.Z; }
        pathSegments.push({ type: cmd === "G0" || cmd === "G00" ? "rapid" : "linear", start: {...pos}, end: {...end} });
        pos = end;
      }
    }
    
    const points = [];
    for (const seg of pathSegments) {
      if (points.length === 0) points.push({ x: seg.start.x * scale, y: seg.start.y * scale, z: seg.start.z });
      points.push({ x: seg.end.x * scale, y: seg.end.y * scale, z: seg.end.z });
    }
    
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    
    res.json({ success: true, pathSegments: pathSegments.map(s => ({ ...s, start: { x: s.start.x * scale, y: s.start.y * scale }, end: { x: s.end.x * scale, y: s.end.y * scale } })), points, totalSegments: pathSegments.length, totalPoints: points.length, boundingBox: { minX, maxX, minY, maxY }, workpieceDiameter: 32 * scale });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get("*", (req, res) => res.sendFile(join(__dirname, "public/index.html")));
app.listen(PORT, "0.0.0.0", () => console.log("Running on port " + PORT));
