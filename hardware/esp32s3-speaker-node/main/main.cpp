#include <stdio.h>
#include <string.h>
#include <math.h>
#include <sys/socket.h>
#include <netdb.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "driver/i2s_std.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "nvs_flash.h"
#include "esp_spiffs.h"
#include "cJSON.h"
#include "mbedtls/md.h"
#include "esp_system.h"

static const char* TAG = "SonicSyncNode";
static constexpr int AUDIO_RATE = 48000;
static constexpr gpio_num_t I2S_BCLK = GPIO_NUM_4;
static constexpr gpio_num_t I2S_WS = GPIO_NUM_5;
static constexpr gpio_num_t I2S_DOUT = GPIO_NUM_6;
static constexpr gpio_num_t MEASURE_GPIO = GPIO_NUM_7;
static constexpr uint16_t CONTROL_PORT = 8788;

static i2s_chan_handle_t tx = nullptr;
static volatile int64_t scheduledStartUs = -1;
static volatile uint64_t sampleEpoch = 0;
static volatile uint64_t lastNonce = 0;
static volatile bool playing = false;
static volatile int64_t hostToLocalOffsetUs = 0;
static volatile bool clickArmed = false;
static char mediaPath[96] = "/spiffs/test.wav";
static float phase = 0.0f;

static void wifi_init_sta() {
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_wifi_init(&cfg);
    esp_wifi_set_mode(WIFI_MODE_STA);
    wifi_config_t wifi_config{};
    strlcpy((char*)wifi_config.sta.ssid, CONFIG_SONICSYNC_WIFI_SSID, sizeof(wifi_config.sta.ssid));
    strlcpy((char*)wifi_config.sta.password, CONFIG_SONICSYNC_WIFI_PASSWORD, sizeof(wifi_config.sta.password));
    if (CONFIG_SONICSYNC_WIFI_SSID[0] != 0) {
        ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
        ESP_ERROR_CHECK(esp_wifi_start());
        ESP_ERROR_CHECK(esp_wifi_connect());
        ESP_LOGI(TAG, "Wi-Fi station started");
    } else {
        ESP_ERROR_CHECK(esp_wifi_stop());
        ESP_LOGW(TAG, "No SSID configured; use idf.py menuconfig to provision a trusted local LAN");
    }
}

static void audio_init() {
    i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_AUTO, I2S_ROLE_MASTER);
    chan_cfg.dma_desc_num = 8; chan_cfg.dma_frame_num = 240;
    ESP_ERROR_CHECK(i2s_new_channel(&chan_cfg, &tx, nullptr));
    i2s_std_config_t cfg = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(AUDIO_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
        .gpio_cfg = { .mclk = I2S_GPIO_UNUSED, .bclk = I2S_BCLK, .ws = I2S_WS, .dout = I2S_DOUT, .din = I2S_GPIO_UNUSED, .invert_flags = {0,0,0} }
    };
    ESP_ERROR_CHECK(i2s_channel_init_std_mode(tx, &cfg));
    ESP_ERROR_CHECK(i2s_channel_enable(tx));
}

static void measurement_init() {
    gpio_config_t c{}; c.pin_bit_mask = 1ULL << MEASURE_GPIO; c.mode = GPIO_MODE_OUTPUT; c.pull_down_en = GPIO_PULLDOWN_DISABLE; c.pull_up_en = GPIO_PULLUP_DISABLE; c.intr_type = GPIO_INTR_DISABLE;
    gpio_config(&c); gpio_set_level(MEASURE_GPIO, 0);
}

