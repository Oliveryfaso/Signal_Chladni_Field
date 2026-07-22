// Signal Field modification notice (2026-07-20). See LICENSE, UPSTREAM_NOTICE.md, and MODIFICATIONS.md.
import AppKit
import CoreGraphics
import Metal
import MetalKit
import QuartzCore
import ScreenSaver

private let rotationSpeedMinimum = 0.0
private let rotationSpeedMaximum = 4.0
private let rotationSpeedStep = 0.05

private func localized(_ key: String) -> String {
    Bundle(for: SoundMotionScreenSaverView.self).localizedString(forKey: key, value: key, table: nil)
}

private func clampedRotationSpeed(_ value: Double) -> Double {
    min(rotationSpeedMaximum, max(rotationSpeedMinimum, value))
}

private func formattedRotationSpeed(_ value: Double) -> String {
    String(format: "%.2f×", locale: Locale.current, clampedRotationSpeed(value))
}

private enum ScreenSaverStyle: String, CaseIterable {
    case modalSand = "msand"
    case cosmic = "cosmic"

    var title: String {
        switch self {
        case .modalSand: return localized("Style.ModalSand")
        case .cosmic: return localized("Style.Cosmic")
        }
    }
}

private enum ScreenSaverMotion: String, CaseIterable {
    case precession = "precess"
    case orbit = "single"
    case tumble

    var title: String {
        switch self {
        case .precession: return localized("Motion.Precession")
        case .orbit: return localized("Motion.Orbit")
        case .tumble: return localized("Motion.Tumble")
        }
    }
}

private struct ParticleSnapshot {
    let count: Int
    let strideBytes: Int
    let patternCount: Int
    let sandParticles: Data
    let cosmicParticles: Data
    let sandPatternTimes: [Float]
    let cosmicPatternTimes: [Float]
    let atlasPNG: Data
}

private let metalShaderSource = #"""
#include <metal_stdlib>
using namespace metal;

struct Uniforms {
    float4 r0;
    float4 r1;
    float4 r2;
    float4 viewport;
    float4 timing;
    float4 sand;
    float4 effects;
    uint4 control;
};

struct PackedParticle {
    packed_short3 position;
    ushort onNode;
    ushort webVisibility;
    uchar palette;
    uchar padding;
};

struct ParticleOut {
    float4 position [[position]];
    float pointSize [[point_size]];
    float3 color;
    float alpha;
    float visible;
    float grain;
};

float3 starTint(uint index) {
    switch (index) {
        case 0: return float3(200.0, 214.0, 255.0) / 255.0;
        case 1: return float3(226.0, 236.0, 255.0) / 255.0;
        case 2: return float3(1.0);
        case 3: return float3(255.0, 246.0, 226.0) / 255.0;
        case 4: return float3(255.0, 216.0, 170.0) / 255.0;
        case 5: return float3(255.0, 182.0, 140.0) / 255.0;
        default: return float3(255.0, 150.0, 120.0) / 255.0;
    }
}

float3 cosmicPalette(uint bucket) {
    uint emission = min(5u, bucket / 8u);
    uint heatIndex = min(7u, bucket % 8u);
    float3 base;
    switch (emission) {
        case 0: base = float3(40.0, 150.0, 118.0); break;
        case 1: base = float3(46.0, 190.0, 200.0); break;
        case 2: base = float3(70.0, 120.0, 235.0); break;
        case 3: base = float3(182.0, 206.0, 255.0); break;
        case 4: base = float3(236.0, 182.0, 92.0); break;
        default: base = float3(230.0, 72.0, 96.0); break;
    }
    float heat = float(heatIndex) / 7.0;
    float whiteMix = heat * heat * 0.72;
    float brightness = 0.32 + 0.68 * heat;
    return floor(min(float3(255.0), (base * (1.0 - whiteMix) + 255.0 * whiteMix) * brightness)) / 255.0;
}

float particleLight(float3 view, float3 local, float depth, int lightMode, float2 sweep) {
    float value;
    if (lightMode == 1) {
        value = 0.18 + 0.22 * depth;
    } else if (lightMode == 2) {
        value = 0.2 + 0.45 * (1.0 - view.y / 0.55);
    } else if (lightMode == 3) {
        value = 0.2 + 0.45 * (1.0 + view.y / 0.55);
    } else if (lightMode == 4) {
        value = 0.2 + 0.45 * (1.0 - view.x / 0.55);
    } else if (lightMode == 5) {
        value = 0.2 + 0.45 * (1.0 + view.x / 0.55);
    } else if (lightMode == 6) {
        float2 delta = float2(view.x / 0.55 - 0.65, view.y / 0.55 + 0.65);
        value = (0.22 + exp(-1.1 * dot(delta, delta))) * (0.55 + 0.6 * depth);
    } else if (lightMode == 7) {
        value = 0.15 + 1.05 * clamp((length(local) * 2.0 - 0.55) * 2.0, 0.0, 1.0);
    } else if (lightMode == 8) {
        value = 0.18 + clamp(1.0 - length(local) * 1.9, 0.0, 1.0);
    } else if (lightMode == 9) {
        value = 0.2 + 0.9 * max(0.0, dot(view.xy / 0.55, sweep));
    } else {
        value = 0.2 + 0.58 * depth;
    }
    return clamp(value, 0.1, 1.3);
}

