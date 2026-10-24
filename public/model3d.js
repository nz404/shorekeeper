import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MODEL_DIRECTORY = '/model3d/Shorekeeper3D/';
const MODEL_FILE = 'shorekeeper.pmx';
const CAMERA_HEIGHT = 2.8;
const MODEL_HEIGHT = 2.15;
const MODEL_BONE_NAMES = {
  pelvis: '腰',
  lowerBody: '下半身',
  head: '頭',
  neck: '首',
  upperBody: '上半身',
  upperBody2: '上半身2',
  upperBody3: '上半身3',
  leftShoulder: '左肩',
  rightShoulder: '右肩',
  leftLeg: '左足',
  rightLeg: '右足',
  leftKnee: '左ひざ',
  rightKnee: '右ひざ',
  leftAnkle: '左足首',
  rightAnkle: '右足首',
  leftArm: '左腕',
  rightArm: '右腕',
  leftElbow: '左ひじ',
  rightElbow: '右ひじ',
  leftWrist: '左手首',
  rightWrist: '右手首',
};
const getModelBoneName = name => MODEL_BONE_NAMES[name] || name;
// ===== POSE & IDLE =====
// Gaya idle: 'handsFront' = tangan bertaut anggun di depan perut (dihitung pakai IK),
//            'relaxed'    = tangan menjuntai rileks di sisi badan.
// Semua sudut dalam radian. Kiri/kanan di-mirror otomatis.
const IDLE = {
  style: 'handsFront',
  breathPeriod: 3.6,     // detik per napas
  stanceHold: [8, 14],   // berapa lama bertumpu di satu kaki sebelum pindah (detik)
  gazeHold: [3, 7],      // jeda antar lirikan/gerak kepala (detik)
  sighEvery: [16, 26],   // sesekali tarik napas lebih dalam (detik)
  fidgetEvery: [7, 14],  // sesekali membetulkan posisi tangan (detik)
};
// Posisi tangan untuk gaya 'handsFront'. Satuan = unit model PMX (tinggi model sekitar 20.5).
const HANDS = {
  wrist: [0.62, 12.75, 1.30],    // pergelangan KIRI (x, y, z). Kanan di-mirror pada sumbu x. Makin besar x = tangan makin renggang
  rightLayer: [0, 0, 0],         // geser tambahan tangan kanan (x di-mirror). Isi mis. [-0.25, 0.05, 0.22] kalau mau tangan menumpuk
  elbowPole: [0.55, -0.75, -0.35], // arah siku menekuk (keluar, bawah, belakang)
  palm: [-0.2, 0.5, -0.85],      // arah telapak tangan (menghadap perut, sedikit naik)
  fingerCurl: 1.0,               // 1 = rileks, makin besar makin menekuk
  breathLift: 0.035,             // tangan naik-turun halus mengikuti napas
  protract: 0.05,                // bahu sedikit maju
};
// Pose 'relaxed'
const POSE = {
  armDrop: 1.34,      // sudut lengan atas di bawah garis datar. 1.57 = lurus ke bawah
  armForward: 0.08,   // lengan atas diayun sedikit ke depan
  elbowBend: 0.35,    // tekukan siku
  elbowInward: 0.22,  // forearm sedikit mengarah ke badan
  shoulderDrop: 0.05, // bahu turun biar rileks
  wristRelax: 0.07,   // pergelangan tangan sedikit lemas
  fingerCurl: 1,      // 0 = jari lurus kaku, 1 = rileks natural, 1.6 = menggenggam longgar
  asymmetry: 0.03,    // beda tipis kiri-kanan supaya tidak terlihat seperti patung
};
// Kalau kaki memang mau "jalan di tempat" terus-menerus, ubah jadi true.
const ENABLE_WALK_IN_PLACE = false;
// [nama jari, lengkung per ruas 1-3 (rad)]
const FINGER_CURLS = [
  ['人指', [0.16, 0.26, 0.14]],
  ['中指', [0.20, 0.30, 0.16]],
  ['薬指', [0.24, 0.34, 0.18]],
  ['小指', [0.28, 0.38, 0.20]],
];
const FULL_WIDTH_DIGITS = ['１', '２', '３'];

// <pose-math>
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const tmpEuler = new THREE.Euler();
const tmpQA = new THREE.Quaternion();
const tmpSwing = new THREE.Quaternion();
const tmpLocal = new THREE.Quaternion();
const tmpParent = new THREE.Quaternion();
const tmpFingerQ = new THREE.Quaternion();
const qParentWorld = new THREE.Quaternion();
const qMeshWorld = new THREE.Quaternion();
const qParentInMesh = new THREE.Quaternion();
const qArm = new THREE.Quaternion();
const qArc = new THREE.Quaternion();
const qFore = new THREE.Quaternion();
const qRoll = new THREE.Quaternion();
const vS = new THREE.Vector3();
const vN = new THREE.Vector3();
const vP = new THREE.Vector3();
const vE = new THREE.Vector3();
const vW = new THREE.Vector3();
const vU = new THREE.Vector3();
const vF = new THREE.Vector3();
const vF0 = new THREE.Vector3();
const vTarget = new THREE.Vector3();
const vPole = new THREE.Vector3();
const vPalm = new THREE.Vector3();
const vN1 = new THREE.Vector3();
const vCross = new THREE.Vector3();

// Membatasi nilai dalam rentang minimum dan maksimum.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Menghasilkan nilai acak dalam rentang yang diberikan.
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
// Menghaluskan perubahan nilai berdasarkan delta waktu.
const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));
// Menghasilkan kurva halus yang naik dan turun dalam rentang 0 sampai 1.
const bell = x => (x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x) ** 2);
// Memilih item acak, bila memungkinkan menghindari item sebelumnya.
const pick = (list, not) => {
  let value;
  do { value = list[Math.floor(Math.random() * list.length)]; } while (value === not && list.length > 1);
  return value;
};

