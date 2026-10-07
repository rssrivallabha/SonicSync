#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <driver/i2s_std.h>
#include <esp_timer.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>

#include "config.h"

namespace {

constexpr uint8_t PACKET_TYPE_PCM = 1;
constexpr uint8_t PACKET_TYPE_COMMAND = 2;

constexpr uint16_t COMMAND_PLAY = 1;
constexpr uint16_t COMMAND_STOP = 2;
constexpr uint16_t COMMAND_VOLUME = 3;
constexpr uint16_t COMMAND_MUTE = 4;
constexpr uint16_t COMMAND_TEST_CLICK = 5;

struct __attribute__((packed)) PacketHeader {
    uint16_t magic;
    uint8_t version;
    uint8_t type;
    uint32_t sequence;
    uint32_t sampleRate;
    uint16_t channels;
    uint16_t frames;
    uint64_t targetMicros;
    uint16_t command;
    uint16_t commandValue;
};

static_assert(sizeof(PacketHeader) == 32, "packet header layout changed");

class PcmRing {
public:
    bool begin(size_t capacityFrames) {
        capacityFrames_ = capacityFrames;
        bytes_ = static_cast<int16_t *>(
            ps_malloc(capacityFrames * SONICSYNC_CHANNELS * sizeof(int16_t)));
        return bytes_ != nullptr;
    }

    size_t availableFrames() const {
        portENTER_CRITICAL(&mux_);
        const size_t result = availableFrames_;
        portEXIT_CRITICAL(&mux_);
        return result;
    }

    size_t push(const int16_t *samples, size_t frames) {
        if (!bytes_ || !samples || frames == 0) return 0;

        portENTER_CRITICAL(&mux_);
        const size_t writable =
            std::min(frames, capacityFrames_ - availableFrames_);

        for (size_t frame = 0; frame < writable; ++frame) {
            const size_t index =
                ((writeFrame_ + frame) % capacityFrames_) *
                SONICSYNC_CHANNELS;

            bytes_[index] = samples[frame * SONICSYNC_CHANNELS];
            bytes_[index + 1] = samples[frame * SONICSYNC_CHANNELS + 1];
        }

        writeFrame_ = (writeFrame_ + writable) % capacityFrames_;
        availableFrames_ += writable;

        portEXIT_CRITICAL(&mux_);
        return writable;
    }

    size_t pop(int16_t *samples, size_t frames) {
        if (!bytes_ || !samples || frames == 0) return 0;

        portENTER_CRITICAL(&mux_);
        const size_t readable = std::min(frames, availableFrames_);

        for (size_t frame = 0; frame < readable; ++frame) {
            const size_t index =
                ((readFrame_ + frame) % capacityFrames_) *
                SONICSYNC_CHANNELS;

            samples[frame * SONICSYNC_CHANNELS] = bytes_[index];
            samples[frame * SONICSYNC_CHANNELS + 1] = bytes_[index + 1];
        }

        readFrame_ = (readFrame_ + readable) % capacityFrames_;
        availableFrames_ -= readable;

        portEXIT_CRITICAL(&mux_);
        return readable;
    }

    void clear() {
        portENTER_CRITICAL(&mux_);
        readFrame_ = 0;
        writeFrame_ = 0;
        availableFrames_ = 0;
        portEXIT_CRITICAL(&mux_);
    }

private:
    int16_t *bytes_{nullptr};
    size_t capacityFrames_{0};
    size_t readFrame_{0};
    size_t writeFrame_{0};
    size_t availableFrames_{0};
    mutable portMUX_TYPE mux_ = portMUX_INITIALIZER_UNLOCKED;
};

WiFiUDP udp;
PcmRing pcmRing;

i2s_chan_handle_t txHandle = nullptr;
TaskHandle_t audioTaskHandle = nullptr;

std::atomic<uint64_t> scheduledStartMicros{0};
std::atomic<bool> scheduledPlayback{false};
std::atomic<bool> testClick{false};
std::atomic<bool> muted{false};
std::atomic<uint8_t> volumePercent{100};

std::atomic<uint32_t> receivedPackets{0};
std::atomic<uint32_t> droppedPackets{0};
std::atomic<uint32_t> underruns{0};

int16_t dmaBuffer[1024 * SONICSYNC_CHANNELS];

void marker(bool high) {
    digitalWrite(SONICSYNC_SYNC_GPIO, high ? HIGH : LOW);
}

void configureI2S() {
    i2s_chan_config_t channelConfig =
        I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);

