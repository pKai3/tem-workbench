#!/bin/zsh
set -e
tem_app_dir="${0:A:h}"
tem_python="$(/usr/bin/python3 "$tem_app_dir/tools/python_runtime.py" --check)"
export PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
if [[ "${TEM_DESKTOP_APP:-0}" == "1" ]]; then
    exec "$tem_python" "$tem_app_dir/server.py" --fallback-port "$@"
else
    exec "$tem_python" "$tem_app_dir/server.py" --open "$@"
fi
