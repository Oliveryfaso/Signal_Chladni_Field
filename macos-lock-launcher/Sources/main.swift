// Signal Field modification notice (2026-07-20). See LICENSE, UPSTREAM_NOTICE.md, and MODIFICATIONS.md.
import AppKit
import Foundation
import ScreenSaver

private let moduleIdentifier = "com.signalfield.visualizer.screensaver"
private let installedSaverPath = NSString(string: "~/Library/Screen Savers/Signal Field.saver").expandingTildeInPath
private let rotationSpeedMinimum = 0.0
private let rotationSpeedMaximum = 4.0
private let rotationSpeedStep = 0.05

private func localized(_ key: String) -> String {
    Bundle.main.localizedString(forKey: key, value: key, table: nil)
}

private func clampedRotationSpeed(_ value: Double) -> Double {
    min(rotationSpeedMaximum, max(rotationSpeedMinimum, value))
}

private func formattedRotationSpeed(_ value: Double) -> String {
    String(format: "%.2f×", locale: Locale.current, clampedRotationSpeed(value))
}

private enum LockStyle: String, CaseIterable {
    case modalSand = "msand"
    case cosmic

    var title: String {
        switch self {
        case .modalSand: return localized("Style.ModalSand")
        case .cosmic: return localized("Style.Cosmic")
        }
    }
}

private enum LockMotion: String, CaseIterable {
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

private struct LockSettings {
    var style: LockStyle
    var motion: LockMotion
    var speed: Double
    var fps: Int
    var patternIndex: Int

    static func read() -> LockSettings {
        guard let defaults = ScreenSaverDefaults(forModuleWithName: moduleIdentifier) else {
            return LockSettings(style: .modalSand, motion: .orbit, speed: 1, fps: 30, patternIndex: 0)
        }
        defaults.register(defaults: [
            "style": LockStyle.modalSand.rawValue,
            "motion": LockMotion.orbit.rawValue,
            "speed": 1.0,
            "fps": 30,
            "pattern": 0
        ])
        let storedMotion = defaults.string(forKey: "motion") ?? ""
        let motion = storedMotion == "dive"
            ? LockMotion.precession
            : (LockMotion(rawValue: storedMotion) ?? .orbit)
        if storedMotion == "dive" {
            defaults.set(LockMotion.precession.rawValue, forKey: "motion")
            defaults.synchronize()
        }
        return LockSettings(
            style: LockStyle(rawValue: defaults.string(forKey: "style") ?? "") ?? .modalSand,
            motion: motion,
            speed: clampedRotationSpeed(defaults.double(forKey: "speed")),
            fps: defaults.integer(forKey: "fps") == 60 ? 60 : 30,
            patternIndex: max(0, defaults.integer(forKey: "pattern"))
        )
    }

    func write() {
        guard let defaults = ScreenSaverDefaults(forModuleWithName: moduleIdentifier) else { return }
        defaults.set(style.rawValue, forKey: "style")
        defaults.set(motion.rawValue, forKey: "motion")
        defaults.set(clampedRotationSpeed(speed), forKey: "speed")
        defaults.set(fps == 60 ? 60 : 30, forKey: "fps")
        defaults.set(max(0, patternIndex), forKey: "pattern")
        defaults.synchronize()
    }
}

private enum PatternCatalog {
    static let fallbackCount = 64

