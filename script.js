// ---- 初始化基础环境 ----
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa0a0a0);

// 摄像机
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 80, 120);
camera.lookAt(0, 0, 0);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// 光照与环境
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
hemiLight.position.set(0, 200, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(50, 200, 100);
dirLight.castShadow = true;
scene.add(dirLight);

// 地面与网格
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1000, 1000),
  new THREE.MeshLambertMaterial({ color: 0xcccccc })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(1000, 100, 0x000000, 0x000000);
grid.material.opacity = 0.2;
grid.material.transparent = true;
scene.add(grid);

// ---- 赛车（低模风格） ----
const carGeo = new THREE.BoxGeometry(2, 1, 4);
const carMat = new THREE.MeshStandardMaterial({ color: 0xff3333 });
const carMesh = new THREE.Mesh(carGeo, carMat);
carMesh.castShadow = true;
carMesh.position.set(0, 1, 0);
scene.add(carMesh);

let carPos = new THREE.Vector3(0, 1, 0);
let carDir = new THREE.Vector3(0, 0, -1);
let carSpeed = 0;

// ---- 加载赛道 ----
let trackCurve = null;
let trackMesh = null;
let currentTrack = 'silverstone';
let trackCenter = new THREE.Vector3();

async function loadTrack(name) {
  console.log(`正在加载赛道：${name}...`);
  try {
    const resp = await fetch(`tracks/${name}.json`);
    if (!resp.ok) throw new Error("赛道文件不存在");
    const data = await resp.json();

    const pts = data.points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
    buildTrack(pts);
    trackCenter = getTrackCenter(pts);
    camera.lookAt(trackCenter);
    alert(`✅ 赛道 ${name} 加载成功！`);
  } catch (err) {
    alert(`❌ 加载赛道失败：${err.message}`);
  }
}

function buildTrack(points) {
  if (trackMesh) scene.remove(trackMesh);

  trackCurve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
  const divisions = 2000;
  const curvePts = trackCurve.getPoints(divisions);

  const width = 6;
  const verts = [];
  const indices = [];

  for (let i = 0; i < curvePts.length; i++) {
    const p = curvePts[i];
    const t = trackCurve.getTangent(i / divisions).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const left = new THREE.Vector3().crossVectors(up, t).normalize();
    const half = width / 2;
    const v1 = p.clone().add(left.clone().multiplyScalar(half));
    const v2 = p.clone().add(left.clone().multiplyScalar(-half));
    verts.push(v1.x, v1.y, v1.z);
    verts.push(v2.x, v2.y, v2.z);
  }

  for (let i = 0; i < curvePts.length - 1; i++) {
    const i2 = i * 2;
    indices.push(i2, i2 + 1, i2 + 2);
    indices.push(i2 + 1, i2 + 3, i2 + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.8,
    metalness: 0.1
  });

  trackMesh = new THREE.Mesh(geo, mat);
  trackMesh.receiveShadow = true;
  scene.add(trackMesh);
}

function getTrackCenter(points) {
  const box = new THREE.Box3().setFromPoints(points);
  const center = new THREE.Vector3();
  box.getCenter(center);
  return center;
}

// ---- 控制 ----
const keys = {};
document.addEventListener('keydown', e => (keys[e.key.toLowerCase()] = true));
document.addEventListener('keyup', e => (keys[e.key.toLowerCase()] = false));

function updateCar(dt) {
  const accel = 20;
  const turn = 1.5;
  if (keys['w'] || keys['arrowup']) carSpeed += accel * dt;
  else if (keys['s'] || keys['arrowdown']) carSpeed -= accel * dt;
  else carSpeed *= 0.98;

  carSpeed = THREE.MathUtils.clamp(carSpeed, -30, 30);
  if (keys['a'] || keys['arrowleft'])
    carDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), turn * dt * (carSpeed / 20));
  if (keys['d'] || keys['arrowright'])
    carDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), -turn * dt * (carSpeed / 20));

  const deltaMove = carDir.clone().multiplyScalar(carSpeed * dt);
  carPos.add(deltaMove);
  carMesh.position.copy(carPos);

  const targetQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, -1),
    carDir.clone().normalize()
  );
  carMesh.quaternion.slerp(targetQuat, 0.2);
}

// ---- 摄像机跟随 ----
function updateCamera() {
  const follow = carPos.clone().add(new THREE.Vector3(-carDir.x * 15, 8, -carDir.z * 15));
  camera.position.lerp(follow, 0.05);
  camera.lookAt(carPos);
}

// ---- UI ----
document.getElementById('trackSelect').onchange = e => {
  currentTrack = e.target.value;
  loadTrack(currentTrack);
  resetCar();
};
document.getElementById('resetBtn').onclick = () => resetCar();
document.getElementById('refreshBtn').onclick = () => location.reload();

function resetCar() {
  carPos.set(trackCenter.x, 1, trackCenter.z);
  carDir.set(0, 0, -1);
  carSpeed = 0;
  carMesh.position.copy(carPos);
  console.log('赛车已重置');
}

// ---- 主循环 ----
let last = performance.now();
function animate() {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;

  updateCar(dt);
  updateCamera();
  renderer.render(scene, camera);

  requestAnimationFrame(animate);
}

// ---- 启动 ----
loadTrack(currentTrack);
animate();
