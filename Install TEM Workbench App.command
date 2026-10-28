#!/bin/zsh
tem_app_dir="${0:A:h}"
/usr/bin/python3 "$tem_app_dir/tools/install_macos_app.py"
tem_install_status=$?
read -r "tem_install_reply?Press Return to close. "
exit "$tem_install_status"