// Rotasi di ruang-model: ayun maju (sumbu X) lalu miring ke samping (sumbu Z).
// Model menghadap +Z, jadi forward positif = anggota badan yang menggantung bergerak ke depan.
const setSwing = (out, forward, sideways) => {
  out.setFromAxisAngle(AXIS_X, -forward);
  tmpSwing.setFromAxisAngle(AXIS_Z, sideways);
  return out.multiply(tmpSwing);
};

// Ubah rotasi "ruang-model" jadi rotasi lokal bone (untuk bone dengan rest identity).
const applyWorldRotation = (part, parentQuat, worldRotation) => {
  tmpLocal.copy(parentQuat).invert().multiply(worldRotation).multiply(parentQuat).multiply(part.rest);
  part.bone.quaternion.copy(tmpLocal);
};

const makePart = bone => (bone ? { bone, rest: bone.quaternion.clone() } : null);

const setEuler = (part, x, y, z) => {
  if (!part) return;
  tmpEuler.set(x, y, z);
  tmpQA.setFromEuler(tmpEuler);
  part.bone.quaternion.copy(part.rest).multiply(tmpQA);
};

// Posisi rest sebuah bone di ruang-mesh (rest rotation semua bone = identity pada PMX).
const restPositionInMesh = (bone, mesh) => {
  const out = new THREE.Vector3();
  for (let node = bone; node && node !== mesh; node = node.parent) out.add(node.position);
  return out;
};

const buildArmRigs = (lookupBone, mesh) => ['left', 'right'].map((side, index) => {
  const arm = lookupBone(getModelBoneName(`${side}Arm`));
  const elbow = lookupBone(getModelBoneName(`${side}Elbow`));
  const wrist = lookupBone(getModelBoneName(`${side}Wrist`));
  if (!arm || !elbow) return null;
  const restS = restPositionInMesh(arm, mesh);
  const restE = restPositionInMesh(elbow, mesh);
  const restW = wrist ? restPositionInMesh(wrist, mesh) : restE.clone().add(restE).sub(restS);
  const upper = restE.clone().sub(restS);
  const fore = restW.clone().sub(restE);
  const outward = Math.sign(upper.x) || (index === 0 ? 1 : -1);
  const measured = Math.atan2(-upper.y, Math.abs(upper.x));
  const f0 = fore.clone().normalize();
  const palm0 = new THREE.Vector3().crossVectors(f0, AXIS_Z);
  if (palm0.y > 0) palm0.negate();
  palm0.normalize();
  return {
    index,
    side: outward,
    phase: index * Math.PI,
    bias: index === 0 ? POSE.asymmetry : -POSE.asymmetry,
    restDrop: Number.isFinite(measured) ? measured : 0,
    shoulder: makePart(lookupBone(getModelBoneName(`${side}Shoulder`))),
    arm: makePart(arm),
    elbow: makePart(elbow),
    wrist: makePart(wrist),
    shoulderWorld: new THREE.Quaternion(),
    armWorld: new THREE.Quaternion(),
    elbowWorld: new THREE.Quaternion(),
    wristWorld: new THREE.Quaternion(),
    L1: upper.length(),
    L2: fore.length(),
    u0: upper.normalize(),
    f0,
    palm0,
  };
}).filter(Boolean);

const buildFingerBones = (lookupBone, armRigs) => {
  const fingers = [];
  const missing = [];
  ['左', '右'].forEach((prefix, sideIndex) => {
    const rig = armRigs[sideIndex];
    FINGER_CURLS.forEach(([finger, curls], fingerIndex) => {
      curls.forEach((curl, joint) => {
        const name = `${prefix}${finger}${FULL_WIDTH_DIGITS[joint]}`;
        const bone = lookupBone(name);
        if (!bone) { missing.push(name); return; }
        fingers.push({
          bone,
          rest: bone.quaternion.clone(),
          curl,
          side: rig ? rig.side : (sideIndex === 0 ? 1 : -1),
          phase: sideIndex * 1.3 + fingerIndex * 0.9 + joint * 0.4,
        });
      });
    });
  });
  return { fingers, missing };
};

const createIdleRig = (mesh, lookupBone) => {
  const part = key => makePart(lookupBone(getModelBoneName(key)));
  const arms = buildArmRigs(lookupBone, mesh);
  const { fingers, missing } = buildFingerBones(lookupBone, arms);
  return {
    mesh,
    arms,
    fingers,
    missing,
    pelvis: part('pelvis'),
    lowerBody: part('lowerBody'),
    upperBody: part('upperBody'),
    upperBody2: part('upperBody2'),
    upperBody3: part('upperBody3'),
    neck: part('neck'),
    head: part('head'),
    legs: ['left', 'right'].map(side => ({
      side,
      leg: part(`${side}Leg`),
      knee: part(`${side}Knee`),
      ankle: part(`${side}Ankle`),
    })),
  };
};

const createIdleState = () => ({
  stance: 0, stanceTarget: 0.7, nextStanceAt: 7,
  gazeYaw: 0, gazePitch: 0, gazeTilt: 0,
  gazeYawT: 0, gazePitchT: 0, gazeTiltT: 0, nextGazeAt: 2.5,
  eyeX: 0, eyeY: 0,
  sigh: 0, sighStart: -100, nextSighAt: 14,
  fidgetX: 0, fidgetY: 0, fidgetXT: 0, fidgetYT: 0, nextFidgetAt: 9,
  blinkRequest: false,
});