static bool authenticate(cJSON* root) {
    const cJSON* auth=cJSON_GetObjectItem(root,"auth"); const cJSON* nonce=cJSON_GetObjectItem(root,"nonce"); const char* psk=CONFIG_SONICSYNC_PSK;
    if(!psk[0] || !cJSON_IsString(auth) || !cJSON_IsNumber(nonce)) return psk[0] ? false : true;
    const uint64_t n=(uint64_t)nonce->valuedouble; if(n<=lastNonce) return false;
    char canonical[512];
    const cJSON* type=cJSON_GetObjectItem(root,"type"); const cJSON* at=cJSON_GetObjectItem(root,"hostTimeUs"); const cJSON* pos=cJSON_GetObjectItem(root,"positionFrames"); const cJSON* off=cJSON_GetObjectItem(root,"clockOffsetUs");
    snprintf(canonical,sizeof(canonical),"%s|%lld|%llu|%lld|%llu", type&&cJSON_IsString(type)?type->valuestring:"", at&&cJSON_IsNumber(at)?(long long)at->valuedouble:0LL, pos&&cJSON_IsNumber(pos)?(unsigned long long)pos->valuedouble:0ULL, off&&cJSON_IsNumber(off)?(long long)off->valuedouble:0LL,(unsigned long long)n);
    unsigned char digest[32]; mbedtls_md_context_t ctx; const mbedtls_md_info_t* info=mbedtls_md_info_from_type(MBEDTLS_MD_SHA256); mbedtls_md_init(&ctx); bool ok=info && mbedtls_md_setup(&ctx,info,1)==0 && mbedtls_md_hmac_starts(&ctx,(const unsigned char*)psk,strlen(psk))==0 && mbedtls_md_hmac_update(&ctx,(const unsigned char*)canonical,strlen(canonical))==0 && mbedtls_md_hmac_finish(&ctx,digest)==0; mbedtls_md_free(&ctx); if(!ok) return false;
    char hex[65]; for(int i=0;i<32;i++) snprintf(hex+i*2,3,"%02x",digest[i]); hex[64]=0; if(strncmp(hex,auth->valuestring,64)!=0) return false; lastNonce=n; return true;
}

static void apply_control(const char* body) {
    cJSON* root=cJSON_Parse(body); if(!root) return; if(!authenticate(root)){ESP_LOGW(TAG,"Rejected unauthenticated/stale control packet");cJSON_Delete(root);return;}
    const cJSON* type=cJSON_GetObjectItem(root,"type");
    if(cJSON_IsString(type)&&strcmp(type->valuestring,"startAt")==0){
        const cJSON* at=cJSON_GetObjectItem(root,"hostTimeUs"); const cJSON* pos=cJSON_GetObjectItem(root,"positionFrames"); const cJSON* off=cJSON_GetObjectItem(root,"clockOffsetUs");
        if(cJSON_IsNumber(at))scheduledStartUs=(int64_t)at->valuedouble; if(cJSON_IsNumber(off))hostToLocalOffsetUs=(int64_t)off->valuedouble; if(cJSON_IsNumber(pos))sampleEpoch=(uint64_t)pos->valuedouble;
        scheduledStartUs-=hostToLocalOffsetUs; playing=true; clickArmed=true; phase=0.0f; ESP_LOGI(TAG,"Scheduled start localUs=%lld",(long long)scheduledStartUs);
    } else if(cJSON_IsString(type)&&strcmp(type->valuestring,"stop")==0){playing=false;clickArmed=false;scheduledStartUs=-1;sampleEpoch=0;}
    cJSON_Delete(root);
}

static void control_task(void*) {
    int fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    sockaddr_in addr{}; addr.sin_family=AF_INET; addr.sin_addr.s_addr=htonl(INADDR_ANY); addr.sin_port=htons(CONTROL_PORT);
    bind(fd, (sockaddr*)&addr, sizeof(addr));
    char buf[2048];
    while (true) {
        int n = recvfrom(fd, buf, sizeof(buf)-1, 0, nullptr, nullptr);
        if (n > 0) { buf[n] = 0; apply_control(buf); }
    }
}

