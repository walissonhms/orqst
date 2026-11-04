// Read-only WindowServer metadata probe for an explicitly owned process.
// Prints one JSON object to stdout. It captures no pixels, titles, paths or
// environment, never activates/focuses/stops the target and never requires TCC.
import CoreGraphics
import Darwin
import Foundation

func refuse(_ message: String) -> Never {
    FileHandle.standardError.write(Data("orqst-native-window-probe: \(message)\n".utf8))
    exit(2)
}

let arguments = CommandLine.arguments
guard arguments.count == 3, arguments[1] == "--pid" else {
    refuse("usage: orqst-native-window-probe --pid <positive-pid>")
}
guard let pid = Int32(arguments[2]), pid > 1 else {
    refuse("invalid pid")
}
guard
    let descriptions = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID)
        as? [[String: Any]]
else {
    refuse("window list unavailable")
}

func number(_ value: Any?) -> Int? {
    guard let value = value as? NSNumber else { return nil }
    let double = value.doubleValue
    guard double.isFinite, abs(double) < 1_000_000_000 else { return nil }
    return Int(double.rounded())
}

var windows: [[String: Any]] = []
for description in descriptions {
    guard number(description[kCGWindowOwnerPID as String]) == Int(pid) else { continue }
    guard let layer = number(description[kCGWindowLayer as String]),
        let number_ = number(description[kCGWindowNumber as String]),
        let bounds = description[kCGWindowBounds as String] as? [String: Any],
        let x = number(bounds["X"]),
        let y = number(bounds["Y"]),
        let width = number(bounds["Width"]),
        let height = number(bounds["Height"])
    else {
        refuse("malformed window metadata")
    }
    let alpha = (description[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 0
    guard alpha.isFinite, alpha >= 0, alpha <= 1 else { refuse("malformed alpha") }
    let onscreen = number(description[kCGWindowIsOnscreen as String]) == 1
    let owner = description[kCGWindowOwnerName as String] as? String ?? ""
    windows.append([
        "number": number_,
        "layer": layer,
        "alpha": alpha,
        "onscreen": onscreen,
        "bounds": ["x": x, "y": y, "width": width, "height": height],
        "owner": String(owner.prefix(64)),
    ])
}
windows.sort { lhs, rhs in
    (lhs["number"] as? Int ?? 0) < (rhs["number"] as? Int ?? 0)
}

let payload: [String: Any] = [
    "tool": "orqst-native-window-probe",
    "pid": Int(pid),
    "windows": windows,
]
guard let encoded = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
else { refuse("encoding unavailable") }
FileHandle.standardOutput.write(encoded)
FileHandle.standardOutput.write(Data("\n".utf8))
