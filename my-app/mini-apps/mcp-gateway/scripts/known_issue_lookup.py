#!/usr/bin/env python3
"""Real knowledge base lookup against network-api's known-issues store.

Run as a live subprocess by the network_check_known_issues tool. Not a
device command, an internal tooling command, styled the same way, real
HTTP call, real match logic, not invented.
"""
import argparse
import json
import time
import urllib.parse
import urllib.request


def fetch(url):
    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.load(resp)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--firmware", required=True)
    parser.add_argument("--base-url", required=True)
    args = parser.parse_args()

    print(f"$ kb-lookup --model \"{args.model}\" --firmware \"{args.firmware}\"", flush=True)
    time.sleep(0.5)

    qs = urllib.parse.urlencode({"model": args.model, "firmwareVersion": args.firmware})
    data = fetch(f"{args.base_url.rstrip('/')}/known-issues?{qs}")
    matches = data["matches"]

    print("", flush=True)
    if not matches:
        print("0 matches found for this exact model and firmware combination.", flush=True)
        return

    print(f"{len(matches)} match found:", flush=True)
    for m in matches:
        print("", flush=True)
        print(f"Issue {m['issueRef']}", flush=True)
        print(f"  Affects: {m['matchModel']}, firmware {m['matchFirmwareRange']}", flush=True)
        print(f"  Symptom: {m['symptom']}", flush=True)
        print(f"  Root cause: {m['rootCause']}", flush=True)
        print(f"  Fixed in: {m['fixedInVersion']}", flush=True)
        print(f"  Recommended action: {m['recommendedAction']}", flush=True)


if __name__ == "__main__":
    main()
