#pragma once
#include <cstdint>
#include <functional>
#include <string>

/**
 * Dependency-free desktop LAN transport.
 *
 * UDP multicast is used only for room discovery; control messages use bounded newline-delimited
 * TCP. It intentionally does not claim cryptographic security: production deployment must layer
 * the authenticated SonicSync protocol/session key over this transport.
 */
class LocalTransport {
public:
    using MessageHandler = std::function<void(const std::string&)>;

    explicit LocalTransport(MessageHandler handler = {});
    ~LocalTransport();

    bool startHost(const std::string& room, uint16_t tcpPort = 8787);
    bool discoverAndConnect(const std::string& room, uint16_t discoveryPort = 42421);
    void send(const std::string& message);
    void stop();
    bool connected() const;
    uint16_t tcpPort() const;

private:
    struct Impl;
    Impl* impl_;
};
