/*
 * Signal Field — WebGPU compute particle backend
 *
 * Dependency-free, opt-in, and safe to load in browsers without WebGPU. The
 * module never replaces or mutates the existing Canvas renderer by itself.
 */
(function attachWebGPUParticleBackend(globalScope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope) globalScope.SignalFieldWebGPUParticleBackend = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  const VERSION = '1.2.0';
  const SCHEMA = 'signal-field/webgpu-particle-backend';
  const WORKGROUP_SIZE = 256;
  const PARTICLE_STRIDE = 32;
  const MAX_SHAPE_PLANES = 32;
  const SHAPE_FLOATS = 4 + MAX_SHAPE_PLANES * 4;
  const SHAPE_BYTES = SHAPE_FLOATS * 4;
  const PARTICLE_TIERS = Object.freeze({ adaptive: 'adaptive', '64k': 65536, '128k': 131072 });
  const BUFFER_USAGE = Object.freeze({ COPY_DST: 8, UNIFORM: 64, STORAGE: 128 });
  const UNIFORM_FLOATS = 40;
  const UNIFORM_BYTES = UNIFORM_FLOATS * 4;
  const ALLOWED_PARAMETERS = Object.freeze([
    'energy', 'damping', 'pointerX', 'pointerY', 'pointerZ',
    'modeM', 'modeN', 'modeP', 'modeM2', 'modeN2', 'modeP2', 'modeMix', 'modeWeightA', 'modeWeightB',
    'aspect', 'depthAspect', 'pointSize', 'rotationMatrix', 'zoom', 'perspective',
    'pointerStrength', 'nodeStrength', 'driftStrength',
    'color', 'backgroundColor'
  ]);

  const COMPUTE_WGSL = `
struct Particle {
  position: vec4f,
  velocity: vec4f,
};

struct SimulationUniforms {
  timing: vec4f,
  excitation: vec4f,
  modeA: vec4f,
  modeB: vec4f,
  volume: vec4f,
  viewport: vec4f,
  cameraRow0: vec4f,
  cameraRow1: vec4f,
  cameraRow2: vec4f,
  color: vec4f,
};

struct ShapeData {
  // x: kind (0 cube, 1 sphere, 2 convex), y: plane count,
  // z: cube half extent / sphere radius, w: restitution.
  metadata: vec4f,
  // Convex plane convention: dot(normal, position) <= offset.
  planes: array<vec4f, ${MAX_SHAPE_PLANES}>,
};

@group(0) @binding(0) var<uniform> uniforms: SimulationUniforms;
@group(0) @binding(1) var<storage, read> sourceParticles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> targetParticles: array<Particle>;
@group(0) @binding(3) var<storage, read> shape: ShapeData;

const PI: f32 = 3.14159265;

fn phi3(mode: vec3f, uv: vec3f) -> f32 {
  return
    sin(PI * mode.x * uv.x) * sin(PI * mode.y * uv.y) * sin(PI * mode.z * uv.z) +
    sin(PI * mode.y * uv.x) * sin(PI * mode.z * uv.y) * sin(PI * mode.x * uv.z) +
    sin(PI * mode.z * uv.x) * sin(PI * mode.x * uv.y) * sin(PI * mode.y * uv.z);
}

fn phi3Gradient(mode: vec3f, uv: vec3f) -> vec3f {
  let x = 0.5 * PI * (
    mode.x * cos(PI * mode.x * uv.x) * sin(PI * mode.y * uv.y) * sin(PI * mode.z * uv.z) +
    mode.y * cos(PI * mode.y * uv.x) * sin(PI * mode.z * uv.y) * sin(PI * mode.x * uv.z) +
    mode.z * cos(PI * mode.z * uv.x) * sin(PI * mode.x * uv.y) * sin(PI * mode.y * uv.z)
  );
  let y = 0.5 * PI * (
    mode.y * sin(PI * mode.x * uv.x) * cos(PI * mode.y * uv.y) * sin(PI * mode.z * uv.z) +
    mode.z * sin(PI * mode.y * uv.x) * cos(PI * mode.z * uv.y) * sin(PI * mode.x * uv.z) +
    mode.x * sin(PI * mode.z * uv.x) * cos(PI * mode.x * uv.y) * sin(PI * mode.y * uv.z)
  );
  let z = 0.5 * PI * (
    mode.z * sin(PI * mode.x * uv.x) * sin(PI * mode.y * uv.y) * cos(PI * mode.z * uv.z) +
    mode.x * sin(PI * mode.y * uv.x) * sin(PI * mode.z * uv.y) * cos(PI * mode.x * uv.z) +
    mode.y * sin(PI * mode.z * uv.x) * sin(PI * mode.x * uv.y) * cos(PI * mode.y * uv.z)
  );
  return vec3f(x, y, z);
}

struct BoundaryResult {
  position: vec3f,
  velocity: vec3f,
};

fn reflectOutward(velocity: vec3f, normal: vec3f, restitution: f32) -> vec3f {
  let outwardSpeed = max(dot(velocity, normal), 0.0);
  return velocity - normal * outwardSpeed * (1.0 + restitution);
}

fn confineToShape(inputPosition: vec3f, inputVelocity: vec3f) -> BoundaryResult {
  var position = inputPosition;
  var velocity = inputVelocity;
  let kind = u32(round(shape.metadata.x));
  let extent = clamp(shape.metadata.z, 0.05, 2.0);
  let restitution = clamp(shape.metadata.w, 0.0, 1.0);

  if (kind == 1u) {
    let distance = length(position);
    if (distance > extent) {
      let normal = select(vec3f(0.0, 1.0, 0.0), position / distance, distance > 0.00001);
      position = normal * extent;
      velocity = reflectOutward(velocity, normal, restitution);
    }
  } else if (kind == 2u) {
    let planeCount = min(u32(round(shape.metadata.y)), ${MAX_SHAPE_PLANES}u);
    for (var planeIndex = 0u; planeIndex < ${MAX_SHAPE_PLANES}u; planeIndex += 1u) {
      if (planeIndex >= planeCount) { break; }
      let plane = shape.planes[planeIndex];
      let penetration = dot(plane.xyz, position) - plane.w;
      if (penetration > 0.0) {
        position -= plane.xyz * (penetration + 0.0001);
        velocity = reflectOutward(velocity, plane.xyz, restitution);
      }
    }
    // A single projection pass preserves velocity for ordinary boundary
    // contacts. If an abrupt shape switch leaves the point outside another
    // plane, recycle it to the validated interior origin.
    var stillOutside = false;
    for (var verifyIndex = 0u; verifyIndex < ${MAX_SHAPE_PLANES}u; verifyIndex += 1u) {
      if (verifyIndex >= planeCount) { break; }
      let verifyPlane = shape.planes[verifyIndex];
      stillOutside = stillOutside || dot(verifyPlane.xyz, position) > verifyPlane.w + 0.0002;
    }
    if (stillOutside) {
      position = vec3f(0.0);
      velocity = vec3f(0.0);
    }
  } else {
    if (position.x < -extent || position.x > extent) {
      let normal = vec3f(select(-1.0, 1.0, position.x > 0.0), 0.0, 0.0);
      position.x = clamp(position.x, -extent, extent);
      velocity = reflectOutward(velocity, normal, restitution);
    }
    if (position.y < -extent || position.y > extent) {
      let normal = vec3f(0.0, select(-1.0, 1.0, position.y > 0.0), 0.0);
      position.y = clamp(position.y, -extent, extent);
      velocity = reflectOutward(velocity, normal, restitution);
    }
    if (position.z < -extent || position.z > extent) {
      let normal = vec3f(0.0, 0.0, select(-1.0, 1.0, position.z > 0.0));
      position.z = clamp(position.z, -extent, extent);
      velocity = reflectOutward(velocity, normal, restitution);
    }
  }

  return BoundaryResult(position, velocity);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn updateParticles(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index >= arrayLength(&sourceParticles)) { return; }

  var particle = sourceParticles[index];
  var position = particle.position.xyz;
  var velocity = particle.velocity.xyz;
  let dt = clamp(uniforms.timing.x, 0.0001, 0.05);
  let time = uniforms.timing.y;
  let energy = uniforms.timing.z;
  let damping = uniforms.timing.w;
  let pointer = uniforms.excitation.xyz;
  let modeMix = uniforms.excitation.w;
  let modeA = max(uniforms.modeA.xyz, vec3f(1.0));
  let modeB = max(uniforms.modeB.xyz, vec3f(1.0));
  let uv = position * 0.5 + vec3f(0.5);
  let fieldA = phi3(modeA, uv);
  let fieldB = phi3(modeB, uv);
  let gradientA = phi3Gradient(modeA, uv);
  let gradientB = phi3Gradient(modeB, uv);
  let weightA = (1.0 - modeMix) * uniforms.modeA.w;
  let weightB = modeMix * uniforms.modeB.w;
  let fieldValue = weightA * fieldA + weightB * fieldB;
  let fieldGradient = weightA * gradientA + weightB * gradientB;
  let delta = pointer - position;
  let distanceSquared = max(dot(delta, delta), 0.012);
  let pointerForce = delta / distanceSquared * (0.0025 + 0.0055 * energy) * uniforms.viewport.w;
  // -∇(field²) attracts particles toward the nodal surfaces where field = 0.
  let nodeForce = -2.0 * fieldValue * fieldGradient * (0.018 + 0.04 * energy) * uniforms.cameraRow0.w;
  let driftPhase = sin(time * 0.23 + f32(index % 97u));
  let drift = vec3f(-position.y, position.x, sin(time * 0.17 + position.x * 2.1)) * driftPhase * 0.006 * uniforms.cameraRow1.w;

  velocity += (pointerForce + nodeForce + drift) * dt;
  velocity *= pow(clamp(1.0 - damping, 0.02, 0.9999), dt * 60.0);
  position += velocity * dt * (0.65 + energy * 0.35);

  // A corrupt or numerically escaped particle is recycled at the origin,
  // which validation guarantees is inside every supported shape.
  let finitePosition = all(position == position) && all(abs(position) < vec3f(65536.0));
  let finiteVelocity = all(velocity == velocity) && all(abs(velocity) < vec3f(65536.0));
  if (!finitePosition || !finiteVelocity) {
    position = vec3f(0.0);
    velocity = vec3f(0.0);
  }
  let confined = confineToShape(position, velocity);
  position = confined.position;
  velocity = confined.velocity;

  particle.position = vec4f(position, 1.0);
  particle.velocity = vec4f(velocity, length(velocity));
  targetParticles[index] = particle;
}`;

  const RENDER_WGSL = `
struct Particle {
  position: vec4f,
  velocity: vec4f,
};

struct SimulationUniforms {
  timing: vec4f,
  excitation: vec4f,
  modeA: vec4f,
  modeB: vec4f,
  volume: vec4f,
  viewport: vec4f,
  cameraRow0: vec4f,
  cameraRow1: vec4f,
  cameraRow2: vec4f,
  color: vec4f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) tint: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: SimulationUniforms;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) particleIndex: u32
) -> VertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let particle = particles[particleIndex];
  let corner = corners[vertexIndex];
  let worldPosition = particle.position.xyz;
  let cameraPosition = vec3f(
    dot(uniforms.cameraRow0.xyz, worldPosition),
    dot(uniforms.cameraRow1.xyz, worldPosition),
    dot(uniforms.cameraRow2.xyz, worldPosition)
  );
  let viewport = max(uniforms.viewport.xy, vec2f(1.0));
  // Match the retained Canvas camera. GPU local coordinates are twice the
  // Canvas local coordinates, hence the cameraPosition.z * 0.5 term.
  let cameraDepth = uniforms.viewport.z;
  let denominator = max(0.3, 2.4 - cameraDepth + cameraPosition.z * 0.5);
  let focal = min(viewport.x, viewport.y) * 0.92 * uniforms.volume.w;
  let projected = vec2f(
    cameraPosition.x * focal / (viewport.x * denominator),
    -cameraPosition.y * focal / (viewport.y * denominator)
  );
  let pointDepthScale = 2.4 / denominator;
  let offset = corner * uniforms.volume.z * pointDepthScale * 2.0 / viewport;
  let speedGlow = clamp(particle.velocity.w * 18.0, 0.0, 1.0);
  let depthGlow = clamp(0.72 - cameraPosition.z * 0.18, 0.5, 1.05);
  var output: VertexOutput;
  let clipDepth = clamp(0.5 + cameraPosition.z * 0.18, 0.02, 0.98);
  output.position = vec4f(projected + offset, clipDepth, 1.0);
  output.local = corner;
  output.tint = vec4f(uniforms.color.rgb * depthGlow * (0.68 + speedGlow * 0.48), uniforms.color.a);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let radius = length(input.local);
  if (radius > 1.0) { discard; }
  let softness = 1.0 - smoothstep(0.56, 1.0, radius);
  return vec4f(input.tint.rgb, input.tint.a * softness);
}`;

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function finiteNumber(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(label + ' must be a finite number.');
    return value;
  }

  function boundedNumber(value, min, max, label) {
    const number = finiteNumber(value, label);
    if (number < min || number > max) throw new RangeError(label + ' must be between ' + min + ' and ' + max + '.');
    return number;
  }

  function integer(value, min, max, label) {
    const number = finiteNumber(value, label);
    if (!Number.isInteger(number) || number < min || number > max) {
      throw new RangeError(label + ' must be an integer between ' + min + ' and ' + max + '.');
    }
    return number;
  }

  function color(value, label) {
    if (!Array.isArray(value) || value.length !== 4) throw new TypeError(label + ' must be an RGBA array of four numbers.');
    return value.map(function validateChannel(channel, index) {
      return boundedNumber(channel, 0, 1, label + '[' + index + ']');
    });
  }

  function shapeVector(value, label) {
    const isArrayLike = Array.isArray(value) || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value));
    if (!isArrayLike || value.length !== 4) throw new TypeError(label + ' must contain [normalX, normalY, normalZ, offset].');
    const plane = Array.prototype.map.call(value, function validateComponent(component, index) {
      return finiteNumber(component, label + '[' + index + ']');
    });
    const length = Math.hypot(plane[0], plane[1], plane[2]);
    if (!(length > 0.000001)) throw new RangeError(label + ' normal must have non-zero length.');
    const offset = plane[3] / length;
    if (!(offset >= 0.01 && offset <= 2)) {
      throw new RangeError(label + ' offset must place the origin inside the shape and normalize to between 0.01 and 2.');
    }
    return [plane[0] / length, plane[1] / length, plane[2] / length, offset];
  }

  function validateShape(value) {
    if (!isPlainObject(value)) throw new TypeError('shape must be a plain object.');
    const type = value.type;
    if (type !== 'cube' && type !== 'sphere' && type !== 'convex') {
      throw new RangeError('shape.type must be "cube", "sphere", or "convex".');
    }
    const allowed = type === 'cube'
      ? ['type', 'halfExtent', 'restitution']
      : type === 'sphere'
        ? ['type', 'radius', 'restitution']
        : ['type', 'planes', 'restitution'];
    Object.keys(value).forEach(function rejectUnknown(key) {
      if (allowed.indexOf(key) < 0) throw new RangeError('Unknown ' + type + ' shape property: ' + key);
    });
    const restitution = value.restitution == null ? 0.82 : boundedNumber(value.restitution, 0, 1, 'shape.restitution');
    if (type === 'cube') {
      return {
        type: type,
        halfExtent: value.halfExtent == null ? 1 : boundedNumber(value.halfExtent, 0.05, 2, 'shape.halfExtent'),
        restitution: restitution
      };
    }
    if (type === 'sphere') {
      return {
        type: type,
        radius: value.radius == null ? 1 : boundedNumber(value.radius, 0.05, 2, 'shape.radius'),
        restitution: restitution
      };
    }
    if (!Array.isArray(value.planes) || value.planes.length < 4 || value.planes.length > MAX_SHAPE_PLANES) {
      throw new RangeError('shape.planes must contain between 4 and ' + MAX_SHAPE_PLANES + ' planes.');
    }
    return {
      type: type,
      planes: value.planes.map(function validatePlane(plane, index) {
        return shapeVector(plane, 'shape.planes[' + index + ']');
      }),
      restitution: restitution
    };
  }

  function cloneShape(shape) {
    if (shape.type === 'cube') return { type: shape.type, halfExtent: shape.halfExtent, restitution: shape.restitution };
    if (shape.type === 'sphere') return { type: shape.type, radius: shape.radius, restitution: shape.restitution };
    return {
      type: shape.type,
      planes: shape.planes.map(function clonePlane(plane) { return plane.slice(); }),
      restitution: shape.restitution
    };
  }

  function sameShape(a, b) {
    if (a.type !== b.type || a.restitution !== b.restitution) return false;
    if (a.type === 'cube') return a.halfExtent === b.halfExtent;
    if (a.type === 'sphere') return a.radius === b.radius;
    if (a.planes.length !== b.planes.length) return false;
    for (let index = 0; index < a.planes.length; index += 1) {
      for (let component = 0; component < 4; component += 1) {
        if (a.planes[index][component] !== b.planes[index][component]) return false;
      }
    }
    return true;
  }

  function packShape(shape) {
    const values = new Float32Array(SHAPE_FLOATS);
    const kind = shape.type === 'sphere' ? 1 : shape.type === 'convex' ? 2 : 0;
    const planeCount = shape.type === 'convex' ? shape.planes.length : 0;
    const extent = shape.type === 'cube' ? shape.halfExtent : shape.type === 'sphere' ? shape.radius : 1;
    values.set([kind, planeCount, extent, shape.restitution], 0);
    if (shape.type === 'convex') {
      shape.planes.forEach(function writePlane(plane, index) { values.set(plane, 4 + index * 4); });
    }
    return values;
  }

  function rotationMatrixFromEuler(x, y, z) {
    const angleX = finiteNumber(x == null ? 0 : x, 'rotation x');
    const angleY = finiteNumber(y == null ? 0 : y, 'rotation y');
    const angleZ = finiteNumber(z == null ? 0 : z, 'rotation z');
    const sx = Math.sin(angleX);
    const cx = Math.cos(angleX);
    const sy = Math.sin(angleY);
    const cy = Math.cos(angleY);
    const sz = Math.sin(angleZ);
    const cz = Math.cos(angleZ);
    return [
      cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
      sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
      -sy, cy * sx, cy * cx
    ];
  }

  function rotationMatrix(value) {
    const isArrayLike = Array.isArray(value) || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value));
    if (!isArrayLike || value.length !== 9) throw new TypeError('rotationMatrix must contain exactly nine row-major numbers.');
    const matrix = Array.prototype.map.call(value, function validateComponent(component, index) {
      return boundedNumber(component, -1.0001, 1.0001, 'rotationMatrix[' + index + ']');
    });
    const row0 = matrix.slice(0, 3);
    const row1 = matrix.slice(3, 6);
    const row2 = matrix.slice(6, 9);
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    const unitRows = [dot(row0, row0), dot(row1, row1), dot(row2, row2)].every(function unit(norm) {
      return Math.abs(norm - 1) <= 0.04;
    });
    const orthogonal = Math.abs(dot(row0, row1)) <= 0.04 && Math.abs(dot(row0, row2)) <= 0.04 && Math.abs(dot(row1, row2)) <= 0.04;
    const determinant =
      matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7]) -
      matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6]) +
      matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6]);
    if (!unitRows || !orthogonal || Math.abs(determinant - 1) > 0.06) {
      throw new RangeError('rotationMatrix must be an orthonormal 3×3 rotation matrix with determinant +1.');
    }
    return matrix;
  }

  function validateCanvas(canvas) {
    if (!canvas || typeof canvas !== 'object' || typeof canvas.getContext !== 'function') {
      throw new TypeError('canvas must expose getContext(type).');
    }
  }

  function normalizedTier(value) {
    const tier = value == null ? 'adaptive' : value;
    if (tier === 'adaptive' || tier === '64k' || tier === '128k') return tier;
    if (tier === 65536) return '64k';
    if (tier === 131072) return '128k';
    throw new RangeError('particleTier must be "adaptive", "64k", "128k", 65536, or 131072.');
  }

  function limitValue(limits, name, fallback) {
    const value = limits && Number(limits[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function countFits(count, limits) {
    const bytes = count * PARTICLE_STRIDE;
    const maxStorage = limitValue(limits, 'maxStorageBufferBindingSize', Number.MAX_SAFE_INTEGER);
    const maxBuffer = limitValue(limits, 'maxBufferSize', Number.MAX_SAFE_INTEGER);
    const maxGroups = limitValue(limits, 'maxComputeWorkgroupsPerDimension', 65535);
    const maxInvocations = limitValue(limits, 'maxComputeInvocationsPerWorkgroup', WORKGROUP_SIZE);
    return bytes <= maxStorage && bytes <= maxBuffer && Math.ceil(count / WORKGROUP_SIZE) <= maxGroups && maxInvocations >= WORKGROUP_SIZE;
  }

  function resolveParticleCount(tierValue, limits) {
    const tier = normalizedTier(tierValue);
    if (tier === '64k' || tier === '128k') {
      const explicitCount = PARTICLE_TIERS[tier];
      if (!countFits(explicitCount, limits)) throw new RangeError(tier + ' exceeds the WebGPU device limits.');
      return explicitCount;
    }
    if (countFits(PARTICLE_TIERS['128k'], limits)) return PARTICLE_TIERS['128k'];
    if (countFits(PARTICLE_TIERS['64k'], limits)) return PARTICLE_TIERS['64k'];
    const maxStorage = Math.min(
      limitValue(limits, 'maxStorageBufferBindingSize', 64 * 1024 * 1024),
      limitValue(limits, 'maxBufferSize', 64 * 1024 * 1024)
    );
    const maxGroups = limitValue(limits, 'maxComputeWorkgroupsPerDimension', 65535);
    const possible = Math.min(Math.floor(maxStorage / PARTICLE_STRIDE), maxGroups * WORKGROUP_SIZE);
    const aligned = Math.floor(possible / WORKGROUP_SIZE) * WORKGROUP_SIZE;
    if (aligned < 4096 || limitValue(limits, 'maxComputeInvocationsPerWorkgroup', WORKGROUP_SIZE) < WORKGROUP_SIZE) {
      throw new RangeError('WebGPU limits are too small for the particle backend.');
    }
    return aligned;
  }

  function defaultParameters() {
    return {
      energy: 0.78,
      damping: 0.028,
      pointerX: 0,
      pointerY: 0,
      pointerZ: 0,
      modeM: 3,
      modeN: 3,
      modeP: 2,
      modeM2: 4,
      modeN2: 2,
      modeP2: 3,
      modeMix: 0.24,
      modeWeightA: 1,
      modeWeightB: -0.72,
      aspect: 1.3125,
      depthAspect: 0.72,
      pointSize: 1.65,
      rotationMatrix: rotationMatrixFromEuler(-0.32, 0.48, 0.1),
      zoom: 0.82,
      perspective: 0,
      pointerStrength: 1,
      nodeStrength: 1,
      driftStrength: 1,
      color: [0.42, 0.9, 1, 0.86],
      backgroundColor: [0.012, 0.016, 0.035, 1]
    };
  }

  function validateParameterPatch(patch) {
    if (!isPlainObject(patch)) throw new TypeError('parameters must be a plain object.');
    Object.keys(patch).forEach(function rejectUnknown(key) {
      if (ALLOWED_PARAMETERS.indexOf(key) < 0) throw new RangeError('Unknown particle parameter: ' + key);
    });
    const result = {};
    if (Object.prototype.hasOwnProperty.call(patch, 'energy')) result.energy = boundedNumber(patch.energy, 0, 4, 'energy');
    if (Object.prototype.hasOwnProperty.call(patch, 'damping')) result.damping = boundedNumber(patch.damping, 0, 0.98, 'damping');
    if (Object.prototype.hasOwnProperty.call(patch, 'pointerX')) result.pointerX = boundedNumber(patch.pointerX, -1, 1, 'pointerX');
    if (Object.prototype.hasOwnProperty.call(patch, 'pointerY')) result.pointerY = boundedNumber(patch.pointerY, -1, 1, 'pointerY');
    if (Object.prototype.hasOwnProperty.call(patch, 'pointerZ')) result.pointerZ = boundedNumber(patch.pointerZ, -1, 1, 'pointerZ');
    if (Object.prototype.hasOwnProperty.call(patch, 'modeM')) result.modeM = integer(patch.modeM, 1, 16, 'modeM');
    if (Object.prototype.hasOwnProperty.call(patch, 'modeN')) result.modeN = integer(patch.modeN, 1, 16, 'modeN');
    if (Object.prototype.hasOwnProperty.call(patch, 'modeP')) result.modeP = integer(patch.modeP, 1, 16, 'modeP');
    if (Object.prototype.hasOwnProperty.call(patch, 'modeM2')) result.modeM2 = integer(patch.modeM2, 1, 16, 'modeM2');
    if (Object.prototype.hasOwnProperty.call(patch, 'modeN2')) result.modeN2 = integer(patch.modeN2, 1, 16, 'modeN2');
    if (Object.prototype.hasOwnProperty.call(patch, 'modeP2')) result.modeP2 = integer(patch.modeP2, 1, 16, 'modeP2');
    if (Object.prototype.hasOwnProperty.call(patch, 'modeMix')) result.modeMix = boundedNumber(patch.modeMix, 0, 1, 'modeMix');
    if (Object.prototype.hasOwnProperty.call(patch, 'modeWeightA')) result.modeWeightA = boundedNumber(patch.modeWeightA, -2, 2, 'modeWeightA');
    if (Object.prototype.hasOwnProperty.call(patch, 'modeWeightB')) result.modeWeightB = boundedNumber(patch.modeWeightB, -2, 2, 'modeWeightB');
    if (Object.prototype.hasOwnProperty.call(patch, 'aspect')) result.aspect = boundedNumber(patch.aspect, 0.25, 4, 'aspect');
    if (Object.prototype.hasOwnProperty.call(patch, 'depthAspect')) result.depthAspect = boundedNumber(patch.depthAspect, 0.25, 4, 'depthAspect');
    if (Object.prototype.hasOwnProperty.call(patch, 'pointSize')) result.pointSize = boundedNumber(patch.pointSize, 0.5, 12, 'pointSize');
    if (Object.prototype.hasOwnProperty.call(patch, 'rotationMatrix')) result.rotationMatrix = rotationMatrix(patch.rotationMatrix);
    if (Object.prototype.hasOwnProperty.call(patch, 'zoom')) result.zoom = boundedNumber(patch.zoom, 0.1, 8, 'zoom');
    if (Object.prototype.hasOwnProperty.call(patch, 'perspective')) result.perspective = boundedNumber(patch.perspective, 0, 1.5, 'perspective');
    if (Object.prototype.hasOwnProperty.call(patch, 'pointerStrength')) result.pointerStrength = boundedNumber(patch.pointerStrength, 0, 4, 'pointerStrength');
    if (Object.prototype.hasOwnProperty.call(patch, 'nodeStrength')) result.nodeStrength = boundedNumber(patch.nodeStrength, 0, 4, 'nodeStrength');
    if (Object.prototype.hasOwnProperty.call(patch, 'driftStrength')) result.driftStrength = boundedNumber(patch.driftStrength, 0, 4, 'driftStrength');
    if (Object.prototype.hasOwnProperty.call(patch, 'color')) result.color = color(patch.color, 'color');
    if (Object.prototype.hasOwnProperty.call(patch, 'backgroundColor')) result.backgroundColor = color(patch.backgroundColor, 'backgroundColor');
    return result;
  }

  function stableError(code, error) {
    return { code: code, message: String(error && error.message ? error.message : error || code) };
  }

  function isWebGPUSupported(environment) {
    const env = environment || (typeof globalThis !== 'undefined' ? globalThis : {});
    return Boolean(env && env.navigator && env.navigator.gpu && typeof env.navigator.gpu.requestAdapter === 'function');
  }

  function createInitialParticleData(count, seedValue) {
    let seed = (seedValue == null ? 0x5f3759df : integer(seedValue, 0, 0xffffffff, 'seed')) >>> 0;
    function random() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    }
    const data = new Float32Array(count * 8);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 8;
      const radius = Math.cbrt(random()) * 0.98;
      const cosTheta = random() * 2 - 1;
      const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
      const angle = random() * Math.PI * 2;
      data[offset] = Math.cos(angle) * sinTheta * radius;
      data[offset + 1] = Math.sin(angle) * sinTheta * radius;
      data[offset + 2] = cosTheta * radius;
      data[offset + 3] = 1;
      data[offset + 4] = (random() - 0.5) * 0.008;
      data[offset + 5] = (random() - 0.5) * 0.008;
      data[offset + 6] = (random() - 0.5) * 0.008;
      data[offset + 7] = 0;
    }
    return data;
  }

  function createController(canvas, settings, environment) {
    let state = 'initializing';
    let error = null;
    let device = null;
    let context = null;
    let ownsDevice = false;
    let particleCount = 0;
    let tier = normalizedTier(settings.particleTier);
    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame = 0;
    let currentIndex = 0;
    let previousTime = null;
    let animationHandle = null;
    let buffers = [];
    let uniformBuffer = null;
    let shapeBuffer = null;
    let computePipeline = null;
    let renderPipeline = null;
    let computeBindGroups = [];
    let renderBindGroups = [];
    let format = null;
    let destroyed = false;
    let parameters = Object.assign(defaultParameters(), validateParameterPatch(settings.parameters || {}));
    let currentShape = validateShape(settings.shape || { type: 'cube' });
    const subscribers = new Set();

    function snapshot() {
      const initialized = state === 'ready' || state === 'running' || state === 'stopped';
      const hasSubmittedFrame = frame > 0;
      return {
        schema: SCHEMA,
        version: VERSION,
        state: state,
        available: initialized,
        initialized: initialized,
        active: initialized && hasSubmittedFrame,
        hasSubmittedFrame: hasSubmittedFrame,
        framesSubmitted: frame,
        particleTier: tier,
        particleCount: particleCount,
        shape: cloneShape(currentShape),
        dimensions: { width: width, height: height, dpr: dpr },
        frame: frame,
        error: error ? { code: error.code, message: error.message } : null
      };
    }

    function notify() {
      const value = snapshot();
      subscribers.forEach(function call(listener) {
        try { listener(value); } catch (_error) {}
      });
    }

    function setState(nextState, nextError) {
      state = nextState;
      error = nextError || null;
      notify();
    }

    function cancelScheduledFrame() {
      if (animationHandle == null) return;
      const cancel = settings.cancelAnimationFrame || environment.cancelAnimationFrame;
      if (typeof cancel === 'function') cancel.call(environment, animationHandle);
      else if (typeof environment.clearTimeout === 'function') environment.clearTimeout(animationHandle);
      animationHandle = null;
    }

    function stop() {
      if (destroyed) return false;
      cancelScheduledFrame();
      previousTime = null;
      if (state === 'running') setState('stopped');
      return state === 'stopped' || state === 'ready';
    }

    function schedule() {
      if (state !== 'running' || destroyed) return;
      const request = settings.requestAnimationFrame || environment.requestAnimationFrame;
      if (typeof request === 'function') {
        animationHandle = request.call(environment, tick);
      } else if (typeof environment.setTimeout === 'function') {
        animationHandle = environment.setTimeout(function timeoutTick() { tick(Date.now()); }, 16);
      } else {
        setState('stopped', stableError('animation-frame-unavailable', 'No animation scheduler is available.'));
      }
    }

    function writeUniforms(deltaSeconds, timestampSeconds) {
      const values = new Float32Array(UNIFORM_FLOATS);
      const rotation = parameters.rotationMatrix;
      values.set([deltaSeconds, timestampSeconds, parameters.energy, parameters.damping], 0);
      values.set([parameters.pointerX, parameters.pointerY, parameters.pointerZ, parameters.modeMix], 4);
      values.set([parameters.modeM, parameters.modeN, parameters.modeP, parameters.modeWeightA], 8);
      values.set([parameters.modeM2, parameters.modeN2, parameters.modeP2, parameters.modeWeightB], 12);
      values.set([parameters.aspect, parameters.depthAspect, parameters.pointSize * dpr, parameters.zoom], 16);
      values.set([width, height, parameters.perspective, parameters.pointerStrength], 20);
      values.set([rotation[0], rotation[1], rotation[2], parameters.nodeStrength], 24);
      values.set([rotation[3], rotation[4], rotation[5], parameters.driftStrength], 28);
      values.set([rotation[6], rotation[7], rotation[8], 0], 32);
      values.set(parameters.color, 36);
      device.queue.writeBuffer(uniformBuffer, 0, values);
    }

    function renderFrame(timestamp) {
      if (destroyed || (state !== 'ready' && state !== 'running' && state !== 'stopped')) return false;
      const milliseconds = timestamp == null ? (environment.performance && typeof environment.performance.now === 'function' ? environment.performance.now() : Date.now()) : finiteNumber(timestamp, 'timestamp');
      const delta = previousTime == null ? 1 / 60 : Math.min(0.05, Math.max(0.0001, (milliseconds - previousTime) / 1000));
      previousTime = milliseconds;
      writeUniforms(delta, milliseconds / 1000);

      try {
        const encoder = device.createCommandEncoder({ label: 'Signal Field particle frame' });
        const computePass = encoder.beginComputePass({ label: 'Signal Field particle compute' });
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, computeBindGroups[currentIndex]);
        computePass.dispatchWorkgroups(Math.ceil(particleCount / WORKGROUP_SIZE));
        computePass.end();

        const nextIndex = 1 - currentIndex;
        const textureView = context.getCurrentTexture().createView();
        const renderPass = encoder.beginRenderPass({
          label: 'Signal Field particle render',
          colorAttachments: [{
            view: textureView,
            clearValue: {
              r: parameters.backgroundColor[0], g: parameters.backgroundColor[1],
              b: parameters.backgroundColor[2], a: parameters.backgroundColor[3]
            },
            loadOp: 'clear',
            storeOp: 'store'
          }]
        });
        renderPass.setPipeline(renderPipeline);
        renderPass.setBindGroup(0, renderBindGroups[nextIndex]);
        renderPass.draw(6, particleCount, 0, 0);
        renderPass.end();
        device.queue.submit([encoder.finish()]);
        currentIndex = nextIndex;
        const firstSubmittedFrame = frame === 0;
        frame += 1;
        if (firstSubmittedFrame) notify();
        return true;
      } catch (caught) {
        stop();
        setState('error', stableError('webgpu-frame-failed', caught));
        return false;
      }
    }

    function tick(timestamp) {
      animationHandle = null;
      if (state !== 'running') return;
      renderFrame(timestamp);
      schedule();
    }

    function start() {
      if (destroyed || (state !== 'ready' && state !== 'stopped')) return false;
      setState('running');
      schedule();
      return state === 'running';
    }

    function resize(nextWidth, nextHeight, nextDpr) {
      if (destroyed) return false;
      const cssWidth = nextWidth == null ? Number(canvas.clientWidth || canvas.width || 1) : finiteNumber(nextWidth, 'width');
      const cssHeight = nextHeight == null ? Number(canvas.clientHeight || canvas.height || 1) : finiteNumber(nextHeight, 'height');
      const pixelRatio = nextDpr == null ? Number(environment.devicePixelRatio || 1) : finiteNumber(nextDpr, 'dpr');
      if (!(cssWidth > 0) || !(cssHeight > 0)) throw new RangeError('width and height must be greater than zero.');
      if (!(pixelRatio > 0 && pixelRatio <= 4)) throw new RangeError('dpr must be greater than zero and at most 4.');
      width = Math.max(1, Math.round(cssWidth * pixelRatio));
      height = Math.max(1, Math.round(cssHeight * pixelRatio));
      dpr = pixelRatio;
      canvas.width = width;
      canvas.height = height;
      if (context && device && format) context.configure({ device: device, format: format, alphaMode: settings.alphaMode || 'premultiplied' });
      notify();
      return true;
    }

    function setParameters(patch) {
      if (destroyed) return false;
      const validated = validateParameterPatch(patch);
      parameters = Object.assign({}, parameters, validated);
      parameters.color = parameters.color.slice();
      parameters.backgroundColor = parameters.backgroundColor.slice();
      parameters.rotationMatrix = parameters.rotationMatrix.slice();
      return true;
    }

    function setShape(nextShape) {
      if (destroyed || state === 'lost' || state === 'error' || state === 'unsupported') return false;
      const validated = validateShape(nextShape);
      if (sameShape(currentShape, validated)) return false;
      currentShape = validated;
      if (device && shapeBuffer) device.queue.writeBuffer(shapeBuffer, 0, packShape(currentShape));
      notify();
      return true;
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function.');
      subscribers.add(listener);
      listener(snapshot());
      return function unsubscribe() { subscribers.delete(listener); };
    }

    function handleDeviceLost(info) {
      if (destroyed) return;
      stop();
      setState('lost', stableError('webgpu-device-lost', info && (info.message || info.reason) ? info.message || info.reason : 'WebGPU device was lost.'));
    }

    function destroy() {
      if (destroyed) return false;
      stop();
      destroyed = true;
      buffers.forEach(function destroyBuffer(buffer) { if (buffer && typeof buffer.destroy === 'function') buffer.destroy(); });
      if (uniformBuffer && typeof uniformBuffer.destroy === 'function') uniformBuffer.destroy();
      if (shapeBuffer && typeof shapeBuffer.destroy === 'function') shapeBuffer.destroy();
      if (context && typeof context.unconfigure === 'function') context.unconfigure();
      if (ownsDevice && settings.destroyDeviceOnDestroy !== false && device && typeof device.destroy === 'function') device.destroy();
      buffers = [];
      uniformBuffer = null;
      shapeBuffer = null;
      setState('destroyed');
      subscribers.clear();
      return true;
    }

    async function initialize() {
      const gpu = settings.gpu || (environment.navigator && environment.navigator.gpu);
      if (!gpu || typeof gpu.requestAdapter !== 'function') {
        setState('unsupported', stableError('webgpu-unavailable', 'WebGPU is unavailable; the existing renderer remains untouched.'));
        return;
      }
      try {
        const adapter = settings.adapter || await gpu.requestAdapter(settings.adapterOptions || undefined);
        if (!adapter) {
          setState('unsupported', stableError('webgpu-adapter-unavailable', 'No WebGPU adapter was returned.'));
          return;
        }
        device = settings.device || await adapter.requestDevice(settings.deviceDescriptor || undefined);
        ownsDevice = !settings.device;
        if (!device) throw new Error('No WebGPU device was returned.');
        const limits = device.limits || adapter.limits || {};
        particleCount = resolveParticleCount(tier, limits);
        context = canvas.getContext('webgpu');
        if (!context) {
          setState('unsupported', stableError('webgpu-canvas-context-unavailable', 'Canvas WebGPU context is unavailable.'));
          return;
        }
        format = settings.format || (typeof gpu.getPreferredCanvasFormat === 'function' ? gpu.getPreferredCanvasFormat() : 'bgra8unorm');
        resize(settings.width, settings.height, settings.dpr);

        const usage = settings.GPUBufferUsage || environment.GPUBufferUsage || BUFFER_USAGE;
        const particleBytes = particleCount * PARTICLE_STRIDE;
        buffers = [0, 1].map(function makeParticleBuffer(index) {
          return device.createBuffer({
            label: 'Signal Field particles ' + index,
            size: particleBytes,
            usage: usage.STORAGE | usage.COPY_DST
          });
        });
        uniformBuffer = device.createBuffer({ label: 'Signal Field uniforms', size: UNIFORM_BYTES, usage: usage.UNIFORM | usage.COPY_DST });
        shapeBuffer = device.createBuffer({ label: 'Signal Field shape', size: SHAPE_BYTES, usage: usage.STORAGE | usage.COPY_DST });
        const initialData = createInitialParticleData(particleCount, settings.seed);
        device.queue.writeBuffer(buffers[0], 0, initialData);
        device.queue.writeBuffer(buffers[1], 0, initialData);
        device.queue.writeBuffer(shapeBuffer, 0, packShape(currentShape));

        const computeModule = device.createShaderModule({ label: 'Signal Field compute shader', code: COMPUTE_WGSL });
        const renderModule = device.createShaderModule({ label: 'Signal Field render shader', code: RENDER_WGSL });
        computePipeline = device.createComputePipeline({
          label: 'Signal Field compute pipeline', layout: 'auto',
          compute: { module: computeModule, entryPoint: 'updateParticles' }
        });
        renderPipeline = device.createRenderPipeline({
          label: 'Signal Field render pipeline', layout: 'auto',
          vertex: { module: renderModule, entryPoint: 'vertexMain' },
          fragment: {
            module: renderModule,
            entryPoint: 'fragmentMain',
            targets: [{
              format: format,
              blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
              }
            }]
          },
          primitive: { topology: 'triangle-list' }
        });

        const computeLayout = computePipeline.getBindGroupLayout(0);
        computeBindGroups = [
          device.createBindGroup({ layout: computeLayout, entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: { buffer: buffers[0] } },
            { binding: 2, resource: { buffer: buffers[1] } },
            { binding: 3, resource: { buffer: shapeBuffer } }
          ] }),
          device.createBindGroup({ layout: computeLayout, entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: { buffer: buffers[1] } },
            { binding: 2, resource: { buffer: buffers[0] } },
            { binding: 3, resource: { buffer: shapeBuffer } }
          ] })
        ];
        const renderLayout = renderPipeline.getBindGroupLayout(0);
        renderBindGroups = buffers.map(function makeRenderBindGroup(buffer) {
          return device.createBindGroup({ layout: renderLayout, entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: { buffer: buffer } }
          ] });
        });

        if (device.lost && typeof device.lost.then === 'function') device.lost.then(handleDeviceLost, handleDeviceLost);
        setState('ready');
        if (settings.autoStart === true) start();
      } catch (caught) {
        setState('error', stableError('webgpu-initialization-failed', caught));
      }
    }

    return {
      initialize: initialize,
      getStatus: snapshot,
      subscribe: subscribe,
      start: start,
      stop: stop,
      resize: resize,
      setParameters: setParameters,
      setShape: setShape,
      renderFrame: renderFrame,
      destroy: destroy
    };
  }

  async function createWebGPUParticleBackend(canvas, options) {
    validateCanvas(canvas);
    if (options != null && !isPlainObject(options)) throw new TypeError('options must be a plain object.');
    const settings = Object.assign({ particleTier: 'adaptive', autoStart: false }, options || {});
    normalizedTier(settings.particleTier);
    if (settings.autoStart !== true && settings.autoStart !== false) throw new TypeError('autoStart must be a boolean.');
    if (settings.destroyDeviceOnDestroy != null && typeof settings.destroyDeviceOnDestroy !== 'boolean') throw new TypeError('destroyDeviceOnDestroy must be a boolean.');
    if (settings.parameters != null) validateParameterPatch(settings.parameters);
    if (settings.shape != null) validateShape(settings.shape);
    const environment = settings.environment || (typeof globalThis !== 'undefined' ? globalThis : {});
    if (!environment || typeof environment !== 'object') throw new TypeError('environment must be an object.');
    const controller = createController(canvas, settings, environment);
    await controller.initialize();
    delete controller.initialize;
    return controller;
  }

  return Object.freeze({
    VERSION: VERSION,
    SCHEMA: SCHEMA,
    WORKGROUP_SIZE: WORKGROUP_SIZE,
    PARTICLE_STRIDE: PARTICLE_STRIDE,
    UNIFORM_BYTES: UNIFORM_BYTES,
    MAX_SHAPE_PLANES: MAX_SHAPE_PLANES,
    SHAPE_BYTES: SHAPE_BYTES,
    PARTICLE_TIERS: PARTICLE_TIERS,
    COMPUTE_WGSL: COMPUTE_WGSL,
    RENDER_WGSL: RENDER_WGSL,
    isWebGPUSupported: isWebGPUSupported,
    resolveParticleCount: resolveParticleCount,
    rotationMatrixFromEuler: rotationMatrixFromEuler,
    createWebGPUParticleBackend: createWebGPUParticleBackend,
    create: createWebGPUParticleBackend
  });
}));
