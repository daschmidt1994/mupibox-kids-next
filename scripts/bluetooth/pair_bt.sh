#!/bin/bash
#
# Pair (and connect to) a Bluetooth device by MAC. Called from the admin
# bluetooth.php endpoint. The MAC is user-controlled, so it must be
# validated strictly before being piped into bluetoothctl — anything else
# allows newline injection of arbitrary bluetoothctl commands.
#
# KN: one step after the other, each waited for (bluetoothctl's non-interactive commands), and the connect tried a few
# times. Before, the steps were typed into one bluetoothctl with fixed 2 s pauses: on Jakob's box the headphones
# (iClever-BTH12) were paired but never connected - the connect came while the pairing still ran, and the exit ended it.
# Exit 0 only when the device is connected in the end.

MAC="${1:-}"
if [[ ! "$MAC" =~ ^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$ ]]; then
	echo "Error: invalid MAC address format" >&2
	exit 1
fi

info() { bluetoothctl info "$MAC" 2>/dev/null; }

# A bluetoothctl command until `info` shows what is waited for (at most $1 s): non-interactive, bluetoothctl itself
# keeps running after a pair or connect is done, until its --timeout
until_info() {
	local seconds="$1" want="$2"
	shift 2
	timeout "${seconds}" bluetoothctl "$@" &
	local pid=$! i
	for ((i = 0; i < seconds * 2; i++)); do
		info | grep -q "${want}" && break
		kill -0 "${pid}" 2> /dev/null || break
		sleep 0.5
	done
	kill "${pid}" 2> /dev/null
	wait "${pid}" 2> /dev/null
	info | grep -q "${want}"
}

bluetoothctl power on > /dev/null

# not known to the adapter yet: looked for first (a device in pairing mode answers a scan)
if ! info | grep -q "Device "; then
	timeout 15 bluetoothctl --timeout 12 scan on > /dev/null 2>&1
fi
if ! info | grep -q "Device "; then
	echo "Error: device not found - is it in pairing mode?" >&2
	exit 1
fi

bluetoothctl trust "$MAC" > /dev/null

if ! info | grep -q "Paired: yes"; then
	until_info 30 "Paired: yes" --agent NoInputNoOutput pair "$MAC"
fi
if ! info | grep -q "Paired: yes"; then
	echo "Error: not paired" >&2
	exit 1
fi

for _ in 1 2 3; do
	info | grep -q "Connected: yes" && break
	until_info 10 "Connected: yes" connect "$MAC" && break
	sleep 1
done
if ! info | grep -q "Connected: yes"; then
	echo "Error: paired, but not connected" >&2
	exit 1
fi
echo "Connected: $MAC"