// "Sutradara" idle: memilih kapan pindah tumpuan, melirik, menarik napas dalam, dan
// membetulkan tangan. Semua nilai bergerak lewat damping berbasis waktu, jadi mulus
// dan tidak bergantung frame rate.
const updateIdleState = (st, elapsed, dt) => {
  if (elapsed >= st.nextStanceAt) {
    st.stanceTarget = pick([-0.8, -0.45, 0, 0.45, 0.8], st.stanceTarget);
    st.nextStanceAt = elapsed + rand(...IDLE.stanceHold);
  }
  st.stance = damp(st.stance, st.stanceTarget, 0.75, dt);

  if (elapsed >= st.nextGazeAt) {
    const center = Math.random() < 0.4;
    st.gazeYawT = center ? 0 : rand(-0.28, 0.28);
    st.gazePitchT = center ? 0 : rand(-0.09, 0.05);
    st.gazeTiltT = center ? 0 : rand(-0.06, 0.06);
    st.nextGazeAt = elapsed + rand(...IDLE.gazeHold);
    st.blinkRequest = true;
  }
  st.gazeYaw = damp(st.gazeYaw, st.gazeYawT, 2.2, dt);
  st.gazePitch = damp(st.gazePitch, st.gazePitchT, 2.2, dt);
  st.gazeTilt = damp(st.gazeTilt, st.gazeTiltT, 1.8, dt);
  // mata mendahului kepala: mata langsung menuju target, lalu kembali ke tengah saat kepala menyusul
  st.eyeX = damp(st.eyeX, clamp((st.gazeYawT - st.gazeYaw) * 3.5, -1, 1), 12, dt);
  st.eyeY = damp(st.eyeY, clamp((st.gazePitchT - st.gazePitch) * -5, -1, 1), 12, dt);

  if (elapsed >= st.nextSighAt) {
    st.sighStart = elapsed;
    st.nextSighAt = elapsed + rand(...IDLE.sighEvery);
  }
  st.sigh = bell((elapsed - st.sighStart) / 3.4);

  if (elapsed >= st.nextFidgetAt) {
    const still = Math.random() < 0.4;
    st.fidgetXT = still ? 0 : rand(-0.07, 0.07);
    st.fidgetYT = still ? 0 : rand(-0.06, 0.05);
    st.nextFidgetAt = elapsed + rand(...IDLE.fidgetEvery);
  }
  st.fidgetX = damp(st.fidgetX, st.fidgetXT, 1.6, dt);
  st.fidgetY = damp(st.fidgetY, st.fidgetYT, 1.6, dt);
};

// IK dua-bone analitik: letakkan pergelangan tangan di target (ruang-mesh).
const solveHandIK = (rig, mesh, target, pole, palmDir) => {
  const armBone = rig.arm.bone;
  const parent = armBone.parent;
  parent.updateWorldMatrix(true, false);
  vS.copy(armBone.position).applyMatrix4(parent.matrixWorld);
  mesh.worldToLocal(vS);
  parent.getWorldQuaternion(qParentWorld);
  mesh.getWorldQuaternion(qMeshWorld);
  qParentInMesh.copy(qMeshWorld).invert().multiply(qParentWorld);

  vN.subVectors(target, vS);
  const d = clamp(vN.length(), Math.abs(rig.L1 - rig.L2) + 1e-3, rig.L1 + rig.L2 - 1e-3);
  vN.normalize();
  const a = (rig.L1 * rig.L1 - rig.L2 * rig.L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, rig.L1 * rig.L1 - a * a));
  vP.copy(pole).addScaledVector(vN, -pole.dot(vN));
  if (vP.lengthSq() < 1e-6) vP.set(0, -1, 0);
  vP.normalize();
  vE.copy(vS).addScaledVector(vN, a).addScaledVector(vP, h);
  vW.copy(vS).addScaledVector(vN, d);
  vU.subVectors(vE, vS).normalize();
  vF.subVectors(vW, vE).normalize();

  // lengan atas: rotasi terpendek dari arah rest ke arah baru
  qArm.setFromUnitVectors(rig.u0, vU);
  armBone.quaternion.copy(qParentInMesh).invert().multiply(qArm);
  // forearm: engsel tunggal di siku
  vF0.copy(rig.f0).applyQuaternion(qArm);
  qArc.setFromUnitVectors(vF0, vF);
  qFore.copy(qArc).multiply(qArm);
  rig.elbow.bone.quaternion.copy(qArm).invert().multiply(qFore);
  // pergelangan: putar tangan mengelilingi forearm supaya telapak menghadap palmDir
  if (rig.wrist) {
    vN1.copy(rig.palm0).applyQuaternion(qFore);
    vN1.addScaledVector(vF, -vN1.dot(vF));
    vPalm.copy(palmDir).addScaledVector(vF, -palmDir.dot(vF));
    if (vN1.lengthSq() > 1e-6 && vPalm.lengthSq() > 1e-6) {
      vN1.normalize();
      vPalm.normalize();
      vCross.crossVectors(vN1, vPalm);
      const angle = clamp(Math.atan2(vF.dot(vCross), vN1.dot(vPalm)), -1.1, 1.1);
      qRoll.setFromAxisAngle(vF, angle);
    } else {
      qRoll.identity();
    }
    rig.wrist.bone.quaternion.copy(qFore).invert().multiply(qRoll).multiply(qFore);
  }
};

const applyFingerPose = (fingers, elapsed, amountScale) => {
  for (const { bone, rest, curl, side, phase } of fingers) {
    // sedikit napas pada jari supaya tangan tidak "membeku"
    const amount = (curl + Math.sin(elapsed * 0.35 + phase) * 0.025) * amountScale;
    tmpFingerQ.setFromAxisAngle(AXIS_Z, -side * amount);
    bone.quaternion.copy(rest).multiply(tmpFingerQ);
  }
};