struct WavFile {
    FILE* f = nullptr; uint32_t sampleRate=0; uint16_t channels=0; uint16_t bits=0; long dataOffset=0; uint32_t dataBytes=0;
    bool open(const char* path) {
        f=fopen(path,"rb"); if(!f) return false;
        char riff[4], wave[4]; uint32_t riffSize=0; if(fread(riff,1,4,f)!=4||fread(&riffSize,4,1,f)!=1||fread(wave,1,4,f)!=4||memcmp(riff,"RIFF",4)||memcmp(wave,"WAVE",4)){fclose(f);f=nullptr;return false;}
        while(!feof(f)){
            char id[4]; uint32_t size=0; if(fread(id,1,4,f)!=4||fread(&size,4,1,f)!=1) break;
                long next=ftell(f)+(long)size+((long)size&1L);
            if(!memcmp(id,"fmt ",4) && size>=16){uint16_t fmt=0; fread(&fmt,2,1,f); fread(&channels,2,1,f); fread(&sampleRate,4,1,f); uint32_t br=0; uint16_t ba=0; fread(&br,4,1,f); fread(&ba,2,1,f); fread(&bits,2,1,f); if(fmt!=1||bits!=16){fclose(f);f=nullptr;return false;} fseek(f,next,SEEK_SET);}
            else if(!memcmp(id,"data",4)){dataOffset=ftell(f);dataBytes=size;fseek(f,next,SEEK_SET);} else fseek(f,next,SEEK_SET);
        }
        if(!f || !dataOffset || channels<1 || channels>2 || bits!=16 || sampleRate!=AUDIO_RATE || dataBytes==0){if(f)fclose(f);f=nullptr;return false;}
        fseek(f,dataOffset,SEEK_SET); return true;
    }
    void close(){if(f){fclose(f);f=nullptr;}}
};

static void audio_task(void*) {
    constexpr int FRAMES=240; int16_t pcm[FRAMES*2]; WavFile wav; bool tried=false;
    while(true){
        int64_t nowUs=esp_timer_get_time(); bool active=playing && scheduledStartUs>=0 && nowUs>=scheduledStartUs;
        if(active && !tried){ tried=true; if(!wav.open(mediaPath)) ESP_LOGW(TAG,"No compatible WAV at %s; using 440 Hz timing tone",mediaPath); }
        if(!playing){tried=false; wav.close(); memset(pcm,0,sizeof(pcm));}
        size_t framesOut=FRAMES;
        if(active && wav.f){
            const size_t bytesPerFrame=wav.channels*2; size_t got=fread((uint8_t*)pcm,1,FRAMES*bytesPerFrame,wav.f); framesOut=got/bytesPerFrame;
            if(wav.channels==1) for(size_t i=framesOut;i>0;i--) {int16_t s=pcm[i-1];pcm[2*(i-1)]=s;pcm[2*(i-1)+1]=s;}
            for(size_t i=framesOut;i<FRAMES;i++){pcm[2*i]=0;pcm[2*i+1]=0;}
        } else {
            for(int i=0;i<FRAMES;i++){int16_t s=active?(int16_t)(1200.0f*sinf(phase)):0;pcm[i*2]=s;pcm[i*2+1]=s;phase += 2.0f*(float)M_PI*440.0f/AUDIO_RATE;if(phase>2*M_PI)phase-=2*M_PI;if(active&&clickArmed&&i==0){gpio_set_level(MEASURE_GPIO,1);clickArmed=false;}}
        }
        if(active && clickArmed){gpio_set_level(MEASURE_GPIO,1); clickArmed=false;}
        size_t written=0; i2s_channel_write(tx,pcm,sizeof(pcm),&written,portMAX_DELAY);
        if(active){sampleEpoch += written/(sizeof(int16_t)*2);}
        if(active&&wav.f&&framesOut==0){playing=false;wav.close();tried=false;}
    }
}

extern "C" void app_main() {
    ESP_ERROR_CHECK(nvs_flash_init());
    esp_vfs_spiffs_conf_t spiffs{}; spiffs.base_path="/spiffs"; spiffs.partition_label="storage"; spiffs.max_files=4; spiffs.format_if_mount_failed=true;
    ESP_ERROR_CHECK(esp_vfs_spiffs_register(&spiffs));
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();
    wifi_init_sta(); audio_init(); measurement_init();
    xTaskCreatePinnedToCore(control_task, "control", 8192, nullptr, 6, nullptr, 0);
    xTaskCreatePinnedToCore(audio_task, "audio", 4096, nullptr, 24, nullptr, 1);
    ESP_LOGI(TAG, "SonicSync ESP32-S3 speaker node ready; I2S 48 kHz / 16-bit stereo; GPIO7 marks DAC-buffer ingress");
}
