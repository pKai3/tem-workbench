"""Serializable source records; array payloads are fetched separately on demand."""
from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class Source:
    path: str
    size: int
    modified_ns: int
    device: int
    inode: int
    reader: str = 'h5oina-1'


@dataclass(frozen=True)
class Dataset:
    path: str
    shape: tuple[int, ...] | None
    dtype: str
    attributes: dict[str, Any]
    storage: str
    value: Any = None  # Small header/root values only; never signal arrays.

    @property
    def unit(self):
        return self.attributes.get('Unit')


@dataclass(frozen=True)
class Layer:
    path: str
    technique: str
    state: str  # acquired, processed, derived, display
    header: dict[str, Dataset]
    signals: tuple[Dataset, ...]
    grid_shape: tuple[int, int] | None  # (rows/y, columns/x), native storage order
    geometry_header: str | None  # Explicit provenance when processed data inherits geometry.
    notes: tuple[str, ...] = ()


@dataclass(frozen=True)
class Acquisition:
    index: str
    identifier: str | None
    label: str
    project: str | None
    specimen: str | None
    site: str | None
    layers: tuple[Layer, ...]


@dataclass(frozen=True)
class Catalogue:
    source: Source
    format_version: str
    software_version: str | None
    manufacturer: str | None
    index_type: str | None
    acquisitions: tuple[Acquisition, ...]
    datasets: tuple[Dataset, ...]
    warnings: tuple[str, ...]
    schema_version: int = 1

    def to_dict(self):
        return asdict(self)
