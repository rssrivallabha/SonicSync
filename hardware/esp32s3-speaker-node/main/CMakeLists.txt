idf_component_register(SRCS "main.cpp" INCLUDE_DIRS "." REQUIRES driver esp_wifi esp_event nvs_flash lwip json esp_timer spiffs)
spiffs_create_partition_image(storage ../storage FLASH_IN_PROJECT)