// Gaya 'relaxed': tangan menjuntai dengan tekukan siku kecil.
const applyRelaxedArms = (rigs, elapsed, breath) => {
  for (const rig of rigs) {
    const s = rig.side;
    const sway = Math.sin(elapsed * 0.42 + rig.phase) * 0.012;
    const shoulderDrop = POSE.shoulderDrop - breath * 0.005;
    if (rig.shoulder) {
      rig.shoulderWorld.setFromAxisAngle(AXIS_Z, -s * shoulderDrop);
      rig.shoulder.bone.quaternion.copy(rig.shoulderWorld).multiply(rig.shoulder.rest);
    }
    const drop = POSE.armDrop - rig.restDrop - POSE.shoulderDrop + rig.bias * 0.5;
    setSwing(rig.armWorld, POSE.armForward + sway, -s * drop);
    rig.arm.bone.quaternion.copy(rig.armWorld).multiply(rig.arm.rest);
    setSwing(rig.elbowWorld, POSE.elbowBend + rig.bias + breath * 0.008, -s * POSE.elbowInward);
    applyWorldRotation(rig.elbow, rig.arm.bone.quaternion, rig.elbowWorld);
    if (rig.wrist) {
      tmpParent.copy(rig.arm.bone.quaternion).multiply(rig.elbow.bone.quaternion);
      setSwing(rig.wristWorld, 0, -s * POSE.wristRelax);
      applyWorldRotation(rig.wrist, tmpParent, rig.wristWorld);
    }
  }
};

// Gaya 'handsFront': tangan bertaut di depan perut, ikut naik-turun halus bersama napas.
const applyHandsFront = (rig, st, elapsed, breath) => {
  for (const arm of rig.arms) {
    const s = arm.side;
    if (arm.shoulder) {
      tmpEuler.set(0, -s * (HANDS.protract + breath * 0.004), -s * (POSE.shoulderDrop - breath * 0.005));
      tmpQA.setFromEuler(tmpEuler);
      arm.shoulder.bone.quaternion.copy(tmpQA).multiply(arm.shoulder.rest);
    }
    vTarget.set(HANDS.wrist[0] * s, HANDS.wrist[1], HANDS.wrist[2]);
    if (arm.index === 1) vTarget.add(vN.set(HANDS.rightLayer[0] * s, HANDS.rightLayer[1], HANDS.rightLayer[2]));
    vTarget.z += st.fidgetX;
    vTarget.y += st.fidgetY + breath * HANDS.breathLift + Math.sin(elapsed * 0.5 + arm.phase) * 0.012;
    vPole.set(HANDS.elbowPole[0] * s, HANDS.elbowPole[1], HANDS.elbowPole[2]);
    vPalm.set(HANDS.palm[0] * s, HANDS.palm[1], HANDS.palm[2]);
    solveHandIK(arm, rig.mesh, vTarget, vPole, vPalm);
  }
};

// Menerapkan seluruh pose idle (badan, kaki, tangan, kepala) untuk satu frame.
const applyIdlePose = (rig, st, elapsed, opts = {}) => {
  const { talking = false, lookX = 0, lookY = 0 } = opts;
  const s = st.stance; // + = bertumpu pada kaki kiri, - = kaki kanan
  const breath = Math.sin(elapsed * Math.PI * 2 / IDLE.breathPeriod) * (1 + st.sigh * 1.3);
  const settle = Math.sin(elapsed * 0.31 + 1.4);

  // badan: pinggul miring ke sisi tumpuan, bahu miring berlawanan, kepala tetap rata
  setEuler(rig.pelvis, 0, Math.sin(elapsed * 0.42) * 0.004, s * 0.018 + settle * 0.002);
  setEuler(rig.lowerBody, 0, Math.sin(elapsed * 0.42 + 0.3) * 0.006, -s * 0.018);
  setEuler(rig.upperBody, breath * 0.006 + (talking ? 0.01 : 0), Math.sin(elapsed * 0.36) * 0.004,
    -s * 0.03 + Math.sin(elapsed * 0.55) * 0.003);
  setEuler(rig.upperBody2, breath * 0.005, 0, 0);
  setEuler(rig.upperBody3, breath * 0.006 + (talking ? 0.012 : 0), st.gazeYaw * 0.15, s * 0.012);

  // kaki: kaki yang tidak menopang sedikit menekuk dan maju
  for (const { side, leg, knee, ankle } of rig.legs) {
    const free = side === 'left' ? Math.max(0, -s) : Math.max(0, s);
    setEuler(leg, -0.035 * free, 0, 0);
    setEuler(knee, 0.07 * free, 0, 0);
    setEuler(ankle, -0.035 * free, 0, 0);
  }

  // tangan
  if (IDLE.style === 'relaxed') {
    applyRelaxedArms(rig.arms, elapsed, breath);
    applyFingerPose(rig.fingers, elapsed, POSE.fingerCurl);
  } else {
    applyHandsFront(rig, st, elapsed, breath);
    applyFingerPose(rig.fingers, elapsed, HANDS.fingerCurl);
  }

  // leher & kepala: gerak dasar + lirikan idle + mengikuti kursor
  const baseDown = IDLE.style === 'relaxed' ? 0 : 0.02;
  setEuler(rig.neck,
    Math.sin(elapsed * 0.72) * 0.012 + (talking ? -0.018 : 0) + st.gazePitch * 0.4 - lookY * 0.025 + baseDown * 0.4,
    Math.sin(elapsed * 0.33 + 0.8) * 0.035 + st.gazeYaw * 0.4 + lookX * 0.075,
    Math.sin(elapsed * 0.48) * 0.018 + st.gazeTilt * 0.4);
  setEuler(rig.head,
    Math.sin(elapsed * 0.7 + 0.6) * 0.012 + st.gazePitch * 0.6 - lookY * 0.04 + baseDown * 0.6,
    Math.sin(elapsed * 0.29) * 0.045 + st.gazeYaw * 0.6 + lookX * 0.16,
    Math.sin(elapsed * 0.43 + 1.2) * 0.018 + st.gazeTilt * 0.6);
};
// </pose-math>

