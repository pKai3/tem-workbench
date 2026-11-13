"""Stable console entry point. Application code lives in tem_workbench.app."""
from tem_workbench.app.server import main


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    main()
