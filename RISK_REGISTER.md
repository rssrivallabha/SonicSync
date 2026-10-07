# SonicSync Risk Register

| ID | Risk | Severity | Status | Evidence | Mitigation |
|---|---|---:|---|---|---|
| R-001 | Repository contains no implementation | Critical | Open | GitHub reports empty repository | Create authoritative foundation before feature work |
| R-002 | Historical race/state bugs may recur during rewrite | Critical | Open | Specification records stale commands, upload ordering, stop/resume and sync issues | Epoch/revision state machine plus regression tests |
| R-003 | Browser scheduling may be insufficient for strict timing | Critical | Open | Specification requires native timing for strict paths | Keep sync core independent; implement native audio paths |
| R-004 | Software telemetry can be mistaken for acoustic truth | Critical | Open | Specification explicitly rejects this | Hardware timestamp + audio test fixture |
| R-005 | Independent device clocks drift | Critical | Open | Distributed audio inherently has oscillator differences | Estimate drift; rate correction; hardware clock study |
| R-006 | Output latency differs by route/device | Critical | Open | Built-in, wired, USB and Bluetooth paths differ | Separate estimated/measured/calibration latency |
| R-007 | 50 m radio behavior varies by environment | High | Open | Specification requires characterization, not guarantee | Distance and interference test matrix |
| R-008 | Native platform APIs/permissions constrain behavior | High | Open | Browser/OS audio restrictions | Capability negotiation and explicit degradation |
| R-009 | Hardware component choice may constrain timing/power | High | Open | No hardware selected yet | Comparative BOM and prototype validation |
| R-010 | Credentials/purchases/physical assembly unavailable to software agent | Blocking for physical phase | Open | Requires human action | Stop only at those boundaries; document exact dependency |
