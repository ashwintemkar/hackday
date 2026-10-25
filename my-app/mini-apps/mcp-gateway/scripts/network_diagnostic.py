#!/usr/bin/env python3
"""Real diagnostic commands against network-api.

Run as a live subprocess by the network_show_* MCP tools. Each --check
value prints a real IOS-style command line, then real data fetched over
HTTP from network-api, formatted as terminal output, not JSON. Mirrors
what an engineer would actually see typing this at a device prompt.
"""
import argparse
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone


def fetch(url):
    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.load(resp)


def ago(iso_ts):
    then = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
    delta = datetime.now(timezone.utc) - then
    hours = delta.total_seconds() / 3600
    if hours < 1:
        return f"{int(delta.total_seconds() / 60)}m ago"
    if hours < 48:
        return f"{int(hours)}h ago"
    return f"{int(hours / 24)}d ago"


def interface_status(device, base):
    print(f"{device}# show interfaces", flush=True)
    time.sleep(0.6)
    data = fetch(f"{base}/devices/{device}/interface-status")
    print("", flush=True)
    for i in data["interfaces"]:
        proto = "up" if i["status"] == "up" else "down"
        print(f"{i['name']} is {i['status']}, line protocol is {proto}", flush=True)
        print(f"  {i['crcErrors24h']} CRC errors, {i['resets24h']} interface resets (24h)", flush=True)


def counter_history(device, base):
    print(f"{device}# show interfaces counters history", flush=True)
    time.sleep(0.7)
    data = fetch(f"{base}/devices/{device}/counter-history")
    print("", flush=True)
    for i in data["interfaces"]:
        print(f"  {i['name']}", flush=True)
        print("  Time                       CRC Errors", flush=True)
        print("  ----                       ----------", flush=True)
        for s in i["samples"]:
            ts = s["sampledAt"].replace("T", " ").split(".")[0]
            print(f"  {ts}         {s['crcErrors']}", flush=True)


def mac_table(device, base):
    print(f"{device}# show mac address-table", flush=True)
    time.sleep(0.5)
    data = fetch(f"{base}/devices/{device}/mac-table")
    print("", flush=True)
    if not data["entries"]:
        print("  (no entries learned on this interface)", flush=True)
        return
    print("  Vlan    Mac Address         Interface            Learned", flush=True)
    print("  ----    -----------         ---------            -------", flush=True)
    for e in data["entries"]:
        print(f"  {e['vlan']:<8}{e['macAddress']:<20}{e['interfaceName']:<21}{ago(e['learnedAt'])}", flush=True)


def logs(device, base):
    print(f"{device}# show logging", flush=True)
    time.sleep(0.6)
    data = fetch(f"{base}/devices/{device}/logs")
    print("", flush=True)
    for line in data["lines"]:
        ts = line["loggedAt"].replace("T", " ").split(".")[0]
        print(f"{ts}: {line['text']}", flush=True)


CHECKS = {
    "interface-status": interface_status,
    "counter-history": counter_history,
    "mac-table": mac_table,
    "logs": logs,
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", required=True)
    parser.add_argument("--check", required=True, choices=list(CHECKS.keys()))
    parser.add_argument("--base-url", required=True)
    args = parser.parse_args()

    CHECKS[args.check](args.device, args.base_url.rstrip("/"))


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print(f"error: {err}", file=sys.stderr, flush=True)
        sys.exit(1)
