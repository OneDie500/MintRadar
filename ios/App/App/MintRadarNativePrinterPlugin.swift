import Foundation
import UIKit
import Capacitor
import CoreBluetooth

@objc(MintRadarNativePrinterPlugin)
public class MintRadarNativePrinterPlugin:
    CAPPlugin,
    CAPBridgedPlugin,
    CBCentralManagerDelegate,
    CBPeripheralDelegate
{

    public let identifier = "MintRadarNativePrinterPlugin"
    public let jsName = "MintRadarNativePrinter"

    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(
            name: "isSupported",
            returnType: CAPPluginReturnPromise
        ),
        CAPPluginMethod(
            name: "connect",
            returnType: CAPPluginReturnPromise
        ),
        CAPPluginMethod(
            name: "disconnect",
            returnType: CAPPluginReturnPromise
        ),
        CAPPluginMethod(
            name: "print",
            returnType: CAPPluginReturnPromise
        )
    ]

    // MARK: - P31S Bluetooth UUIDs

    private let p31sServiceUUID =
        CBUUID(string: "FF00")

    private let p31sWriteUUID =
        CBUUID(string: "FF02")

    // MARK: - P31S Label Geometry

    private let p31sSourceWidth = 320
    private let p31sSourceHeight = 112

    private let p31sRotatedWidth = 112
    private let p31sRotatedHeight = 320

    // MARK: - Bluetooth State

    private var centralManager: CBCentralManager?

    private var connectedPeripheral: CBPeripheral?

    private var writeCharacteristic: CBCharacteristic?

    // MARK: - Pending Capacitor Calls

    private var pendingSupportCall: CAPPluginCall?

    private var pendingConnectCall: CAPPluginCall?

    private var pendingPrintCall: CAPPluginCall?

    private var requestedPrinterModel: String?

    // MARK: - Print State

    private var isPrinting = false

    // MARK: - Plugin Load

    public override func load() {
        super.load()

        log(
            "Plugin loaded."
        )

        centralManager = CBCentralManager(
            delegate: self,
            queue: DispatchQueue.main
        )

        log(
            "CBCentralManager created."
        )
    }

    // MARK: - Capacitor Methods

    @objc func isSupported(
        _ call: CAPPluginCall
    ) {
        guard let centralManager = centralManager else {
            log(
                "isSupported: Bluetooth manager unavailable."
            )

            call.resolve([
                "supported": false
            ])

            return
        }

        log(
            "isSupported called. Bluetooth state: \(bluetoothStateName(centralManager.state))"
        )

        switch centralManager.state {

        case .poweredOn:
            call.resolve([
                "supported": true
            ])

        case .unknown,
             .resetting:

            if let previousCall = pendingSupportCall {
                previousCall.resolve([
                    "supported": false
                ])
            }

            pendingSupportCall = call

            log(
                "Waiting for CoreBluetooth to finish initializing."
            )

            DispatchQueue.main.asyncAfter(
                deadline: .now() + 5.0
            ) { [weak self] in

                guard let self = self else {
                    return
                }

                guard
                    let pendingCall =
                        self.pendingSupportCall,
                    pendingCall === call
                else {
                    return
                }

                self.pendingSupportCall = nil

                let state =
                    self.centralManager?.state ??
                    .unknown

                self.log(
                    "Bluetooth support check timed out with state: \(self.bluetoothStateName(state))"
                )

                pendingCall.resolve([
                    "supported":
                        state == .poweredOn
                ])
            }

        case .poweredOff,
             .unauthorized,
             .unsupported:

            call.resolve([
                "supported": false
            ])

        @unknown default:
            call.resolve([
                "supported": false
            ])
        }
    }

    @objc func connect(
        _ call: CAPPluginCall
    ) {
        let printerModel =
            call.getString("printerModel") ?? ""

        log(
            "Connect requested for printer model: \(printerModel)"
        )

        guard printerModel == "p31s" else {
            call.reject(
                "Native printing for \(printerModel.uppercased()) is not implemented yet."
            )

            return
        }

        guard let centralManager = centralManager else {
            call.reject(
                "Bluetooth manager is not available."
            )

            return
        }

        log(
            "Bluetooth state at connect: \(bluetoothStateName(centralManager.state))"
        )

        guard centralManager.state == .poweredOn else {
            call.reject(
                bluetoothStateMessage(
                    centralManager.state
                )
            )

            return
        }

        if
            let connectedPeripheral = connectedPeripheral,
            connectedPeripheral.state == .connected,
            writeCharacteristic != nil
        {
            log(
                "P31S is already connected."
            )

            call.resolve([
                "connected": true,
                "printerName":
                    connectedPeripheral.name ??
                    "P31S"
            ])

            return
        }

        if pendingConnectCall != nil {
            call.reject(
                "A printer connection is already in progress."
            )

            return
        }

        pendingConnectCall = call
        requestedPrinterModel = printerModel

        connectedPeripheral = nil
        writeCharacteristic = nil

        log(
            "Starting BLE scan for P31S."
        )

        centralManager.scanForPeripherals(
            withServices: nil,
            options: [
                CBCentralManagerScanOptionAllowDuplicatesKey:
                    false
            ]
        )

        DispatchQueue.main.asyncAfter(
            deadline: .now() + 15.0
        ) { [weak self] in

            guard let self = self else {
                return
            }

            guard
                self.pendingConnectCall != nil
            else {
                return
            }

            self.centralManager?.stopScan()

            self.log(
                "BLE scan timed out without finding P31S."
            )

            self.pendingConnectCall?.reject(
                "Could not find the P31S printer. Make sure it is powered on and nearby."
            )

            self.pendingConnectCall = nil
            self.requestedPrinterModel = nil
        }
    }

    @objc func disconnect(
        _ call: CAPPluginCall
    ) {
        log(
            "Disconnect requested."
        )

        guard !isPrinting else {
            call.reject(
                "A label is currently printing."
            )

            return
        }

        centralManager?.stopScan()

        if let peripheral = connectedPeripheral {
            centralManager?.cancelPeripheralConnection(
                peripheral
            )
        }

        connectedPeripheral = nil
        writeCharacteristic = nil
        requestedPrinterModel = nil

        call.resolve()
    }

    @objc func print(
        _ call: CAPPluginCall
    ) {
        let printerModel =
            call.getString("printerModel") ?? ""

        guard printerModel == "p31s" else {
            call.reject(
                "Native printing for \(printerModel.uppercased()) is not implemented yet."
            )

            return
        }

        guard
            let peripheral = connectedPeripheral,
            peripheral.state == .connected,
            let characteristic = writeCharacteristic
        else {
            call.reject(
                "Connect to the P31S first."
            )

            return
        }

        guard !isPrinting else {
            call.reject(
                "A label is already printing."
            )

            return
        }

        guard
            let imageBase64 =
                call.getString("imageBase64"),
            !imageBase64.isEmpty
        else {
            call.reject(
                "MintRadar did not provide label image data."
            )

            return
        }

        let requestedWidth =
            call.getInt("width") ??
            p31sSourceWidth

        let requestedHeight =
            call.getInt("height") ??
            p31sSourceHeight

        guard
            requestedWidth == p31sSourceWidth,
            requestedHeight == p31sSourceHeight
        else {
            call.reject(
                "P31S labels must use a 320×112 source canvas."
            )

            return
        }

        let copies =
            max(
                1,
                call.getInt("copies") ?? 1
            )

        guard
            let imageData =
                decodeBase64Image(
                    imageBase64
                ),
            let image =
                UIImage(data: imageData)
        else {
            call.reject(
                "Could not decode the MintRadar label image."
            )

            return
        }

        guard
            let command =
                buildP31SCommand(
                    from: image
                )
        else {
            call.reject(
                "Could not convert the MintRadar label into P31S bitmap data."
            )

            return
        }

        let supportsWithoutResponse =
            characteristic.properties.contains(
                .writeWithoutResponse
            )

        let supportsWithResponse =
            characteristic.properties.contains(
                .write
            )

        guard
            supportsWithoutResponse ||
            supportsWithResponse
        else {
            call.reject(
                "P31S characteristic FF02 does not support Bluetooth writes."
            )

            return
        }

        pendingPrintCall = call
        isPrinting = true

        log(
            "Starting native P31S print."
        )

        log(
            "Source canvas: \(requestedWidth)×\(requestedHeight)"
        )

        log(
            "Rotated bitmap: \(p31sRotatedWidth)×\(p31sRotatedHeight)"
        )

        log(
            "TSPL command bytes: \(command.count)"
        )

        log(
            "Copies requested: \(copies)"
        )

        let writeType: CBCharacteristicWriteType =
            supportsWithoutResponse
            ? .withoutResponse
            : .withResponse

        log(
            writeType == .withoutResponse
            ? "Using BLE writeWithoutResponse."
            : "Using BLE writeWithResponse."
        )

        performPrintSequence(
            peripheral: peripheral,
            characteristic: characteristic,
            command: command,
            copies: copies,
            writeType: writeType
        )
    }

    // MARK: - Native P31S Print Pipeline

    private func performPrintSequence(
        peripheral: CBPeripheral,
        characteristic: CBCharacteristic,
        command: Data,
        copies: Int,
        writeType: CBCharacteristicWriteType
    ) {
        let wakeBytes =
            Data([
                0x1b,
                0x21,
                0x6f,
                0x0d,
                0x0a
            ])

        DispatchQueue.global(
            qos: .userInitiated
        ).async { [weak self] in

            guard let self = self else {
                return
            }

            do {
                for copyIndex in 0..<copies {

                    self.log(
                        "Printing copy \(copyIndex + 1) of \(copies)."
                    )

                    try self.sendBytes(
                        wakeBytes,
                        peripheral: peripheral,
                        characteristic: characteristic,
                        writeType: writeType
                    )

                    Thread.sleep(
                        forTimeInterval: 0.250
                    )

                    try self.sendBytes(
                        command,
                        peripheral: peripheral,
                        characteristic: characteristic,
                        writeType: writeType
                    )

                    Thread.sleep(
                        forTimeInterval: 2.000
                    )
                }

                DispatchQueue.main.async {
                    self.log(
                        "Native P31S print sequence completed."
                    )

                    self.pendingPrintCall?.resolve()

                    self.pendingPrintCall = nil
                    self.isPrinting = false
                }
            } catch {
                DispatchQueue.main.async {
                    self.log(
                        "Native P31S print failed: \(error.localizedDescription)"
                    )

                    self.pendingPrintCall?.reject(
                        "P31S print failed: \(error.localizedDescription)"
                    )

                    self.pendingPrintCall = nil
                    self.isPrinting = false
                }
            }
        }
    }

    private func sendBytes(
        _ data: Data,
        peripheral: CBPeripheral,
        characteristic: CBCharacteristic,
        writeType: CBCharacteristicWriteType
    ) throws {
        guard
            peripheral.state == .connected
        else {
            throw NativePrinterError(
                message:
                    "The P31S disconnected before printing finished."
            )
        }

        let maximumLength =
            peripheral.maximumWriteValueLength(
                for: writeType
            )

        let chunkSize =
            max(
                1,
                min(
                    180,
                    maximumLength
                )
            )

        log(
            "Sending \(data.count) bytes in chunks of up to \(chunkSize)."
        )

        var offset = 0

        while offset < data.count {
            guard
                peripheral.state == .connected
            else {
                throw NativePrinterError(
                    message:
                        "The P31S disconnected while receiving label data."
                )
            }

            let end =
                min(
                    offset + chunkSize,
                    data.count
                )

            let chunk =
                data.subdata(
                    in: offset..<end
                )

            DispatchQueue.main.sync {
                peripheral.writeValue(
                    chunk,
                    for: characteristic,
                    type: writeType
                )
            }

            offset = end

            Thread.sleep(
                forTimeInterval: 0.030
            )
        }
    }

    // MARK: - PNG -> P31S Bitmap

    private func decodeBase64Image(
        _ value: String
    ) -> Data? {
        var base64 = value

        if
            let commaIndex =
                base64.firstIndex(
                    of: ","
                )
        {
            let prefix =
                String(
                    base64[
                        ..<commaIndex
                    ]
                )

            if prefix.contains(
                "base64"
            ) {
                base64 =
                    String(
                        base64[
                            base64.index(
                                after:
                                    commaIndex
                            )...
                        ]
                    )
            }
        }

        return Data(
            base64Encoded: base64,
            options:
                .ignoreUnknownCharacters
        )
    }

    private func buildP31SCommand(
        from sourceImage: UIImage
    ) -> Data? {
        guard
            let bitmap =
                createP31SBitmap(
                    from: sourceImage
                )
        else {
            return nil
        }

        let header =
            "SIZE 14.0 mm,40.0 mm\r\n" +
            "GAP 5.0 mm,0 mm\r\n" +
            "DIRECTION 0,0\r\n" +
            "DENSITY 15\r\n" +
            "CLS\r\n" +
            "BITMAP 0,0,\(bitmap.widthBytes),\(bitmap.height),1,"

        let footer =
            "\r\nPRINT 1\r\n"

        guard
            let headerData =
                header.data(
                    using: .utf8
                ),
            let footerData =
                footer.data(
                    using: .utf8
                )
        else {
            return nil
        }

        var command =
            Data()

        command.append(
            headerData
        )

        command.append(
            bitmap.data
        )

        command.append(
            footerData
        )

        return command
    }

    private func createP31SBitmap(
        from sourceImage: UIImage
    ) -> (
        widthBytes: Int,
        height: Int,
        data: Data
    )? {
        let width =
            p31sRotatedWidth

        let height =
            p31sRotatedHeight

        let bytesPerPixel = 4

        let bytesPerRow =
            width *
            bytesPerPixel

        let colorSpace =
            CGColorSpaceCreateDeviceRGB()

        guard
            let context =
                CGContext(
                    data: nil,
                    width: width,
                    height: height,
                    bitsPerComponent: 8,
                    bytesPerRow: bytesPerRow,
                    space: colorSpace,
                    bitmapInfo:
                        CGImageAlphaInfo
                            .premultipliedLast
                            .rawValue
                )
        else {
            return nil
        }

        /*
         Match the browser canvas:

         rotated.width  = 112
         rotated.height = 320

         ctx.fillStyle = white

         ctx.translate(112, 0)
         ctx.rotate(PI / 2)
         ctx.drawImage(source, 0, 0)
         */

        context.setFillColor(
            UIColor.white.cgColor
        )

        context.fill(
            CGRect(
                x: 0,
                y: 0,
                width: width,
                height: height
            )
        )

        context.saveGState()

        /*
         Core Graphics uses a bottom-left coordinate
         system while HTML canvas uses top-left.

         This transform reproduces the same effective
         90-degree orientation as the known-good web
         driver.
         */

        context.translateBy(
            x: CGFloat(width),
            y: 0
        )

        context.rotate(
            by: .pi / 2
        )

        if let cgImage =
            normalizedCGImage(
                sourceImage,
                width: p31sSourceWidth,
                height: p31sSourceHeight
            )
        {
            context.draw(
                cgImage,
                in: CGRect(
                    x: 0,
                    y: 0,
                    width:
                        p31sSourceWidth,
                    height:
                        p31sSourceHeight
                )
            )
        } else {
            context.restoreGState()
            return nil
        }

        context.restoreGState()

        guard
            let rawData =
                context.data
        else {
            return nil
        }

        let pixels =
            rawData.bindMemory(
                to: UInt8.self,
                capacity:
                    bytesPerRow *
                    height
            )

        let widthBytes =
            Int(
                ceil(
                    Double(width) /
                    8.0
                )
            )

        var bitmap =
            Data(
                repeating: 0,
                count:
                    widthBytes *
                    height
            )

        bitmap.withUnsafeMutableBytes {
            rawBitmapBuffer in

            guard
                let output =
                    rawBitmapBuffer
                        .bindMemory(
                            to: UInt8.self
                        )
                        .baseAddress
            else {
                return
            }

            for y in 0..<height {
                for byteX in 0..<widthBytes {

                    var byteValue:
                        UInt8 = 0

                    for bit in 0..<8 {

                        let x =
                            byteX *
                            8 +
                            bit

                        var white = true

                        if x < width {
                            let pixelIndex =
                                y *
                                bytesPerRow +
                                x *
                                bytesPerPixel

                            let red =
                                Double(
                                    pixels[
                                        pixelIndex
                                    ]
                                )

                            let green =
                                Double(
                                    pixels[
                                        pixelIndex + 1
                                    ]
                                )

                            let blue =
                                Double(
                                    pixels[
                                        pixelIndex + 2
                                    ]
                                )

                            let alpha =
                                pixels[
                                    pixelIndex + 3
                                ]

                            let luminance =
                                red *
                                    0.299 +
                                green *
                                    0.587 +
                                blue *
                                    0.114

                            white =
                                alpha < 128 ||
                                luminance >= 128
                        }

                        if white {
                            byteValue |=
                                UInt8(
                                    0x80 >>
                                    bit
                                )
                        }
                    }

                    output[
                        y *
                        widthBytes +
                        byteX
                    ] =
                        byteValue
                }
            }
        }

        return (
            widthBytes:
                widthBytes,
            height:
                height,
            data:
                bitmap
        )
    }

    private func normalizedCGImage(
        _ image: UIImage,
        width: Int,
        height: Int
    ) -> CGImage? {
        let renderer =
            UIGraphicsImageRenderer(
                size: CGSize(
                    width: width,
                    height: height
                )
            )

        let normalized =
            renderer.image {
                context in

                UIColor.white.setFill()

                context.fill(
                    CGRect(
                        x: 0,
                        y: 0,
                        width: width,
                        height: height
                    )
                )

                image.draw(
                    in: CGRect(
                        x: 0,
                        y: 0,
                        width: width,
                        height: height
                    )
                )
            }

        return normalized.cgImage
    }

    // MARK: - CBCentralManagerDelegate

    public func centralManagerDidUpdateState(
        _ central: CBCentralManager
    ) {
        log(
            "Bluetooth state changed: \(bluetoothStateName(central.state))"
        )

        if
            central.state != .unknown,
            central.state != .resetting,
            let pendingSupportCall =
                pendingSupportCall
        {
            self.pendingSupportCall = nil

            let supported =
                central.state ==
                .poweredOn

            log(
                "Resolving pending support check: \(supported)"
            )

            pendingSupportCall.resolve([
                "supported": supported
            ])
        }

        if
            central.state != .poweredOn,
            central.state != .unknown,
            central.state != .resetting,
            let pendingConnectCall =
                pendingConnectCall
        {
            pendingConnectCall.reject(
                bluetoothStateMessage(
                    central.state
                )
            )

            self.pendingConnectCall = nil
            self.requestedPrinterModel = nil
        }
    }

    public func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        guard
            pendingConnectCall != nil
        else {
            return
        }

        let peripheralName =
            peripheral.name ??
            advertisementData[
                CBAdvertisementDataLocalNameKey
            ] as? String ??
            ""

        let normalizedName =
            peripheralName
                .trimmingCharacters(
                    in:
                        .whitespacesAndNewlines
                )
                .uppercased()

        if !normalizedName.isEmpty {
            log(
                "Discovered BLE device: \(normalizedName)"
            )
        }

        guard
            normalizedName == "P31S"
        else {
            return
        }

        log(
            "Found P31S."
        )

        central.stopScan()

        connectedPeripheral =
            peripheral

        peripheral.delegate =
            self

        log(
            "Connecting to P31S."
        )

        central.connect(
            peripheral,
            options: nil
        )
    }

    public func centralManager(
        _ central: CBCentralManager,
        didConnect peripheral: CBPeripheral
    ) {
        log(
            "Connected to P31S peripheral."
        )

        peripheral.delegate =
            self

        log(
            "Discovering service FF00."
        )

        peripheral.discoverServices([
            p31sServiceUUID
        ])
    }

    public func centralManager(
        _ central: CBCentralManager,
        didFailToConnect peripheral: CBPeripheral,
        error: Error?
    ) {
        let message =
            error?.localizedDescription ??
            "Unknown Bluetooth connection error."

        log(
            "Connection failed: \(message)"
        )

        pendingConnectCall?.reject(
            "Could not connect to P31S: \(message)"
        )

        pendingConnectCall = nil
        connectedPeripheral = nil
        writeCharacteristic = nil
        requestedPrinterModel = nil
    }

    public func centralManager(
        _ central: CBCentralManager,
        didDisconnectPeripheral peripheral: CBPeripheral,
        error: Error?
    ) {
        if let error = error {
            log(
                "P31S disconnected with error: \(error.localizedDescription)"
            )
        } else {
            log(
                "P31S disconnected."
            )
        }

        if
            connectedPeripheral?.identifier ==
            peripheral.identifier
        {
            connectedPeripheral = nil
            writeCharacteristic = nil
        }

        if
            isPrinting,
            pendingPrintCall != nil
        {
            pendingPrintCall?.reject(
                "The P31S disconnected while printing."
            )

            pendingPrintCall = nil
            isPrinting = false
        }
    }

    // MARK: - CBPeripheralDelegate

    public func peripheral(
        _ peripheral: CBPeripheral,
        didDiscoverServices error: Error?
    ) {
        if let error = error {
            failConnection(
                "Could not discover P31S services: \(error.localizedDescription)"
            )

            return
        }

        guard
            let services =
                peripheral.services
        else {
            failConnection(
                "P31S did not expose any Bluetooth services."
            )

            return
        }

        let serviceNames =
            services
                .map {
                    $0.uuid.uuidString
                }
                .joined(
                    separator: ", "
                )

        log(
            "Services discovered: \(serviceNames)"
        )

        guard
            let service =
                services.first(
                    where: {
                        $0.uuid ==
                            p31sServiceUUID
                    }
                )
        else {
            failConnection(
                "P31S service FF00 was not found."
            )

            return
        }

        log(
            "Found service FF00."
        )

        peripheral.discoverCharacteristics(
            [p31sWriteUUID],
            for: service
        )
    }

    public func peripheral(
        _ peripheral: CBPeripheral,
        didDiscoverCharacteristicsFor service: CBService,
        error: Error?
    ) {
        if let error = error {
            failConnection(
                "Could not discover P31S characteristics: \(error.localizedDescription)"
            )

            return
        }

        guard
            let characteristics =
                service.characteristics
        else {
            failConnection(
                "P31S did not expose any characteristics."
            )

            return
        }

        let characteristicNames =
            characteristics
                .map {
                    $0.uuid.uuidString
                }
                .joined(
                    separator: ", "
                )

        log(
            "Characteristics discovered: \(characteristicNames)"
        )

        guard
            let characteristic =
                characteristics.first(
                    where: {
                        $0.uuid ==
                            p31sWriteUUID
                    }
                )
        else {
            failConnection(
                "P31S write characteristic FF02 was not found."
            )

            return
        }

        writeCharacteristic =
            characteristic

        log(
            "Found FF02. Native P31S connection GREEN."
        )

        pendingConnectCall?.resolve([
            "connected": true,
            "printerName":
                peripheral.name ??
                "P31S"
        ])

        pendingConnectCall = nil
        requestedPrinterModel = nil
    }

    // MARK: - Helpers

    private func failConnection(
        _ message: String
    ) {
        log(
            message
        )

        centralManager?.stopScan()

        if let peripheral =
            connectedPeripheral
        {
            centralManager?
                .cancelPeripheralConnection(
                    peripheral
                )
        }

        pendingConnectCall?.reject(
            message
        )

        pendingConnectCall = nil
        connectedPeripheral = nil
        writeCharacteristic = nil
        requestedPrinterModel = nil
    }

    private func bluetoothStateMessage(
        _ state: CBManagerState
    ) -> String {
        switch state {

        case .unknown:
            return "Bluetooth is still initializing. Try again in a moment."

        case .resetting:
            return "Bluetooth is resetting. Try again in a moment."

        case .unsupported:
            return "Bluetooth Low Energy is not supported on this device."

        case .unauthorized:
            return "MintRadar does not have permission to use Bluetooth."

        case .poweredOff:
            return "Bluetooth is turned off."

        case .poweredOn:
            return "Bluetooth is ready."

        @unknown default:
            return "Bluetooth is unavailable."
        }
    }

    private func bluetoothStateName(
        _ state: CBManagerState
    ) -> String {
        switch state {

        case .unknown:
            return "unknown"

        case .resetting:
            return "resetting"

        case .unsupported:
            return "unsupported"

        case .unauthorized:
            return "unauthorized"

        case .poweredOff:
            return "poweredOff"

        case .poweredOn:
            return "poweredOn"

        @unknown default:
            return "unknown-default"
        }
    }

    private func log(
        _ message: String
    ) {
        Swift.print(
            "[MintRadarNativePrinter] \(message)"
        )
    }
}

// MARK: - Native Printer Error

private struct NativePrinterError:
    LocalizedError
{
    let message: String

    var errorDescription: String? {
        return message
    }
}
