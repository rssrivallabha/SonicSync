package com.sonicsync.nativeapp

import android.content.Context
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.*
import java.nio.charset.StandardCharsets

/**
 * Nearby Connections control transport. Discovery is followed by an actual requestConnection;
 * successful endpoints alone are never treated as connected. Payloads are bounded because this
 * channel carries control/telemetry, not bulk media.
 */
class NearbyRoomTransport(private val context: Context, private val peerName: String, private val roomCode: String) {
    private val client = Nearby.getConnectionsClient(context)
    private val serviceId = "com.sonicsync.nativeapp.$roomCode"
    private val endpointIds = linkedSetOf<String>()
    private val pendingEndpointIds = linkedSetOf<String>()
    private val maxControlBytes = 128 * 1024

    var onControl: (String) -> Unit = {}
    var onStatus: (String) -> Unit = {}

    private val lifecycleCallback = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
            // The first native milestone accepts the transport connection immediately. Production
            // pairing should additionally surface/verify authenticationDigits before accepting.
            client.acceptConnection(endpointId, payloadCallback)
        }

        override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
            pendingEndpointIds.remove(endpointId)
            when (result.status.statusCode) {
                ConnectionsStatusCodes.STATUS_OK -> {
                    endpointIds.add(endpointId)
                    onStatus("CONNECTED $endpointId")
                }
                else -> onStatus("CONNECTION_FAILED $endpointId code=${result.status.statusCode}")
            }
        }

        override fun onDisconnected(endpointId: String) {
            endpointIds.remove(endpointId)
            pendingEndpointIds.remove(endpointId)
            onStatus("DISCONNECTED $endpointId")
        }
    }

    private val callback = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(id: String, info: DiscoveredEndpointInfo) {
            if (info.serviceId != serviceId || endpointIds.contains(id) || !pendingEndpointIds.add(id)) return
            client.requestConnection(peerName, id, lifecycleCallback)
                .addOnFailureListener { e ->
                    pendingEndpointIds.remove(id)
                    onStatus("REQUEST_FAILED $id ${e.message ?: "unknown"}")
                }
        }

        override fun onEndpointLost(id: String) {
            endpointIds.remove(id)
            pendingEndpointIds.remove(id)
        }
    }

    private val payloadCallback = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            val bytes = payload.asBytes() ?: return
            if (bytes.size > maxControlBytes) {
                onStatus("PAYLOAD_REJECTED $endpointId size=${bytes.size}")
                return
            }
            onControl(String(bytes, StandardCharsets.UTF_8))
        }

        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) = Unit
    }

    fun start() {
        client.stopDiscovery().addOnCompleteListener {
            client.startDiscovery(serviceId, callback, DiscoveryOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build())
                .addOnFailureListener { onStatus("DISCOVERY_FAILED ${it.message ?: "unknown"}") }
        }
        client.stopAdvertising().addOnCompleteListener {
            client.startAdvertising(peerName, serviceId, lifecycleCallback,
                AdvertisingOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build())
                .addOnFailureListener { onStatus("ADVERTISING_FAILED ${it.message ?: "unknown"}") }
        }
    }

    fun send(json: String) {
        val bytes = json.toByteArray(StandardCharsets.UTF_8)
        require(bytes.size <= maxControlBytes) { "Control payload exceeds $maxControlBytes bytes" }
        if (endpointIds.isEmpty()) {
            onStatus("SEND_SKIPPED no connected endpoints")
            return
        }
        val payload = Payload.fromBytes(bytes)
        endpointIds.toList().forEach { id ->
            client.sendPayload(id, payload).addOnFailureListener { onStatus("SEND_FAILED $id ${it.message ?: "unknown"}") }
        }
    }

    fun stop() {
        client.stopDiscovery()
        client.stopAdvertising()
        client.stopAllEndpoints()
        endpointIds.clear()
        pendingEndpointIds.clear()
    }
}
