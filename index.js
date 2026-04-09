import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

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
    const params = {};
    let motionCmd = null;
    
    for (const p of parts) {
      const m = p.match(/^([A-Z])(-?[\d.]+)$/);
      if (m) {
        const key = m[1];
        const val = parseFloat(m[2]);
        
        if (key === "G") {
          const gcode = Math.floor(val);
          if (gcode === 0) motionCmd = "G0";
          else if (gcode === 1) motionCmd = "G1";
          else if (gcode === 2) motionCmd = "G2";
          else if (gcode === 3) motionCmd = "G3";
          else if (gcode === 90) isAbs = true;
          else if (gcode === 91) isAbs = false;
        } else if (key === "M" || key === "S" || key === "F") {
        } else {
          params[key] = val;
        }
      }
    }
    
    if (motionCmd && (motionCmd === "G0" || motionCmd === "G1")) {
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
      pathSegments.push({ type: motionCmd === "G0" ? "rapid" : "linear", start: {...pos}, end: {...end} });
      pos = end;
    }
    
    if (motionCmd && (motionCmd === "G2" || motionCmd === "G3")) {
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
      
      let cx = pos.x + (params.I || 0);
      let cy = pos.y + (params.J || 0);
      
      const startAngle = Math.atan2(pos.y - cy, pos.x - cx);
      let endAngle = Math.atan2(end.y - cy, end.x - cx);
      
      if (motionCmd === "G2") {
        if (endAngle <= startAngle) endAngle += Math.PI * 2;
      } else {
        if (endAngle >= startAngle) endAngle -= Math.PI * 2;
      }
      
      const segCount = Math.max(12, Math.ceil(Math.abs(endAngle - startAngle) / (Math.PI / 12)));
      for (let i = 1; i <= segCount; i++) {
        const t = i / segCount;
        const angle = startAngle + (endAngle - startAngle) * t;
        const px = cx + Math.cos(angle) * Math.sqrt((pos.x - cx) ** 2 + (pos.y - cy) ** 2);
        const py = cy + Math.sin(angle) * Math.sqrt((pos.x - cx) ** 2 + (pos.y - cy) ** 2);
        
        if (i === 1) {
          pathSegments.push({ type: "arc", start: {...pos}, end: { x: px, y: py, z: end.z } });
        } else {
          const lastPt = pathSegments[pathSegments.length - 1].end;
          pathSegments.push({ type: "arc", start: lastPt, end: { x: px, y: py, z: end.z } });
        }
      }
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
  { name: "十字图案", code: "G00 G90 G59\nM03 S800\nG00 X0 Y0 Z5\nG01 Z-1 F30\nG01 X-10 Y0 F80\nG01 X10 Y0\nG01 X0 Y0\nG01 X0 Y-10\nG01 X0 Y10\nG00 Z50\nM05\nM30" },
  { name: "圆形图案", code: "G00 G90 G59\nM03 S800\nG00 X0 Y0 Z5\nG01 Z-1 F30\nG02 I10 J0 F80\nG00 Z50\nM05\nM30" }
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
