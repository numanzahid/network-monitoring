#!/usr/bin/env python3
from pathlib import Path
import sys

if Path("/probe/probe_common.py").exists():
    from probe_common import main
else:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "common"))
    from probe import main


if __name__ == "__main__":
    main()
