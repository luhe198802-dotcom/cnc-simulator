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

const EPSILON = 0.001;
const MAX_SPINDLE_SPEED = 800;
const MAX_CUT_DEPTH_Z = -1.0;
const MAX_Z_HEIGHT = 200;
const MAX_PLUNGE_FEED = 30;
const MAX_CUT_FEED = 80;
const DEFAULT_WORKPIECE_DIAMETER = 32;
const TOOL_RADIUS = 2.5;

function addAlarm(alarms, message) {
  if (!alarms.includes(message)) alarms.push(message);
}

function isSamePoint(a, b) {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON && Math.abs(a.z - b.z) < EPSILON;
}

function pointRadius(point) {
  return Math.sqrt(point.x * point.x + point.y * point.y);
}

function isCuttingSegment(seg) {
  return seg.type !== "rapid" && (seg.start.z < 0 || seg.end.z < 0);
}

function isPlungeSegment(seg) {
  return seg.type !== "rapid" && seg.end.z < seg.start.z - EPSILON;
}

function isFeedCuttingSegment(seg) {
  return seg.type !== "rapid" && seg.start.z < 0 && seg.end.z < 0;
}

function validateSegment(seg, alarms, lineNumber, feed, workpieceRadius) {
  if (Math.max(seg.start.z, seg.end.z) > MAX_Z_HEIGHT + EPSILON) {
    addAlarm(alarms, `第 ${lineNumber} 行报警：Z轴高度超过限制，Z 不能高于 ${MAX_Z_HEIGHT}mm`);
  }

  if (Math.min(seg.start.z, seg.end.z) < MAX_CUT_DEPTH_Z - EPSILON) {
    addAlarm(alarms, `第 ${lineNumber} 行报警：切削深度超过限制，Z 不能低于 ${MAX_CUT_DEPTH_Z}mm`);
  }

  if (feed !== null && feed !== undefined) {
    if (isPlungeSegment(seg) && feed > MAX_PLUNGE_FEED) {
      addAlarm(alarms, `第 ${lineNumber} 行报警：下刀速度 F${feed} 超过上限 F${MAX_PLUNGE_FEED}`);
    }

    if (isFeedCuttingSegment(seg) && feed > MAX_CUT_FEED) {
      addAlarm(alarms, `第 ${lineNumber} 行报警：切割进给速度 F${feed} 超过上限 F${MAX_CUT_FEED}`);
    }
  }

  if (!isCuttingSegment(seg)) return;

  const maxRadius = Math.max(pointRadius(seg.start), pointRadius(seg.end));
  const maxToolCenterRadius = workpieceRadius + TOOL_RADIUS;
  if (maxRadius > maxToolCenterRadius + EPSILON) {
    addAlarm(alarms, `第 ${lineNumber} 行报警：刀具内侧轮廓已超出工件边界，刀心半径不能超过 ${maxToolCenterRadius}mm`);
  }
}

function getEndPosition(pos, params, isAbs) {
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
  return end;
}

function getArcDelta(startAngle, endAngle, motionCmd) {
  let delta = endAngle - startAngle;
  if (motionCmd === "G2") {
    if (delta >= 0) delta -= Math.PI * 2;
  } else if (delta <= 0) {
    delta += Math.PI * 2;
  }
  return delta;
}

function getCenterFromRadius(start, end, radiusValue, motionCmd) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.sqrt(dx * dx + dy * dy);
  const radius = Math.abs(radiusValue);

  if (chord < EPSILON || radius < chord / 2 - EPSILON) return null;

  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const height = Math.sqrt(Math.max(0, radius * radius - (chord / 2) ** 2));
  const nx = -dy / chord;
  const ny = dx / chord;

  const candidates = [
    { x: midX + nx * height, y: midY + ny * height },
    { x: midX - nx * height, y: midY - ny * height }
  ];

  let selected = candidates[0];
  for (const center of candidates) {
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
    const totalAngle = Math.abs(getArcDelta(startAngle, endAngle, motionCmd));
    const wantsLongArc = radiusValue < 0;

    if ((!wantsLongArc && totalAngle <= Math.PI + EPSILON) || (wantsLongArc && totalAngle > Math.PI + EPSILON)) {
      selected = center;
      break;
    }
  }

  return { ...selected, radius };
}

