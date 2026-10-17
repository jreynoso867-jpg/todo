// The words on a screenshot, read with Apple's Vision framework: the iPhone build's report says what the app showed.
// Usage (on a Mac): swift tools/screen-text.swift shot.png [fast]
import AppKit
import Foundation
import Vision

guard CommandLine.arguments.count > 1,
      let image = NSImage(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])),
      let picture = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("(no picture)")
    exit(1)
}
let request = VNRecognizeTextRequest()
let fast = CommandLine.arguments.count > 2 && CommandLine.arguments[2] == "fast" // for watching the screen every second
request.recognitionLevel = fast ? .fast : .accurate
request.usesLanguageCorrection = !fast
try VNImageRequestHandler(cgImage: picture).perform([request])
let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: " | "))
