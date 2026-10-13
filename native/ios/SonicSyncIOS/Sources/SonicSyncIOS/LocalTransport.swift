import Foundation
import Network

public final class LocalTransport: @unchecked Sendable {
    public typealias MessageHandler = @Sendable (Data) -> Void
    private let queue = DispatchQueue(label: "sonicsync.transport")
    private var listener: NWListener?
    private var browser: NWBrowser?
    private var connections: [NWEndpoint: NWConnection] = [:]
    private let serviceType = "_sonicsync._tcp"
    private var handler: MessageHandler
    private let maxMessageBytes = 128 * 1024

    public init(handler: @escaping MessageHandler) { self.handler = handler }

    public func advertise(room: String, port: UInt16 = 8787) throws {
        let listener = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: port)!)
        listener.service = NWListener.Service(name: "SonicSync-\(room)", type: serviceType, txtRecord: NWTXTRecord(["room": room, "v": "10"]))
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        listener.start(queue: queue)
        self.listener = listener
    }

    public func discover() {
        let browser = NWBrowser(for: .bonjourWithTXTRecord(type: serviceType, domain: nil), using: .tcp)
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            for result in results {
                guard self?.connections[result.endpoint] == nil else { continue }
                let c = NWConnection(to: result.endpoint, using: .tcp)
                self?.accept(c)
            }
        }
        browser.start(queue: queue)
        self.browser = browser
    }

    public func send(json: Data) {
        guard json.count <= maxMessageBytes else { return }
        for connection in connections.values {
            connection.send(content: json + Data([10]), completion: .contentProcessed { _ in })
        }
    }

    public func stop() {
        browser?.cancel(); listener?.cancel(); browser = nil; listener = nil
        for c in connections.values { c.cancel() }; connections.removeAll()
    }

    private func accept(_ connection: NWConnection) {
        connections[connection.endpoint] = connection
        connection.stateUpdateHandler = { [weak self, weak connection] state in
            if case .failed = state, let endpoint = connection?.endpoint { self?.connections.removeValue(forKey: endpoint) }
        }
        var buffer = Data()
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, complete, _ in
            guard let self else { connection.cancel(); return }
            if let data { buffer.append(data) }
            if buffer.count > self.maxMessageBytes { connection.cancel(); return }
            while let nl = buffer.firstIndex(of: 10) {
                let line = buffer.prefix(upTo: nl); buffer.removeSubrange(...nl)
                self?.handler(Data(line))
            }
            if !complete { self?.acceptReceiveLoop(connection, buffer: buffer) }
        }
    }

    private func acceptReceiveLoop(_ connection: NWConnection, buffer: Data) {
        var buffer = buffer
        connection.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, complete, _ in
            guard let self else { connection.cancel(); return }
            if let data { buffer.append(data) }
            if buffer.count > self.maxMessageBytes { connection.cancel(); return }
            while let nl = buffer.firstIndex(of: 10) {
                let line = buffer.prefix(upTo: nl); buffer.removeSubrange(...nl); self?.handler(Data(line))
            }
            if !complete { self?.acceptReceiveLoop(connection, buffer: buffer) }
        }
    }
}
