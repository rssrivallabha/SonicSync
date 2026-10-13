# SonicSync Hardware BOM — India Prototype Baseline

Prices are indicative October 2026 observations and will move with stock, tax, shipping and seller. Validate exact variant, final tax/shipping and availability for the destination pincode before purchase.

| # | Part / exact model | Alt / substitute | Qty | Indicative India price | Interfaces / power | Availability basis | Why | Class |
|---|---|---|---:|---:|---|---|---|---|
| 1 | Espressif ESP32-S3-DevKitC-1-N8R8 | ESP32-S3-DevKitC-1U-N8R8 | 1 | ₹1,397–₹1,433 | Wi-Fi 2.4 GHz, BLE, I2S, GPIO, 3.3 V | DigiKey/Mouser India listings observed | MCU timing-reference node + hardware I/O | Prototype |
| 2 | MAX98357A I2S mono Class-D module | PCM5102A + TPA3116D2 bench chain | 1 | ~₹190–₹700 | I2S in, 2.5–5.5 V, speaker output | Indian electronics listings observed | Lowest-complexity digital audio output | Prototype |
| 3 | PCM5102A I2S DAC module | ES9023-class I2S DAC | 1 | ~₹449 | I2S in, line output | Indian electronics listings observed | Cleaner electrical measurement/reference path | Prototype / measurement |
| 4 | TPA3116D2 amplifier board | MAX98357A for low-power build | 1 | ~₹584–₹649 | Analog in, 12–24 V | Indian electronics listings observed | Higher-power alternate node for SPL/range tests | Prototype |
| 5 | Raspberry Pi Zero 2 W SC0510 | Raspberry Pi Zero 2 W WH | 1 | ~₹1,639 | Wi-Fi, BLE, USB, Linux | India distributor listing observed | Full-format reference SoC/codec path | Reference |
| 6 | QBM 2 inch 4 Ω 3 W full-range speaker | 1.5 inch 4 Ω 3 W embedded speaker | 1 | ~₹88–₹499 | 4 Ω, 3 W | Current India marketplace/listing results observed | First acoustic reference driver | Prototype |
| 7 | 8 Ω 5 W full-range speaker | 4 Ω 3 W reference driver | 1 | ~₹300–₹700 budget | 8 Ω, 5 W | Vendor-selected; verify stock | Alternate acoustic load | Prototype |
| 8 | 12 V 3 A DC adapter / 36 W regulated supply | 12 V 35 W regulated supply | 1 | ~₹279–₹850 | 12 V DC, 3 A | Current India marketplace/listing results observed | TPA3116D2 bench supply | Prototype |
| 9 | LM2596S buck module | MP1584 buck module | 1 | ₹41–₹49 | 4–40 V in, adjustable out | Indian module listings observed | Digital-rail regulation where required | Prototype |
| 10 | ADS1115 16-bit ADC breakout | ADS1015 | 1 | ~₹125–₹599 | I2C, 4 channels | Indian module listings observed | Auxiliary power/analog measurement | Measurement |
| 11 | 2×18650 holder | 2×18650 protected holder with switch | 1 | ~₹89 | Battery mechanical | Indian module listings observed | Removable battery experiments | Prototype |
| 12 | Matched protected 18650 cells | Li-ion pack with protection/BMS | 2 | ₹250–₹500 each budget | 3.6–4.2 V nominal | Source only from known cell vendor | Portable-node power experiments | Prototype |
| 13 | 32 GB microSD UHS-I | 64 GB microSD UHS-I | 1 | ~₹350–₹600 | SPI/SDMMC | Vendor-selected; verify genuine media | Local media cache for SoC reference | Prototype |
| 14 | 100 nF + 10 µF + 470 µF low-ESR capacitor set | 220 µF + 10 µF low-ESR set | set | ~₹100 | Power decoupling | Common electronics supply | Suppress digital/audio rail transients | Prototype |
| 15 | Oscilloscope ≥100 MHz + logic analyzer ≥24 MHz | Higher-bandwidth mixed-signal scope | 1 each | Lab equipment | GPIO/audio probing | Lab inventory or rental | Objective timing proof | Measurement |
| 16 | Electret/USB measurement microphone + stand | Calibrated measurement microphone | 1 | ~₹1,000–₹3,000 | Analog/USB | Vendor-selected; calibration certificate preferred | Acoustic calibration and node-skew measurement | Measurement |

## Recommended first purchase set

For the first physical proof, use one ESP32-S3-DevKitC-1-N8R8, one MAX98357A module, one 4 Ω speaker, one stable 5 V/USB supply for the ESP32, one logic analyzer or scope, and the GPIO fixture. Add the PCM5102A/TPA3116D2 chain only when separating DAC latency from amplifier/transducer latency is useful.

## Sourcing evidence

Current October 2026 web observations include the exact ESP32-S3-DevKitC-1-N8R8 on DigiKey India around ₹1,433 and on Mouser India around ₹1,398. Current marketplace results also show low-cost 4 Ω / 3 W speakers and 12 V / 3 A supplies in the ranges above. Treat these as sourcing observations rather than purchase guarantees.
