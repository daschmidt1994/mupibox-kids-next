#!/bin/bash
#
# Config repair in node-sonos-config

FRONTENDCONFIG="/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/config.json"
# KN: the template from the box itself (kidsnext/installer/base.sh), not from mupibox.de
SRC="/opt/mupibox-kn/app/upstream"
HOSTN=$(/usr/bin/hostname)

[ -f "${SRC}/templates/www.json" ] || exit 1
cp -f "${SRC}/templates/www.json" "${FRONTENDCONFIG}"

/usr/local/bin/mupibox/./set_hostname.sh
# Atomic-update (HIGH-8).
_TMP="${FRONTENDCONFIG}.tmp.$$"
/usr/bin/jq --arg v "${HOSTN}" '."node-sonos-http-api".server = $v' "${FRONTENDCONFIG}" > "${_TMP}" && mv "${_TMP}" "${FRONTENDCONFIG}" || rm -f "${_TMP}"
chown dietpi:dietpi ${FRONTENDCONFIG}
