import AppKit

// A small vector drawing, rasterised at the sizes macOS expects for a Dock icon.
let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
func drawIcon(_ pixels: Int, _ filename: String) throws {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
                                  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                  isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let context = NSGraphicsContext.current!.cgContext
    context.scaleBy(x: CGFloat(pixels)/1024, y: CGFloat(pixels)/1024)
    NSColor(calibratedRed: 0.055, green: 0.095, blue: 0.15, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 30, y: 30, width: 964, height: 964), xRadius: 220, yRadius: 220).fill()
    NSColor(calibratedRed: 0.23, green: 0.39, blue: 0.49, alpha: 0.65).setStroke()
    for radius in [160.0, 300.0] {
        let circle = NSBezierPath(ovalIn: NSRect(x: 512-radius, y: 570-radius, width: 2*radius, height: 2*radius))
        circle.lineWidth = 7; circle.stroke()
    }
    for point in [(512.0,570.0),(250.0,570.0),(774.0,570.0),(381.0,797.0),
                  (643.0,343.0),(643.0,797.0),(381.0,343.0)] {
        let centre = point.0 == 512
        let radius = centre ? 32.0 : 22.0
        NSColor(calibratedRed: centre ? 1 : 0.36, green: centre ? 0.79 : 0.88, blue: centre ? 0.36 : 0.83, alpha: 1).setFill()
        NSBezierPath(ovalIn: NSRect(x: point.0-radius, y: point.1-radius, width: radius*2, height: radius*2)).fill()
    }
    let label = "TEM" as NSString
    let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 145, weight: .semibold), .foregroundColor: NSColor.white]
    let size = label.size(withAttributes: attributes)
    label.draw(at: NSPoint(x: (1024-size.width)/2, y: 105), withAttributes: attributes)
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: directory.appendingPathComponent(filename))
}
for size in [16,32,128,256,512] {
    try drawIcon(size, "icon_\(size)x\(size).png")
    try drawIcon(size*2, "icon_\(size)x\(size)@2x.png")
}
