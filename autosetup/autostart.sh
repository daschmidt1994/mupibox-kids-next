#!/bin/bash
# KN: the automatic installation of MuPiBox Kids Next is kidsnext/firstboot/dietpi-firstboot.sh (docs: installation.md)
echo "cd; curl -fsSL https://raw.githubusercontent.com/daschmidt1994/mupibox-kids-next/kids-next/kidsnext/install.sh | sudo bash" >> /home/dietpi/.bashrc
reboot
