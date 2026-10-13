#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_timer.h"

static constexpr gpio_num_t INPUT_GPIO = GPIO_NUM_7;
static constexpr gpio_num_t OUTPUT_GPIO = GPIO_NUM_8;
static volatile int64_t lastEdgeUs = -1;
static volatile uint32_t edges = 0;

static void IRAM_ATTR edge_isr(void*) {
    lastEdgeUs = esp_timer_get_time();
    edges++;
    gpio_set_level(OUTPUT_GPIO, 1);
}

extern "C" void app_main() {
    gpio_config_t in{}; in.pin_bit_mask=1ULL<<INPUT_GPIO; in.mode=GPIO_MODE_INPUT; in.pull_up_en=GPIO_PULLUP_DISABLE; in.pull_down_en=GPIO_PULLDOWN_DISABLE; in.intr_type=GPIO_INTR_POSEDGE; gpio_config(&in);
    gpio_config_t out{}; out.pin_bit_mask=1ULL<<OUTPUT_GPIO; out.mode=GPIO_MODE_OUTPUT; out.intr_type=GPIO_INTR_DISABLE; gpio_config(&out);
    gpio_set_level(OUTPUT_GPIO, 0);
    gpio_install_isr_service(ESP_INTR_FLAG_IRAM); gpio_isr_handler_add(INPUT_GPIO, edge_isr, nullptr);
    int64_t lastPrinted=-2;
    while (true) {
        if (lastEdgeUs != lastPrinted) { printf("EDGE,%lu,%lld\n", (unsigned long)edges, (long long)lastEdgeUs); lastPrinted=lastEdgeUs; gpio_set_level(OUTPUT_GPIO, 0); }
        vTaskDelay(pdMS_TO_TICKS(2));
    }
}
