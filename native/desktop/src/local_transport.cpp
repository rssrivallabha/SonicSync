#include "local_transport.h"
#include <algorithm>
#include <atomic>
#include <cerrno>
#include <cstring>
#include <mutex>
#include <sstream>
#include <thread>
#include <vector>

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "Ws2_32.lib")
using socket_t = SOCKET;
constexpr socket_t invalid_socket = INVALID_SOCKET;
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>
using socket_t = int;
constexpr socket_t invalid_socket = -1;
#endif

namespace {
constexpr const char* kDiscoveryGroup = "239.255.42.99";
constexpr std::size_t kMaxMessageBytes = 128 * 1024;
constexpr std::size_t kMaxDiscoveryPacket = 512;
constexpr uint16_t kDefaultDiscoveryPort = 42421;

void closeSocket(socket_t s) {
    if (s == invalid_socket) return;
#if defined(_WIN32)
    ::shutdown(s, SD_BOTH);
    closesocket(s);
#else
    ::shutdown(s, SHUT_RDWR);
    ::close(s);
#endif
}

bool sendAll(socket_t s, const char* data, std::size_t length) {
    std::size_t sent = 0;
    while (sent < length) {
#if defined(_WIN32)
        const int n = ::send(s, data + sent, static_cast<int>(length - sent), 0);
#else
        const ssize_t n = ::send(s, data + sent, length - sent, MSG_NOSIGNAL);
#endif
        if (n <= 0) return false;
        sent += static_cast<std::size_t>(n);
    }
    return true;
}

bool setReuse(socket_t s) {
    int yes = 1;
#if defined(_WIN32)
    return setsockopt(s, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&yes), sizeof(yes)) == 0;
#else
    return setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes)) == 0;
#endif
}
}

struct LocalTransport::Impl {
    explicit Impl(MessageHandler h) : handler(std::move(h)) {}

    MessageHandler handler;
    std::atomic<bool> running{false};
    std::atomic<bool> isConnected{false};
    uint16_t port = 0;
    socket_t listener = invalid_socket;
    socket_t discovery = invalid_socket;
    std::mutex socketsMutex;
    std::mutex sendMutex;
    std::vector<socket_t> peers;
    std::vector<std::thread> workers;
    std::thread acceptThread;
    std::thread discoveryThread;

    void removePeer(socket_t s) {
        std::lock_guard<std::mutex> lock(socketsMutex);
        peers.erase(std::remove(peers.begin(), peers.end(), s), peers.end());
        closeSocket(s);
        isConnected.store(!peers.empty());
    }

    void receiveLoop(socket_t s) {
        std::string buffer;
        buffer.reserve(4096);
        char chunk[8192];
        while (running.load()) {
#if defined(_WIN32)
            const int n = ::recv(s, chunk, sizeof(chunk), 0);
#else
            const ssize_t n = ::recv(s, chunk, sizeof(chunk), 0);
#endif
            if (n <= 0) break;
            buffer.append(chunk, static_cast<std::size_t>(n));
            if (buffer.size() > kMaxMessageBytes) break;
            std::size_t newline = 0;
            while ((newline = buffer.find('\n')) != std::string::npos) {
                std::string message = buffer.substr(0, newline);
                buffer.erase(0, newline + 1);
                if (message.size() <= kMaxMessageBytes && handler) handler(message);
            }
        }
        removePeer(s);
    }

    void addPeer(socket_t s) {
        {
            std::lock_guard<std::mutex> lock(socketsMutex);
            peers.push_back(s);
            isConnected.store(true);
        }
        workers.emplace_back([this, s] { receiveLoop(s); });
    }