const IDLE_RHYTHM = 10.5;
const REACTION_GESTURES = {
  surprised: {
    upperBody3: [-0.025, 0, 0],
    neck: [-0.012, 0, 0],
    head: [-0.025, 0, 0],
  },
  shy: {
    upperBody3: [0.008, 0, -0.008],
    neck: [0.012, 0.018, -0.012],
    head: [0.008, -0.035, 0.018],
  },
  crying: {
    upperBody3: [0.012, 0, 0],
    neck: [0.025, -0.015, 0.018],
    head: [0.035, -0.045, 0.025],
    leftShoulder: [0.008, 0, 0.012],
    rightShoulder: [0.008, 0, -0.012],
  },
  cat: {
    neck: [0, 0.035, 0],
    head: [0, 0.08, -0.025],
  },
  angry: {
    upperBody3: [-0.01, 0, 0],
    neck: [-0.015, -0.025, 0],
    head: [-0.025, -0.04, 0],
  },
  curious: {
    upperBody3: [0, 0.015, 0.025],
    neck: [0.015, 0.1, 0],
    head: [0, 0.16, -0.04],
    leftShoulder: [0, 0, 0.025],
    rightShoulder: [0, 0, -0.025],
  },
  reassure: {
    upperBody3: [-0.008, 0, 0],
    neck: [0.008, -0.025, 0.01],
    head: [-0.015, -0.035, 0.015],
  },
  alert: {
    upperBody3: [-0.035, 0, 0],
    neck: [-0.025, 0, 0],
    leftShoulder: [0, 0, -0.07],
    rightShoulder: [0, 0, 0.07],
    leftArm: [0, 0, -0.1],
    rightArm: [0, 0, 0.1],
  },
  think: {
    upperBody3: [0, 0.015, 0],
    neck: [0, -0.08, 0],
    head: [0, -0.12, 0.03],
    leftShoulder: [0, 0, 0.04],
    rightShoulder: [0, 0, -0.04],
  },
  greet: {
    upperBody3: [0, 0, 0],
    rightShoulder: [0, 0, 0.16],
    rightArm: [0, 0, 0.34],
    rightElbow: [0, 0, -0.12],
    rightWrist: [0, 0, 0.06],
  },
  celebrate: {
    upperBody3: [-0.008, 0, 0],
    neck: [-0.008, 0.012, 0],
    head: [-0.018, 0.025, 0],
  },
  talk: {
    neck: [-0.01, 0, 0],
    head: [-0.025, 0, 0],
    upperBody3: [0.008, 0, 0],
  },
};

const gestureForExpression = {
  surprised: 'surprised',
  blush: 'shy',
  confused: 'curious',
  heart: 'reassure',
  star: 'celebrate',
  crying: 'crying',
  cat: 'cat',
  angry: 'angry',
};

const expressionPatterns = {
  surprised: [/驚|驚き|びっくり|惊讶|surpris|shock/i],
  blush: [/照れ|赤面|脸红|blush|cheek/i],
  confused: [/困|怪訝|疑|confus|疑惑/i],
  angry: [/^怒り$/i, /^ｷﾘｯ$/i],
  heart: [/はぁと|ハート|heart|love|愛情|♡|❤/i],
  star: [/星目|星|happy|star/i],
  crying: [/^困る$/i, /^垂れ目$/i, /^口角下げ$/i],
  cat: [/^はちゅ目$/i, /^にやり$/i],
};

const REACTION_TURNS = {
  surprised: 0.035,
  shy: -0.055,
  crying: -0.025,
  cat: 0.07,
  angry: -0.035,
  curious: 0.045,
  reassure: -0.025,
  alert: -0.025,
  think: -0.04,
  greet: 0.06,
  celebrate: 0.035,
  talk: 0,
};

const smoothStep = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

const getMorphTargets = root => {
  const targets = [];
  root.traverse(object => {
    const dictionary = object.morphTargetDictionary;
    if (!dictionary || !object.morphTargetInfluences) return;
    for (const [name, index] of Object.entries(dictionary)) {
      targets.push({ object, index, name });
    }
  });
  return targets;
};

