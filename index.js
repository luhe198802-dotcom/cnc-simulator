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

function parseGCode(gcode, scale = 10) {
  const lines = gcode.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith(";") && !l.startsWith("("));
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
      if (isAbs) {
        if (params.X !== undefined) end.x = params.X;
        if (params.Y !== undefined) end.y = params.Y;
        if (params.Z !== undefined) end.z = params.Z;
      } else {
        if (params.X !== undefined) end.x += params.X;
        if (params.Y !== undefined) end.y += params.Y;
        if (params.Z !== undefined) end.z += params.Z;
      }
      pathSegments.push({ type: cmd === "G0" || cmd === "G00" ? "rapid" : "linear", start: {...pos}, end: {...end} });
      pos = end;
    }
  }
  
  const points = [];
  for (const seg of pathSegments) {
    if (points.length === 0) points.push({ x: seg.start.x * scale, y: seg.start.y * scale, z: seg.start.z });
    points.push({ x: seg.end.x * scale, y: seg.end.y * scale, z: seg.end.z });
  }
  
  return { pathSegments: pathSegments.map(s => ({ ...s, start: { x: s.start.x * scale, y: s.start.y * scale, z: s.start.z }, end: { x: s.end.x * scale, y: s.end.y * scale, z: s.end.z } })), points, totalSegments: pathSegments.length, totalPoints: points.length };
}

const EXAMPLES = [
  { name: "十字图案", code: "G00 G90 G59\nM03 S800\nG00 X0 Y0 Z5\nG01 Z-1 F30\nG01 X-10 Y0 F80\nG01 X10 Y0\nG01 X0 Y0\nG01 X0 Y-10\nG01 X0 Y10\nG00 Z50\nM05\nM30" }
];

app.get("/api/v1/examples", (req, res) => res.json({ success: true, examples: EXAMPLES }));

app.post("/api/v1/simulate", (req, res) => {
  const { gcode, scale = 10 } = req.body;
  if (!gcode) return res.status(400).json({ success: false, error: "请输入G代码" });
  const result = parseGCode(gcode, scale);
  res.json({ success: true, ...result, boundingBox: { minX: -160, maxX: 160, minY: -160, maxY: 160 }, workpieceDiameter: 320 });
});

app.get("*", (req, res) => res.sendFile(join(__dirname, "public/index.html")));
app.listen(PORT, "0.0.0.0", () => console.log("Running on port " + PORT));