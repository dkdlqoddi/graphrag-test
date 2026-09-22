# -*- coding: utf-8 -*-
"""rag-lab 시작점.

    python app.py        또는  run.bat 더블클릭

브라우저에서 http://127.0.0.1:8765/ 를 연다.
"""

import os
import sys
import threading
import webbrowser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lab import config, web            # noqa: E402


def check():
    """실행이 막히는 세 가지를 미리 잡아 준다."""
    problems = []
    try:
        import chromadb                 # noqa: F401
    except ImportError:
        problems.append("chromadb 가 없습니다.  pip install chromadb")
    try:
        import pypdf                    # noqa: F401
    except ImportError:
        problems.append("pypdf 가 없습니다.  pip install pypdf")
    if not config.api_key():
        problems.append("OPENAI_API_KEY 가 없습니다. .env 파일을 이 폴더에 두세요.")
    return problems


def main():
    problems = check()
    if problems:
        print("시작 전에 해결할 것이 있습니다.\n")
        for p in problems:
            print("  - %s" % p)
        print("\n위 항목을 해결한 뒤 다시 실행해 주세요.")
        input("\nEnter 를 누르면 닫힙니다. ")
        return 1

    url = "http://%s:%d/" % (config.HOST, config.PORT)
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    web.serve()
    return 0


if __name__ == "__main__":
    sys.exit(main())