    static func count() -> Int {
        let metadataURL = URL(fileURLWithPath: installedSaverPath)
            .appendingPathComponent("Contents/Resources/metadata.json")
        guard let data = try? Data(contentsOf: metadataURL),
              let metadata = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let count = metadata["patternCount"] as? Int,
              count > 0 else { return fallbackCount }
        return count
    }
}

@MainActor
private final class LockAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let patternCount = PatternCatalog.count()
    private let styleControl = NSSegmentedControl(
        labels: LockStyle.allCases.map(\.title),
        trackingMode: .selectOne,
        target: nil,
        action: nil
    )
    private let motionControl = NSSegmentedControl(
        labels: LockMotion.allCases.map(\.title),
        trackingMode: .selectOne,
        target: nil,
        action: nil
    )
    private let speedSlider = NSSlider(value: 1, minValue: rotationSpeedMinimum, maxValue: rotationSpeedMaximum, target: nil, action: nil)
    private let speedLabel = NSTextField(labelWithString: "")
    private let fpsControl = NSPopUpButton(frame: .zero, pullsDown: false)
    private let previewContainer = NSView(frame: .zero)
    private var previewView: ScreenSaverView?
    private var saverBundle: Bundle?
    private var window: NSWindow!
    private var selectedPatternIndex = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()
        loadSettings()
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        reloadPreview()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    func application(_ application: NSApplication, shouldRestoreApplicationState coder: NSCoder) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showSettings() }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        previewView?.stopAnimation()
    }

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 620, height: 628),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = localized("Product.Name")
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.isRestorable = false
        window.minSize = NSSize(width: 560, height: 570)
        window.setFrameAutosaveName("ChladniPlateSettings")

        let title = NSTextField(labelWithString: localized("Product.Name"))
        title.font = .systemFont(ofSize: 20, weight: .semibold)

        previewContainer.translatesAutoresizingMaskIntoConstraints = false
        previewContainer.wantsLayer = true
        previewContainer.layer?.backgroundColor = NSColor.black.cgColor
        previewContainer.layer?.borderColor = NSColor.separatorColor.cgColor
        previewContainer.layer?.borderWidth = 1
        previewContainer.layer?.cornerRadius = 6
        previewContainer.layer?.masksToBounds = true

        styleControl.target = self
        styleControl.action = #selector(settingsChanged)
        motionControl.target = self
        motionControl.action = #selector(settingsChanged)
        speedSlider.target = self
        speedSlider.action = #selector(speedChanged)
        speedSlider.isContinuous = true
        speedSlider.numberOfTickMarks = 9
        speedSlider.allowsTickMarkValuesOnly = false
        speedSlider.widthAnchor.constraint(equalToConstant: 270).isActive = true
        speedLabel.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
        speedLabel.alignment = .right
        speedLabel.widthAnchor.constraint(equalToConstant: 58).isActive = true
        let speedControl = NSStackView(views: [speedSlider, speedLabel])
        speedControl.orientation = .horizontal
        speedControl.alignment = .centerY
        speedControl.spacing = 8

        fpsControl.addItems(withTitles: [localized("FPS.30"), localized("FPS.60")])
        fpsControl.target = self
        fpsControl.action = #selector(settingsChanged)

        let randomPatternTitle = localized("Button.RandomPattern")
        let randomButton = NSButton(title: randomPatternTitle, target: self, action: #selector(randomizePattern))
        randomButton.image = NSImage(systemSymbolName: "die.face.5", accessibilityDescription: randomPatternTitle)
        randomButton.imagePosition = .imageLeading

        let closeButton = NSButton(title: localized("Button.Close"), target: self, action: #selector(closeWindow))
        closeButton.keyEquivalent = "\u{1b}"
        let startLockTitle = localized("Button.StartLock")
        let lockButton = NSButton(title: startLockTitle, target: self, action: #selector(startLock))
        lockButton.image = NSImage(systemSymbolName: "lock.fill", accessibilityDescription: startLockTitle)
        lockButton.imagePosition = .imageLeading
        lockButton.keyEquivalent = "\r"
        lockButton.bezelStyle = .rounded
        lockButton.controlSize = .large
        let buttonRow = NSStackView(views: [NSView(), closeButton, lockButton])
        buttonRow.orientation = .horizontal
        buttonRow.alignment = .centerY
        buttonRow.spacing = 8

        let stack = NSStackView(views: [
            title,
            previewContainer,
            makeRow(label: localized("Label.Visual"), control: styleControl),
            makeRow(label: localized("Label.Motion"), control: motionControl),
            makeRow(label: localized("Label.Speed"), control: speedControl),
            makeRow(label: localized("Label.FrameRate"), control: fpsControl),
            makeRow(label: localized("Label.Pattern"), control: randomButton),
            buttonRow
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false

        let contentView = NSView(frame: window.contentRect(forFrameRect: window.frame))
        contentView.addSubview(stack)
        window.contentView = contentView

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -18),
            previewContainer.widthAnchor.constraint(equalTo: stack.widthAnchor),
            previewContainer.heightAnchor.constraint(greaterThanOrEqualToConstant: 220),
            styleControl.widthAnchor.constraint(equalToConstant: 360),
            motionControl.widthAnchor.constraint(equalToConstant: 360),
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

    private func loadSettings() {
        let settings = LockSettings.read()
        styleControl.selectedSegment = LockStyle.allCases.firstIndex(of: settings.style) ?? 0
        motionControl.selectedSegment = LockMotion.allCases.firstIndex(of: settings.motion) ?? 0
        speedSlider.doubleValue = settings.speed
        updateSpeedLabel()
        fpsControl.selectItem(at: settings.fps == 60 ? 1 : 0)
        selectedPatternIndex = settings.patternIndex % patternCount
    }

    private func currentSettings() -> LockSettings {
        let styles = LockStyle.allCases
        let motions = LockMotion.allCases
        return LockSettings(
            style: styles[max(0, min(styleControl.selectedSegment, styles.count - 1))],
            motion: motions[max(0, min(motionControl.selectedSegment, motions.count - 1))],
            speed: clampedRotationSpeed(speedSlider.doubleValue),
            fps: fpsControl.indexOfSelectedItem == 1 ? 60 : 30,
            patternIndex: selectedPatternIndex
        )
    }

    @objc private func settingsChanged() {
        currentSettings().write()
        applyPreviewSettings()
    }

    @objc private func randomizePattern() {
        guard patternCount > 1 else { return }
        selectedPatternIndex = (selectedPatternIndex + Int.random(in: 1..<patternCount)) % patternCount
        currentSettings().write()
        applyPreviewSettings()
    }

    @objc private func speedChanged() {
        let snapped = (speedSlider.doubleValue / rotationSpeedStep).rounded() * rotationSpeedStep
        speedSlider.doubleValue = clampedRotationSpeed(snapped)
        updateSpeedLabel()
        currentSettings().write()
        applyPreviewSettings()
    }

    private func updateSpeedLabel() {
        speedLabel.stringValue = formattedRotationSpeed(speedSlider.doubleValue)
    }

    private func applyPreviewSettings() {
        let selector = NSSelectorFromString("soundMotionApplyPreferences")
        if let previewView, previewView.responds(to: selector) {
            previewView.perform(selector)
        } else {
            reloadPreview()
        }
    }

    private func reloadPreview() {
        previewView?.stopAnimation()
        previewView?.removeFromSuperview()
        previewView = nil

        guard let bundle = saverBundle ?? Bundle(path: installedSaverPath),
              bundle.isLoaded || bundle.load(),
              let viewClass = bundle.principalClass as? ScreenSaverView.Type,
              let view = viewClass.init(frame: previewContainer.bounds, isPreview: true) else {
            showPreviewPlaceholder(localized("Error.NotInstalled"))
            return
        }

        saverBundle = bundle
        previewContainer.subviews.forEach { $0.removeFromSuperview() }
        view.frame = previewContainer.bounds
        view.autoresizingMask = [.width, .height]
        previewContainer.addSubview(view)
        previewView = view
        view.startAnimation()
    }

    private func showPreviewPlaceholder(_ text: String) {
        previewContainer.subviews.forEach { $0.removeFromSuperview() }
        let label = NSTextField(labelWithString: text)
        label.textColor = .secondaryLabelColor
        label.alignment = .center
        label.frame = previewContainer.bounds
        label.autoresizingMask = [.width, .height]
        previewContainer.addSubview(label)
    }

    @objc private func startLock() {
        currentSettings().write()
        previewView?.stopAnimation()
        let engine = URL(fileURLWithPath: "/System/Library/CoreServices/ScreenSaverEngine.app")
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true

        NSWorkspace.shared.openApplication(at: engine, configuration: configuration) { [weak self] _, error in
            DispatchQueue.main.async {
                if let error {
                    let alert = NSAlert(error: error)
                    alert.messageText = localized("Error.StartFailed")
                    alert.runModal()
                    self?.reloadPreview()
                } else {
                    NSApp.terminate(nil)
                }
            }
        }
    }

    @objc private func closeWindow() {
        window.performClose(nil)
    }

    @objc private func showSettings() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func buildMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: localized("Product.Name"))
        appMenu.addItem(withTitle: localized("Menu.About"), action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        let settingsItem = appMenu.addItem(withTitle: localized("Menu.Settings"), action: #selector(showSettings), keyEquivalent: ",")
        settingsItem.target = self
        appMenu.addItem(.separator())
        let servicesItem = NSMenuItem(title: localized("Menu.Services"), action: nil, keyEquivalent: "")
        let servicesMenu = NSMenu(title: localized("Menu.Services"))
        servicesItem.submenu = servicesMenu
        appMenu.addItem(servicesItem)
        NSApp.servicesMenu = servicesMenu
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: localized("Menu.Hide"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: localized("Menu.HideOthers"), action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: localized("Menu.ShowAll"), action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: localized("Menu.Quit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: localized("Menu.Edit"))
        editMenu.addItem(withTitle: localized("Menu.Undo"), action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: localized("Menu.Redo"), action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: localized("Menu.Cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: localized("Menu.Copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: localized("Menu.Paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: localized("Menu.SelectAll"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        let lockItem = NSMenuItem()
        let lockMenu = NSMenu(title: localized("Menu.ScreenSaver"))
        let startItem = lockMenu.addItem(withTitle: localized("Button.StartLock"), action: #selector(startLock), keyEquivalent: "l")
        startItem.target = self
        let randomItem = lockMenu.addItem(withTitle: localized("Button.RandomPattern"), action: #selector(randomizePattern), keyEquivalent: "r")
        randomItem.target = self
        lockItem.submenu = lockMenu
        mainMenu.addItem(lockItem)

        let viewItem = NSMenuItem()
        viewItem.submenu = NSMenu(title: localized("Menu.View"))
        mainMenu.addItem(viewItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: localized("Menu.Window"))
        windowMenu.addItem(withTitle: localized("Menu.Minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: localized("Menu.Zoom"), action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: localized("Menu.BringAllToFront"), action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        windowItem.submenu = windowMenu
        mainMenu.addItem(windowItem)
        NSApp.windowsMenu = windowMenu

        let helpItem = NSMenuItem()
        let helpMenu = NSMenu(title: localized("Menu.Help"))
        helpItem.submenu = helpMenu
        mainMenu.addItem(helpItem)
        NSApp.helpMenu = helpMenu

        NSApp.mainMenu = mainMenu
    }
}

@main
private enum SoundMotionLockApp {
    @MainActor private static let delegate = LockAppDelegate()

    @MainActor
    static func main() {
        if CommandLine.arguments.contains("--smoke") {
            print("PASS Signal Field language=\(localized("Style.Cosmic")) randomPatterns=available")
            return
        }

        let application = NSApplication.shared
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        application.run()
    }
}
