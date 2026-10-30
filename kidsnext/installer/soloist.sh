# shellcheck shell=bash
#
# Spotify Soloist: the command mupi-kn-soloist. The program itself is not part of Kids Next (Spotify does not allow it
# to be passed on): each box downloads it from Spotify once the parents enter their own API key (app: Einstellungen ›
# Spotify › Soloist, or "sudo mupi-kn-soloist set-key"). A box that has a key gets its services renewed here.

kn_module_soloist() {
	kn_info "Spotify Soloist vorbereiten"
	ln -sfn "${KN_APP_DIR}/soloist/mupi-kn-soloist" /usr/local/sbin/mupi-kn-soloist
	if [ -s /etc/mupibox-kn/secrets/soloist.env ]; then
		# (no Soloist is no reason to stop the installation: the box plays Spotify in the browser then)
		kn_run "${KN_APP_DIR}/soloist/mupi-kn-soloist" install || kn_warn "Soloist ließ sich nicht erneuern – die Box spielt Spotify im Browser."
		kn_ok "Soloist erneuert"
		return 0
	fi
	kn_ok "Soloist bereit – API-Key in der Eltern-App eintragen (Bibliothek › Spotify › Soloist)"
}
