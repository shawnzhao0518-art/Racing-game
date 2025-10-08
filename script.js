// ---- 全局变量 和 初始化 ----
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas });
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa0a0a0);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 1000);
camera.position.set(0, 10, 20);

const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(10, 20, 10);
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// 控制器（用于调试视角）
// const controls = new THREE.OrbitControls(camera, renderer.domElement);

// ---- 赛车模型（低模） ----
const carGeo = new THREE.BoxGeometry(1, 0.5, 2);
const carMat = new THREE.MeshLambertMaterial({ color: 0xff3333 });
const carMesh = new THREE.Mesh(carGeo, carMat);
scene.add(carMesh);

let carPosition = new THREE.Vector3();
let carDirection = new THREE.Vector3(0, 0, -1);
let carSpeed = 0;

// ---- 轨道 & 赛道数据管理 ----
let tracks = {};  // 存放赛道 JSON 数据
let currentTrackName = 'silverstone';
let trackCurve = null;
let trackMesh = null;
let trackPoints = [];  // Vector3 数组（中心线）
let trackLength = 0;

// 加载赛道 JSON
async function loadTrack(name) {
  const resp = await fetch(`tracks/${name}.json`);
  const j = await resp.json();
  // j.points 是 [[x, y, z], ...]
  trackPoints = j.points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
  buildTrackGeometry();
}

// 用中心线生成平滑曲线 & 赛道几何
function buildTrackGeometry() {
  if (trackMesh) {
    scene.remove(trackMesh);
    trackMesh.geometry.dispose();
    trackMesh.material.dispose();
  }
  trackCurve = new THREE.CatmullRomCurve3(trackPoints, true, 'catmullrom', 0.5);
  const divisions = 2000;
  const pts = trackCurve.getPoints(divisions);

  // 生成路径（中线）
  const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x00ff00 });
  const line = new THREE.Line(lineGeo, lineMat);
  scene.add(line);

  // 生成赛道实体：沿线拉伸一个矩形截面
  const width = 4;  // 赛道宽度
  const geometry = new THREE.BufferGeometry();
  const vertices = [];
  const indices = [];

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const t = trackCurve.getTangent(i / divisions).normalize();
    // 计算法向量（向左偏移）
    const up = new THREE.Vector3(0, 1, 0);
    const left = new THREE.Vector3().crossVectors(up, t).normalize();
    const half = width / 2;
    const v1 = p.clone().add(left.clone().multiplyScalar(half));
    const v2 = p.clone().add(left.clone().multiplyScalar(-half));
    vertices.push(v1.x, v1.y, v1.z);
    vertices.push(v2.x, v2.y, v2.z);
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const i2 = i * 2;
    // 两三角形构成矩形片
    indices.push(i2, i2 + 1, i2 + 2);
    indices.push(i2 + 1, i2 + 3, i2 + 2);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  trackMesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: 0x999999 }));
  scene.add(trackMesh);

  // 计算赛道近似长度
  trackLength = 0;
  for (let i = 1; i < pts.length; i++) {
    trackLength += pts[i].distanceTo(pts[i-1]);
  }
}

// 切换赛道
document.getElementById('trackSelect').addEventListener('change', e => {
  currentTrackName = e.target.value;
  resetCar();
  loadTrack(currentTrackName);
  loadBestForCurrent();
});

// ---- 控制 & 输入 ----
const keys = {};
document.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
document.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

function updateCar(dt) {
  const accel = 5;
  const turnSpeed = 2.0;
  if (keys['w'] || keys['arrowup']) {
    carSpeed += accel * dt;
  } else if (keys['s'] || keys['arrowdown']) {
    carSpeed -= accel * dt;
  } else {
    // 摩擦
    carSpeed *= 0.98;
  }
  const maxSpeed = 20;
  carSpeed = THREE.MathUtils.clamp(carSpeed, -maxSpeed, maxSpeed);

  // 转向基于速度
  if (keys['a'] || keys['arrowleft']) {
    const angle = turnSpeed * dt * (carSpeed / maxSpeed);
    carDirection.applyAxisAngle(new THREE.Vector3(0,1,0), angle);
  } else if (keys['d'] || keys['arrowright']) {
    const angle = -turnSpeed * dt * (carSpeed / maxSpeed);
    carDirection.applyAxisAngle(new THREE.Vector3(0,1,0), angle);
  }

  // 更新位置
  const moveDelta = carDirection.clone().multiplyScalar(carSpeed * dt);
  carPosition.add(moveDelta);
  carMesh.position.copy(carPosition);

  // 朝向更新
  const forward = carDirection.clone();
  const targetQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1), forward.clone().normalize());
  carMesh.quaternion.slerp(targetQuat, 0.1);
}

// ---- 计时 / 最佳记录 / 复位 / 暂停 等 UI ----
let paused = false;
let startTime = null;
let bestTimes = {};  // 存每条赛道的最佳时间
let finished = false;

function loadBestForCurrent() {
  const key = `best_${currentTrackName}`;
  const v = parseFloat(localStorage.getItem(key));
  bestTimes[currentTrackName] = isNaN(v) ? null : v;
  updateUI();
}

function saveBestForCurrent(t) {
  const key = `best_${currentTrackName}`;
  localStorage.setItem(key, t.toString());
  bestTimes[currentTrackName] = t;
}

function updateUI() {
  const td = document.getElementById('timeDisplay');
  const bd = document.getElementById('bestDisplay');
  if (startTime != null && !finished) {
    const elapsed = (performance.now() - startTime)/1000;
    td.textContent = `Time: ${elapsed.toFixed(2)}s`;
  }
  const best = bestTimes[currentTrackName];
  bd.textContent = `Best: ${best != null ? best.toFixed(2) : "—"}s`;
}

document.getElementById('pauseBtn').onclick = () => {
  paused = !paused;
  if (!paused && startTime === null) {
    startTime = performance.now();
  }
};
document.getElementById('refreshBtn').onclick = () => {
  // 重新加载页面（重开当前赛道）
  window.location.reload();
};
document.getElementById('resetBtn').onclick = () => {
  // 简单版本：返回起点
  resetCar();
  startTime = performance.now();
  finished = false;
};

// 重置赛车到起点
function resetCar() {
  if (trackPoints && trackPoints.length > 0) {
    carPosition.copy(trackPoints[0]);
  } else {
    carPosition.set(0, 0, 0);
  }
  carDirection.set(0, 0, -1);
  carSpeed = 0;
  carMesh.position.copy(carPosition);
}

// 检测到达终点
function checkFinish() {
  const pts = trackCurve.getPoints(2000);
  const last = pts[pts.length - 1];
  const d = carPosition.distanceTo(last);
  if (d < 2.0 && !finished) {
    finished = true;
    const t = (performance.now() - startTime)/1000;
    const best = bestTimes[currentTrackName];
    if (best === null || t < best) {
      saveBestForCurrent(t);
    }
    alert(`Finished! Time: ${t.toFixed(2)}s`);
  }
}

// ---- 主循环 ----
let last = performance.now();
function animate() {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;

  if (!paused && trackCurve) {
    if (startTime === null) {
      startTime = now;
    }
    updateCar(dt);
    checkFinish();
  }

  camera.position.lerp(new THREE.Vector3(carPosition.x, carPosition.y + 8, carPosition.z + 15), 0.05);
  camera.lookAt(carPosition);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// ---- 启动 ----
loadTrack(currentTrackName);
resetCar();
animate();
