# Hardware Tools

## send_test_click.py

Sends the current bench TEST_CLICK command to an ESP32-S3 node.

## analyze_capture.py

Consumes raw timing CSV captures and reports:
- command → GPIO
- GPIO → electrical audio
- command → electrical audio
- electrical audio → acoustic arrival
- node-to-node acoustic skew
- mean / standard deviation / P50 / P95 / P99 / max

Raw captures are never overwritten.

These tools intentionally do not manufacture values when a timing domain is absent.