    channelConfig.dma_desc_num = 8;
    channelConfig.dma_frame_num = 256;

    ESP_ERROR_CHECK(i2s_new_channel(&channelConfig, &txHandle, nullptr));

    i2s_std_config_t config = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(SONICSYNC_SAMPLE_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(
            I2S_DATA_BIT_WIDTH_16BIT,
            I2S_SLOT_MODE_STEREO),
        .gpio_cfg = {
            .mclk = I2S_GPIO_UNUSED,
            .bclk = GPIO_NUM_5,
            .ws = GPIO_NUM_6,
            .dout = GPIO_NUM_7,
            .din = I2S_GPIO_UNUSED,
            .invert_flags = {
                .mclk_inv = false,
                .bclk_inv = false,
                .ws_inv = false
            }
        }
    };

    ESP_ERROR_CHECK(i2s_channel_init_std_mode(txHandle, &config));
    ESP_ERROR_CHECK(i2s_channel_enable(txHandle));
}

void applyVolume(int16_t *samples, size_t frames) {
    const float gain =
        muted.load(std::memory_order_relaxed)
            ? 0.0f
            : static_cast<float>(volumePercent.load(
                  std::memory_order_relaxed)) / 100.0f;

    for (size_t i = 0; i < frames * SONICSYNC_CHANNELS; ++i) {
        samples[i] = static_cast<int16_t>(
            static_cast<float>(samples[i]) * gain);
    }
}

void fillClick(int16_t *samples, size_t frames, uint64_t nowMicros) {
    const uint64_t start = scheduledStartMicros.load(
        std::memory_order_acquire);

    if (!testClick.load(std::memory_order_acquire) || start == 0) {
        memset(
            samples,
            0,
            frames * SONICSYNC_CHANNELS * sizeof(int16_t));
        return;
    }

    bool clickStarted = false;

    for (size_t frame = 0; frame < frames; ++frame) {
        const uint64_t frameTime =
            nowMicros +
            (frame * 1000000ULL) / SONICSYNC_SAMPLE_RATE;

        double t = static_cast<double>(
            frameTime >= start ? frameTime - start : 0) / 1000000.0;

        float sample = 0.0f;

        if (frameTime >= start && t < 0.008) {
            const double envelope = 1.0 - (t / 0.008);

            sample = static_cast<float>(
                0.8 * envelope *
                std::sin(
                    2.0 *
                    3.14159265358979323846 *
                    1000.0 *
                    t));

            clickStarted = true;
        }

        samples[frame * 2] = static_cast<int16_t>(sample * 32767.0f);
        samples[frame * 2 + 1] =
            samples[frame * 2];
    }

    if (clickStarted) {
        marker(true);
    }

    if (nowMicros >= start + 10000) {
        marker(false);
        testClick.store(false, std::memory_order_release);
        scheduledPlayback.store(false, std::memory_order_release);
    }

    applyVolume(samples, frames);
}

void writeSilence() {
    memset(dmaBuffer, 0, sizeof(dmaBuffer));

    size_t written = 0;
    i2s_channel_write(
        txHandle,
        dmaBuffer,
        sizeof(dmaBuffer),
        &written,
        pdMS_TO_TICKS(20));
}

