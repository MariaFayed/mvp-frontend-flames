// ✅ STEP 10: Updated StudentPage.jsx with functional multi-language support
import React, { useEffect, useRef, useState } from "react";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import AvatarRPM from "./AvatarRPM";

extend({ OrbitControls });

// ---------- helpers ----------
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// OrbitControls wrapper
function Controls() {
  const ref = useRef();
  const { camera, gl } = useThree();
  useFrame(() => {
    if (!ref.current) return;
    ref.current.target.set(0, 1.55, 0);
    ref.current.update();
  });
  return (
    <orbitControls
      ref={ref}
      args={[camera, gl.domElement]}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.7}
      enablePan={false}
      minDistance={1.5}
      maxDistance={6}
    />
  );
}

// ---------- styles ----------
const styles = {
  page: {
    height: "100vh",
    width: "100vw",
    overflow: "hidden",
    background: "linear-gradient(135deg, #0b1220 0%, #121b2f 55%, #0b1220 100%)",
    color: "#e9eefc",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  shell: {
    display: "grid",
    gridTemplateColumns: "420px 1fr",
    height: "100vh",
    width: "100vw",
  },
  left: {
    padding: 18,
    overflowY: "auto",
    overflowX: "hidden",
    borderRight: "1px solid rgba(255,255,255,0.10)",
  },
  right: {
    position: "relative",
    height: "100vh",
    width: "100%",
    overflow: "hidden",
    background: "radial-gradient(1200px 500px at 50% 25%, rgba(120,180,255,0.18), rgba(0,0,0,0.35))",
  },
  avatarWrap: {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
  },
  card: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
    backdropFilter: "blur(10px)",
  },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 },
  title: { margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: 0.2 },
  subtitle: { fontSize: 12, opacity: 0.8, marginTop: 4 },
  badge: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
    opacity: 0.95,
    whiteSpace: "nowrap",
  },
  row: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  label: { fontSize: 12, opacity: 0.9, marginBottom: 4 },
  select: {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.25)",
    color: "#e9eefc",
    outline: "none",
    cursor: "pointer",
  },
  btnPrimary: {
    padding: "9px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(120,180,255,0.25)",
    color: "#e9eefc",
    cursor: "pointer",
    fontWeight: 700,
  },
  btnSecondary: {
    padding: "9px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.30)",
    color: "#e9eefc",
    cursor: "pointer",
    fontWeight: 600,
  },
  boxTitle: { fontSize: 12, opacity: 0.85, marginBottom: 6 },
  textBox: (rtl) => ({
    padding: 12,
    borderRadius: 14,
    background: "rgba(0,0,0,0.22)",
    border: "1px solid rgba(255,255,255,0.10)",
    height: 110,
    overflowY: "auto",
    lineHeight: 1.5,
    direction: rtl ? "rtl" : "ltr",
    fontSize: 14,
    color: "#f2f6ff",
  }),
  hint: { fontSize: 12, opacity: 0.78, marginTop: 8, lineHeight: 1.4 },
  avatarHeader: {
    position: "absolute", top: 14, left: 14, right: 14,
    display: "flex", justifyContent: "space-between", pointerEvents: "none",
  },
  avatarTitle: { fontSize: 14, fontWeight: 800, opacity: 0.9 },
};

