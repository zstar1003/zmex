import * as THREE from "./data/vendor/three/three.module.min.js";
import { OrbitControls } from "./data/vendor/three/addons/controls/OrbitControls.js";

// ThreeScopeMap attribution: 作者全平台ID：宋夏天Dazzle；公众号：送你整个夏天
// Code-only attribution. Do not render it in the UI.

const DEFAULT_CAMERA = {
  position: new THREE.Vector3(0, -40, 155),
  target: new THREE.Vector3(0, 0, 0),
};

const MAP_WIDTH = 112;
const MAP_HEIGHT = 82;
const MAP_DEPTH = 2.5;
const MAP_COS_LATITUDE = Math.cos(35 * Math.PI / 180);
const MAP_COLORS = {
  active: "#b65359",
  emptyTop: "#cfaaad",
  lowTop: "#eba9ad",
  highTop: "#bd666b",
};
const LABEL_OFFSETS = {
  北京市: [-2.2, 2.2],
  天津市: [2.4, -1.2],
  上海市: [3.1, -0.2],
  江苏省: [-1.6, 1.1],
  浙江省: [0.4, -1.4],
  香港特别行政区: [2.4, -0.9],
  澳门特别行政区: [-2.4, -1.5],
  海南省: [0, -1.6],
  宁夏回族自治区: [0.4, -0.8],
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function featureName(feature) {
  return String(feature.properties?.name || feature.properties?.fullname || "");
}

function toPolygons(feature) {
  if (feature.geometry?.type === "Polygon") return [feature.geometry.coordinates];
  if (feature.geometry?.type === "MultiPolygon") return feature.geometry.coordinates;
  return [];
}

function colorForMetric(value, max, active = false) {
  if (active) return new THREE.Color(MAP_COLORS.active);
  if (!value) return new THREE.Color(MAP_COLORS.emptyTop);
  const t = Math.sqrt(clamp(value / Math.max(max, 1), 0, 1));
  const color = new THREE.Color(MAP_COLORS.lowTop);
  color.lerp(new THREE.Color(MAP_COLORS.highTop), t);
  return color;
}

function disposeObject(object) {
  object.traverse((child) => {
    if (!child.isMesh && !child.isLine && !child.isLineSegments && !child.isSprite) return;
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (!material) return;
      Object.values(material).forEach((value) => {
        if (value?.isTexture) value.dispose();
      });
      material.dispose();
    });
  });
}

function createShape(rings, project) {
  const outer = rings[0]?.map((coord) => project(coord)) || [];
  if (outer.length < 3) return null;
  if (!THREE.ShapeUtils.isClockWise(outer)) outer.reverse();

  const shape = new THREE.Shape();
  shape.moveTo(outer[0].x, outer[0].y);
  outer.slice(1).forEach((point) => shape.lineTo(point.x, point.y));
  shape.closePath();

  rings.slice(1).forEach((ring) => {
    const holePoints = ring.map((coord) => project(coord));
    if (holePoints.length < 3) return;
    if (THREE.ShapeUtils.isClockWise(holePoints)) holePoints.reverse();
    const hole = new THREE.Path();
    hole.moveTo(holePoints[0].x, holePoints[0].y);
    holePoints.slice(1).forEach((point) => hole.lineTo(point.x, point.y));
    hole.closePath();
    shape.holes.push(hole);
  });

  return shape;
}