vertex ParticleOut particleVertex(
    const device PackedParticle *particles [[buffer(0)]],
    constant Uniforms &u [[buffer(1)]],
    uint vertexID [[vertex_id]]
) {
    PackedParticle particle = particles[vertexID];
    float3 local = float3(particle.position) * (0.5 / 32767.0);
    float onNode = float(particle.onNode) / 65535.0;
    float webVisibility = float(particle.webVisibility) / 65535.0;
    float3 particleColor = cosmicPalette(uint(particle.palette));
    float3 view = float3(dot(u.r0.xyz, local), dot(u.r1.xyz, local), dot(u.r2.xyz, local));
    float depth = (view.z + 1.2) / 2.4;
    float focal = min(u.viewport.x, u.viewport.y) * 0.92 * u.viewport.z;
    float perspective = focal / max(0.35, 2.4 - u.viewport.w + view.z);
    float2 pixel = u.viewport.xy * 0.5 + view.xy * perspective;

    ParticleOut out;
    out.position = float4(pixel.x / (u.viewport.x * 0.5) - 1.0, 1.0 - pixel.y / (u.viewport.y * 0.5), 0.0, 1.0);
    float pointSize = max(0.7, perspective * 0.0017 * (0.6 + depth));
    float maxPoint = (u.viewport.z > 1.3 ? 2.4 : 2.8) * u.timing.x;
    pointSize = clamp(floor(pointSize + 0.5), 1.0, maxPoint);

    int lightMode = int(u.timing.z + 0.5);
    int style = int(u.timing.w + 0.5);
    uint pass = u.control.x;
    float2 sweep = float2(cos(u.effects.x * 0.9), sin(u.effects.x * 0.9));
    float light = particleLight(view, local, depth, lightMode, sweep);
    float id = float(vertexID);
    out.grain = fmod(id, 64.0);
    out.visible = 1.0;

    if (style == 0) {
        out.color = float3(1.0);
        out.alpha = (u.sand.x + u.sand.y * pow(onNode, u.sand.z)) * light;
        out.pointSize = pointSize;
        return out;
    }

    float cosmicLight = clamp(light * 0.68, 0.08, 0.82);
    float cosmicSharpen = u.sand.w;
    float cosmicFloor = 0.024 * (1.0 - 0.65 * min(1.0, cosmicSharpen / 1.6));
    float cosmicScale = 0.48 + 0.16 * min(1.0, cosmicSharpen);
    float cosmicAlpha = (cosmicFloor + cosmicScale * pow(onNode, 1.7 + cosmicSharpen)) * cosmicLight * webVisibility;
    out.color = particleColor;
    out.alpha = cosmicAlpha;

    if (pass == 1) {
        out.pointSize = pointSize + 4.4 * u.timing.x;
        out.alpha *= u.effects.y;
    } else if (pass == 2) {
        uint starBits = (vertexID ^ 0x9e37u) * 2654435761u;
        float starSeed = float(starBits) / 4294967296.0;
        if (onNode < 0.82 || webVisibility < 0.4 || starSeed > 0.05) {
            out.visible = 0.0;
            out.pointSize = 1.0;
        } else {
            uint temperatureBits = (vertexID ^ 0x5bd1u) * 2246822519u;
            float temperature = pow(float(temperatureBits) / 4294967296.0, 1.7);
            uint tintIndex = min(6u, uint(temperature * 7.0));
            out.color = starTint(tintIndex);
            float twinkle = 0.3 + 0.7 * (0.5 + 0.5 * sin(u.effects.x * 3.0 + starSeed * 62.0));
            out.alpha = twinkle * webVisibility * cosmicLight * 0.62;
            out.pointSize = pointSize * (3.8 + onNode * 4.2);
        }
    } else {
        out.pointSize = pointSize;
    }
    return out;
}

fragment float4 particleFragment(
    ParticleOut in [[stage_in]],
    float2 pointCoord [[point_coord]],
    texture2d<float> grainAtlas [[texture(0)]]
) {
    if (in.visible < 0.5 || in.alpha <= 0.001) discard_fragment();
    constexpr sampler atlasSampler(coord::normalized, address::clamp_to_edge, filter::linear);

    if (in.grain >= 0.0 && in.grain < 64.0) {
        float2 cell = float2(fmod(in.grain, 8.0), floor(in.grain / 8.0));
        float4 grain = grainAtlas.sample(atlasSampler, (cell + pointCoord) / 8.0);
        float alpha = grain.a * clamp(in.alpha, 0.0, 1.0);
        if (alpha <= 0.002) discard_fragment();
        return float4(grain.rgb, alpha);
    }
    return float4(in.color, clamp(in.alpha, 0.0, 1.0));
}

