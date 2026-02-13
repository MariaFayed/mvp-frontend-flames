import React, { useEffect, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Azure visemeId (0..21) -> RPM viseme_* (15 targets)
 * You already have these exact morphs:
 * ['viseme_sil','viseme_PP','viseme_FF','viseme_TH','viseme_DD','viseme_kk','viseme_CH','viseme_SS','viseme_nn','viseme_RR','viseme_aa','viseme_E','viseme_I','viseme_O','viseme_U']
 *
 * This mapping is a practical MVP grouping.
 * (We can refine later if you want more accurate phoneme grouping.)
 */
function azureToRpmVisemeName(id) {
  switch (id) {
    case 0: return "viseme_sil";
    case 1: return "viseme_PP";
    case 2: return "viseme_FF";
    case 3: return "viseme_TH";
    case 4: return "viseme_DD";
    case 5: return "viseme_kk";
    case 6: return "viseme_CH";
    case 7: return "viseme_SS";
    case 8: return "viseme_nn";
    case 9: return "viseme_RR";
    case 10: return "viseme_aa";
    case 11: return "viseme_E";
    case 12: return "viseme_I";
    case 13: return "viseme_O";
    case 14: return "viseme_U";

    // Remaining Azure visemes → nearest mouth shapes
    case 15: return "viseme_aa";
    case 16: return "viseme_O";
    case 17: return "viseme_U";
    case 18: return "viseme_E";
    case 19: return "viseme_I";
    case 20: return "viseme_PP";
    case 21: return "viseme_TH";

    default: return "viseme_sil";
  }
}

export default function AvatarRPM({ pose, currentVisemeId, debug = false }) {
  const gltf = useLoader(GLTFLoader, "/avatarshapes.glb");

  // Keep avatar standing fixed
  const rootRef = useRef();

  // Morph-capable meshes
  const morphMeshesRef = useRef([]);
  const dictRef = useRef(null);

  // Head bone (rotate ONLY the head, not whole body)
  const headBoneRef = useRef(null);

  // Smooth weights
  const weightsRef = useRef({}); // name -> current weight

  useEffect(() => {
    morphMeshesRef.current = [];
    dictRef.current = null;
    headBoneRef.current = null;

    // Reset the entire scene rotation to face forward
    gltf.scene.rotation.set(0, 0, 0);
    gltf.scene.position.set(0, 0, 0);

    gltf.scene.traverse((obj) => {
      // 1) find morph meshes
      if ((obj.isMesh || obj.isSkinnedMesh) && obj.morphTargetDictionary && obj.morphTargetInfluences) {
        morphMeshesRef.current.push(obj);
        if (!dictRef.current) dictRef.current = obj.morphTargetDictionary;
      }

      // 2) find head bone
      // RPM usually has bones like: Head, Neck, Wolf3D_Head, mixamorigHead, etc.
      if (obj.isBone) {
        const n = (obj.name || "").toLowerCase();
        if (!headBoneRef.current && (n === "head" || n.includes("head"))) {
          headBoneRef.current = obj;
          // Reset head bone to neutral forward-facing position
          obj.rotation.set(0, 0, 0);
        }
      }
    });

    if (debug) {
      console.log("Head bone:", headBoneRef.current?.name);
      if (!dictRef.current) {
        console.warn("No morphTargetDictionary found. Re-export avatar with blendshapes.");
      } else {
        console.log("Morph targets:", Object.keys(dictRef.current));
      }
    }
  }, [gltf, debug]);

  function setMorph(name, value) {
    const meshes = morphMeshesRef.current;
    if (!meshes.length || !dictRef.current) return;

    for (const m of meshes) {
      const dict = m.morphTargetDictionary;
      const inf = m.morphTargetInfluences;
      const idx = dict?.[name];
      if (idx !== undefined && inf && inf[idx] !== undefined) {
        inf[idx] = value;
      }
    }
  }

  useFrame((state, delta) => {
    // --- 1) Rotate only head bone (prevents "falling") ---
    const head = headBoneRef.current;

    if (head) {
      // Apply controlled rotation from neutral (0,0,0) position
      head.rotation.order = 'XYZ';
      
      // Apply pose with small multipliers
      const targetX = pose.pitch * 0.4;;
      const targetY = pose.yaw * 0.9;
      const targetZ = pose.roll * 0.6;
      
      // Smooth the rotation
      head.rotation.x = lerp(head.rotation.x, targetX, 0.15);
      head.rotation.y = lerp(head.rotation.y, targetY, 0.15);
      head.rotation.z = lerp(head.rotation.z, targetZ, 0.15);
    }

    // --- 2) Blink using blendshapes ---
    // Amplify blink values for more visibility (square them to make them more pronounced)
    let blinkL = clamp(pose.blinkL ?? 0, 0, 1);
    let blinkR = clamp(pose.blinkR ?? 0, 0, 1);
    
    // Make blinks more apparent by amplifying the values
    blinkL = Math.pow(blinkL, 0.7) * 2;
    blinkR = Math.pow(blinkR, 0.7) * 2;
    
    blinkL = clamp(blinkL, 0, 1);
    blinkR = clamp(blinkR, 0, 1);

    // --- 3) Viseme morphs ---
    const vid = currentVisemeId?.current ?? 0;
    const activeViseme = azureToRpmVisemeName(vid);

    // We'll drive only these names:
    const visemeNames = [
      "viseme_sil",
      "viseme_PP",
      "viseme_FF",
      "viseme_TH",
      "viseme_DD",
      "viseme_kk",
      "viseme_CH",
      "viseme_SS",
      "viseme_nn",
      "viseme_RR",
      "viseme_aa",
      "viseme_E",
      "viseme_I",
      "viseme_O",
      "viseme_U",
    ];

    // smoothing: higher => snappier mouth
    const speed = 22;
    const t = 1 - Math.exp(-speed * delta);

    // blink smoothing (faster for more responsive blinks)
    const bSpeed = 40;
    const bt = 1 - Math.exp(-bSpeed * delta);

    // Update blink weights
    weightsRef.current.eyeBlinkLeft = lerp(weightsRef.current.eyeBlinkLeft ?? 0, blinkL, bt);
    weightsRef.current.eyeBlinkRight = lerp(weightsRef.current.eyeBlinkRight ?? 0, blinkR, bt);

    setMorph("eyeBlinkLeft", weightsRef.current.eyeBlinkLeft);
    setMorph("eyeBlinkRight", weightsRef.current.eyeBlinkRight);

    // Update viseme weights
    for (const vName of visemeNames) {
      const target = vName === activeViseme ? 1.0 : 0.0;
      const cur = weightsRef.current[vName] ?? 0;
      const next = lerp(cur, target, t);
      const finalVal = Math.abs(next) < 0.001 ? 0 : next;

      weightsRef.current[vName] = finalVal;
      setMorph(vName, finalVal);
    }

    // Optional: keep mouth closed when silent
    // (some avatars look better with a little mouthClose)
    if (activeViseme === "viseme_sil") {
      // If your avatar has mouthClose, keep it small so lips rest nicely
      // Comment this out if it looks weird
      const mouthCloseTarget = 0.15;
      const cur = weightsRef.current.mouthClose ?? 0;
      const next = lerp(cur, mouthCloseTarget, t);
      weightsRef.current.mouthClose = next;
      setMorph("mouthClose", next);
    } else {
      // reduce mouthClose during speech
      const cur = weightsRef.current.mouthClose ?? 0;
      const next = lerp(cur, 0.0, t);
      weightsRef.current.mouthClose = next;
      setMorph("mouthClose", next);
    }
  });

  return (
    <group
      ref={rootRef}
      // Place avatar centered at origin for easy viewing
      position={[0, 0, 0]}
      rotation={[0, 0, 0]}
      scale={[5, 5, 5]}
    >
      <primitive object={gltf.scene} />
    </group>
  );
}