function shortProvinceName(name) {
  return name
    .replace("壮族自治区", "")
    .replace("回族自治区", "")
    .replace("维吾尔自治区", "")
    .replace("特别行政区", "")
    .replace("自治区", "")
    .replace(/[省市]$/, "");
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function createProvinceLabelSprite(name, count, active) {
  const canvas = document.createElement("canvas");
  canvas.width = 112;
  canvas.height = 88;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  roundedRect(context, 4, 4, 104, 80, 14);
  context.fillStyle = active ? "rgba(126, 53, 58, 0.96)" : "rgba(255, 251, 251, 0.94)";
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = active ? "rgba(126, 53, 58, 1)" : "rgba(190, 101, 106, 0.5)";
  context.stroke();

  context.fillStyle = active ? "#fffafa" : "#4b3032";
  context.font = "700 19px PingFang SC, Microsoft YaHei, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(shortProvinceName(name), 56, 27);

  context.fillStyle = active ? "#ffffff" : "#9c4047";
  context.font = "900 27px Avenir Next, PingFang SC, sans-serif";
  context.fillText(String(count), 56, 59);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  sprite.scale.set(5.3, 4.15, 1);
  sprite.renderOrder = 20;
  return sprite;
}

export class ThreeChinaMap {
  constructor(host, chinaGeoJson, handlers = {}) {
    this.host = host;
    this.geoJson = chinaGeoJson;
    this.handlers = handlers;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 600);
    this.camera.up.set(0, 0, 1);
    this.camera.position.copy(DEFAULT_CAMERA.position);
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.domElement.className = "three-map-canvas";
    this.host.replaceChildren(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = false;
    this.controls.minDistance = 85;
    this.controls.maxDistance = 520;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = 0.56;
    this.controls.minAzimuthAngle = -0.3;
    this.controls.maxAzimuthAngle = 0.3;
    this.controls.target.copy(DEFAULT_CAMERA.target);

    this.mapRoot = new THREE.Group();
    this.labelRoot = new THREE.Group();
    this.scene.add(this.mapRoot, this.labelRoot);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.provinceMeshes = [];
    this.provinceGroups = new Map();
    this.hoveredProvince = "";
    this.pointerDown = null;
    this.cameraGoal = null;
    this.disposed = false;

    this.tooltip = document.createElement("div");
    this.tooltip.className = "map-hover-card";
    this.tooltip.hidden = true;
    this.host.appendChild(this.tooltip);

    this.normalTexture = new THREE.TextureLoader().load(
      new URL("./assets/map/terrain-normal.jpg", import.meta.url).href,
    );
    this.roughnessTexture = new THREE.TextureLoader().load(
      new URL("./assets/map/terrain-roughness.jpg", import.meta.url).href,
    );
    [this.normalTexture, this.roughnessTexture].forEach((texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(2.6, 2.1);
      texture.anisotropy = 4;
    });

    this.prepareProjection();
    this.createLights();
    this.createProvinceGeometry();
    this.bindEvents();
    this.resize();
    this.applyDefaultView();
    this.animate();
  }

  prepareProjection() {
    const coordinates = [];
    this.geoJson.features.forEach((feature) => {
      toPolygons(feature).forEach((polygon) => {
        polygon.forEach((ring) => {
          ring.forEach(([longitude, latitude]) => {
            if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
              coordinates.push([longitude * MAP_COS_LATITUDE, latitude]);
            }
          });
        });
      });
    });

    const xs = coordinates.map(([x]) => x);
    const ys = coordinates.map(([, y]) => y);
    this.bounds = {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
    const width = this.bounds.maxX - this.bounds.minX;
    const height = this.bounds.maxY - this.bounds.minY;
    this.mapScale = Math.min(MAP_WIDTH / width, MAP_HEIGHT / height);
    this.mapOffset = {
      x: -((this.bounds.minX + this.bounds.maxX) / 2) * this.mapScale,
      y: -((this.bounds.minY + this.bounds.maxY) / 2) * this.mapScale,
    };
  }

  project([longitude, latitude], z = 0) {
    return new THREE.Vector3(
      longitude * MAP_COS_LATITUDE * this.mapScale + this.mapOffset.x,
      latitude * this.mapScale + this.mapOffset.y,
      z,
    );
  }

  createLights() {
    this.scene.add(new THREE.HemisphereLight("#fffafa", "#76585b", 2.15));
    const key = new THREE.DirectionalLight("#ffffff", 3.6);
    key.position.set(-28, -42, 90);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight("#ffe1e1", 1.7);
    rim.position.set(70, 18, 42);
    this.scene.add(rim);
  }

  createProvinceGeometry() {
    this.geoJson.features.forEach((feature) => {
      const name = featureName(feature);
      if (!name) return;

      const provinceGroup = new THREE.Group();
      provinceGroup.userData = {
        name,
        baseZ: 0,
        targetZ: 0,
        labelCoord: feature.properties?.centroid || feature.properties?.center,
      };
      const meshes = [];
      const topMaterials = [];
      const sideMaterials = [];

      toPolygons(feature).forEach((polygon) => {
        const shape = createShape(polygon, (coord) => this.project(coord));
        if (!shape) return;

        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth: MAP_DEPTH,
          bevelEnabled: true,
          bevelSegments: 1,
          bevelSize: 0.11,
          bevelThickness: 0.1,
          curveSegments: 1,
        });
        geometry.computeVertexNormals();

        const topMaterial = new THREE.MeshStandardMaterial({
          color: "#efcdce",
          emissive: "#61292d",
          emissiveIntensity: 0.025,
          roughness: 0.78,
          metalness: 0.02,
          normalMap: this.normalTexture,
          normalScale: new THREE.Vector2(0.18, 0.18),
          roughnessMap: this.roughnessTexture,
        });
        const sideMaterial = new THREE.MeshStandardMaterial({
          color: "#925257",
          emissive: "#451b1f",
          emissiveIntensity: 0.08,
          roughness: 0.9,
          metalness: 0.02,
        });
        const mesh = new THREE.Mesh(geometry, [topMaterial, sideMaterial]);
        mesh.userData = { type: "province", name };
        provinceGroup.add(mesh);
        meshes.push(mesh);
        topMaterials.push(topMaterial);
        sideMaterials.push(sideMaterial);
        this.provinceMeshes.push(mesh);

        polygon.forEach((ring) => {
          const points = ring.map((coord) => this.project(coord, MAP_DEPTH + 0.2));
          if (points.length < 2) return;
          const outline = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({
              color: "#fffafa",
              transparent: true,
              opacity: 0.62,
              depthTest: false,
            }),
          );
          outline.renderOrder = 8;
          provinceGroup.add(outline);
        });
      });

      if (!meshes.length) return;
      provinceGroup.userData.meshes = meshes;
      provinceGroup.userData.topMaterials = topMaterials;
      provinceGroup.userData.sideMaterials = sideMaterials;
      this.provinceGroups.set(name, provinceGroup);
      this.mapRoot.add(provinceGroup);
    });
  }

  bindEvents() {
    this.onPointerMove = (event) => this.handlePointerMove(event);
    this.onPointerLeave = () => this.clearHover();
    this.onPointerDown = (event) => {
      this.pointerDown = { x: event.clientX, y: event.clientY };
    };
    this.onPointerUp = (event) => this.handlePointerUp(event);
    this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.addEventListener("pointerleave", this.onPointerLeave);
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.onPointerUp);
    this.controls.addEventListener("start", () => this.hideTooltip());
  }

  update({ provinceStats, activeProvince }) {
    this.activeProvince = activeProvince;
    this.provinceStats = new Map(provinceStats.map((stat) => [stat.name, stat]));
    const maxValue = Math.max(...provinceStats.map((stat) => stat.count), 1);

    this.provinceGroups.forEach((group, name) => {
      const stat = this.provinceStats.get(name);
      const color = colorForMetric(stat?.count || 0, maxValue, activeProvince === name);
      group.userData.topMaterials.forEach((material) => {
        material.color.copy(color);
      });
      group.userData.sideMaterials.forEach((material) => {
        material.color.copy(color).multiplyScalar(0.56);
      });
      group.visible = true;
    });

    this.rebuildProvinceLabels();
  }

  rebuildProvinceLabels() {
    this.scene.remove(this.labelRoot);
    disposeObject(this.labelRoot);
    this.labelRoot = new THREE.Group();
    this.scene.add(this.labelRoot);

    this.provinceGroups.forEach((group, name) => {
      const stat = this.provinceStats.get(name);
      const coord = group.userData.labelCoord;
      if (!stat?.count || !coord) return;
      const label = createProvinceLabelSprite(name, stat.count, this.activeProvince === name);
      const [offsetX = 0, offsetY = 0] = LABEL_OFFSETS[name] || [];
      label.position.copy(this.project(coord, MAP_DEPTH + 2.1));
      label.position.x += offsetX;
      label.position.y += offsetY;
      this.labelRoot.add(label);
    });
  }

  setPointer(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return rect;
  }

  hitTest(event) {
    this.setPointer(event);
    return this.raycaster.intersectObjects(this.provinceMeshes, false)[0]?.object || null;
  }

  handlePointerMove(event) {
    const hit = this.hitTest(event);
    if (!hit) {
      this.clearHover();
      return;
    }

    this.setHoveredProvince(hit.userData.name);
    this.showProvinceTooltip(hit.userData.name, event);
  }

  handlePointerUp(event) {
    if (!this.pointerDown) return;
    const distance = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
    this.pointerDown = null;
    if (distance > 6) return;

    const hit = this.hitTest(event);
    if (!hit) return;
    this.handlers.onProvinceClick?.(hit.userData.name);
  }

  setHoveredProvince(name) {
    if (this.hoveredProvince === name) return;
    if (this.hoveredProvince) {
      const previous = this.provinceGroups.get(this.hoveredProvince);
      if (previous) {
        previous.userData.targetZ = 0;
        previous.userData.topMaterials.forEach((material) => {
          material.emissiveIntensity = 0.025;
        });
      }
    }
    this.hoveredProvince = name;
    if (name) {
      const current = this.provinceGroups.get(name);
      if (current) {
        current.userData.targetZ = 1.25;
        current.userData.topMaterials.forEach((material) => {
          material.emissive.set("#d86e74");
          material.emissiveIntensity = 0.3;
        });
      }
    }
  }

  showProvinceTooltip(name, event) {
    const stat = this.provinceStats.get(name);
    this.showTooltip(name, `院校 ${stat?.count || 0} 所 · 点击筛选`, event);
  }

  showTooltip(title, detail, event) {
    this.tooltip.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = title;
    const span = document.createElement("span");
    span.textContent = detail;
    this.tooltip.append(strong, span);
    this.tooltip.hidden = false;
    const hostRect = this.host.getBoundingClientRect();
    const x = clamp(event.clientX - hostRect.left + 14, 10, hostRect.width - 250);
    const y = clamp(event.clientY - hostRect.top + 14, 10, hostRect.height - 78);
    this.tooltip.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    this.renderer.domElement.style.cursor = "pointer";
  }

  hideTooltip() {
    this.tooltip.hidden = true;
    this.renderer.domElement.style.cursor = "grab";
  }

  clearHover() {
    this.setHoveredProvince("");
    this.hideTooltip();
  }

  getDefaultView() {
    const aspectScale = clamp(0.94 / Math.max(this.camera.aspect, 0.45), 1, 1.55);
    const target = DEFAULT_CAMERA.target.clone();
    const offset = DEFAULT_CAMERA.position.clone().sub(target).multiplyScalar(aspectScale);
    return {
      position: target.clone().add(offset),
      target,
    };
  }

  applyDefaultView() {
    const view = this.getDefaultView();
    this.camera.position.copy(view.position);
    this.controls.target.copy(view.target);
    this.controls.update();
  }

  resetView() {
    this.cameraGoal = null;
    this.applyDefaultView();
  }

  zoomBy(factor) {
    const direction = this.camera.position.clone().sub(this.controls.target);
    const nextDistance = clamp(direction.length() / factor, this.controls.minDistance, this.controls.maxDistance);
    direction.setLength(nextDistance);
    this.camera.position.copy(this.controls.target).add(direction);
    this.controls.update();
  }

  resize() {
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  animate() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(() => this.animate());
    this.controls.update();

    if (this.cameraGoal) {
      this.camera.position.lerp(this.cameraGoal.position, 0.1);
      this.controls.target.lerp(this.cameraGoal.target, 0.1);
      if (
        this.camera.position.distanceTo(this.cameraGoal.position) < 0.08 &&
        this.controls.target.distanceTo(this.cameraGoal.target) < 0.08
      ) {
        this.camera.position.copy(this.cameraGoal.position);
        this.controls.target.copy(this.cameraGoal.target);
        this.cameraGoal = null;
      }
    }

    this.provinceGroups.forEach((group) => {
      group.position.z += (group.userData.targetZ - group.position.z) * 0.16;
    });
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.renderer.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.removeEventListener("pointerleave", this.onPointerLeave);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.onPointerUp);
    this.controls.dispose();
    disposeObject(this.scene);
    this.normalTexture.dispose();
    this.roughnessTexture.dispose();
    this.renderer.dispose();
    this.host.replaceChildren();
  }
}