fragment float4 cosmicFragment(
    ParticleOut in [[stage_in]],
    float2 pointCoord [[point_coord]],
    constant Uniforms &u [[buffer(1)]]
) {
    if (in.visible < 0.5 || in.alpha <= 0.001) discard_fragment();
    uint pass = u.control.x;
    if (pass == 1) {
        float radius = length(pointCoord - float2(0.5)) * 2.0;
        float halo = exp(-4.5 * radius * radius);
        if (halo <= 0.002) discard_fragment();
        return float4(in.color, clamp(in.alpha * halo, 0.0, 1.0));
    }
    if (pass == 2) {
        float radius = length(pointCoord - float2(0.5)) * 2.0;
        if (radius >= 1.0) discard_fragment();
        float coreMix = clamp(radius / 0.3, 0.0, 1.0);
        float3 color = mix(float3(1.0), in.color, coreMix);
        float spriteAlpha = radius <= 0.3
            ? mix(1.0, 0.72, radius / 0.3)
            : 0.72 * (1.0 - (radius - 0.3) / 0.7);
        float alpha = clamp(in.alpha * spriteAlpha, 0.0, 1.0);
        if (alpha <= 0.002) discard_fragment();
        return float4(color, alpha);
    }
    return float4(in.color, clamp(in.alpha, 0.0, 1.0));
}
"""#

private struct MetalUniforms {
    var r0 = SIMD4<Float>(1, 0, 0, 0)
    var r1 = SIMD4<Float>(0, 1, 0, 0)
    var r2 = SIMD4<Float>(0, 0, 1, 0)
    var viewport = SIMD4<Float>(1, 1, 3, 0)
    var timing = SIMD4<Float>(2, 0, 9, 0)
    var sand = SIMD4<Float>(0.006, 0.99, 2.55, 0)
    var effects = SIMD4<Float>(0, 0.06, 0, 0)
    var control = SIMD4<UInt32>(0, 0, 0, 0)
}

private final class MetalScene {
    let device: MTLDevice
    let commandQueue: MTLCommandQueue
    let grainTexture: MTLTexture
    let sandPipeline: MTLRenderPipelineState
    let cosmicPipeline: MTLRenderPipelineState
    let particleCount: Int
    let patternCount: Int
    private let sandParticles: Data
    private let cosmicParticles: Data
    private let sandParticleBuffers: [MTLBuffer]
    private let cosmicParticleBuffers: [MTLBuffer]
    private let patternStrideBytes: Int
    private let sandPatternTimes: [Float]
    private let cosmicPatternTimes: [Float]
    private let patternLock = NSLock()
    private var activeBufferSlot = 0
    private var activePatternIndex = -1

    init(snapshot: ParticleSnapshot) throws {
        guard snapshot.count > 0, snapshot.strideBytes == 12, snapshot.patternCount > 0 else { throw SceneError.invalidStride }
        let patternStrideBytes = snapshot.count * snapshot.strideBytes
        let expectedBytes = patternStrideBytes * snapshot.patternCount
        guard snapshot.sandParticles.count == expectedBytes,
              snapshot.cosmicParticles.count == expectedBytes,
              snapshot.sandPatternTimes.count == snapshot.patternCount,
              snapshot.cosmicPatternTimes.count == snapshot.patternCount else {
            throw SceneError.invalidParticleData
        }
        guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
            throw SceneError.metalUnavailable
        }
        self.device = device
        self.commandQueue = queue
        self.particleCount = snapshot.count
        self.patternCount = snapshot.patternCount
        self.patternStrideBytes = patternStrideBytes
        self.sandPatternTimes = snapshot.sandPatternTimes
        self.cosmicPatternTimes = snapshot.cosmicPatternTimes
        self.sandParticles = snapshot.sandParticles
        self.cosmicParticles = snapshot.cosmicParticles

        let sandBuffers = (0..<2).compactMap { _ in device.makeBuffer(length: patternStrideBytes, options: .storageModeShared) }
        let cosmicBuffers = (0..<2).compactMap { _ in device.makeBuffer(length: patternStrideBytes, options: .storageModeShared) }
        guard sandBuffers.count == 2, cosmicBuffers.count == 2 else { throw SceneError.bufferCreationFailed }
        self.sandParticleBuffers = sandBuffers
        self.cosmicParticleBuffers = cosmicBuffers

        let loader = MTKTextureLoader(device: device)
        self.grainTexture = try loader.newTexture(data: snapshot.atlasPNG, options: [
            .SRGB: false,
            .origin: MTKTextureLoader.Origin.topLeft
        ])

        let library = try device.makeLibrary(source: metalShaderSource, options: nil)
        guard let vertex = library.makeFunction(name: "particleVertex"),
              let sandFragment = library.makeFunction(name: "particleFragment"),
              let cosmicFragment = library.makeFunction(name: "cosmicFragment") else {
            throw SceneError.shaderFunctionMissing
        }
        self.sandPipeline = try MetalScene.makePipeline(
            device: device,
            vertex: vertex,
            fragment: sandFragment,
            additive: false
        )
        self.cosmicPipeline = try MetalScene.makePipeline(
            device: device,
            vertex: vertex,
            fragment: cosmicFragment,
            additive: true
        )
        _ = selectPattern(0)
    }

    func particleState(for style: ScreenSaverStyle) -> (buffer: MTLBuffer, time: Float, patternIndex: Int) {
        patternLock.lock()
        defer { patternLock.unlock() }
        let index = max(0, activePatternIndex)
        let buffer = style == .modalSand ? sandParticleBuffers[activeBufferSlot] : cosmicParticleBuffers[activeBufferSlot]
        let time = style == .modalSand ? sandPatternTimes[index] : cosmicPatternTimes[index]
        return (buffer, time, index)
    }

    @discardableResult
    func selectPattern(_ rawPatternIndex: Int) -> Int {
        let index = normalizedPatternIndex(rawPatternIndex)
        patternLock.lock()
        defer { patternLock.unlock() }
        guard index != activePatternIndex else { return index }
        let nextSlot = activePatternIndex < 0 ? activeBufferSlot : 1 - activeBufferSlot
        let offset = index * patternStrideBytes
        sandParticles.withUnsafeBytes { bytes in
            sandParticleBuffers[nextSlot].contents().copyMemory(from: bytes.baseAddress!.advanced(by: offset), byteCount: patternStrideBytes)
        }
        cosmicParticles.withUnsafeBytes { bytes in
            cosmicParticleBuffers[nextSlot].contents().copyMemory(from: bytes.baseAddress!.advanced(by: offset), byteCount: patternStrideBytes)
        }
        activeBufferSlot = nextSlot
        activePatternIndex = index
        return index
    }

    func normalizedPatternIndex(_ rawPatternIndex: Int) -> Int {
        guard patternCount > 1 else { return 0 }
        return ((rawPatternIndex % patternCount) + patternCount) % patternCount
    }

    private static func makePipeline(
        device: MTLDevice,
        vertex: MTLFunction,
        fragment: MTLFunction,
        additive: Bool
    ) throws -> MTLRenderPipelineState {
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = vertex
        descriptor.fragmentFunction = fragment
        descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
        descriptor.colorAttachments[0].isBlendingEnabled = true
        descriptor.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
        descriptor.colorAttachments[0].destinationRGBBlendFactor = additive ? .one : .oneMinusSourceAlpha
        descriptor.colorAttachments[0].sourceAlphaBlendFactor = .one
        descriptor.colorAttachments[0].destinationAlphaBlendFactor = additive ? .one : .oneMinusSourceAlpha
        return try device.makeRenderPipelineState(descriptor: descriptor)
    }

    enum SceneError: Error {
        case invalidStride
        case invalidParticleData
        case metalUnavailable
        case bufferCreationFailed
        case shaderFunctionMissing
    }
}

private struct MotionState {
    private(set) var rotation: [Float]
    private var precessionPhase: Float = 0
    private var tumbleRemaining: Float = 0
    private var tumbleAxis = SIMD3<Float>(0, 1, 0)
    private var tumbleSpin: Float = 1
    private var randomState: UInt32 = 0x58c3_1a27
    private var updateCount = 0

    init() {
        rotation = MotionState.multiply(
            MotionState.axisRotation(SIMD3<Float>(1, 0, 0), angle: 0.5),
            MotionState.axisRotation(SIMD3<Float>(0, 1, 0), angle: 0.6)
        )
    }

    mutating func advance(deltaTime: Float, mode: ScreenSaverMotion, speed: Float = 1) {
        let dt = min(0.05, max(0.001, deltaTime))
        let rotationSpeed = max(0, speed)
        guard rotationSpeed > 0 else { return }
        var axis = SIMD3<Float>(0, 1, 0)
        var spin: Float = 1

        switch mode {
        case .orbit:
            break
        case .precession:
            precessionPhase += dt * 0.5 * rotationSpeed
            let tilt: Float = 0.95
            axis = SIMD3<Float>(
                sin(tilt) * cos(precessionPhase),
                cos(tilt),
                sin(tilt) * sin(precessionPhase)
            )
        case .tumble:
            tumbleRemaining -= dt
            if tumbleRemaining <= 0 {
                tumbleRemaining = 0.5 + random() * 1.4
                tumbleAxis = randomAxis()
                tumbleSpin = 0.5 + random() * 1.5 + (random() < 0.25 ? 1.8 : 0)
            }
            axis = tumbleAxis
            spin = tumbleSpin
        }

        rotation = MotionState.multiply(
            MotionState.axisRotation(axis, angle: rotationSpeed * spin * dt),
            rotation
        )
        updateCount += 1
        if updateCount % 300 == 0 { orthonormalize() }
    }

    private mutating func random() -> Float {
        randomState = randomState &* 1_664_525 &+ 1_013_904_223
        return Float(randomState) / Float(UInt32.max)
    }

    private mutating func randomAxis() -> SIMD3<Float> {
        MotionState.normalized(SIMD3<Float>(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1))
    }

    private mutating func orthonormalize() {
        var x = MotionState.normalized(SIMD3<Float>(rotation[0], rotation[1], rotation[2]))
        var y = SIMD3<Float>(rotation[3], rotation[4], rotation[5])
        y -= x * MotionState.dot(x, y)
        y = MotionState.normalized(y)
        let z = SIMD3<Float>(x.y * y.z - x.z * y.y, x.z * y.x - x.x * y.z, x.x * y.y - x.y * y.x)
        x = MotionState.normalized(x)
        rotation = [x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z]
    }

    private static func dot(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> Float {
        a.x * b.x + a.y * b.y + a.z * b.z
    }

    private static func normalized(_ value: SIMD3<Float>) -> SIMD3<Float> {
        let length = sqrt(max(0.000_001, dot(value, value)))
        return value / length
    }

    private static func axisRotation(_ rawAxis: SIMD3<Float>, angle: Float) -> [Float] {
        let axis = normalized(rawAxis)
        let c = cos(angle)
        let s = sin(angle)
        let t = 1 - c
        let x = axis.x, y = axis.y, z = axis.z
        return [
            t*x*x+c, t*x*y-s*z, t*x*z+s*y,
            t*x*y+s*z, t*y*y+c, t*y*z-s*x,
            t*x*z-s*y, t*y*z+s*x, t*z*z+c
        ]
    }

    private static func multiply(_ a: [Float], _ b: [Float]) -> [Float] {
        var result = Array(repeating: Float(0), count: 9)
        for row in 0..<3 {
            for column in 0..<3 {
                for index in 0..<3 {
                    result[row * 3 + column] += a[row * 3 + index] * b[index * 3 + column]
                }
            }
        }
        return result
    }
}

private final class MetalScreenSaverRenderer: NSObject {
    private let scene: MetalScene
    private weak var layer: CAMetalLayer?
    private var motionState = MotionState()
    private var lastFrameTime = CACurrentMediaTime()
    private var loggedDrawableFailure = false
    private var loggedFirstFrame = false
    private(set) var submittedFrameCount = 0
    var style: ScreenSaverStyle
    var motion: ScreenSaverMotion
    var speed: Float
    var patternIndex: Int
    var patternCount: Int { scene.patternCount }

    init(scene: MetalScene, layer: CAMetalLayer, style: ScreenSaverStyle, motion: ScreenSaverMotion, speed: Float, patternIndex: Int) {
        self.scene = scene
        self.layer = layer
        self.style = style
        self.motion = motion
        self.speed = speed
        self.patternIndex = scene.selectPattern(patternIndex)
        super.init()
        layer.device = scene.device
        layer.pixelFormat = .bgra8Unorm
        layer.framebufferOnly = true
        layer.isOpaque = true
        layer.backgroundColor = CGColor(red: 5.0 / 255.0, green: 6.0 / 255.0, blue: 8.0 / 255.0, alpha: 1)
        layer.colorspace = CGColorSpace(name: CGColorSpace.sRGB)
        layer.presentsWithTransaction = false
        layer.maximumDrawableCount = 2
        layer.allowsNextDrawableTimeout = true
        layer.displaySyncEnabled = true
    }

    func resetClock() {
        lastFrameTime = CACurrentMediaTime()
    }

    func resize(to drawableSize: CGSize, contentsScale: CGFloat) {
        guard let layer else { return }
        let size = CGSize(width: max(1, drawableSize.width.rounded()), height: max(1, drawableSize.height.rounded()))
        layer.contentsScale = max(1, contentsScale)
        if layer.drawableSize != size { layer.drawableSize = size }
    }

    func releaseDrawables() {
        layer?.drawableSize = CGSize(width: 1, height: 1)
    }

    func selectPattern(_ rawPatternIndex: Int) {
        patternIndex = scene.selectPattern(rawPatternIndex)
    }

    func draw(dpr: Float) {
        guard let layer,
              let drawable = layer.nextDrawable(),
              let commandBuffer = scene.commandQueue.makeCommandBuffer(),
              drawable.texture.width > 1,
              drawable.texture.height > 1 else {
            if !loggedDrawableFailure {
                loggedDrawableFailure = true
                NSLog("Signal Field: drawable unavailable or 1x1")
            }
            return
        }

        let descriptor = MTLRenderPassDescriptor()
        descriptor.colorAttachments[0].texture = drawable.texture
        descriptor.colorAttachments[0].loadAction = .clear
        descriptor.colorAttachments[0].storeAction = .store
        descriptor.colorAttachments[0].clearColor = MTLClearColor(red: 5.0 / 255.0, green: 6.0 / 255.0, blue: 8.0 / 255.0, alpha: 1)
        guard let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor) else { return }

        let now = CACurrentMediaTime()
        let dt = Float(min(0.05, max(0.001, now - lastFrameTime)))
        lastFrameTime = now
        motionState.advance(deltaTime: dt, mode: motion, speed: speed)

        let rotation = motionState.rotation
        let zoom: Float = 3
        let sharpen = zoom > 1.3 ? min(2.4, (zoom - 1.3) * 0.42) : 0
        let sandFloor = 0.006 * (1 - 0.85 * min(1, sharpen / 2.2))
        let sandScale = 0.99 + 0.01 * min(1, sharpen)
        let sandExponent = 2 + 0.8 * 0.55 + sharpen
        let cosmicSharpen = zoom > 1.3 ? min(1.6, (zoom - 1.3) * 0.30) : 0
        let bloomAlpha = 0.14 * max(0, 1 - (zoom - 1) / 3.5)
        let particleState = scene.particleState(for: style)
        patternIndex = particleState.patternIndex
        let patternTime = particleState.time
        let viewportWidth = Float(drawable.texture.width)
        let viewportHeight = Float(drawable.texture.height)
        var uniforms = MetalUniforms(
            r0: SIMD4<Float>(rotation[0], rotation[1], rotation[2], 0),
            r1: SIMD4<Float>(rotation[3], rotation[4], rotation[5], 0),
            r2: SIMD4<Float>(rotation[6], rotation[7], rotation[8], 0),
            viewport: SIMD4<Float>(viewportWidth, viewportHeight, zoom, 0),
            timing: SIMD4<Float>(dpr, 0, 9, style == .modalSand ? 0 : 1),
            sand: SIMD4<Float>(sandFloor, sandScale, sandExponent, cosmicSharpen),
            effects: SIMD4<Float>(patternTime, bloomAlpha, 0, 0),
            control: SIMD4<UInt32>(0, 0, 0, 0)
        )

        encoder.setVertexBuffer(
            particleState.buffer,
            offset: 0,
            index: 0
        )
        encoder.setFragmentTexture(scene.grainTexture, index: 0)

        if style == .modalSand {
            encoder.setRenderPipelineState(scene.sandPipeline)
            encoder.setVertexBytes(&uniforms, length: MemoryLayout<MetalUniforms>.stride, index: 1)
            encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: scene.particleCount)
        } else {
            encoder.setRenderPipelineState(scene.cosmicPipeline)
            for pass: UInt32 in [0, 2, 1] {
                uniforms.control.x = pass
                encoder.setVertexBytes(&uniforms, length: MemoryLayout<MetalUniforms>.stride, index: 1)
                encoder.setFragmentBytes(&uniforms, length: MemoryLayout<MetalUniforms>.stride, index: 1)
                encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: scene.particleCount)
            }
        }

        encoder.endEncoding()
        let isFirstFrame = submittedFrameCount == 0
        if isFirstFrame {
            commandBuffer.addCompletedHandler { buffer in
                if let error = buffer.error {
                    NSLog("Signal Field: first Metal frame failed: %@", error.localizedDescription)
                } else {
                    NSLog("Signal Field: first Metal frame completed")
                }
            }
        }
        commandBuffer.present(drawable)
        commandBuffer.commit()
        submittedFrameCount += 1
        if !loggedFirstFrame {
            loggedFirstFrame = true
            NSLog(
                "Signal Field: rendering %dx%d @ %.2fx, %d particles, %@",
                drawable.texture.width,
                drawable.texture.height,
                dpr,
                scene.particleCount,
                style.rawValue
            )
        }
    }
}

private struct SaverConfiguration {
    var style: ScreenSaverStyle
    var motion: ScreenSaverMotion
    var speed: Double
    var fps: Int
    var patternIndex: Int
}

private enum SaverPreferences {
    static let moduleIdentifier = "com.signalfield.visualizer.screensaver"
    private static let styleKey = "style"
    private static let motionKey = "motion"
    private static let speedKey = "speed"
    private static let fpsKey = "fps"
    private static let patternKey = "pattern"

    static func read() -> SaverConfiguration {
        guard let defaults = ScreenSaverDefaults(forModuleWithName: moduleIdentifier) else {
            return SaverConfiguration(style: .modalSand, motion: .orbit, speed: 1, fps: 30, patternIndex: 0)
        }
        defaults.register(defaults: [styleKey: ScreenSaverStyle.modalSand.rawValue,
                                     motionKey: ScreenSaverMotion.orbit.rawValue,
                                     speedKey: 1.0,
                                     fpsKey: 30,
                                     patternKey: 0])
        let storedMotion = defaults.string(forKey: motionKey) ?? ""
        let motion = storedMotion == "dive"
            ? ScreenSaverMotion.precession
            : (ScreenSaverMotion(rawValue: storedMotion) ?? .orbit)
        if storedMotion == "dive" {
            defaults.set(ScreenSaverMotion.precession.rawValue, forKey: motionKey)
            defaults.synchronize()
        }
        return SaverConfiguration(
            style: ScreenSaverStyle(rawValue: defaults.string(forKey: styleKey) ?? "") ?? .modalSand,
            motion: motion,
            speed: clampedRotationSpeed(defaults.double(forKey: speedKey)),
            fps: defaults.integer(forKey: fpsKey) == 60 ? 60 : 30,
            patternIndex: max(0, defaults.integer(forKey: patternKey))
        )
    }

    static func write(_ configuration: SaverConfiguration) {
        guard let defaults = ScreenSaverDefaults(forModuleWithName: moduleIdentifier) else { return }
        defaults.set(configuration.style.rawValue, forKey: styleKey)
        defaults.set(configuration.motion.rawValue, forKey: motionKey)
        defaults.set(clampedRotationSpeed(configuration.speed), forKey: speedKey)
        defaults.set(configuration.fps == 60 ? 60 : 30, forKey: fpsKey)
        defaults.set(max(0, configuration.patternIndex), forKey: patternKey)
        defaults.synchronize()
    }
}

private final class SceneRepository {
    static let shared = SceneRepository()
    private let lock = NSLock()
    private var cachedScene: MetalScene?
    private var cachedError: Error?

    func scene() throws -> MetalScene {
        lock.lock()
        defer { lock.unlock() }
        if let cachedScene { return cachedScene }
        if let cachedError { throw cachedError }
        do {
            let scene = try loadScene()
            cachedScene = scene
            return scene
        } catch {
            cachedError = error
            throw error
        }
    }

    private func loadScene() throws -> MetalScene {
        let bundle = Bundle(for: SoundMotionScreenSaverView.self)
        guard let resourceURL = bundle.resourceURL,
              let atlasURL = bundle.url(forResource: "grain-atlas", withExtension: "png"),
              let metadataURL = bundle.url(forResource: "metadata", withExtension: "json") else {
            throw AssetError.missingResources
        }
        let metadataData = try Data(contentsOf: metadataURL, options: .mappedIfSafe)
        guard let metadata = try JSONSerialization.jsonObject(with: metadataData) as? [String: Any],
              let count = metadata["count"] as? Int,
              let strideBytes = metadata["strideBytes"] as? Int,
              let patternCount = metadata["patternCount"] as? Int,
              let styles = metadata["styles"] as? [String: Any],
              let sandInfo = styles[ScreenSaverStyle.modalSand.rawValue] as? [String: Any],
              let cosmicInfo = styles[ScreenSaverStyle.cosmic.rawValue] as? [String: Any],
              let sandFile = sandInfo["file"] as? String,
              let cosmicFile = cosmicInfo["file"] as? String else {
            throw AssetError.invalidMetadata
        }
        let sandParticles = try Data(contentsOf: resourceURL.appendingPathComponent(sandFile), options: .mappedIfSafe)
        let cosmicParticles = try Data(contentsOf: resourceURL.appendingPathComponent(cosmicFile), options: .mappedIfSafe)
        let atlas = try Data(contentsOf: atlasURL, options: .mappedIfSafe)
        let expectedBytes = count * strideBytes * patternCount
        guard sandParticles.count == expectedBytes, cosmicParticles.count == expectedBytes else {
            throw AssetError.invalidParticleBuffer
        }
        let sandTimes = try patternTimes(from: sandInfo, expectedCount: patternCount)
        let cosmicTimes = try patternTimes(from: cosmicInfo, expectedCount: patternCount)
        return try MetalScene(snapshot: ParticleSnapshot(
            count: count,
            strideBytes: strideBytes,
            patternCount: patternCount,
            sandParticles: sandParticles,
            cosmicParticles: cosmicParticles,
            sandPatternTimes: sandTimes,
            cosmicPatternTimes: cosmicTimes,
            atlasPNG: atlas
        ))
    }

    private func patternTimes(from styleInfo: [String: Any], expectedCount: Int) throws -> [Float] {
        guard let patterns = styleInfo["patterns"] as? [[String: Any]], patterns.count == expectedCount else {
            throw AssetError.invalidMetadata
        }
        return try patterns.map { pattern in
            guard let time = pattern["time"] as? NSNumber else { throw AssetError.invalidMetadata }
            return time.floatValue
        }
    }

    private enum AssetError: Error {
        case missingResources
        case invalidMetadata
        case invalidParticleBuffer
    }
}

private final class ConfigurationController: NSObject {
    let window: NSWindow
    private let styleControl: NSSegmentedControl
    private let motionControl: NSSegmentedControl
    private let speedSlider = NSSlider(value: 1, minValue: rotationSpeedMinimum, maxValue: rotationSpeedMaximum, target: nil, action: nil)
    private let speedLabel = NSTextField(labelWithString: "")
    private let fpsControl: NSPopUpButton
    private let patternCount: Int
    private var selectedPatternIndex = 0
    private let onSave: (SaverConfiguration) -> Void

    init(patternCount: Int, onSave: @escaping (SaverConfiguration) -> Void) {
        self.patternCount = max(1, patternCount)
        self.onSave = onSave
        styleControl = NSSegmentedControl(labels: ScreenSaverStyle.allCases.map(\.title), trackingMode: .selectOne, target: nil, action: nil)
        motionControl = NSSegmentedControl(labels: ScreenSaverMotion.allCases.map(\.title), trackingMode: .selectOne, target: nil, action: nil)
        fpsControl = NSPopUpButton(frame: .zero, pullsDown: false)
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 500, height: 350),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        super.init()
        buildInterface()
        refresh()
    }

    func refresh() {
        let configuration = SaverPreferences.read()
        styleControl.selectedSegment = ScreenSaverStyle.allCases.firstIndex(of: configuration.style) ?? 0
        motionControl.selectedSegment = ScreenSaverMotion.allCases.firstIndex(of: configuration.motion) ?? 0
        speedSlider.doubleValue = configuration.speed
        updateSpeedLabel()
        fpsControl.selectItem(at: configuration.fps == 60 ? 1 : 0)
        selectedPatternIndex = configuration.patternIndex % patternCount
    }

    private func buildInterface() {
        window.title = localized("Settings.WindowTitle")
        window.isReleasedWhenClosed = false
        fpsControl.addItems(withTitles: [localized("FPS.30"), localized("FPS.60")])

        let title = NSTextField(labelWithString: localized("Product.Name"))
        title.font = .systemFont(ofSize: 20, weight: .semibold)
        let subtitle = NSTextField(labelWithString: localized("Settings.Subtitle"))
        subtitle.textColor = .secondaryLabelColor

        let styleRow = makeRow(label: localized("Label.Visual"), control: styleControl)
        let motionRow = makeRow(label: localized("Label.Motion"), control: motionControl)
        speedSlider.target = self
        speedSlider.action = #selector(speedChanged)
        speedSlider.isContinuous = true
        speedSlider.numberOfTickMarks = 9
        speedSlider.allowsTickMarkValuesOnly = false
        speedSlider.widthAnchor.constraint(equalToConstant: 240).isActive = true
        speedLabel.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
        speedLabel.alignment = .right
        speedLabel.widthAnchor.constraint(equalToConstant: 58).isActive = true
        let speedControl = NSStackView(views: [speedSlider, speedLabel])
        speedControl.orientation = .horizontal
        speedControl.alignment = .centerY
        speedControl.spacing = 8
        let speedRow = makeRow(label: localized("Label.Speed"), control: speedControl)
        let fpsRow = makeRow(label: localized("Label.FrameRate"), control: fpsControl)
        let randomPatternTitle = localized("Button.RandomPattern")
        let randomPattern = NSButton(title: randomPatternTitle, target: self, action: #selector(randomizePattern))
        randomPattern.image = NSImage(systemSymbolName: "die.face.5", accessibilityDescription: randomPatternTitle)
        randomPattern.imagePosition = .imageLeading
        let patternRow = makeRow(label: localized("Label.Pattern"), control: randomPattern)

        let cancel = NSButton(title: localized("Button.Cancel"), target: self, action: #selector(cancelConfiguration))
        cancel.keyEquivalent = "\u{1b}"
        let save = NSButton(title: localized("Button.Done"), target: self, action: #selector(saveConfiguration))
        save.keyEquivalent = "\r"
        save.bezelStyle = .rounded
        let buttonRow = NSStackView(views: [NSView(), cancel, save])
        buttonRow.orientation = .horizontal
        buttonRow.spacing = 8

        let stack = NSStackView(views: [title, subtitle, styleRow, motionRow, speedRow, fpsRow, patternRow, buttonRow])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 13
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView = NSView(frame: window.contentRect(forFrameRect: window.frame))
        window.contentView?.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 22),
            stack.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor, constant: -18),
            styleControl.widthAnchor.constraint(equalToConstant: 320),
            motionControl.widthAnchor.constraint(equalToConstant: 320),
            buttonRow.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
    }

    private func makeRow(label: String, control: NSView) -> NSView {
        let labelView = NSTextField(labelWithString: label)
        labelView.font = .systemFont(ofSize: 13, weight: .medium)
        labelView.alignment = .right
        labelView.widthAnchor.constraint(equalToConstant: 80).isActive = true
        let row = NSStackView(views: [labelView, control])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 12
        return row
    }

    @objc private func saveConfiguration() {
        let styles = ScreenSaverStyle.allCases
        let motions = ScreenSaverMotion.allCases
        let configuration = SaverConfiguration(
            style: styles[max(0, min(styleControl.selectedSegment, styles.count - 1))],
            motion: motions[max(0, min(motionControl.selectedSegment, motions.count - 1))],
            speed: clampedRotationSpeed(speedSlider.doubleValue),
            fps: fpsControl.indexOfSelectedItem == 1 ? 60 : 30,
            patternIndex: selectedPatternIndex
        )
        SaverPreferences.write(configuration)
        onSave(configuration)
        window.sheetParent?.endSheet(window, returnCode: .OK)
        window.orderOut(nil)
    }

    @objc private func cancelConfiguration() {
        window.sheetParent?.endSheet(window, returnCode: .cancel)
        window.orderOut(nil)
    }

    @objc private func randomizePattern() {
        guard patternCount > 1 else { return }
        selectedPatternIndex = (selectedPatternIndex + Int.random(in: 1..<patternCount)) % patternCount
    }

    @objc private func speedChanged() {
        let snapped = (speedSlider.doubleValue / rotationSpeedStep).rounded() * rotationSpeedStep
        speedSlider.doubleValue = clampedRotationSpeed(snapped)
        updateSpeedLabel()
    }

    private func updateSpeedLabel() {
        speedLabel.stringValue = formattedRotationSpeed(speedSlider.doubleValue)
    }

}

@objc(SoundMotionScreenSaverView)
public final class SoundMotionScreenSaverView: ScreenSaverView {
    private weak var metalLayer: CAMetalLayer?
    private var renderer: MetalScreenSaverRenderer?
    private var configurationController: ConfigurationController?
    private var reduceMotionFrameDrawn = false
    private var policyCheckFrame = 0
    private var renderingActive = false

    public override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        setUpRenderer()
    }

    public required init?(coder: NSCoder) {
        super.init(coder: coder)
        setUpRenderer()
    }

    public override class func performGammaFade() -> Bool { true }

    public override func makeBackingLayer() -> CALayer {
        CAMetalLayer()
    }

    @objc public var soundMotionSubmittedFrameCount: Int {
        renderer?.submittedFrameCount ?? 0
    }

    @objc public var soundMotionPatternCount: Int {
        renderer?.patternCount ?? 0
    }

    @objc public var soundMotionPatternIndex: Int {
        renderer?.patternIndex ?? 0
    }

    @objc public var soundMotionSpeed: Double {
        Double(renderer?.speed ?? 0)
    }

    @objc public var soundMotionMotion: String {
        renderer?.motion.rawValue ?? ""
    }

    @objc public func soundMotionApplyPreferences() {
        apply(SaverPreferences.read())
    }

    private func setUpRenderer() {
        wantsLayer = true
        layerContentsRedrawPolicy = .never
        let configuration = SaverPreferences.read()
        applyFramePolicy(configuration)

        do {
            let scene = try SceneRepository.shared.scene()
            guard let layer = layer as? CAMetalLayer else { throw LayerError.invalidBackingLayer }
            let renderer = MetalScreenSaverRenderer(
                scene: scene,
                layer: layer,
                style: configuration.style,
                motion: configuration.motion,
                speed: Float(configuration.speed),
                patternIndex: configuration.patternIndex
            )
            metalLayer = layer
            self.renderer = renderer
            updateMetalGeometry()
            DispatchQueue.main.async { [weak self] in self?.renderFrame() }
        } catch {
            NSLog("Signal Field: setup failed: %@", String(describing: error))
            let message = NSTextField(labelWithString: localized("Error.LoadResources"))
            message.textColor = .secondaryLabelColor
            message.alignment = .center
            message.frame = bounds.insetBy(dx: 24, dy: 24)
            message.autoresizingMask = [.width, .height]
            addSubview(message)
        }
    }

    public override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        updateMetalGeometry()
        if !isAnimating { renderFrame() }
    }

    public override func layout() {
        super.layout()
        updateMetalGeometry()
    }

    public override func draw(_ dirtyRect: NSRect) {
        if renderer?.submittedFrameCount == 0 { renderFrame() }
    }

    public override func startAnimation() {
        let configuration = SaverPreferences.read()
        apply(configuration)
        renderer?.resetClock()
        renderingActive = true
        reduceMotionFrameDrawn = false
        policyCheckFrame = 0
        updateMetalGeometry()
        super.startAnimation()
        renderFrame()
    }

    public override func stopAnimation() {
        renderingActive = false
        super.stopAnimation()
        reduceMotionFrameDrawn = false
        renderer?.releaseDrawables()
    }

    public override func animateOneFrame() {
        guard renderingActive, renderer != nil else { return }
        if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            guard !reduceMotionFrameDrawn else { return }
            reduceMotionFrameDrawn = true
        }
        policyCheckFrame += 1
        if policyCheckFrame >= 120 {
            policyCheckFrame = 0
            applyFramePolicy(SaverPreferences.read())
        }
        autoreleasepool { renderFrame() }
    }

    public override var hasConfigureSheet: Bool { true }

    public override var configureSheet: NSWindow? {
        if configurationController == nil {
            configurationController = ConfigurationController(patternCount: renderer?.patternCount ?? 1) { [weak self] configuration in
                self?.apply(configuration)
            }
        }
        configurationController?.refresh()
        return configurationController?.window
    }

    private func apply(_ configuration: SaverConfiguration) {
        renderer?.style = configuration.style
        renderer?.motion = configuration.motion
        renderer?.speed = Float(configuration.speed)
        renderer?.selectPattern(configuration.patternIndex)
        applyFramePolicy(configuration)
        reduceMotionFrameDrawn = false
    }

    private func applyFramePolicy(_ configuration: SaverConfiguration) {
        let process = ProcessInfo.processInfo
        let constrained = process.isLowPowerModeEnabled || process.thermalState == .serious || process.thermalState == .critical
        let fps = isPreview ? min(configuration.fps, 30) : (constrained ? min(configuration.fps, 30) : configuration.fps)
        animationTimeInterval = 1.0 / Double(fps)
    }

    private func updateMetalGeometry() {
        guard let metalLayer, let renderer else { return }
        let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
        let drawableSize = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        metalLayer.frame = bounds
        renderer.resize(to: drawableSize, contentsScale: scale)
    }

    private func renderFrame() {
        updateMetalGeometry()
        let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
        renderer?.draw(dpr: Float(scale))
    }

    private enum LayerError: Error { case invalidBackingLayer }
}
