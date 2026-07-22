// Signal Field modification notice (2026-07-20). See LICENSE, UPSTREAM_NOTICE.md, and MODIFICATIONS.md.
import AppKit
import Foundation
import ScreenSaver

guard CommandLine.arguments.count >= 2 else {
    fputs("usage: ScreenSaverProbe <path-to-saver>\n", stderr)
    exit(2)
}

let saverPath = CommandLine.arguments[1]
let moduleIdentifier = "com.signalfield.visualizer.screensaver"
guard let defaults = ScreenSaverDefaults(forModuleWithName: moduleIdentifier) else {
    fatalError("Unable to open screen saver defaults")
}
defaults.synchronize()
let priorStyle = defaults.object(forKey: "style")
let priorMotion = defaults.object(forKey: "motion")
let priorSpeed = defaults.object(forKey: "speed")
let priorFPS = defaults.object(forKey: "fps")
let priorPattern = defaults.object(forKey: "pattern")

func restore(_ value: Any?, key: String) {
    if let value { defaults.set(value, forKey: key) } else { defaults.removeObject(forKey: key) }
}

func containsButton(titled title: String, in view: NSView) -> Bool {
    if let button = view as? NSButton, button.title == title { return true }
    return view.subviews.contains { containsButton(titled: title, in: $0) }
}

defer {
    restore(priorStyle, key: "style")
    restore(priorMotion, key: "motion")
    restore(priorSpeed, key: "speed")
    restore(priorFPS, key: "fps")
    restore(priorPattern, key: "pattern")
    defaults.synchronize()
}

_ = NSApplication.shared
guard let bundle = Bundle(path: saverPath) else { fatalError("Invalid saver bundle path") }
guard bundle.load() else { fatalError("Screen saver bundle failed to load") }
guard let viewClass = bundle.principalClass as? ScreenSaverView.Type else {
    fatalError("NSPrincipalClass is not a ScreenSaverView subclass")
}

let window = NSWindow(
    contentRect: NSRect(x: -10_000, y: -10_000, width: 640, height: 400),
    styleMask: [.borderless],
    backing: .buffered,
    defer: false
)
window.isReleasedWhenClosed = false
window.backgroundColor = .black
window.orderBack(nil)

var casesRun = 0
var maximumPatternSwitchTime = 0.0
for style in ["msand", "cosmic"] {
    for motion in ["precess", "single", "tumble"] {
        let expectedSpeed = 0.5 + Double(casesRun) * 0.25
        defaults.set(style, forKey: "style")
        defaults.set(motion, forKey: "motion")
        defaults.set(expectedSpeed, forKey: "speed")
        defaults.set(30, forKey: "fps")
        defaults.set(casesRun, forKey: "pattern")
        defaults.synchronize()

        let patternSwitchStart = CFAbsoluteTimeGetCurrent()
        guard let view = viewClass.init(frame: window.contentView!.bounds, isPreview: false) else {
            fatalError("Failed to instantiate \(style)/\(motion)")
        }
        if casesRun > 0 {
            maximumPatternSwitchTime = max(maximumPatternSwitchTime, CFAbsoluteTimeGetCurrent() - patternSwitchStart)
        }
        window.contentView = view
        view.startAnimation()
        for _ in 0..<4 {
            view.animateOneFrame()
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 1.0 / 120.0))
        }
        view.stopAnimation()
        let submittedFrames = view.value(forKey: "soundMotionSubmittedFrameCount") as? Int ?? 0
        guard submittedFrames > 0 else {
            fatalError("Metal submitted no frames for \(style)/\(motion)")
        }
        let patternCount = view.value(forKey: "soundMotionPatternCount") as? Int ?? 0
        let patternIndex = view.value(forKey: "soundMotionPatternIndex") as? Int ?? -1
        guard patternCount > 8, patternIndex == casesRun % patternCount else {
            fatalError("Pattern bank unavailable for \(style)/\(motion): \(patternIndex)/\(patternCount)")
        }
        let speed = view.value(forKey: "soundMotionSpeed") as? Double ?? -1
        guard abs(speed - expectedSpeed) < 0.001 else {
            fatalError("Rotation speed mismatch for \(style)/\(motion): \(speed) != \(expectedSpeed)")
        }
        view.animateOneFrame()
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.08))
        guard (view.value(forKey: "soundMotionSubmittedFrameCount") as? Int ?? 0) == submittedFrames else {
            fatalError("Frames continued after stopAnimation for \(style)/\(motion)")
        }
        casesRun += 1
    }
}

defaults.set("dive", forKey: "motion")
defaults.synchronize()
guard let migratedView = viewClass.init(frame: NSRect(x: 0, y: 0, width: 320, height: 200), isPreview: true),
      (migratedView.value(forKey: "soundMotionMotion") as? String) == "precess" else {
    fatalError("Legacy dive preference did not migrate to precess")
}

defaults.set("cosmic", forKey: "style")
defaults.set("tumble", forKey: "motion")
defaults.set(1.75, forKey: "speed")
defaults.synchronize()
var displayWindows: [NSWindow] = []
var displayViews: [ScreenSaverView] = []
for (index, _) in NSScreen.screens.enumerated() {
    let displayWindow = NSWindow(
        contentRect: NSRect(x: -12_000 - index * 700, y: -12_000, width: 640, height: 400),
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
    )
    guard let displayView = viewClass.init(frame: displayWindow.contentView!.bounds, isPreview: false) else {
        fatalError("Failed to instantiate display \(index)")
    }
    displayWindow.contentView = displayView
    displayWindow.orderBack(nil)
    displayView.startAnimation()
    displayView.animateOneFrame()
    displayWindows.append(displayWindow)
    displayViews.append(displayView)
}
RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.08))
for (index, displayView) in displayViews.enumerated() {
    displayView.stopAnimation()
    guard (displayView.value(forKey: "soundMotionSubmittedFrameCount") as? Int ?? 0) > 0 else {
        fatalError("Metal submitted no frame for display \(index)")
    }
}
displayWindows.forEach { $0.orderOut(nil); $0.close() }

let randomPatternTitle = bundle.localizedString(forKey: "Button.RandomPattern", value: "Random Pattern", table: nil)
guard let preview = viewClass.init(frame: NSRect(x: 0, y: 0, width: 320, height: 200), isPreview: true),
      preview.hasConfigureSheet,
      let configureSheet = preview.configureSheet,
      let contentView = configureSheet.contentView,
      containsButton(titled: randomPatternTitle, in: contentView) else {
    fatalError("Configuration sheet is unavailable")
}

window.orderOut(nil)
window.close()
guard maximumPatternSwitchTime < 0.1 else {
    fatalError("Pattern switch took \(maximumPatternSwitchTime) seconds")
}
print(String(format: "PASS loaded Signal Field, rendered %d style/motion/speed cases, switched patterns in %.2f ms max, stopped cleanly, and opened its localized configuration sheet", casesRun, maximumPatternSwitchTime * 1_000))
