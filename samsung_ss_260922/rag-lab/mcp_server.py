# -*- coding: utf-8 -*-
"""rag-lab MCP 서버 시작점.

    python mcp_server.py            http://127.0.0.1:8000/mcp 로 연다 (기본)
    python mcp_server.py --stdio    stdin/stdout 으로 연다
    run_mcp.bat                     위의 기본과 같다

`app.py` 와 짝을 이룬다. 같은 기능을 여는 창구가 둘인 셈이다.

    app.py         브라우저로 연다 — 사람이 보고 누른다 (http://127.0.0.1:8765/)
    mcp_server.py  MCP 로 연다     — 모델이 도구로 부른다

전송은 둘 중 하나를 고른다. 무엇이 오가는지 보이는 쪽이 이 앱의 목적에 맞으므로
**주소를 여는 HTTP 를 기본으로 둔다** — 서버가 이 창에 살아 있고 요청이 한 줄씩 찍힌다.
`--stdio` 는 클라이언트가 우리 프로세스를 직접 띄우는 방식이다(서버가 따로 살지 않는다).

stdio 로 열 때는 **이 창에 아무것도 인쇄하지 않는다.** 말을 주고받는 곳이 stdout 이라
한 줄이라도 섞이면 클라이언트가 그것을 JSON 으로 읽으려다 실패한다. 그래서 `app.py` 가
화면에 적던 점검 결과를 여기서는 stderr 로 내보낸다 — 두 전송에서 모두 같게 굴려
클라이언트의 서버 로그에 그대로 남게 한다.

점검에서 막혀도 서버를 세우지 않고 끝내지 않는다. 키가 없어도 파싱·청킹·저장소 보기는
되므로 무엇이 안 되는지만 알리고 계속 연다. 외부 호출이 필요한 도구를 부르면 그때
`lab/llm.py` 가 한국어로 사정을 알려 준다.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lab import config                          # noqa: E402
from lab import mcp_http, mcp_proto, mcp_tools  # noqa: E402


def check():
    """실행이 막히는 세 가지를 미리 잡아 준다 (app.py 의 check 와 같다)."""
    problems = []
    try:
        import chromadb                         # noqa: F401
    except ImportError:
        problems.append("chromadb 가 없습니다.  pip install chromadb")
    try:
        import pypdf                            # noqa: F401
    except ImportError:
        problems.append("pypdf 가 없습니다.  pip install pypdf")
    if not config.api_key():
        problems.append("OPENAI_API_KEY 가 없습니다. .env 를 프로젝트 폴더에 두세요."
                        " (임베딩·생성을 쓰는 도구만 막힙니다)")
    return problems


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    for p in check():
        mcp_proto.log("  [확인 필요] %s" % p)

    if "--stdio" in argv:
        return mcp_proto.serve_stdio(mcp_tools.TOOLS, mcp_tools.INSTRUCTIONS)
    return mcp_http.serve_http(mcp_tools.TOOLS, mcp_tools.INSTRUCTIONS)


if __name__ == "__main__":
    sys.exit(main())
