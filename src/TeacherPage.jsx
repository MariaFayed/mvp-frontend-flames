import React, { useEffect, useRef, useState } from "react";
import { FaceMesh } from "@mediapipe/face_mesh";
import { Camera } from "@mediapipe/camera_utils";

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function vSub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) }; }
function vLen(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }

const IDX = {
  leftEyeTop: 159, leftEyeBottom: 145, leftEyeLeft: 33, leftEyeRight: 133,
  rightEyeTop: 386, rightEyeBottom: 374, rightEyeLeft: 362, rightEyeRight: 263,
  noseTip: 1, leftCheek: 234, rightCheek: 454,
};

function eyeOpenness(lm, top, bottom, left, right) {
  const v = vLen(vSub(lm[top], lm[bottom]));
  const h = vLen(vSub(lm[left], lm[right]));
  return clamp(v / (h || 1e-6), 0, 1);
}

function estimateHeadRotation(lm) {
  const leftCheek = lm[IDX.leftCheek];
  const rightCheek = lm[IDX.rightCheek];

  const faceCenter = {
    x: (leftCheek.x + rightCheek.x) / 2,
    y: (leftCheek.y + rightCheek.y) / 2,
    z: ((leftCheek.z ?? 0) + (rightCheek.z ?? 0)) / 2,
  };

  const nose = lm[IDX.noseTip];
  const faceW = vLen(vSub(leftCheek, rightCheek)) || 1e-6;

  const yaw = clamp(((nose.x - faceCenter.x) / faceW) * -6.0, -1.0, 1.0);

  const leftEye = lm[IDX.leftEyeRight];
  const rightEye = lm[IDX.rightEyeLeft];
  const pitch = clamp(((nose.y - ((leftEye.y + rightEye.y) / 2)) / faceW) * 6.0, -1.0, 1.0);

  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);

  return { yaw: yaw * 0.9, pitch: pitch * 0.9, roll: clamp(roll, -0.8, 0.8) };
}

// audio helpers
function downsampleTo16k(float32, inputRate) {
  const targetRate = 16000;
  if (inputRate === targetRate) return float32;

  const ratio = inputRate / targetRate;
  const newLen = Math.round(float32.length / ratio);
  const result = new Float32Array(newLen);

  let oR = 0, oB = 0;
  while (oR < result.length) {
    const next = Math.round((oR + 1) * ratio);
    let sum = 0, count = 0;
    for (let i = oB; i < next && i < float32.length; i++) {
      sum += float32[i];
      count++;
    }
    result[oR++] = count ? sum / count : 0;
    oB = next;
  }
  return result;
}

