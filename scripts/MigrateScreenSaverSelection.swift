import Foundation

guard CommandLine.arguments.count == 4 else {
    fputs("usage: MigrateScreenSaverSelection <Index.plist> <old-saver> <new-saver>\n", stderr)
    exit(2)
}

let indexURL = URL(fileURLWithPath: CommandLine.arguments[1])
let oldSaverURL = URL(fileURLWithPath: CommandLine.arguments[2]).absoluteURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
let newSaverURL = URL(fileURLWithPath: CommandLine.arguments[3]).absoluteURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
let oldSaverPath = CommandLine.arguments[2]
let newSaverPath = CommandLine.arguments[3]

guard FileManager.default.fileExists(atPath: indexURL.path) else {
    print("Wallpaper selection store is absent; no migration needed")
    exit(0)
}

func rewrite(_ value: Any) -> (Any, Bool) {
    if let string = value as? String {
        let rewritten = string
            .replacingOccurrences(of: oldSaverURL, with: newSaverURL)
            .replacingOccurrences(of: oldSaverPath, with: newSaverPath)
        return (rewritten, rewritten != string)
    }

    if let data = value as? Data {
        var nestedFormat = PropertyListSerialization.PropertyListFormat.binary
        guard let nested = try? PropertyListSerialization.propertyList(from: data, options: [], format: &nestedFormat) else {
            return (data, false)
        }
        let (rewritten, changed) = rewrite(nested)
        guard changed,
              let encoded = try? PropertyListSerialization.data(fromPropertyList: rewritten, format: nestedFormat, options: 0) else {
            return (data, false)
        }
        return (encoded, true)
    }

    if let array = value as? [Any] {
        var changed = false
        let rewritten = array.map { element -> Any in
            let (newElement, elementChanged) = rewrite(element)
            changed = changed || elementChanged
            return newElement
        }
        return (rewritten, changed)
    }

    if let dictionary = value as? [String: Any] {
        var changed = false
        var rewritten: [String: Any] = [:]
        rewritten.reserveCapacity(dictionary.count)
        for (key, element) in dictionary {
            let (newElement, elementChanged) = rewrite(element)
            rewritten[key] = newElement
            changed = changed || elementChanged
        }
        return (rewritten, changed)
    }

    return (value, false)
}

let source = try Data(contentsOf: indexURL)
var rootFormat = PropertyListSerialization.PropertyListFormat.binary
let root = try PropertyListSerialization.propertyList(from: source, options: [], format: &rootFormat)
let (rewrittenRoot, changed) = rewrite(root)

guard changed else {
    print("Screen saver selection already uses the current path")
    exit(0)
}

let backupURL = indexURL.appendingPathExtension("before-3d-chladni")
if !FileManager.default.fileExists(atPath: backupURL.path) {
    try FileManager.default.copyItem(at: indexURL, to: backupURL)
}

let output = try PropertyListSerialization.data(fromPropertyList: rewrittenRoot, format: rootFormat, options: 0)
try output.write(to: indexURL, options: .atomic)
print("Migrated screen saver selection to \(newSaverURL)")
