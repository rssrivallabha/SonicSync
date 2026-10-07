#!/usr/bin/env python3
"""
Send a deterministic SonicSync test-click command to an ESP32-S3 node.

This is a bench tool only. The current firmware protocol is unauthenticated UDP.
"""

from __future__ import annotations

import argparse
import socket
import struct
import time

MAGIC = 0x5353
VERSION = 1
TYPE_COMMAND = 2
COMMAND_TEST_CLICK = 5
SAMPLE_RATE = 48000
CHANNELS = 2
PORT = 47600


def build_packet(target_micros: int, sequence: int) -> bytes:
    # Little-endian equivalent of the packed C++ PacketHeader.
    return struct.pack(
        "<HBBIIHHQHH",
        MAGIC,
        VERSION,
        TYPE_COMMAND,
        sequence,
        SAMPLE_RATE,
        CHANNELS,
        0,
        target_micros,
        COMMAND_TEST_CLICK,
        0,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("host", help="ESP32 IPv4 address")
    parser.add_argument("--lead-ms", type=float, default=1000.0)
    args = parser.parse_args()

    if args.lead_ms < 10:
        raise SystemExit("lead-ms must be at least 10 ms")

    target_micros = time.monotonic_ns() // 1000 + int(args.lead_ms * 1000.0)
    packet = build_packet(target_micros, sequence=1)

    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.sendto(packet, (args.host, PORT))

    print(
        "sent TEST_CLICK",
        f"target_monotonic_us={target_micros}",
        f"lead_ms={args.lead_ms:.1f}",
    )


if __name__ == "__main__":
    main()
