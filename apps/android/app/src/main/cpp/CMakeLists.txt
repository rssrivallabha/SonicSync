cmake_minimum_required(VERSION 3.22.1)

project(sonicsync_audio)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(
    sonicsync_audio
    SHARED
    native_audio.cpp
)

find_package(oboe REQUIRED CONFIG)

target_link_libraries(
    sonicsync_audio
    PRIVATE
    log
    android
    oboe::oboe
)