function parseGCode(gcode, scale = 10, workpieceDiameter = DEFAULT_WORKPIECE_DIAMETER) {
  const workpieceRadius = workpieceDiameter / 2;
  const lines = gcode.split("\n")
    .map((line, index) => ({ text: line.trim(), number: index + 1 }))
    .filter(line => line.text && !line.text.startsWith(";") && !line.text.startsWith("("));
  const pathSegments = [];
  const alarms = [];
  let pos = { x: 0, y: 0, z: 50 };
  let isAbs = true;
  let currentFeed = null;
  
  for (const line of lines) {
    const codeLine = line.text.split(";")[0].split("(")[0].trim().toUpperCase();
    if (!codeLine) continue;
    const parts = codeLine.matchAll(/([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g);
    const params = {};
    let motionCmd = null;
    
    for (const part of parts) {
      const key = part[1];
      const val = parseFloat(part[2]);
      
      if (key === "G") {
        const gcode = Math.floor(val);
        if (gcode === 0) motionCmd = "G0";
        else if (gcode === 1) motionCmd = "G1";
        else if (gcode === 2) motionCmd = "G2";
        else if (gcode === 3) motionCmd = "G3";
        else if (gcode === 90) isAbs = true;
        else if (gcode === 91) isAbs = false;
      } else if (key === "S") {
        if (val > MAX_SPINDLE_SPEED) {
          addAlarm(alarms, `第 ${line.number} 行报警：转速 S${val} 超过上限 S${MAX_SPINDLE_SPEED}`);
        }
      } else if (key === "F") {
        currentFeed = val;
      } else if (key === "M") {
      } else {
        params[key] = val;
      }
    }

    if (motionCmd && (motionCmd === "G0" || motionCmd === "G1")) {
      const end = getEndPosition(pos, params, isAbs);
      if (!isSamePoint(pos, end)) {
        const seg = { type: motionCmd === "G0" ? "rapid" : "linear", start: {...pos}, end: {...end} };
        validateSegment(seg, alarms, line.number, currentFeed, workpieceRadius);
        pathSegments.push(seg);
      }
      pos = end;
    }
    
    if (motionCmd && (motionCmd === "G2" || motionCmd === "G3")) {
      const end = getEndPosition(pos, params, isAbs);
      const hasIjCenter = params.I !== undefined || params.J !== undefined;
      const radiusCenter = !hasIjCenter && params.R !== undefined ? getCenterFromRadius(pos, end, params.R, motionCmd) : null;
      if (!hasIjCenter && !radiusCenter) continue;
      
      let cx = hasIjCenter ? pos.x + (params.I || 0) : radiusCenter.x;
      let cy = hasIjCenter ? pos.y + (params.J || 0) : radiusCenter.y;
      let radius = hasIjCenter ? Math.sqrt((pos.x - cx) ** 2 + (pos.y - cy) ** 2) : radiusCenter.radius;
      
      if (radius < EPSILON) continue;
      
      const startAngle = Math.atan2(pos.y - cy, pos.x - cx);
      let endAngle = Math.atan2(end.y - cy, end.x - cx);
      
      let isFullCircle = hasIjCenter && Math.abs(end.x - pos.x) < EPSILON && Math.abs(end.y - pos.y) < EPSILON;
      
      if (isFullCircle) {
        endAngle = startAngle + (motionCmd === "G2" ? -Math.PI * 2 : Math.PI * 2);
      } else {
        endAngle = startAngle + getArcDelta(startAngle, endAngle, motionCmd);
      }
      
      const totalAngle = Math.abs(endAngle - startAngle);
      const segCount = Math.max(36, Math.ceil(totalAngle / (Math.PI / 18)));
      
      for (let i = 1; i <= segCount; i++) {
        const t = i / segCount;
        const angle = startAngle + (endAngle - startAngle) * t;
        const px = cx + radius * Math.cos(angle);
        const py = cy + radius * Math.sin(angle);
        
        let seg;
        if (i === 1) {
          seg = { type: "arc", start: {...pos}, end: { x: px, y: py, z: end.z } };
        } else {
          const lastPt = pathSegments[pathSegments.length - 1].end;
          seg = { type: "arc", start: lastPt, end: { x: px, y: py, z: end.z } };
        }
        validateSegment(seg, alarms, line.number, currentFeed, workpieceRadius);
        pathSegments.push(seg);
      }
      pos = end;
    }
  }
  
  const points = [];
  for (const seg of pathSegments) {
    if (points.length === 0) points.push({ x: seg.start.x * scale, y: seg.start.y * scale, z: seg.start.z });
    points.push({ x: seg.end.x * scale, y: seg.end.y * scale, z: seg.end.z });
  }
  
  return { alarms, pathSegments: pathSegments.map(s => ({ ...s, start: { x: s.start.x * scale, y: s.start.y * scale, z: s.start.z }, end: { x: s.end.x * scale, y: s.end.y * scale, z: s.end.z } })), points, totalSegments: pathSegments.length, totalPoints: points.length };
}

const EXAMPLES = [
  { name: "十字图案", code: "G00 G90 G59\nM03 S800\nG00 X0 Y0 Z5\nG01 Z-1 F30\nG01 X-10 Y0 F80\nG01 X10 Y0\nG01 X0 Y0\nG01 X0 Y-10\nG01 X0 Y10\nG00 Z50\nM05\nM30" },
  { name: "圆形图案", code: "G00 G90 G59\nM03 S800\nG00 X0 Y0 Z5\nG01 Z-1 F30\nG02 I10 J0 F80\nG00 Z50\nM05\nM30" }
];

app.get("/api/v1/examples", (req, res) => res.json({ success: true, examples: EXAMPLES }));

app.post("/api/v1/simulate", (req, res) => {
  const { gcode, scale = 10, workpieceDiameter = DEFAULT_WORKPIECE_DIAMETER } = req.body;
  if (!gcode) return res.status(400).json({ success: false, error: "请输入G代码" });
  const diameter = Number(workpieceDiameter);
  if (!Number.isFinite(diameter) || diameter <= 0) {
    return res.status(400).json({ success: false, error: "工件直径必须大于0" });
  }
  const workpieceRadius = diameter / 2;
  const result = parseGCode(gcode, scale, diameter);
  if (result.alarms.length) {
    return res.status(422).json({ success: false, error: result.alarms.join("\n"), alarms: result.alarms });
  }
  res.json({ success: true, ...result, boundingBox: { minX: -workpieceRadius * scale, maxX: workpieceRadius * scale, minY: -workpieceRadius * scale, maxY: workpieceRadius * scale }, workpieceDiameter: diameter * scale, workpieceDiameterMm: diameter });
});

app.get("*", (req, res) => res.sendFile(join(__dirname, "public/index.html")));
app.listen(PORT, "0.0.0.0", () => console.log("Running on port " + PORT));
