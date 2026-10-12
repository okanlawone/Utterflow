import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

struct CaptureResult: Encodable {
    let type: String
    let selectedText: String?
    let sourceApplication: String?
    let bundleIdentifier: String?
    let focusedTitle: String?
    let documentURL: String?
    let accessibilityTrusted: Bool
}

let args = CommandLine.arguments
func arg(_ name: String, fallback: String) -> String {
    guard let index = args.firstIndex(of: name), index + 1 < args.count else { return fallback }
    return args[index + 1]
}
let triggerKeyCode = CGKeyCode(UInt16(arg("--keycode", fallback: "49")) ?? 49)
let modifierNames = Set(arg("--modifiers", fallback: "control,shift,option").split(separator: ",").map(String.init))
var requiredFlags: CGEventFlags = []
if modifierNames.contains("control") { requiredFlags.insert(.maskControl) }
if modifierNames.contains("shift") { requiredFlags.insert(.maskShift) }
if modifierNames.contains("option") { requiredFlags.insert(.maskAlternate) }
if modifierNames.contains("command") { requiredFlags.insert(.maskCommand) }

func emit(_ value: CaptureResult) {
    let object: [String: Any] = ["type": value.type, "selectedText": value.selectedText as Any? ?? NSNull(),
                                 "sourceApplication": value.sourceApplication as Any? ?? NSNull(),
                                 "bundleIdentifier": value.bundleIdentifier as Any? ?? NSNull(),
                                 "focusedTitle": value.focusedTitle as Any? ?? NSNull(),
                                 "documentURL": value.documentURL as Any? ?? NSNull(),
                                 "accessibilityTrusted": value.accessibilityTrusted]
    if let data = try? JSONSerialization.data(withJSONObject: object), let line = String(data: data, encoding: .utf8) {
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }
}

func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
          let string = value as? String else { return nil }
    return string
}

func captureSelection() -> CaptureResult {
    let trusted = AXIsProcessTrusted()
    let running = NSWorkspace.shared.frontmostApplication
    let appName = running?.localizedName
    let bundleId = running?.bundleIdentifier
    var selectedText: String?
    var title: String?
    var document: String?
    if trusted, let running {
        let appElement = AXUIElementCreateApplication(running.processIdentifier)
        var focusedValue: CFTypeRef?
        if AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &focusedValue) == .success,
           let focusedValue {
            let focused = unsafeBitCast(focusedValue, to: AXUIElement.self)
            selectedText = stringAttribute(focused, kAXSelectedTextAttribute as String)
        }
        var windowValue: CFTypeRef?
        if AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &windowValue) == .success,
           let windowValue {
            let focusedWindow = unsafeBitCast(windowValue, to: AXUIElement.self)
            title = stringAttribute(focusedWindow, kAXTitleAttribute as String)
            document = stringAttribute(focusedWindow, kAXDocumentAttribute as String)
        }
        if selectedText == nil { selectedText = stringAttribute(appElement, kAXSelectedTextAttribute as String) }
        if title == nil { title = stringAttribute(appElement, kAXTitleAttribute as String) }
        if document == nil { document = stringAttribute(appElement, kAXDocumentAttribute as String) }
    }
    if selectedText?.isEmpty == true { selectedText = nil }
    return CaptureResult(type: "down", selectedText: selectedText, sourceApplication: appName,
                         bundleIdentifier: bundleId, focusedTitle: title, documentURL: document,
                         accessibilityTrusted: trusted)
}

if args.contains("--permissions") {
    let permissions: [String: Bool] = ["accessibility": AXIsProcessTrusted(), "inputMonitoring": CGPreflightListenEventAccess()]
    if let data = try? JSONSerialization.data(withJSONObject: permissions), let line = String(data: data, encoding: .utf8) {
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }
    exit(0)
}
if args.contains("--request-input") {
    let granted = CGRequestListenEventAccess()
    FileHandle.standardOutput.write(Data((granted ? "granted\n" : "needed\n").utf8))
    exit(0)
}

var isRecording = false
var tapPort: CFMachPort?
let eventMask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue) | (1 << CGEventType.flagsChanged.rawValue)
guard let createdTap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                                   options: .defaultTap, eventsOfInterest: CGEventMask(eventMask),
                                   callback: { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tapPort { CGEvent.tapEnable(tap: tapPort, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    let keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
    let flags = event.flags
    if type == .keyDown && keyCode == triggerKeyCode && flags.intersection(requiredFlags) == requiredFlags && !isRecording {
        isRecording = true
        emit(captureSelection())
        return nil
    }
    if type == .keyUp && keyCode == triggerKeyCode && isRecording {
        isRecording = false
        FileHandle.standardOutput.write(Data("{\"type\":\"up\"}\n".utf8))
        return nil
    }
    if type == .flagsChanged && isRecording && flags.intersection(requiredFlags) != requiredFlags {
        isRecording = false
        FileHandle.standardOutput.write(Data("{\"type\":\"up\"}\n".utf8))
    }
    return Unmanaged.passUnretained(event)
}, userInfo: nil) else {
    FileHandle.standardOutput.write(Data("{\"type\":\"error\",\"message\":\"Input Monitoring permission is required for the global shortcut.\"}\n".utf8))
    exit(2)
}

tapPort = createdTap
if let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, createdTap, 0) {
    CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
}
CGEvent.tapEnable(tap: createdTap, enable: true)
CFRunLoopRun()