export default function StudentPage() {
  const [status, setStatus] = useState("idle");
  const [lang, setLang] = useState("ar"); // ✅ Language state
  const [enText, setEnText] = useState("");
  const [translatedText, setTranslatedText] = useState("");

  const wsRef = useRef(null);

  // utterance alignment
  const utterMapRef = useRef(new Map());
  const playQueueRef = useRef(Promise.resolve());

  // viseme driving
  const currentVisemeIdRef = useRef(0);

  // pose driven by TEACHER (received from server)
  const [pose, setPose] = useState({
    yaw: 0, pitch: 0, roll: 0, blinkL: 0, blinkR: 0, mouth: 0,
  });

  // ✅ Language configurations
  const LANGS = [
    { code: "ar", label: "Arabic (عربي)", rtl: true },
    { code: "fr", label: "French (Français)", rtl: false },
    { code: "de", label: "German (Deutsch)", rtl: false },
    { code: "es", label: "Spanish (Español)", rtl: false },
    { code: "bn", label: "Bangla (বাংলা)", rtl: false },
    { code: "zh", label: "Mandarin (中文)", rtl: false },
  ];

  // Get RTL setting for current language
  const isRTL = LANGS.find(l => l.code === lang)?.rtl || false;

  // Update connect to accept optional language parameter
  function connect(languageToUse = null) {
    // ✅ Safety check: ensure we have a valid string language code
    let targetLang = lang; // Default to current state
    
    if (typeof languageToUse === 'string' && languageToUse) {
      targetLang = languageToUse; // Use provided language if it's a valid string
    }
    
    console.log(`🔌 Connecting with language: ${targetLang}`);
    
    setStatus("connecting...");
    // ✅ Pass language as query parameter
const roomId = new URLSearchParams(window.location.search).get("room") || "default";
const wsUrl = `wss://mvp-flames-production.up.railway.app/ws/student?roomId=${roomId}&lang=${targetLang}`;

    console.log(`📡 WebSocket URL: ${wsUrl}`);
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus(`connected (${LANGS.find(l => l.code === targetLang)?.label || targetLang})`);
      console.log(`✅ Connected with language: ${targetLang}`);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);

        // pose from teacher
        if (msg.type === "pose") {
          setPose({
            yaw: msg.yaw ?? 0,
            pitch: msg.pitch ?? 0,
            roll: msg.roll ?? 0,
            blinkL: msg.blinkL ?? 0,
            blinkR: msg.blinkR ?? 0,
            mouth: 0,
          });
          return;
        }

        if (msg.type === "text") {
          setEnText(msg.en || "");
          // ✅ Use generic 'out' field for any language
          setTranslatedText(msg.out || msg.ar || "");
          return;
        }

        const id = msg.id;
        if (!id) return;

        const map = utterMapRef.current;
        const item = map.get(id) || { id };
        map.set(id, item);

        if (msg.type === "audio") item.audioBase64 = msg.wavBase64;
        if (msg.type === "visemes") item.visemes = msg.visemes;

        if (item.audioBase64 && item.visemes) {
          map.delete(id);
          playQueueRef.current = playQueueRef.current.then(() =>
            playUtterance(item.audioBase64, item.visemes)
          );
        }
      } catch (e) {
        console.error("parse error", e);
      }
    };

    ws.onerror = () => setStatus("ws error");
    ws.onclose = () => {
      setStatus("disconnected");
      console.log("📴 WebSocket closed");
    };
  }

  function disconnect() {
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    } catch {}
    wsRef.current = null;
    currentVisemeIdRef.current = 0;
    setStatus("idle");
  }

  async function playUtterance(wavBase64, visemes) {
    currentVisemeIdRef.current = 0;
    const audioBlob = new Blob([new Uint8Array(base64ToArrayBuffer(wavBase64))], { type: "audio/wav" });
    const url = URL.createObjectURL(audioBlob);
    const audio = new Audio(url);

    const startMs = performance.now();
    scheduleVisemesRelative(visemes, startMs);

    try { await audio.play(); } catch (e) { console.warn("Audio play blocked:", e); }

    await new Promise((resolve) => { audio.onended = resolve; audio.onerror = resolve; });
    URL.revokeObjectURL(url);
    currentVisemeIdRef.current = 0;
  }

  function scheduleVisemesRelative(items, startMs) {
    const normalized = (items || [])
      .map((x) => ({
        ms: typeof x.audioOffset === "number" ? x.audioOffset : 0,
        id: typeof x.visemeId === "number" ? x.visemeId : 0,
      }))
      .filter((x) => x.ms >= 0)
      .sort((a, b) => a.ms - b.ms);

    for (const v of normalized) {
      setTimeout(() => {
        currentVisemeIdRef.current = v.id;
      }, Math.max(0, startMs + v.ms - performance.now()));
    }
  }

  // ✅ FIXED: Reconnect when language changes (if already connected)
  const handleLanguageChange = (newLang) => {
    const wasConnected = wsRef.current && wsRef.current.readyState === WebSocket.OPEN;
    
    console.log(`🔄 Language change: ${lang} → ${newLang}, wasConnected: ${wasConnected}`);
    
    // Update language state
    setLang(newLang);
    
    // If connected, disconnect and reconnect with new language
    if (wasConnected) {
      setStatus("switching language...");
      
      // Clear current data
      setEnText("");
      setTranslatedText("");
      
      // Force disconnect
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch (e) {
          console.warn("Error closing websocket:", e);
        }
        wsRef.current = null;
      }
      
      // ✅ FIX: Pass newLang directly to connect to avoid race condition
      setTimeout(() => {
        connect(newLang); // Pass the new language explicitly
      }, 500); // Increased timeout for clean disconnect
    }
  };

  useEffect(() => {
    // Don't auto-connect on mount - let user choose language first
    return () => disconnect();
  }, []);

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        {/* LEFT */}
        <div style={styles.left}>
          <div style={styles.card}>
            <div style={styles.headerRow}>
              <div>
                <h2 style={styles.title}>Student Room 🌍</h2>
                <div style={styles.subtitle}>
                  Multi-language support: OpenAI STT + Translation + Azure TTS visemes
                </div>
              </div>
              <div style={styles.badge}><b>Status:</b> {status}</div>
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.row}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 4 }}>
                  Select Language
                </div>
                <select 
                  style={styles.select} 
                  value={lang} 
                  onChange={(e) => handleLanguageChange(e.target.value)}
                >
                  {LANGS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ flex: 1 }} />

              <button 
                style={styles.btnPrimary} 
                onClick={() => connect()}
                disabled={status !== "idle" && status !== "disconnected"}
              >
                Connect
              </button>
              <button 
                style={styles.btnSecondary} 
                onClick={disconnect}
                disabled={status === "idle" || status === "disconnected"}
              >
                Disconnect
              </button>
            </div>

            <div style={styles.hint}>
              💡 <b>Tip:</b> Select your language before connecting. 
              If audio doesn't play, click once anywhere on the page (autoplay policy).
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.boxTitle}>Teacher said (English)</div>
            <div style={styles.textBox(false)}>{enText}</div>

            <div style={{ height: 10 }} />

            <div style={styles.boxTitle}>
              Translated ({LANGS.find(l => l.code === lang)?.label || lang})
            </div>
            <div style={styles.textBox(isRTL)}>{translatedText}</div>
          </div>

          <div style={{ ...styles.card, opacity: 0.9 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
              What's happening
            </div>
            <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.6 }}>
              Teacher streams audio → server transcribes (OpenAI Whisper) → 
              translates to your language (OpenAI GPT-4) → 
              generates speech + visemes (Azure TTS) → 
              your avatar lip-syncs and speaks. Teacher's head/eye pose is forwarded live.
            </div>
          </div>

          <div style={{ ...styles.card, background: "rgba(120,180,255,0.08)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
              🌍 Supported Languages
            </div>
            <div style={{ fontSize: 11, opacity: 0.85, lineHeight: 1.5 }}>
              {LANGS.map(l => `${l.label}`).join(" • ")}
            </div>
          </div>
        </div>

        {/* RIGHT: Avatar */}
        <div style={styles.right}>
          <div style={styles.avatarHeader}>
            <div style={styles.avatarTitle}>
              3D Avatar ({LANGS.find(l => l.code === lang)?.label || lang})
            </div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Viseme: <b>{currentVisemeIdRef.current}</b>
            </div>
          </div>

          <div style={styles.avatarWrap}>
            <Canvas camera={{ position: [0, 1, 10], fov: 45 }} style={{ width: "100%", height: "100%" }}>
              <ambientLight intensity={0.85} />
              <directionalLight position={[5, 5, 5]} intensity={1.2} />
              <AvatarRPM pose={pose} currentVisemeId={currentVisemeIdRef} debug={true} />
              <Controls />
            </Canvas>
          </div>
        </div>
      </div>
    </div>
  );
}