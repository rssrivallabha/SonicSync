# SonicSync Hardware BOM

Pricing below is an engineering estimate for India and must be rechecked before purchase. Retail availability varies by vendor and date.

## MVP BOM — fastest physical timing proof

| Component | Exact model | Qty | Est. India price | Purpose |
|---|---|---:|---:|---|
| MCU/Wi-Fi | Espressif ESP32-S3-DevKitC-1-N8R8 | 1 | ₹1,300–1,500 | deterministic node controller |
| Digital Class-D | MAX98357A I²S breakout | 1 | ₹700–800 | I²S-to-speaker output |
| Speaker | PUI Audio AS04004PR-R, 4 Ω, 3 W, 40 mm | 1 | ₹500–800 est. | repeatable test driver |
| Bench PSU | regulated 5 V, ≥2 A USB supply | 1 | ₹250–500 | node power |
| USB cable | data-capable micro-USB/USB cable as required by DevKitC variant | 1 | ₹100–200 | programming/power |
| Breadboard | standard solderless 830-point | 1 | ₹150–250 | prototype wiring |
| Jumper kit | male/male + male/female | 1 | ₹100–200 | interconnect |
| GPIO test header | 1×3 or 1×4 pin header | 1 | ₹10–30 | measurement output |
| Status LED | 3 mm/5 mm LED + 330 Ω resistor | 1 set | ₹5–20 | status |
| Decoupling | 100 µF + 0.1 µF capacitors | 1 set | ₹20–50 | supply stability |
| Speaker cable | 2-conductor | 1 | ₹30–80 | amplifier output |
| Enclosure prototype | laser-cut/acrylic/3D-print | 1 | ₹200–500 | acoustic/mechanical fixture |

**MVP estimate:** approximately **₹3,500–₹5,100**, excluding measurement equipment.

The ESP32-S3-DevKitC-1-N8R8 is currently listed by Robu around ₹1,494 including GST; ElectronicsComp currently lists an N8 board around ₹1,101 before GST but shows it out of stock. urlRobu India ESP32-S3 listinghttps://robu.in/brand/espressif/ urlElectronicsComp ESP32-S3-N8 listinghttps://www.electronicscomp.com/espressif-esp32-s3-devkitc-1-n8-developmnt-board

The MAX98357A breakout is listed by ElectronicsComp at ₹590 before GST and is described as a 3.2 W/4 Ω, 8–96 kHz I²S amplifier. urlElectronicsComp MAX98357A breakouthttps://www.electronicscomp.com/adafruit-max98357a-i2s-3w-class-d-amplifier-breakout-board

The PUI AS04004PR-R is a 40 mm, 4 Ω, nominal 3 W driver rated 100 Hz–20 kHz and 86 dBA SPL; exact live pricing should be confirmed at purchase. urlelement14 India PUI AS04004PR-Rhttps://in.element14.com/pui-audio/as04004pr-r/speaker-100hz-20khz-4ohm-86dba/dp/4412328

## Prototype BOM — controlled comparison node

| Component | Exact model/family | Qty | Est. India price | Role |
|---|---|---:|---:|---|
| SBC | Raspberry Pi Zero 2 W with header | 1 | ₹2,050–2,900 | higher-compute reference node |
| DAC | PCM5102A breakout | 1 | ₹1,000–1,500 | stereo DAC reference |
| Amplifier | TPA3116D2 2-channel module | 1 | ₹300–700 | higher-power analog Class-D |
| Speaker | PUI AS04004PR-R | 1 | ₹500–800 | common driver |
| Storage | 32 GB microSD, A1/U1 | 1 | ₹300–500 | local media/cache |
| Supply | regulated 5 V / 3 A | 1 | ₹300–600 | SBC + DAC |
| GPIO test header | 1×3/1×4 | 1 | ₹10–30 | timing marker |
| Cables/connectors | assorted | 1 set | ₹150–300 | wiring |
| Enclosure | prototype | 1 | ₹250–700 | mechanical fixture |

Robu currently lists Raspberry Pi Zero 2 W with header around ₹2,054 including GST on one current listing; another current category listing shows approximately ₹2,079. The official board uses a 1 GHz quad-core Cortex-A53 and 512 MB RAM. urlRobu Raspberry Pi Zero 2 W listinghttps://robu.in/product-category/raspberry-pi-zero/ urlRaspberry Pi Zero 2 W briefhttps://datasheets.raspberrypi.com/zero/raspberry-pi-zero-2-w-product-brief.pdf

## Clock experiment BOM

| Component | Exact part | Qty | Estimated India price | Note |
|---|---|---:|---:|---|
| TCXO | ECS-TXO-3225MV-245.7-TR | 1–3 | ~₹205 each | 24.576 MHz, 2.5 ppm, 3.6 V |
| Alternative TCXO | ABRACON ASTX-H11-24.576MHZ-T | 1–3 | ~₹288 at reel pricing | 24.576 MHz, 2.5 ppm, 3.3 V |
| Clock buffer | TBD after audio-interface selection | 1 | ₹100–500 | do not select until clock topology is frozen |
| Audio DAC | PCM5122 / clock-capable DAC | 1 | ₹500–2,000 class | controlled-clock experiment |
| Test header | SMA/BNC/GPIO breakout | 1 | ₹100–300 | clock observation |

element14 currently lists the ECS 24.576 MHz TCXO at approximately ₹205.09 for one unit and an ABRACON 24.576 MHz/2.5 ppm option at higher-volume pricing. urlelement14 24.576 MHz TCXO listinghttps://in.element14.com/c/crystals-oscillators/oscillators/temperature-compensated-tcxo-oscillators?frequency-nom=24.576mhz

## Portable power BOM

| Component | Model | Qty | Estimate |
|---|---|---:|---:|
| Protected battery | protected 18650, ~2500–3000 mAh | 1 | ₹250–450 |
| Charger | TP4056 1 A protected module | 1 | ₹20–50 |
| Boost converter | regulated 5 V boost, ≥2 A | 1 | ₹100–250 |
| Battery holder | single 18650 holder | 1 | ₹30–60 |
| Power switch | SPST | 1 | ₹10–30 |
| Fuse/polyfuse | low-current protection | 1 | ₹20–50 |

TP4056 modules are currently available in India at roughly ₹19 on Robu, but this simple charger should not be treated as a complete power-path manager for a productized device. urlRobu TP4056 modulehttps://robu.in/product/tp4056-1a-li-ion-lithium-battery-charging-module-micro-b-usb/

## Measurement equipment

Preferred:
- 2-channel oscilloscope, ≥20 MHz bandwidth, ≥100 MS/s
- 8-channel USB logic analyzer
- calibrated/known USB audio interface with 2 simultaneous input channels
- measurement microphone
- microphone preamp/interface where needed
- differential probe or appropriately rated differential measurement method
- DMM
- USB power meter
- thermocouple or IR thermometer

Do not connect a BTL amplifier speaker output directly to a grounded oscilloscope probe. The MAX98357A output is differential/bridge-tied.

## Final hardware BOM

Do not freeze a final production BOM until the MVP and clock experiments demonstrate:
1. audio buffer behavior
2. output repeatability
3. thermal behavior
4. battery runtime
5. acoustic synchronization
6. clock-discipline benefit

The production candidate is expected to move from development boards to a single PCB once those measurements exist.