function floatTo16BitPCM(float32) {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export default function TeacherPage() {
  const [status, setStatus] = useState("idle");
  const [isRunning, setIsRunning] = useState(false);

  const wsRef = useRef(null);
  const videoRef = useRef(null);
  const lastPoseSent = useRef(0);

  const faceControllerRef = useRef(null);
  const micStreamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const processorRef = useRef(null);

  // Tiny UI metrics (purely visual)
  const [poseUi, setPoseUi] = useState({ yaw: 0, pitch: 0, roll: 0, blinkL: 0, blinkR: 0 });
  const poseCountRef = useRef(0);

  function sendPose(pose) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // EXACT SAME BEHAVIOR: send string JSON
    const payload = JSON.stringify({ type: "pose", ...pose });
    ws.send(payload);

    // Keep your debug log if you want (optional)
    // console.log("Sending pose TEXT length=", payload.length);

    poseCountRef.current++;
    if (poseCountRef.current % 6 === 0) setPoseUi(pose);
  }

  async function startFaceMesh() {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    videoEl.srcObject = stream;
    await videoEl.play();

    const faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    faceMesh.onResults((results) => {
      const lm = results.multiFaceLandmarks?.[0];
      if (!lm) return;

      const rot = estimateHeadRotation(lm);

      const openL = eyeOpenness(lm, 159, 145, 33, 133);
      const openR = eyeOpenness(lm, 386, 374, 362, 263);

      const blinkL = clamp((0.23 - openL) * 6.0, 0, 1);
      const blinkR = clamp((0.23 - openR) * 6.0, 0, 1);

      const now = performance.now();
      if (now - lastPoseSent.current > 66) { // ~15 fps
        lastPoseSent.current = now;

        // Keep your debug log if you want:
        // console.log("Teacher pose", rot, blinkL, blinkR);

        sendPose({ yaw: rot.yaw, pitch: rot.pitch, roll: rot.roll, blinkL, blinkR });
      }
    });

    const cam = new Camera(videoEl, {
      onFrame: async () => { await faceMesh.send({ image: videoEl }); },
      width: 640,
      height: 360,
    });

    cam.start();

    faceControllerRef.current = {
      stop: () => {
        try { cam.stop(); } catch {}
        try { faceMesh.close(); } catch {}
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
      }
    };
  }

  async function startMic() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("WS not open");

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    micStreamRef.current = stream;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    sourceNodeRef.current = source;

    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const down = downsampleTo16k(input, audioCtx.sampleRate);
      const pcm16 = floatTo16BitPCM(down);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(pcm16);
      }
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);
  }

  async function connect() {
    if (isRunning) return;

    setStatus("connecting...");
    setIsRunning(true);

const roomId = new URLSearchParams(window.location.search).get("room") || "default";
const ws = new WebSocket(`wss://mvp-flames-production.up.railway.app/ws/teacher-audio?roomId=${roomId}`);

    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = async () => {
      setStatus("connected — starting mic + camera...");
      try {
        await startMic();
        await startFaceMesh();
        setStatus("broadcasting");
      } catch (e) {
        console.error(e);
        setStatus("error: " + e.message);
        setIsRunning(false);
      }
    };

    ws.onerror = () => {
      setStatus("ws error");
      setIsRunning(false);
    };

    ws.onclose = () => {
      setStatus("disconnected");
      setIsRunning(false);
    };
  }

  function disconnect() {
    try { faceControllerRef.current?.stop?.(); } catch {}
    faceControllerRef.current = null;

    try { processorRef.current?.disconnect(); } catch {}
    try { sourceNodeRef.current?.disconnect(); } catch {}
    processorRef.current = null;
    sourceNodeRef.current = null;

    try { micStreamRef.current?.getTracks()?.forEach(t => t.stop()); } catch {}
    micStreamRef.current = null;

    try { wsRef.current?.send("stop"); } catch {}
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;

    setStatus("idle");
    setIsRunning(false);
  }

  useEffect(() => () => disconnect(), []);

  // ---------- UI ----------
  const styles = {
    page: {
      minHeight: "100vh",
      padding: 18,
      background: "linear-gradient(135deg, #0b1220 0%, #121b2f 55%, #0b1220 100%)",
      color: "#e9eefc",
      fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    },
    container: {
      maxWidth: 1100,
      margin: "0 auto",
      display: "grid",
      gridTemplateColumns: "1fr 420px",
      gap: 16,
      alignItems: "start",
    },
    card: {
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 16,
      padding: 14,
      boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
      backdropFilter: "blur(10px)",
    },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      gap: 12,
      marginBottom: 12,
    },
    title: { margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: 0.2 },
    sub: { margin: "6px 0 0 0", fontSize: 13, opacity: 0.85, lineHeight: 1.5 },
    badge: {
      fontSize: 12,
      padding: "6px 10px",
      borderRadius: 999,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(0,0,0,0.25)",
      whiteSpace: "nowrap",
      opacity: 0.95,
    },
    row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },
    btnPrimary: (disabled) => ({
      padding: "10px 14px",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.18)",
      background: disabled ? "rgba(120,180,255,0.10)" : "rgba(120,180,255,0.25)",
      color: "#e9eefc",
      cursor: disabled ? "not-allowed" : "pointer",
      fontWeight: 800,
      opacity: disabled ? 0.7 : 1,
    }),
    btnSecondary: (disabled) => ({
      padding: "10px 14px",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.18)",
      background: "rgba(0,0,0,0.30)",
      color: "#e9eefc",
      cursor: disabled ? "not-allowed" : "pointer",
      fontWeight: 700,
      opacity: disabled ? 0.7 : 1,
    }),
    hint: { fontSize: 12, opacity: 0.78, marginTop: 10, lineHeight: 1.5 },
    video: {
      width: "100%",
      aspectRatio: "16 / 9",
      borderRadius: 14,
      background: "#000",
      border: "1px solid rgba(255,255,255,0.12)",
    },
    kpiGrid: {
      marginTop: 12,
      display: "grid",
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: 10,
    },
    kpi: {
      padding: 12,
      borderRadius: 14,
      background: "rgba(0,0,0,0.22)",
      border: "1px solid rgba(255,255,255,0.10)",
    },
    kpiLabel: { fontSize: 12, opacity: 0.8, marginBottom: 4 },
    kpiVal: { fontSize: 14, fontWeight: 800 },
  };

  return (
    <div style={styles.page}>
      <div style={{ maxWidth: 1100, margin: "0 auto", marginBottom: 12 }}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>Teacher Room</h2>
            <p style={styles.sub}>
              Streams mic audio + sends FaceMesh pose (head & blinks) to students. Students see the avatar mirror you.
            </p>
          </div>
          <div style={styles.badge}>
            <b>Status:</b> {status}
          </div>
        </div>
      </div>

      <div style={styles.container}>
        {/* LEFT: controls */}
        <div style={styles.card}>
          <div style={styles.row}>
            <button style={styles.btnPrimary(isRunning)} onClick={connect} disabled={isRunning}>
              Start Broadcasting
            </button>
            <button style={styles.btnSecondary(!isRunning)} onClick={disconnect} disabled={!isRunning}>
              Stop
            </button>
          </div>

          <div style={styles.kpiGrid}>
            <div style={styles.kpi}>
              <div style={styles.kpiLabel}>Pose packets sent</div>
              <div style={styles.kpiVal}>{poseCountRef.current}</div>
            </div>
            <div style={styles.kpi}>
              <div style={styles.kpiLabel}>Last pose</div>
              <div style={styles.kpiVal}>
                yaw {poseUi.yaw.toFixed(2)} · pitch {poseUi.pitch.toFixed(2)}
              </div>
            </div>
          </div>

          <div style={styles.hint}>
            <b>Tips:</b>
            <ul style={{ margin: "8px 0 0 18px", lineHeight: 1.6, opacity: 0.85 }}>
              <li>Open the Student page first, then press Start here.</li>
              <li>Grant mic + camera permissions.</li>
              <li>If FaceMesh is weird, disable extensions or try Incognito.</li>
            </ul>
          </div>
        </div>

        {/* RIGHT: camera preview */}
        <div style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800 }}>Camera (tracking only)</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>Not sent to students — used to compute pose</div>
            </div>
          </div>

          <video ref={videoRef} playsInline muted autoPlay style={styles.video} />

          <div style={styles.hint}>
            If the video stays black, check browser permissions.
          </div>
        </div>
      </div>
    </div>
  );
}