    void acceptLoop() {
        while (running.load()) {
            fd_set readSet; FD_ZERO(&readSet); FD_SET(listener, &readSet);
            timeval tv{0, 500000};
            const int ready = select(static_cast<int>(listener + 1), &readSet, nullptr, nullptr, &tv);
            if (ready <= 0 || !FD_ISSET(listener, &readSet)) continue;
            sockaddr_in peerAddr{};
#if defined(_WIN32)
            int peerLen = sizeof(peerAddr);
#else
            socklen_t peerLen = sizeof(peerAddr);
#endif
            socket_t s = accept(listener, reinterpret_cast<sockaddr*>(&peerAddr), &peerLen);
            if (s != invalid_socket) addPeer(s);
        }
    }

    void discoveryBroadcastLoop(const std::string room) {
        socket_t udp = socket(AF_INET, SOCK_DGRAM, 0);
        if (udp == invalid_socket) return;
        int ttl = 1;
#if defined(_WIN32)
        setsockopt(udp, IPPROTO_IP, IP_MULTICAST_TTL, reinterpret_cast<const char*>(&ttl), sizeof(ttl));
#else
        setsockopt(udp, IPPROTO_IP, IP_MULTICAST_TTL, &ttl, sizeof(ttl));
#endif
        sockaddr_in dst{}; dst.sin_family = AF_INET; dst.sin_port = htons(kDefaultDiscoveryPort);
        inet_pton(AF_INET, kDiscoveryGroup, &dst.sin_addr);
        std::ostringstream payload;
        payload << "SONICSYNC/10|" << room << "|" << port;
        const std::string packet = payload.str();
        while (running.load()) {
#if defined(_WIN32)
            ::sendto(udp, packet.data(), static_cast<int>(packet.size()), 0, reinterpret_cast<sockaddr*>(&dst), sizeof(dst));
#else
            ::sendto(udp, packet.data(), packet.size(), 0, reinterpret_cast<sockaddr*>(&dst), sizeof(dst));
#endif
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
        }
        closeSocket(udp);
    }

    void discoveryLoop(const std::string room, uint16_t discoveryPort) {
        discovery = socket(AF_INET, SOCK_DGRAM, 0);
        if (discovery == invalid_socket || !setReuse(discovery)) return;
        sockaddr_in bindAddr{}; bindAddr.sin_family = AF_INET; bindAddr.sin_addr.s_addr = htonl(INADDR_ANY); bindAddr.sin_port = htons(discoveryPort);
        if (bind(discovery, reinterpret_cast<sockaddr*>(&bindAddr), sizeof(bindAddr)) < 0) { closeSocket(discovery); discovery = invalid_socket; return; }
        ip_mreq mreq{}; inet_pton(AF_INET, kDiscoveryGroup, &mreq.imr_multiaddr); mreq.imr_interface.s_addr = htonl(INADDR_ANY);
#if defined(_WIN32)
        setsockopt(discovery, IPPROTO_IP, IP_ADD_MEMBERSHIP, reinterpret_cast<const char*>(&mreq), sizeof(mreq));
#else
        setsockopt(discovery, IPPROTO_IP, IP_ADD_MEMBERSHIP, &mreq, sizeof(mreq));
#endif
        char packet[kMaxDiscoveryPacket];
        while (running.load() && !isConnected.load()) {
            fd_set readSet; FD_ZERO(&readSet); FD_SET(discovery, &readSet); timeval tv{0, 500000};
            if (select(static_cast<int>(discovery + 1), &readSet, nullptr, nullptr, &tv) <= 0) continue;
            sockaddr_in source{};
#if defined(_WIN32)
            int sourceLen = sizeof(source); const int n = recvfrom(discovery, packet, sizeof(packet)-1, 0, reinterpret_cast<sockaddr*>(&source), &sourceLen);
#else
            socklen_t sourceLen = sizeof(source); const ssize_t n = recvfrom(discovery, packet, sizeof(packet)-1, 0, reinterpret_cast<sockaddr*>(&source), &sourceLen);
#endif
            if (n <= 0) continue;
            packet[n] = 0;
            std::stringstream ss(packet);
            std::string magic, foundRoom, portText; std::getline(ss, magic, '|'); std::getline(ss, foundRoom, '|'); std::getline(ss, portText, '|');
            if (magic != "SONICSYNC/10" || foundRoom != room) continue;
            int foundPort = 0;
            try { foundPort = std::stoi(portText); } catch (...) { continue; }
            if (foundPort < 1 || foundPort > 65535) continue;
            socket_t s = socket(AF_INET, SOCK_STREAM, 0); if (s == invalid_socket) continue;
            source.sin_port = htons(static_cast<uint16_t>(foundPort));
            if (connect(s, reinterpret_cast<sockaddr*>(&source), sizeof(source)) == 0) addPeer(s); else closeSocket(s);
        }
        closeSocket(discovery); discovery = invalid_socket;
    }
};

