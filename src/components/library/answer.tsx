"use client";

import { Fragment, type ReactNode } from "react";

/** Minimal markdown renderer for model answers: paragraphs, lists, bold, code, [n] citations. */
export function renderAnswer(md: string): ReactNode {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "))}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const Tag = list.ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={`l${blocks.length}`}>
          {list.items.map((it, i) => (
            <li key={i}>{inline(it)}</li>
          ))}
        </Tag>,
      );
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    if (heading) {
      flushPara();
      flushList();
      blocks.push(
        <p key={`h${blocks.length}`}>
          <strong>{inline(heading[1])}</strong>
        </p>,
      );
      continue;
    }
    if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      const text = (bullet ?? numbered)![1];
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(text);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return <>{blocks}</>;
}

function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[\d+(?:\]\[\d+)*\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<Fragment key={i++}>{text.slice(last, m.index)}</Fragment>);
    const tok = m[0];
    if (tok.startsWith("**")) parts.push(<strong key={i++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) parts.push(<code key={i++}>{tok.slice(1, -1)}</code>);
    else parts.push(<span key={i++} className="cite">{tok}</span>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(<Fragment key={i++}>{text.slice(last)}</Fragment>);
  return parts;
}
