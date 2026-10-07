#!/usr/bin/env python3
"""
Analyze SonicSync timing captures.

Input CSV columns:
run,node_id,command_ns,gpio_ns,audio_ns,acoustic_ns

Missing timing columns are accepted and reported as unknown.
"""

from __future__ import annotations

import argparse
import csv
import math
import statistics
from collections import defaultdict
from dataclasses import dataclass


@dataclass(frozen=True)
class Sample:
    node_id: str
    command_ns: int | None
    gpio_ns: int | None
    audio_ns: int | None
    acoustic_ns: int | None


def parse_ns(value: str) -> int | None:
    value = value.strip()
    return None if value == "" else int(value)


def load(path: str) -> list[Sample]:
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        required = {"node_id", "command_ns", "gpio_ns", "audio_ns", "acoustic_ns"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"missing CSV columns: {sorted(missing)}")

        return [
            Sample(
                node_id=row["node_id"],
                command_ns=parse_ns(row["command_ns"]),
                gpio_ns=parse_ns(row["gpio_ns"]),
                audio_ns=parse_ns(row["audio_ns"]),
                acoustic_ns=parse_ns(row["acoustic_ns"]),
            )
            for row in reader
        ]


def stats(values: list[float]) -> dict[str, float]:
    if not values:
        return {}

    values.sort()
    return {
        "count": float(len(values)),
        "mean_ms": statistics.fmean(values),
        "stdev_ms": statistics.stdev(values) if len(values) >= 2 else 0.0,
        "p50_ms": values[int(0.50 * (len(values) - 1))],
        "p95_ms": values[int(0.95 * (len(values) - 1))],
        "p99_ms": values[int(0.99 * (len(values) - 1))],
        "max_ms": values[-1],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path")
    args = parser.parse_args()

    samples = load(args.csv_path)
    by_node: dict[str, list[Sample]] = defaultdict(list)

    for sample in samples:
        by_node[sample.node_id].append(sample)

    for node_id, rows in sorted(by_node.items()):
        command_gpio = [
            (r.gpio_ns - r.command_ns) / 1e6
            for r in rows
            if r.command_ns is not None and r.gpio_ns is not None
        ]
        gpio_audio = [
            (r.audio_ns - r.gpio_ns) / 1e6
            for r in rows
            if r.audio_ns is not None and r.gpio_ns is not None
        ]
        command_audio = [
            (r.audio_ns - r.command_ns) / 1e6
            for r in rows
            if r.command_ns is not None and r.audio_ns is not None
        ]
        audio_acoustic = [
            (r.acoustic_ns - r.audio_ns) / 1e6
            for r in rows
            if r.acoustic_ns is not None and r.audio_ns is not None
        ]

        print(f"[{node_id}]")
        print("  command_to_gpio", stats(command_gpio) or "UNKNOWN")
        print("  gpio_to_audio", stats(gpio_audio) or "UNKNOWN")
        print("  command_to_audio", stats(command_audio) or "UNKNOWN")
        print("  audio_to_acoustic", stats(audio_acoustic) or "UNKNOWN")

    acoustic_by_node = {
        node_id: [
            r.acoustic_ns for r in rows if r.acoustic_ns is not None
        ]
        for node_id, rows in by_node.items()
    }

    available = {node: times for node, times in acoustic_by_node.items() if times}
    if len(available) >= 2:
        anchors = list(available.values())[0]
        for node, times in list(available.items())[1:]:
            n = min(len(anchors), len(times))
            skew_ms = [
                (times[i] - anchors[i]) / 1e6
                for i in range(n)
            ]
            finite = [x for x in skew_ms if math.isfinite(x)]
            print(f"[ACOUSTIC_SKEW] reference vs {node}")
            print(" ", stats(finite) or "UNKNOWN")


if __name__ == "__main__":
    main()
