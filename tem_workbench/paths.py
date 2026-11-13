"""Locations shared by the source checkout and extracted application releases."""
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent
RESOURCES = Path(__file__).resolve().parent / "resources"
