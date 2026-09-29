import UIKit
import Capacitor

class MintRadarViewController: CAPBridgeViewController {

    override func viewDidLoad() {
        super.viewDidLoad()

        Swift.print(
            "[MintRadarViewController] viewDidLoad FIRED"
        )
    }

    override open func capacitorDidLoad() {
        Swift.print(
            "[MintRadarViewController] capacitorDidLoad FIRED"
        )

        bridge?.registerPluginInstance(
            MintRadarNativePrinterPlugin()
        )

        Swift.print(
            "[MintRadarViewController] Native printer plugin registration requested"
        )
    }
}