void audioTask(void *) {
    while (true) {
        const uint64_t nowMicros =
            static_cast<uint64_t>(esp_timer_get_time());
        const uint64_t target =
            scheduledStartMicros.load(std::memory_order_acquire);
        const bool scheduled =
            scheduledPlayback.load(std::memory_order_acquire);

        if (!scheduled) {
            const size_t frames = pcmRing.pop(dmaBuffer, 512);

            if (frames == 0) {
                writeSilence();
                underruns.fetch_add(1, std::memory_order_relaxed);
            } else {
                applyVolume(dmaBuffer, frames);

                size_t written = 0;
                const size_t bytes =
                    frames * SONICSYNC_CHANNELS * sizeof(int16_t);

                i2s_channel_write(
                    txHandle,
                    dmaBuffer,
                    bytes,
                    &written,
                    pdMS_TO_TICKS(20));

                if (written < bytes) {
                    underruns.fetch_add(1, std::memory_order_relaxed);
                }
            }

            continue;
        }

        if (target > nowMicros) {
            writeSilence();
            continue;
        }

        if (testClick.load(std::memory_order_acquire)) {
            fillClick(dmaBuffer, 512, nowMicros);

            size_t written = 0;
            i2s_channel_write(
                txHandle,
                dmaBuffer,
                sizeof(dmaBuffer),
                &written,
                pdMS_TO_TICKS(20));

            continue;
        }

        marker(true);

        const size_t frames = pcmRing.pop(dmaBuffer, 512);

        if (frames == 0) {
            memset(dmaBuffer, 0, sizeof(dmaBuffer));
            underruns.fetch_add(1, std::memory_order_relaxed);
            writeSilence();
        } else {
            marker(false);
            applyVolume(dmaBuffer, frames);

            size_t written = 0;
            const size_t bytes =
                frames * SONICSYNC_CHANNELS * sizeof(int16_t);

            i2s_channel_write(
                txHandle,
                dmaBuffer,
                bytes,
                &written,
                pdMS_TO_TICKS(20));

            if (written < bytes) {
                underruns.fetch_add(1, std::memory_order_relaxed);
            }
        }
    }
}

void handleCommand(const PacketHeader &header) {
    switch (header.command) {
        case COMMAND_PLAY:
            scheduledStartMicros.store(
                header.targetMicros,
                std::memory_order_release);
            testClick.store(false, std::memory_order_release);
            scheduledPlayback.store(true, std::memory_order_release);
            break;

        case COMMAND_STOP:
            scheduledPlayback.store(false, std::memory_order_release);
            testClick.store(false, std::memory_order_release);
            scheduledStartMicros.store(0, std::memory_order_release);
            pcmRing.clear();
            marker(false);
            break;

        case COMMAND_VOLUME:
            volumePercent.store(
                static_cast<uint8_t>(
                    std::min<uint16_t>(100, header.commandValue)),
                std::memory_order_release);
            break;

        case COMMAND_MUTE:
            muted.store(
                header.commandValue != 0,
                std::memory_order_release);
            break;

        case COMMAND_TEST_CLICK:
            scheduledStartMicros.store(
                header.targetMicros,
                std::memory_order_release);
            testClick.store(true, std::memory_order_release);
            scheduledPlayback.store(true, std::memory_order_release);
            break;

        default:
            break;
    }
}

void receivePacket() {
    const int packetSize = udp.parsePacket();
    if (packetSize <= 0) return;

    if (packetSize < static_cast<int>(sizeof(PacketHeader))) {
        droppedPackets.fetch_add(1, std::memory_order_relaxed);
        udp.flush();
        return;
    }

    PacketHeader header{};
    udp.read(
        reinterpret_cast<uint8_t *>(&header),
        sizeof(header));

    if (header.magic != SONICSYNC_PACKET_MAGIC ||
        header.version != SONICSYNC_PACKET_VERSION ||
        header.sampleRate != SONICSYNC_SAMPLE_RATE ||
        header.channels != SONICSYNC_CHANNELS) {
        droppedPackets.fetch_add(1, std::memory_order_relaxed);
        udp.flush();
        return;
    }

    receivedPackets.fetch_add(1, std::memory_order_relaxed);

    if (header.type == PACKET_TYPE_COMMAND) {
        handleCommand(header);
        udp.flush();
        return;
    }

    if (header.type != PACKET_TYPE_PCM ||
        header.frames == 0 ||
        header.frames > 1024) {
        droppedPackets.fetch_add(1, std::memory_order_relaxed);
        udp.flush();
        return;
    }

    const size_t payloadBytes =
        static_cast<size_t>(header.frames) *
        SONICSYNC_CHANNELS *
        sizeof(int16_t);

    if (udp.available() < static_cast<int>(payloadBytes)) {
        droppedPackets.fetch_add(1, std::memory_order_relaxed);
        udp.flush();
        return;
    }

    static int16_t packetBuffer[1024 * SONICSYNC_CHANNELS];

    const int readBytes = udp.read(
        reinterpret_cast<uint8_t *>(packetBuffer),
        payloadBytes);

    if (readBytes != static_cast<int>(payloadBytes)) {
        droppedPackets.fetch_add(1, std::memory_order_relaxed);
        return;
    }

    if (header.targetMicros != 0 &&
        !scheduledPlayback.load(std::memory_order_acquire)) {
        scheduledStartMicros.store(
            header.targetMicros,
            std::memory_order_release);
        scheduledPlayback.store(true, std::memory_order_release);
    }

    if (pcmRing.push(packetBuffer, header.frames) != header.frames) {
        droppedPackets.fetch_add(1, std::memory_order_relaxed);
    }
}

