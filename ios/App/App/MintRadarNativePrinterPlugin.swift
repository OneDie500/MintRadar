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
            name: "findPrinters",
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

    // MARK: - NIIMBOT Bluetooth UUIDs
    //
    // D110-family transport validated by MintRadar's existing niimbot.js.
    // This path is CONNECTION / IDENTIFICATION ONLY for the first checkpoint.

    private let niimbotServiceUUID =
        CBUUID(
            string:
                "E7810A71-73AE-499D-8C15-FAA9AEF0C3F2"
        )

    private let niimbotCharacteristicUUID =
        CBUUID(
            string:
                "BEF8D6C9-9C21-4C9E-B632-BD58C1009F9F"
        )

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

    // Discovery is intentionally separate from connection state.
    private var pendingDiscoveryCall: CAPPluginCall?
    private var discoveredPrinters: [String: [String: Any]] = [:]

    private var requestedPrinterModel: String?

    // NIIMBOT identification state.
    // The D110 family is expected to report model id 2304, but MintRadar
    // always reports the actual value returned by the printer.
    private var niimbotDetectedModelId: Int?
    private var niimbotIdentificationStarted = false
    private var niimbotModelQuerySent = false

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

    @objc func findPrinters(
        _ call: CAPPluginCall
    ) {
        guard let centralManager = centralManager else {
            call.reject(
                "Bluetooth manager is not available."
            )
            return
        }

        guard centralManager.state == .poweredOn else {
            call.reject(
                bluetoothStateMessage(
                    centralManager.state
                )
            )
            return
        }

        guard pendingDiscoveryCall == nil else {
            call.reject(
                "A printer discovery scan is already in progress."
            )
            return
        }

        guard pendingConnectCall == nil else {
            call.reject(
                "A printer connection is already in progress."
            )
            return
        }

        guard !isPrinting else {
            call.reject(
                "A label is currently printing."
            )
            return
        }

        pendingDiscoveryCall = call
        discoveredPrinters = [:]

        log(
            "Starting MintRadar labeler discovery scan."
        )

        centralManager.scanForPeripherals(
            withServices: nil,
            options: [
                CBCentralManagerScanOptionAllowDuplicatesKey:
                    false
            ]
        )

        DispatchQueue.main.asyncAfter(
            deadline: .now() + 5.0
        ) { [weak self] in
            guard let self = self else {
                return
            }

            guard
                let pendingCall =
                    self.pendingDiscoveryCall,
                pendingCall === call
            else {
                return
            }

            self.centralManager?.stopScan()

            let printers =
                Array(
                    self.discoveredPrinters.values
                )
                .sorted { left, right in
                    let leftRSSI =
                        left["rssi"] as? Int ??
                        Int.min

                    let rightRSSI =
                        right["rssi"] as? Int ??
                        Int.min

                    return leftRSSI > rightRSSI
                }

            self.log(
                "Labeler discovery completed with \(printers.count) supported printer(s)."
            )

            pendingCall.resolve([
                "printers": printers
            ])

            self.pendingDiscoveryCall = nil
            self.discoveredPrinters = [:]
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

        guard pendingDiscoveryCall == nil else {
            call.reject(
                "A printer discovery scan is already in progress."
            )
            return
        }

        guard
            printerModel == "p31s" ||
            printerModel == "niimbot_d110"
        else {
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
            writeCharacteristic != nil,
            requestedPrinterModel == nil
        {
            let connectedName =
                connectedPeripheral.name ??
                (
                    printerModel == "niimbot_d110"
                    ? "NIIMBOT D110"
                    : "P31S"
                )

            if printerModel == "p31s" {
                log(
                    "P31S is already connected."
                )

                call.resolve([
                    "connected": true,
                    "printerName":
                        connectedName
                ])

                return
            }

            if
                printerModel == "niimbot_d110",
                let modelId =
                    niimbotDetectedModelId
            {
                log(
                    "NIIMBOT D110 is already connected. Model ID: \(modelId)."
                )

                call.resolve([
                    "connected": true,
                    "printerName":
                        connectedName,
                    "modelId":
                        modelId
                ])

                return
            }
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
        niimbotDetectedModelId = nil
        niimbotIdentificationStarted = false
        niimbotModelQuerySent = false

        let scanTarget =
            printerModel == "niimbot_d110"
            ? "NIIMBOT D110"
            : "P31S"

        log(
            "Starting BLE scan for \(scanTarget)."
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

            let target =
                self.requestedPrinterModel ==
                    "niimbot_d110"
                ? "NIIMBOT D110"
                : "P31S"

            self.log(
                "BLE scan timed out without finding \(target)."
            )

            self.pendingConnectCall?.reject(
                "Could not find the \(target) printer. Make sure it is powered on and nearby."
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
        niimbotDetectedModelId = nil
        niimbotIdentificationStarted = false
        niimbotModelQuerySent = false

        call.resolve()
    }

    @objc func print(
        _ call: CAPPluginCall
    ) {
        let printerModel =
            call.getString("printerModel") ?? ""

        if printerModel == "niimbot_d110" {
            performD110TestPrint(
                call
            )
            return
        }

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

    // MARK: - NIIMBOT D110_M Native Test Print
    //
    // Controlled checkpoint only.
    // This intentionally does NOT use the MintRadar label renderer yet.
    //
    // Physical device already identified itself as:
    //   D110_M -> model ID 2320 / 0x0910
    //
    // The existing web driver proved the D110 family uses the B1 task:
    //   handshake
    //   SetDensity
    //   SetLabelType
    //   PrintStart (7-byte B1 form)
    //   PageStart
    //   SetPageSize (6-byte B1 form)
    //   0x84 / 0x85 raster rows
    //   PageEnd
    //   PrintEnd
    //
    // We keep this test intentionally small: 96 × 160 dots at the D110 family's
    // 203-dpi B1 path. It prints a simple bordered "MR" diagnostic raster.
    //
    // P31S code below is untouched.

    private func performD110TestPrint(
        _ call: CAPPluginCall
    ) {
        guard
            let peripheral =
                connectedPeripheral,
            peripheral.state ==
                .connected,
            let characteristic =
                writeCharacteristic
        else {
            call.reject(
                "Connect to the NIIMBOT D110_M first."
            )
            return
        }

        guard
            let modelId =
                niimbotDetectedModelId
        else {
            call.reject(
                "The NIIMBOT is connected, but MintRadar has not identified its model ID yet."
            )
            return
        }

        guard
            modelId == 2320 ||
            modelId == 2304
        else {
            call.reject(
                "Test print is limited to the D110 family. This printer reported model ID \(modelId)."
            )
            return
        }

        guard !isPrinting else {
            call.reject(
                "A label is already printing."
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
                "The NIIMBOT characteristic does not support Bluetooth writes."
            )
            return
        }

        pendingPrintCall =
            call

        isPrinting =
            true

        log(
            "Starting NIIMBOT D110_M B1 test print for model ID \(modelId)."
        )

        DispatchQueue.global(
            qos: .userInitiated
        ).async { [weak self] in
            guard let self = self else {
                return
            }

            do {
                // ----------------------------------------------------------
                // 1. B1 post-connect handshake
                // ----------------------------------------------------------

                try self.sendNiimbotTestFrame(
                    command: 0xA5,
                    data: [0x01],
                    peripheral: peripheral,
                    characteristic: characteristic
                )

                Thread.sleep(
                    forTimeInterval: 0.150
                )

                let infoSubcommands: [UInt8] = [
                    0x08,
                    0x0B,
                    0x0D,
                    0x0A,
                    0x07,
                    0x03,
                    0x0C,
                    0x09
                ]

                for subcommand in
                    infoSubcommands
                {
                    try self.sendNiimbotTestFrame(
                        command: 0x40,
                        data: [subcommand],
                        peripheral: peripheral,
                        characteristic: characteristic
                    )

                    Thread.sleep(
                        forTimeInterval: 0.080
                    )
                }

                try self.sendNiimbotTestFrame(
                    command: 0xDC,
                    data: [0x04],
                    peripheral: peripheral,
                    characteristic: characteristic
                )

                Thread.sleep(
                    forTimeInterval: 0.250
                )

                self.log(
                    "D110_M B1 handshake sent."
                )

                // ----------------------------------------------------------
                // 2. Configure one tiny B1 print job
                // ----------------------------------------------------------

                // SetDensity = 3
                try self.sendNiimbotTestFrame(
                    command: 0x21,
                    data: [0x03],
                    peripheral: peripheral,
                    characteristic: characteristic
                )

                Thread.sleep(
                    forTimeInterval: 0.150
                )

                // SetLabelType = 1 (gap stock)
                try self.sendNiimbotTestFrame(
                    command: 0x23,
                    data: [0x01],
                    peripheral: peripheral,
                    characteristic: characteristic
                )

                Thread.sleep(
                    forTimeInterval: 0.150
                )

                // B1 PrintStart:
                // pages=1 + five zero bytes = 7-byte payload.
                try self.sendNiimbotTestFrame(
                    command: 0x01,
                    data: [
                        0x00,
                        0x01,
                        0x00,
                        0x00,
                        0x00,
                        0x00,
                        0x00
                    ],
                    peripheral: peripheral,
                    characteristic: characteristic
                )

                Thread.sleep(
                    forTimeInterval: 0.200
                )

                // B1 PageStart.
                try self.sendNiimbotTestFrame(
                    command: 0x03,
                    data: [0x01],
                    peripheral: peripheral,
                    characteristic: characteristic
                )

                Thread.sleep(
                    forTimeInterval: 0.150
                )

                let suppliedImageBase64 =
                    call.getString(
                        "imageBase64"
                    )

                let isRealLabel =
                    suppliedImageBase64 != nil &&
                    !(suppliedImageBase64 ?? "").isEmpty

                let width =
                    isRealLabel
                        ? max(
                            8,
                            call.getInt(
                                "width"
                            ) ?? 96
                        )
                        : 96

                let height =
                    isRealLabel
                        ? max(
                            8,
                            call.getInt(
                                "height"
                            ) ?? 320
                        )
                        : 160

                guard width % 8 == 0 else {
                    throw NSError(
                        domain:
                            "MintRadarD110",
                        code: 1001,
                        userInfo: [
                            NSLocalizedDescriptionKey:
                                "D110_M label width must be a multiple of 8 pixels."
                        ]
                    )
                }

                // B1 SetPageSize 6-byte payload:
                // H(2), W(2), copies(2).
                try self.sendNiimbotTestFrame(
                    command: 0x13,
                    data: [
                        UInt8(
                            (height >> 8) &
                            0xFF
                        ),
                        UInt8(
                            height &
                            0xFF
                        ),
                        UInt8(
                            (width >> 8) &
                            0xFF
                        ),
                        UInt8(
                            width &
                            0xFF
                        ),
                        0x00,
                        0x01
                    ],
                    peripheral: peripheral,
                    characteristic: characteristic
                )

                Thread.sleep(
                    forTimeInterval: 0.250
                )

                // ----------------------------------------------------------
                // 3. Send a simple 96 × 160 "MR" diagnostic raster
                // ----------------------------------------------------------

                let bitmap: [UInt8]

                if
                    isRealLabel,
                    let suppliedImageBase64 =
                        suppliedImageBase64,
                    let imageData =
                        self.decodeBase64Image(
                            suppliedImageBase64
                        ),
                    let image =
                        UIImage(
                            data: imageData
                        ),
                    let rendered =
                        self.makeD110BitmapFromImage(
                            image,
                            width: width,
                            height: height
                        )
                {
                    bitmap =
                        rendered

                    self.log(
                        "D110_M real MintRadar label rasterized at \(width)×\(height)."
                    )
                } else if isRealLabel {
                    throw NSError(
                        domain:
                            "MintRadarD110",
                        code: 1002,
                        userInfo: [
                            NSLocalizedDescriptionKey:
                                "MintRadar could not decode the D110_M label image."
                        ]
                    )
                } else {
                    bitmap =
                        self.makeD110TestBitmap(
                            width: width,
                            height: height
                        )
                }

                let stride =
                    (width + 7) / 8

                for row in 0..<height {
                    let offset =
                        row *
                        stride

                    let rowBytes =
                        Array(
                            bitmap[
                                offset..<(offset + stride)
                            ]
                        )

                    let blackCount =
                        self.countBlackBits(
                            rowBytes
                        )

                    if blackCount == 0 {
                        try self.sendNiimbotTestFrame(
                            command: 0x84,
                            data: [
                                UInt8(
                                    (row >> 8) &
                                    0xFF
                                ),
                                UInt8(
                                    row &
                                    0xFF
                                ),
                                0x01
                            ],
                            peripheral: peripheral,
                            characteristic: characteristic
                        )
                    } else {
                        var rowPayload: [UInt8] = [
                            UInt8(
                                (row >> 8) &
                                0xFF
                            ),
                            UInt8(
                                row &
                                0xFF
                            ),
                            0x00,
                            UInt8(
                                blackCount &
                                0xFF
                            ),
                            UInt8(
                                (blackCount >> 8) &
                                0xFF
                            ),
                            0x01
                        ]

                        rowPayload.append(
                            contentsOf:
                                rowBytes
                        )

                        try self.sendNiimbotTestFrame(
                            command: 0x85,
                            data: rowPayload,
                            peripheral: peripheral,
                            characteristic: characteristic
                        )
                    }

                    // D110 2304 was physically proven using paced writes.
                    // Keep the same conservative pacing for D110_M 2320.
                    Thread.sleep(
                        forTimeInterval: 0.010
                    )
                }

                self.log(
                    "D110_M diagnostic raster sent."
                )

                // ----------------------------------------------------------
                // 4. Close page + job
                // ----------------------------------------------------------

                try self.sendNiimbotTestFrame(
                    command: 0xE3,
                    data: [0x01],
                    peripheral: peripheral,
                    characteristic: characteristic
                )

                // D110-family PageEnd acknowledgement can take seconds.
                Thread.sleep(
                    forTimeInterval: 3.000
                )

                try self.sendNiimbotTestFrame(
                    command: 0xF3,
                    data: [0x01],
                    peripheral: peripheral,
                    characteristic: characteristic
                )

                Thread.sleep(
                    forTimeInterval: 1.000
                )

                DispatchQueue.main.async {
                    self.log(
                        "NIIMBOT D110_M native test-print sequence completed."
                    )

                    self.pendingPrintCall?.resolve([
                        "printed": true,
                        "printerName":
                            peripheral.name ??
                            "NIIMBOT D110_M",
                        "modelId":
                            modelId,
                        "testWidth":
                            width,
                        "testHeight":
                            height,
                        "realLabel":
                            isRealLabel
                    ])

                    self.pendingPrintCall =
                        nil

                    self.isPrinting =
                        false
                }
            } catch {
                DispatchQueue.main.async {
                    self.log(
                        "NIIMBOT D110_M test print failed: \(error.localizedDescription)"
                    )

                    self.pendingPrintCall?.reject(
                        "D110_M test print failed: \(error.localizedDescription)"
                    )

                    self.pendingPrintCall =
                        nil

                    self.isPrinting =
                        false
                }
            }
        }
    }

    private func sendNiimbotTestFrame(
        command: UInt8,
        data: [UInt8],
        peripheral: CBPeripheral,
        characteristic: CBCharacteristic
    ) throws {
        let frame =
            packNiimbotFrame(
                command: command,
                data: data
            )

        try writeNiimbotData(
            frame,
            peripheral: peripheral,
            characteristic: characteristic
        )
    }

    private func makeD110BitmapFromImage(
        _ image: UIImage,
        width: Int,
        height: Int
    ) -> [UInt8]? {
        guard
            let cgImage =
                normalizedCGImage(
                    image,
                    width: width,
                    height: height
                )
        else {
            return nil
        }

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

        // UIKit/canvas labels are top-left oriented.
        // Flip Core Graphics once so the packed raster keeps that same orientation.
        context.saveGState()

        context.translateBy(
            x: CGFloat(width),
            y: CGFloat(height)
        )

        context.scaleBy(
            x: -1,
            y: -1
        )

        context.draw(
            cgImage,
            in: CGRect(
                x: 0,
                y: 0,
                width: width,
                height: height
            )
        )

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

        let stride =
            (width + 7) / 8

        var bitmap =
            [UInt8](
                repeating: 0,
                count:
                    stride *
                    height
            )

        for y in 0..<height {
            for x in 0..<width {
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

                if
                    alpha > 32 &&
                    luminance < 128
                {
                    bitmap[
                        y *
                        stride +
                        (x >> 3)
                    ] |=
                        UInt8(
                            0x80 >>
                            (x & 7)
                        )
                }
            }
        }

        return bitmap
    }

    private func makeD110TestBitmap(
        width: Int,
        height: Int
    ) -> [UInt8] {
        let stride =
            (width + 7) / 8

        var bitmap =
            [UInt8](
                repeating: 0,
                count:
                    stride *
                    height
            )

        func setBlack(
            x: Int,
            y: Int
        ) {
            guard
                x >= 0,
                x < width,
                y >= 0,
                y < height
            else {
                return
            }

            let index =
                y *
                stride +
                (x >> 3)

            bitmap[index] |=
                UInt8(
                    0x80 >>
                    (x & 7)
                )
        }

        func fillRect(
            x: Int,
            y: Int,
            w: Int,
            h: Int
        ) {
            for yy in
                y..<(y + h)
            {
                for xx in
                    x..<(x + w)
                {
                    setBlack(
                        x: xx,
                        y: yy
                    )
                }
            }
        }

        // Outer diagnostic border.
        fillRect(
            x: 4,
            y: 4,
            w: width - 8,
            h: 3
        )

        fillRect(
            x: 4,
            y: height - 7,
            w: width - 8,
            h: 3
        )

        fillRect(
            x: 4,
            y: 4,
            w: 3,
            h: height - 8
        )

        fillRect(
            x: width - 7,
            y: 4,
            w: 3,
            h: height - 8
        )

        // Big block "M".
        fillRect(
            x: 16,
            y: 38,
            w: 6,
            h: 62
        )

        fillRect(
            x: 42,
            y: 38,
            w: 6,
            h: 62
        )

        for step in 0..<14 {
            fillRect(
                x:
                    22 +
                    step,
                y:
                    40 +
                    step,
                w: 3,
                h: 5
            )

            fillRect(
                x:
                    39 -
                    step,
                y:
                    40 +
                    step,
                w: 3,
                h: 5
            )
        }

        // Big block "R".
        fillRect(
            x: 56,
            y: 38,
            w: 6,
            h: 62
        )

        fillRect(
            x: 56,
            y: 38,
            w: 24,
            h: 6
        )

        fillRect(
            x: 76,
            y: 38,
            w: 6,
            h: 30
        )

        fillRect(
            x: 56,
            y: 63,
            w: 24,
            h: 6
        )

        for step in 0..<16 {
            fillRect(
                x:
                    64 +
                    step,
                y:
                    68 +
                    step * 2,
                w: 4,
                h: 5
            )
        }

        // Bottom alignment bars.
        fillRect(
            x: 16,
            y: 122,
            w: 64,
            h: 4
        )

        fillRect(
            x: 26,
            y: 134,
            w: 44,
            h: 4
        )

        return bitmap
    }

    private func countBlackBits(
        _ bytes: [UInt8]
    ) -> Int {
        var count = 0

        for byte in bytes {
            var value =
                byte

            while value != 0 {
                count +=
                    Int(
                        value &
                        0x01
                    )

                value >>=
                    1
            }
        }

        return count
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
            let pendingDiscoveryCall =
                pendingDiscoveryCall
        {
            central.stopScan()

            pendingDiscoveryCall.reject(
                bluetoothStateMessage(
                    central.state
                )
            )

            self.pendingDiscoveryCall = nil
            self.discoveredPrinters = [:]
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
            pendingDiscoveryCall != nil ||
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

        if pendingDiscoveryCall != nil {
            let profileId: String?

            if normalizedName == "P31S" {
                profileId = "p31s"
            } else if normalizedName.hasPrefix(
                "D110"
            ) {
                profileId = "d110"
            } else {
                profileId = nil
            }

            if let profileId = profileId {
                let deviceId =
                    peripheral.identifier.uuidString

                discoveredPrinters[deviceId] = [
                    "deviceId": deviceId,
                    "deviceName":
                        peripheralName.isEmpty
                        ? normalizedName
                        : peripheralName,
                    "profileId": profileId,
                    "supported": true,
                    "rssi": RSSI.intValue
                ]

                log(
                    "Discovery matched \(normalizedName) to MintRadar profile \(profileId)."
                )
            }

            return
        }

        let wantsNiimbot =
            requestedPrinterModel ==
                "niimbot_d110"

        let matchesTarget =
            wantsNiimbot
            ? normalizedName.hasPrefix(
                "D110"
              )
            : normalizedName == "P31S"

        guard matchesTarget else {
            return
        }

        let targetName =
            wantsNiimbot
            ? "NIIMBOT D110"
            : "P31S"

        log(
            "Found \(targetName): \(normalizedName)."
        )

        central.stopScan()

        connectedPeripheral =
            peripheral

        peripheral.delegate =
            self

        log(
            "Connecting to \(targetName)."
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
        let wantsNiimbot =
            requestedPrinterModel ==
                "niimbot_d110"

        log(
            wantsNiimbot
            ? "Connected to NIIMBOT D110 peripheral."
            : "Connected to P31S peripheral."
        )

        peripheral.delegate =
            self

        if wantsNiimbot {
            log(
                "Discovering NIIMBOT service \(niimbotServiceUUID.uuidString)."
            )

            peripheral.discoverServices([
                niimbotServiceUUID
            ])
        } else {
            log(
                "Discovering service FF00."
            )

            peripheral.discoverServices([
                p31sServiceUUID
            ])
        }
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

        let target =
            requestedPrinterModel ==
                "niimbot_d110"
            ? "NIIMBOT D110"
            : "P31S"

        pendingConnectCall?.reject(
            "Could not connect to \(target): \(message)"
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
        let disconnectedName =
            peripheral.name ??
            "Bluetooth printer"

        if let error = error {
            log(
                "\(disconnectedName) disconnected with error: \(error.localizedDescription)"
            )
        } else {
            log(
                "\(disconnectedName) disconnected."
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
        let wantsNiimbot =
            requestedPrinterModel ==
                "niimbot_d110"

        let target =
            wantsNiimbot
            ? "NIIMBOT D110"
            : "P31S"

        if let error = error {
            failConnection(
                "Could not discover \(target) services: \(error.localizedDescription)"
            )

            return
        }

        guard
            let services =
                peripheral.services
        else {
            failConnection(
                "\(target) did not expose any Bluetooth services."
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

        let wantedServiceUUID =
            wantsNiimbot
            ? niimbotServiceUUID
            : p31sServiceUUID

        guard
            let service =
                services.first(
                    where: {
                        $0.uuid ==
                            wantedServiceUUID
                    }
                )
        else {
            failConnection(
                wantsNiimbot
                ? "NIIMBOT service \(niimbotServiceUUID.uuidString) was not found."
                : "P31S service FF00 was not found."
            )

            return
        }

        log(
            wantsNiimbot
            ? "Found NIIMBOT service \(niimbotServiceUUID.uuidString)."
            : "Found service FF00."
        )

        peripheral.discoverCharacteristics(
            [
                wantsNiimbot
                ? niimbotCharacteristicUUID
                : p31sWriteUUID
            ],
            for: service
        )
    }

    public func peripheral(
        _ peripheral: CBPeripheral,
        didDiscoverCharacteristicsFor service: CBService,
        error: Error?
    ) {
        let wantsNiimbot =
            requestedPrinterModel ==
                "niimbot_d110"

        let target =
            wantsNiimbot
            ? "NIIMBOT D110"
            : "P31S"

        if let error = error {
            failConnection(
                "Could not discover \(target) characteristics: \(error.localizedDescription)"
            )

            return
        }

        guard
            let characteristics =
                service.characteristics
        else {
            failConnection(
                "\(target) did not expose any characteristics."
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

        let wantedUUID =
            wantsNiimbot
            ? niimbotCharacteristicUUID
            : p31sWriteUUID

        guard
            let characteristic =
                characteristics.first(
                    where: {
                        $0.uuid ==
                            wantedUUID
                    }
                )
        else {
            failConnection(
                wantsNiimbot
                ? "NIIMBOT characteristic \(niimbotCharacteristicUUID.uuidString) was not found."
                : "P31S write characteristic FF02 was not found."
            )

            return
        }

        writeCharacteristic =
            characteristic

        if wantsNiimbot {
            guard
                characteristic.properties.contains(
                    .notify
                ) ||
                characteristic.properties.contains(
                    .indicate
                )
            else {
                failConnection(
                    "NIIMBOT characteristic does not support notifications."
                )
                return
            }

            log(
                "Found NIIMBOT characteristic. Enabling notifications before identification."
            )

            peripheral.setNotifyValue(
                true,
                for: characteristic
            )

            return
        }

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

    public func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateNotificationStateFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        guard
            requestedPrinterModel ==
                "niimbot_d110",
            characteristic.uuid ==
                niimbotCharacteristicUUID
        else {
            return
        }

        if let error = error {
            failConnection(
                "Could not enable NIIMBOT notifications: \(error.localizedDescription)"
            )
            return
        }

        guard characteristic.isNotifying else {
            failConnection(
                "NIIMBOT notifications did not become active."
            )
            return
        }

        log(
            "NIIMBOT notifications GREEN. Starting identification."
        )

        beginNiimbotIdentification(
            peripheral: peripheral,
            characteristic: characteristic
        )
    }

    public func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateValueFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        guard
            characteristic.uuid ==
                niimbotCharacteristicUUID,
            requestedPrinterModel ==
                "niimbot_d110"
        else {
            return
        }

        if let error = error {
            log(
                "NIIMBOT notification error: \(error.localizedDescription)"
            )
            return
        }

        guard
            let value =
                characteristic.value,
            let frame =
                parseNiimbotFrame(
                    value
                )
        else {
            return
        }

        log(
            "NIIMBOT RX command 0x\(String(format: "%02X", frame.command)), \(frame.data.count) data bytes."
        )

        if
            frame.command == 0xB5,
            !niimbotModelQuerySent
        {
            sendNiimbotModelQuery(
                peripheral: peripheral,
                characteristic: characteristic
            )
            return
        }

        if frame.command == 0x48 {
            guard
                !frame.data.isEmpty
            else {
                failConnection(
                    "NIIMBOT returned an empty model-id response."
                )
                return
            }

            let modelId: Int

            if frame.data.count >= 2 {
                modelId =
                    (
                        Int(
                            frame.data[0]
                        ) << 8
                    ) |
                    Int(
                        frame.data[1]
                    )
            } else {
                modelId =
                    Int(
                        frame.data[0]
                    ) << 8
            }

            niimbotDetectedModelId =
                modelId

            let printerName =
                peripheral.name ??
                "NIIMBOT D110"

            log(
                "NIIMBOT connection GREEN. Device \(printerName) reported model ID \(modelId)."
            )

            pendingConnectCall?.resolve([
                "connected": true,
                "printerName":
                    printerName,
                "modelId":
                    modelId,
                "expectedD110ModelId":
                    2304,
                "identifiedAsD110":
                    modelId == 2304
            ])

            pendingConnectCall = nil
            requestedPrinterModel = nil
            niimbotIdentificationStarted = false
            niimbotModelQuerySent = false
        }
    }

    private func beginNiimbotIdentification(
        peripheral: CBPeripheral,
        characteristic: CBCharacteristic
    ) {
        guard
            !niimbotIdentificationStarted
        else {
            return
        }

        niimbotIdentificationStarted =
            true

        let initialPacket =
            Data([
                0x03,
                0x55,
                0x55,
                0xC1,
                0x01,
                0x01,
                0xC1,
                0xAA,
                0xAA
            ])

        do {
            try writeNiimbotData(
                initialPacket,
                peripheral: peripheral,
                characteristic: characteristic
            )
        } catch {
            failConnection(
                "Could not send the NIIMBOT connection packet: \(error.localizedDescription)"
            )
            return
        }

        log(
            "NIIMBOT initial connection packet sent."
        )

        DispatchQueue.main.asyncAfter(
            deadline: .now() + 0.200
        ) { [weak self, weak peripheral] in
            guard
                let self = self,
                let peripheral = peripheral,
                self.pendingConnectCall != nil,
                self.requestedPrinterModel ==
                    "niimbot_d110"
            else {
                return
            }

            do {
                let statusFrame =
                    self.packNiimbotFrame(
                        command: 0xA5,
                        data: [0x01]
                    )

                try self.writeNiimbotData(
                    statusFrame,
                    peripheral: peripheral,
                    characteristic: characteristic
                )

                self.log(
                    "NIIMBOT status query sent; waiting briefly before model-id query."
                )
            } catch {
                self.failConnection(
                    "Could not send the NIIMBOT status query: \(error.localizedDescription)"
                )
                return
            }

            // D110 can return a short/non-universal B5 response. Identification
            // rests on 0x40[08] -> 0x48, so send that query even if B5 never arrives.
            DispatchQueue.main.asyncAfter(
                deadline: .now() + 0.450
            ) { [weak self, weak peripheral] in
                guard
                    let self = self,
                    let peripheral = peripheral,
                    self.pendingConnectCall != nil,
                    self.requestedPrinterModel ==
                        "niimbot_d110",
                    !self.niimbotModelQuerySent
                else {
                    return
                }

                self.sendNiimbotModelQuery(
                    peripheral: peripheral,
                    characteristic: characteristic
                )
            }
        }

        DispatchQueue.main.asyncAfter(
            deadline: .now() + 5.0
        ) { [weak self] in
            guard
                let self = self,
                self.pendingConnectCall != nil,
                self.requestedPrinterModel ==
                    "niimbot_d110"
            else {
                return
            }

            self.failConnection(
                "Connected to the NIIMBOT, but model identification timed out."
            )
        }
    }

    private func sendNiimbotModelQuery(
        peripheral: CBPeripheral,
        characteristic: CBCharacteristic
    ) {
        guard
            !niimbotModelQuerySent
        else {
            return
        }

        niimbotModelQuerySent =
            true

        do {
            let frame =
                packNiimbotFrame(
                    command: 0x40,
                    data: [0x08]
                )

            try writeNiimbotData(
                frame,
                peripheral: peripheral,
                characteristic: characteristic
            )

            log(
                "NIIMBOT model-id query 0x40[08] sent."
            )
        } catch {
            failConnection(
                "Could not send the NIIMBOT model-id query: \(error.localizedDescription)"
            )
        }
    }

    private func writeNiimbotData(
        _ data: Data,
        peripheral: CBPeripheral,
        characteristic: CBCharacteristic
    ) throws {
        guard
            peripheral.state ==
                .connected
        else {
            throw NativePrinterError(
                message:
                    "The NIIMBOT disconnected during identification."
            )
        }

        let writeType: CBCharacteristicWriteType

        if characteristic.properties.contains(
            .writeWithoutResponse
        ) {
            writeType =
                .withoutResponse
        } else if characteristic.properties.contains(
            .write
        ) {
            writeType =
                .withResponse
        } else {
            throw NativePrinterError(
                message:
                    "The NIIMBOT characteristic does not support Bluetooth writes."
            )
        }

        peripheral.writeValue(
            data,
            for: characteristic,
            type: writeType
        )
    }

    private func packNiimbotFrame(
        command: UInt8,
        data: [UInt8]
    ) -> Data {
        let length =
            UInt8(
                data.count
            )

        var crc =
            command ^
            length

        for byte in data {
            crc ^= byte
        }

        var bytes: [UInt8] = [
            0x55,
            0x55,
            command,
            length
        ]

        bytes.append(
            contentsOf: data
        )

        bytes.append(
            crc
        )

        bytes.append(
            0xAA
        )

        bytes.append(
            0xAA
        )

        return Data(
            bytes
        )
    }

    private func parseNiimbotFrame(
        _ value: Data
    ) -> (
        command: UInt8,
        data: [UInt8]
    )? {
        let bytes =
            [UInt8](
                value
            )

        guard
            bytes.count >= 7,
            bytes[0] == 0x55,
            bytes[1] == 0x55
        else {
            return nil
        }

        let command =
            bytes[2]

        let length =
            Int(
                bytes[3]
            )

        guard
            bytes.count >=
                7 + length
        else {
            return nil
        }

        let payloadStart = 4
        let payloadEnd =
            payloadStart +
            length

        let payload =
            Array(
                bytes[
                    payloadStart..<payloadEnd
                ]
            )

        return (
            command,
            payload
        )
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
        niimbotDetectedModelId = nil
        niimbotIdentificationStarted = false
        niimbotModelQuerySent = false
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
