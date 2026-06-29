#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "$0")"
./install_local_helper_autostart.sh
printf '\n完成。可以关闭这个窗口。\n'
read -r -p "按回车关闭..." _
