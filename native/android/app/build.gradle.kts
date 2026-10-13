plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.sonicsync.nativeapp"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.sonicsync.nativeapp"
        minSdk = 27
        targetSdk = 36
        versionCode = 100
        versionName = "10.0.2"

        externalNativeBuild {
            cmake { cppFlags += "-std=c++17" }
        }
    }

    buildFeatures { buildConfig = true }
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt") } }
}

dependencies {
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("com.google.android.gms:play-services-nearby:19.5.1")
    implementation("com.google.oboe:oboe:1.11.0")
}