void connectWiFi() {
    if (strcmp(SONICSYNC_WIFI_SSID, "CHANGE_ME") == 0) {
        Serial.println(
            "Set SONICSYNC_WIFI_SSID/PASSWORD before flashing.");
        return;
    }

    WiFi.mode(WIFI_STA);
    WiFi.begin(
        SONICSYNC_WIFI_SSID,
        SONICSYNC_WIFI_PASSWORD);

    const uint32_t start = millis();

    while (WiFi.status() != WL_CONNECTED &&
           millis() - start < 15000) {
        delay(250);
        Serial.print(".");
    }

    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
        Serial.print("WiFi IP: ");
        Serial.println(WiFi.localIP());
        udp.begin(SONICSYNC_UDP_PORT);
    }
}

void reconnectWiFi() {
    static uint32_t nextAttempt = 0;

    if (millis() < nextAttempt) return;
    nextAttempt = millis() + 3000;

    if (WiFi.status() == WL_CONNECTED) return;

    WiFi.disconnect();
    WiFi.begin(
        SONICSYNC_WIFI_SSID,
        SONICSYNC_WIFI_PASSWORD);
}

}  // namespace

void setup() {
    pinMode(SONICSYNC_SYNC_GPIO, OUTPUT);
    pinMode(SONICSYNC_STATUS_GPIO, OUTPUT);

    marker(false);
    digitalWrite(SONICSYNC_STATUS_GPIO, LOW);

    Serial.begin(115200);
    delay(100);

    Serial.println();
    Serial.println("SonicSync ESP32-S3 node starting");

    if (!pcmRing.begin(SONICSYNC_BUFFER_FRAMES)) {
        Serial.println(
            "FATAL: PSRAM allocation for audio buffer failed.");
        while (true) delay(1000);
    }

    configureI2S();
    connectWiFi();

    xTaskCreatePinnedToCore(
        audioTask,
        "sonicsync-audio",
        8192,
        nullptr,
        configMAX_PRIORITIES - 2,
        &audioTaskHandle,
        1);

    Serial.println("Node ready");
}

void loop() {
    receivePacket();
    reconnectWiFi();

    digitalWrite(
        SONICSYNC_STATUS_GPIO,
        WiFi.status() == WL_CONNECTED ? HIGH : LOW);

    static uint32_t lastStatus = 0;

    if (millis() - lastStatus >= 1000) {
        lastStatus = millis();

        Serial.printf(
            "wifi=%d rssi=%d buffer=%u packets=%u drops=%u underruns=%u mute=%d volume=%u\n",
            WiFi.status() == WL_CONNECTED,
            WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : -127,
            static_cast<unsigned>(pcmRing.availableFrames()),
            static_cast<unsigned>(receivedPackets.load()),
            static_cast<unsigned>(droppedPackets.load()),
            static_cast<unsigned>(underruns.load()),
            muted.load(),
            volumePercent.load());
    }
}