export function createShorekeeper3D(canvas, initialSettings, onStatus = () => { }) {
  return new Promise((resolve, reject) => {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => {
      const resolved = new URL(url, window.location.href);
      const path = decodeURIComponent(resolved.pathname);
      if (path.toLowerCase() === `${MODEL_DIRECTORY}tex/cheek_00.tga`.toLowerCase()
        && path.includes('/Tex/')) {
        resolved.pathname = `${MODEL_DIRECTORY}tex/cheek_00.tga`;
        return resolved.href;
      }
      return url;
    });

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xd9edff, 0x182030, 0.9));

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.25);
    keyLight.position.set(-3, 5, 6);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x8ab9e8, 0.4);
    fillLight.position.set(4, 2, -4);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xaac8ff, 0.25);
    rimLight.position.set(0, 2, -5);
    scene.add(rimLight);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.82;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.enableZoom = false;

    const modelRoot = new THREE.Group();
    scene.add(modelRoot);

    let mesh = null;
    let morphTargets = [];
    let activeExpression = [];
    let expressionTransition = [];
    let expressionTransitionStartedAt = 0;
    let mouthTargets = [];
    let breathTargets = [];
    let blinkTargets = [];
    let idleRig = null;
    const idle = createIdleState();
    let lastElapsed = 0;
    let gaitBones = [];
    let eyeLookTargets = [];
    let secondaryBones = [];
    let reactionBones = [];
    let boneByName = new Map();
    let boneByNormalizedName = new Map();
    let baseModelY = 0;
    let settings = { ...initialSettings };
    let fitScale = 1;
    let isDragging = false;
    let isTalking = false;
    let motionTimer = null;
    let expressionTimer = null;
    let frameId = 0;
    let disposed = false;
    let warnedExpression = false;
    let nextBlinkAt = 3;
    let blinkStartedAt = -1;
    let pointerX = 0;
    let pointerY = 0;
    let lookX = 0;
    let lookY = 0;
    let reactionGesture = '';
    let reactionStartedAt = 0;
    let reactionDuration = 1.8;
    const clock = new THREE.Clock();
    const breathingEuler = new THREE.Euler();
    const breathingQuaternion = new THREE.Quaternion();
    const reactionQuaternion = new THREE.Quaternion();
    const updatePointerTarget = event => {
      if (isDragging) return;
      const bounds = canvas.getBoundingClientRect();
      pointerX = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1));
      pointerY = Math.max(-1, Math.min(1, 1 - ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2));
    };
    const resetPointerTarget = () => {
      pointerX = 0;
      pointerY = 0;
    };

    const playReaction = (name, duration = 2.4) => {
      if (!REACTION_GESTURES[name]) return false;
      reactionGesture = name;
      reactionStartedAt = clock.getElapsedTime();
      reactionDuration = Math.max(0.8, Math.min(8, duration));
      return true;
    };
    const elapsedGestureFinished = () => {
      return (clock.getElapsedTime() - reactionStartedAt) >= reactionDuration;
    };

    controls.addEventListener('start', () => { isDragging = true; });
    controls.addEventListener('end', () => { isDragging = false; resetPointerTarget(); });
    canvas.addEventListener('pointermove', updatePointerTarget);
    canvas.addEventListener('pointerleave', resetPointerTarget);

    const resize = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const aspect = width / height;
      camera.left = -CAMERA_HEIGHT * aspect / 2;
      camera.right = CAMERA_HEIGHT * aspect / 2;
      camera.top = CAMERA_HEIGHT / 2;
      camera.bottom = -CAMERA_HEIGHT / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      applySettings();
    };

    const applySettings = () => {
      if (!mesh) return;
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const worldPerPixel = CAMERA_HEIGHT / height;
      const scale = Math.max(0.3, Math.min(2, Number(settings.scale) / 100 || 0.92));
      const modelHeight = MODEL_HEIGHT * scale;
      const centerY = -CAMERA_HEIGHT / 2 + modelHeight / 2;
      modelRoot.scale.setScalar(fitScale * scale);
      modelRoot.position.set(
        (Number(settings.offsetX) || 0) * worldPerPixel,
        centerY + (Number(settings.offsetY) || 0) * worldPerPixel,
        0,
      );
      baseModelY = modelRoot.position.y;
      controls.target.set(0, centerY, 0);
      controls.update();
      camera.left = -CAMERA_HEIGHT * width / height / 2;
      camera.right = CAMERA_HEIGHT * width / height / 2;
      camera.top = CAMERA_HEIGHT / 2;
      camera.bottom = -CAMERA_HEIGHT / 2;
      camera.updateProjectionMatrix();
    };

    const setExpression = name => {
      const expressionName = name.toLowerCase();
      const patterns = expressionPatterns[expressionName] || (name ? [new RegExp(name, 'i')] : []);
      let matched = name
        ? morphTargets.filter(target => patterns.some(pattern => pattern.test(target.name)))
        : [];
      if (expressionName === 'heart' && matched.length === 0) {
        matched = morphTargets
          .filter(({ name: targetName }) => /微笑|にこり|笑顔|笑い|smile|happy/i.test(targetName)
            && !/eye|目|瞳|wink|blink|まばたき/i.test(targetName))
          .slice(0, 1);
      }
      if (expressionName === 'crying' && matched.length === 0) {
        matched = morphTargets.filter(({ name: targetName }) => /sad|困る|垂れ目|口角下げ/i.test(targetName));
      }
      if (expressionName === 'cat' && matched.length === 0) {
        matched = morphTargets.filter(({ name: targetName }) => /はちゅ目|猫|cat/i.test(targetName));
      }
      if (name && matched.length === 0) {
        if (!warnedExpression) {
          console.warn('Model PMX tidak memiliki morph yang cocok untuk ekspresi dashboard.');
          warnedExpression = true;
        }
      }

      const nextTargets = new Set(matched);
      expressionTransition = [...new Set([...activeExpression, ...expressionTransition, ...matched])].map(target => ({
        ...target,
        from: target.object.morphTargetInfluences[target.index],
        to: nextTargets.has(target) ? 1 : 0,
      }));
      expressionTransitionStartedAt = clock.getElapsedTime();
      activeExpression = matched;
      if (expressionTimer) clearTimeout(expressionTimer);
      if (name) expressionTimer = setTimeout(() => setExpression(''), 4000);
    };

    const setTalking = value => {
      isTalking = value;
      if (!isTalking) {
        for (const target of mouthTargets) target.object.morphTargetInfluences[target.index] = 0;
      }
    };

    const animate = () => {
      if (disposed) return;
      frameId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();
      const dt = Math.min(0.1, Math.max(0, elapsed - lastElapsed));
      lastElapsed = elapsed;
      if (mesh) {
        for (const { bone, restRotation } of reactionBones) bone.quaternion.copy(restRotation);
        const weightShift = Math.sin(elapsed * (Math.PI * 2 / IDLE_RHYTHM));
        const walkPhase = elapsed * 4.2;
        modelRoot.position.x = (Number(settings.offsetX) || 0) * (CAMERA_HEIGHT / Math.max(1, canvas.clientHeight))
          + weightShift * 0.003;
        modelRoot.position.y = baseModelY;
        const reactionProgress = (elapsed - reactionStartedAt) / reactionDuration;
        const reactionWeight = reactionProgress >= 0 && reactionProgress <= 1
          ? Math.min(smoothStep(reactionProgress / 0.18), smoothStep((1 - reactionProgress) / 0.22))
          : 0;
        if (!isDragging) {
          modelRoot.rotation.y = weightShift * 0.008
            + Math.sin(elapsed * 0.17 + 0.5) * 0.012
            + (REACTION_TURNS[reactionGesture] || 0) * reactionWeight;
        }
        modelRoot.rotation.x = isTalking ? Math.sin(elapsed * 2.5) * 0.012 : 0;

        // idle: napas, tumpuan kaki, tangan, leher & kepala (lihat blok "POSE & IDLE" di atas)
        updateIdleState(idle, elapsed, dt);
        lookX = damp(lookX, pointerX, 5.1, dt);
        lookY = damp(lookY, pointerY, 5.1, dt);
        if (idleRig) applyIdlePose(idleRig, idle, elapsed, { talking: isTalking, lookX, lookY });
        if (ENABLE_WALK_IN_PLACE) {
          for (const { bone, initialRotation, kind, side } of gaitBones) {
            const phase = walkPhase + side;
            const stride = Math.sin(phase);
            const kneeFlex = Math.max(0, stride) * 0.42;
            if (kind === 'leg') breathingEuler.set(stride * 0.1, 0, stride * 0.28);
            else if (kind === 'knee') breathingEuler.set(kneeFlex * 0.45, 0, kneeFlex * 0.7);
            else breathingEuler.set(-stride * 0.04, 0, -stride * 0.12 - kneeFlex * 0.25);
            breathingQuaternion.setFromEuler(breathingEuler);
            bone.quaternion.copy(initialRotation).multiply(breathingQuaternion);
          }
        }
        for (const { bone, restRotation, amplitude, phase, axis, level } of secondaryBones) {
          const wave = Math.sin(elapsed * (axis === 'hair' ? 0.72 : 0.9) - level * 0.24 + phase);
          const lag = Math.sin(elapsed * 0.42 - level * 0.18 + phase) * amplitude * 0.32;
          breathingEuler.set(
            axis === 'hair' ? wave * amplitude * 0.65 : lag,
            axis === 'hair' ? lag : wave * amplitude * 0.45,
            wave * amplitude + lag,
          );
          breathingQuaternion.setFromEuler(breathingEuler);
          bone.quaternion.copy(restRotation).multiply(breathingQuaternion);
        }
        const eyeX = clamp(lookX + idle.eyeX, -1, 1);
        const eyeY = clamp(lookY + idle.eyeY, -1, 1);
        for (const { target, direction } of eyeLookTargets) {
          const weight = direction === 'left' ? Math.max(0, -eyeX)
            : direction === 'right' ? Math.max(0, eyeX)
              : direction === 'up' ? Math.max(0, eyeY)
                : Math.max(0, -eyeY);
          target.object.morphTargetInfluences[target.index] = weight * 0.35;
        }
        const reaction = REACTION_GESTURES[reactionGesture];
        if (reaction && reactionWeight > 0) {
          for (const [name, rotation] of Object.entries(reaction)) {
            const bone = boneByName.get(getModelBoneName(name));
            if (!bone) continue;
            breathingEuler.set(
              rotation[0] * reactionWeight,
              rotation[1] * reactionWeight,
              rotation[2] * reactionWeight,
            );
            reactionQuaternion.setFromEuler(breathingEuler);
            bone.quaternion.multiply(reactionQuaternion);
          }
        }
        const mouthValue = isTalking ? 0.18 + Math.max(0, Math.sin(elapsed * 10)) * 0.55 : 0;
        const expressionProgress = Math.min(1, (elapsed - expressionTransitionStartedAt) / 0.32);
        const expressionWeight = expressionProgress * expressionProgress * (3 - 2 * expressionProgress);
        for (const target of expressionTransition) {
          target.object.morphTargetInfluences[target.index] = target.from
            + (target.to - target.from) * expressionWeight;
        }
        if (expressionProgress >= 1) expressionTransition = [];
        for (let i = 0; i < mouthTargets.length; i++) {
          const weight = i === Math.floor((elapsed * 2) % Math.max(1, mouthTargets.length)) ? 1 : 0;
          mouthTargets[i].object.morphTargetInfluences[mouthTargets[i].index] = mouthValue * weight;
        }
        if (idle.blinkRequest) {
          // berkedip saat mulai melirik, seperti manusia
          nextBlinkAt = Math.min(nextBlinkAt, elapsed + 0.15);
          idle.blinkRequest = false;
        }
        if (elapsed >= nextBlinkAt) {
          blinkStartedAt = elapsed;
          nextBlinkAt = elapsed + 3.5 + Math.random() * 3;
        }
        const blinkProgress = (elapsed - blinkStartedAt) / 0.18;
        const blinkValue = blinkProgress >= 0 && blinkProgress <= 1 ? Math.sin(Math.PI * blinkProgress) : 0;
        for (const target of blinkTargets) {
          target.object.morphTargetInfluences[target.index] = blinkValue;
        }
        const breathValue = 0.015 + Math.sin(elapsed * 1.5) * 0.01;
        for (const target of breathTargets) {
          target.object.morphTargetInfluences[target.index] = breathValue;
        }
      }
      controls.update();
      renderer.render(scene, camera);
    };

    const loader = new MMDLoader(manager);
    const modelUrl = new URL(`${MODEL_DIRECTORY}${encodeURIComponent(MODEL_FILE)}`, window.location.origin).href;
    onStatus('Memuat model PMX dan tekstur...');
    loader.load(modelUrl, loadedMesh => {
      if (disposed) {
        loadedMesh.traverse(object => {
          object.geometry?.dispose();
          if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
          else object.material?.dispose();
        });
        return;
      }

      mesh = loadedMesh;
      mesh.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(mesh);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      if (!Number.isFinite(size.y) || size.y <= 0) {
        reject(new Error('Model PMX tidak memiliki tinggi yang valid.'));
        return;
      }

      mesh.position.sub(center);
      modelRoot.add(mesh);
      fitScale = MODEL_HEIGHT / size.y;
      mesh.traverse(object => {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material?.emissive) material.emissive.multiplyScalar(0.45);
        }
      });
      boneByName = new Map(mesh.skeleton.bones.map(bone => [bone.name, bone]));
      // nama bone jari biasanya pakai angka full-width (１), sebagian model pakai 1 biasa; normalisasi biar dua-duanya ketemu
      boneByNormalizedName = new Map(mesh.skeleton.bones.map(bone => [bone.name.normalize('NFKC'), bone]));
      const lookupBone = name => boneByName.get(name) || boneByNormalizedName.get(name.normalize('NFKC'));
      idleRig = createIdleRig(mesh, lookupBone);
      if (idleRig.missing.length) {
        console.info('[model3d] bone jari tidak ditemukan (dilewati):', idleRig.missing.join(', '));
      }
      morphTargets = getMorphTargets(mesh);
      mouthTargets = morphTargets.filter(({ name }) => /^(あ|い|う|え|お|a|i|u|e|o)$/i.test(name.trim())
        || /口開|口あ|口い|口う|口え|口お|mouth[\s_-]*open|open[\s_-]*mouth/i.test(name));
      breathTargets = morphTargets.filter(({ name }) => /呼吸|breath/i.test(name));
      blinkTargets = morphTargets.filter(({ name }) => /まばたき|blink/i.test(name));
      secondaryBones = (mesh.skeleton?.bones || [])
        .map((bone, index) => {
          const name = bone.name;
          const hair = /Bone_Hair|发|后发/.test(name);
          const skirt = /skirt|スカート/.test(name);
          if (!hair && !skirt) return null;
          const indices = [...name.matchAll(/_(\d+)/g)].map(match => Number(match[1]));
          const hairNumber = Number(name.match(/(?:Hair|发)(\d+)/i)?.[1] || name.match(/(\d+)$/)?.[1] || 1);
          const level = skirt ? (indices[0] ?? 1) : hairNumber % 10 || 1;
          const strand = indices[1] ?? index % 9;
          return {
            bone,
            restRotation: bone.quaternion.clone(),
            axis: hair ? 'hair' : 'skirt',
            level,
            phase: strand * 0.72 + (index % 2) * Math.PI,
            amplitude: hair ? 0.025 + Math.min(level, 5) * 0.009 : 0.012 + Math.min(level, 10) * 0.002,
          };
        })
        .filter(Boolean);
      gaitBones = [
        ['leftLeg', 'leg', 0],
        ['rightLeg', 'leg', Math.PI],
        ['leftKnee', 'knee', 0],
        ['rightKnee', 'knee', Math.PI],
        ['leftAnkle', 'ankle', 0],
        ['rightAnkle', 'ankle', Math.PI],
      ].map(([name, kind, side]) => {
        const bone = boneByName.get(getModelBoneName(name));
        return bone ? { bone, kind, side, initialRotation: bone.quaternion.clone() } : null;
      }).filter(Boolean);
      eyeLookTargets = morphTargets
        .filter(({ name }) => /^(up|down|left|right)$/i.test(name.trim()))
        .map(target => ({
          target,
          direction: target.name.trim().toLowerCase(),
        }));
      const reactionBoneNames = new Set(Object.values(REACTION_GESTURES).flatMap(gesture => Object.keys(gesture)));
      reactionBones = [...reactionBoneNames]
        .map(name => {
          const bone = boneByName.get(getModelBoneName(name));
          return bone ? { bone, restRotation: bone.quaternion.clone() } : null;
        })
        .filter(Boolean);

      resize();
      window.addEventListener('resize', resize);
      onStatus('');
      animate();

      resolve({
        get isDragging() { return isDragging; },
        setSettings(nextSettings) {
          settings = { ...settings, ...nextSettings };
          applySettings();
        },
        expression: setExpression,
        react(name, duration = 2.4) {
          playReaction(gestureForExpression[name] || name, duration);
        },
        motion(name, duration = 3500) {
          if (motionTimer) clearTimeout(motionTimer);
          if (/talk/i.test(name)) {
            setTalking(true);
            if (elapsedGestureFinished()) playReaction('talk', duration);
            motionTimer = setTimeout(() => setTalking(false), duration);
          } else {
            setTalking(false);
            if (/daji|blush|shy/i.test(name)) playReaction('shy', duration / 1000);
            else if (!/idle/i.test(name)) playReaction(name, duration / 1000);
          }
        },
        dispose() {
          disposed = true;
          cancelAnimationFrame(frameId);
          clearTimeout(motionTimer);
          clearTimeout(expressionTimer);
          window.removeEventListener('resize', resize);
          canvas.removeEventListener('pointermove', updatePointerTarget);
          canvas.removeEventListener('pointerleave', resetPointerTarget);
          controls.dispose();
          renderer.dispose();
          scene.traverse(object => {
            object.geometry?.dispose();
            if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
            else object.material?.dispose();
          });
        },
      });
    }, undefined, error => {
      if (!disposed) reject(error);
    });
  });
}