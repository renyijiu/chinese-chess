import { mkdir, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

class NodeFileReader {
  result = null;
  onloadend = null;

  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }

  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      const type = blob.type || "application/octet-stream";
      this.result = `data:${type};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onloadend?.();
    });
  }
}

globalThis.FileReader ??= NodeFileReader;

const palette = {
  lacquer: new THREE.MeshStandardMaterial({ name: "Cinnabar lacquer", color: 0x681f1b, roughness: 0.56, metalness: 0.2 }),
  lacquerLight: new THREE.MeshStandardMaterial({ name: "Vermilion cloth", color: 0x8e332a, roughness: 0.78, metalness: 0.02 }),
  bronze: new THREE.MeshStandardMaterial({ name: "Antique bronze", color: 0x5b4932, roughness: 0.48, metalness: 0.72 }),
  gold: new THREE.MeshStandardMaterial({ name: "Aged gold", color: 0xad7a32, roughness: 0.36, metalness: 0.82 }),
  stone: new THREE.MeshStandardMaterial({ name: "Warm limestone", color: 0xa89b82, roughness: 0.9, metalness: 0.02 }),
  skin: new THREE.MeshStandardMaterial({ name: "Skin", color: 0x9f6948, roughness: 0.8, metalness: 0 }),
  hair: new THREE.MeshStandardMaterial({ name: "Hair", color: 0x171412, roughness: 0.88, metalness: 0.02 }),
};

function mesh(name, geometry, material, position, rotation = [0, 0, 0]) {
  const item = new THREE.Mesh(geometry, material);
  item.name = name;
  item.position.set(...position);
  item.rotation.set(...rotation);
  item.castShadow = true;
  item.receiveShadow = true;
  return item;
}

function cylinderBetween(name, from, to, radius, material, segments = 10) {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  const item = mesh(
    name,
    new THREE.CylinderGeometry(radius * 0.88, radius, direction.length(), segments),
    material,
    start.clone().add(end).multiplyScalar(0.5).toArray(),
  );
  item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  return item;
}

function garmentGeometry(levels) {
  const positions = [];
  const indices = [];

  for (const [y, width, depth] of levels) {
    positions.push(
      -width / 2, y, depth / 2,
      width / 2, y, depth / 2,
      width / 2, y, -depth / 2,
      -width / 2, y, -depth / 2,
    );
  }

  for (let level = 0; level < levels.length - 1; level += 1) {
    const lower = level * 4;
    const upper = (level + 1) * 4;
    for (let side = 0; side < 4; side += 1) {
      const next = (side + 1) % 4;
      indices.push(lower + side, lower + next, upper + next, lower + side, upper + next, upper + side);
    }
  }

  indices.push(0, 3, 2, 0, 2, 1);
  const top = (levels.length - 1) * 4;
  indices.push(top, top + 1, top + 2, top, top + 2, top + 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function tube(name, points, radius, material, segments = 24) {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
  return mesh(name, new THREE.TubeGeometry(curve, segments, radius, 6, false), material, [0, 0, 0]);
}

const marshal = new THREE.Group();
marshal.name = "Red Marshal Web Midpoly";
marshal.userData = {
  role: "帅",
  side: "red",
  unitScale: "1 unit = 1 meter",
  intendedUse: "browser Xiangqi prototype",
};

// Shared chess base: 2.5 m diameter and 0.55 m high.
marshal.add(
  mesh("Base lower", new THREE.CylinderGeometry(1.25, 1.25, 0.22, 32), palette.bronze, [0, 0.11, 0]),
  mesh("Base gold reveal", new THREE.CylinderGeometry(1.18, 1.18, 0.1, 32), palette.gold, [0, 0.27, 0]),
  mesh("Base upper", new THREE.CylinderGeometry(1.14, 1.18, 0.16, 32), palette.bronze, [0, 0.4, 0]),
  mesh("Base stone top", new THREE.CylinderGeometry(1.03, 1.07, 0.08, 32), palette.stone, [0, 0.52, 0]),
  mesh("Base rim", new THREE.TorusGeometry(1.08, 0.035, 6, 32), palette.gold, [0, 0.56, 0], [Math.PI / 2, 0, 0]),
);

// Human-proportioned robe and armor. The flattened front/back silhouette avoids a pawn-like cone.
const capeShape = new THREE.Shape();
capeShape.moveTo(-0.48, 2.73);
capeShape.lineTo(-0.7, 0.87);
capeShape.lineTo(0.7, 0.87);
capeShape.lineTo(0.48, 2.73);
capeShape.closePath();
const capeGeometry = new THREE.ExtrudeGeometry(capeShape, {
  depth: 0.07,
  bevelEnabled: true,
  bevelSegments: 2,
  bevelSize: 0.018,
  bevelThickness: 0.018,
});

marshal.add(
  mesh("Boot L", new THREE.BoxGeometry(0.27, 0.27, 0.48, 2, 2, 2), palette.hair, [-0.25, 0.71, 0.08]),
  mesh("Boot R", new THREE.BoxGeometry(0.27, 0.27, 0.48, 2, 2, 2), palette.hair, [0.25, 0.71, 0.08]),
  mesh(
    "Tailored lower robe",
    garmentGeometry([
      [0.79, 1.28, 0.61],
      [1.13, 1.24, 0.58],
      [1.7, 1.02, 0.51],
      [2.16, 0.76, 0.46],
    ]),
    palette.lacquerLight,
    [0, 0, 0],
  ),
  mesh("Cape", capeGeometry, palette.lacquer, [0, 0, -0.48]),
  mesh(
    "Tailored armored torso",
    garmentGeometry([
      [2.08, 0.79, 0.49],
      [2.5, 1.02, 0.58],
      [2.79, 0.74, 0.45],
    ]),
    palette.bronze,
    [0, 0, 0],
  ),
  mesh("Robe hem front", new THREE.BoxGeometry(1.28, 0.075, 0.065), palette.gold, [0, 0.83, 0.33]),
  mesh("Robe trim L", new THREE.BoxGeometry(0.05, 1.22, 0.055), palette.gold, [-0.31, 1.46, 0.315]),
  mesh("Robe trim R", new THREE.BoxGeometry(0.05, 1.22, 0.055), palette.gold, [0.31, 1.46, 0.315]),
  mesh("Structured belt", new THREE.BoxGeometry(0.86, 0.13, 0.56), palette.gold, [0, 2.08, 0]),
  mesh("Belt clasp", new THREE.CylinderGeometry(0.13, 0.13, 0.065, 16), palette.lacquer, [0, 2.08, 0.34], [Math.PI / 2, 0, 0]),
  tube("Collar L", [[-0.32, 2.75, 0.28], [-0.2, 2.58, 0.34], [0, 2.42, 0.36]], 0.028, palette.gold),
  tube("Collar R", [[0.32, 2.75, 0.28], [0.2, 2.58, 0.34], [0, 2.42, 0.36]], 0.028, palette.gold),
);

// Central lamellar apron and breastplate rows create the layered construction seen in the concept.
for (let row = 0; row < 7; row += 1) {
  for (let column = 0; column < 4; column += 1) {
    const x = -0.225 + column * 0.15;
    const y = 1.12 + row * 0.14;
    marshal.add(
      mesh(
        `Apron lamella ${row}-${column}`,
        new THREE.BoxGeometry(0.125, 0.105, 0.045, 1, 1, 1),
        (row + column) % 5 === 0 ? palette.gold : palette.bronze,
        [x, y, 0.345],
        [-0.035, 0, 0],
      ),
    );
  }
}

for (let row = 0; row < 4; row += 1) {
  for (let column = 0; column < 5; column += 1) {
    marshal.add(
      mesh(
        `Chest lamella ${row}-${column}`,
        new THREE.BoxGeometry(0.13, 0.1, 0.045),
        row === 0 || column === 0 || column === 4 ? palette.gold : palette.bronze,
        [-0.28 + column * 0.14, 2.25 + row * 0.125, 0.335],
      ),
    );
  }
}

// Arms fold naturally toward the belt, instead of hanging as two vertical toy cylinders.
const shoulderL = mesh("Shoulder L", new THREE.SphereGeometry(0.29, 16, 8), palette.gold, [-0.59, 2.61, 0.01]);
const shoulderR = mesh("Shoulder R", new THREE.SphereGeometry(0.29, 16, 8), palette.gold, [0.59, 2.61, 0.01]);
shoulderL.scale.set(1.35, 0.5, 1.05);
shoulderR.scale.set(1.35, 0.5, 1.05);
marshal.add(
  shoulderL,
  shoulderR,
  cylinderBetween("Upper sleeve L", [-0.58, 2.56, 0.04], [-0.64, 2.22, 0.17], 0.17, palette.lacquerLight, 14),
  cylinderBetween("Upper sleeve R", [0.58, 2.56, 0.04], [0.64, 2.22, 0.17], 0.17, palette.lacquerLight, 14),
  cylinderBetween("Forearm sleeve L", [-0.64, 2.22, 0.17], [-0.2, 2.05, 0.43], 0.18, palette.lacquerLight, 14),
  cylinderBetween("Forearm sleeve R", [0.64, 2.22, 0.17], [0.2, 2.05, 0.43], 0.18, palette.lacquerLight, 14),
  mesh("Cuff L", new THREE.CylinderGeometry(0.17, 0.18, 0.09, 14), palette.gold, [-0.25, 2.07, 0.4], [0, 0, 1.16]),
  mesh("Cuff R", new THREE.CylinderGeometry(0.17, 0.18, 0.09, 14), palette.gold, [0.25, 2.07, 0.4], [0, 0, -1.16]),
  mesh("Hand L", new THREE.SphereGeometry(0.095, 14, 9), palette.skin, [-0.12, 2.02, 0.46]),
  mesh("Hand R", new THREE.SphereGeometry(0.095, 14, 9), palette.skin, [0.12, 2.02, 0.46]),
);

// Smaller, more human head with separate brows, eyes, nose, ears, moustache and beard.
const head = mesh("Head", new THREE.SphereGeometry(0.225, 24, 16), palette.skin, [0, 3.12, 0.015]);
head.scale.set(0.91, 1.12, 0.96);
const eyeL = mesh("Eye L", new THREE.SphereGeometry(0.024, 10, 6), palette.hair, [-0.077, 3.16, 0.223]);
const eyeR = mesh("Eye R", new THREE.SphereGeometry(0.024, 10, 6), palette.hair, [0.077, 3.16, 0.223]);
eyeL.scale.set(1.15, 0.52, 0.35);
eyeR.scale.copy(eyeL.scale);
marshal.add(
  mesh("Neck", new THREE.CylinderGeometry(0.13, 0.15, 0.25, 14), palette.skin, [0, 2.87, 0]),
  mesh("Hair cap", new THREE.SphereGeometry(0.238, 18, 12), palette.hair, [0, 3.15, -0.05]),
  head,
  mesh("Ear L", new THREE.SphereGeometry(0.047, 10, 7), palette.skin, [-0.215, 3.12, 0.01]),
  mesh("Ear R", new THREE.SphereGeometry(0.047, 10, 7), palette.skin, [0.215, 3.12, 0.01]),
  eyeL,
  eyeR,
  mesh("Brow L", new THREE.BoxGeometry(0.105, 0.018, 0.018), palette.hair, [-0.075, 3.22, 0.225], [0, 0, -0.12]),
  mesh("Brow R", new THREE.BoxGeometry(0.105, 0.018, 0.018), palette.hair, [0.075, 3.22, 0.225], [0, 0, 0.12]),
  mesh("Nose", new THREE.ConeGeometry(0.038, 0.13, 10), palette.skin, [0, 3.1, 0.255], [Math.PI / 2, 0, 0]),
  tube("Moustache L", [[-0.01, 3.045, 0.236], [-0.07, 3.02, 0.245], [-0.13, 3.03, 0.22]], 0.018, palette.hair, 16),
  tube("Moustache R", [[0.01, 3.045, 0.236], [0.07, 3.02, 0.245], [0.13, 3.03, 0.22]], 0.018, palette.hair, 16),
  mesh(
    "Layered beard",
    garmentGeometry([
      [2.71, 0.09, 0.08],
      [2.88, 0.18, 0.11],
      [3.0, 0.15, 0.09],
    ]),
    palette.hair,
    [0, 0, 0.245],
  ),
  mesh("Crown body", new THREE.CylinderGeometry(0.25, 0.28, 0.25, 14), palette.lacquer, [0, 3.42, 0]),
  mesh("Crown band", new THREE.CylinderGeometry(0.29, 0.29, 0.075, 14), palette.gold, [0, 3.31, 0]),
  mesh("Crown front panel", new THREE.BoxGeometry(0.32, 0.19, 0.045), palette.gold, [0, 3.42, 0.255]),
);

for (const [index, x] of [-0.2, -0.1, 0, 0.1, 0.2].entries()) {
  marshal.add(
    mesh(
      `Crown post ${index + 1}`,
      new THREE.BoxGeometry(0.042, 0.32 + (index === 2 ? 0.08 : 0), 0.042),
      palette.gold,
      [x, 3.69 + (index === 2 ? 0.04 : 0), 0],
    ),
  );
}

// Sheathed sword keeps the silhouette readable without an action pose.
const sword = new THREE.Group();
sword.name = "Sheathed sword";
sword.position.set(0.7, 1.47, 0.01);
sword.rotation.z = -0.12;
sword.add(
  mesh("Sword sheath", new THREE.CylinderGeometry(0.045, 0.058, 1.42, 12), palette.hair, [0, 0, 0]),
  mesh("Sword tip", new THREE.ConeGeometry(0.058, 0.14, 12), palette.gold, [0, -0.78, 0], [0, 0, Math.PI]),
  mesh("Sword guard", new THREE.BoxGeometry(0.28, 0.065, 0.085), palette.gold, [0, 0.73, 0]),
  mesh("Sword grip", new THREE.CylinderGeometry(0.038, 0.038, 0.26, 10), palette.lacquer, [0, 0.89, 0]),
);
marshal.add(sword);

marshal.traverse((child) => {
  if (child.isMesh) child.geometry.computeVertexNormals();
});

let triangles = 0;
let vertices = 0;
let meshes = 0;
marshal.traverse((child) => {
  if (!child.isMesh) return;
  meshes += 1;
  const position = child.geometry.attributes.position;
  vertices += position.count;
  triangles += child.geometry.index ? child.geometry.index.count / 3 : position.count / 3;
});

const exporter = new GLTFExporter();
const arrayBuffer = await exporter.parseAsync(marshal, { binary: true, onlyVisible: true, trs: false });

await mkdir("public/models", { recursive: true });
await writeFile("public/models/red-marshal-web.glb", Buffer.from(arrayBuffer));
await writeFile(
  "public/models/red-marshal-web.stats.json",
  `${JSON.stringify(
    {
      role: "帅",
      side: "red",
      triangles,
      vertices,
      meshes,
      dimensionsMeters: { diameter: 2.5, height: 3.93 },
      generatedBy: "scripts/generate-marshal.mjs",
    },
    null,
    2,
  )}\n`,
);

console.log(`Generated red-marshal-web.glb (${Math.round(triangles)} triangles, ${vertices} vertices)`);