LocalTransport::LocalTransport(MessageHandler handler) : impl_(new Impl(std::move(handler))) {
#if defined(_WIN32)
    WSADATA wsa{};
    WSAStartup(MAKEWORD(2,2), &wsa);
#endif
}

LocalTransport::~LocalTransport() { stop(); delete impl_; }

bool LocalTransport::startHost(const std::string& room, uint16_t tcpPort) {
    if (!impl_ || impl_->running.exchange(true)) return false;
    impl_->listener = socket(AF_INET, SOCK_STREAM, 0);
    if (impl_->listener == invalid_socket) { impl_->running.store(false); return false; }
    setReuse(impl_->listener);
    sockaddr_in addr{}; addr.sin_family = AF_INET; addr.sin_addr.s_addr = htonl(INADDR_ANY); addr.sin_port = htons(tcpPort);
    if (bind(impl_->listener, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0 || listen(impl_->listener, 16) < 0) {
        closeSocket(impl_->listener); impl_->listener = invalid_socket; impl_->running.store(false); return false;
    }
    impl_->port = tcpPort;
    impl_->acceptThread = std::thread([this] { impl_->acceptLoop(); });
    impl_->discoveryThread = std::thread([this, room] { impl_->discoveryBroadcastLoop(room); });
    return true;
}

bool LocalTransport::discoverAndConnect(const std::string& room, uint16_t discoveryPort) {
    if (!impl_ || impl_->running.exchange(true)) return false;
    impl_->discoveryThread = std::thread([this, room, discoveryPort] { impl_->discoveryLoop(room, discoveryPort); });
    return true;
}

void LocalTransport::send(const std::string& message) {
    if (!impl_ || message.size() > kMaxMessageBytes || !impl_->running.load()) return;
    const std::string framed = message + "\n";
    std::lock_guard<std::mutex> sendLock(impl_->sendMutex);
    std::lock_guard<std::mutex> peersLock(impl_->socketsMutex);
    for (auto it = impl_->peers.begin(); it != impl_->peers.end();) {
        if (sendAll(*it, framed.data(), framed.size())) { ++it; continue; }
        closeSocket(*it); it = impl_->peers.erase(it);
    }
    impl_->isConnected.store(!impl_->peers.empty());
}

void LocalTransport::stop() {
    if (!impl_ || !impl_->running.exchange(false)) return;
    closeSocket(impl_->listener); impl_->listener = invalid_socket;
    closeSocket(impl_->discovery); impl_->discovery = invalid_socket;
    {
        std::lock_guard<std::mutex> lock(impl_->socketsMutex);
        for (auto s : impl_->peers) closeSocket(s);
        impl_->peers.clear(); impl_->isConnected.store(false);
    }
    if (impl_->acceptThread.joinable()) impl_->acceptThread.join();
    if (impl_->discoveryThread.joinable()) impl_->discoveryThread.join();
    for (auto& worker : impl_->workers) if (worker.joinable()) worker.join();
    impl_->workers.clear();
#if defined(_WIN32)
    WSACleanup();
#endif
}

bool LocalTransport::connected() const { return impl_ && impl_->isConnected.load(); }
uint16_t LocalTransport::tcpPort() const { return impl_ ? impl_->port : 0; }
