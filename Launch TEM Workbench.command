#!/bin/zsh
set -e
app_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
python_exe="${TEM_WORKBENCH_PYTHON:-$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("python_executable", "python3"))' "$app_dir/.tem-paths.json")}"
exec "$python_exe" "$app_dir/server.py" --open "$@"
