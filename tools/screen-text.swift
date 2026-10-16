// The words on a screenshot, read with Apple's Vision framework: the iPhone build's report says what the app showed.
// Usage (on a Mac): swift tools/screen-text.swift shot.png
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
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
try VNImageRequestHandler(cgImage: picture).perform([request])
let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: " | "))
