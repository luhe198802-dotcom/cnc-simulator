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
    
    // 解析所有参数
    const matches = codeLine.match(/([A-Z])(-?[\d.]+)/g);
    if (!matches) continue;
    
    const params = {};
    let cmd = "";
    for (const m of matches) {
      const match = m.match(/^([A-Z])(-?[\d.]+)$/);
      if (match) {
        const key = match[1];
        const val = parseFloat(match[2]);
        if (key === "G" || key === "M") {
          cmd = key + Math.floor(val);
        } else {
          params[key] = val;
        }
      }
    }
    
    // 处理 G代码
    if (cmd === "G90") isAbs = true;
    else if (cmd === "G91") isAbs = false;
    else if (cmd === "G0" || cmd === "G00") {
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
      pathSegments.push({ type: "rapid", start: {...pos}, end: {...end} });
      pos = end;
    }
    else if (cmd === "G1" || cmd === "G01") {
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
      pathSegments.push({ type: "linear", start: {...pos}, end: {...end} });
      pos = end;
    }
  }
  
  const points = [];
  for (const seg of pathSegments) {
    if (points.length === 0) points.push({ x: seg.start.x * scale, y: seg.start.y * scale, z: seg.start.z });
    points.push({ x: seg.end.x * scale, y: seg.end.y * scale, z: seg.end.z });
  }
  
  return { 
    pathSegments: pathSegments.map(s => ({ 
      type: s.type,
      start: { x: s.start.x * scale, y: s.start.y * scale, z: s.start.z }, 
      end: { x: s.end.x * scale, y: s.end.y * scale, z: s.end.z } 
    })), 
    points, 
    totalSegments: pathSegments.length, 
    totalPoints: points.length 
  };
}

app.get("/api/v1/examples", (req, res) => {
  res.json({ 
    success: true, 
    examples: [{ 
      name: "十字图案", 
      code: "G00 G90 G59\nM03 S800\nG00 X0 Y0 Z5\nG01 Z-1 F30\nG01 X-10 Y0 F80\nG01 X10 Y0\nG01 X0 Y0\nG01 X0 Y-10\nG01 X0 Y10\nG00 Z50\nM05\nM30" 
    }] 
  });
});

app.post("/api/v1/simulate", (req, res) => {
  const { gcode, scale = 10 } = req.body;
  if (!gcode) return res.status(400).json({ success: false, error: "请输入G代码" });
  try {
    const result = parseGCode(gcode, scale);
    res.json({ 
      success: true, 
      ...result, 
      boundingBox: { minX: -160, maxX: 160, minY: -160, maxY: 160 }, 
      workpieceDiameter: 320 
    });
  } catch (e) {
    res.status(400).json({ success: false, error: "G代码解析错误: " + e.message });
  }
});

app.get("*", (req, res) => res.sendFile(join(__dirname, "public/index.html")));
app.listen(PORT, "0.0.0.0", () => console.log("Running on port " + PORT));